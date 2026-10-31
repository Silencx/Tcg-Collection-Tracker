// router.getSetMeta on the live path. The browser never sweeps TCGdex's /series (only the
// build does), so live set meta borrows setSeries and the series names from the snapshot:
// Master Set's era headings are named from them (ui/era-model.js). fetch is stubbed: the
// snapshot's data/ files come from an in-memory table, TCGdex from canned responses.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SETS = {
  builtAt: '2026-10-30',
  names: { en: { sv05: 'Temporal Forces' } },
  dates: { sv05: '2024-03-22' },
  setSeries: { sv05: 'sv', cel25: 'swsh', newset: 'sv' },
  series: { en: [{ id: 'sv', name: 'Scarlet & Violet' }, { id: 'swsh', name: 'Sword & Shield' }] },
};
const files = {};

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith('file:')) {
    const key = Object.keys(files).find(k => u.endsWith(`/data/${k}`));
    if (!key) return { ok: false, status: 404, json: async () => null };
    return { ok: true, status: 200, json: async () => files[key] };
  }
  const ok = body => ({ ok: true, status: 200, json: async () => body });
  // Every language's /sets list; cel25 is dated there, newset only on its detail page.
  if (/\/v2\/[^/]+\/sets$/.test(u)) {
    return ok([{ id: 'cel25', name: 'Celebrations', releaseDate: '2021-10-08' }, { id: 'newset', name: 'New' }]);
  }
  if (u.endsWith('/v2/en/sets/newset')) return ok({ id: 'newset', releaseDate: '2026-11-01', serie: { id: 'me' } });
  return { ok: false, status: 404, json: async () => null };
};

const { getSetMeta, resetHealth } = await import('../js/api/router.js');

// First: the snapshot's memo keeps a successful read for the session, so the
// no-snapshot case has to run before sets.json exists.
test('without a snapshot, live set meta is returned as it was', async () => {
  resetHealth();
  const meta = await getSetMeta({ forceRefresh: true, setIds: ['cel25'] });
  assert.equal(meta.source, 'tcgdex');
  assert.equal(meta.setSeries.cel25, undefined);
  assert.deepEqual(meta.series, {});
});

test('a forced refresh still carries the series structure, from the snapshot', async () => {
  files['sets.json'] = SETS;
  resetHealth();
  const meta = await getSetMeta({ forceRefresh: true, setIds: ['cel25'] });
  assert.equal(meta.source, 'tcgdex');
  assert.equal(meta.dates.cel25, '2021-10-08');
  assert.equal(meta.setSeries.cel25, 'swsh');
  assert.equal(meta.setSeries.sv05, 'sv');
  assert.deepEqual(meta.series.en.map(s => s.name), ['Scarlet & Violet', 'Sword & Shield']);
});

test('a series TCGdex reported live wins over the snapshot', async () => {
  files['sets.json'] = SETS;
  resetHealth();
  const meta = await getSetMeta({ forceRefresh: true, setIds: ['newset'] });
  assert.equal(meta.setSeries.newset, 'me');
});
