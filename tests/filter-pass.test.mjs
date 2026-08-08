// The language filter used to be four full-document querySelectorAll passes plus a
// sibling walk per divider, and its rules were only ever exercised by clicking
// pills in a browser. The rules now live in one pure function, so the awkward cases
// — a divider whose whole run is filtered out, a block with no cards at all — are
// asserted here instead of hoped for.
// (groups-aware height estimation is covered at the bottom of this file)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planGridVisibility, blockAllHidden, estimateGridHeight,
  KIND_CARD, KIND_DIVIDER, KIND_OTHER,
} from '../js/ui/filter-pass.js';

/**
 * Build accessors from a compact spec: 'd' = divider, an uppercase badge = a
 * visible-if-active card, lowercase = the same card already checked.
 */
function grid(spec, active) {
  const items = spec.split(' ').filter(Boolean);
  const on = new Set(active);
  return [
    items.length,
    i => (items[i] === 'd' ? KIND_DIVIDER : items[i] === 'x' ? KIND_OTHER : KIND_CARD),
    i => on.has(items[i].toUpperCase()),
    i => items[i] === items[i].toLowerCase() && items[i] !== 'd' && items[i] !== 'x',
  ];
}

test('a divider is shown when any card in its run is visible', () => {
  const p = planGridVisibility(...grid('d EN DE d ES', ['EN']));
  assert.equal(p.show[0], 1, 'first divider has a visible EN card');
  assert.equal(p.show[3], 0, 'second divider run is ES only, all filtered');
  assert.equal(p.cards, 3);
  assert.equal(p.visible, 1);
});

test('a divider whose entire run is filtered out is hidden', () => {
  const p = planGridVisibility(...grid('d DE DE d FR', ['EN']));
  assert.equal(p.show[0], 0);
  assert.equal(p.show[3], 0);
  assert.equal(p.visible, 0);
});

test('a trailing divider with no cards after it is hidden', () => {
  const p = planGridVisibility(...grid('d EN d', ['EN']));
  assert.equal(p.show[0], 1);
  assert.equal(p.show[2], 0, 'nothing follows the trailing divider');
});

test('cards before any divider are handled without a divider to credit', () => {
  const p = planGridVisibility(...grid('EN DE', ['EN', 'DE']));
  assert.equal(p.visible, 2);
  assert.deepEqual([...p.show], [1, 1]);
});

test('a grid with no dividers still tallies', () => {
  const p = planGridVisibility(...grid('EN en DE', ['EN', 'DE']));
  assert.equal(p.cards, 3);
  assert.equal(p.visible, 3);
  assert.equal(p.done, 1, 'only the lowercase entry is checked');
});

test('done counts only VISIBLE checked cards', () => {
  // 'de' is checked but DE is filtered out, so it must not count toward N in "N / M".
  const p = planGridVisibility(...grid('en de', ['EN']));
  assert.equal(p.visible, 1);
  assert.equal(p.done, 1);
  const q = planGridVisibility(...grid('EN de', ['EN']));
  assert.equal(q.done, 0);
});

test('non-card non-divider children are never filtered', () => {
  const p = planGridVisibility(...grid('x EN', ['EN']));
  assert.equal(p.show[0], 1);
  assert.equal(p.kind[0], KIND_OTHER);
  assert.equal(p.cards, 1, 'the "other" child is not counted as a card');
});

test('an empty grid is inert', () => {
  const p = planGridVisibility(0, () => KIND_OTHER, () => true, () => true);
  assert.equal(p.cards, 0);
  assert.equal(p.visible, 0);
  assert.equal(p.show.length, 0);
});

test('blockAllHidden requires the block to actually have cards', () => {
  assert.equal(blockAllHidden(5, 0), true);
  assert.equal(blockAllHidden(5, 1), false);
  // A card-less block must stay visible: renderBySet's per-set try/catch can leave
  // one behind, and hiding it would make the failure invisible.
  assert.equal(blockAllHidden(0, 0), false);
});

test('estimateGridHeight grows with the card count and handles the edges', () => {
  const h = cards => estimateGridHeight({ cards, cols: 11 });
  assert.ok(h(100) > h(50));
  assert.ok(h(50) > h(10));
  assert.equal(h(0), estimateGridHeight({ cards: 0, cols: 11 }));
  // One column: every card is its own row.
  assert.ok(estimateGridHeight({ cards: 10, cols: 1 }) > estimateGridHeight({ cards: 10, cols: 10 }));
  // Dividers are full-width rows, so they add height of their own.
  assert.ok(estimateGridHeight({ cards: 10, dividers: 5 }) > estimateGridHeight({ cards: 10, dividers: 0 }));
  // cols is clamped, so a bogus 0 can't divide by zero into Infinity.
  assert.ok(Number.isFinite(estimateGridHeight({ cards: 10, cols: 0 })));
});

test('groups model the partial row each divider forces', () => {
  // 33 cards over 7 columns is 5 rows if you divide the total — but three dividers
  // split it into three groups of 11, each starting on a fresh row, so it is really
  // ceil(11/7) * 3 = 6 rows. Estimating from the total under-counted by a whole row,
  // which showed up as a 16% short --cv-h and scroll drift on the demo list.
  const opts = { dividers: 3, cols: 7, tilePx: 303, gapPx: 10, padPx: 16, dividerPx: 22 };
  const naive = estimateGridHeight({ cards: 33, ...opts });
  const exact = estimateGridHeight({ cards: 33, groups: [11, 11, 11], ...opts });
  assert.ok(exact > naive, 'grouped estimate must be taller than the flat one');
  assert.equal(exact - naive, 303 + 10, 'exactly one extra row');
});

test('groups falls back to the flat count when absent or empty', () => {
  const opts = { cols: 7, tilePx: 100 };
  assert.equal(
    estimateGridHeight({ cards: 20, groups: null, ...opts }),
    estimateGridHeight({ cards: 20, ...opts }),
  );
  assert.equal(
    estimateGridHeight({ cards: 20, groups: [], ...opts }),
    estimateGridHeight({ cards: 20, ...opts }),
  );
});

test('a single group matches the flat estimate exactly', () => {
  const opts = { cols: 7, tilePx: 100, dividers: 1 };
  assert.equal(
    estimateGridHeight({ cards: 20, groups: [20], ...opts }),
    estimateGridHeight({ cards: 20, ...opts }),
  );
});

test('groups tolerates junk entries instead of producing NaN', () => {
  const h = estimateGridHeight({ cards: 10, groups: [5, -3, 0], cols: 5, tilePx: 100 });
  assert.ok(Number.isFinite(h) && h > 0);
});
