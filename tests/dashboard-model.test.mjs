import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCardId, summarise, languageBars, plural, formatSetDate, expansionRows,
} from '../js/ui/dashboard-model.js';

// ── id parsing ────────────────────────────────────────────────────────────────
test('a normal id splits into badge and TCGdex set id', () => {
  assert.deepEqual(parseCardId('EN_sv05-003'), { badge: 'EN', setId: 'sv05' });
  assert.deepEqual(parseCardId('DE_bw4-2'),    { badge: 'DE', setId: 'bw4' });
  assert.deepEqual(parseCardId('SC_base1-4'),  { badge: 'SC', setId: 'base1' });
});

test('the set id ends at the LAST hyphen, not the first', () => {
  // Promo set ids carry their own hyphen; local ids never do.
  assert.deepEqual(parseCardId('EN_swshp-SWSH001'), { badge: 'EN', setId: 'swshp' });
});

test('the badge ends at the FIRST underscore', () => {
  // TMS JP ids are JP_${code}_${localId} — a first-underscore split is the only rule
  // that gets the badge right for both id shapes in the app.
  assert.equal(parseCardId('JP_sv1a_003').badge, 'JP');
});

// ── the JP special case ───────────────────────────────────────────────────────
test('Master-Set JP ids yield a badge but never a set', () => {
  // Built as JP_jp_${pokemon}_${set}_${index} from Bulbapedia — no TCGdex set id
  // anywhere in there, and a render-order ordinal on the end.
  const id = 'JP_jp_Seedot_Miracle of the Desert_0';
  assert.deepEqual(parseCardId(id), { badge: 'JP', setId: null });
});

test('a hyphen inside a Japanese set name cannot fabricate a set id', () => {
  // This is the whole reason JP is special-cased rather than run through the
  // last-hyphen rule: that rule does not fail loudly here, it invents 'jp_Seedot_Ho'.
  const id = 'JP_jp_Seedot_Ho-Oh Legend_3';
  assert.equal(parseCardId(id).setId, null);
});

test('malformed ids are rejected rather than half-parsed', () => {
  for (const bad of ['', 'nounderscore', '_leading', null, undefined, 42]) {
    assert.deepEqual(parseCardId(bad), { badge: null, setId: null }, `for ${String(bad)}`);
  }
  // A badge with no set portion is a badge, and no set.
  assert.deepEqual(parseCardId('EN_nodash'), { badge: 'EN', setId: null });
});

// ── summarise ─────────────────────────────────────────────────────────────────
const IDS = [
  'EN_sv05-003', 'EN_sv05-004', 'EN_bw4-2',
  'DE_sv05-003', 'FR_sv05-003',
  'JP_jp_Seedot_Miracle of the Desert_0',
  'JP_jp_Seedot_Miracle of the Desert_1',
];

test('cards, sets touched and the language histogram', () => {
  const s = summarise({ msIds: IDS, tmsIds: ['EN_sv05-003'], pokemon: ['Seedot', 'Nuzleaf'] });
  assert.equal(s.cards, 7, 'every checked id counts, JP included');
  assert.equal(s.setsTouched, 2, 'sv05 and bw4 — JP contributes no set');
  assert.equal(s.unplaced, 2, 'the two JP printings are bucketed, not dropped');
  assert.deepEqual(s.languages, [
    { key: 'EN', count: 3 },
    { key: 'JP', count: 2 },
    { key: 'DE', count: 1 },
    { key: 'FR', count: 1 },
  ], 'JP counts toward languages even though it has no set');
  assert.deepEqual(s.topLanguage, { key: 'EN', count: 3 });
  assert.equal(s.tmsCards, 1);
  assert.equal(s.pokemon, 2);
  assert.equal(s.empty, false);
});

test('JP cards are counted once, never double-counted into a set', () => {
  const s = summarise({ msIds: IDS });
  const perSet = s.sets.reduce((n, x) => n + x.count, 0);
  assert.equal(perSet + s.unplaced, s.cards,
    'per-set counts plus the JP bucket must account for every card exactly once');
});

