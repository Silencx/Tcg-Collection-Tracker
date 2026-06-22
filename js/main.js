// =============================================================================
// main.js — application boot + event wiring.
//
// PHASE 1 SCOPE: this is a SHELL. It loads the foundational modules (config,
// state, storage), restores the saved colour palette, and shows the correct
// control rows for the saved mode. It renders NO cards yet — the providers
// (Phase 2/3), Master-Set render (Phase 2), TMS render + print (Phase 4),
// banners (Phase 5) and sessions (Phase 5) are added in later phases, and their
// handlers get appended to the GLOBAL HANDLERS block at the bottom.
//
// INLINE-HANDLER BRIDGE: index.html keeps the old tool's inline `onclick="fn()"`
// attributes verbatim (faithful port, lowest risk). Module scope is not global,
// so each such handler must be published on `window` in the GLOBAL HANDLERS
// block below. That block is the single, explicit list of every function the
// markup expects to exist — treat it as the wiring manifest.
// =============================================================================

import { state, saveMode } from './state.js';
import * as storage from './storage.js';
import { PALETTE_KEY } from './config.js';
import {
  buildAll, renderPokeChips, updateSortBtn, updateStats,
  addPokeFromInput, clearCache, closePreview, doRefresh,
  onPokeInput, onPokeKey, resetAll, selectAll, toggleAllFilter, toggleSort,
} from './ui/masterset.js';
import {
  renderTMS, buildTmsPillsTms, updateTmsPrintSelBtn, tmsAutoPopulate,
  resetTms, clearTmsCache, toggleAllTmsFilter, closeTmsPopup,
} from './ui/tms.js';
import {
  printSelected, printChecklist, printTmsSelected, printTmsChecklist,
} from './ui/print.js';
import { installStorageQuotaHandler } from './ui/banners.js';
import {
  exportData, importData, shareSession, restoreSession,
  sessionFromUrl, applySession, saveSession, migrateCheckedOnBoot,
} from './ui/io.js';

const PALETTES = ['palette-ocean', 'palette-dusk', 'palette-fire', 'palette-mono'];

// ── COLOUR PALETTE ────────────────────────────────────────────────────────────
/** Apply a palette class to <body>, mark the swatch active, persist the choice. */
function setPalette(btn, cls) {
  document.body.classList.remove(...PALETTES);
  if (cls) document.body.classList.add(cls);
  document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  storage.set(PALETTE_KEY, cls);
}

/** Restore the saved palette on load (prevents a flash of the default theme). */
function restorePalette() {
  const saved = storage.get(PALETTE_KEY) || '';
  if (saved) document.body.classList.add(saved);
  const btn = document.querySelector(`.palette-btn[data-palette="${saved}"]`);
  if (btn) {
    document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
}

// ── MODE SHELL ────────────────────────────────────────────────────────────────
/**
 * Cosmetic half of mode switching: show/hide the Master vs TMS control rows,
 * filter bars, Pokémon bar and render containers. The render half (renderTMS,
 * renderPokeChips, updateStats, …) is added when those modules exist; until
 * then this just makes the shell show the right chrome. All lookups are guarded
 * so elements that only exist after a render (e.g. #tms-app) are skipped safely.
 */
function applyModeUI(mode) {
  const isTms = mode === 'tms';
  document.getElementById('btn-mode-master')?.classList.toggle('active', !isTms);
  document.getElementById('btn-mode-tms')?.classList.toggle('active', isTms);
  const mc   = document.getElementById('master-controls');
  const tc   = document.getElementById('tms-header-controls');
  const msf  = document.getElementById('ms-filter-bar');
  const tmsf = document.getElementById('tms-filter-bar');
  const pbar = document.querySelector('.poke-bar');
  const dyn  = document.getElementById('dyn');
  const tapp = document.getElementById('tms-app');
  if (mc)   mc.style.display   = isTms ? 'none' : 'flex';
  if (tc)   tc.style.display   = isTms ? 'flex' : 'none';
  if (pbar) pbar.style.display = isTms ? 'none' : '';
  if (msf)  msf.style.display  = isTms ? 'none' : '';
  if (tmsf) tmsf.style.display = isTms ? 'flex' : 'none';
  if (isTms) buildTmsPillsTms();
  if (dyn)  dyn.style.display  = isTms ? 'none' : '';
  if (tapp) tapp.style.display = isTms ? 'block' : 'none';
}

/** setMode: persist + cosmetic switch + the relevant render for the chosen mode. */
function setMode(mode) {
  state.appMode = mode;
  saveMode();
  applyModeUI(mode);
  renderPokeChips();
  if (mode === 'tms') { renderTMS(); updateTmsPrintSelBtn(); }
  else updateStats();
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
// `<script type="module">` is deferred, so the DOM is parsed by the time this runs.
installStorageQuotaHandler();   // route storage-quota failures to a visible banner
// Session restore: a #s= link overrides the per-key persisted settings. Must run
// before the first render so mode/filters/pokémon/sort/palette are already set.
const urlSession = sessionFromUrl();
if (urlSession) applySession(urlSession);
migrateCheckedOnBoot();   // one-time: upgrade any old pokemontcg.io checklist ids → TCGdex
restorePalette();
renderPokeChips();
updateSortBtn();
applyModeUI(state.appMode);
// TMS init: render the catalog and, on very first use, seed one default card.
if (state.appMode === 'tms') {
  renderTMS();
  updateTmsPrintSelBtn();
  if (state.tmsIncluded.size === 0) tmsAutoPopulate();
}
buildAll(false);   // fetch + render Master Set (runs even in TMS mode, as the old tool did)
saveSession();                                                   // persist the initial/derived view
document.addEventListener('tcg:settings-changed', saveSession);  // auto-save the session hash on any settings change
console.info('[boot] Phase 5 — sessions + import/export live | mode:', state.appMode,
  '| pokémon:', state.pokemonList.join(', '));

// ── GLOBAL HANDLERS (wiring manifest for inline onclick= in index.html) ───────
// Add to this list as each module lands. Anything the markup calls inline MUST
// appear here or the click will throw a ReferenceError.
Object.assign(window, {
  setMode, setPalette,
  // Master Set (Phase 2)
  addPokeFromInput, clearCache, closePreview, doRefresh,
  onPokeInput, onPokeKey, resetAll, selectAll, toggleAllFilter, toggleSort,
  // TMS + print (Phase 4)
  resetTms, clearTmsCache, toggleAllTmsFilter, closeTmsPopup,
  printSelected, printChecklist, printTmsSelected, printTmsChecklist,
  // import/export + sessions (Phase 5)
  exportData, importData, shareSession, restoreSession,
});
