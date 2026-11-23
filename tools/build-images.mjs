#!/usr/bin/env node
// =============================================================================
// tools/build-images.mjs — fill the Japanese image gap into img/ + data/img-index.json.
//
// WHAT IT FETCHES: only cards with NO image anywhere else — a Japanese card whose set
// Limitless has no scans for. Everything else already has art from TCGdex or Limitless
// and is left alone.
//
// WHERE THE CARD LIST COMES FROM: the local build-side catalogue (data/jp-catalog/,
// written by tools/build-jp-catalog.mjs — run that first). It covers every Japanese set,
// and each card's PokéWallet id is already in it, so this costs image requests only,
// nothing to search. Keys come from jp-model.assignJpKeys over the same cleaned rows the
// app's files were written from (twins dropped, published keys kept), so file names match
// tile ids.
// WHICH POKÉMON: the pre-built list (data/index.json) by default; --pokemon "A,B" for
// others; --all for every gap card in the catalogue (≈10,700, one request each at the
// default size, so pass a --max to match the hour's quota).
//
// WHICH SIZES: `low` (200×280, ~13 KB) only, by default — what is published. The preview
// falls back to it (local-images.lookupImage). --sizes low,high adds the 500×699 scan,
// which would take the whole set past a gigabyte.
//
// HOW (see js/api/local-images.js for the layout and the manifest):
//   1. Work out which gap cards are missing a file, from the manifest. None → 0 requests.
//   2. Download the missing sizes. A file that exists is never re-fetched or overwritten:
//      images are immutable, so history only grows when cards are new. A 404 (PokéWallet
//      lists the card but has no scan) is recorded as `unavailable` and not asked again;
//      so is a `low` image that comes back larger than low-res (pokewallet.LOW_MAX_PIXELS).
//   3. Write the manifest (local-images.serializeIndex: sorted, one entry per line, and
//      without PokéWallet's card ids, which stay in the gitignored catalogue).
// Stops cleanly at the request cap or when the live quota (read from PokéWallet's
// response headers) is down to the reserve; the next run carries on where it stopped.
//
// PUBLISHED: img/ and data/img-index.json are committed and served by GitHub Pages, with
// PokéWallet credited in the site footer. Every manifest entry names its `source`, so
// their images can be withdrawn in one pass — see README "Hosted card images".
//
// The key (POKEWALLET_IO_PROD_KEY, .env.local or the environment) is never logged or
// written: the client never records headers. With no key, this exits 0 and does nothing.
//
// Run: node tools/build-images.mjs [--dry-run] [--max N] [--sizes low,high] [--pokemon "A,B" | --all]
// =============================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvKey } from './lib/env-key.mjs';
import { createClient, extFor, oversizeForLow } from './lib/pokewallet.mjs';
import { cleanTuple, dropTwinSets, japaneseOnly } from './lib/jp-catalog.mjs';
import { imagePath, emptyIndex, serializeIndex, sizesToFetch, IMAGE_SIZES } from '../js/api/local-images.js';
import { assignJpKeys, jpImageKeyFor } from '../js/api/jp-model.js';
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
const SIZES = (argOf('--sizes') || 'low').split(',').map(s => s.trim()).filter(Boolean);
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
  writeFileSync(INDEX_FILE, serializeIndex(idx, new Date().toISOString()));
}

/** Sizes still to download for `key` (local-images.sizesToFetch, against the disk). */
function missingSizes(idx, key) {
  return sizesToFetch(idx.images[key], SIZES, (s, ext) => existsSync(resolve(ROOT, imagePath(key, s, ext))));
}

function pokemonList() {
  const explicit = argOf('--pokemon');
  if (explicit) return explicit.split(',').map(s => s.trim()).filter(Boolean);
  const index = resolve(ROOT, 'data/index.json');
  return existsSync(index) ? Object.keys(readJSON(index).pokemon || {}) : [];
}

/** Gap cards from the catalogue: [{key, ref, label}] — refs known, nothing to search. */
function planFromCatalogue(names) {
  // The same clean-up, Japanese-only filter, twin filter and published keys as the app's
  // files (build-jp-catalog writeAppFiles), so the keys — and therefore the file names —
  // come out identical, and a set left out as a twin gets no images either.
  let prior = [];
  try { prior = readJSON(resolve(ROOT, 'data/jp-cat/sets.json')).sets || []; } catch { /* none published yet */ }
  const jp = japaneseOnly(readJSON(resolve(CAT_DIR, 'sets.json')).sets,
    readJSON(resolve(CAT_DIR, 'cards.json')).cards.map(cleanTuple));
  const { sets, cards } = dropTwinSets(jp.sets, jp.cards, prior);
  const { setKeys, numKeys } = assignJpKeys(sets, cards, prior);
  const out = [];
  cards.forEach((c, i) => {
    if (c[3] || sets[c[0]].limitless) return;                  // a print, or Limitless has the set
    if (!all && !names.some(n => namesSpecies(c[2], n))) return;
    out.push({ key: jpImageKeyFor(setKeys[c[0]], numKeys[i]), ref: c[5], label: `${sets[c[0]].name} ${c[1] || c[2]}` });
  });
  return out;
}