test('equal counts sort stably by key', () => {
  const s = summarise({ msIds: ['FR_a-1', 'DE_a-1', 'ES_a-1'] });
  assert.deepEqual(s.languages.map(l => l.key), ['DE', 'ES', 'FR']);
});

test('sets can be ordered by release date, newest first', () => {
  const s = summarise({
    msIds: ['EN_base1-1', 'EN_sv05-1', 'EN_bw4-1'],
    setDates: { base1: '1999-01-09', sv05: '2024-03-22', bw4: '2012-08-15' },
  });
  assert.deepEqual(s.setsByDate.map(x => x.key), ['sv05', 'bw4', 'base1']);
});

test('a set with no date in sets.json sorts last instead of looking ancient', () => {
  const s = summarise({
    msIds: ['EN_known-1', 'EN_undated-1'],
    setDates: { known: '2020-01-01' },
  });
  assert.deepEqual(s.setsByDate.map(x => x.key), ['known', 'undated']);
});

test('the empty state is empty only when ALL THREE checklists are', () => {
  assert.equal(summarise({}).empty, true);
  assert.equal(summarise({ msIds: [], tmsIds: [], setIds: [] }).empty, true);
  assert.equal(summarise({ tmsIds: ['EN_a-1'] }).empty, false,
    'a TMS-only collection is not an empty collection');
  assert.equal(summarise({ setIds: ['EN_a-1'] }).empty, false,
    'a single-set-only collection is not an empty collection');
  assert.equal(summarise({ msIds: ['EN_a-1'] }).empty, false);
});

test('the three checklists are reported as three numbers, never merged', () => {
  // They are independent by design, so the SAME physical card can appear in more than
  // one. Summing them would double-count and overstate the collection.
  const same = ['EN_sv05-003'];
  const s = summarise({ msIds: same, tmsIds: same, setIds: same });
  assert.deepEqual({ cards: s.cards, tmsCards: s.tmsCards, setCards: s.setCards },
    { cards: 1, tmsCards: 1, setCards: 1 });
  // And only the Master Set checklist feeds the histograms and the set count.
  assert.equal(s.setsTouched, 1);
  assert.deepEqual(s.languages, [{ key: 'EN', count: 1 }]);
});

test('an empty summary has no zero-division or undefined fields', () => {
  const s = summarise({});
  assert.deepEqual(
    { cards: s.cards, setsTouched: s.setsTouched, unplaced: s.unplaced,
      tmsCards: s.tmsCards, setCards: s.setCards, pokemon: s.pokemon, topLanguage: s.topLanguage },
    { cards: 0, setsTouched: 0, unplaced: 0, tmsCards: 0, setCards: 0, pokemon: 0, topLanguage: null },
  );
  assert.deepEqual(s.languages, []);
  assert.deepEqual(s.setsByDate, []);
});

// ── bars ──────────────────────────────────────────────────────────────────────
test('bars are scaled to the largest language, not to the total', () => {
  // With EN at 65 and the rest in single figures, share-of-total bars are all
  // invisible together — the breakdown would show one bar and eleven slivers.
  const bars = languageBars([{ key: 'EN', count: 65 }, { key: 'DE', count: 13 }]);
  assert.deepEqual(bars.map(b => b.pct), [100, 20]);
});

test('languageBars survives an empty collection', () => {
  assert.deepEqual(languageBars([]), []);
  assert.deepEqual(languageBars([{ key: 'EN', count: 0 }]), []);
});

// ── per-set distinct cards vs printings ───────────────────────────────────────
test('a set tracks DISTINCT cards separately from printings', () => {
  // Three languages of one card plus one other card = 4 printings, 2 cards. Only the
  // second can be measured against a set's official size.
  const s = summarise({ msIds: ['EN_sv05-3', 'DE_sv05-3', 'FR_sv05-3', 'EN_sv05-4'] });
  assert.deepEqual(s.sets, [{ key: 'sv05', count: 4, cards: 2 }]);
});

