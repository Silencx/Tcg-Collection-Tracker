import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setProgress, percentComplete, buildSetList, matchesSetQuery, groupSetsBySeries,
  sortSetRows, pickerLanguages, isDigitalOnly, dateFor, countFor, belongsToSet,
} from '../js/ui/setmode-model.js';
import { SETTARGETSTORE, SETCHKSTORE, SETPICKERSTORE, CHKSTORE, TMSSTORE } from '../js/config.js';
import { readCardCount } from '../js/api/providers/tcgdex.js';

// ── progress ──────────────────────────────────────────────────────────────────
test('cards and printings are counted separately', () => {
  // Three printings of ONE card, plus one printing of a second.
  const ids = ['EN_sv05-003', 'DE_sv05-003', 'FR_sv05-003', 'EN_sv05-004'];
  assert.deepEqual(setProgress(ids, 'sv05'), { printings: 4, cards: 2 });
});

test('progress ignores every other set', () => {
  const ids = ['EN_sv05-003', 'EN_base1-4', 'DE_bw4-2'];
  assert.deepEqual(setProgress(ids, 'sv05'), { printings: 1, cards: 1 });
  assert.deepEqual(setProgress(ids, 'base1'), { printings: 1, cards: 1 });
  assert.deepEqual(setProgress(ids, 'nothing'), { printings: 0, cards: 0 });
});

test('a promo set id with its own hyphen is matched, not truncated', () => {
  assert.deepEqual(setProgress(['EN_swshp-SWSH001'], 'swshp'), { printings: 1, cards: 1 });
});

test('progress with no set chosen is zero, not a crash', () => {
  assert.deepEqual(setProgress(['EN_sv05-003'], null), { printings: 0, cards: 0 });
  assert.deepEqual(setProgress([], 'sv05'), { printings: 0, cards: 0 });
});

test('a Set is accepted, since state.ssChecked is one', () => {
  assert.deepEqual(setProgress(new Set(['EN_sv05-003', 'DE_sv05-003']), 'sv05'),
    { printings: 2, cards: 1 });
});

test('a badge scopes progress to ONE language', () => {
  // The language is chosen in the picker, before the set, so "Temporal Forces in
  // German" is its own goal. Without this scope a set started only in German would
  // report progress in the English list too, against the same denominator.
  const ids = ['EN_sv05-1', 'EN_sv05-2', 'DE_sv05-1', 'IT_sv05-9'];
  assert.deepEqual(setProgress(ids, 'sv05', 'EN'), { printings: 2, cards: 2 });
  assert.deepEqual(setProgress(ids, 'sv05', 'DE'), { printings: 1, cards: 1 });
  assert.deepEqual(setProgress(ids, 'sv05', 'FR'), { printings: 0, cards: 0 });
  // Unscoped still counts every language, which is what the dashboard wants.
  assert.deepEqual(setProgress(ids, 'sv05'), { printings: 4, cards: 3 });
});

test('with one language per view, cards and printings are the same number', () => {
  // Single-set mode renders one tile per card, so the two can no longer diverge — which
  // is why the header stopped reporting them separately.
  const ids = ['EN_sv05-1', 'EN_sv05-2', 'EN_sv05-3'];
  const p = setProgress(ids, 'sv05', 'EN');
  assert.equal(p.cards, p.printings);
});

// ── percent ───────────────────────────────────────────────────────────────────
test('completion percent', () => {
  assert.equal(percentComplete(0, 165), 0);
  assert.equal(percentComplete(33, 165), 20);
  assert.equal(percentComplete(165, 165), 100);
});

test('an unknown set size gives null, never a divide-by-zero or a fake 0%', () => {
  // The picker renders '—' for null and '0 / 165' for a real zero. They mean
  // different things and must not collapse into each other.
  assert.equal(percentComplete(5, 0), null);
  assert.equal(percentComplete(5, null), null);
  assert.equal(percentComplete(5, undefined), null);
});

test('secret rares cannot push completion past 100%', () => {
  // official is the printed run; a set can legitimately hold more cards than that.
  assert.equal(percentComplete(200, 165), 100);
});

