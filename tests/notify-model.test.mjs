import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheAge, ttlFor, pushNotice, unreadCount, bellLabel, toPlainText,
  nextNoticeId, dropNotice,
} from '../js/ui/notify-model.js';

// ── cacheAge (moved here from masterset.js, untested until now) ───────────────
test('cacheAge picks the coarsest unit that applies', () => {
  const now = Date.parse('2026-07-30T12:00:00Z');
  const ago = (ms) => cacheAge(now - ms, now);
  assert.equal(ago(0), 'just now');
  assert.equal(ago(59 * 1000), 'just now');
  assert.equal(ago(60 * 1000), '1m ago');
  assert.equal(ago(59 * 60 * 1000), '59m ago');
  assert.equal(ago(60 * 60 * 1000), '1h ago');
  assert.equal(ago(23 * 60 * 60 * 1000), '23h ago');
  assert.equal(ago(24 * 60 * 60 * 1000), '1d ago');
  assert.equal(ago(3 * 24 * 60 * 60 * 1000), '3d ago');
});

// ── ttlFor: which banners are allowed to disappear on their own ──────────────
test('purely informational banners auto-dismiss', () => {
  assert.equal(ttlFor('banner-blue'), 8000);    // "Loaded from cache"
  assert.equal(ttlFor('banner-green'), 6000);   // "No new cards"
  assert.equal(ttlFor('banner-new'), 20000);    // "N new cards found"
});

test('a banner with its own control never auto-dismisses', () => {
  // The fetch-failure banner carries a Retry button.
  assert.equal(ttlFor('banner-error'), 0);
  assert.equal(ttlFor('banner-blue', { hasAction: true }), 0);
});

test('a dismissKey outranks any TTL', () => {
  // dismissKey means the user decides and the decision persists; a timer would
  // silently override that.
  assert.equal(ttlFor('banner-blue', { dismissKey: 'src-fallback' }), 0);
  assert.equal(ttlFor('banner-amber', { dismissKey: 'plang-KR' }), 0);
});

test('an in-progress banner is never put on a timer', () => {
  // banner-load is removed programmatically when the work finishes; expiring it would
  // hide a spinner while the work was still running.
  assert.equal(ttlFor('banner-load'), 0);
  assert.equal(ttlFor('something-unknown'), 0);
});

// ── log ───────────────────────────────────────────────────────────────────────
test('pushNotice appends without mutating and caps the oldest away', () => {
  const a = [{ ts: 1, text: 'a' }];
  const b = pushNotice(a, { ts: 2, text: 'b' }, 30);
  assert.equal(a.length, 1, 'input array must not be mutated');
  assert.deepEqual(b.map(n => n.text), ['a', 'b']);

  let list = [];
  for (let i = 0; i < 35; i++) list = pushNotice(list, { ts: i, text: `n${i}` }, 30);
  assert.equal(list.length, 30);
  assert.equal(list[0].text, 'n5', 'oldest entries drop off the front');
  assert.equal(list[29].text, 'n34');
});

test('unreadCount counts only entries newer than the last open', () => {
  const list = [{ ts: 10 }, { ts: 20 }, { ts: 30 }];
  assert.equal(unreadCount(list, 0), 3);
  assert.equal(unreadCount(list, 20), 1);
  assert.equal(unreadCount(list, 30), 0);
  assert.equal(unreadCount([], 0), 0);
});

// ── dismissal ─────────────────────────────────────────────────────────────────
test('ids are unique even for entries recorded in the same tick', () => {
  // This is the whole reason entries are not keyed on ts: the fetch-failure path
  // records twice within one tick (mkBanner, then masterset.js's catch), so both
  // land on the same Date.now() and a ts-keyed dismiss would take out both rows.
  const ts = Date.now();
  const a = { id: nextNoticeId(), ts, text: 'boom' };
  const b = { id: nextNoticeId(), ts, text: 'boom' };
  assert.notEqual(a.id, b.id);

  const left = dropNotice([a, b], a.id);
  assert.deepEqual(left.map(n => n.id), [b.id], 'only the clicked row goes');
});

test('dropNotice removes one entry without mutating, and ignores unknown ids', () => {
  const list = [{ id: 1, ts: 10 }, { id: 2, ts: 20 }, { id: 3, ts: 30 }];
  assert.deepEqual(dropNotice(list, 2).map(n => n.id), [1, 3]);
  assert.equal(list.length, 3, 'input array must not be mutated');
  assert.deepEqual(dropNotice(list, 99).map(n => n.id), [1, 2, 3]);
});

test('dismissing an unread entry decrements the badge', () => {
  // renderBadge recomputes from unreadCount(log, lastSeenTs), so this falls out for free.
  const list = [{ id: 1, ts: 10 }, { id: 2, ts: 20 }];
  assert.equal(unreadCount(list, 5), 2);
  assert.equal(unreadCount(dropNotice(list, 2), 5), 1);
});

test('the bell label carries the count, so it is not visual-only', () => {
  assert.equal(bellLabel(0), 'Notifications');
  assert.equal(bellLabel(3), 'Notifications, 3 unread');
});

// ── text extraction ───────────────────────────────────────────────────────────
test('toPlainText strips the markup banners are written in', () => {
  assert.equal(
    toPlainText('🆕 <strong>2 new card(s) found</strong>: Seedot, Shiftry'),
    '🆕 2 new card(s) found: Seedot, Shiftry',
  );
  assert.equal(toPlainText('a &amp; b &lt;c&gt;'), 'a & b <c>');
  assert.equal(toPlainText('  spaced   out \n text '), 'spaced out text');
  assert.equal(toPlainText(''), '');
});
