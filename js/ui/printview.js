// =============================================================================
// ui/printview.js — the per-print tracking SWITCH: off / chips / tiles.
//
// One setting for all three checklist modes (state.printView, a shareable setting that
// rides #s=). The gear panel holds the three-way choice; while tracking is on, a single
// button next to "Sets" swaps chips ↔ tiles. That button names what it will DO rather
// than cycling through states — the app removed a cycling All/None button for exactly
// that reason (see the note in masterset.js where toggleAllFilter used to be).
//
// Lives in its own module because it re-renders all three modes, and each of them
// importing the others' render functions would be a cycle.
// =============================================================================

import { state, savePrintView } from '../state.js';
import { isValidPrintView } from '../config.js';
import { rerenderMaster, updateStats } from './masterset.js';
import { repaintSet } from './setmode.js';
import { rerenderTmsPopup } from './tms.js';

/** Inline-onclick target (gear panel): choose how prints are shown. */
export function setPrintView(v) {
  if (!isValidPrintView(v) || v === state.printView) { syncPrintViewUI(); return; }
  state.printView = v;
  savePrintView();
  syncPrintViewUI();
  // Every mode that has been rendered, not just the visible one: applyModeUI only
  // toggles display, so a mode rendered earlier would otherwise show the old view when
  // you switch back to it. Each of these is a no-op for a mode that was never rendered.
  if (document.querySelector('#dyn .set-block')) rerenderMaster();
  else updateStats();
  repaintSet();
  rerenderTmsPopup();
}

/** Inline-onclick target (toolbar): flip between the two tracking views. */
export function swapPrintView() {
  setPrintView(state.printView === 'tiles' ? 'chips' : 'tiles');
}

/** Paint the gear panel's choice and the toolbar switch from state. */
export function syncPrintViewUI() {
  document.querySelectorAll('.pv-opt').forEach(b => {
    const on = b.dataset.pv === state.printView;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const sw = document.getElementById('btn-print-view');
  if (!sw) return;
  sw.hidden = state.printView === 'off' || state.appMode === 'dash';
  const toTiles = state.printView !== 'tiles';
  sw.textContent = toTiles ? '▦ Prints as tiles' : '▤ Prints as chips';
  sw.title = toTiles
    ? 'Show every print as its own tile (normal, reverse holo, holo…)'
    : 'Show one tile per card, with a chip for each print';
}