// ── picker list ───────────────────────────────────────────────────────────────
// Shaped like the real data/sets.json: flat maps holding the UNION across languages,
// with `lang` carrying only the values that differ from them.
const META = {
  names: {
    en: { sv05: 'Temporal Forces', base1: 'Base Set', bw4: 'Next Destinies', odd: 'Oddity', A1: 'Genetic Apex' },
    de: { sv05: 'Temporalkräfte', base1: 'Basis-Set', A1: 'Genetische Apex' },
    th: { CS1a: 'ชุดไทย' },
  },
  dates: { sv05: '2024-03-22', base1: '1999-01-09', bw4: '2012-08-15', A1: '2024-10-30', CS1a: '2020-01-01' },
  symbols: { sv05: 'https://x/sv05.webp' },
  logos: { sv05: 'https://x/sv05-logo.webp' },
  counts: { sv05: { official: 162, total: 218 }, A1: { official: 226, total: 286 } },
  setSeries: { sv05: 'sv', base1: 'base', bw4: 'bw', A1: 'tcgp', CS1a: 'S' },
  series: {
    en: [{ id: 'sv', name: 'Scarlet & Violet', date: '2023-03-31' },
         { id: 'bw', name: 'Black & White', date: '2011-04-25' },
         { id: 'base', name: 'Base', date: '1999-01-09' }],
    th: [{ id: 'S', name: 'ซอร์ด', date: '2020-01-01' }],
  },
  lang: {
    de: { counts: { A1: { official: 226, total: 226 } } },
    th: { dates: { CS1a: '2021-06-01' }, noCards: ['CS1a'] },
  },
};

test('the picker list is newest first, with undated sets last', () => {
  // A1 is TCG Pocket and excluded by default, so it is absent even though it is newest.
  assert.deepEqual(buildSetList(META).map(r => r.id), ['sv05', 'bw4', 'base1', 'odd']);
});

test('each picker row carries everything the card renders', () => {
  const [first] = buildSetList(META);
  assert.deepEqual(first, {
    id: 'sv05', name: 'Temporal Forces', date: '2024-03-22',
    symbol: 'https://x/sv05.webp', logo: 'https://x/sv05-logo.webp',
    count: { official: 162, total: 218 }, serie: 'sv', empty: false,
  });
});

test('a set with no count carries null, not zero', () => {
  const row = buildSetList(META).find(r => r.id === 'base1');
  assert.equal(row.count, null);
  assert.equal(row.symbol, null);
});

test('buildSetList survives a PRE-UPGRADE sets.json with none of the new keys', () => {
  // Every snapshot built before the picker lacks setSeries/series/lang entirely, and a
  // deployment serving one must keep working rather than throwing on boot.
  const rows = buildSetList({ names: { en: { a: 'A' } }, dates: {}, symbols: {} });
  assert.deepEqual(rows, [{
    id: 'a', name: 'A', date: null, symbol: null, logo: null,
    count: null, serie: 'other', empty: false,
  }]);
  assert.deepEqual(buildSetList({}), []);
  assert.deepEqual(buildSetList(), []);
});

// ── language filtering ────────────────────────────────────────────────────────
test('a language returns only its own sets, named in it', () => {
  const de = buildSetList(META, { lang: 'de' });
  assert.deepEqual(de.map(r => r.id), ['sv05', 'base1'], 'A1 is digital, bw4 has no German name');
  assert.equal(de[0].name, 'Temporalkräfte');
});

test('a disjoint namespace lists its own sets only', () => {
  // Thai sets share no ids with English — they are different products, not translations.
  const th = buildSetList(META, { lang: 'th' });
  assert.deepEqual(th.map(r => r.id), ['CS1a']);
  assert.equal(th[0].name, 'ชุดไทย');
});

test('a language absent from the snapshot returns [] rather than throwing', () => {
  assert.deepEqual(buildSetList(META, { lang: 'ja' }), []);
});

test('per-language overrides beat the flat map; everything else falls through', () => {
  // Thai's date for CS1a differs from the flat map's; German has no date override at all.
  assert.equal(buildSetList(META, { lang: 'th' })[0].date, '2021-06-01', 'override wins');
  assert.equal(META.dates.CS1a, '2020-01-01', 'flat map itself is untouched');
  assert.equal(buildSetList(META, { lang: 'de' })[0].date, '2024-03-22', 'falls through to flat');
});

