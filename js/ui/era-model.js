// =============================================================================
// ui/era-model.js — Master Set's era headings, DOM-free.
//
// Same split as filter-pass.js / setnav-index.js / setmode-model.js etc.
//
// renderBySet puts one .era-label above each TCGdex SERIES. The group key doubles as
// that label's data-series, which fetchAndInjectJPCards looks up with jpEra's ids
// (api/jp-model.js) — so it must stay a series id, never a display name.
// =============================================================================

import { ERA_MAP, OTHER_SERIES_ID, OTHER_SERIES_NAME } from '../config.js';

/**
 * data/sets.json's per-language `series` lists → { seriesId: English name }.
 * The page is in English, so only `en` is read.
 * @param {Object<string,Array<{id:string,name:string}>>} [series]
 */
export function seriesNames(series) {
  const out = {};
  for (const s of series?.en || []) if (s?.id && s.name) out[s.id] = s.name;
  return out;
}

/**
 * The series a set is grouped under.
 *
 * sets.json's `setSeries` first. The CDN segment parsed from a card's image URL is
 * TCGdex's own series only when TCGdex lists the card WITH art; for a card listed
 * without it, the URL is rebuilt from the id (providers/tcgdex.js imageBaseFromId) and
 * the segment is a guess that is wrong for most promo and special sets — cel25 → "cel",
 * 2024sv → "2024sv", tk-sm-r → "tk-sm-r" — each of which became its own era.
 *
 * A key that nothing can name goes to the one "Other sets" group, so no heading ever
 * shows a raw id.
 *
 * @param {string} setId TCGdex set id
 * @param {string} cdnSeries the series the card data carried (image URL segment)
 * @param {Object<string,string>} [setSeries] sets.json's setSeries map
 * @param {Object<string,string>} [names] seriesNames()
 */
export function eraKey(setId, cdnSeries, setSeries = {}, names = {}) {
  const id = setSeries[setId] || cdnSeries;
  return id && (ERA_MAP[id] || names[id]) ? id : OTHER_SERIES_ID;
}

/**
 * The heading text for an era key: the curated ERA_MAP name for the main eras, else
 * TCGdex's own series name (McDonald's Collection, Trainer kits, POP…).
 * @param {string} id eraKey()
 * @param {Object<string,string>} [names] seriesNames()
 */
export function eraLabel(id, names = {}) {
  return ERA_MAP[id] || names[id] || OTHER_SERIES_NAME;
}
