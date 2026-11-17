// Japanese catalogue normalising rules (tools/lib/jp-catalog.mjs). Offline; inputs are
// the shapes PokéWallet returned on 2026-10-30.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalSetName, parseReleaseDate, splitPrint, splitNumberSuffix, cardTuple, cleanTuple,
  isJapaneseSet, japaneseOnly, pagesFor, publishCheck, planFetch, dropTwinSets,
} from '../tools/lib/jp-catalog.mjs';
import { limitlessCodeVariants } from '../tools/lib/limitless.mjs';

const KNOWN = ['Cyber Judge', 'Bonds to the End of Time', 'Latios ex Half Deck', 'SM-P Promotional cards', 'Fever-Burst Fighter'];

test('a set Bulbapedia also has keeps Bulbapedia\'s exact name', () => {
  assert.equal(canonicalSetName('SV5M: Cyber Judge', KNOWN), 'Cyber Judge');
  assert.equal(canonicalSetName('Pt2: Bonds to the End of Time', KNOWN), 'Bonds to the End of Time');
  assert.equal(canonicalSetName('XY11-Bb: Fever-Burst Fighter', KNOWN), 'Fever-Burst Fighter');
});

test('renamed products map back through the aliases', () => {
  assert.equal(canonicalSetName('Gift Box (Latios)', KNOWN), 'Latios ex Half Deck');
  assert.equal(canonicalSetName('SM-P: Sun & Moon Promos', KNOWN), 'SM-P Promotional cards');
});

test('any other set just loses its code prefix', () => {
  assert.equal(canonicalSetName('SV4a: Shiny Treasure ex', KNOWN), 'Shiny Treasure ex');
  assert.equal(canonicalSetName('Base Expansion Pack', KNOWN), 'Base Expansion Pack');
  assert.equal(canonicalSetName('L1: HeartGold Collection', []), 'HeartGold Collection');
});

test('release dates parse from PokéWallet\'s text, and nothing is guessed', () => {
  assert.equal(parseReleaseDate('3rd August, 2007'), '2007-08-03');
  assert.equal(parseReleaseDate('9th October, 2009'), '2009-10-09');
  assert.equal(parseReleaseDate('21st June 2024'), '2024-06-21');
  assert.equal(parseReleaseDate(null), null);
  assert.equal(parseReleaseDate('2007'), null);
  assert.equal(parseReleaseDate('40th Smarch, 2007'), null);
});

test('a separately-listed print is split from its card name', () => {
  assert.deepEqual(splitPrint('Weedle (Mirror Holofoil)'), { base: 'Weedle', print: 'Mirror Holofoil' });
  assert.deepEqual(splitPrint('Shiftry'), { base: 'Shiftry', print: null });
  assert.deepEqual(splitPrint('(Mirror Holofoil)'), { base: '(Mirror Holofoil)', print: null });
});

test('a number baked into the name is split off and used when the field is empty', () => {
  assert.deepEqual(splitNumberSuffix('Alolan Exeggutor - 002/103'), { name: 'Alolan Exeggutor', number: '002/103' });
  assert.deepEqual(splitNumberSuffix('Garchomp LV.X - 058/DP-P'), { name: 'Garchomp LV.X', number: '058/DP-P' });
  assert.deepEqual(splitNumberSuffix('Pikachu - 13'), { name: 'Pikachu', number: '13' });
  assert.deepEqual(splitNumberSuffix('Porygon-Z'), { name: 'Porygon-Z', number: null });
  assert.deepEqual(splitNumberSuffix('Mew - 25th Anniversary'), { name: 'Mew - 25th Anniversary', number: null });
  assert.deepEqual(cardTuple(0, { id: 'x', card_info: { name: 'Pikachu - 13', card_number: null } }), [0, '13', 'Pikachu', null, null, 'x']);
  assert.deepEqual(cleanTuple([2, '', 'Meganium - 008/070', null, 'Rare', 'r']), [2, '008/070', 'Meganium', null, 'Rare', 'r']);
});

test('cards are stored as compact tuples', () => {
  const c = { id: 'pk_1', card_info: { name: 'Seedot (Mirror Holofoil)', card_number: '001/053', rarity: 'Common' } };
  assert.deepEqual(cardTuple(7, c), [7, '001/053', 'Seedot', 'Mirror Holofoil', 'Common', 'pk_1']);
  assert.deepEqual(cardTuple(0, { id: 'x', card_info: { name: 'DP1 Seedot', card_number: null } }), [0, '', 'DP1 Seedot', null, null, 'x']);
});

