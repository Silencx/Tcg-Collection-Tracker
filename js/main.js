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
import { PALETTE_KEY, POKESTORE, DEFAULT_MODE, isValidMode } from './config.js';
import {
  buildAll, renderPokeChips, updateSortBtn, updateStats,
  clearCache, closePreview, doRefresh, openPokemonPicker,
  resetAll, selectAll, toggleSort,
} from './ui/masterset.js';
import {
  renderTMS, buildTmsPillsTms, updateTmsPrintSelBtn, tmsAutoPopulate,
  resetTms, clearTmsCache, closeTmsPopup,
} from './ui/tms.js';
import {
  printSelected, printChecklist, printTmsSelected, printTmsChecklist,
  printSetSelected, printSetChecklist,
} from './ui/print.js';
import { installStorageQuotaHandler } from './ui/banners.js';
import {
  exportData, importData, shareSession, restoreSession,
  sessionFromUrl, applySession, saveSession, saveSessionSoon, migrateCheckedOnBoot,
} from './ui/io.js';
import { showFirstRunModal } from './ui/onboarding.js';
import { initSetNav, toggleSetNav, setNavApplyMode } from './ui/setnav.js';
import { toggleCollapseAll } from './ui/collapse.js';
import { collapseButtonLabel } from './ui/collapse-model.js';
import { initNotify } from './ui/notify.js';
import { initHScroll } from './ui/hscroll.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderSetMode, changeSet, selectAllSet, resetSet, openSetName } from './ui/setmode.js';

// LOAD-BEARING: setPalette clears the previous theme with classList.remove(...PALETTES),
// so a palette missing from this list can be added but never removed. It must stay in
// step with the body.palette-* rules in css/style.css and with the .theme-grid picker
// in index.html — tests/palette-manifest.test.mjs asserts all three agree, because
// "added the CSS, forgot this array" is a silent, one-way bug.
const PALETTES = ['palette-ocean', 'palette-dusk', 'palette-fire', 'palette-mono', 'palette-dark'];

// ── COLOUR PALETTE ────────────────────────────────────────────────────────────
/**
 * Mark the active option by its data-palette, not by element identity.
 *
 * The picker used to be duplicated once per mode control row (applyModeUI hides
 * whichever row is inactive, so a single copy inside one of them would vanish in the
 * other mode); it now lives once in the header settings panel. Matching on the value
 * rather than on `this` survives either arrangement.
 */
function markPaletteActive(cls) {
  document.querySelectorAll('.theme-opt').forEach(b => {
    b.classList.toggle('active', (b.dataset.palette || '') === cls);
  });
}

/**
 * Apply a palette class to <body>, mark the swatch active, persist the choice.
 * `btn` is unused — the markup passes `this` and markPaletteActive matches on
 * data-palette so every copy of the picker stays in sync — but the parameter stays
 * because index.html's inline onclick= attributes supply it.
 */
function setPalette(btn, cls) {
  applyPaletteClass(cls);
  storage.set(PALETTE_KEY, cls);   // writing (even '') opts out of the OS default
}

/** '' (Forest) or 'palette-dark', per the OS setting. Used only when nothing is stored. */
function systemPalette() {
  if (typeof matchMedia !== 'function') return '';
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'palette-dark' : '';
}

function applyPaletteClass(cls) {
  document.body.classList.remove(...PALETTES);
  if (cls) document.body.classList.add(cls);
  markPaletteActive(cls);
}

/**
 * Restore the saved palette on load (prevents a flash of the default theme), falling
 * back to the OS preference when the user has never picked one.
 *
 * The null check is the whole point: storage.get returns null for "never chose" and ''
 * for "chose Forest", and the old `|| ''` collapsed the two — which is the only reason
 * prefers-color-scheme could not be honoured before. Same null-vs-value shape setnav.js
 * uses for the panel's open default.
 *
 * The resolved value is deliberately NOT written back. Persisting it would freeze the
 * choice at whatever the OS happened to be on the first visit; leaving PALETTE_KEY unset
 * keeps following the OS until a swatch is clicked, which writes and wins permanently.
 */
function restorePalette() {
  const saved = storage.get(PALETTE_KEY);
  applyPaletteClass(saved === null ? systemPalette() : saved);

  if (typeof matchMedia !== 'function') return;
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (storage.get(PALETTE_KEY) !== null) return;   // an explicit choice outranks the OS
    applyPaletteClass(systemPalette());
  });
}