test('cardCount overrides are honoured — they genuinely differ per language', () => {
  // A1 is 226/286 in English and 226/226 in German. Digital, so ask for it explicitly.
  const en = buildSetList(META, { includeDigital: true }).find(r => r.id === 'A1');
  const de = buildSetList(META, { lang: 'de', includeDigital: true }).find(r => r.id === 'A1');
  assert.deepEqual(en.count, { official: 226, total: 286 });
  assert.deepEqual(de.count, { official: 226, total: 226 });
});

test('dateFor / countFor resolve override → flat → null, never 0 or emptystring', () => {
  assert.equal(dateFor(META, 'th', 'CS1a'), '2021-06-01');
  assert.equal(dateFor(META, 'en', 'sv05'), '2024-03-22');
  assert.equal(dateFor(META, 'en', 'nope'), null);
  assert.equal(dateFor({}, 'en', 'x'), null);
  assert.equal(countFor(META, 'en', 'nope'), null);
  assert.equal(countFor(undefined, 'en', 'x'), null);
});

test('sets with no card list in this language are flagged empty', () => {
  assert.equal(buildSetList(META, { lang: 'th' })[0].empty, true);
  assert.equal(buildSetList(META)[0].empty, false);
});

// ── digital exclusion ─────────────────────────────────────────────────────────
test('TCG Pocket sets are excluded by default and included on request', () => {
  assert.equal(buildSetList(META).some(r => r.id === 'A1'), false);
  assert.equal(buildSetList(META, { includeDigital: true }).some(r => r.id === 'A1'), true);
});

test('isDigitalOnly identifies the tcgp series and nothing else', () => {
  assert.equal(isDigitalOnly('A1', META.setSeries), true);
  assert.equal(isDigitalOnly('sv05', META.setSeries), false);
  assert.equal(isDigitalOnly('CS1a', META.setSeries), false);
  // Absent ≠ excluded: an unmapped set must still be pickable.
  assert.equal(isDigitalOnly('unknown', META.setSeries), false);
  assert.equal(isDigitalOnly('A1', {}), false);
});

// ── picker languages ──────────────────────────────────────────────────────────
test('pickerLanguages reports each language with its set count, digital excluded', () => {
  const langs = pickerLanguages(META);
  assert.deepEqual(langs.map(l => [l.code, l.count]), [['en', 4], ['de', 2], ['th', 1]]);
  assert.equal(langs[0].badge, 'EN');
});

test('pickerLanguages skips languages the snapshot has nothing for', () => {
  assert.deepEqual(pickerLanguages({}), []);
  assert.deepEqual(pickerLanguages({ names: { en: {} } }), []);
});

// ── sorting ───────────────────────────────────────────────────────────────────
test('sortSetRows flips direction but keeps undated LAST either way', () => {
  const rows = buildSetList(META);
  assert.deepEqual(sortSetRows(rows).map(r => r.id), ['sv05', 'bw4', 'base1', 'odd']);
  assert.deepEqual(sortSetRows(rows, { asc: true }).map(r => r.id), ['base1', 'bw4', 'sv05', 'odd']);
});

// ── series grouping ───────────────────────────────────────────────────────────
test('groups are ordered newest series first, with names from the series list', () => {
  const groups = groupSetsBySeries(buildSetList(META), META.series.en);
  assert.deepEqual(groups.map(g => [g.id, g.name]), [
    ['sv', 'Scarlet & Violet'], ['bw', 'Black & White'], ['base', 'Base'], ['other', 'Other sets'],
  ]);
  assert.deepEqual(groups[0].rows.map(r => r.id), ['sv05']);
});

test('a set whose series is unknown lands in "Other sets", never dropped', () => {
  const groups = groupSetsBySeries(buildSetList(META), META.series.en);
  const other = groups.find(g => g.id === 'other');
  assert.deepEqual(other.rows.map(r => r.id), ['odd']);
});