test('Thai and Indonesian promo sets are not Japanese; Chinese/Japanese promos are', () => {
  assert.equal(isJapaneseSet('Scarlet & Violet Thai Promos'), false);
  assert.equal(isJapaneseSet('Scarlet & Violet Indonesian Promos'), false);
  assert.equal(isJapaneseSet('Sword & Shield Chinese/Japanese Promos'), true);
  assert.equal(isJapaneseSet('SV5M: Cyber Judge'), true);
  const { sets, cards } = japaneseOnly(
    [{ pwName: 'A' }, { pwName: 'Scarlet & Violet Thai Promos' }, { pwName: 'B' }],
    [[0, '1', 'x'], [1, '2', 'y'], [2, '3', 'z']],
  );
  assert.deepEqual(sets.map(s => s.pwName), ['A', 'B']);
  assert.deepEqual(cards, [[0, '1', 'x'], [1, '3', 'z']]);
});

// A set with `n` numbered cards 1..n named after `names` (cycled), as catalogue tuples.
const numbered = (setIndex, n, names = ['Abra', 'Kadabra', 'Alakazam', 'Pikachu', 'Raichu', 'Eevee']) =>
  Array.from({ length: n }, (_, i) => [setIndex, `${String(i + 1).padStart(3, '0')}/${n}`, `${names[i % names.length]} ${i}`, null]);

test('a new set that repeats a published one is left out; the published one never is', () => {
  const sets = [
    { name: 'Pokemon Card 151', code: 'SV2a', limitless: 'SV2a' },
    { name: 'SV2a', code: 'xsv2a', limitless: null },                // PokéWallet's second copy
    { name: 'Expansion Pack', code: '23721', limitless: null },
    { name: 'Evolutions Collection 1', code: 'EC1', limitless: null }, // bigger, but new
  ];
  const cards = [
    ...numbered(0, 20), ...numbered(1, 20).map(c => [1, c[1].split('/')[0].replace(/^0+/, ''), c[2], null]),
    ...numbered(2, 10).map(c => [2, '', c[2], null]),
    ...numbered(3, 10).map(c => [3, '', c[2], null]), ...numbered(3, 4).map(c => [3, '', `Extra ${c[2]}`, null]),
  ];
  const prior = [{ name: 'Pokemon Card 151', code: 'SV2a' }, { name: 'Expansion Pack', code: '23721' }];
  const out = dropTwinSets(sets, cards, prior);
  assert.deepEqual(out.sets.map(s => s.code), ['SV2a', '23721']);
  assert.deepEqual(out.dropped.map(d => `${d.set.code}=${d.twinOf.code}`).sort(), ['EC1=23721', 'xsv2a=SV2a']);
  assert.ok(out.cards.every(c => c[0] === 0 || c[0] === 1));
  assert.equal(out.cards.length, 30);
});

test('twins: partial overlap, small sets, numberless against numbered, and a chain', () => {
  const sets = [
    { name: 'Old', code: 'O', limitless: null },
    { name: 'Half', code: 'H', limitless: null },     // 6 of 10 repeat Old: kept
    { name: 'Tiny', code: 'T', limitless: null },     // 4 cards, all repeats: too small to judge
    { name: 'Names', code: 'N', limitless: null },    // numberless, same names as Old's numbered cards: kept
    { name: 'Copy', code: 'C', limitless: null },     // new copy of Old
    { name: 'Copy of copy', code: 'CC', limitless: null },
  ];
  const old = numbered(0, 20);
  const cards = [
    ...old,
    ...old.slice(0, 6).map(c => [1, ...c.slice(1)]), ...numbered(1, 4).map(c => [1, `X${c[1]}`, `Other ${c[2]}`, null]),
    ...old.slice(0, 4).map(c => [2, ...c.slice(1)]),
    ...old.slice(0, 10).map(c => [3, '', c[2], null]),
    ...old.map(c => [4, ...c.slice(1)]),
    ...old.slice(0, 15).map(c => [5, ...c.slice(1)]),
  ];
  const out = dropTwinSets(sets, cards, [{ name: 'Old', code: 'O' }]);
  assert.deepEqual(out.sets.map(s => s.code), ['O', 'H', 'T', 'N']);
  assert.deepEqual(out.dropped.map(d => `${d.set.code}=${d.twinOf.code}`).sort(), ['C=O', 'CC=O']);
  // Nothing published yet: the same rules, the stronger set of each pair stays.
  assert.equal(dropTwinSets(sets.slice(0, 1).concat(sets[4]), [...old, ...old.map(c => [1, ...c.slice(1)])]).sets.length, 1);
  // Separately-listed prints never count as repeats.
  assert.equal(dropTwinSets(sets, cards.map(c => (c[0] === 4 ? [4, c[1], c[2], 'Mirror Holofoil'] : c)),
    [{ name: 'Old', code: 'O' }]).sets.some(s => s.code === 'C'), true);
});

