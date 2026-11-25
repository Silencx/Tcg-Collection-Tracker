#!/usr/bin/env node
// =============================================================================
// tools/build-species.mjs — every Pokémon species, from PokéAPI, into data/species.json.
//
// The app's Pokémon catalogue (picker, first-run modal, True master set browser,
// dashboard "N of M") and the native names on placeholder tiles both come from this
// file; without it they fall back to POKEMON_CATALOG / NATIVE_NAMES in js/config.js.
//
// A one-off, not part of the weekly job: rerun it when a new generation (or a new
// species) is added. Keyless. Costs one list request plus one per species not yet in
// the local cache (tools/.cache/pokeapi/species/, gitignored), so the first run is
// ~1,026 requests and a rerun only fetches what is new.
//
//   node tools/build-species.mjs            # fetch what the cache lacks, write the file
//   node tools/build-species.mjs --refresh  # fetch every species again
//
// Only a COMPLETE list replaces the committed file: if any species fails to load or
// parse, nothing is written. An unchanged list is written back byte for byte.
// =============================================================================

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { pooledForEach } from '../js/api/providers/tcgdex.js';
import { stampBuiltAt } from './lib/built-at.mjs';
import { speciesRow, speciesFile, POKEAPI_LANGS } from './lib/species.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data', 'species.json');
const CACHE = resolve(ROOT, 'tools', '.cache', 'pokeapi', 'species');
const API = 'https://pokeapi.co/api/v2';
const CONCURRENCY = 4;
const REFRESH = process.argv.includes('--refresh');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url) {
  let last;
  for (const wait of [0, 2000, 10000]) {
    if (wait) await sleep(wait);
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' } });
      if (r.ok) return await r.json();
      last = new Error(`HTTP ${r.status} — ${url}`);
      if (r.status === 404) break;
    } catch (e) { last = e; }
  }
  throw last;
}

// Only what the build reads is cached: the full answer carries every flavour text in
// every language (~30 KB a species).
const slim = raw => ({ id: raw?.id, generation: raw?.generation, names: raw?.names });

async function loadSpecies(id) {
  const file = resolve(CACHE, `${id}.json`);
  if (!REFRESH && existsSync(file)) {
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch { /* refetch below */ }
  }
  const raw = slim(await getJSON(`${API}/pokemon-species/${id}/`));
  writeFileSync(file, JSON.stringify(raw));
  return raw;
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const list = await getJSON(`${API}/pokemon-species?limit=100000`);
  const ids = (list?.results || [])
    .map(r => Number(String(r?.url || '').match(/\/pokemon-species\/(\d+)\/?$/)?.[1]))
    .filter(n => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
  if (!ids.length) throw new Error('PokéAPI listed no species; nothing written');
  console.log(`[build-species] PokéAPI lists ${ids.length} species (count ${list.count})`);

  const rows = [], failed = [];
  let fetched = 0;
  await pooledForEach(ids, CONCURRENCY, async id => {
    const cached = !REFRESH && existsSync(resolve(CACHE, `${id}.json`));
    try {
      const row = speciesRow(await loadSpecies(id));
      if (!cached) fetched++;
      if (row) rows.push(row); else failed.push(`${id} (no dex, generation or English name)`);
    } catch (e) {
      failed.push(`${id} (${e.message})`);
    }
  });
  console.log(`[build-species]   → ${rows.length} species read, ${fetched} fetched, ${ids.length - fetched} from the cache`);
  if (failed.length) {
    throw new Error(`${failed.length} species failed, so data/species.json is left as it was: ` +
      failed.slice(0, 8).join(', '));
  }

  const body = speciesFile(rows);
  const dexes = body.species.map(s => s[0]);
  const gaps = dexes.filter((d, i) => d !== i + 1);
  if (gaps.length) console.warn(`[build-species]   ! dex numbers are not 1..${dexes.length}: ${gaps.slice(0, 5).join(', ')}`);
  const perGen = {};
  for (const [, gen] of body.species) perGen[gen] = (perGen[gen] || 0) + 1;
  console.log(`[build-species]   → per generation: ${Object.entries(perGen).map(([g, n]) => `${g}:${n}`).join(' ')}`);
  console.log(`[build-species]   → native names: ${Object.keys(POKEAPI_LANGS)
    .map(b => `${b}:${(body.native[b] || []).filter(Boolean).length}`).join(' ')}`);

  let prev = null;
  try { prev = JSON.parse(readFileSync(OUT, 'utf8')); } catch { /* first run */ }
  const out = stampBuiltAt(body, prev, new Date().toISOString());
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`[build-species] ${out === prev ? 'unchanged' : 'wrote'} data/species.json ` +
    `(${body.species.length} species, ${Math.round(Buffer.byteLength(JSON.stringify(out)) / 1024)} KB)`);
}

main().catch(err => {
  console.error('[build-species] FAILED:', err.message);
  process.exit(1);
});
