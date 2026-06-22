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
export async function getCards(names, { forceRefresh = false } = {}) {
  if (forceRefresh) primaryHealthy = true;
  if (!forceRefresh) {
    try {
      const cards = await snapshot.getCards(names);
      if (cards && cards.length) return { cards, source: 'snapshot' };
    } catch (e) { /* snapshot miss/absent → go live */ }
  }
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
  const cards = await legacy.fetchEnCards();   // throws only if every legacy source fails too
  return { cards, source: 'legacy' };
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
      const meta = await snapshot.getSetMeta();
      return { names: meta.names, dates: meta.dates, symbols: meta.symbols, source: 'snapshot' };
    } catch (e) { /* snapshot miss/absent → go live */ }
  }
  if (primaryHealthy) {
    try {
      const meta = await withTimeout(signal => tcgdex.getSetMeta({ signal, setIds }));
      return { names: meta.names, dates: meta.dates, symbols: meta.symbols, source: 'tcgdex' };
    } catch (err) {
      console.warn('[router] TCGdex set meta unavailable → legacy fallback:', err.message);
      primaryHealthy = false;
    }
  }
  // legacy.fetchAllSetNames is itself TCGdex-backed but carries no dates/symbols.
  const names = await legacy.fetchAllSetNames();
  return { names, dates: {}, symbols: {}, source: 'legacy' };
}

/**
 * Raw Bulbapedia JP entries [{jpset, jpnum, pokemonName}] for the given Pokémon.
 * Order: pre-built snapshot (data/jp.json) → live Bulbapedia. A forced refresh skips
 * the snapshot. JP has no further fallback (TCGdex JA is unusable).
 */
export async function getJpRaw(names, { forceRefresh = false } = {}) {
  if (!forceRefresh) {
    try {
      const data = await snapshot.getJpRaw(names);
      if (data) return data;
    } catch (e) { /* snapshot miss/absent → live Bulbapedia */ }
  }
  return bulbaJp.fetchJpRaw(names);
}

export const router = { getCards, getSetMeta, getJpRaw, resetHealth };
