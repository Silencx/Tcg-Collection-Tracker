// TCGplayer's Jumbo cards traced back to the card each one enlarges, as Jumbo prints for
// data/print-overrides.json (tools/lib/jumbo.mjs, tools/lib/print-overrides.mjs,
// tools/jumbo-prints.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  productFacts, bareName, looseName, catalogueIndex, traceOriginal, printingType, flagType, jumboPrintRows,
} from '../tools/lib/jumbo.mjs';
import { rowJson, sortPrintRows, formatPrintOverrides, withImport } from '../tools/lib/print-overrides.mjs';
import { readPrintOverrides } from '../js/api/print-overrides-model.js';

let nextId = 1;
const product = (number, name) => ({ productId: nextId++, name, extendedData: number == null ? [] : [{ name: 'Rarity', value: 'Promo' }, { name: 'Number', value: number }] });

// Catalogue rows as data/cat/en/ has them: [set, number, name, kind, dexIds].
const CATALOGUE = [
  ['xyp', 'XY17', 'Charizard-EX', 'P', [6]],
  ['xyp', 'XY17', 'Charizard-EX', 'P', [6]],                   // a shard repeat
  ['xy3', '74', 'Dragonite-EX', 'P', [149]],
  ['sm2', '74', 'Dragonite-EX', 'P', [149]],                   // same number, other set size
  ['base1', '58', 'Pikachu', 'P', [25]],
  ['ex1', '94', 'Metal Energy', 'E'],
  ['ex7', '94', 'Metal Energy', 'E'],                          // two sets of 109 cards
  ['jumbo', 'XY17', 'Charizard-EX', 'P', [6]],                 // the Jumbo set is never an original
  ['A1', '74', 'Dragonite-EX', 'P', [149]],                    // TCG Pocket is not printed
];
const SETS = { setSeries: { A1: 'tcgp' }, counts: { xy3: { official: 111 }, sm2: { official: 145 }, base1: { official: 102 }, ex1: { official: 109 }, ex7: { official: 109 } } };
const index = catalogueIndex(CATALOGUE, { setSeries: SETS.setSeries });

test('a product gives its id, number and name; the name loses its notes and number tail', () => {
  assert.deepEqual(productFacts({ ...product('XY17', 'Charizard EX - XY17'), productId: 7 }), { id: 7, number: 'XY17', name: 'Charizard EX - XY17' });
  assert.deepEqual(productFacts(null), { id: null, number: '', name: '' });
  assert.equal(bareName('Charizard EX - XY17 (XY Black Star Promos)'), 'Charizard EX');
  assert.equal(bareName('Ash-Greninja EX - XY133'), 'Ash-Greninja EX', 'a hyphen inside the name stays');
  assert.equal(bareName('Charizard ex -196'), 'Charizard ex');
  assert.equal(bareName('Espeon & Deoxys GX Oversized - SM240 (SM Black Star Promo)'), 'Espeon & Deoxys GX');
  assert.equal(bareName('Grovyle - 004 (e-League) [Winner]'), 'Grovyle');
  assert.equal(looseName('Charizard-EX'), looseName('Charizard EX'));
  assert.equal(looseName('Flabébé'), 'flabebe');
});

test('the index keeps one card per set and number, without the Jumbo set or TCG Pocket', () => {
  assert.deepEqual(index.get('XY17'), [{ set: 'xyp', number: 'XY17', name: 'Charizard-EX' }]);
  assert.deepEqual(index.get('74').map(c => c.set), ['xy3', 'sm2']);
});

test('a Jumbo card traces to the one card with its number, set size and name', () => {
  const trace = (n, name) => traceOriginal({ number: n, name }, index, { counts: SETS.counts });
  assert.equal(trace('XY17', 'Charizard EX - XY17 (XY Black Star Promos)').card.set, 'xyp');
  assert.equal(trace('074/111', 'Dragonite EX - 74/111').card.set, 'xy3', 'the set of 111 cards, not the other 74');
  assert.equal(trace('074/145', 'Dragonite EX - 74/145').card.set, 'sm2');
  assert.deepEqual(trace('074/999', 'Dragonite EX'), { reason: 'no card of ours with this number and name' }, 'no set of that size');
  assert.deepEqual(trace('XY17', 'Blastoise EX'), { reason: 'no card of ours with this number and name' });
  assert.deepEqual(trace('94/109', 'Metal Energy - 94/109'), { reason: '2 cards of ours match' });
  assert.deepEqual(trace('', 'Shadow Lugia'), { reason: 'no number' });
  assert.deepEqual(trace('099/102 & 100/102', 'Darkrai & Cresselia Legend'), { reason: 'not one card number' });
});

