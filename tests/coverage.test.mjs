// The weekly gap report (tools/lib/coverage.mjs): which sets we list fewer cards for
// than the set has, per language. Pure, except the last test, which checks that the
// TCGdex sweep hands build-data the card lists it reads (fetch is stubbed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runNumber, printedSetSize, compareSet, hasGap, findGaps, tcgdexEntries, jpEntries,
  numberRanges, summaryLines, reportMarkdown,
} from '../tools/lib/coverage.mjs';

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));

test('a card number is in the main run only when it is a plain number', () => {
  assert.equal(runNumber('001'), 1);
  assert.equal(runNumber('7'), 7);
  assert.equal(runNumber(12), 12);
  for (const n of ['RC5', 'TG01', 'SWSH001', 'n-pikachu', '', null, undefined, '1a']) {
    assert.equal(runNumber(n), null, String(n));
  }
});

test('a set with no count is not compared, rather than reported as a gap', () => {
  assert.equal(compareSet(null, ['1', '2']), null);
  assert.equal(compareSet({}, ['1']), null);
  assert.equal(compareSet({ official: 0, total: 0 }, []), null);
  const r = findGaps([{ lang: 'ja', set: 'promo', count: null, numbers: ['1'] }]);
  assert.equal(r.gaps.length, 0);
  assert.deepEqual(r.unchecked, [{ lang: 'ja', set: 'promo', reason: 'no set count' }]);
});

test('a complete set has no gap', () => {
  const c = compareSet({ official: 3, total: 3 }, ['001', '002', '003']);
  assert.equal(hasGap(c), false);
  assert.deepEqual(c.missingNumbers, []);
});

test('a secret rare above the official count never fills a hole in the run', () => {
  // 6 cards listed against an official 5, but #3 is not one of them.
  const c = compareSet({ official: 5, total: 7 }, ['1', '2', '4', '5', '6', '7']);
  assert.equal(c.listed, 6);
  assert.equal(c.missing, 1);
  assert.deepEqual(c.missingNumbers, [3]);
  assert.equal(c.short, 0);
  assert.equal(c.over, 0);
});

test('secret rares are not missing when no total says they exist', () => {
  const c = compareSet({ official: 3 }, ['1', '2', '3', '4', '5']);
  assert.equal(hasGap(c), false);
  assert.equal(c.total, null);
});

test('a complete run short of the total is a gap of its own kind', () => {
  const c = compareSet({ official: 3, total: 5 }, ['1', '2', '3', 'RC1']);
  assert.equal(c.missing, 0);
  assert.equal(c.short, 1);
  assert.ok(hasGap(c));
});

test('the same number spelled twice is a duplicate, not two cards', () => {
  const c = compareSet({ official: 2, total: 2 }, ['001', '1', '2', 'rc1', 'RC1']);
  assert.equal(c.listed, 3);
  assert.deepEqual(c.duplicates, ['001', 'rc1']);
  assert.equal(c.over, 1); // three different cards in a set of two
  assert.ok(hasGap(c));
});

test('a total below the official count is ignored', () => {
  const c = compareSet({ official: 5, total: 3 }, range(1, 5));
  assert.equal(c.total, null);
  assert.equal(hasGap(c), false);
});

test('a set not numbered 1..n is compared by count', () => {
  const c = compareSet({ official: 3, total: 3 }, ['SWSH001', 'SWSH002']);
  assert.equal(c.missingNumbers, null);
  assert.equal(c.missing, 1);
});

test('an empty card list misses the whole set; an unread one is unchecked', () => {
  const c = compareSet({ official: 4, total: 6 }, []);
  assert.equal(c.listed, 0);
  assert.equal(c.missing, 4);
  assert.equal(c.short, 2);
  const r = findGaps([{ lang: 'it', set: 'base5', count: { official: 4 }, numbers: undefined }]);
  assert.equal(r.gaps.length, 0);
  assert.deepEqual(r.unchecked, [{ lang: 'it', set: 'base5', reason: 'no card list read' }]);
});

