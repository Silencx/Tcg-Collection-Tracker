// =============================================================================
// ui/hscroll-model.js — which edges of a sideways-scrolling row have more content.
//
// Same split as filter-pass.js / setnav-index.js / collapse-model.js / notify-model.js:
// the arithmetic lives here so `node --test` can cover it without a browser.
// =============================================================================

// Sub-pixel slack. scrollWidth/clientWidth are integers but scrollLeft is fractional on
// a zoomed or fractionally-scaled display, so an exact comparison leaves a permanent
// 0.5px "there is more to the right" fade on a row that is fully scrolled.
const TOL = 1;

/**
 * @param {number} scrollLeft
 * @param {number} scrollWidth  full content width
 * @param {number} clientWidth  visible width
 * @returns {{start:boolean, end:boolean}} whether content is hidden off each edge
 */
export function edgeState(scrollLeft, scrollWidth, clientWidth, tol = TOL) {
  const max = scrollWidth - clientWidth;
  // Not scrollable at all — the common desktop case, and it must produce NO fade or
  // every row would be permanently dimmed at the edges on a wide screen.
  if (!(max > tol)) return { start: false, end: false };
  return { start: scrollLeft > tol, end: scrollLeft < max - tol };
}

/**
 * How far a wheel gesture should move a row, and whether it should move it at all.
 *
 * Returns null when the row cannot take the scroll — either it does not overflow, or it
 * is already against the edge the gesture pushes toward. The caller MUST leave the event
 * alone in that case: swallowing it would trap the page scroll whenever the pointer
 * happened to cross the toolbar.
 *
 * @returns {number|null} the new scrollLeft, or null to let the event through
 */
export function wheelTarget(scrollLeft, scrollWidth, clientWidth, delta) {
  const max = scrollWidth - clientWidth;
  if (!(max > TOL) || !delta) return null;
  const next = Math.max(0, Math.min(max, scrollLeft + delta));
  return next === scrollLeft ? null : next;
}
