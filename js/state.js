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
  SETTARGETSTORE, SETCHKSTORE, SETPICKERSTORE,
  BADGE_ORDER, DEFAULT_POKEMON, DEFAULT_MODE,
} from './config.js';

// Persisted blobs are read back defensively. `new Set(nonIterable)` throws, and
// this module runs at import time — so one corrupt localStorage value (a manual
// edit, a half-written quota failure, a schema change) used to throw before any
// UI existed, leaving a blank page with no way to recover short of clearing site
// data by hand. Fall back to the default instead.
function persistedArray(key, fallback) {
  const v = storage.getJSON(key, null);
  return Array.isArray(v) ? v : fallback;
}

// Read once — this was parsed twice, on consecutive lines, to test then use it.
const tmsFilter = persistedArray(TMSFILTERSTORE, BADGE_ORDER);
// {lang, asc}. Same defensive read as persistedArray: a corrupt value here would throw
// at import time, before any UI exists to report it.
const pickerPrefs = (() => {
  const v = storage.getJSON(SETPICKERSTORE, null);
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
})();

// ── THE STATE OBJECT ──────────────────────────────────────────────────────────
export const state = {
  // — Master Set, persisted —
  checked:          new Set(persistedArray(CHKSTORE, [])),                        // Set<cardId>
  pokemonList:      persistedArray(POKESTORE, null) || [...DEFAULT_POKEMON],
  // English only on a fresh profile. The grid renders one tile PER LANGUAGE per card
  // (12 badges), so an all-on default buried the cards most people actually want under
  // eleven other printings. Extra languages are added from the pills. The seed used to
  // be [] and buildPills quietly rewrote it to "everything present" on first render.
  activeLangs:      new Set(persistedArray(FILTERSTORE, ['EN'])),                 // MS language filter
  dismissedBanners: new Set(persistedArray(BANNERSTORE, [])),
  sortDesc:         storage.get(SORTSTORE) !== 'asc',   // true = newest sets first (default)
  // Boot ALWAYS lands on the dashboard — a product decision, not a fallback. MODESTORE
  // is still written on every switch, because the mode is part of the shareable session
  // (io.js encodeSession) and of the export envelope; it is simply not read back as a
  // landing preference. A "#s=" link's mode DOES win: applySession runs after this
  // module is initialised and before the first render.
  appMode:          DEFAULT_MODE,

  // — True Master Set, persisted —
  tmsIncluded:      new Set(persistedArray(TMSSTORE, [])),                        // Set<cardId>
  tmsActiveLangs:   new Set(tmsFilter),                                           // TMS sticky lang filter
  tmsPokeCache:     new Map(),  // pokeName → card[] (restored below)

  // — Single set, persisted —
  // NAMING: every key on this object becomes a reserved bare identifier across js/**
  // (tools/state-prefix-scan.mjs fails the build on one), so these carry the same kind
  // of mode prefix as tms*. `setTarget`/`setChecked` were the obvious names and are
  // exactly the ones a future `function setChecked(...)` would collide with.
  ssTarget:         storage.get(SETTARGETSTORE) || null,                          // chosen set id
  ssChecked:        new Set(persistedArray(SETCHKSTORE, [])),                     // Set<cardId>, SEPARATE from `checked`
  // NO ssActiveLangs. Single-set mode has no language filter: the language is chosen in
  // the picker, before the set, so the open set has exactly one. ssPickerLang below is
  // that choice.
  ssCardCounts:     {},         // setId → {official,total}, from data/sets.json (runtime)
  // Picker chrome. Device-local, like SETNAVSTORE and for the same reason — a link
  // shared from a desktop should not reorder the recipient's list.
  ssPickerLang:     pickerPrefs.lang || 'en',
  ssPickerAsc:      !!pickerPrefs.asc,   // false = newest first, matching sortDesc

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
  if (!Array.isArray(pc)) return;
  // Each entry must be a [name, cards[]] pair. Destructuring a non-array entry,
  // or calling .forEach on a non-array card list, throws at module load — which
  // takes the whole app down before it can render. Skip malformed entries.
  for (const pair of pc) {
    if (!Array.isArray(pair)) continue;
    const [k, v] = pair;
    if (typeof k !== 'string' || !Array.isArray(v)) continue;
    state.tmsPokeCache.set(k, v);
    v.forEach(c => { if (c && c.id != null) state._tmsCardPokemon.set(c.id, k); });
  }
})();

// ── PERSISTENCE (writes go through storage.js → quota-safe) ───────────────────
// A change to any shareable SETTING (pokémon list, filters, sort, mode) fires
// 'tcg:settings-changed' so io.js can auto-save the session hash. (Checklist/TMS
// data is intentionally excluded from the session — too large.)
function settingsChanged() { document.dispatchEvent(new CustomEvent('tcg:settings-changed')); }

