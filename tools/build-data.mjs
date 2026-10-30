#!/usr/bin/env node
// =============================================================================
// tools/build-data.mjs — pre-build the static data snapshots the app serves.
//
// Reads set metadata for every set and, for each Pokémon on the list, its EN cards from
// TCGdex and its Japanese entries from Bulbapedia. Writes:
//   data/sets.json          set names, dates, symbols, logos, counts, series (all languages)
//   data/cards/<slug>.json  one EN card shard per Pokémon
//   data/jp/<slug>.json     one Bulbapedia JP shard per Pokémon
//   data/index.json         exact Pokémon name → shard filename
// The app reads these first (instant, no rate limits, any number of users) and only
// hits the live API for what they lack or on a user-triggered refresh.
//
// It imports the SAME tcgdex provider the browser uses, so the snapshot shape can
// never drift from the live shape. Requires Node 18+ (global fetch) and network access.
// Run: `node tools/build-data.mjs` (or `npm run build-data`). Pass a comma-separated
// list to build a different snapshot instead, e.g. `node tools/build-data.mjs "Pikachu,Eevee"`.
// CI runs the no-arg (default) form weekly.
// =============================================================================

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DEFAULT_POKEMON, SCHEMA_VERSION } from '../js/config.js';
import { getCards, getSetMeta } from '../js/api/providers/tcgdex.js';
import { fetchJpRawByName } from '../js/api/bulba-jp.js';
import { uniqueSlug } from '../js/slug.js';
import { planJpSnapshot } from './lib/jp-keep.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = resolve(ROOT, 'data');

// Which Pokémon to build.
//   1. an explicit comma-separated CLI arg, e.g. `node tools/build-data.mjs "Pikachu,Eevee"`
//   2. otherwise data/prebuilt.json — the checked-in list the weekly job builds, which
//      is how coverage grows by PR rather than by editing this file
//   3. otherwise DEFAULT_POKEMON (the demo list)
function resolvePokemon() {
  if (process.argv[2]) return process.argv[2].split(',').map(s => s.trim()).filter(Boolean);
  const listFile = resolve(DATA_DIR, 'prebuilt.json');
  if (existsSync(listFile)) {
    try {
      const arr = JSON.parse(readFileSync(listFile, 'utf8'));
      if (Array.isArray(arr) && arr.length) return arr.map(String);
    } catch (e) {
      console.warn('[build-data] data/prebuilt.json unreadable, using defaults:', e.message);
    }
  }
  return [...DEFAULT_POKEMON];
}

const POKEMON = resolvePokemon();

const writeJSON = (file, obj) => writeFileSync(resolve(DATA_DIR, file), JSON.stringify(obj));
// null for a missing or unparseable file: either way there is no committed copy to keep.
const readJSON = (file) => {
  try { return JSON.parse(readFileSync(resolve(DATA_DIR, file), 'utf8')); } catch { return null; }
};

