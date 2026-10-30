#!/usr/bin/env node
// =============================================================================
// tools/build-jp-catalog.mjs — every Japanese card, from PokéWallet, in two files.
//
// WHY: the app's Japanese cards come from Bulbapedia wikitext (one page per Pokémon; it
// answers our builds with 403) and are only shown for the 21 sets in JP_BULBA_SET_MAP,
// which was written for the Seedot line. PokéWallet lists 462 Japanese sets.
//
// WHAT IT WRITES:
//   data/jp-cat/                committed: what the app reads (see writeAppFiles below);
//                               replaced only by a COMPLETE walk (publishCheck)
//   data/jp-catalog/sets.json   gitignored build side: [{ id, name, pwName, code, date, cards, limitless }]
//   data/jp-catalog/cards.json  gitignored build side: [[setIndex, number, name, print, rarity, ref], …]
//   tools/jp-catalog-report.md  totals + a card-by-card check against Bulbapedia for the
//                               Pokémon in data/jp.json
// `name` keeps Bulbapedia's spelling for the 21 sets it shares (so existing JP checklist
// ids can carry over), and drops PokéWallet's code prefix elsewhere. `limitless` is the
// CDN code when Limitless has scans: JP_BULBA_SET_MAP, then tools/jp-gap-size.json if a
// local sizing run left one, then the committed data/jp-cat/sets.json — and only a set
// none of those knows (a new release) is checked against the Limitless CDN, a handful of
// HEAD requests. CI has no gap file, so without the carry-over a weekly rebuild would
// mark every modern set as unscanned.
//
// COST: /sets once, then one request per 200 cards of each set — ≈491 requests in all
// (sized 2026-10-30). Every set's raw answer is cached in tools/.cache/, so a run that
// stops at the quota reserve resumes where it stopped and never pays for a set twice;
// --refresh ignores the cache. The client reads the live hourly/daily quota from
// PokéWallet's response headers and stops before it runs out.
//
// The key (POKEWALLET_IO_PROD_KEY, .env.local or the environment) is never logged or
// written. Run: node tools/build-jp-catalog.mjs [--max N] [--refresh | --emit-only]
// =============================================================================

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvKey } from './lib/apitcg-key.mjs';
import { createClient, listOf, matchJpRows } from './lib/pokewallet.mjs';
import {
  canonicalSetName, parseReleaseDate, cardTuple, cleanTuple, isJapaneseSet, japaneseOnly, pagesFor, publishCheck,
} from './lib/jp-catalog.mjs';
import { JP_BULBA_SET_MAP } from '../js/api/bulba-jp.js';
import { assignJpKeys, jpEra, nameShardLetters } from '../js/api/jp-model.js';
import { findLimitlessCode } from './lib/limitless.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'data/jp-catalog');
const APP_DIR = resolve(ROOT, 'data/jp-cat');
const CACHE_DIR = resolve(ROOT, 'tools/.cache/pokewallet/jp-sets');
const REPORT = resolve(ROOT, 'tools/jp-catalog-report.md');
const GAP_FILE = resolve(ROOT, 'tools/jp-gap-size.json');
const PAGE = 200;

const args = process.argv.slice(2);
const refresh = args.includes('--refresh');
// --emit-only: rebuild data/jp-cat/ from an existing data/jp-catalog/ — no key, no requests.
const emitOnly = args.includes('--emit-only');
const maxArg = args.indexOf('--max');
const maxRequests = maxArg >= 0 ? Math.max(1, parseInt(args[maxArg + 1], 10) || 0) : 700;
const say = m => console.log(`[jp-catalog] ${m}`);
const readJSON = f => JSON.parse(readFileSync(f, 'utf8'));

if (emitOnly) {
  const s = readJSON(resolve(OUT_DIR, 'sets.json')), c = readJSON(resolve(OUT_DIR, 'cards.json'));
  writeAppFiles(s.sets, c.cards, new Date().toISOString());
  process.exit(0);
}

