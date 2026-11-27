// =============================================================================
// api/router.js — provider failover.
//
//   Master card index    : catalogue (data/cat/) → snapshot shards → TCGdex EN, each
//                          matching cards by name or Pokédex number (match-model.js).
//                          Print variants: snapshot shards, then TCGdex GraphQL.
//   Set names/dates/syms : snapshot → TCGdex
//   Set cards (one set)  : TCGdex → catalogue
//   JA raw rows          : snapshot shards → live Bulbapedia. The app reads Japanese
//                          cards through api/jp-source.js, which tries the PokéWallet
//                          catalogue first and only then comes here.
//   Overrides            : data/overrides.json (cards no source lists) is merged into
//                          both card lists last, whichever source answered; then
//                          data/print-overrides.json (prints no source lists, such as
//                          Jumbo prints) joins the cards' print lists.
//
// Behaviour:
//   • try primary with an ~8s timeout (AbortController);
//   • on timeout / HTTP error / empty result → fall back where a fallback exists,
//     otherwise throw so the caller shows its failure banner with Retry;
//   • remember per-source health for the SESSION so we don't re-timeout on every
//     call; a forced refresh resets health to re-attempt the primary;
//   • report the source used so the caller can tag the cache and re-try later.
// =============================================================================

import { tcgdex } from './providers/tcgdex.js';
import { snapshot } from './providers/snapshot.js';
import { getCatalogCards, getCatalogSetCards } from './catalog.js';
import { catalogSetInfo } from './catalog-model.js';
import * as bulbaJp from './bulba-jp.js';
import { mergeCardSets, mergeSource } from './merge.js';
import { loadSpecies } from './species.js';
import { dexByNameFrom } from './match-model.js';
import { loadOverrides } from './overrides.js';
import { overrideCards, overrideSetCards, mergeSetCards } from './overrides-model.js';
import { loadPrintOverrides } from './print-overrides.js';
import { withPrintOverrides } from './print-overrides-model.js';
import { LANGUAGES, POKEMON_CATALOG } from '../config.js';

const TIMEOUT_MS = 8000;

// Pokémon name → National Dex number, for matching cards by number (match-model.js):
// data/species.json, else the built-in catalogue. Read once a session; never rejects.
// Exported for jp-source.js, which matches Japanese overrides by the same rule.
let dexMemo = null;
export function dexByName() {
  dexMemo ||= loadSpecies()
    .then(sp => dexByNameFrom(sp?.catalog || POKEMON_CATALOG))
    .catch(() => dexByNameFrom(POKEMON_CATALOG));
  return dexMemo;
}

// Session health for the primary (TCGdex). Once it fails, later calls in the
// same session skip straight to the fallback (or, for cards, straight to failing)
// until a forced refresh resets it.
let primaryHealthy = true;
export function resetHealth() { primaryHealthy = true; }

// Run an abortable async op with a hard timeout. `factory` receives the signal.
function withTimeout(factory) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return Promise.resolve(factory(ctrl.signal)).finally(() => clearTimeout(timer));
}

/** The live half of the chain: TCGdex (8s timeout), and nothing after it. Factored out
 *  so a PARTIAL snapshot hit can run it for just the uncovered names. */
async function liveCards(names) {
  if (!primaryHealthy) throw new Error('TCGdex unavailable this session');
  // The snapshot's series map, for the image URL of a card TCGdex lists without one.
  // sets.json is memoised and read for set meta straight after anyway.
  const { setSeries } = await snapshot.getSeries();
  const dex = await dexByName();
  try {
    const cards = await withTimeout(signal => tcgdex.getCards(names, { signal, setSeries, dexByName: dex }));
    if (cards && cards.length) return { cards, source: 'tcgdex' };
    throw new Error('empty result');
  } catch (err) {
    console.warn('[router] TCGdex card index unavailable:', err.message);
    primaryHealthy = false;
    throw err;
  }
}

/**
 * The catalogue's answer for `names` (data/cat/: every English card, any Pokémon), with
 * print variants added — from the per-Pokémon shards where a Pokémon is pre-built, from
 * TCGdex GraphQL for the rest. The variants are best effort: a slow or failed answer
 * costs the badges, never the list. null when there is no catalogue, or it has no card
 * of any of these Pokémon; the caller then goes on as if it did not exist.
 */
