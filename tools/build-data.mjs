#!/usr/bin/env node
// =============================================================================
// tools/build-data.mjs — pre-build the static data snapshots the app serves.
//
// Pulls the EN master card index + set metadata from TCGdex for a Pokémon list
// and writes data/cards.json + data/sets.json (+ data/jp.json from Bulbapedia).
// The app reads these first (instant, no rate limits, any number of users) and
// only hits the live API as a fallback or on a user-triggered refresh.
//
// It imports the SAME tcgdex provider the browser uses, so the snapshot shape can
// never drift from the live shape. Requires Node 18+ (global fetch).
// Run: `node tools/build-data.mjs` (or `npm run build-data`) — builds DEFAULT_POKEMON.
// Pass a comma-separated list to build a different snapshot instead, e.g.:
//   node tools/build-data.mjs "Pikachu,Eevee"
// CI runs the no-arg (default) form weekly.
//
// NOTE: cannot run in an offline sandbox — needs network access to api.tcgdex.net.
// =============================================================================

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DEFAULT_POKEMON, SCHEMA_VERSION } from '../js/config.js';
import { getCards, getSetMeta } from '../js/api/providers/tcgdex.js';
import { fetchJpRaw } from '../js/api/bulba-jp.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = resolve(ROOT, 'data');

// Optional CLI arg: a comma-separated Pokémon list, e.g. "Pikachu,Eevee".
// Falls back to DEFAULT_POKEMON (the demo list) when omitted.
const POKEMON = process.argv[2]
  ? process.argv[2].split(',').map(s => s.trim()).filter(Boolean)
  : [...DEFAULT_POKEMON];

async function main() {
  console.log(`[build-data] Pokémon: ${POKEMON.join(', ')}`);

  console.log('[build-data] fetching card index from TCGdex…');
  const cards = await getCards(POKEMON);
  console.log(`[build-data]   → ${cards.length} cards`);

  console.log('[build-data] fetching set metadata from TCGdex…');
  const setIds = [...new Set(cards.map(c => (typeof c.id === 'string' && c.id.includes('-')) ? c.id.slice(0, c.id.lastIndexOf('-')) : null).filter(Boolean))];
  const meta = await getSetMeta({ setIds });
  const langCount = Object.keys(meta.names || {}).length;
  const setCount = Object.keys(meta.dates || {}).length;
  console.log(`[build-data]   → ${langCount} languages, ${setCount} EN set dates`);

  const builtAt = new Date().toISOString();
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(
    resolve(DATA_DIR, 'cards.json'),
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, builtAt, pokemon: POKEMON, cards }),
  );
  writeFileSync(
    resolve(DATA_DIR, 'sets.json'),
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, builtAt, names: meta.names, dates: meta.dates, symbols: meta.symbols }),
  );

  console.log('[build-data] fetching Japanese cards from Bulbapedia…');
  const jpCardsData = await fetchJpRaw(POKEMON);
  console.log(`[build-data]   → ${jpCardsData.length} JP entries`);
  writeFileSync(
    resolve(DATA_DIR, 'jp.json'),
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, builtAt, pokemon: POKEMON, jpCardsData }),
  );
  console.log(`[build-data] wrote data/cards.json + data/sets.json + data/jp.json @ ${builtAt}`);
}

main().catch((err) => {
  console.error('[build-data] FAILED:', err);
  process.exit(1);
});
