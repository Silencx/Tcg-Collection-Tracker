// The sidebar's index is built from a walk of #dyn's children, so its grouping has
// to cope with whatever order the DOM is in — including a set that precedes any era
// label, which happens on the sort-toggle path where a keyed banner is re-appended
// before renderBySet writes the first label. Ids come from remote set names, so the
// slug/collision rules are the other thing worth pinning down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSetNavIndex, navIdFor, matchesNavQuery } from '../js/ui/setnav-index.js';

const era = (label, series) => ({ kind: 'era', label, series });
const set = (name, isJp) => ({ kind: 'set', name, isJp });

test('sets are grouped under the era label that precedes them', () => {
  const out = buildSetNavIndex([
    era('Scarlet & Violet', 'sv'), set('Paldea Evolved'), set('Obsidian Flames'),
    era('Sword & Shield', 'swsh'), set('Evolving Skies'),
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].era.label, 'Scarlet & Violet');
  assert.equal(out[0].era.series, 'sv');
  assert.deepEqual(out[0].sets.map(s => s.name), ['Paldea Evolved', 'Obsidian Flames']);
  assert.deepEqual(out[1].sets.map(s => s.name), ['Evolving Skies']);
});

test('sets appearing before any era label land in a leading null-era section', () => {
  const out = buildSetNavIndex([set('Orphan Set'), era('XY', 'xy'), set('Evolutions')]);
  assert.equal(out.length, 2);
  assert.equal(out[0].era, null);
  assert.deepEqual(out[0].sets.map(s => s.name), ['Orphan Set']);
  assert.equal(out[1].era.label, 'XY');
});

test('an era with no sets is kept as an empty section', () => {
  const out = buildSetNavIndex([era('Empty Era', 'e'), era('Real Era', 'r'), set('A Set')]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].sets, []);
  assert.equal(out[1].sets.length, 1);
});

test('index counts SETS only, so rows pair with set-block elements', () => {
  const out = buildSetNavIndex([era('A'), set('one'), set('two'), era('B'), set('three')]);
  assert.deepEqual(out.flatMap(s => s.sets).map(s => s.index), [0, 1, 2]);
});

test('the JP flag survives grouping', () => {
  const out = buildSetNavIndex([era('XY'), set('Phantom Forces'), set('ファントムゲート', true)]);
  assert.equal(out[0].sets[0].isJp, false);
  assert.equal(out[0].sets[1].isJp, true);
});

test('duplicate set names get distinct ids', () => {
  const out = buildSetNavIndex([era('A'), set('Base Set'), set('Base Set'), set('Base Set')]);
  const ids = out[0].sets.map(s => s.navId);
  assert.deepEqual(ids, ['set-base-set', 'set-base-set-2', 'set-base-set-3']);
  assert.equal(new Set(ids).size, 3);
});

test('ids are unique across sections too', () => {
  const out = buildSetNavIndex([era('A'), set('Promo'), era('B'), set('Promo')]);
  assert.notEqual(out[0].sets[0].navId, out[1].sets[0].navId);
});

test('empty and malformed descriptors are skipped, not thrown on', () => {
  assert.deepEqual(buildSetNavIndex([]), []);
  assert.deepEqual(buildSetNavIndex(null), []);
  assert.deepEqual(buildSetNavIndex(undefined), []);
  const out = buildSetNavIndex([null, { kind: 'nonsense' }, era('A'), set('S')]);
  assert.equal(out.length, 1);
  assert.equal(out[0].sets.length, 1);
});

test('navIdFor slugifies accents, punctuation and spaces', () => {
  assert.equal(navIdFor('Éclat des Ténèbres'), 'set-clat-des-t-n-bres');
  assert.equal(navIdFor('Sword & Shield—Rebel Clash'), 'set-sword-shield-rebel-clash');
  assert.equal(navIdFor('  Base  Set  '), 'set-base-set');
});

test('navIdFor still returns a usable id when nothing slugifiable remains', () => {
  // All-kana JP set names reduce to nothing; they still need an id, and two of them
  // must not collide.
  const taken = new Set();
  const a = navIdFor('ポケモンカード', taken);
  const b = navIdFor('拡張パック', taken);
  assert.equal(a, 'set-set');
  assert.equal(b, 'set-set-2');
  assert.notEqual(a, b);
  assert.equal(navIdFor('', new Set()), 'set-set');
});

test('navIdFor output is a valid id/CSS token', () => {
  for (const n of ['Éclat des Ténèbres', 'ポケモン', 'A/B: C!', '???', '2024 Promo']) {
    assert.match(navIdFor(n, new Set()), /^set-[a-z0-9-]+$/);
  }
});

test('matchesNavQuery matches the set name, case-insensitively', () => {
  assert.equal(matchesNavQuery('Obsidian Flames', 'Scarlet & Violet', 'obsid'), true);
  assert.equal(matchesNavQuery('Obsidian Flames', 'Scarlet & Violet', 'OBSID'), true);
  assert.equal(matchesNavQuery('Obsidian Flames', 'Scarlet & Violet', 'zzz'), false);
});

test('matchesNavQuery also matches the era label', () => {
  // Typing an era name should surface its sets even though none is called that.
  assert.equal(matchesNavQuery('Evolving Skies', 'Sword & Shield', 'sword'), true);
});

test('an empty or whitespace query matches everything', () => {
  assert.equal(matchesNavQuery('Anything', 'Any Era', ''), true);
  assert.equal(matchesNavQuery('Anything', 'Any Era', '   '), true);
  assert.equal(matchesNavQuery('Anything', 'Any Era', null), true);
  assert.equal(matchesNavQuery('Anything', 'Any Era', undefined), true);
});

test('matchesNavQuery trims the query before matching', () => {
  assert.equal(matchesNavQuery('Obsidian Flames', '', '  flames  '), true);
});
