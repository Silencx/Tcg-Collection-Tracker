// The live card index matched by Pokédex number (providers/tcgdex.js getCards with
// dexByName): a second, exact search by number finds what the name search cannot, and
// GraphQL's numbers keep a wrongly numbered card out. fetch is stubbed: the REST name and
// number searches and GraphQL answer from the tables below; `gqlDown` fails GraphQL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dexByNameFrom } from '../js/api/match-model.js';

const CARDS = {
  'sv03.5-029': { name: 'Nidoran♀', dexId: [29] },
  'lc-82': { name: 'Nidoran ♀', dexId: [29] },
  'base1-6': { name: 'Gyarados', dexId: [130] },
  'mfb-22': { name: 'Electrode', dexId: [130] },   // TCGdex's number, wrong
  'base1-21': { name: 'Electrode', dexId: [101] },
  'svp-500': { name: 'Terapagos & Friends', dexId: [25, 906, 909, 912, 1024] },
  'base1-58': { name: 'Pikachu', dexId: [25] },
};
const item = id => ({ id, localId: id.split('-').pop(), name: CARDS[id].name });
const byName = name => Object.keys(CARDS).filter(id => CARDS[id].name.toLowerCase().includes(name.toLowerCase()));
const byDex = n => Object.keys(CARDS).filter(id => CARDS[id].dexId.includes(n));

let gqlDown = false;
const requests = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  requests.push(u);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  let m = /\/v2\/en\/cards\?name=([^&]+)$/.exec(u);
  if (m) return json(byName(decodeURIComponent(m[1])).map(item));
  m = /\/v2\/en\/cards\?dexId=eq:(\d+)$/.exec(u);
  if (m) return json(byDex(Number(m[1])).map(item));
  if (u.endsWith('/graphql')) {
    if (gqlDown) throw new TypeError('fetch failed');
    const { f, p } = JSON.parse(init.body).variables;
    const ids = p > 1 ? [] : f.dexId ? byDex(f.dexId) : byName(f.name);
    return json({ data: { cards: ids.map(id => ({ id, dexId: CARDS[id].dexId, variants: { normal: true } })) } });
  }
  throw new TypeError('fetch failed');
};

const { getCards } = await import('../js/api/providers/tcgdex.js');
const DEX = dexByNameFrom([
  { name: 'Pikachu', dex: 25 }, { name: 'Nidoran♀', dex: 29 }, { name: 'Electrode', dex: 101 },
  { name: 'Gyarados', dex: 130 }, { name: 'Terapagos', dex: 1024 },
]);
const ids = cards => cards.map(c => c.id).sort();

test('the number search adds the cards the name search cannot find', async () => {
  gqlDown = false;
  const cards = await getCards(['Nidoran♀'], { dexByName: DEX });
  assert.deepEqual(ids(cards), ['lc-82', 'sv03.5-029']);
  assert.ok(cards.every(c => c.species === 'Nidoran♀' && c.variants));
  assert.equal(cards.find(c => c.id === 'lc-82').name, 'Nidoran ♀', 'the printed name is kept');
});

test('a wrongly numbered card stays with the Pokémon it names', async () => {
  gqlDown = false;
  assert.deepEqual(ids(await getCards(['Gyarados'], { dexByName: DEX })), ['base1-6']);
  assert.deepEqual(ids(await getCards(['Electrode'], { dexByName: DEX })), ['base1-21', 'mfb-22']);
});

test('a cameo goes to the first-listed Pokémon, as with names', async () => {
  gqlDown = false;
  const cards = await getCards(['Pikachu', 'Terapagos'], { dexByName: DEX });
  assert.equal(cards.find(c => c.id === 'svp-500').species, 'Pikachu');
  assert.equal(cards.filter(c => c.id === 'svp-500').length, 1);
});

test('GraphQL down: number hits are checked against what is known, names still count', async () => {
  gqlDown = true;
  assert.deepEqual(ids(await getCards(['Nidoran♀'], { dexByName: DEX })), ['lc-82', 'sv03.5-029']);
  // Only "carries 25" is known, and the name names Terapagos: not believed. A smaller
  // list for as long as GraphQL is down, never a wrong one.
  assert.deepEqual(ids(await getCards(['Pikachu'], { dexByName: DEX })), ['base1-58']);
});

test('without the species list: the name search alone, and no number search', async () => {
  gqlDown = false;
  requests.length = 0;
  assert.deepEqual(ids(await getCards(['Nidoran♀'])), ['sv03.5-029']);
  assert.ok(requests.every(u => !u.includes('dexId=')));
});