const key = loadEnvKey('POKEWALLET_IO_PROD_KEY');
if (!key) { say('no POKEWALLET_IO_PROD_KEY configured — nothing to do (set it in .env.local).'); process.exit(0); }
const cacheFile = id => resolve(CACHE_DIR, `${String(id).replace(/[^\w-]/g, '_')}.json`);

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const client = createClient(key, { maxRequests, log: m => say(`  ${m}`) });

  const allSets = listOf(await client.call('/sets'));
  const jpSets = allSets.filter(s => s.language === 'jap');
  say(`${jpSets.length} Japanese sets.`);

  const knownNames = Object.keys(JP_BULBA_SET_MAP);
  const limitlessById = new Map();
  if (existsSync(GAP_FILE)) for (const r of readJSON(GAP_FILE).sets || []) limitlessById.set(String(r.set_id), r.limitless || null);
  // What the committed catalogue already knows (null included: "checked, no scans").
  const committedLimitless = new Map();
  const committedFile0 = resolve(APP_DIR, 'sets.json');
  if (existsSync(committedFile0)) for (const s of readJSON(committedFile0).sets || []) committedLimitless.set(`${s.name}\u0000${s.code}`, s.limitless ?? null);

  let fetchedSets = 0, cachedSets = 0, stoppedWhy = null;
  const incomplete = [];
  const failed = [];
  try {
    for (const s of jpSets) {
      const file = cacheFile(s.set_id);
      if (!refresh && existsSync(file)) { cachedSets++; continue; }
      const rows = [];
      const pages = pagesFor(s.card_count, PAGE);
      try {
        for (let page = 1; page <= pages; page++) {
          const body = await client.call(`/sets/${encodeURIComponent(s.set_id)}?limit=${PAGE}&page=${page}`);
          const list = listOf(body).filter(c => c?.card_info);
          rows.push(...list);
          if (list.length < PAGE) break;
        }
      } catch (e) {
        if (e.code === 'BUDGET') throw e;
        // /sets lists some set ids that /sets/:id then answers 404 "Set not found" for
        // (24002, 2026-10-30). One dead entry must not abort a 491-request walk: a 404
        // is cached as "unavailable" so later runs do not pay for it again (--refresh
        // retries it); anything else is left uncached and retried on the next run.
        failed.push(`${s.name} [${s.set_id}]: ${e.status ? 'HTTP ' + e.status : e.message}`);
        if (e.status === 404) writeFileSync(file, JSON.stringify({ set: s, rows: [], unavailable: 404 }));
        continue;
      }
      writeFileSync(file, JSON.stringify({ set: s, rows }));
      fetchedSets++;
    }
  } catch (e) {
    if (e.code !== 'BUDGET') throw e;
    stoppedWhy = e.message;
  }

  // Assemble from the cache — the sets fetched now plus every earlier run's.
  const sets = [];
  const cards = [];
  const unavailableSets = [];
  let newChecks = 0;
  for (const s of jpSets) {
    const file = cacheFile(s.set_id);
    if (!existsSync(file)) { incomplete.push(s.name); continue; }
    const { rows, unavailable } = readJSON(file);
    if (unavailable) { unavailableSets.push(`${s.name} [${s.set_id}]`); continue; }
    const name = canonicalSetName(s.name, knownNames);
    const known = JP_BULBA_SET_MAP[name];
    const code = s.set_code || null;
    const carried = `${name}\u0000${code}`;
    let limitless = known?.code || limitlessById.get(String(s.set_id)) || null;
    // (Thai/Indonesian promo sets never reach the app, so they are not worth a check.)
    if (!known?.code && !limitlessById.has(String(s.set_id)) && isJapaneseSet(s.name)) {
      limitless = committedLimitless.has(carried) ? committedLimitless.get(carried)
        : (newChecks++, await findLimitlessCode(code, Number(s.number_count) || rows.length));
    }
    const idx = sets.length;
    sets.push({
      id: String(s.set_id), name, pwName: s.name, code,
      date: parseReleaseDate(s.release_date), cards: Number(s.number_count) || rows.length, limitless,
    });
    for (const c of rows) cards.push(cardTuple(idx, c));
  }
  if (newChecks) say(`checked ${newChecks} set(s) no source knew against the Limitless CDN.`);

  const builtAt = new Date().toISOString();
  writeFileSync(resolve(OUT_DIR, 'sets.json'), JSON.stringify({ schemaVersion: 1, builtAt, source: 'pokewallet', sets }, null, 1) + '\n');
  writeFileSync(resolve(OUT_DIR, 'cards.json'), JSON.stringify({ schemaVersion: 1, builtAt, source: 'pokewallet',
    fields: ['set', 'number', 'name', 'print', 'rarity', 'ref'], cards }) + '\n');
  // data/jp-cat/ is committed and served: only a complete walk may replace it.
  const committedFile = resolve(APP_DIR, 'sets.json');
  const committedSets = existsSync(committedFile) ? (readJSON(committedFile).sets || []).length : 0;
  const verdict = publishCheck({ incomplete: incomplete.length, sets: japaneseOnly(sets, []).sets.length, committedSets });
  if (verdict.ok) writeAppFiles(sets, cards, builtAt);
  else say(`! data/jp-cat/ left as it was (${verdict.why}) — run again to finish the walk.`);

  writeReport({ sets, cards, client, fetchedSets, cachedSets, incomplete, stoppedWhy, unavailableSets, failed });
  if (failed.length) say(`${failed.length} set(s) failed this run: ${failed.join('; ')}`);
  const q = client.quota;
  say(`${sets.length}/${jpSets.length} sets, ${cards.length} card rows. Fetched ${fetchedSets} set(s) now, ${cachedSets} from cache; ${client.spent} request(s).`
    + (q.hour != null ? ` Quota left: ${q.hour}/${q.limitHour} this hour, ${q.day}/${q.limitDay} today.` : ''));
  if (stoppedWhy) say(`stopped early (${stoppedWhy}) — ${incomplete.length} set(s) still to fetch; run again to continue.`);
  say('wrote data/jp-catalog/ (build side), data/jp-cat/ (what the app reads), tools/jp-catalog-report.md');
}

