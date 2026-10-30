// router.getCards with TCGdex down — the card index has no fallback behind TCGdex.
// fetch is stubbed: the snapshot's data/ files come
// from an in-memory table, every other request fails like a dead network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SEEDOT = { id: 'sv05-1', name: 'Seedot', species: 'Seedot', image: 'x', localId: '1' };
const files = {
  'index.json': { pokemon: { Seedot: 'seedot' } },
  'cards/seedot.json': { builtAt: '2026-10-26', cards: [SEEDOT] },
};

const liveUrls = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith('file:')) {
    const key = Object.keys(files).find(k => u.endsWith(`/data/${k}`));
    if (!key) return { ok: false, status: 404, json: async () => null };
    return { ok: true, status: 200, json: async () => files[key] };
  }
  liveUrls.push(u);
  throw new TypeError('fetch failed');
};

const { getCards, resetHealth } = await import('../js/api/router.js');

test('a partial snapshot hit survives TCGdex being down, and says what it lacks', async () => {
  resetHealth();
  const res = await getCards(['Seedot', 'Shiftry']);
  assert.deepEqual(res.cards.map(c => c.id), ['sv05-1']);
  assert.equal(res.source, 'snapshot');
  assert.deepEqual(res.missing, ['Shiftry']);
});

test('a full snapshot hit carries no `missing`, so the caller may cache it', async () => {
  resetHealth();
  const res = await getCards(['Seedot']);
  assert.equal(res.source, 'snapshot');
  assert.equal(res.missing, undefined);
});

test('nothing in the snapshot and TCGdex down → rejects; no other host is tried', async () => {
  resetHealth();
  liveUrls.length = 0;
  await assert.rejects(getCards(['Shiftry']));
  assert.ok(liveUrls.length > 0, 'TCGdex was attempted');
  for (const u of liveUrls) assert.match(u, /^https:\/\/api\.tcgdex\.net\//);
});

test('once TCGdex failed, later calls fail fast until a forced refresh', async () => {
  resetHealth();
  await assert.rejects(getCards(['Shiftry']));
  liveUrls.length = 0;
  await assert.rejects(getCards(['Shiftry']));
  assert.equal(liveUrls.length, 0, 'no re-attempt within the session');
  await assert.rejects(getCards(['Shiftry'], { forceRefresh: true }));
  assert.ok(liveUrls.length > 0, 'forced refresh re-attempts TCGdex');
});
