import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeState, wheelTarget } from '../js/ui/hscroll-model.js';

// ── edgeState ─────────────────────────────────────────────────────────────────
test('a row that fits gets no fade at all', () => {
  // The common desktop case. Any fade here would permanently dim the ends of every
  // chrome row on a wide screen.
  assert.deepEqual(edgeState(0, 600, 600), { start: false, end: false });
  assert.deepEqual(edgeState(0, 599, 600), { start: false, end: false });
});

test('an unscrolled overflowing row fades only its right edge', () => {
  // 500px viewport, measured: #filter-pills was 475 wide over 670 of pills.
  assert.deepEqual(edgeState(0, 670, 475), { start: false, end: true });
});

test('a fully-scrolled row fades only its left edge', () => {
  assert.deepEqual(edgeState(195, 670, 475), { start: true, end: false });
});

test('a mid-scrolled row fades both edges', () => {
  assert.deepEqual(edgeState(90, 670, 475), { start: true, end: true });
});

test('sub-pixel scroll positions do not leave a stuck fade', () => {
  // scrollLeft is fractional on a fractionally-scaled display, so an exact comparison
  // against scrollWidth-clientWidth leaves a permanent 0.5px "more to the right".
  assert.equal(edgeState(194.5, 670, 475).end, false);
  assert.equal(edgeState(0.5, 670, 475).start, false);
  // A 1px overflow is not worth a 26px fade either.
  assert.deepEqual(edgeState(0, 476, 475), { start: false, end: false });
});

// ── wheelTarget ───────────────────────────────────────────────────────────────
test('a wheel tick moves an overflowing row', () => {
  assert.equal(wheelTarget(0, 670, 475, 100), 100);
  assert.equal(wheelTarget(100, 670, 475, -100), 0);
});

test('the wheel is clamped to the row', () => {
  assert.equal(wheelTarget(150, 670, 475, 400), 195);   // max = 670-475
  assert.equal(wheelTarget(50, 670, 475, -400), 0);
});

test('a row that cannot take the scroll returns null so the PAGE scrolls', () => {
  // The whole point: swallowing these would trap the page scroll whenever the pointer
  // crossed the toolbar.
  assert.equal(wheelTarget(0, 600, 600, 100), null, 'row does not overflow');
  assert.equal(wheelTarget(195, 670, 475, 100), null, 'already at the right end');
  assert.equal(wheelTarget(0, 670, 475, -100), null, 'already at the left end');
  assert.equal(wheelTarget(0, 670, 475, 0), null, 'no delta');
});
