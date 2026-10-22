// =============================================================================
// ui/prints-ui.js — the DOM half of per-print tracking, shared by all three grids.
//
// Master Set, Single set and the TMS popup each build their own tiles (see the header
// of setmode.js for why), so the two pieces they have in common live here: the chip
// row for the "chips" view and the label for a tile in the "tiles" view. The rules
// themselves are in prints-model.js; nothing here decides what a click means.
// =============================================================================

import { printId, ticked } from './prints-model.js';

/** Hover / screen-reader text for one print. */
export function printTitle(p) {
  return p.inferred
    ? `${p.label} — very likely exists (TCGdex has no reverse-holo data for this era; inferred from rarity)`
    : p.label;
}

/**
 * The chip row for one card: one toggle button per print. Built as nodes, not markup —
 * labels come from TCGdex slugs. Pressed state is applied by syncChips, so a freshly
 * built row and a re-synced one cannot disagree.
 */
export function mkPrintChips(list) {
  const row = document.createElement('div');
  row.className = 'pchips';
  for (const p of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pchip' + (p.inferred ? ' pchip-inferred' : '');
    b.dataset.key = p.key;
    b.textContent = p.short;
    b.title = printTitle(p);
    b.setAttribute('aria-label', p.label);
    b.setAttribute('aria-pressed', 'false');
    row.appendChild(b);
  }
  return row;
}

/**
 * Bring one card tile's chips and "which print?" hint in line with the two sets.
 * @param {Element} tile  the .card element (holds .pchips when the chips view is on)
 * @param {Set<string>} prints
 * @param {string} cardId
 * @param {string[]} keys the card's print keys
 * @param {boolean} owned whether the card itself is ticked
 */
export function syncChips(tile, prints, cardId, keys, owned) {
  const row = tile.querySelector('.pchips');
  if (!row) return;
  for (const b of row.children) {
    b.setAttribute('aria-pressed', prints.has(printId(cardId, b.dataset.key)) ? 'true' : 'false');
  }
  markUnset(tile, owned && keys.length >= 2 && ticked(prints, cardId, keys) === 0);
}

/**
 * Owned, but no print recorded — the state every checklist saved before this feature
 * is in. Shown as a dashed outline (css) with a hint, never as an error.
 */
export function markUnset(tile, unset) {
  tile.classList.toggle('prints-unset', unset);
  if (unset) tile.title = 'Owned — tick the print you have';
  else tile.removeAttribute('title');
}

/** The short print label a tile in the "tiles" view carries in its footer. */
export function mkPrintTag(p) {
  const t = document.createElement('span');
  t.className = 'ptag' + (p.inferred ? ' ptag-inferred' : '');
  t.textContent = p.short;
  t.title = printTitle(p);
  return t;
}
