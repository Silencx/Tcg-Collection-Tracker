#!/usr/bin/env node
// =============================================================================
// tools/build-catalog.mjs — every card TCGdex lists, per language, into data/cat/.
//
// The app's master card index reads it before anything else (js/api/catalog.js), so a
// Pokémon that is not pre-built still gets its full English list without a live name
// search; single-set mode falls back to it when TCGdex is down.
//
// Keyless. Five requests per language, nine languages: /{lang}/cards (the whole list in
// one answer — verified against a full set walk, see docs/card-coverage-plan.md),
// /{lang}/categories, and the list once per category, because list items carry none.
//
//   node tools/build-catalog.mjs              # every language
//   node tools/build-catalog.mjs en de        # just these (LANGUAGES codes)
//   node tools/build-catalog.mjs --force      # accept a list that shrank by over 10%
//
// Writes data/cat/{lang}/cards-{a…z,0}.json and data/cat/index.json. A language is only
// replaced by a complete answer: one that fails, or lost over a tenth of its cards, keeps
// its committed files. Unchanged files are written back byte for byte. Exits 1 when a
// language failed, after writing the ones that did not.
// =============================================================================

import { writeFileSync, mkdirSync, readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { stampBuiltAt } from './lib/built-at.mjs';
import {
  CATALOG_LANGS, categoryCode, catalogRows, shardRows, shardFile, langSummary, indexFile, acceptCount,
} from './lib/catalog.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data', 'cat');
const API = 'https://api.tcgdex.net/v2';
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const ONLY = args.filter(a => !a.startsWith('--'));
const SHARD_WARN_BYTES = 1024 * 1024;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const kb = n => `${Math.round(n / 1024)} KB`;

async function getJSON(url) {
  let last;
  for (const wait of [0, 2000, 10000]) {
    if (wait) await sleep(wait);
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
      if (r.ok) return await r.json();
      last = new Error(`HTTP ${r.status} — ${url}`);
      if (r.status === 404) break;
    } catch (e) { last = e; }
  }
  throw last;
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

/** Write `body` stamped with `builtAt`, unless the file already says the same. → bytes, changed */
function writeStamped(file, body, builtAt) {
  let prevText = null;
  try { prevText = readFileSync(file, 'utf8'); } catch { /* new file */ }
  let prev = null;
  try { prev = prevText ? JSON.parse(prevText) : null; } catch { /* rewritten below */ }
  const text = JSON.stringify(stampBuiltAt(body, prev, builtAt));
  if (text !== prevText) writeFileSync(file, text);
  return { bytes: Buffer.byteLength(text), changed: text !== prevText };
}

/** Card id → category letter, from one filtered list per category TCGdex names. */
async function categories(apiCode, log) {
  const byId = new Map();
  const words = await getJSON(`${API}/${apiCode}/categories`);
  if (!Array.isArray(words) || !words.length) throw new Error('no categories');
  for (const word of words) {
    const code = categoryCode(word);
    if (!code) { log(`! unknown category "${word}": its cards get none`); continue; }
    const list = await getJSON(`${API}/${apiCode}/cards?category=${encodeURIComponent(word)}`);
    for (const c of Array.isArray(list) ? list : []) if (c?.id) byId.set(c.id, code);
  }
  return byId;
}