test('the print type: TCGplayer\'s printing first, then the card\'s own', () => {
  assert.equal(printingType(['Reverse Holofoil', 'Holofoil']), 'holo');
  assert.equal(printingType(['Normal']), 'normal');
  assert.equal(printingType([]), null);
  assert.equal(printingType(undefined), null);
  assert.equal(flagType({ normal: true, holo: true }), 'holo');
  assert.equal(flagType({ reverse: true }), 'reverse');
  assert.equal(flagType({}), null);
});

test('rows: a Jumbo print for each card TCGdex has none for; covered cards and the rest apart', () => {
  const charizard = product('XY17', 'Charizard EX - XY17 (XY Black Star Promos)');
  const dragonite = product('074/111', 'Dragonite EX - 74/111');
  const dragonite2 = product('74/111', 'Dragonite EX - 74/111 (Stamped)');
  const products = [
    product('058/102', 'Pikachu - 58/102'), charizard, dragonite, dragonite2,
    product('58/102', 'Pikachu - 58/102 (25th Anniversary)'),
    product(null, 'Raikou, Entei & Suicune'),
  ];
  const tcgdex = new Map([
    ['xyp-XY17', { flags: { normal: true }, jumbo: false }],
    ['xy3-74', { flags: { holo: true }, jumbo: false }],
    ['base1-58', { flags: { normal: true }, jumbo: true }],
  ]);
  const printings = new Map([[charizard.productId, ['Holofoil']]]);
  const { rows, covered, left } = jumboPrintRows(products, index, { counts: SETS.counts, printings, tcgdex, source: 'https://t', issue: 40 });
  assert.deepEqual(rows, [
    { lang: 'en', card: 'xy3-74', type: 'holo', size: 'jumbo', source: 'https://t', issue: 40 },     // the card's own type
    { lang: 'en', card: 'xyp-XY17', type: 'holo', size: 'jumbo', source: 'https://t', issue: 40 },   // TCGplayer's printing, over the card's normal
  ]);
  assert.deepEqual(covered, ['base1-58'], 'both Pikachu Jumbo cards are the one TCGdex already lists');
  assert.deepEqual(left.map(l => l.reason), ['no number', 'a second Jumbo card of xy3-74']);
  assert.equal(readPrintOverrides({ prints: rows }).length, 2, 'the app reads every row');
  const unknown = jumboPrintRows([charizard], index, { counts: SETS.counts, tcgdex: new Map(), issue: 40 });
  assert.deepEqual(unknown.left.map(l => l.reason), ['TCGdex did not answer for xyp-XY17']);
});

test('the file: one sorted row per line; an import replaces its own rows and keeps the rest', () => {
  assert.equal(formatPrintOverrides([]), '{\n  "schemaVersion": 1,\n  "prints": []\n}\n');
  const hand = { lang: 'en', card: 'swsh12.5-160', type: 'holo', stamp: ['pre-release'], source: 'https://x', issue: 12 };
  const old = { lang: 'en', card: 'xyp-XY1', type: 'holo', size: 'jumbo', source: 'https://t', issue: 40 };
  const a = { lang: 'en', card: 'xyp-XY17', type: 'holo', size: 'jumbo', source: 'https://t', issue: 40 };
  const b = { lang: 'en', card: 'xyp-XY2', type: 'holo', size: 'jumbo', source: 'https://t', issue: 40 };
  const de = { lang: 'de', card: 'xyp-XY2', type: 'holo', size: 'jumbo', source: 'https://t', issue: 41 };
  assert.deepEqual(sortPrintRows([de, a, hand, b]).map(r => `${r.lang} ${r.card}`), ['en swsh12.5-160', 'en xyp-XY2', 'en xyp-XY17', 'de xyp-XY2'],
    'English first; within a set, numbers in natural order');
  assert.deepEqual(withImport([old, hand], [a, b], 40), [hand, b, a]);
  assert.equal(rowJson({ issue: 1, card: 'x-1', lang: 'en', type: 'holo', stamp: [] }), '{"lang":"en","card":"x-1","type":"holo","issue":1}');
  const text = formatPrintOverrides([a, hand]);
  assert.deepEqual(readPrintOverrides(JSON.parse(text)), [hand, a]);
  assert.match(text, /^\{\n  "schemaVersion": 1,\n  "prints": \[\n    \{"lang":"en","card":"swsh12\.5-160",/);
});