/**
 * The files the APP reads (js/api/jp-source.js), derived from the build-side catalogue:
 *   data/jp-cat/sets.json         [{ key, name, code, date, era, limitless, sym, cards }]
 *   data/jp-cat/cards-{a-z,0}.json { rows: [[setKey, number, name, print, numKey], …] }
 * No PokéWallet ids (`ref`): they are 60% of cards.json and only the image build needs
 * them. Keys come from jp-model.assignJpKeys, so ids here, in the app and in the image
 * build are the same strings. Rebuilt from scratch each time, so a letter that empties
 * out cannot leave a stale shard behind.
 */
function writeAppFiles(allSets, rawCards, builtAt) {
  const { sets, cards } = japaneseOnly(allSets, rawCards.map(cleanTuple));
  const { setKeys, numKeys } = assignJpKeys(sets, cards);
  const appSets = sets.map((s, i) => ({
    key: setKeys[i], name: s.name, code: s.code, date: s.date, era: jpEra(s.code, s.date),
    limitless: s.limitless, sym: JP_BULBA_SET_MAP[s.name]?.sym || null, cards: s.cards,
  }));
  const shards = new Map();
  cards.forEach((c, i) => {
    const row = [setKeys[c[0]], c[1], c[2], c[3], numKeys[i]];
    for (const l of nameShardLetters(c[2])) (shards.get(l) || shards.set(l, []).get(l)).push(row);
  });
  rmSync(APP_DIR, { recursive: true, force: true });
  mkdirSync(APP_DIR, { recursive: true });
  writeFileSync(resolve(APP_DIR, 'sets.json'), JSON.stringify({ schemaVersion: 1, builtAt, source: 'pokewallet', sets: appSets }) + '\n');
  for (const [l, rows] of shards) writeFileSync(resolve(APP_DIR, `cards-${l}.json`), JSON.stringify({ schemaVersion: 1, builtAt, rows }) + '\n');
  say(`app files: ${appSets.length} sets, ${shards.size} name shards (largest ${Math.max(...[...shards.values()].map(r => r.length))} rows).`);
}