test('asc flips BOTH the group order and the rows inside each group', () => {
  const rows = [
    { id: 'sv05', name: 'a', date: '2024-03-22', serie: 'sv' },
    { id: 'sv01', name: 'b', date: '2023-03-31', serie: 'sv' },
    { id: 'bw4', name: 'c', date: '2012-08-15', serie: 'bw' },
  ];
  const desc = groupSetsBySeries(rows, META.series.en);
  const asc = groupSetsBySeries(rows, META.series.en, { asc: true });
  assert.deepEqual(desc.map(g => g.id), ['sv', 'bw']);
  assert.deepEqual(desc[0].rows.map(r => r.id), ['sv05', 'sv01']);
  assert.deepEqual(asc.map(g => g.id), ['bw', 'sv'], 'group order flips');
  assert.deepEqual(asc[1].rows.map(r => r.id), ['sv01', 'sv05'], 'row order flips too');
});

test('a series with no matching rows produces no empty group', () => {
  const groups = groupSetsBySeries(
    [{ id: 'sv05', name: 'a', date: '2024-03-22', serie: 'sv' }], META.series.en);
  assert.deepEqual(groups.map(g => g.id), ['sv']);
});

test('grouping an empty list gives an empty list', () => {
  assert.deepEqual(groupSetsBySeries([], META.series.en), []);
  assert.deepEqual(groupSetsBySeries([]), []);
});

test('a disjoint namespace groups by its OWN series list', () => {
  const groups = groupSetsBySeries(buildSetList(META, { lang: 'th' }), META.series.th);
  assert.deepEqual(groups.map(g => [g.id, g.name]), [['S', 'ซอร์ด']]);
});

// ── search ────────────────────────────────────────────────────────────────────
test('search matches name or set id, case-insensitively', () => {
  const row = { id: 'sv05', name: 'Temporal Forces' };
  for (const q of ['temporal', 'FORCES', 'sv05', 'SV0', ' sv05 ', '']) {
    assert.equal(matchesSetQuery(row, q), true, `expected a match for "${q}"`);
  }
  assert.equal(matchesSetQuery(row, 'base'), false);
});

test('search tolerates missing fields and a missing query', () => {
  assert.equal(matchesSetQuery({}, 'x'), false);
  assert.equal(matchesSetQuery({ id: 'a' }, null), true);
  assert.equal(matchesSetQuery({ id: 'a' }, undefined), true);
});

// ── the denominator, as TCGdex sends it ───────────────────────────────────────
test('cardCount {official,total} is read as-is', () => {
  // Verified live: sv05 is 162 official / 218 total — the difference is secret rares.
  assert.deepEqual(readCardCount({ official: 162, total: 218 }), { official: 162, total: 218 });
  assert.deepEqual(readCardCount({ official: 102, total: 102 }), { official: 102, total: 102 });
});

test('a bare number, which some deployments send instead, still works', () => {
  assert.deepEqual(readCardCount(102), { official: 102, total: 102 });
});

test('a half-populated cardCount fills the missing side rather than reporting zero', () => {
  // A zero denominator and an absent one are both "unknown", but a zero would divide.
  assert.deepEqual(readCardCount({ official: 162 }), { official: 162, total: 162 });
  assert.deepEqual(readCardCount({ total: 218 }), { official: 218, total: 218 });
});

test('no usable count gives null, so the set is ABSENT from the map', () => {
  // Present-as-zero would render "0 / 0 complete" for a set whose size is simply
  // unknown; absent renders '—'.
  for (const bad of [null, undefined, {}, { official: 0, total: 0 }, 0, -5, 'x', []]) {
    assert.equal(readCardCount(bad), null, `for ${JSON.stringify(bad)}`);
  }
});

// ── storage-key convention ────────────────────────────────────────────────────
test('the new keys follow tcg<Thing>_v<N>, so export/backup picks them up for free', () => {
  // storage.keys('tcg') is what drives exportData — a key that misses the prefix is
  // silently left out of every backup the user takes.
  for (const key of [SETTARGETSTORE, SETCHKSTORE, SETPICKERSTORE]) {
    assert.match(key, /^tcg[A-Za-z]+_v\d+$/, `${key} does not follow the naming convention`);
  }
});

test('the single-set checklist is a DIFFERENT key from the other two', () => {
  // The separate-checklists decision lives or dies on this.
  assert.notEqual(SETCHKSTORE, CHKSTORE);
  assert.notEqual(SETCHKSTORE, TMSSTORE);
  assert.equal(new Set([SETCHKSTORE, CHKSTORE, TMSSTORE]).size, 3);
});