async function catalogueCards(names) {
  const { setSeries } = await snapshot.getSeries();
  const dex = await dexByName();
  const cat = await getCatalogCards(names, { setSeries, dexByName: dex }).catch(() => null);
  if (!cat?.cards.length) return null;

  let shardHit = null;
  try { shardHit = await snapshot.getCardsPartial(names); } catch { /* none pre-built */ }
  const prebuilt = new Map((shardHit?.cards || []).map(c => [c.id, c]));
  for (const c of cat.cards) {
    const v = prebuilt.get(c.id)?.variants;
    if (v) c.variants = v;
  }
  // A pre-built card the catalogue lacks (the two are built in the same run, so rarely)
  // is kept: never a shorter list than the shards alone would give.
  const cards = shardHit ? mergeCardSets(names, [cat.cards, shardHit.cards]) : cat.cards;

  const covered = new Set(shardHit?.covered || []);
  const liveNames = names.filter(n => !covered.has(n) && !cat.empty.includes(n));
  if (liveNames.length && primaryHealthy) {
    const want = new Set(liveNames);
    const need = cards.filter(c => !c.variants && want.has(c.species));
    await withTimeout(signal => tcgdex.getVariants(need, liveNames, { signal, dexByName: dex })).catch(() => {});
  }
  return { cards, source: 'catalogue' };
}

/**
 * Master card index for the given Pokémon names.
 * Order: catalogue (data/cat/) → pre-built snapshot shards → live TCGdex. The first two
 * are static files, so the common case makes no card-list request at all.
 * A forced refresh skips both to fetch live: it is how a card TCGdex added after this
 * week's build shows up.
 *
 * `missing` is set only when a PARTIAL snapshot hit could not be completed live: the
 * snapshot's cards are served rather than thrown away, and the caller must neither
 * cache the result as complete nor stay silent about the names it lacks.
 * Whichever source answers, the English overrides (data/overrides.json) are merged in
 * last: a card a source lists keeps that source's entry. Then the English print
 * overrides (data/print-overrides.json) join the cards' print lists.
 * @returns {Promise<{cards:Array, source:'catalogue'|'snapshot'|'tcgdex', missing?:string[]}>}
 */
export async function getCards(names, opts = {}) {
  return withPrints(await withOverrides(names, await cardsFromSources(names, opts)), 'en');
}

// Prints no source lists (a Jumbo print of a card TCGdex has none for), added to the
// cards' `variants`; a card TCGdex already gives a print of that kind keeps its own.
async function withPrints(res, lang) {
  const rows = await loadPrintOverrides();
  if (!rows.length) return res;
  const cards = withPrintOverrides(res.cards, rows, lang);
  return cards === res.cards ? res : { ...res, cards };
}

async function withOverrides(names, res) {
  const rows = await loadOverrides();
  if (!rows.some(r => r.lang === 'en')) return res;
  const { setSeries } = await snapshot.getSeries();
  const extra = overrideCards(rows, names, { setSeries, dexByName: await dexByName() });
  return extra.length ? { ...res, cards: mergeCardSets(names, [res.cards, extra]) } : res;
}

async function cardsFromSources(names, { forceRefresh = false } = {}) {
  if (forceRefresh) primaryHealthy = true;
  if (!forceRefresh) {
    const cat = await catalogueCards(names);
    if (cat) return cat;
    let hit = null;
    try { hit = await snapshot.getCardsPartial(names); }
    catch (e) { /* snapshot miss/absent → go live */ }
    if (hit && hit.cards.length && !hit.missing.length) return { cards: hit.cards, source: 'snapshot' };
    if (hit && hit.cards.length) {
      // Partial: the whole point of sharding — fetch ONLY what the snapshot lacks.
      try {
        const live = await liveCards(hit.missing);
        return {
          cards: mergeCardSets(names, [hit.cards, live.cards]),
          source: mergeSource(['snapshot', live.source]),
        };
      } catch (err) {
        // With no fallback left behind TCGdex, failing here would discard the
        // snapshot's cards too and show an empty page for a mostly-covered list.
        return { cards: hit.cards, source: 'snapshot', missing: hit.missing };
      }
    }
  }
  return liveCards(names);
}

/**
 * Set metadata (localized names + EN release dates + EN symbols).
 * Order: snapshot → live TCGdex.
 *
 * Nothing sits behind TCGdex: tcgdex.getSetMeta catches every request on its own (and
 * the abort at the timeout), so when TCGdex is down it answers with empty maps rather
 * than throwing, and the grid falls back to set ids and the 1999 sort date.
 * @returns {Promise<{names:Object, dates:Object, symbols:Object, source:'snapshot'|'tcgdex'}>}
 */
