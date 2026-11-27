// TCGplayer's stamped prints traced back to their card, as print rows for
// data/print-overrides.json (tools/lib/stamped.mjs, tools/stamped-prints.mjs), and left
// out of the TCGplayer check's numbers (tools/tcgcsv-probe.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRICE_GUIDES, priceGuide, noteStamp, stampsOf, stampedPrintOf, stampedPrintRows } from '../tools/lib/stamped.mjs';
import { catalogueIndex } from '../tools/lib/jumbo.mjs';
import { loose } from '../tools/lib/tcgcsv.mjs';
import { formatPrintOverrides, withImport } from '../tools/lib/print-overrides.mjs';
import { readPrintOverrides, withPrintOverrides } from '../js/api/print-overrides-model.js';

let nextId = 1;
const product = (number, name) => ({ productId: nextId++, name, extendedData: [{ name: 'Rarity', value: 'Promo' }, { name: 'Number', value: number }] });

// data/cat/en/ rows, data/sets.json's counts and names.
const CATALOGUE = [
  ['bw4', '12', 'Arcanine'], ['bw2', '53', 'Gigalith'], ['xy12', '11', 'Charizard'], ['xy12', '34', 'Gyarados'],
  ['ex15', '41', 'Exeggutor δ'], ['xy8', '145', 'Parallel City'], ['swsh12', '131', 'Dragonite'],
  ['svp', '005', 'Quaquaval'], ['sm1', '123', 'Nest Ball'],
];
const COUNTS = { bw4: { official: 99 }, bw2: { official: 98 }, xy12: { official: 108 }, ex15: { official: 110 }, xy8: { official: 162 }, swsh12: { official: 195 }, sm1: { official: 149 } };
const SET_NAMES = new Set(['Next Destinies', 'Evolutions', 'Silver Tempest', 'BREAKthrough'].map(loose));
const index = catalogueIndex(CATALOGUE);
const opts = { counts: COUNTS, setNames: SET_NAMES };

test('a group\'s price guide is its name, as TCGplayer writes the link', () => {
  assert.equal(priceGuide('Jumbo Cards'), `${PRICE_GUIDES}jumbo-cards`);
  assert.equal(priceGuide('League & Championship Cards'), `${PRICE_GUIDES}league-and-championship-cards`);
  assert.equal(priceGuide('Miscellaneous Cards & Products'), `${PRICE_GUIDES}miscellaneous-cards-and-products`);
  assert.equal(priceGuide('WoTC Promo'), `${PRICE_GUIDES}wotc-promo`);
});

test('a note is a TCGdex stamp only when the whole note is one we know', () => {
  assert.equal(noteStamp('Prerelease'), 'pre-release');
  assert.equal(noteStamp('Staff'), 'staff');
  assert.equal(noteStamp('W Stamped'), 'wotc');
  assert.equal(noteStamp('City Championships'), 'city-championships');
  assert.equal(noteStamp('Regional Championship'), 'regional-championships');
  assert.equal(noteStamp("Toys R' Us Promo"), 'toys-r-us');
  assert.equal(noteStamp('Toys R Us Promo'), 'toys-r-us');
  assert.equal(noteStamp('XY Evolutions Prerelease', SET_NAMES), 'pre-release', 'an era\'s letters before the set');
  assert.equal(noteStamp('Silver Tempest Stamped', SET_NAMES), 'set-logo');
  assert.equal(noteStamp('Cinderace Stamped', SET_NAMES), null, 'not a set of ours');
  for (const n of ['League Cup', 'Cosmos Holo', 'Prerelease Kit Exclusive', 'Delta Species', '']) assert.equal(noteStamp(n, SET_NAMES), null, n);
});

test('a name\'s stamps, staff last; one unknown note spoils them all', () => {
  assert.deepEqual(stampsOf('Arcanine - 12/99 (Prerelease) [Staff]'), { stamps: ['pre-release', 'staff'] });
  assert.deepEqual(stampsOf('Torchic [Staff] (City Championships)'), { stamps: ['city-championships', 'staff'] });
  assert.deepEqual(stampsOf('Exeggutor (Delta Species) - 41/110 (Prerelease)'), { stamps: ['pre-release'] }, 'Delta Species is the name');
  assert.deepEqual(stampsOf('Nest Ball - 123/149 (League Cup) [Staff]'), { unknown: 'League Cup' });
  assert.equal(stampsOf('Regice - 28/111 (Cosmos Holo)'), null, 'no stamp at all');
  assert.equal(stampsOf('Pikachu'), null);
});

