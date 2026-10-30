#!/usr/bin/env node
// =============================================================================
// tools/build-images.mjs — fill the Japanese image gap into img/ + data/img-index.json.
//
// WHAT IT FETCHES: only cards with NO image anywhere else — a Japanese card whose set
// Limitless has no scans for. Everything else already has art from TCGdex or Limitless
// and is left alone.
//
// WHERE THE CARD LIST COMES FROM:
//   · the catalogue (data/jp-catalog/, tools/build-jp-catalog.mjs) when it exists: every
//     Japanese set, and each card's PokéWallet id is already in it — so this costs image
//     requests only, nothing to search. Keys come from jp-model.assignJpKeys over the same
//     cleaned rows the app's files were written from, so file names match tile ids.
//   · otherwise the committed Bulbapedia snapshot (data/jp.json) + JP_BULBA_SET_MAP's
//     code:null sets, matched to PokéWallet with one /search per Pokémon.
// WHICH POKÉMON: the pre-built list (data/index.json) by default; --pokemon "A,B" for
// others; --all for every gap card in the catalogue (≈10,700 — about 21,000 requests for
// both sizes, so pass a --max to match the day's quota).
//
// HOW (see js/api/local-images.js for the layout and the manifest):
//   1. Work out which gap cards are missing a file, from the manifest. None → 0 requests.
//   2. Download `low` and `high` for each. A file that exists is never re-fetched or
//      overwritten: images are immutable, so history only grows when cards are new.
//   3. Write the manifest (sorted, so its diffs stay readable).
// Stops cleanly at the request cap or when the live quota (read from PokéWallet's
// response headers) is down to the reserve; the next run carries on where it stopped.
//
// PUBLISHING: img/ and data/img-index.json are GITIGNORED until PokéWallet has agreed to
// us republishing their images. Until then this fills a local copy you can see in the dev
// server, and the live site behaves exactly as before. See README "Hosted card images".
//
// The key (POKEWALLET_IO_PROD_KEY, .env.local or the environment) is never logged or
// written: the client never records headers. With no key, this exits 0 and does nothing.
//
// Run: node tools/build-images.mjs [--dry-run] [--max N] [--pokemon "A,B" | --all]
// =============================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvKey } from './lib/env-key.mjs';
import { createClient, searchAll, listOf, matchJpRows, extFor } from './lib/pokewallet.mjs';
import { cleanTuple, japaneseOnly } from './lib/jp-catalog.mjs';
import { JP_BULBA_SET_MAP } from '../js/api/bulba-jp.js';
import { imagePath, emptyIndex, setSlug, IMAGE_SIZES } from '../js/api/local-images.js';
import { assignJpKeys, jpImageKeyFor, jpNumKey } from '../js/api/jp-model.js';
import { namesSpecies } from '../js/api/providers/tcgdex.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_FILE = resolve(ROOT, 'data/img-index.json');
const CAT_DIR = resolve(ROOT, 'data/jp-catalog');
const KEY_NAME = 'POKEWALLET_IO_PROD_KEY';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const all = args.includes('--all');
const argOf = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const maxRequests = Math.max(1, parseInt(argOf('--max'), 10) || 400);
const say = msg => console.log(`[build-images] ${msg}`);
const readJSON = f => JSON.parse(readFileSync(f, 'utf8'));

function readIndex() {
  if (!existsSync(INDEX_FILE)) return emptyIndex();
  try {
    const idx = readJSON(INDEX_FILE);
    return idx && typeof idx.images === 'object' ? idx : emptyIndex();
  } catch {
    say('! data/img-index.json unreadable — starting a fresh manifest');
    return emptyIndex();
  }
}

function writeIndex(idx) {
  const images = Object.fromEntries(Object.keys(idx.images).sort().map(k => [k, idx.images[k]]));
  writeFileSync(INDEX_FILE, JSON.stringify({ schemaVersion: 1, builtAt: new Date().toISOString(), images }, null, 1) + '\n');
}

/** Sizes still missing for `key`: absent from the manifest, or listed but gone from disk. */
function missingSizes(idx, key) {
  const e = idx.images[key];
  return IMAGE_SIZES.filter(s => !e?.sizes?.[s] || !existsSync(resolve(ROOT, imagePath(key, s, e.sizes[s]))));
}

function pokemonList() {
  const explicit = argOf('--pokemon');
  if (explicit) return explicit.split(',').map(s => s.trim()).filter(Boolean);
  const index = resolve(ROOT, 'data/index.json');
  return existsSync(index) ? Object.keys(readJSON(index).pokemon || {}) : [];
}

/** Gap cards from the catalogue: [{key, ref, label}] — refs known, nothing to search. */
function planFromCatalogue(names) {
  // The same clean-up and the same Japanese-only filter as the app's files, so the keys —
  // and therefore the file names — come out identical.
  const { sets, cards } = japaneseOnly(readJSON(resolve(CAT_DIR, 'sets.json')).sets,
    readJSON(resolve(CAT_DIR, 'cards.json')).cards.map(cleanTuple));
  const { setKeys, numKeys } = assignJpKeys(sets, cards);
  const out = [];
  cards.forEach((c, i) => {
    if (c[3] || sets[c[0]].limitless) return;                  // a print, or Limitless has the set
    if (!all && !names.some(n => namesSpecies(c[2], n))) return;
    out.push({ key: jpImageKeyFor(setKeys[c[0]], numKeys[i]), ref: c[5], label: `${sets[c[0]].name} ${c[1] || c[2]}` });
  });
  return out;
}

