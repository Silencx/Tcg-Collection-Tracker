// Cards no source lists (data/overrides.json), as the app reads and merges them
// (js/api/overrides-model.js), and the committed file itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  readOverrides, numberKey, cardKey, overrideId, overrideCards, overrideSetCards, mergeSetCards,
  overrideJpRows,
} from '../js/api/overrides-model.js';
import { dexByNameFrom } from '../js/api/match-model.js';
import { formatOverrides } from '../tools/lib/overrides.mjs';

const DEX = dexByNameFrom([
  { name: 'Pikachu', dex: 25 }, { name: 'Mew', dex: 151 }, { name: 'Mewtwo', dex: 150 },
  { name: 'Zekrom', dex: 644 }, { name: 'Nidoran♀', dex: 29 },
]);
const row = (o) => ({ lang: 'en', set: 'swshp', number: 'SWSH020', name: 'Pikachu', source: 'https://pkmncards.com/x', issue: 1, ...o });

test('a malformed file or row reads as no override', () => {
  for (const bad of [null, undefined, 'x', [], {}, { overrides: 'x' }, { overrides: null }]) {
    assert.deepEqual(readOverrides(bad), []);
  }
  const rows = readOverrides({ overrides: [
    row(),
    row({ lang: 'xx' }),                        // a language we have no cards for
    row({ set: '../../etc' }),                  // not a set id
    row({ number: '<b>1</b>' }),                // not a card number
    row({ name: '' }), row({ name: 'x'.repeat(81) }),
    row({ issue: 0 }), row({ issue: '3' }),
    null, 'row',
    row({ issue: 2, dexId: [25, '25', 0, 25], source: 5 }),
  ] });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], { lang: 'en', set: 'swshp', number: 'SWSH020', name: 'Pikachu', dexId: [25], source: '', issue: 2 });
});

test('Korean and Simplified Chinese cards can be added by hand', () => {
  // TCGdex has card lists for few of their sets, so these are where collectors fill in.
  const rows = readOverrides({ overrides: [
    row({ lang: 'ko', set: 'SV2a', number: '025', name: '피카츄' }),
    row({ lang: 'zh-Hans', set: 'CSV1C', number: '001', name: '妙蛙种子' }),
  ] });
  assert.deepEqual(rows.map(r => `${r.lang} ${r.set}-${r.number}`), ['ko SV2a-025', 'zh-Hans CSV1C-001']);
});

test('one card, whatever its case or zero padding', () => {
  assert.equal(numberKey('en', 'SWSH020'), 'SWSH20');
  assert.equal(numberKey('en', 'swsh20'), 'SWSH20');
  assert.equal(numberKey('en', '007'), '7');
  assert.equal(numberKey('ja', '001/053'), '1');
  assert.equal(cardKey('de', 'svp', '023'), cardKey('de', 'svp', '23'));
  assert.notEqual(cardKey('de', 'svp', '23'), cardKey('en', 'svp', '23'));
  assert.equal(overrideId(row()), 'swshp-SWSH020');
  assert.equal(overrideId(row({ lang: 'ja', set: 'vstar-universe', number: '263/172' })), 'JP_vstar-universe_263');
});

test('English overrides join master set by the name-or-number rule', () => {
  const rows = readOverrides({ overrides: [
    row({ number: 'SWSH020', name: 'Pikachu', issue: 1 }),
    row({ number: 'SWSH021', name: 'Mewtwo', issue: 2 }),
    row({ number: 'SWSH022', name: 'Surfing Friends', dexId: [25], issue: 3 }),   // a cameo
    row({ number: 'SWSH023', name: 'Mew & Zekrom', issue: 4 }),
    row({ lang: 'de', number: 'SWSH024', name: 'Pikachu', issue: 5 }),           // single set only
  ] });
  const cards = overrideCards(rows, ['Mew', 'Pikachu', 'Zekrom'], { setSeries: { swshp: 'swsh' }, dexByName: DEX });
  assert.deepEqual(cards.map(c => [c.id, c.species]), [
    ['swshp-SWSH023', 'Mew'],          // shared: the first-listed Pokémon has it
    ['swshp-SWSH020', 'Pikachu'],
    ['swshp-SWSH022', 'Pikachu'],
  ]);
  assert.equal(cards[1].image, 'https://assets.tcgdex.net/en/swsh/swshp/SWSH020');
  assert.equal(cards[1].localId, 'SWSH020');
});

test('single set gets the overrides of that set and language, in number order', () => {
  const rows = readOverrides({ overrides: [
    row({ lang: 'de', set: 'svp', number: '023', name: 'Pikachu', issue: 1 }),
    row({ lang: 'de', set: 'svp', number: '201', name: 'Mew', issue: 2 }),
    row({ lang: 'en', set: 'svp', number: '024', name: 'Mew', issue: 3 }),
  ] });
  const extra = overrideSetCards(rows, 'svp', 'de');
  assert.deepEqual(extra.map(c => c.id), ['svp-023', 'svp-201']);
  assert.equal(extra[0].image, null, 'no scan to ask for');
  const listed = ['001', '022', '025', '030'].map(n => ({ id: `svp-${n}`, localId: n }));
  assert.deepEqual(mergeSetCards(listed, extra).map(c => c.localId), ['001', '022', '023', '025', '030', '201']);
  // A card the source lists keeps the source's entry, even padded differently.
  assert.deepEqual(mergeSetCards([{ id: 'svp-23', localId: '23' }], extra).map(c => c.id), ['svp-23', 'svp-201']);
  assert.deepEqual(mergeSetCards(listed, []), listed);
});

test('Japanese overrides need a set the catalogue knows, and get the stable JP id', () => {
  const rows = readOverrides({ overrides: [
    row({ lang: 'ja', set: 'vstar-universe', number: '263/172', name: 'Pikachu VMAX', issue: 1 }),
    row({ lang: 'ja', set: 'no-such-set', number: '1', name: 'Pikachu', issue: 2 }),
    row({ lang: 'ja', set: 'vstar-universe', number: '1', name: 'Pikachu', issue: 3 }),
  ] });
  const sets = new Map([['vstar-universe', { key: 'vstar-universe', name: 'VSTAR Universe' }]]);
  const seen = new Set(['JP_vstar-universe_1']);           // already listed by the catalogue
  const out = overrideJpRows(rows, ['Pikachu'], sets, { seen, dexByName: DEX });
  assert.deepEqual(out, [{
    id: 'JP_vstar-universe_263', setKey: 'vstar-universe', number: '263/172', numKey: '263',
    cardName: 'Pikachu VMAX', pokemonName: 'Pikachu',
  }]);
  assert.ok(seen.has('JP_vstar-universe_263'));
});

test('the committed data/overrides.json is valid, sorted and in the build\'s format', () => {
  const text = readFileSync(new URL('../data/overrides.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const json = JSON.parse(text);
  const rows = readOverrides(json);
  assert.equal(rows.length, json.overrides.length, 'every row is one the app reads');
  assert.equal(text, formatOverrides(rows), 'written by tools/lib/overrides.mjs');
  const keys = rows.map(r => cardKey(r.lang, r.set, r.number));
  assert.equal(new Set(keys).size, keys.length, 'no card twice');
  const issues = rows.map(r => r.issue);
  assert.equal(new Set(issues).size, issues.length, 'one row per report');
});
