import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextAllCollapsed, isAllCollapsed, collapseButtonLabel, headChevron, headChevronLabel,
} from '../js/ui/collapse-model.js';

test('mixed state collapses, matching selectSet\'s "any" semantics', () => {
  // One expanded out of many → collapse everything.
  assert.equal(nextAllCollapsed(41, 40), true);
  assert.equal(nextAllCollapsed(41, 1), true);
  assert.equal(nextAllCollapsed(41, 0), true);
});

test('only a fully collapsed page expands', () => {
  assert.equal(nextAllCollapsed(41, 41), false);
  assert.equal(nextAllCollapsed(1, 1), false);
});

test('an empty page is a no-op rather than a phantom collapse', () => {
  // Guards the window between container.innerHTML='' and the first block landing.
  assert.equal(nextAllCollapsed(0, 0), false);
  assert.equal(isAllCollapsed(0, 0), false);
});

test('isAllCollapsed only reports true when every block is collapsed', () => {
  assert.equal(isAllCollapsed(41, 41), true);
  assert.equal(isAllCollapsed(41, 40), false);
  assert.equal(isAllCollapsed(0, 0), false);
});

test('toggling twice from any state returns to that state', () => {
  // The button must not need two clicks to do anything — the exact desync that made
  // "collapse all → Refresh → click" a visual no-op.
  for (const [total, collapsed] of [[41, 0], [41, 41], [41, 20], [1, 0], [1, 1]]) {
    const first = nextAllCollapsed(total, collapsed);
    const after = first ? total : 0;                  // every block now matches `first`
    const second = nextAllCollapsed(total, after);
    assert.notEqual(first, second, `stuck at total=${total} collapsed=${collapsed}`);
  }
});

test('labels and chevrons describe the ACTION, not the state', () => {
  assert.equal(collapseButtonLabel(true), '▸ Expand all');
  assert.equal(collapseButtonLabel(false), '▾ Collapse all');
  assert.equal(headChevron(true), '▸');
  assert.equal(headChevron(false), '▾');
  assert.equal(headChevronLabel(true), 'Expand this set');
  assert.equal(headChevronLabel(false), 'Collapse this set');
});
