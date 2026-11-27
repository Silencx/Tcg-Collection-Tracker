// Prints no source lists (data/print-overrides.json), as the app reads them and adds them
// to a card's print list (js/api/print-overrides-model.js), and the committed file itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import {
  readPrintOverrides, rowPrint, printKind, addPrints, withPrintOverrides,
} from '../js/api/print-overrides-model.js';
import { printsOf } from '../js/ui/prints-model.js';
import { variantBadges } from '../js/api/variants.js';
import { formatPrintOverrides } from '../tools/lib/print-overrides.mjs';

const row = (o) => ({ lang: 'en', card: 'xyp-XY17', type: 'holo', size: 'jumbo', source: 'https://t', issue: 9, ...o });
const FLAGS = { normal: false, reverse: false, holo: false, firstEdition: false, wPromo: false };

test('a malformed file or row reads as no print override', () => {
  for (const bad of [null, undefined, 'x', [], {}, { prints: 'x' }, { overrides: [row()] }]) {
    assert.deepEqual(readPrintOverrides(bad), []);
  }
  const rows = readPrintOverrides({ prints: [
    row(),
    row({ lang: 'ja' }), row({ lang: 'xx' }),     // not a TCGdex language we have
    row({ card: 'xyp' }), row({ card: '../x-1' }), row({ card: 'xyp-XY 17' }),
    row({ type: 'shiny' }), row({ size: 'huge' }),
    row({ stamp: [] }), row({ stamp: ['Pre Release'] }), row({ stamp: 'pre-release' }),
    row({ issue: 0 }), row({ issue: '9' }),
    null, 'row',
    row({ card: 'swsh12.5-160', size: undefined, stamp: ['pre-release'], source: 5 }),
  ] });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { lang: 'en', card: 'xyp-XY17', type: 'holo', size: 'jumbo', source: 'https://t', issue: 9 });
  assert.deepEqual(rows[1], { lang: 'en', card: 'swsh12.5-160', type: 'holo', stamp: ['pre-release'], source: '', issue: 9 });
  assert.deepEqual(rowPrint(rows[0]), { type: 'holo', size: 'jumbo' });
});

test('a print\'s kind is what makes it special, whatever its type', () => {
  assert.equal(printKind({ type: 'holo' }), '');
  assert.equal(printKind({ type: 'normal', size: 'jumbo' }), 'jumbo');
  assert.equal(printKind({ type: 'holo', subtype: 'shadowless', stamp: ['set-logo', '1st-edition'] }), 'shadowless.1st-edition.set-logo');
});

test('a Jumbo print joins after the card\'s own prints, and never hides the plain one', () => {
  const jumbo = { type: 'holo', size: 'jumbo' };
  const holo = { ...FLAGS, holo: true };
  const v = addPrints(holo, [jumbo]);
  assert.deepEqual(v.prints, [{ type: 'holo' }, jumbo]);
  assert.deepEqual(holo, { ...FLAGS, holo: true }, 'the card\'s own object is left alone');
  assert.deepEqual(printsOf(v).map(p => p.key), ['holo', 'holo.jumbo']);
  assert.deepEqual(printsOf(v).map(p => p.label), ['Holo', 'Holo · Jumbo']);
  const badges = variantBadges(v);
  assert.deepEqual(badges.map(b => b.text), ['H', '+1']);
  assert.match(badges[1].title, /Holo · Jumbo/);

  const two = addPrints({ ...FLAGS, normal: true, reverse: true, inferred: ['reverse'] }, [jumbo]);
  assert.deepEqual(printsOf(two).map(p => [p.key, p.inferred]), [['normal', false], ['reverse', true], ['holo.jumbo', false]],
    'an inferred reverse stays inferred');

  const detailed = { ...FLAGS, holo: true, firstEdition: true, prints: [{ type: 'holo', stamp: ['1st-edition'] }, { type: 'holo', subtype: 'unlimited' }] };
  assert.deepEqual(addPrints(detailed, [jumbo]).prints, [...detailed.prints, jumbo],
    'TCGdex\'s detailed list is kept as it is: printsOf would add no plain holo to it either');
});

test('a card that has a print of that kind keeps its own; nothing to add is the same object', () => {
  const tcgdexJumbo = { ...FLAGS, normal: true, prints: [{ type: 'normal' }, { type: 'normal', size: 'jumbo' }] };
  assert.equal(addPrints(tcgdexJumbo, [{ type: 'holo', size: 'jumbo' }]), tcgdexJumbo, 'any Jumbo print counts');
  const v = { ...FLAGS, holo: true };
  assert.equal(addPrints(v, []), v);
  assert.equal(addPrints(null, [{ type: 'holo', size: 'jumbo' }]), null);
  assert.equal(addPrints(v, [{ type: 'holo' }]), v, 'a plain print the flags already give');
  assert.deepEqual(addPrints(v, [{ type: 'holo', size: 'jumbo' }, { type: 'normal', size: 'jumbo' }]).prints.length, 2,
    'two override rows of one kind add one print');
});

test('the language\'s rows join their cards; a card without variant data keeps none', () => {
  const rows = readPrintOverrides({ prints: [row(), row({ lang: 'de', card: 'smp-SM60' }), row({ card: 'smp-SM60' })] });
  const cards = [
    { id: 'xyp-XY17', name: 'Charizard-EX', variants: { ...FLAGS, normal: true } },
    { id: 'smp-SM60', name: 'Charizard-GX' },                     // variants not loaded
    { id: 'sv05-1', name: 'Seedot', variants: { ...FLAGS, normal: true } },
  ];
  const out = withPrintOverrides(cards, rows, 'en');
  assert.notEqual(out, cards);
  assert.deepEqual(out[0].variants.prints, [{ type: 'normal' }, { type: 'holo', size: 'jumbo' }]);
  assert.equal(out[1], cards[1]);
  assert.equal(out[2], cards[2]);
  assert.equal(cards[0].variants.prints, undefined, 'the source\'s card is not changed');
  assert.equal(withPrintOverrides(cards, rows, 'fr'), cards, 'no row for the language: the same list');
  assert.equal(withPrintOverrides(cards, [], 'en'), cards);
});

test('the committed data/print-overrides.json is valid, sorted, and names cards we list', () => {
  const file = new URL('../data/print-overrides.json', import.meta.url);
  if (!existsSync(file)) return;   // the app works without it
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const json = JSON.parse(text);
  const rows = readPrintOverrides(json);
  assert.equal(rows.length, json.prints.length, 'every row is one the app reads');
  assert.equal(text, formatPrintOverrides(rows), 'written by tools/lib/print-overrides.mjs');
  const keys = rows.map(r => `${r.lang}|${r.card}|${printKind(r) || r.type}`);
  assert.equal(new Set(keys).size, keys.length, 'no print twice');
  const listed = new Map();
  for (const r of rows) {
    if (!listed.has(r.lang)) {
      const dir = new URL(`../data/cat/${r.lang}/`, import.meta.url);
      const ids = new Set();
      for (const f of readdirSync(dir).filter(f => /^cards-[a-z0]\.json$/.test(f))) {
        for (const c of JSON.parse(readFileSync(new URL(f, dir), 'utf8')).rows) ids.add(`${c[0]}-${c[1]}`);
      }
      listed.set(r.lang, ids);
    }
    assert.ok(listed.get(r.lang).has(r.card), `${r.lang} ${r.card} is a card of our catalogue`);
  }
});
