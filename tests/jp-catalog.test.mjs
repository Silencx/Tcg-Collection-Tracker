// Japanese catalogue normalising rules (tools/lib/jp-catalog.mjs). Offline; inputs are
// the shapes PokéWallet returned on 2026-10-30.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalSetName, parseReleaseDate, splitPrint, splitNumberSuffix, cardTuple, cleanTuple,
  isJapaneseSet, japaneseOnly, pagesFor,
} from '../tools/lib/jp-catalog.mjs';

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

test('page counts cover the set and never drop to zero', () => {
  assert.equal(pagesFor(141), 1);
  assert.equal(pagesFor(200), 1);
  assert.equal(pagesFor(201), 2);
  assert.equal(pagesFor(0), 1);
  assert.equal(pagesFor(undefined), 1);
});