// The checklist is serialized in full on every write, and a write fires on every
// single card toggle — so "Select All" over a large Pokémon re-stringified a
// multi-thousand-entry Set once per card. Coalesce writes into one, and flush on
// pagehide so nothing is lost if the tab closes inside the window.
const WRITE_DEBOUNCE_MS = 250;

/**
 * Coalesce repeated writes of one key into a single one, `WRITE_DEBOUNCE_MS` after
 * the last change. Returns [save, flush, cancel]; `flush` writes any pending change
 * out NOW and must be called before anything reads the key back (exportData does),
 * `cancel` drops it — needed when the key is about to be removed outright.
 *
 * `serialize` is called at WRITE time, not at save time, so the value written is
 * always the latest state — the point of coalescing is to stringify once, not
 * once per click.
 */
function debouncedWrite(key, serialize) {
  let timer = null;
  const write = () => { timer = null; storage.setJSON(key, serialize()); };
  const cancel = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
  const flush = () => { if (timer === null) return; clearTimeout(timer); write(); };
  const save = () => { cancel(); timer = setTimeout(write, WRITE_DEBOUNCE_MS); };
  return [save, flush, cancel];
}

const [saveChkInner, flushChk] = debouncedWrite(CHKSTORE, () => [...state.checked]);
// Same treatment, same reason: saveTms fired on every single card click in the TMS
// popup, and saveTmsCache re-stringified the entire multi-Pokémon card cache — the
// biggest blob the app writes — on every popup fetch.
const [saveTmsInner, flushTms] = debouncedWrite(TMSSTORE, () => [...state.tmsIncluded]);
const [saveTmsCacheInner, flushTmsCache, cancelTmsCache] = debouncedWrite(TMSCACHESTORE, () => [...state.tmsPokeCache.entries()]);
// Same treatment as the other two checklists: one write per burst of ticks, not one per tick.
const [saveSetChkInner, flushSetChk] = debouncedWrite(SETCHKSTORE, () => [...state.ssChecked]);

export { flushChk, flushTms, flushTmsCache, flushSetChk };
export function saveChk() { saveChkInner(); }

/** Write every pending debounced blob out. */
export function flushAll() { flushChk(); flushTms(); flushTmsCache(); flushSetChk(); }

if (typeof window !== 'undefined') {
  // pagehide covers the bfcache case that 'unload' misses; visibilitychange
  // catches a tab being backgrounded on mobile, where pagehide may not fire.
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
}
export function savePoke()       { storage.setJSON(POKESTORE,      state.pokemonList);            settingsChanged(); }
export function saveFilter()     { storage.setJSON(FILTERSTORE,    [...state.activeLangs]);       settingsChanged(); }
export function saveDismissed()  { storage.setJSON(BANNERSTORE,    [...state.dismissedBanners]); }
export function saveSort()       { storage.set(SORTSTORE,          state.sortDesc ? 'desc' : 'asc'); settingsChanged(); }
export function saveMode()       { storage.set(MODESTORE,          state.appMode);                settingsChanged(); }
export function saveTmsFilter()  { storage.setJSON(TMSFILTERSTORE, [...state.tmsActiveLangs]);     settingsChanged(); }
// Single set. The chosen set and its language filter are shareable SETTINGS (they ride
// the #s= hash); the checklist is data, so it is debounced like the other two and fires
// its own event instead.
export function saveSetTarget()  { storage.set(SETTARGETSTORE, state.ssTarget || '');              settingsChanged(); }
export function saveSetChk()     { saveSetChkInner(); document.dispatchEvent(new CustomEvent('tcg:set-changed')); }
// Picker chrome only — deliberately NOT settingsChanged(), so it stays out of the
// shareable session hash. Same call as SETNAVSTORE's open/closed state.
export function saveSetPicker()  { storage.setJSON(SETPICKERSTORE, { lang: state.ssPickerLang, asc: state.ssPickerAsc }); }
export function saveTmsCache()   { saveTmsCacheInner(); }
export function removeTmsCache() {
  // Drop the pending write first, or the debounce would resurrect the blob a
  // quarter-second after the user cleared it.
  cancelTmsCache();
  storage.remove(TMSCACHESTORE);
}

/**
 * Save TMS includes. The old tool also refreshed the "Print Selected (n)" button
 * here; that UI coupling is replaced by a 'tcg:tms-changed' event so state.js
 * stays free of rendering. tms.js (Phase 4) listens and updates the button.
 */
export function saveTms() {
  // The WRITE is debounced; the EVENT is not. tms.js's tile counts and the
  // "Print Selected (n)" badge listen for this, so deferring it would leave the
  // UI a quarter-second behind the click that caused it.
  saveTmsInner();
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
