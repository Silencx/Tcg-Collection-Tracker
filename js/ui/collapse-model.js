// =============================================================================
// ui/collapse-model.js — the collapse rules, DOM-free.
//
// Same split as filter-pass.js and setnav-index.js: the decisions live here so
// `node --test` can cover them without a jsdom dependency, and ui/collapse.js is
// left holding nothing but classList calls.
// =============================================================================

/**
 * Should "collapse all" collapse, or expand?
 *
 * Mixed state resolves toward COLLAPSE. That deliberately mirrors selectSet's `any`
 * semantics in masterset.js — "if any card is unchecked, check them all" — so the two
 * bulk controls in the app behave the same way instead of each inventing a rule.
 * Only when every block is already collapsed does the control expand.
 *
 * @param {number} total          how many set blocks exist
 * @param {number} collapsedCount how many of them are currently collapsed
 * @returns {boolean} true = collapse everything, false = expand everything
 */
export function nextAllCollapsed(total, collapsedCount) {
  if (!total) return false;                 // nothing to collapse
  return collapsedCount < total;
}

/** True only when every block is collapsed. Used to keep the button label honest. */
export function isAllCollapsed(total, collapsedCount) {
  return total > 0 && collapsedCount === total;
}

/** Label for the "collapse all" control, which exists in the sidebar AND the ⋯ More menu. */
export function collapseButtonLabel(allCollapsed) {
  return allCollapsed ? '▸ Expand all' : '▾ Collapse all';
}

/** Glyph for a single set head's disclosure control. */
export function headChevron(collapsed) {
  return collapsed ? '▸' : '▾';
}

/** Accessible name for a single set head's disclosure control. */
export function headChevronLabel(collapsed) {
  return collapsed ? 'Expand this set' : 'Collapse this set';
}
