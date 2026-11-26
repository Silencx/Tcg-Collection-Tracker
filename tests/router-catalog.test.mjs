// The router with the card catalogue (data/cat/) in place: catalogue first, then the
// per-Pokémon shards, then live TCGdex; single-set mode falls back to the catalogue.
// fetch is stubbed: data/ files come from an in-memory table, and every live request
// fails like a dead network (and is recorded).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const V = { normal: true, reverse: true, holo: false, firstEdition: false, wPromo: false };
const files = {
  'cat/index.json': { builtAt: 'x', langs: {
    en: { cards: 4, sets: 2, shards: ['m', 'n', 's'] },
    de: { cards: 1, sets: 1, shards: ['s'] },
  } },
  'cat/en/cards-s.json': { builtAt: 'x', rows: [['sv05', '1', 'Seedot', 'P'], ['sv05', '2', 'Seedot & Nuzleaf-GX', 'P']] },
  'cat/en/cards-n.json': { builtAt: 'x', rows: [['sv05', '2', 'Seedot & Nuzleaf-GX', 'P'], ['sv05', '3', 'Nuzleaf', 'P']] },
  // cards-m.json is listed but missing: the catalogue must not answer for an M Pokémon.
  'cat/de/cards-s.json': { builtAt: 'x', rows: [['sv05', '1', 'Samurzel', 'P']] },
  'index.json': { pokemon: { Seedot: 'seedot' } },
  'cards/seedot.json': { builtAt: 'x', cards: [
    { id: 'sv05-1', name: 'Seedot', species: 'Seedot', image: 'https://assets.tcgdex.net/en/sv/sv05/1', localId: '1', variants: V },
  ] },
  'sets.json': {
    builtAt: 'x', names: { en: { sv05: 'Temporal Forces' }, de: { sv05: 'Gewalten der Zeit' } },
    dates: { sv05: '2024-03-22' }, symbols: {}, logos: {}, counts: { sv05: { official: 162, total: 218 } },
    setSeries: { sv05: 'sv' }, series: { en: [{ id: 'sv', name: 'Scarlet & Violet' }] }, lang: {},
  },
};

const live = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('file:')) {
    const key = Object.keys(files).find(k => u.endsWith(`/data/${k}`));
    if (!key) return { ok: false, status: 404, json: async () => null };
    return { ok: true, status: 200, json: async () => structuredClone(files[key]) };
  }
  live.push({ url: u, body: init?.body ? String(init.body) : '' });
  throw new TypeError('fetch failed');
};

const { getCards, getSetCards, resetHealth } = await import('../js/api/router.js');

test('the catalogue answers first; pre-built variants are used, the rest asked live', async () => {
  resetHealth();
  live.length = 0;
  const res = await getCards(['Seedot', 'Nuzleaf']);
  assert.equal(res.source, 'catalogue');
  assert.equal(res.missing, undefined, 'a complete answer the caller may cache');
  assert.deepEqual(res.cards.map(c => [c.id, c.species]), [['sv05-1', 'Seedot'], ['sv05-2', 'Seedot'], ['sv05-3', 'Nuzleaf']]);
  assert.deepEqual(res.cards[0].variants, V, 'from the pre-built shard');
  assert.equal(res.cards[2].variants, undefined, 'TCGdex was down: no badges, but the card is there');
  assert.equal(res.cards[2].image, 'https://assets.tcgdex.net/en/sv/sv05/3');
  // Variants were asked for the Pokémon with no shard only, and no card list was fetched.
  assert.ok(live.length > 0);
  assert.ok(live.every(r => !/\/cards\?name=/.test(r.url)), 'no live name search');
  const gql = live.filter(r => r.url.endsWith('/graphql')).map(r => r.body).join(' ');
  assert.match(gql, /Nuzleaf/);
  assert.doesNotMatch(gql, /Seedot/);
});

test('a catalogue that cannot answer whole falls back to the shards, then live', async () => {
  resetHealth();
  live.length = 0;
  await assert.rejects(getCards(['Mew']));
  assert.ok(live.some(r => r.url.includes('/en/cards?name=Mew')), 'went on to the live name search');
});

test('a forced refresh skips the catalogue and goes live', async () => {
  resetHealth();
  live.length = 0;
  await assert.rejects(getCards(['Seedot'], { forceRefresh: true }));
  assert.ok(live.some(r => r.url.includes('/en/cards?name=Seedot')));
});

test('single-set mode: TCGdex down → the set from the catalogue, details from sets.json', async () => {
  resetHealth();
  const res = await getSetCards('sv05', { lang: 'de' });
  assert.equal(res.source, 'catalogue');
  assert.deepEqual(res.cards, [{
    id: 'sv05-1', name: 'Samurzel', species: 'Samurzel', image: 'https://assets.tcgdex.net/de/sv/sv05/1', localId: '1',
  }]);
  assert.equal(res.set.name, 'Gewalten der Zeit');
  assert.deepEqual(res.set.count, { official: 162, total: 218 });
  assert.equal(res.set.serie.id, 'sv');
});

test('single-set mode: a set the catalogue lacks still fails with the live error', async () => {
  resetHealth();
  await assert.rejects(getSetCards('sv06', { lang: 'en' }), /fetch failed/);
});
