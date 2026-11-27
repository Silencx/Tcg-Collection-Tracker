// api/set-list-model.js takes TCGdex's slips out of a language's set list, and
// tcgdex.getSetMeta (the weekly build and the live refresh) uses it. Fixtures are cut
// from TCGdex's answers of 2026-11-27: zh-cn lists the Traditional Chinese sets with
// cards as its own, CSV1C twice, and lowercase twins of eight CSM sets.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanSetList, setListFor, SET_LIST_QUIRKS } from '../js/api/set-list-model.js';

const count = (official, total = official) => ({ official, total });
const ZH_TW = [
  { id: 'SV7a', name: '樂園騰龍', cardCount: count(64) },
  { id: 'SV8', name: '超電突圍', cardCount: count(106) },
  { id: 'SV4M', name: '未來的一閃', cardCount: count(66) },
];
const ZH_CN = [
  { id: 'CSM1aC', name: '横空出世 赫', cardCount: count(151) },
  { id: 'csm1a', name: '风暴涌现', cardCount: count(211) },
  { id: 'CSM1.5C', name: '对战精英', cardCount: count(60) },
  { id: 'csm1.5', name: '战斗精英', cardCount: count(151) },
  { id: 'CSV1C', name: '亘古开来', cardCount: count(127) },
  { id: 'CSV1C', name: '宝石包 第一卷', cardCount: count(9) },
  { id: 'CBB2C', name: '宝石包Vol.2', cardCount: count(15) },
  { id: 'SV7a', name: '樂園騰龍', cardCount: count(64) },
  { id: 'SV8', name: '超電突圍', cardCount: count(106) },
];

test('zh-cn: the Traditional Chinese copies, the twins and the repeat are left out', () => {
  const r = cleanSetList(ZH_CN, { copyOf: ZH_TW, twins: true });
  assert.deepEqual(r.sets.map(s => s.id), ['CSM1aC', 'CSM1.5C', 'CSV1C', 'CBB2C']);
  assert.deepEqual(r.copies, ['SV7a', 'SV8']);
  assert.deepEqual(r.twins, ['csm1a', 'csm1.5']);
  assert.deepEqual(r.repeats, ['CSV1C']);
});

test('a repeated id keeps the entry with more cards, in its first place', () => {
  const r = cleanSetList([
    { id: 'A', cardCount: count(9) }, { id: 'B', cardCount: count(5) }, { id: 'A', cardCount: count(127) },
  ]);
  assert.deepEqual(r.sets.map(s => [s.id, s.cardCount.total]), [['A', 127], ['B', 5]]);
  // On a tie the first listed stays.
  const tie = cleanSetList([{ id: 'A', name: 'one', cardCount: count(3) }, { id: 'A', name: 'two', cardCount: count(3) }]);
  assert.equal(tie.sets[0].name, 'one');
});

test('a shared id with its own name is not a copy', () => {
  // SV4M is a Korean set too, under the same id: the name tells them apart.
  const r = cleanSetList([{ id: 'SV4M', name: '퓨처 플래시' }], { copyOf: ZH_TW });
  assert.deepEqual(r.sets.map(s => s.id), ['SV4M']);
  assert.deepEqual(r.copies, []);
});

test('only an all-lowercase id is a twin, and only with twins on', () => {
  const sets = [{ id: 'CSM1aC' }, { id: 'csm1a' }, { id: 'CSV1' }, { id: 'CSV1C' }];
  assert.deepEqual(cleanSetList(sets, { twins: true }).sets.map(s => s.id), ['CSM1aC', 'CSV1', 'CSV1C']);
  assert.equal(cleanSetList(sets).sets.length, 4);
});

test('junk entries are dropped without a throw', () => {
  for (const v of [null, undefined, 'x', {}, [null, 1, { name: 'no id' }, { id: '' }]]) {
    assert.deepEqual(cleanSetList(v).sets, []);
  }
});

test('a language with no quirks gets its list exactly as TCGdex sent it', () => {
  const ko = [{ id: 'SV4M', name: '퓨처 플래시' }, { id: 'SV4M', name: 'again' }];
  const r = setListFor('ko', c => (c === 'ko' ? ko : null));
  assert.equal(r.sets, ko);
  assert.equal(r.missing, null);
  assert.deepEqual(setListFor('ko', () => null).sets, []);
});