// ── "⋯ MORE" MENUS ────────────────────────────────────────────────────────────
// <details> stays open until its summary is clicked again, which for a dropdown
// means it lingers after you have used it. Close on any click outside, and on
// Escape — the same pattern masterset.js uses for the Pokémon suggestions.
document.addEventListener('click', e => {
  document.querySelectorAll('.more-menu[open]').forEach(d => {
    if (!d.contains(e.target)) d.open = false;
  });
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.more-menu[open]').forEach(d => { d.open = false; });
});

// ── MODE SHELL ────────────────────────────────────────────────────────────────
//
// This was thirteen `isTms ? … : …` ternaries, every one of which really meant "not TMS
// ⇒ Master". A third mode would have inherited Master's toolbar, Master's filter bar,
// the Pokémon bar and #dyn — silently, because nothing in the shape of the code said
// two was the limit. Three tables and one loop instead: adding a mode is one row in
// each, and forgetting a row hides an element rather than showing the wrong one.

/**
 * Every element mode switching can show → the `display` that shows it.
 * '' means "whatever the stylesheet says", which is right for anything whose own rule
 * already sets flex/grid; the explicit values are the ones that would otherwise fall
 * back to `inline`/`block` and break their layout.
 */
const MODE_PANELS = {
  // 'block', not '': #dash and #tms-app are display:none in the stylesheet so they
  // cannot flash before applyModeUI runs, and '' would resolve straight back to that.
  'dash':                 'block',
  'master-controls':      'flex',
  'tms-header-controls':  'flex',
  'settings-master-only': '',
  'settings-tms-only':    '',
  'poke-bar':             'flex',
  'ms-filter-bar':        'flex',
  'tms-filter-bar':       'flex',
  'set-bar':              'flex',
  'dash-bar':             'flex',
  'set-controls':         'flex',
  // Single set's bottom-docked status bar. renderSetMode hides it again while the PICKER
  // is showing, exactly like #set-controls — there is no progress to report until a set
  // is chosen.
  'set-status-bar':       'block',
  'dyn':                  '',
  'tms-app':              'block',
  'set-app':              'block',
  // #stats is WRITTEN by two modes (renderStats and _updateTmsStats) and owned by
  // neither of them when a third is on screen, so in dash mode it just kept whatever
  // the last mode left there — 'Loading…' on a cold boot, '2 cards included' after a
  // visit to TMS. Hiding it is the honest form of "no mode shows another mode's chrome".
  'stats':                '',
};

/** Which of the above each mode shows. Anything not listed is hidden. */
// One context bar each, except Master Set, which needs two — see the note in index.html.
// What still matters is that a mode's height cannot change WITHOUT a mode switch: the
// bars listed here are shown for as long as the mode is, and single set in particular
// swaps the CONTENTS of #set-bar between picker and open set rather than removing it.
const MODE_VISIBLE = {
  dash:   ['dash', 'dash-bar'],
  master: ['master-controls', 'settings-master-only', 'poke-bar', 'ms-filter-bar', 'dyn', 'stats'],
  tms:    ['tms-header-controls', 'settings-tms-only', 'tms-filter-bar', 'tms-app', 'stats'],
  // #set-controls and #set-status-bar are listed here but renderSetMode hides them again
  // while the PICKER is showing — there is nothing to print, clear or report progress on
  // until a set is chosen. Conversely #set-bar is the PICKER's row, and renderSetMode
  // hides that one once a set IS open.
  set:    ['set-controls', 'set-bar', 'set-status-bar', 'set-app', 'stats'],
};

/** Mode-switch button id → the mode it selects. */
const MODE_BUTTONS = {
  'btn-mode-dash':   'dash',
  'btn-mode-master': 'master',
  'btn-mode-tms':    'tms',
  'btn-mode-set':    'set',
};

/**
 * The h1 and the document title, per mode. Both used to be decided inside
 * renderPokeChips with a "not TMS" branch, which quietly made Master Set the owner of
 * the title for every mode that wasn't TMS.
 *
 * BOTH are functions: Master's document title depends on the Pokémon list, and single
 * set's h1 is the chosen SET'S name. Neither changes on a mode switch, so
 * 'tcg:settings-changed' and 'tcg:set-loaded' re-apply this (see finishBoot).
 */
