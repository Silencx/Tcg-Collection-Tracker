import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seriesNames, eraKey, eraLabel } from '../js/ui/era-model.js';
import { tcgdexSerieSegment } from '../js/api/images.js';
import { jpEra } from '../js/api/jp-model.js';
import { ERA_MAP, OTHER_SERIES_ID, OTHER_SERIES_NAME } from '../js/config.js';

const sets = JSON.parse(readFileSync(new URL('../data/sets.json', import.meta.url), 'utf8'));
const NAMES = seriesNames(sets.series);
// What renderBySet sees for a card TCGdex lists WITHOUT art: providers/tcgdex.js rebuilds
// its image URL from the id, so the CDN segment is the id-slicing guess.
const guessed = id => tcgdexSerieSegment(id);
const headingFor = id => eraLabel(eraKey(id, guessed(id), sets.setSeries, NAMES), NAMES);

test('seriesNames reads the English list and ignores the rest', () => {
  const names = seriesNames({
    en: [{ id: 'mc', name: "McDonald's Collection" }, { id: 'x' }, null],
    de: [{ id: 'mc', name: 'nicht dieser' }],
  });
  assert.deepEqual(names, { mc: "McDonald's Collection" });
  assert.deepEqual(seriesNames(undefined), {});
  assert.deepEqual(seriesNames({}), {});
});

test('sets.json names every series an English set belongs to', () => {
  for (const id of Object.keys(sets.names.en)) {
    const serie = sets.setSeries[id];
    assert.ok(serie, `${id} has no setSeries entry`);
    assert.ok(NAMES[serie], `series "${serie}" (of ${id}) has no English name`);
  }
});

test('the headings that used to show raw ids are named, under the right series', () => {
  // Every one of these was its own era heading, labelled with the guessed segment.
  const cases = {
    me01: ['me', 'Mega Evolution Era'],
    mep: ['me', 'Mega Evolution Era'],
    '30th-c': ['me', 'Mega Evolution Era'],
    B1: ['tcgp', 'Pokémon TCG Pocket'],
    mfb: ['sv', 'Scarlet & Violet Era'],
    cel25: ['swsh', 'Sword & Shield Era'],
    '2024sv': ['mc', "McDonald's Collection"],
    'tk-sm-r': ['tk', 'Trainer kits'],
    pop5: ['pop', 'POP'],
    np: ['pop', 'POP'],
    ecard2: ['ecard', 'E-Card'],
    lc: ['lc', 'Legendary Collection'],
    neo1: ['neo', 'Neo'],
    gym1: ['gym', 'Gym'],
  };
  for (const [setId, [serie, label]] of Object.entries(cases)) {
    const key = eraKey(setId, guessed(setId), sets.setSeries, NAMES);
    assert.equal(key, serie, setId);
    assert.equal(eraLabel(key, NAMES), label, setId);
  }
});

test('no English set gets a raw id or the catch-all heading', () => {
  for (const id of Object.keys(sets.names.en)) {
    const label = headingFor(id);
    assert.notEqual(label, OTHER_SERIES_NAME, id);
    assert.notEqual(label, sets.setSeries[id], `${id} is labelled with its raw series id`);
    assert.notEqual(label, guessed(id), `${id} is labelled with its guessed segment`);
  }
});

test('the main eras keep their series ids and curated names', () => {
  for (const [setId, serie] of [['sv05', 'sv'], ['swsh7', 'swsh'], ['sm7', 'sm'], ['xy9', 'xy'],
    ['bw4', 'bw'], ['hgss1', 'hgss'], ['pl2', 'pl'], ['dp1', 'dp'], ['ex16', 'ex'], ['base1', 'base']]) {
    const key = eraKey(setId, serie, sets.setSeries, NAMES);
    assert.equal(key, serie, setId);
    assert.equal(eraLabel(key, NAMES), ERA_MAP[serie]);
  }
});

test('setSeries wins over the CDN segment', () => {
  assert.equal(eraKey('cel25', 'cel', { cel25: 'swsh' }, {}), 'swsh');
});

test('without setSeries, a nameable CDN segment is kept', () => {
  // An old cache, or the live set-meta path: no map, no names.
  assert.equal(eraKey('sv05', 'sv'), 'sv');
  assert.equal(eraKey('mc1', 'mc', {}, { mc: "McDonald's Collection" }), 'mc');
});

test('anything that cannot be named goes to the one Other group', () => {
  assert.equal(eraKey('cel25', 'cel'), OTHER_SERIES_ID);
  assert.equal(eraKey('2024sv', '2024sv', {}, NAMES), OTHER_SERIES_ID);
  assert.equal(eraKey('x', undefined), OTHER_SERIES_ID);
  assert.equal(eraLabel(OTHER_SERIES_ID, NAMES), OTHER_SERIES_NAME);
  assert.equal(eraLabel('nonsense'), OTHER_SERIES_NAME);
});

test('every era a JP set can be injected under has a named heading', () => {
  // fetchAndInjectJPCards finds its era by .era-label[data-series=jpEra(...)], and the
  // data-series is eraKey's result, so each jpEra id must survive eraKey unchanged.
  const ids = new Set();
  for (let y = 1996; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) ids.add(jpEra(null, `${y}-${String(m).padStart(2, '0')}-15`));
  }
  ids.delete(null);
  assert.ok(ids.size >= 14, `only ${ids.size} JP eras found`);
  for (const id of ids) {
    assert.equal(eraKey('jp-only', id, sets.setSeries, NAMES), id, id);
    assert.notEqual(eraLabel(id, NAMES), OTHER_SERIES_NAME, id);
  }
});