test('a full set collected in every language cannot exceed its own size', () => {
  // The bug this guards: 12 badges × 102 cards = 1224 printings against a 102 denominator.
  const ids = [];
  for (const b of ['EN', 'DE', 'FR', 'ES', 'IT', 'PT', 'TW', 'TH', 'ID', 'KR', 'SC']) {
    for (let i = 1; i <= 102; i++) ids.push(`${b}_base1-${i}`);
  }
  const s = summarise({ msIds: ids });
  assert.equal(s.sets[0].count, 1122, 'printings');
  assert.equal(s.sets[0].cards, 102, 'distinct cards — the number with a denominator');
  const [row] = expansionRows(s.setsByDate, { counts: { base1: { official: 102 } } });
  assert.equal(row.owned, 102);
  assert.equal(row.pct, 100, 'never above 100');
});

// ── date formatting ───────────────────────────────────────────────────────────
test('set dates render as "Mar 22, 2024" without a locale lookup', () => {
  assert.equal(formatSetDate('2024-03-22'), 'Mar 22, 2024');
  assert.equal(formatSetDate('1999-01-09'), 'Jan 9, 1999');
  assert.equal(formatSetDate('2024/12/01'), 'Dec 1, 2024');
  assert.equal(formatSetDate('2024-03-22T00:00:00Z'), 'Mar 22, 2024');
});

test('an unusable date renders as empty, never "NaN" or "Invalid Date"', () => {
  for (const bad of ['', null, undefined, 'soon', '2024', '2024-13-01']) {
    assert.equal(formatSetDate(bad), '', `for ${String(bad)}`);
  }
});

// ── expansion cards ───────────────────────────────────────────────────────────
const EXP_META = {
  names: { en: { sv05: 'Temporal Forces' } },
  dates: { sv05: '2024-03-22' },
  symbols: { sv05: 'https://x/sym.webp' },
  logos: { sv05: 'https://x/logo.webp' },
  counts: { sv05: { official: 162, total: 218 } },
};

test('an expansion row carries everything the card renders', () => {
  const s = summarise({ msIds: ['EN_sv05-3', 'DE_sv05-3', 'EN_sv05-4'] });
  assert.deepEqual(expansionRows(s.setsByDate, EXP_META), [{
    id: 'sv05', name: 'Temporal Forces', date: '2024-03-22',
    symbol: 'https://x/sym.webp', logo: 'https://x/logo.webp',
    owned: 2, printings: 3, total: 162, pct: 1,
  }]);
});

test('a set with no count gets pct null, NOT 0', () => {
  // 0 renders an empty progress bar, which claims "none of a known total". null means
  // the total is unknown, and the card hides the bar instead.
  const s = summarise({ msIds: ['EN_zz9-1'] });
  const [row] = expansionRows(s.setsByDate, { names: { en: {} } });
  assert.equal(row.pct, null);
  assert.equal(row.total, 0);
  assert.equal(row.name, 'zz9', 'falls back to the set id when sets.json has no name');
});

test('expansionRows honours its limit and survives empty input', () => {
  const s = summarise({ msIds: ['EN_a-1', 'EN_b-1', 'EN_c-1'] });
  assert.equal(expansionRows(s.setsByDate, {}, 2).length, 2);
  assert.deepEqual(expansionRows([], EXP_META), []);
  assert.deepEqual(expansionRows(), []);
});

test('languageBars reports the true share alongside the scaled height', () => {
  // The bar is scaled to the tallest language for legibility, so the honest proportion
  // has to travel separately or it cannot be read off the chart at all.
  const bars = languageBars([{ key: 'EN', count: 75 }, { key: 'DE', count: 25 }]);
  assert.deepEqual(bars.map(b => [b.pct, b.share]), [[100, 75], [33, 25]]);
});

test('plural', () => {
  assert.equal(plural(0, 'card'), '0 cards');
  assert.equal(plural(1, 'card'), '1 card');
  assert.equal(plural(2, 'card'), '2 cards');
  assert.equal(plural(1, 'Japanese printing'), '1 Japanese printing');
});