export async function getSetMeta({ forceRefresh = false, setIds = [] } = {}) {
  if (!forceRefresh) {
    try {
      const meta = await snapshot.getSetMeta(setIds);
      return { ...setMetaShape(meta), source: 'snapshot' };
    } catch (e) { /* snapshot miss/absent → go live */ }
  }
  // withSeries:false — the series sweep is ~116 extra requests and only the BUILD needs
  // it. A browser that has fallen through to live set meta is already paying for one
  // /sets list per language, so the series data comes from the snapshot instead.
  const meta = await withTimeout(signal => tcgdex.getSetMeta({ signal, setIds, withSeries: false }));
  return { ...setMetaShape(await withSnapshotSeries(meta)), source: 'tcgdex' };
}

/**
 * Live set meta with the snapshot's series data filled in. Without it the Master Set
 * page has no series names for its era headings (ui/era-model.js) and the picker no
 * grouping — so a Refresh, which always goes live, would lose both for 24h of cache.
 * Live values win where both have one; a missing snapshot changes nothing.
 */
async function withSnapshotSeries(meta) {
  const snap = await snapshot.getSeries();
  const hasSeries = Object.keys(meta.series || {}).length > 0;
  return {
    ...meta,
    setSeries: { ...snap.setSeries, ...(meta.setSeries || {}) },
    series: hasSeries ? meta.series : snap.series,
  };
}

/**
 * One shape for both branches, so a consumer never has to ask which one answered.
 * Every optional map defaults to empty rather than undefined — callers index into these
 * directly, and `undefined[id]` throws where `{}[id]` is a clean miss.
 */
function setMetaShape(meta = {}) {
  return {
    names: meta.names || {},
    dates: meta.dates || {},
    symbols: meta.symbols || {},
    logos: meta.logos || {},
    counts: meta.counts || {},
    setSeries: meta.setSeries || {},
    series: meta.series || {},
    lang: meta.lang || {},
  };
}

/**
 * Every card in one set (single-set mode). Live TCGdex first: it is one request for the
 * set, with print variants, where the catalogue would load every shard of the language.
 * When TCGdex fails, the catalogue's list for that set, with the set's name, date and
 * count from the snapshot (no print variants: those only come live). The per-Pokémon
 * shards cannot answer "what is in this set" at all.
 * The set's overrides for that language (data/overrides.json) are added to either answer,
 * in number order; they never make a set out of nothing when both sources fail.
 * @returns {Promise<{cards:Array, set:Object, source:'tcgdex'|'catalogue'}>}
 */
export async function getSetCards(setId, { forceRefresh = false, lang = 'en' } = {}) {
  if (forceRefresh) primaryHealthy = true;
  let res;
  try {
    const live = await withTimeout(signal => tcgdex.getSetCards(setId, { signal, lang }));
    res = { ...live, source: 'tcgdex' };
  } catch (err) {
    const fromCat = await catalogueSetCards(setId, lang).catch(() => null);
    if (!fromCat) throw err;
    console.warn(`[router] TCGdex set ${setId} unavailable (${err.message}); using the catalogue`);
    res = fromCat;
  }
  const code = LANGUAGES.find(l => l.code === lang)?.code || 'en';
  const extra = overrideSetCards(await loadOverrides(), setId, code);
  return withPrints(extra.length ? { ...res, cards: mergeSetCards(res.cards, extra) } : res, code);
}

async function catalogueSetCards(setId, lang) {
  const def = LANGUAGES.find(l => l.code === lang);
  const code = def?.code || 'en';
  const meta = await snapshot.getSetMeta().catch(() => ({}));
  const setSeries = meta.setSeries || (await snapshot.getSeries()).setSeries;
  const cards = await getCatalogSetCards(setId, { code, setSeries });
  if (!cards) return null;
  return { cards, set: catalogSetInfo(setId, code, meta), source: 'catalogue' };
}

/**
 * Raw Bulbapedia JP entries [{jpset, jpnum, pokemonName}] for the given Pokémon.
 * Order: pre-built snapshot shards → live Bulbapedia for whatever they lack. JP has no
 * further fallback (TCGdex JA is unusable).
 */
export async function getJpRaw(names) {
  try {
    const hit = await snapshot.getJpRawPartial(names);
    if (!hit.missing.length) return hit.data;
    // Easier to split than the card index: JP rows are per-Pokémon with no
    // cross-set metadata, and fetchJpRaw already fetches per name.
    const live = await bulbaJp.fetchJpRaw(hit.missing);
    return [...hit.data, ...live];
  } catch (e) { /* snapshot miss/absent → live Bulbapedia */ }
  return bulbaJp.fetchJpRaw(names);
}

export const router = { getCards, getSetCards, getSetMeta, getJpRaw };