test('a stamped product filed under an original number traces to one card', () => {
  const of = (n, name, g = 'Black and White Promos') => stampedPrintOf(product(n, name), g, index, opts);
  assert.deepEqual(of('12/99', 'Arcanine - 12/99 (Prerelease) [Staff]'), { card: 'bw4-12', stamp: ['pre-release', 'staff'] });
  assert.deepEqual(of('53/98', 'Gigalith 53/98 (Prerelease)'), { card: 'bw2-53', stamp: ['pre-release'] }, 'the number without a dash');
  assert.deepEqual(of('34/108', 'Gyarados (XY Evolutions Prerelease)', 'XY Promos'), { card: 'xy12-34', stamp: ['pre-release'] });
  assert.deepEqual(of('41/110', 'Exeggutor (Delta Species) - 41/110 (Prerelease)'), { card: 'ex15-41', stamp: ['pre-release'] });
  assert.deepEqual(of('131/195', 'Dragonite (Silver Tempest Stamped)', 'SWSH: Sword & Shield Promo Cards'), { card: 'swsh12-131', stamp: ['set-logo'] });
  // Not ours to judge: no stamp, a promo's own number, the Jumbo group.
  assert.equal(of('12/99', 'Arcanine - 12/99'), null);
  assert.equal(of('005', 'Quaquaval - 005 (Prerelease)', 'SV: Scarlet & Violet Promo Cards'), null);
  assert.equal(of('12/99', 'Arcanine - 12/99 (Prerelease)', 'Jumbo Cards'), null);
  // Stamped, but no row: why, for a person.
  assert.match(of('123/149', 'Nest Ball - 123/149 (League Cup) [Staff]').reason, /"League Cup" is no TCGdex stamp/);
  assert.match(of('12/99', 'Arcanine - 12/99 [Staff]').reason, /^staff alone/);
  assert.match(of('12/99', 'Arcanine (Prerelease)', 'Alternate Art Promos').reason, /^alternate art/);
  assert.match(of('12/98', 'Arcanine - 12/98 (Prerelease)').reason, /no card of ours/, 'a set of 98 cards has no Arcanine 12');
});

test('rows for the prints TCGdex lacks, typed by TCGplayer\'s printing', () => {
  const arcanine = product('12/99', 'Arcanine - 12/99 (Prerelease)');
  const staff = product('12/99', 'Arcanine - 12/99 (Prerelease) [Staff]');
  const again = product('12/99', 'Arcanine - 12/99 (Prerelease) [Staff]');   // another printing of one print
  const city = product('145/162', 'Parallel City - 145/162 (City Championships)');
  const charizard = product('11/108', 'Charizard - 11/108 (Prerelease)');
  const groups = [
    { name: 'Black and White Promos', products: [arcanine, staff, again, product('12/99', 'Arcanine - 12/99 (League Cup) [Staff]'), product('12/99', 'Arcanine - 12/99 (League Cup)')] },
    { name: 'League & Championship Cards', products: [city] },
    { name: 'XY Promos', products: [charizard] },
  ];
  const tcgdex = new Map([
    ['bw4-12', { flags: { normal: true, reverse: true }, prints: [{ type: 'normal', stamp: null, size: 'standard' }, { type: 'reverse', stamp: null, size: 'standard' }] }],
    ['xy8-145', { flags: { normal: true }, prints: [{ type: 'reverse', stamp: ['city-championships'], size: 'standard', subtype: null, foil: null }] }],
    // TCGdex lacks xy12-11's prints entirely: it did not answer for it.
  ]);
  const printings = new Map([[arcanine.productId, ['Normal', 'Holofoil']], [staff.productId, ['Normal']]]);
  const { rows, covered, left } = stampedPrintRows(groups, index, { ...opts, tcgdex, printings, issue: 42 });
  assert.deepEqual(rows, [
    { lang: 'en', card: 'bw4-12', type: 'holo', stamp: ['pre-release'], source: `${PRICE_GUIDES}black-and-white-promos`, issue: 42 },
    { lang: 'en', card: 'bw4-12', type: 'normal', stamp: ['pre-release', 'staff'], source: `${PRICE_GUIDES}black-and-white-promos`, issue: 42 },
  ]);
  assert.deepEqual(covered, ['xy8-145|city-championships'], 'TCGdex lists it, whatever the type');
  // A League Cup print with no stamp we know is no stamped print to us at all; with a
  // Staff note next to it, it is one we cannot spell, and is listed.
  assert.deepEqual(left.map(l => [l.group, l.number, l.reason]).sort(), [
    ['Black and White Promos', '12/99', '"League Cup" is no TCGdex stamp we know'],
    ['XY Promos', '11/108', 'TCGdex did not answer for xy12-11'],
  ]);
});

test('a prerelease staff print is not the plain prerelease print, and the app shows the rows', () => {
  const staff = product('12/99', 'Arcanine - 12/99 (Prerelease) [Staff]');
  const tcgdex = new Map([['bw4-12', { flags: { normal: true }, prints: [{ type: 'normal', stamp: ['pre-release'], size: 'standard' }] }]]);
  const { rows } = stampedPrintRows([{ name: 'Black and White Promos', products: [staff] }], index, { ...opts, tcgdex, issue: 42 });
  assert.deepEqual(rows.map(r => [r.type, r.stamp]), [['normal', ['pre-release', 'staff']]], 'typed by the card\'s flags without a printing');
  // Through the file and into the card's prints, next to the Jumbo import's rows.
  const jumbo = { lang: 'en', card: 'bw4-12', type: 'holo', size: 'jumbo', source: 'x', issue: 19 };
  const text = formatPrintOverrides(withImport([jumbo], rows, 42));
  const back = readPrintOverrides(JSON.parse(text));
  assert.equal(back.length, 2);
  const [card] = withPrintOverrides([{ id: 'bw4-12', variants: { normal: true, prints: [{ type: 'normal' }, { type: 'normal', stamp: ['pre-release'] }] } }], back);
  assert.deepEqual(card.variants.prints, [
    { type: 'normal' }, { type: 'normal', stamp: ['pre-release'] },
    { type: 'holo', size: 'jumbo' }, { type: 'normal', stamp: ['pre-release', 'staff'] },
  ]);
});
