// The card-detail fetch used to fire one request per modern card with no bound —
// hundreds in parallel for a popular Pokémon. pooledForEach caps that. A pool
// that silently skips items would lose variant data quietly, so both the cap and
// the completeness are asserted here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pooledForEach } from '../js/api/providers/tcgdex.js';

const tick = () => new Promise(r => setTimeout(r, 1));

test('every item is processed exactly once', async () => {
  const items = Array.from({ length: 50 }, (_, i) => i);
  const seen = [];
  await pooledForEach(items, 6, async i => { await tick(); seen.push(i); });
  assert.equal(seen.length, items.length);
  assert.deepEqual([...seen].sort((a, b) => a - b), items);
});

test('never exceeds the concurrency limit', async () => {
  const limit = 6;
  let inFlight = 0, peak = 0;
  await pooledForEach(Array.from({ length: 40 }), limit, async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await tick();
    inFlight--;
  });
  assert.ok(peak <= limit, `peak concurrency ${peak} exceeded limit ${limit}`);
  assert.ok(peak > 1, `expected real parallelism, saw peak ${peak}`);
});

test('runs in parallel rather than sequentially', async () => {
  // 12 items × ~10ms at concurrency 6 ≈ 2 waves. Sequential would be ~12 waves;
  // a generous bound keeps this from flaking on a slow machine.
  const started = Date.now();
  await pooledForEach(Array.from({ length: 12 }), 6, () => new Promise(r => setTimeout(r, 10)));
  assert.ok(Date.now() - started < 100, 'expected pooled execution, not sequential');
});

test('fewer items than the limit still completes', async () => {
  const seen = [];
  await pooledForEach([1, 2], 6, async n => { seen.push(n); });
  assert.deepEqual(seen.sort(), [1, 2]);
});

test('an empty list resolves without spawning workers', async () => {
  let calls = 0;
  await pooledForEach([], 6, async () => { calls++; });
  assert.equal(calls, 0);
});
