// =============================================================================
// ui/filter-pass.js — the language-filter visibility RULE, as a pure function.
//
// Extracted from masterset.js's applyFilter, which used to make four separate
// full-document querySelectorAll passes and then walk siblings once per
// .poke-divider and once per .era-label — on a grid of 776 elements for the
// default Pokémon list, and ten times that for a popular one. Worse, it ended
// with updateStats(), which walked every .card in the document AGAIN, and both
// of its callers called updateStats() as well: five whole-document walks per
// language-pill click.
//
// The replacement is one pass per set block over that block's grid children,
// which also yields the block's visible/checked tallies for free — so the stats
// badge and the sidebar's per-set progress need no walk of their own.
//
// This module is DELIBERATELY DOM-FREE (like ui/html.js and ui/session-codec.js)
// so `node --test` can cover the rule without a jsdom dependency. The caller
// passes accessors that read the live DOM; everything decided here is arithmetic.
// =============================================================================

export const KIND_OTHER = 0;
export const KIND_CARD = 1;
export const KIND_DIVIDER = 2;

/**
 * Decide which children of one set block's .cards-grid should be visible.
 *
 * A Pokémon-name divider is visible iff at least one card between it and the
 * next divider is visible — that is the rule the old sibling-walk implemented,
 * and it falls out of a single forward pass by remembering the last divider seen.
 *
 * @param {number} n number of grid children
 * @param {(i:number)=>number} kindAt KIND_CARD / KIND_DIVIDER / KIND_OTHER
 * @param {(i:number)=>boolean} visibleAt does card i pass the language filter
 * @param {(i:number)=>boolean} doneAt is card i checked
 * @returns {{show:Uint8Array, kind:Uint8Array, cards:number, visible:number, done:number}}
 *   `show[i]` is 1 when child i should be displayed. `done` counts only VISIBLE
 *   checked cards, so it matches the "N / M collected" denominator, which excludes
 *   filtered-out cards.
 */
export function planGridVisibility(n, kindAt, visibleAt, doneAt) {
  const show = new Uint8Array(n);
  const kind = new Uint8Array(n);
  let cards = 0, visible = 0, done = 0, lastDivider = -1;

  for (let i = 0; i < n; i++) {
    const k = kindAt(i);
    kind[i] = k;
    if (k === KIND_DIVIDER) { lastDivider = i; continue; }   // show[i] stays 0 until a visible card follows
    if (k !== KIND_CARD) { show[i] = 1; continue; }          // anything else is never filtered
    cards++;
    if (!visibleAt(i)) continue;
    show[i] = 1;
    visible++;
    if (doneAt(i)) done++;
    if (lastDivider >= 0) show[lastDivider] = 1;
  }

  return { show, kind, cards, visible, done };
}

/**
 * Whether a set block should be hidden outright.
 *
 * The `cards > 0` guard is load-bearing: a block that legitimately holds no cards
 * (a render error skipped its cards, per the try/catch in renderBySet) must stay
 * visible so the empty set head is still there to see, rather than silently
 * vanishing as though it had been filtered away.
 */
export function blockAllHidden(cards, visible) {
  return cards > 0 && visible === 0;
}

/**
 * First-paint height estimate for a grid, in px, feeding `contain-intrinsic-size`
 * via the --cv-h custom property. With content-visibility:auto an off-screen grid
 * contributes this instead of its real height, so a bad guess shows up as scrollbar
 * drift and as sidebar jumps that land short. Only the first paint uses it —
 * `auto` remembers the real size once a grid has been rendered once.
 *
 * Dividers are full-width rows (grid-column:1/-1), so they cost their own line
 * each rather than a grid cell.
 *
 * They ALSO break the row flow: a divider forces the next card onto a fresh row, so each
 * group ends in a partial row whose remaining cells are wasted. Estimating from the total
 * card count alone therefore under-counts rows once there is more than one group — on the
 * demo list at 7 columns that was a 16% under-estimate, i.e. a whole missing row per set.
 * Pass `groups` (cards per Pokémon) to model it exactly; `cards` alone still works and
 * keeps the old single-group behaviour.
 */
export function estimateGridHeight({ cards, dividers = 0, groups = null, cols = 11, tilePx = 162, dividerPx = 22, gapPx = 6, padPx = 12 }) {
  const c = Math.max(1, cols);
  const rows = Array.isArray(groups) && groups.length
    ? groups.reduce((sum, n) => sum + Math.ceil(Math.max(0, n) / c), 0)
    : Math.ceil(Math.max(0, cards) / c);
  const cells = rows * (tilePx + gapPx);
  return Math.round(padPx + cells + Math.max(0, dividers) * (dividerPx + gapPx));
}
