// =============================================================================
// api/catalog.js — TCGdex's card catalogue (data/cat/, tools/build-catalog.mjs), loaded
// for the router. The reading rules are in catalog-model.js.
//
// Every answer is null when the catalogue cannot give a whole one: no index, no list for
// that language, or a shard that failed to load. The router then goes on to the
// per-Pokémon shards and live TCGdex, exactly as before the catalogue existed.
// =============================================================================

import {
  readCatalogIndex, readCatalogShard, shardLettersFor, matchCatalog, catalogSetCards,
} from './catalog-model.js';

const CAT_BASE = new URL('../../data/cat/', import.meta.url);

// Session memo of promises, like jp-source.js: concurrent reads share one request, and a
// missing catalogue is asked for once. clearCache() reloads the page, which empties it.
const memo = new Map();
function load(file) {
  if (!memo.has(file)) {
    memo.set(file, fetch(new URL(file, CAT_BASE), { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null));
  }
  return memo.get(file);
}

/** The catalogue's index, or null when there is none. */
export async function catalogIndex() {
  return readCatalogIndex(await load('index.json'));
}

/** letter → rows for `letters` of language `code`; null if any of them failed. */
async function loadShards(code, letters) {
  const got = await Promise.all(letters.map(async l => [l, readCatalogShard(await load(`${code}/cards-${l}.json`))]));
  return got.every(([, rows]) => rows) ? new Map(got) : null;
}

/**
 * The English cards of every Pokémon in `names`.
 * @returns {Promise<{cards:Array, empty:string[], builtAt:string}|null>}
 */
export async function getCatalogCards(names, { setSeries = null } = {}) {
  const idx = await catalogIndex();
  const en = idx?.langs.en;
  if (!en) return null;
  const shards = await loadShards('en', shardLettersFor(names, en.shards));
  if (!shards) return null;
  return { ...matchCatalog(shards, names, { setSeries }), builtAt: idx.builtAt };
}

/**
 * Every card of one set in language `code` (LANGUAGES code). Loads all of that
 * language's shards, so the router asks only when TCGdex's own one-request answer
 * failed. null when the catalogue has no card of that set.
 */
export async function getCatalogSetCards(setId, { code = 'en', setSeries = null } = {}) {
  const idx = await catalogIndex();
  const lang = idx?.langs[code];
  if (!lang) return null;
  const shards = await loadShards(code, lang.shards);
  if (!shards) return null;
  const cards = catalogSetCards(shards.values(), setId, { setSeries, code });
  return cards.length ? cards : null;
}
