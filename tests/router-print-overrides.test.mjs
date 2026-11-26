// data/print-overrides.json joined to the cards' print lists: master set (router.getCards,
// variants from the pre-built shards) and single set (router.getSetCards, variants from
// live TCGdex GraphQL). fetch is stubbed: data/ files from a table, TCGdex's set listing
// and GraphQL answered from fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const FLAGS = { normal: true, reverse: false, holo: false, firstEdition: false, wPromo: false };
const HOLO = { ...FLAGS, normal: false, holo: true };
const JUMBO = { type: 'normal', size: 'jumbo' };
const files = {
  'cat/index.json': { builtAt: 'x', langs: { en: { cards: 3, sets: 1, shards: ['p'] } } },
  'cat/en/cards-p.json': { builtAt: 'x', rows: [['svp', '001', 'Pikachu', 'P', [25]], ['svp', '027', 'Pikachu', 'P', [25]], ['svp', '050', 'Pikachu', 'P', [25]]] },
  'index.json': { pokemon: { Pikachu: 'pikachu' } },
  'cards/pikachu.json': { builtAt: 'x', cards: [
    { id: 'svp-001', name: 'Pikachu', species: 'Pikachu', image: 'https://assets.tcgdex.net/en/sv/svp/001', localId: '001', variants: HOLO },
    { id: 'svp-027', name: 'Pikachu', species: 'Pikachu', image: 'https://assets.tcgdex.net/en/sv/svp/027', localId: '027', variants: { ...FLAGS, prints: [{ type: 'normal' }, JUMBO] } },
    { id: 'svp-050', name: 'Pikachu', species: 'Pikachu', image: 'https://assets.tcgdex.net/en/sv/svp/050', localId: '050', variants: { ...FLAGS } },
  ] },
  'sets.json': {
    builtAt: 'x', names: { en: { svp: 'SVP Black Star Promos' } }, dates: { svp: '2023-03-31' }, symbols: {}, logos: {},
    counts: { svp: { official: 225, total: 226 } }, setSeries: { svp: 'sv' }, series: { en: [{ id: 'sv', name: 'Scarlet & Violet' }] }, lang: {},
  },
  'print-overrides.json': { schemaVersion: 1, prints: [
    { lang: 'en', card: 'svp-001', type: 'holo', size: 'jumbo', source: 'https://t', issue: 9 },
    { lang: 'en', card: 'svp-027', type: 'holo', size: 'jumbo', source: 'https://t', issue: 9 },   // TCGdex has a Jumbo print: its own stays
    { lang: 'de', card: 'svp-050', type: 'holo', size: 'jumbo', source: 'https://t', issue: 9 },   // another language
  ] },
};

globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('file:')) {
    const key = Object.keys(files).find(k => u.endsWith(`/data/${k}`));
    if (!key) return { ok: false, status: 404, json: async () => null };
    return { ok: true, status: 200, json: async () => structuredClone(files[key]) };
  }
  const answer = body => ({ ok: true, status: 200, json: async () => body });
  if (u.endsWith('/v2/en/sets/svp')) {
    return answer({ id: 'svp', name: 'SVP Black Star Promos', serie: { id: 'sv', name: 'Scarlet & Violet' },
      cards: [{ id: 'svp-001', localId: '001', name: 'Pikachu' }, { id: 'svp-050', localId: '050', name: 'Pikachu' }] });
  }
  if (u.endsWith('/v2/graphql') && JSON.parse(init.body).variables.f.id === 'svp-') {
    return answer({ data: { cards: [
      { id: 'svp-001', variants: HOLO, variants_detailed: [{ type: 'holo', size: 'standard' }] },
      { id: 'svp-050', variants: FLAGS, variants_detailed: [{ type: 'normal' }] },
    ] } });
  }
  throw new TypeError('fetch failed');
};

const { getCards, getSetCards, resetHealth } = await import('../js/api/router.js');
const { printsOf } = await import('../js/ui/prints-model.js');
const keys = c => printsOf(c.variants).map(p => p.key);

test('master set: a Jumbo print joins its card; TCGdex\'s own Jumbo print wins', async () => {
  resetHealth();
  const res = await getCards(['Pikachu']);
  assert.equal(res.source, 'catalogue');
  const byId = Object.fromEntries(res.cards.map(c => [c.id, c]));
  assert.deepEqual(keys(byId['svp-001']), ['holo', 'holo.jumbo']);
  assert.deepEqual(keys(byId['svp-027']), ['normal', 'normal.jumbo'], 'not a second Jumbo print');
  assert.deepEqual(keys(byId['svp-050']), ['normal'], 'the German row is not this card\'s language');
});

test('single set: the set\'s cards get their language\'s Jumbo prints too', async () => {
  resetHealth();
  const res = await getSetCards('svp', { lang: 'en' });
  assert.equal(res.source, 'tcgdex');
  assert.deepEqual(res.cards.map(keys), [['holo', 'holo.jumbo'], ['normal']]);
});