test('gaps come back by language in first-seen order, then by set id', () => {
  const count = { official: 2 };
  const r = findGaps([
    { lang: 'en', set: 'b', count, numbers: ['1'] },
    { lang: 'de', set: 'a', count, numbers: ['1'] },
    { lang: 'en', set: 'a', count, numbers: ['2'] },
    { lang: 'en', set: 'c', count, numbers: ['1', '2'] },
  ]);
  assert.deepEqual(r.langs, ['en', 'de']);
  assert.equal(r.checked, 4);
  assert.deepEqual(r.gaps.map(g => `${g.lang}/${g.set}`), ['en/a', 'en/b', 'de/a']);
});

test('TCGdex: a set\'s total is the most cards any language lists for it', () => {
  // Measured shape: TCGdex's total is what it holds in that language, so English 5,
  // German 4, Spanish 3 for one set whose printed size is 3. data/sets.json keeps a
  // language's count only where it differs from English.
  const meta = {
    names: { en: { lt: 'Legendary Treasures', tp: 'Pocket' }, de: { lt: 'Legendäre Schätze' }, es: { lt: 'Tesoros' } },
    counts: { lt: { official: 3, total: 5 }, tp: { official: 1, total: 1 } },
    lang: { de: { counts: { lt: { official: 3, total: 4 } } }, es: { counts: { lt: { official: 3, total: 3 } } } },
  };
  const numbers = {
    en: { lt: ['1', '2', '3', 'RC1', 'RC2'], tp: [] },
    de: { lt: ['1', '2', '3', 'RC1'] },
    es: { lt: ['1', '2', '3'] },
  };
  const entries = tcgdexEntries(meta, numbers, { skip: id => id === 'tp' });
  assert.deepEqual(entries.map(e => `${e.lang}/${e.set}`), ['en/lt', 'de/lt', 'es/lt']);
  assert.ok(entries.every(e => e.count.total === 5 && e.count.official === 3));
  const r = findGaps(entries);
  assert.deepEqual(r.gaps.map(g => `${g.lang}/${g.set} short ${g.short}`), ['de/lt short 1', 'es/lt short 2']);
});

test('TCGdex: a list longer than any count raises the total, and a failed read stays unchecked', () => {
  const meta = { names: { fr: { pl3: 'Rivaux Émergents' }, en: { pl3: 'Supreme Victors' } }, counts: { pl3: { official: 2, total: 2 } } };
  const entries = tcgdexEntries(meta, { fr: { pl3: ['1', '2', 'SH1'] } });
  assert.equal(entries.find(e => e.lang === 'fr').count.total, 3);
  const r = findGaps(entries);
  assert.deepEqual(r.unchecked, [{ lang: 'en', set: 'pl3', reason: 'no card list read' }]);
  assert.equal(r.gaps.length, 0);
});

test('a printed number gives the set size only with a numeric denominator', () => {
  assert.equal(printedSetSize('001/165'), 165);
  assert.equal(printedSetSize('166/165'), 165);
  assert.equal(printedSetSize(' 7 / 011 '), 11);
  for (const n of ['058/DP-P', '001/SV-P', '13', '', null]) assert.equal(printedSetSize(n), null, String(n));
});

test('Japanese: the set size is the denominator most of its cards print', () => {
  const sets = [{ key: 'cyber-judge', name: 'Cyber Judge' }, { key: 'promo', name: 'SV-P Promos' },
    { key: 'neo', name: 'Neo Genesis' }, { key: 'mixed', name: 'Deck Kit' }];
  const rows = [
    ['cyber-judge', '001/004', 'A', null, '1'],
    ['cyber-judge', '002/004', 'B', 'Mirror Holofoil', '2--mirror-holofoil'], // only listed as a print
    ['cyber-judge', '004/004', 'D', null, '4'],
    ['cyber-judge', '005/004', 'E', null, '5'],            // secret rare
    ['cyber-judge', '', 'Booster Box', null, 'n-booster-box'],
    ['promo', '001/SV-P', 'P', null, '1'],
    ['neo', '', 'Pikachu', null, 'n-pikachu'],
    ['mixed', '001/030', 'X', null, '1'],
    ['mixed', '001/060', 'Y', null, '1'],
  ];
  const entries = jpEntries(sets, rows);
  const by = Object.fromEntries(entries.map(e => [e.set, e]));
  assert.deepEqual(by['cyber-judge'].count, { official: 4 });
  assert.deepEqual(by['cyber-judge'].numbers.sort(), ['1', '2', '4', '5', 'n-booster-box']);
  assert.equal(by.promo.count, null);
  assert.equal(by.neo.count, null);
  assert.equal(by.mixed.count, null, 'two denominators with no majority');
  const r = findGaps(entries);
  assert.deepEqual(r.gaps.map(g => [g.lang, g.set, g.missingNumbers]), [['ja', 'cyber-judge', [3]]]);
  assert.equal(r.unchecked.length, 3);
});