test('only a complete walk may replace the committed card list', () => {
  assert.deepEqual(publishCheck({ incomplete: 0, sets: 457, committedSets: 457 }), { ok: true, why: null });
  assert.equal(publishCheck({ incomplete: 0, sets: 460, committedSets: 0 }).ok, true);   // first publish
  assert.equal(publishCheck({ incomplete: 3, sets: 454, committedSets: 457 }).ok, false); // stopped at the quota
  assert.equal(publishCheck({ incomplete: 0, sets: 120, committedSets: 457 }).ok, false); // degraded /sets
  assert.equal(publishCheck({ incomplete: 0, sets: 0 }).ok, false);
});

test('a run fetches new sets, then changed ones, then the oldest few of the rest', () => {
  const sets = [
    { set_id: 1, card_count: 50 },    // cached, same count, fetched day 3
    { set_id: 2, card_count: 60 },    // not cached: new
    { set_id: 3, card_count: 72 },    // cached at 70: changed
    { set_id: 4, card_count: 10 },    // cached, fetched day 1 (oldest)
    { set_id: 5, card_count: 20 },    // cached, fetched day 2
  ];
  const cache = { 1: { count: 50, fetched: 3 }, 3: { count: 70, fetched: 9 }, 4: { count: 10, fetched: 1 }, 5: { count: 20, fetched: 2 } };
  const cachedOf = id => cache[id] || null;
  const plan = (o) => planFetch(sets, cachedOf, o).map(p => `${p.set.set_id}:${p.why}`);
  assert.deepEqual(plan(), ['2:new', '3:changed']);                                // no rotation
  assert.deepEqual(plan({ rotate: 2 }), ['2:new', '3:changed', '4:stale', '5:stale']);
  assert.deepEqual(plan({ rotate: 99 }), ['2:new', '3:changed', '4:stale', '5:stale', '1:stale']);
  assert.equal(plan({ refresh: true, rotate: 2 }).length, 5);
  assert.ok(plan({ refresh: true }).every(p => p.endsWith(':refresh')));
});

test('a cached copy with no recorded time or count is rotated first, never treated as changed', () => {
  const sets = [{ set_id: 'a', card_count: 5 }, { set_id: 'b', card_count: 5 }];
  const cachedOf = id => (id === 'a' ? { count: 5, fetched: 100 } : { count: null, fetched: 0 });
  assert.deepEqual(planFetch(sets, cachedOf, { rotate: 1 }).map(p => `${p.set.set_id}:${p.why}`), ['b:stale']);
});

test('Limitless codes are tried as spelled first — the CDN is case-sensitive', () => {
  assert.deepEqual(limitlessCodeVariants('SV4a'), ['SV4a', 'SV4A']);
  assert.deepEqual(limitlessCodeVariants('XY11-Bb'), ['XY11-Bb', 'XY11-BB', 'XY11Bb', 'XY11BB']);
  assert.deepEqual(limitlessCodeVariants('L1: HG'), ['L1HG']);
  assert.deepEqual(limitlessCodeVariants(null), []);
});

test('page counts cover the set and never drop to zero', () => {
  assert.equal(pagesFor(141), 1);
  assert.equal(pagesFor(200), 1);
  assert.equal(pagesFor(201), 2);
  assert.equal(pagesFor(0), 1);
  assert.equal(pagesFor(undefined), 1);
});
