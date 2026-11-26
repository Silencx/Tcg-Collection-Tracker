// data/overrides.json merged into the app's card lists: master set (router.getCards),
// single set (router.getSetCards) and the Japanese cards (jp-source.getJpCards).
// fetch is stubbed like router-catalog.test.mjs: data/ files from a table, every live
// request failing like a dead network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const files = {
  'cat/index.json': { builtAt: 'x', langs: {
    en: { cards: 2, sets: 1, shards: ['p'] },
    de: { cards: 2, sets: 1, shards: ['p'] },
  } },
  'cat/en/cards-p.json': { builtAt: 'x', rows: [['svp', '001', 'Pikachu', 'P', [25]], ['svp', '027', 'Pikachu', 'P', [25]]] },
  'cat/de/cards-p.json': { builtAt: 'x', rows: [['svp', '001', 'Pikachu', 'P'], ['svp', '027', 'Pikachu', 'P']] },
  'sets.json': {
    builtAt: 'x', names: { en: { svp: 'SVP Black Star Promos' }, de: { svp: 'SVP Black Star Promos' } },
    dates: { svp: '2023-03-31' }, symbols: {}, logos: {}, counts: { svp: { official: 225, total: 226 } },
    setSeries: { svp: 'sv' }, series: { en: [{ id: 'sv', name: 'Scarlet & Violet' }] }, lang: {},
  },
  'jp-cat/sets.json': { builtAt: 'x', sets: [{ key: 'vstar-universe', name: 'VSTAR Universe', code: 'S12a', date: '2022-12-02', era: 'swsh', limitless: 'S12a', sym: null, cards: 262 }] },
  'jp-cat/cards-p.json': { builtAt: 'x', rows: [['vstar-universe', '001/172', 'Pikachu', null, '1']] },
  'overrides.json': { schemaVersion: 1, overrides: [
    { lang: 'en', set: 'svp', number: '013', name: 'Pikachu', dexId: [25], source: 'https://x', issue: 1 },
    { lang: 'en', set: 'svp', number: '027', name: 'Pikachu', source: 'https://x', issue: 2 },   // listed: the source's entry wins
    { lang: 'en', set: 'svp', number: '014', name: 'Mew', source: 'https://x', issue: 3 },       // another Pokémon
    { lang: 'de', set: 'svp', number: '023', name: 'Pikachu', source: 'https://x', issue: 4 },
    { lang: 'ja', set: 'vstar-universe', number: '263/172', name: 'Pikachu VMAX', source: 'https://x', issue: 5 },
    { lang: 'ja', set: 'not-in-the-catalogue', number: '1', name: 'Pikachu', source: 'https://x', issue: 6 },
  ] },
};

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith('file:')) {
    const key = Object.keys(files).find(k => u.endsWith(`/data/${k}`));
    if (!key) return { ok: false, status: 404, json: async () => null };
    return { ok: true, status: 200, json: async () => structuredClone(files[key]) };
  }
  throw new TypeError('fetch failed');
};

const { getCards, getSetCards, resetHealth } = await import('../js/api/router.js');
const { getJpCards } = await import('../js/api/jp-source.js');

test('master set: English overrides come after the source, matched like any card', async () => {
  resetHealth();
  const res = await getCards(['Pikachu']);
  assert.equal(res.source, 'catalogue', 'the source that answered, not the overrides');
  assert.deepEqual(res.cards.map(c => c.id), ['svp-001', 'svp-027', 'svp-013']);
  const added = res.cards[2];
  assert.equal(added.species, 'Pikachu');
  assert.equal(added.image, 'https://assets.tcgdex.net/en/sv/svp/013', 'buildSetsMap reads the set from it');
});

test('single set: the language\'s overrides for that set, in number order', async () => {
  resetHealth();
  const de = await getSetCards('svp', { lang: 'de' });
  assert.equal(de.source, 'catalogue');
  assert.deepEqual(de.cards.map(c => c.localId), ['001', '023', '027']);
  assert.equal(de.cards[1].image, null);
  const en = await getSetCards('svp', { lang: 'en' });
  assert.deepEqual(en.cards.map(c => c.localId), ['001', '013', '014', '027']);
});

test('single set: overrides never make a set out of nothing', async () => {
  resetHealth();
  await assert.rejects(getSetCards('svp', { lang: 'th' }), /fetch failed/);
});

test('Japanese: an override in a catalogue set joins with its stable id', async () => {
  const jp = await getJpCards(['Pikachu'], { live: false });
  assert.equal(jp.source, 'catalogue');
  assert.deepEqual(jp.rows.map(r => r.id), ['JP_vstar-universe_1', 'JP_vstar-universe_263']);
  assert.equal(jp.rows[1].number, '263/172');
  assert.equal(jp.rows[1].pokemonName, 'Pikachu');
});