test('missing numbers read as ranges', () => {
  assert.equal(numberRanges([10, 9, 1, 2, 3, 7, 3]), '1-3, 7, 9-10');
  assert.equal(numberRanges([]), '');
});

test('the build log names every set with a gap, per language', () => {
  const count = { official: 3, total: 3 };
  const r = findGaps([
    { lang: 'en', set: 'sv01', count, numbers: ['1', '2', '3'] },
    { lang: 'de', set: 'bw11', count, numbers: ['1'] },
    { lang: 'de', set: 'xy1', count, numbers: ['1', '2', '3', '3'] },
    { lang: 'de', set: 'xy2', count: null, numbers: [] },
  ]);
  const lines = summaryLines(r);
  assert.match(lines[0], /3 set lists checked, 2 with a gap, 1 unchecked/);
  assert.equal(lines[1], '[coverage]   en: no gaps');
  assert.match(lines[2], /de: 2 set\(s\), 2 card\(s\) missing, 1 unchecked — bw11 -2, xy1 \+1$/);
});

test('the report is a table per language, with pipes escaped', () => {
  const r = findGaps([
    { lang: 'en', set: 'a', name: 'A | B', count: { official: 5 }, numbers: ['1', '5'] },
    { lang: 'it', set: 'b', name: 'B', count: { official: 2 }, numbers: [] },
  ]);
  const md = reportMarkdown(r, { builtAt: '2026-11-25T06:00:00.000Z' });
  assert.match(md, /^# Card coverage report/);
  assert.match(md, /\| a \| A \\\| B \| 2 \| 5 \|  \| 3 \| 0 \|  \| 2-4 \|/);
  assert.match(md, /\| b \| B \| 0 \| 2 \|.*\| no card list \|/);
});

test('the TCGdex set sweep hands every detail answer to onDetail', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const ok = body => ({ ok: true, status: 200, json: async () => body });
    if (/\/v2\/[^/]+\/sets$/.test(u)) return ok([{ id: 's1', name: 'One', cardCount: { official: 2, total: 2 } }]);
    if (/\/v2\/en\/sets\/s1$/.test(u)) return ok({ id: 's1', releaseDate: '2020-01-01', cards: [{ localId: '1' }, { localId: '2' }] });
    if (/\/v2\/[^/]+\/sets\/s1$/.test(u)) return ok({ id: 's1', releaseDate: '2020-01-01', cards: [] });
    return { ok: false, status: 404, json: async () => null };
  };
  try {
    const { getSetMeta } = await import('../js/api/providers/tcgdex.js');
    const seen = {};
    const meta = await getSetMeta({
      allEnSets: true, withSeries: false,
      onDetail: (lang, id, s) => {
        seen[lang] = s.cards.map(c => c.localId);
        if (lang === 'de') throw new Error('a broken hook');
      },
    });
    assert.deepEqual(seen.en, ['1', '2']);
    assert.deepEqual(seen.de, []);
    assert.equal(meta.dates.s1, '2020-01-01', 'a throwing hook does not cost the meta');
    assert.ok(meta.lang.de.noCards.includes('s1'));
  } finally {
    globalThis.fetch = realFetch;
  }
});