async function main() {
  console.log(`[build-data] Pokémon (${POKEMON.length}): ${POKEMON.join(', ')}`);

  // Set metadata FIRST: its setSeries map is what the card index needs to build the
  // image URL of a card TCGdex lists without one (see tcgdex.getCards).
  //
  // allEnSets, NOT the set ids these cards happen to touch. snapshot.getSetMeta rejects
  // a date map with ANY gap (a missing date collapses a set to the 1999 sort fallback,
  // i.e. one giant fake era), so deriving the list from the build's own Pokémon made the
  // snapshot a guaranteed miss for every visitor who picked something else — 20 dates
  // against 214 set names. They then paid the full live cost: nine /sets sweeps plus up
  // to ~200 pooled detail calls, the slowest thing in the boot path. One bounded weekly
  // cost here removes it for everybody, pre-built Pokémon or not.
  console.log('[build-data] fetching set metadata from TCGdex (all EN sets)…');
  const meta = await getSetMeta({ allEnSets: true, withSeries: true });
  const langCount = Object.keys(meta.names || {}).length;
  const nameCount = Object.keys(meta.names?.en || {}).length;
  const allIds = new Set(Object.values(meta.names || {}).flatMap(m => Object.keys(m)));
  const dateCount = Object.keys(meta.dates || {}).length;
  const countCount = Object.keys(meta.counts || {}).length;
  const logoCount = Object.keys(meta.logos || {}).length;
  const serieCount = Object.keys(meta.setSeries || {}).length;
  const emptyByLang = Object.entries(meta.lang || {})
    .map(([c, v]) => `${c}:${(v.noCards || []).length}`).filter(s => !s.endsWith(':0'));
  console.log(`[build-data]   → ${langCount} languages, ${allIds.size} set ids ` +
    `(${nameCount} EN), ${dateCount} dates, ${countCount} counts, ${logoCount} logos, ` +
    `${serieCount} series-mapped`);
  if (emptyByLang.length) console.log(`[build-data]   → sets with no card list: ${emptyByLang.join(' ')}`);

  // ── CANARIES ──
  // The additive sets.json shape rests on two measured invariants. Both hold today (0
  // hits); a hit means TCGdex changed something and the flat maps have started lying.
  const unmapped = [...allIds].filter(id => !meta.setSeries?.[id]);
  if (unmapped.length) {
    console.warn(`[build-data]   ! ${unmapped.length} set(s) have no series and will fall into ` +
      `"Other sets": ${unmapped.slice(0, 8).join(', ')}`);
  }
  // A LATIN-script language disagreeing on a date would mean the flat `dates` map is no
  // longer safe to share, and per-language date overrides are needed for it too.
  for (const code of ['de', 'fr', 'es', 'it', 'pt']) {
    const over = Object.keys(meta.lang?.[code]?.dates || {});
    if (over.length) {
      console.warn(`[build-data]   ! ${code} disagrees with EN on ${over.length} release date(s) ` +
        `— the shared flat date map may no longer be safe: ${over.slice(0, 5).join(', ')}`);
    }
  }
  if (dateCount < nameCount) {
    console.warn(`[build-data]   ! ${nameCount - dateCount} EN set(s) have no release date; ` +
      'snapshot.getSetMeta will miss for anyone whose cards land in one of them');
  }
  // getSetMeta swallows every failed request, so a TCGdex outage comes back as empty
  // maps, not an error. Writing those would wipe data/sets.json for every visitor.
  if (!nameCount) throw new Error('TCGdex returned no EN set names; nothing written');
  const setSeries = meta.setSeries || {};

  // Slugs are fixed up front: both keep-guards below have to read each Pokémon's
  // COMMITTED shards before anything is written over them.
  const taken = new Set();
  const slugs = POKEMON.map(name => uniqueSlug(name, taken));

  // ── EN CARD SHARDS ──
  // Each shard is fetched INDEPENDENTLY. getCards dedups a shared cameo ("Seedot &
  // Nuzleaf-GX") onto the first-listed Pokémon, so one combined fetch sliced per Pokémon
  // would leave that card out of the other's shard — and a visitor who asked for only
  // that Pokémon would get fewer cards from the snapshot than from a live fetch.
  //
  // A failed fetch keeps the committed shard (same identity test as the JP guard below);
  // with none committed, no shard is written and visitors fetch that Pokémon live. If
  // EVERY fetch fails, TCGdex is down: stop before anything is written.
  console.log('[build-data] fetching card shards from TCGdex…');
  const shards = [];
  for (const [i, name] of POKEMON.entries()) {
    try {
      shards.push({ cards: await getCards([name], { setSeries }) });
    } catch (e) {
      const prev = readJSON(`cards/${slugs[i]}.json`);
      const kept = prev?.builtAt && prev.pokemon === name && Array.isArray(prev.cards) ? prev.cards : null;
      console.warn(`[build-data]   ! ${name}: card fetch failed (${e.message}); ` +
        (kept ? `keeping the committed ${kept.length} cards` : 'no committed shard, so none is written'));
      shards.push({ cards: null, kept });
    }
  }
  if (!shards.some(s => s.cards)) throw new Error('every TCGdex card fetch failed; nothing written');
  // Variants are best effort in the provider (a footer badge must never cost the card
  // list), so a GraphQL outage would quietly bake a snapshot with no badges at all. Say so.
  const fresh = [...new Map(shards.flatMap(s => s.cards || []).map(c => [c.id, c])).values()];
  const noVariants = fresh.filter(c => !c.variants);
  const inferred = fresh.filter(c => c.variants?.inferred).length;
  console.log(`[build-data]   → ${fresh.length} cards; variants on ${fresh.length - noVariants.length}/${fresh.length} ` +
    `(${inferred} BW/XY/SM reverse holo inferred)`);
  if (noVariants.length) {
    console.warn(`[build-data]   ! ${noVariants.length} card(s) have no variant data: ` +
      noVariants.slice(0, 8).map(c => c.id).join(', '));
  }

  console.log('[build-data] fetching Japanese cards from Bulbapedia…');
  const jpResults = await fetchJpRawByName(POKEMON);
  const jpFailed = jpResults.filter(r => !r.ok).length;
  console.log(`[build-data]   → ${jpResults.reduce((n, r) => n + r.entries.length, 0)} JP entries` +
    (jpFailed ? ` (${jpFailed}/${POKEMON.length} fetch(es) FAILED)` : ''));

  // ── JP: NEVER TRADE COMMITTED DATA FOR A BAD FETCH ──
  // A blocked Bulbapedia used to come back as "no JP cards" and get committed as such
  // (61 entries → 0 on 2026-09-14). See tools/lib/jp-keep.mjs for the rule. A shard only
  // counts as committed data under the same test snapshot.js applies (builtAt + array),
  // plus the name: reordering data/prebuilt.json can hand a colliding slug ("nidoran-2")
  // to the other Nidoran, and keeping that file would file one's cards under the other.
  const previousJp = {};
  POKEMON.forEach((name, i) => {
    const prev = readJSON(`jp/${slugs[i]}.json`);
    previousJp[name] = prev?.builtAt && prev.pokemon === name && Array.isArray(prev.jpCardsData)
      ? prev.jpCardsData : null;
  });
  const jp = planJpSnapshot(POKEMON, jpResults, previousJp);
  POKEMON.forEach((name, i) => {
    const { warning } = jp.shards[name];
    if (warning) console.warn(`[build-data]   ! JP ${name}: ${warning} — data/jp/${slugs[i]}.json`);
  });

  const builtAt = new Date().toISOString();
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'cards'), { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'jp'), { recursive: true });

  // `counts` is the DENOMINATOR for single-set mode ("47 / 165 collected"), and it costs
  // nothing to ship: cardCount is already on every entry of the /sets response this
  // build reads for names and dates.
  //
  // dates/symbols/logos/counts stay FLAT `{setId: value}` maps and are the UNION across
  // languages — see the shape note on tcgdex.getSetMeta. `lang` carries only the values
  // that differ from them, which is why this file is ~94 KB and not ~275 KB.
  writeJSON('sets.json', {
    schemaVersion: SCHEMA_VERSION, builtAt,
    names: meta.names, dates: meta.dates, symbols: meta.symbols,
    logos: meta.logos, counts: meta.counts,
    setSeries: meta.setSeries, series: meta.series, lang: meta.lang,
  });

  // ── PER-POKÉMON SHARDS ──
  // index.json lists every Pokémon; a shard file that is missing is simply a miss at
  // runtime (snapshot.getCardsPartial), and the visitor fetches that Pokémon live.
  const index = { schemaVersion: SCHEMA_VERSION, builtAt, pokemon: {} };
  for (const [i, name] of POKEMON.entries()) {
    const slug = slugs[i];
    index.pokemon[name] = slug;
    // A kept card shard is left byte-identical, like a kept JP shard below.
    const { cards: own, kept } = shards[i];
    if (own) writeJSON(`cards/${slug}.json`, { schemaVersion: SCHEMA_VERSION, builtAt, pokemon: name, cards: own });
    // A kept JP shard is left byte-identical (not rewritten with a new builtAt), so a
    // blocked run produces no data/jp* diff for the weekly job to commit.
    const jpShard = jp.shards[name];
    if (jpShard.write) {
      writeJSON(`jp/${slug}.json`, {
        schemaVersion: SCHEMA_VERSION, builtAt, pokemon: name, jpCardsData: jpShard.entries,
      });
    }
    console.log(`[build-data]   shard ${slug}: ` +
      (own ? `${own.length} cards, ` : kept ? `${kept.length} cards (KEPT, not refreshed), ` : 'no card shard (fetch failed), ') +
      (jpShard.write ? `${jpShard.entries.length} JP`
        : jpShard.entries ? `${jpShard.entries.length} JP (KEPT, not refreshed)` : 'no JP shard (fetch failed)'));
  }
  writeJSON('index.json', index);

  const jpKept = POKEMON.filter(n => !jp.shards[n].write);
  const cardsWritten = shards.filter(s => s.cards).length;
  console.log(`[build-data] wrote sets.json, index.json + ${cardsWritten} card shard(s), ` +
    `${POKEMON.length - jpKept.length} JP shard(s) @ ${builtAt}`);
  if (cardsWritten < POKEMON.length) {
    console.warn(`[build-data] ! EN cards NOT refreshed for ${POKEMON.length - cardsWritten}/${POKEMON.length} ` +
      'Pokémon; see the card warnings above');
  }
  if (jpKept.length) {
    console.warn(`[build-data] ! JP data NOT refreshed for ${jpKept.length}/${POKEMON.length} ` +
      `Pokémon (${jpKept.join(', ')}); committed copies kept — see the JP warnings above`);
  }
}

main().catch((err) => {
  console.error('[build-data] FAILED:', err);
  process.exit(1);
});