async function main() {
  if (!existsSync(resolve(CAT_DIR, 'cards.json'))) {
    say('no catalogue in data/jp-catalog/ — run node tools/build-jp-catalog.mjs first.');
    return;
  }
  const bad = SIZES.filter(s => !IMAGE_SIZES.includes(s));
  if (bad.length || !SIZES.length) throw new Error(`--sizes takes ${IMAGE_SIZES.join(',')}; got "${argOf('--sizes')}"`);
  const idx = readIndex();
  // A manifest written before serializeIndex still holds PokéWallet's card ids: rewrite
  // it even when this run fetches nothing, so they never reach a commit.
  const stale = Object.values(idx.images).some(e => 'ref' in e);
  if (stale && !dryRun) { writeIndex(idx); say('rewrote data/img-index.json without source card ids.'); }
  const names = pokemonList();
  const gap = planFromCatalogue(names);
  const todo = gap.filter(g => missingSizes(idx, g.key).length);
  const scope = all ? 'every Pokémon' : names.join(', ') || '(no Pokémon)';
  say(`scope: ${scope}.`);
  say(`${gap.length} gap card(s) with no other image source, ${todo.length} still need files `
    + `(≈${todo.reduce((n, g) => n + missingSizes(idx, g.key).length, 0)} image requests).`);
  if (!todo.length) { say('nothing to fetch.'); return; }
  if (dryRun) { say('dry run: nothing downloaded.'); return; }

  const key = loadEnvKey(KEY_NAME);
  if (!key) { say(`no ${KEY_NAME} configured — skipping (set it in .env.local).`); return; }

  const client = createClient(key, { maxRequests, log: m => say(`  ${m}`) });
  let files = 0, bytes = 0, noScan = 0, tooBig = 0, stoppedWhy = null, changed = false;
  try {
    for (const g of todo) {
      if (!g.ref) continue;
      const entry = idx.images[g.key] || { sizes: {} };
      for (const size of missingSizes(idx, g.key)) {
        let unavailable = (idx.images[g.key]?.unavailable || []).filter(s => s !== size);
        try {
          const { buf, contentType } = await client.call(`/images/${encodeURIComponent(g.ref)}?size=${size}`, { binary: true });
          const big = size === 'low' && oversizeForLow(buf);
          if (big) {
            // Only low-res scans are published. A few cards come back at up to 1024 px for
            // size=low; those are not saved, and not asked for again.
            say(`    ${big.width}×${big.height} is larger than low-res, not published: ${g.label}`);
            unavailable = [...unavailable, size];
            tooBig++;
          } else {
            const ext = extFor(contentType, buf);
            const file = resolve(ROOT, imagePath(g.key, size, ext));
            mkdirSync(dirname(file), { recursive: true });
            if (!existsSync(file)) { writeFileSync(file, buf); files++; bytes += buf.length; }
            entry.sizes = { ...entry.sizes, [size]: ext };
          }
        } catch (e) {
          // 404 "Image not available": PokéWallet lists the card but has no scan of it
          // (2026-11-16). Skip it, and remember that, so no later run pays for it again.
          if (e.status !== 404) throw e;
          unavailable = [...unavailable, size];
          noScan++;
        }
        // Recorded per size, so a run stopped between low and high keeps what it fetched.
        idx.images[g.key] = { sizes: entry.sizes, source: 'pokewallet', fetched: new Date().toISOString().slice(0, 10), unavailable };
        changed = true;
      }
    }
  } catch (e) {
    if (e.code !== 'BUDGET' && e.code !== 'NETWORK' && !e.status) throw e;
    stoppedWhy = e.message;
  } finally {
    if (!dryRun && changed) writeIndex(idx);
    const q = client.quota;
    say(`${files} file(s), ${Math.round(bytes / 1024)} KB, ${client.spent} request(s)`
      + (noScan ? `, ${noScan} with no scan at PokéWallet (skipped from now on)` : '')
      + (tooBig ? `, ${tooBig} larger than low-res (not published)` : '') + '.'
      + (q.hour != null ? ` Quota left: ${q.hour}/${q.limitHour} this hour, ${q.day}/${q.limitDay} today.` : ''));
    if (stoppedWhy) say(`stopped early (${stoppedWhy}) — run again later to continue.`);
  }
}

main().catch(err => {
  console.error('[build-images] FAILED:', err.message);
  process.exit(1);
});
