// =============================================================================
// state.js — ALL mutable application state in one place, plus its persistence.
//
// DESIGN: state lives on a single exported `state` OBJECT (not as separate
// `export let` bindings). ES modules export read-only live bindings, so a
// consumer module cannot do `activeLangs = new Set(...)` on an imported binding.
// The old tool reassigned these freely (checked, activeLangs, appMode, sortDesc,
// _bulbaData, …). Putting them on an object means every module can mutate via
// `state.activeLangs = …` and all modules see it. When porting old code, prefix
// the bare names with `state.` (checked → state.checked, etc.).
//
// All reads/writes to localStorage go through storage.js (quota-safe). Defaults
// and parse-failure fallbacks match the old tool exactly.
// =============================================================================

import * as storage from './storage.js';
import {
  CHKSTORE, POKESTORE, FILTERSTORE, BANNERSTORE, CACHESTORE, SORTSTORE,
  MODESTORE, TMSSTORE, TMSFILTERSTORE, TMSCACHESTORE,
  BADGE_ORDER, DEFAULT_POKEMON,
} from './config.js';

// ── THE STATE OBJECT ──────────────────────────────────────────────────────────
export const state = {
  // — Master Set, persisted —
  checked:          new Set(storage.getJSON(CHKSTORE, [])),                       // Set<cardId>
  pokemonList:      storage.getJSON(POKESTORE, null) || [...DEFAULT_POKEMON],
  activeLangs:      new Set(storage.getJSON(FILTERSTORE, null) || []),            // MS language filter
  dismissedBanners: new Set(storage.getJSON(BANNERSTORE, [])),
  sortDesc:         storage.get(SORTSTORE) !== 'asc',   // true = newest sets first (default)
  appMode:          storage.get(MODESTORE) || 'master', // 'master' | 'tms'

  // — True Master Set, persisted —
  tmsIncluded:      new Set(storage.getJSON(TMSSTORE, [])),                       // Set<cardId>
  tmsActiveLangs:   new Set(Array.isArray(storage.getJSON(TMSFILTERSTORE, null))
                      ? storage.getJSON(TMSFILTERSTORE, null)
                      : BADGE_ORDER),                                             // TMS sticky lang filter
  tmsPokeCache:     new Map(),  // pokeName → card[] (restored below)

  // — Runtime only (never persisted) —
  _bulbaData:       null,       // cached Bulbapedia wikitext, shared EN+JP fetch
  _meta:            new Map(),  // cardId → render metadata
  setBlockNamesMap: new Map(),
  totalCards:       0,
  _tmsCardPokemon:  new Map(),  // cardId → pokeName (for TMS counting)
  tmsGenFilter:     0,
  tmsSearchQ:       '',
  _tmsOpenPoke:     null,
  _tmsPopupAllCards: [],
  _tmsPopupActive:  new Set(),
};

// Restore the persisted TMS per-Pokémon card cache (array of [pokeName, card[]]),
// rebuilding the reverse cardId → pokeName index as we go.
(function restoreTmsCache() {
  const pc = storage.getJSON(TMSCACHESTORE, null);
  if (Array.isArray(pc)) {
    pc.forEach(([k, v]) => {
      state.tmsPokeCache.set(k, v);
      v.forEach(c => state._tmsCardPokemon.set(c.id, k));
    });
  }
})();

// ── PERSISTENCE (writes go through storage.js → quota-safe) ───────────────────
// A change to any shareable SETTING (pokémon list, filters, sort, mode) fires
// 'tcg:settings-changed' so io.js can auto-save the session hash. (Checklist/TMS
// data is intentionally excluded from the session — too large.)
function settingsChanged() { document.dispatchEvent(new CustomEvent('tcg:settings-changed')); }

export function saveChk()        { storage.setJSON(CHKSTORE,       [...state.checked]); }
export function savePoke()       { storage.setJSON(POKESTORE,      state.pokemonList);            settingsChanged(); }
export function saveFilter()     { storage.setJSON(FILTERSTORE,    [...state.activeLangs]);       settingsChanged(); }
export function saveDismissed()  { storage.setJSON(BANNERSTORE,    [...state.dismissedBanners]); }
export function saveSort()       { storage.set(SORTSTORE,          state.sortDesc ? 'desc' : 'asc'); settingsChanged(); }
export function saveMode()       { storage.set(MODESTORE,          state.appMode);                settingsChanged(); }
export function saveTmsFilter()  { storage.setJSON(TMSFILTERSTORE, [...state.tmsActiveLangs]);     settingsChanged(); }
export function saveTmsCache()   { storage.setJSON(TMSCACHESTORE,  [...state.tmsPokeCache.entries()]); }
export function removeTmsCache()  { storage.remove(TMSCACHESTORE); }

/**
 * Save TMS includes. The old tool also refreshed the "Print Selected (n)" button
 * here; that UI coupling is replaced by a 'tcg:tms-changed' event so state.js
 * stays free of rendering. tms.js (Phase 4) listens and updates the button.
 */
export function saveTms() {
  storage.setJSON(TMSSTORE, [...state.tmsIncluded]);
  document.dispatchEvent(new CustomEvent('tcg:tms-changed'));
}

// ── EN CARD-DATA CACHE (24h TTL enforced by the legacy provider, Phase 2) ─────
/** @returns the cache blob {ts, cards, ...} or null if absent/malformed. */
export function loadCache() {
  const d = storage.getJSON(CACHESTORE, null);
  return (d && d.ts && d.cards) ? d : null;
}
export function saveCache(d) {
  storage.setJSON(CACHESTORE, { ts: Date.now(), ...d });
}
/** Remove all EN card-data cache entries (current + any old versions: tcgData*). */
export function clearCardCache() {
  storage.keys('tcgData').forEach(storage.remove);
}