const MODE_TITLE = {
  dash:   { h1: () => 'Your collection',           doc: () => 'Pokémon TCG Collection Tracker' },
  master: { h1: () => 'Master set checklist',      doc: () => state.pokemonList.length
              ? `${state.pokemonList.join(', ')} — Master Set Checklist`
              : 'Pokémon TCG Master Set Checklist' },
  tms:    { h1: () => 'True master set checklist', doc: () => 'True Master Set Checklist' },
  // Named after what you are looking AT, not after the mode: 'Single set' duplicated
  // the mode button two inches to its left and told you nothing.
  set:    { h1:  () => openSetName() || 'Pick a set',
            doc: () => openSetName() ? `${openSetName()} — Set Checklist` : 'Pick a Set — Pokémon TCG' },
};

/** Cosmetic half of mode switching: which chrome and which render container are shown. */
function applyModeUI(mode) {
  const visible = MODE_VISIBLE[mode] || MODE_VISIBLE[DEFAULT_MODE];
  for (const [id, shown] of Object.entries(MODE_PANELS)) {
    // Guarded: #tms-app and #dash exist in the markup, but a partial page (tests, a
    // future trimmed build) should skip rather than throw.
    const el = document.getElementById(id);
    if (el) el.style.display = visible.includes(id) ? shown : 'none';
  }
  for (const [id, m] of Object.entries(MODE_BUTTONS)) {
    document.getElementById(id)?.classList.toggle('active', mode === m);
  }
  // TMS's pills are built from state rather than from the DOM, so they need a rebuild
  // on entry; Master's are built by buildPills at the end of its render.
  if (mode === 'tms') buildTmsPillsTms();
  setNavApplyMode(mode);
}

function applyModeTitle(mode) {
  const t = MODE_TITLE[mode] || MODE_TITLE[DEFAULT_MODE];
  const h = document.getElementById('page-title');
  if (h) h.textContent = t.h1();
  document.title = t.doc();
}

// Which heavy renders have run this session. applyModeUI only toggles `display`, so a
// rendered mode stays in the DOM and does not need rebuilding on every visit.
const rendered = { master: false, tms: false, set: false };

/**
 * The render half, one entry per mode. This was an unguarded `else` meaning Master,
 * so ANY unrecognised mode fired a full buildAll() — a network fetch and a 776-tile
 * DOM build — for a view that was not even on screen.
 */
const MODE_ENTER = {
  // Cheap, and it reads state.checked, which changes while you are away in Master mode.
  // So it re-renders on every entry rather than caching like the two below.
  dash: () => renderDashboard(),
  // The first-run Pokémon picker is asked HERE, not at boot. state.pokemonList is a
  // Master-Set concept — Home, True master set and single set neither read nor write it —
  // so blocking the whole app on it made every first-time visitor name a Pokémon line
  // before they could see the dashboard they had actually landed on. Cancelling returns
  // to Home and saves nothing, so the question is asked again next time.
  master: () => {
    if (storage.get(POKESTORE) === null) {
      showFirstRunModal(enterMaster, () => setMode('dash'));
      return;
    }
    enterMaster();
  },
  tms: () => { rendered.tms = true; renderTMS(); updateTmsPrintSelBtn(); },
  // Async and NOT awaited: it fetches, and setMode is called from an inline onclick.
  // It paints its own loading state and its own failure state, so there is nothing
  // useful for a caller to wait on. Idempotent, so a re-entry is safe.
  set: () => { rendered.set = true; renderSetMode(); },
};

/**
 * Master set's real entry, split out so the first-run picker can call it as its
 * completion callback. renderPokeChips/applyModeTitle run again because the picker
 * resolves AFTER setMode has already painted the chrome from the old (empty) list.
 */
function enterMaster() {
  renderPokeChips();
  applyModeTitle('master');
  if (!rendered.master) { rendered.master = true; buildAll(false); }
  else updateStats();   // totals are whatever the last filter pass left them
}

/** setMode: persist + cosmetic switch + the relevant render for the chosen mode. */
function setMode(mode) {
  // An inline onclick in index.html is the only caller, but a stale bookmarked handler
  // or a future caller passing junk must not leave the app in a mode nothing renders.
  if (!isValidMode(mode)) return;
  state.appMode = mode;
  saveMode();
  applyModeUI(mode);
  applyModeTitle(mode);
  renderPokeChips();          // no-op outside Master; see its own guard
  MODE_ENTER[mode]();
}

