// =============================================================================
// ui/collapse.js — who owns "this set is collapsed".
//
// This used to live in setnav.js as a module-local `collapsed` flag, which was the
// root cause of a dead end and four desyncs: the flag lived in the SIDEBAR but
// operated on #dyn, which masterset.js owns and re-renders.
//
//   • The only control that could un-collapse was inside the panel, so collapsing
//     everything and then closing the panel left a page of bare set heads with no
//     way back except reopening the panel or reloading.
//   • buildAll and toggleSort wipe #dyn and re-render without re-applying the class,
//     so the blocks came back expanded while the flag still said "collapsed" and the
//     button still read "Expand all" — the next click was a visual no-op.
//   • setNavReset cleared the rows but not the flag.
//   • Late-injected JP blocks never received the class.
//
// The flag is deliberately NOT persisted and NOT on the shared `state` object:
// persisting "everything is collapsed" would resurrect the dead end on every reload,
// and every key added to `state` joins the name list tools/state-prefix-scan.mjs
// derives (see the same note in setnav.js).
//
// Imports nothing from masterset.js or setnav.js — it is told about containers and
// announces changes on the document, matching the tcg:tms-changed / tcg:settings-
// changed convention in state.js. That is what lets both "collapse all" controls
// (the sidebar's and the ⋯ More menu's) relabel without either module importing the
// other.
// =============================================================================

import { nextAllCollapsed, isAllCollapsed, headChevron, headChevronLabel } from './collapse-model.js';

const CLS = 'sb-collapsed';

// Module-local by design — see the header.
let allCollapsed = false;

function allBlocks() {
  return [...document.querySelectorAll('#dyn .set-block')];
}

function collapsedCount(blocks) {
  return blocks.filter(b => b.classList.contains(CLS)).length;
}

/** Apply one block's collapsed state to its class, chevron and aria-expanded. */
function paint(block, collapsed) {
  block.classList.toggle(CLS, collapsed);
  const chev = block.querySelector('.set-chevron');
  if (chev) {
    chev.textContent = headChevron(collapsed);
    chev.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    chev.title = headChevronLabel(collapsed);
    chev.setAttribute('aria-label', headChevronLabel(collapsed));
  }
}

/** Recompute the all-collapsed flag from the DOM, then tell the UI. */
function sync() {
  const blocks = allBlocks();
  allCollapsed = isAllCollapsed(blocks.length, collapsedCount(blocks));
  announce();
}

function announce() {
  document.dispatchEvent(new CustomEvent('tcg:collapse-changed', { detail: { allCollapsed } }));
}

/** @returns {boolean} whether every set block is currently collapsed. */
export function isCollapsedAll() { return allCollapsed; }

/** Toggle a single set block. The per-set affordance the app never had. */
export function toggleBlockCollapsed(block) {
  if (!block) return;
  paint(block, !block.classList.contains(CLS));
  sync();
}

/** Inline-onclick target (⋯ More menu) and the sidebar button's handler. */
export function toggleCollapseAll() {
  const blocks = allBlocks();
  const next = nextAllCollapsed(blocks.length, collapsedCount(blocks));
  blocks.forEach(b => paint(b, next));
  allCollapsed = next;
  announce();
}

/**
 * Stamp the current all-collapsed state onto blocks that arrived after the fact.
 *
 * Not redundant with resetCollapse below: fetchAndInjectJPCards is kicked off without
 * `await`, so a user can hit "Collapse all" during the second or so it is in flight,
 * and the JP blocks it appends would otherwise land expanded into a collapsed page.
 */
export function applyCollapseState(container) {
  if (!allCollapsed) return;
  (container || document).querySelectorAll('.set-block').forEach(b => paint(b, true));
}

/**
 * A fresh render starts fully expanded.
 *
 * Called wherever #dyn is wiped. Re-applying the old state instead would hide the
 * result of the action the user just took (Refresh, add a Pokémon, flip the sort),
 * and the blocks are different DOM nodes anyway. Does NOT recompute from the DOM —
 * callers invoke it around the wipe, when what is in the document is meaningless.
 */
export function resetCollapse() {
  allCollapsed = false;
  announce();
}