/** Gap cards from the Bulbapedia snapshot: [{key, row}] — matched to PokéWallet later. */
function planFromSnapshot(names) {
  const rows = (readJSON(resolve(ROOT, 'data/jp.json')).jpCardsData || []).filter(r => !names.length || names.includes(r.pokemonName));
  const out = [], seen = new Set();
  for (const r of rows) {
    const meta = JP_BULBA_SET_MAP[r.jpset];
    if (!meta || meta.code) continue;
    const key = jpImageKeyFor(setSlug(r.jpset), jpNumKey(r.jpnum));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, row: { ...r, key }, label: `${r.jpset} ${r.jpnum}` });
  }
  return out;
}

async function main() {
  const idx = readIndex();
  const names = pokemonList();
  const fromCatalogue = existsSync(resolve(CAT_DIR, 'cards.json'));
  const gap = fromCatalogue ? planFromCatalogue(names) : planFromSnapshot(names);
  const todo = gap.filter(g => missingSizes(idx, g.key).length);
  const scope = all ? 'every Pokémon' : names.join(', ') || '(no Pokémon)';
  say(`source: ${fromCatalogue ? 'catalogue' : 'Bulbapedia snapshot'}; scope: ${scope}.`);
  say(`${gap.length} gap card(s) with no other image source, ${todo.length} still need files `
    + `(≈${todo.reduce((n, g) => n + missingSizes(idx, g.key).length, 0)} image requests).`);
  if (!todo.length) { say('nothing to fetch.'); return; }
  if (dryRun && fromCatalogue) { say('dry run: nothing downloaded.'); return; }

  const key = loadEnvKey(KEY_NAME);
  if (!key) { say(`no ${KEY_NAME} configured — skipping (set it in .env.local).`); return; }

  const client = createClient(key, { maxRequests, log: m => say(`  ${m}`) });
  let files = 0, bytes = 0, stoppedWhy = null, changed = false;
  const unmatched = [];
  try {
    // Snapshot path only: find each card's PokéWallet id by set + number.
    if (!fromCatalogue) {
      const sets = listOf(await client.call('/sets'));
      const jpSetIds = new Set(sets.filter(s => s.language === 'jap').map(s => String(s.set_id)));
      const byPokemon = new Map();
      for (const g of todo) byPokemon.set(g.row.pokemonName, [...(byPokemon.get(g.row.pokemonName) || []), g]);
      for (const [name, want] of byPokemon) {
        const found = (await searchAll(client, name)).filter(c => jpSetIds.has(String(c?.card_info?.set_id)));
        const { matched, missing } = matchJpRows(want.map(g => g.row), found);
        unmatched.push(...missing.map(r => `${r.jpset} ${r.jpnum}`));
        const refByKey = new Map(matched.map(m => [m.row.key, m.card.id]));
        for (const g of want) g.ref = refByKey.get(g.key) || null;
        say(`${name}: ${matched.length}/${want.length} gap card(s) matched on PokéWallet.`);
      }
      if (dryRun) return;
    }

    for (const g of todo) {
      if (!g.ref) continue;
      const entry = idx.images[g.key] || { sizes: {} };
      for (const size of missingSizes(idx, g.key)) {
        const { buf, contentType } = await client.call(`/images/${encodeURIComponent(g.ref)}?size=${size}`, { binary: true });
        const ext = extFor(contentType, buf);
        const file = resolve(ROOT, imagePath(g.key, size, ext));
        mkdirSync(dirname(file), { recursive: true });
        if (!existsSync(file)) { writeFileSync(file, buf); files++; bytes += buf.length; }
        entry.sizes = { ...entry.sizes, [size]: ext };
        // Recorded per size, so a run stopped between low and high keeps what it fetched.
        idx.images[g.key] = { ...entry, source: 'pokewallet', ref: g.ref, fetched: new Date().toISOString().slice(0, 10) };
        changed = true;
      }
    }
  } catch (e) {
    if (e.code !== 'BUDGET' && !e.status) throw e;
    stoppedWhy = e.message;
  } finally {
    if (!dryRun && changed) writeIndex(idx);
    const q = client.quota;
    say(`${dryRun ? 'dry run: ' : ''}${files} file(s), ${Math.round(bytes / 1024)} KB, ${client.spent} request(s).`
      + (q.hour != null ? ` Quota left: ${q.hour}/${q.limitHour} this hour, ${q.day}/${q.limitDay} today.` : ''));
    if (unmatched.length) say(`not on PokéWallet (${unmatched.length}): ${unmatched.join('; ')}`);
    if (stoppedWhy) say(`stopped early (${stoppedWhy}) — run again later to continue.`);
  }
}

main().catch(err => {
  console.error('[build-images] FAILED:', err.message);
  process.exit(1);
});
