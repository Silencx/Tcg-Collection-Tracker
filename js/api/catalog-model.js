// =============================================================================
// api/catalog-model.js — reading TCGdex's card catalogue (data/cat/, built by
// tools/build-catalog.mjs). No DOM and no fetch: js/api/catalog.js loads the files.
//
//   data/cat/index.json            { builtAt, langs: { en: { cards, sets, shards:['0','a',…] } } }
//   data/cat/{lang}/cards-{l}.json { builtAt, lang, rows: [[set, number, name, category, 0?]] }
//
// A card is filed under the first letter of every word of its name (the data/jp-cat/
// rule, js/api/jp-model.js), so one Pokémon's cards are in one shard. The card id is
// `${set}-${number}`; the image address is rebuilt from data/sets.json's series map. A
// trailing 0 means TCGdex lists the card without a scan (card-image-model.js).
// Cards come out in the shapes providers/tcgdex.js emits (getCards for the master set,
// getSetCards for one set), so neither mode can tell which one answered.
// =============================================================================

import { speciesShardLetter } from './jp-model.js';
import { tcgdexAssetBase, tcgdexSerieSegment } from './images.js';
import { tcgdexCdnLang } from './card-image-model.js';
import { namesSpecies } from './providers/tcgdex.js';

const LETTER = /^[a-z0]$/;

// Digit runs compare as numbers ("2" before "10"). Hand-rolled rather than localeCompare,
// whose order depends on the ICU build; tools/lib/catalog.mjs sorts the files with it.
const chunks = s => String(s).match(/\d+|\D+/g) || [];
export function naturalCompare(a, b) {
  const x = chunks(a), y = chunks(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    const dx = /^\d/.test(x[i]), dy = /^\d/.test(y[i]);
    if (dx && dy && Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i]);
    return x[i] < y[i] ? -1 : 1;
  }
  return x.length - y.length || (a < b ? -1 : a > b ? 1 : 0);
}

/** data/cat/index.json → { builtAt, langs: { code: { cards, sets, shards } } }, or null. */
export function readCatalogIndex(json) {
  if (!json?.builtAt || !json.langs || typeof json.langs !== 'object') return null;
  const langs = {};
  for (const [code, s] of Object.entries(json.langs)) {
    const shards = Array.isArray(s?.shards) ? s.shards.filter(l => typeof l === 'string' && LETTER.test(l)) : [];
    if (shards.length) langs[code] = { cards: Number(s.cards) || 0, sets: Number(s.sets) || 0, shards };
  }
  return Object.keys(langs).length ? { builtAt: json.builtAt, langs } : null;
}

const isRow = r => Array.isArray(r) && r.length >= 3
  && typeof r[0] === 'string' && r[0] && typeof r[1] === 'string' && r[1]
  && typeof r[2] === 'string' && r[2];

/** One shard file → its rows (malformed rows dropped), or null when it is not a built shard. */
export function readCatalogShard(json) {
  if (!json?.builtAt || !Array.isArray(json.rows)) return null;
  return json.rows.filter(isRow);
}

/** Whether TCGdex has a scan for this row's card (no trailing 0). */
export const rowHasScan = row => row[4] !== 0;

/**
 * One row → a card in tcgdex.getCards' shape. `image` is always a base, scan or not, as
 * in getCards: the master set reads the card's set and era from it.
 * @param {string} [opts.cdnLang] TCGdex's CDN folder (zh-tw for the app's zh-Hant).
 */
export function catalogCard(row, { species = null, setSeries = null, cdnLang = 'en' } = {}) {
  const [set, localId, name] = row;
  return {
    id: `${set}-${localId}`,
    name,
    species: species || name,
    image: tcgdexAssetBase(cdnLang, tcgdexSerieSegment(set, setSeries), set, localId),
    localId,
  };
}

/** The shard letters `names` need, of those the language has. */
export function shardLettersFor(names, available) {
  const have = new Set(available || []);
  return [...new Set((names || []).map(speciesShardLetter))].filter(l => l && have.has(l));
}

/**
 * The cards of every Pokémon in `names`, from the shards loaded for them.
 * Same rules as tcgdex.getCards: whole-word name match (no Mewtwo for Mew), and a card
 * shared by two listed Pokémon goes to the first-listed one.
 * @param {Map<string, Array>} shards letter → rows
 * @returns {{ cards: Array, empty: string[] }} `empty`: names that matched no card
 */
export function matchCatalog(shards, names, { setSeries = null } = {}) {
  const cards = [], empty = [], seen = new Set();
  for (const name of names || []) {
    let found = 0;
    for (const row of shards.get(speciesShardLetter(name)) || []) {
      if (!namesSpecies(row[2], name)) continue;
      found++;
      const id = `${row[0]}-${row[1]}`;
      if (seen.has(id)) continue;
      seen.add(id);
      cards.push(catalogCard(row, { species: name, setSeries }));
    }
    if (!found) empty.push(name);
  }
  return { cards, empty };
}

/**
 * Every card of one set, in number order, in tcgdex.getSetCards' shape: a row filed under
 * several letters is listed once, `species` is the card's own name, and `image` is null
 * for a card TCGdex has no scan for, so single-set mode requests none.
 * @param {Iterable<Array>} shardList each shard's rows
 * @param {string} [opts.code] LANGUAGES code of the set's language
 */
export function catalogSetCards(shardList, setId, { setSeries = null, code = 'en' } = {}) {
  const cdnLang = tcgdexCdnLang(code);
  const byId = new Map();
  for (const rows of shardList) {
    for (const row of rows || []) {
      if (row[0] !== setId) continue;
      const id = `${row[0]}-${row[1]}`;
      if (!byId.has(id)) byId.set(id, row);
    }
  }
  return [...byId.values()]
    .sort((a, b) => naturalCompare(a[1], b[1]))
    .map(row => {
      const card = catalogCard(row, { setSeries, cdnLang: cdnLang || 'en' });
      if (!cdnLang || !rowHasScan(row)) card.image = null;
      return card;
    });
}

/**
 * The `set` object single-set mode reads, from data/sets.json (the snapshot), for when
 * the card list comes from the catalogue and TCGdex's own answer is not there.
 * @param {object} meta router.getSetMeta's shape
 * @param {string} code LANGUAGES code of the set's language
 */
export function catalogSetInfo(setId, code, meta = {}) {
  const over = meta.lang?.[code] || {};
  const serieId = meta.setSeries?.[setId] || tcgdexSerieSegment(setId);
  const serieName = (meta.series?.[code] || meta.series?.en || []).find(s => s.id === serieId)?.name || serieId;
  return {
    id: setId,
    name: meta.names?.[code]?.[setId] || meta.names?.en?.[setId] || setId,
    releaseDate: over.dates?.[setId] || meta.dates?.[setId] || null,
    symbol: meta.symbols?.[setId] || null,
    logo: meta.logos?.[setId] || null,
    serie: { id: serieId, name: serieName },
    count: over.counts?.[setId] || meta.counts?.[setId] || null,
    lang: code,
  };
}
