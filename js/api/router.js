// =============================================================================
// api/router.js — provider failover per the rebuild brief's ROUTING TABLE.
//
//   Master card index   : TCGdex EN   → fallback legacy (Bulbapedia + pokemontcg.io)
//   Set names/dates/syms : TCGdex      → fallback legacy (names only)
//   JA cards/images      : legacy only (handled directly by masterset's JP path)
//
// Behaviour (per brief):
//   • try primary with an ~8s timeout (AbortController);
//   • on timeout / HTTP error / empty result → fall back + caller shows a
//     non-blocking "using backup data source" banner;
//   • remember per-source health for the SESSION so we don't re-timeout on every
//     call; a forced refresh resets health to re-attempt the primary;
//   • report the source used so the caller can tag the cache and re-try later.
// =============================================================================

import { tcgdex } from './providers/tcgdex.js';
import { snapshot } from './providers/snapshot.js';
import * as legacy from './providers/legacy.js';
import * as bulbaJp from './bulba-jp.js';
import { mergeCardSets, mergeSource } from './merge.js';

const TIMEOUT_MS = 8000;

// Session health for the primary (TCGdex). Once it fails, later calls in the
// same session skip straight to the fallback until a forced refresh resets it.
let primaryHealthy = true;
export function resetHealth() { primaryHealthy = true; }

// Run an abortable async op with a hard timeout. `factory` receives the signal.
function withTimeout(factory) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return Promise.resolve(factory(ctrl.signal)).finally(() => clearTimeout(timer));
}

/**
 * Master card index for the given Pokémon names.
 * Order: pre-built snapshot (instant, no API) → live TCGdex → legacy fallback.
 * A forced refresh skips the snapshot to fetch live.
 * @returns {Promise<{cards:Array, source:'snapshot'|'tcgdex'|'legacy'}>}
 */
/** The live half of the chain: TCGdex (8s timeout) → legacy. Factored out so a PARTIAL
 *  snapshot hit can run it for just the uncovered names. */
async function liveCards(names) {
  if (primaryHealthy) {
    try {
      const cards = await withTimeout(signal => tcgdex.getCards(names, { signal }));
      if (cards && cards.length) return { cards, source: 'tcgdex' };
      throw new Error('empty result');
    } catch (err) {
      console.warn('[router] TCGdex card index unavailable → legacy fallback:', err.message);
      primaryHealthy = false;
    }
  }
  // fetchEnCards takes no argument — it serves the whole configured list, which is a
  // superset of `names`. mergeCardSets dedups, so that is harmless.
  const cards = await legacy.fetchEnCards();   // throws only if every legacy source fails too
  return { cards, source: 'legacy' };
}

export async function getCards(names, { forceRefresh = false } = {}) {
  if (forceRefresh) primaryHealthy = true;
  if (!forceRefresh) {
    try {
      const hit = await snapshot.getCardsPartial(names);
      if (hit.cards.length && !hit.missing.length) return { cards: hit.cards, source: 'snapshot' };
      if (hit.cards.length) {
        // Partial: the whole point of sharding — fetch ONLY what the snapshot lacks.
        const live = await liveCards(hit.missing);
        return {
          cards: mergeCardSets(names, [hit.cards, live.cards]),
          source: mergeSource(['snapshot', live.source]),
        };
      }
    } catch (e) { /* snapshot miss/absent → go live */ }
  }
  return liveCards(names);
}

/**
 * Set metadata (localized names + EN release dates + EN symbols).
 * Order: snapshot → live TCGdex → legacy (names only).
 * @returns {Promise<{names:Object, dates:Object, symbols:Object, source:'snapshot'|'tcgdex'|'legacy'}>}
 */
export async function getSetMeta({ forceRefresh = false, setIds = [] } = {}) {
  if (forceRefresh) primaryHealthy = true;
  if (!forceRefresh) {
    try {
      const meta = await snapshot.getSetMeta(setIds);
      return { ...setMetaShape(meta), source: 'snapshot' };
    } catch (e) { /* snapshot miss/absent → go live */ }
  }
  if (primaryHealthy) {
    try {
      // withSeries:false — the series sweep is ~116 extra requests and only the BUILD
      // needs it. A browser that has fallen through to live set meta is already paying
      // for nine /sets sweeps; the picker degrades to one ungrouped list rather than
      // tripling that.
      const meta = await withTimeout(signal => tcgdex.getSetMeta({ signal, setIds, withSeries: false }));
      return { ...setMetaShape(meta), source: 'tcgdex' };
    } catch (err) {
      console.warn('[router] TCGdex set meta unavailable → legacy fallback:', err.message);
      primaryHealthy = false;
    }
  }
  // legacy.fetchAllSetNames is itself TCGdex-backed but carries no dates/art/counts.
  const names = await legacy.fetchAllSetNames();
  return { ...setMetaShape({ names }), source: 'legacy' };
}

/**
 * One shape for all three branches, so a consumer never has to ask which one answered.
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
 * Every card in one set (single-set mode).
 * Order: snapshot shard → live TCGdex. NO legacy fallback: the legacy sources are
 * indexed by Pokémon, so neither of them can answer "what is in this set" at all —
 * a fallback that cannot serve the request is worse than a clean failure.
 * @returns {Promise<{cards:Array, set:Object, source:'snapshot'|'tcgdex'}>}
 */
export async function getSetCards(setId, { forceRefresh = false, lang = 'en' } = {}) {
  if (forceRefresh) primaryHealthy = true;
  // Shards are EN-only. Consulting one for a zh-Hant set id cannot hit today (the id
  // namespaces are disjoint), but it would be an EN answer to a non-EN question the
  // moment per-language shards ship, which is exactly the bug that is hard to see.
  if (!forceRefresh && lang === 'en') {
    try {
      const hit = await snapshot.getSetCards(setId);
      return { ...hit, source: 'snapshot' };
    } catch (e) { /* no shard for this set → go live */ }
  }
  const live = await withTimeout(signal => tcgdex.getSetCards(setId, { signal, lang }));
  return { ...live, source: 'tcgdex' };
}

/**
 * Raw Bulbapedia JP entries [{jpset, jpnum, pokemonName}] for the given Pokémon.
 * Order: pre-built snapshot (data/jp.json) → live Bulbapedia. A forced refresh skips
 * the snapshot. JP has no further fallback (TCGdex JA is unusable).
 */
export async function getJpRaw(names, { forceRefresh = false } = {}) {
  if (!forceRefresh) {
    try {
      const hit = await snapshot.getJpRawPartial(names);
      if (!hit.missing.length) return hit.data;
      // Easier to split than the card index: JP rows are per-Pokémon with no
      // cross-set metadata, and fetchJpRaw already fetches per name.
      const live = await bulbaJp.fetchJpRaw(hit.missing);
      return [...hit.data, ...live];
    } catch (e) { /* snapshot miss/absent → live Bulbapedia */ }
  }
  return bulbaJp.fetchJpRaw(names);
}

export const router = { getCards, getSetCards, getSetMeta, getJpRaw, resetHealth, mergeCardSets, mergeSource };