/** Totals, plus the Pokémon already in data/jp.json checked card by card. */
function writeReport({ sets, cards, client, fetchedSets, cachedSets, incomplete, stoppedWhy, unavailableSets, failed }) {
  const jp = existsSync(resolve(ROOT, 'data/jp.json')) ? readJSON(resolve(ROOT, 'data/jp.json')) : { jpCardsData: [] };
  const bulba = jp.jpCardsData || [];
  const names = [...new Set(bulba.map(r => r.pokemonName))];
  // Rebuild PokéWallet-shaped rows (with PokéWallet's own set name) so the very same
  // matcher as build-images applies, aliases included.
  const asPw = t => ({ id: t[5], card_info: { name: t[3] ? `${t[2]} (${t[3]})` : t[2], set_name: sets[t[0]].pwName, card_number: t[1] } });
  const dupNames = Object.entries(sets.reduce((m, s) => (m[s.name] = (m[s.name] || 0) + 1, m), {})).filter(([, n]) => n > 1);
  const lines = [
    '# Japanese catalogue — build report', '',
    `Generated: ${new Date().toISOString()}`,
    `Requests this run: ${client.spent}. Sets fetched now: ${fetchedSets}; from cache: ${cachedSets}.`
      + (stoppedWhy ? ` **Stopped early:** ${stoppedWhy} — ${incomplete.length} set(s) still missing.` : ''), '',
    '> Holds PokéWallet data — gitignored, do not commit.', '',
    '## Totals', '',
    `- Sets: ${sets.length}; card rows: ${cards.length} (${cards.filter(c => c[3]).length} are separately-listed prints such as "(Mirror Holofoil)").`,
    `- Sets with a release date: ${sets.filter(s => s.date).length}; with a Limitless code: ${sets.filter(s => s.limitless).length}.`,
    `- Sets that keep Bulbapedia's name (existing checklist ids carry over): ${sets.filter(s => JP_BULBA_SET_MAP[s.name]).length} of ${Object.keys(JP_BULBA_SET_MAP).length}.`,
    `- Set names shared by more than one set (ids must not key on name alone): ${dupNames.length ? dupNames.map(([n, k]) => `${n} ×${k}`).join(', ') : 'none'}.`,
    `- Rows with no card number: ${cards.filter(c => !c[1] || c[1] === 'null').length}.`, '',
  ];
  for (const name of names) {
    const word = new RegExp(`(^|[^a-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i');
    const mine = cards.filter(t => word.test(t[2]));
    const rows = bulba.filter(r => r.pokemonName === name);
    const { matched, missing } = matchJpRows(rows, mine.map(asPw));
    const matchedRefs = new Set(matched.map(m => m.card.id));
    const extra = mine.filter(t => !t[3] && !matchedRefs.has(t[5]));
    lines.push(`## ${name}`, '',
      `- Bulbapedia: ${rows.length}; found in the catalogue: **${matched.length}**; missing: ${missing.map(r => `${r.jpset} ${r.jpnum}`).join('; ') || 'none'}.`,
      `- Catalogue cards Bulbapedia does not list (${extra.length}): ${extra.map(t => `${sets[t[0]].name} ${t[1] || '(no number)'} "${t[2]}"`).join('; ') || 'none'}.`,
      `- Separately-listed prints: ${mine.filter(t => t[3]).map(t => `${sets[t[0]].name} ${t[1]} (${t[3]})`).join('; ') || 'none'}.`, '');
  }
  if (unavailableSets.length) lines.push('## Listed by /sets but "Set not found" (404)', '', ...unavailableSets.map(n => `- ${n}`), '');
  if (failed.length) lines.push('## Failed this run (retried next run)', '', ...failed.map(n => `- ${n}`), '');
  if (incomplete.length) lines.push('## Sets not fetched yet', '', ...incomplete.map(n => `- ${n}`), '');
  writeFileSync(REPORT, lines.join('\n'));
}

main().catch(err => {
  console.error('[jp-catalog] FAILED:', err.message);
  process.exit(1);
});