test('zh-cn is cleaned against zh-tw, and dropped whole when zh-tw is not there', () => {
  assert.deepEqual(SET_LIST_QUIRKS['zh-cn'], { copyOf: 'zh-tw', twins: true });
  const both = setListFor('zh-cn', c => ({ 'zh-cn': ZH_CN, 'zh-tw': ZH_TW })[c] || null);
  assert.deepEqual(both.sets.map(s => s.id), ['CSM1aC', 'CSM1.5C', 'CSV1C', 'CBB2C']);
  // Without the reference the copies cannot be told apart, and would be published as
  // Simplified Chinese sets.
  const alone = setListFor('zh-cn', c => (c === 'zh-cn' ? ZH_CN : null));
  assert.deepEqual(alone.sets, []);
  assert.equal(alone.missing, 'zh-tw');
});

// ── tcgdex.getSetMeta, with fetch stubbed ───────────────────────────────────────
const LISTS = {
  en: [{ id: 'sv05', name: 'Temporal Forces', cardCount: count(162, 218) }],
  'zh-tw': ZH_TW,
  th: [{ id: 'SV4M', name: 'TH name', cardCount: count(66, 92) }],
  ko: [{ id: 'SV4M', name: '퓨처 플래시', cardCount: count(66, 95) }, { id: 'SV5K', name: '와일드 포스', cardCount: count(71) }],
  'zh-cn': ZH_CN,
};
// zh-cn's series list names every set again, copies and twins included.
const SERIES = { 'zh-cn': { SV: ['SV7a', 'SV8', 'CSV1C', 'CBB2C'], SM: ['CSM1aC', 'csm1a', 'CSM1.5C', 'csm1.5'] } };

globalThis.fetch = async (url) => {
  const u = String(url);
  const ok = body => ({ ok: true, status: 200, json: async () => body });
  let m = /\/v2\/([^/]+)\/sets$/.exec(u);
  if (m) return ok(LISTS[m[1]] || []);
  m = /\/v2\/([^/]+)\/series$/.exec(u);
  if (m) return ok(Object.keys(SERIES[m[1]] || {}).map(id => ({ id, name: id })));
  m = /\/v2\/([^/]+)\/series\/([^/]+)$/.exec(u);
  if (m) return ok({ id: m[2], sets: (SERIES[m[1]]?.[m[2]] || []).map(id => ({ id, name: `series:${id}` })) });
  m = /\/v2\/([^/]+)\/sets\/([^/]+)$/.exec(u);
  if (m) {
    const id = decodeURIComponent(m[2]);
    return ok({ id, releaseDate: '2025-01-17', cards: m[1] === 'ko' && id === 'SV4M' ? [{ id: 'SV4M-001' }] : [] });
  }
  return { ok: false, status: 404, json: async () => null };
};

const { getSetMeta } = await import('../js/api/providers/tcgdex.js');

test('getSetMeta: Simplified Chinese gets its own sets only, from the list and the series sweep', async () => {
  const meta = await getSetMeta({ allEnSets: true, withSeries: true });
  assert.deepEqual(Object.keys(meta.names['zh-Hans']).sort(), ['CBB2C', 'CSM1.5C', 'CSM1aC', 'CSV1C']);
  assert.equal(meta.names['zh-Hans'].CSV1C, '亘古开来');
  assert.deepEqual(meta.cleaned['zh-Hans'], { copies: ['SV7a', 'SV8'], twins: ['csm1a', 'csm1.5'], repeats: ['CSV1C'], missing: null });
  // The twins got no symbol, logo or series entry by the back door either.
  assert.equal(meta.setSeries.csm1a, undefined);
  // Traditional Chinese is untouched.
  assert.deepEqual(Object.keys(meta.names['zh-Hant']).sort(), ['SV4M', 'SV7a', 'SV8']);
});

test('getSetMeta: Korean sets are listed, with their own card lists and counts', async () => {
  const meta = await getSetMeta({ allEnSets: true, withSeries: true });
  assert.deepEqual(Object.keys(meta.names.ko).sort(), ['SV4M', 'SV5K']);
  assert.deepEqual(meta.lang.ko.noCards, ['SV5K']);
  // SV4M is a TW set too: the flat count is TW's, and KR's and TH's differing ones are
  // overrides (they used to show TW's).
  assert.deepEqual(meta.counts.SV4M, count(66));
  assert.deepEqual(meta.lang.ko.counts.SV4M, count(66, 95));
  assert.deepEqual(meta.lang.th.counts.SV4M, count(66, 92));
  assert.equal(meta.lang.ko.counts.SV5K, undefined);
});