async function buildLang({ code, apiCode }, prevSummary, builtAt, knownSets) {
  const log = s => console.log(`[build-catalog]   ${code}: ${s}`);
  const list = await getJSON(`${API}/${apiCode}/cards`);
  if (!Array.isArray(list) || !list.length) throw new Error('TCGdex listed no cards');

  let catById = new Map();
  try { catById = await categories(apiCode, log); }
  catch (e) { log(`! categories unavailable (${e.message}); rows carry none`); }

  const { rows, skipped } = catalogRows(list, catById);
  if (skipped.length) log(`! ${skipped.length} card(s) skipped (no name, or id is not set-number): ${skipped.slice(0, 5).join(', ')}`);
  const noCat = rows.filter(r => !r[3]).length;
  if (noCat) log(`! ${noCat} card(s) with no category`);
  const unknownSets = [...new Set(rows.map(r => r[0]))].filter(s => !knownSets.has(s));
  if (unknownSets.length) {
    log(`! ${unknownSets.length} set(s) not in data/sets.json, so their image addresses are guessed: ${unknownSets.slice(0, 8).join(', ')}`);
  }

  if (!acceptCount(rows.length, prevSummary?.cards, { force: FORCE })) {
    throw new Error(`${rows.length} cards against ${prevSummary.cards} last time; kept the committed files (rerun with --force if TCGdex really dropped them)`);
  }

  const shards = shardRows(rows);
  const dir = resolve(OUT, code);
  mkdirSync(dir, { recursive: true });
  let total = 0, changed = 0, biggest = ['', 0];
  for (const [letter, shardRowsList] of Object.entries(shards)) {
    const w = writeStamped(resolve(dir, `cards-${letter}.json`), shardFile(code, shardRowsList), builtAt);
    total += w.bytes;
    if (w.changed) changed++;
    if (w.bytes > biggest[1]) biggest = [letter, w.bytes];
    if (w.bytes > SHARD_WARN_BYTES) log(`! cards-${letter}.json is ${kb(w.bytes)}`);
  }
  // A letter no card is filed under any more must not keep serving last week's rows.
  const stale = readdirSync(dir).filter(f => /^cards-.+\.json$/.test(f) && !(f.slice(6, -5) in shards));
  for (const f of stale) unlinkSync(resolve(dir, f));

  const summary = langSummary(rows, shards);
  const cats = Object.fromEntries(['P', 'T', 'E'].map(k => [k, rows.filter(r => r[3] === k).length]));
  const noScan = rows.filter(r => r[4] === 0).length;
  log(`${summary.cards} cards in ${summary.sets} sets (P ${cats.P}, T ${cats.T}, E ${cats.E}; ${noScan} with no scan); ` +
    `${summary.shards.length} shards, ${kb(total)}, largest cards-${biggest[0]}.json ${kb(biggest[1])}; ` +
    `${changed} written, ${summary.shards.length - changed} unchanged${stale.length ? `, ${stale.length} removed` : ''}`);
  return summary;
}

async function main() {
  const langs = ONLY.length ? CATALOG_LANGS.filter(l => ONLY.includes(l.code)) : CATALOG_LANGS;
  const unknown = ONLY.filter(c => !CATALOG_LANGS.some(l => l.code === c));
  if (unknown.length) throw new Error(`unknown language(s): ${unknown.join(', ')} (use: ${CATALOG_LANGS.map(l => l.code).join(', ')})`);

  mkdirSync(OUT, { recursive: true });
  const indexPath = resolve(OUT, 'index.json');
  const prevIndex = readJson(indexPath);
  const sets = readJson(resolve(ROOT, 'data', 'sets.json'));
  const knownSets = new Set(Object.keys(sets?.setSeries || {}));
  const builtAt = new Date().toISOString();
  console.log(`[build-catalog] TCGdex card lists for ${langs.map(l => l.code).join(', ')}`);

  // Languages not rebuilt this run (failed, or not asked for) keep what the index said,
  // as long as their files are still there.
  const out = {};
  for (const [code, s] of Object.entries(prevIndex?.langs || {})) {
    if (existsSync(resolve(OUT, code))) out[code] = s;
  }
  const failed = [];
  for (const lang of langs) {
    try {
      out[lang.code] = await buildLang(lang, prevIndex?.langs?.[lang.code], builtAt, knownSets);
    } catch (e) {
      failed.push(lang.code);
      console.warn(`[build-catalog]   ${lang.code}: FAILED, committed files kept — ${e.message}`);
    }
  }

  if (!Object.keys(out).length) throw new Error('no language has a catalogue; nothing written');
  const w = writeStamped(indexPath, indexFile(out), builtAt);
  const cards = Object.values(out).reduce((n, s) => n + s.cards, 0);
  console.log(`[build-catalog] ${w.changed ? 'wrote' : 'unchanged'} data/cat/index.json ` +
    `(${Object.keys(out).length} languages, ${cards} cards)`);
  if (failed.length) {
    console.error(`[build-catalog] ${failed.length} language(s) failed: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('[build-catalog] FAILED:', err.message);
  process.exit(1);
});