// The dashboard's three cards ask for a mode switch through this event rather than by
// importing setMode — main.js imports dashboard.js, so a direct call would be a cycle.
document.addEventListener('tcg:set-mode', e => setMode(e.detail?.mode));

// ── BOOT ──────────────────────────────────────────────────────────────────────
// `<script type="module">` is deferred, so the DOM is parsed by the time this runs.
installStorageQuotaHandler();   // route storage-quota failures to a visible banner
initNotify();                   // before anything can raise a banner, so none is missed
// Session restore: a #s= link overrides the per-key persisted settings. Must run
// before the first render so mode/filters/pokémon/sort/palette are already set.
const urlSession = sessionFromUrl();
if (urlSession) applySession(urlSession);
migrateCheckedOnBoot();   // one-time: upgrade any old pokemontcg.io checklist ids → TCGdex

/**
 * Second half of boot: palette, chrome, initial render.
 *
 * This used to be gated behind showFirstRunModal() for anyone with no saved Pokémon
 * list, which meant a first-time visitor could not see ANY mode until they had answered
 * a Master-Set-only question. The picker moved into MODE_ENTER.master; boot is
 * unconditional again.
 */
function finishBoot() {
  restorePalette();
  renderPokeChips();
  updateSortBtn();
  // Build the sidebar shell BEFORE applyModeUI (which shows/hides it) and before
  // buildAll (whose renderBySet fills it via setNavRebuild).
  initSetNav();
  // After renderPokeChips, before the control rows are shown: the fades are derived from
  // measured widths, so the rows have to hold their real content first. Later changes
  // (pills rebuilt, chips added, mode switched) are picked up by its own observers.
  initHScroll();
  applyModeUI(state.appMode);
  applyModeTitle(state.appMode);
  // Same dispatch setMode uses, rather than a second `if (tms) … else buildAll()`. That
  // `else` is why booting into TMS once ran a full network fetch and a 776-element DOM
  // build into a display:none container the user might never look at — and it would have
  // done exactly the same for the dashboard.
  MODE_ENTER[state.appMode]();
  // First-run seeding is a BOOT-only concern: switching into TMS later must not
  // repopulate a catalogue the user has deliberately emptied.
  if (state.appMode === 'tms' && state.tmsIncluded.size === 0) tmsAutoPopulate();
  saveSession();                                                       // persist the initial/derived view
  // Debounced: a settings change has already written its own key, and this is a
  // second stringify+encode+write for the same gesture. io.js flushes it on
  // pagehide/visibilitychange so nothing is lost.
  document.addEventListener('tcg:settings-changed', saveSessionSoon);
  // Master's document title names the tab after the Pokémon list, which changes without
  // a mode switch. savePoke fires this event, so one listener keeps the title in step
  // without renderPokeChips having to own it again.
  document.addEventListener('tcg:settings-changed', () => applyModeTitle(state.appMode));
  // Single set's h1 is the set's NAME, which only exists once its fetch resolves.
  document.addEventListener('tcg:set-loaded', () => applyModeTitle(state.appMode));
  // Keep the ⋯ More twin of "Collapse all" labelled in step with the sidebar's copy.
  // Both read the same event, so neither owns the state.
  document.addEventListener('tcg:collapse-changed', (e) => {
    const btn = document.getElementById('more-collapse-all');
    if (btn) btn.textContent = collapseButtonLabel(!!e.detail?.allCollapsed);
  });
  console.info('[boot] dashboard + 3-mode shell | mode:', state.appMode,
    '| pokémon:', state.pokemonList.join(', '));
}

finishBoot();

// ── GLOBAL HANDLERS (wiring manifest for inline onclick= in index.html) ───────
// Add to this list as each module lands. Anything the markup calls inline MUST
// appear here or the click will throw a ReferenceError.
Object.assign(window, {
  setMode, setPalette,
  // Master Set (Phase 2)
  clearCache, closePreview, doRefresh, openPokemonPicker,
  resetAll, selectAll, toggleSort,
  // TMS + print (Phase 4)
  resetTms, clearTmsCache, closeTmsPopup,
  printSelected, printChecklist, printTmsSelected, printTmsChecklist,
  printSetSelected, printSetChecklist,
  // import/export + sessions (Phase 5)
  exportData, importData, shareSession, restoreSession,
  // single-set mode (Phase 3)
  changeSet, selectAllSet, resetSet,
  // set-navigation sidebar
  toggleSetNav,
  // collapse (sidebar button + ⋯ More twin)
  toggleCollapseAll,
});
