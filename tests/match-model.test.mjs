// Which cards belong to a Pokémon (js/api/match-model.js): the whole-word name rule or
// the card's Pokédex numbers, with the numbers checked against the name. The cards here
// are real TCGdex English cards as of 2026-11-26, wrong numbers included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardIsSpecies, readDexIds, dexByNameFrom } from '../js/api/match-model.js';

const DEX = dexByNameFrom([
  { name: 'Pikachu', dex: 25 }, { name: 'Nidoran♀', dex: 29 }, { name: 'Nidoran♂', dex: 32 },
  { name: 'Psyduck', dex: 54 }, { name: "Farfetch'd", dex: 83 }, { name: 'Electrode', dex: 101 },
  { name: 'Magikarp', dex: 129 }, { name: 'Gyarados', dex: 130 }, { name: 'Lapras', dex: 131 },
  { name: 'Mewtwo', dex: 150 }, { name: 'Mew', dex: 151 }, { name: 'Ho-Oh', dex: 250 },
  { name: 'Rotom', dex: 479 }, { name: 'Zekrom', dex: 644 }, { name: 'Sprigatito', dex: 906 },
  { name: 'Terapagos', dex: 1024 },
]);
const is = (name, dexIds, species) => cardIsSpecies({ name, dexIds }, species, DEX);

test('Pokédex numbers are read as positive whole numbers, sorted, once each', () => {
  assert.deepEqual(readDexIds([491, 488, 491]), [488, 491]);
  assert.deepEqual(readDexIds([25, null, '25', 0, -1, 2.5]), [25]);
  assert.deepEqual(readDexIds(null), []);
  assert.deepEqual(readDexIds('25'), []);
});

test('a name the name rule cannot read is found by its number', () => {
  assert.equal(is('Nidoran ♀', [29], 'Nidoran♀'), true, 'space before the sign');
  assert.equal(is("Giovanni's Nidoran ♂", [32], 'Nidoran♂'), true);
  assert.equal(is('Farfetch’d', [83], "Farfetch'd"), true, 'curly apostrophe');
  assert.equal(is('Ho Oh', [250], 'Ho-Oh'), true, 'no hyphen');
  assert.equal(is('Nidoran ♀', [29], 'Nidoran♂'), false, 'the number still has to be the right one');
});

test('Mew is not Mewtwo, by name or by number, and a Tag Team is both', () => {
  assert.equal(is('Mewtwo', [150], 'Mew'), false);
  assert.equal(is('Mew', [151], 'Mewtwo'), false);
  assert.equal(is('Mew & Mewtwo-GX', [150, 151], 'Mew'), true);
  assert.equal(is('Mew & Mewtwo-GX', [150, 151], 'Mewtwo'), true);
  assert.equal(is('Pikachu & Zekrom GX', [25, 644], 'Zekrom'), true);
});

test('cameos whose names leave the Pokémon out are found by number', () => {
  const friends = [25, 906, 909, 912, 1024];
  assert.equal(is('Terapagos & Friends', friends, 'Pikachu'), true, 'Terapagos is named, and among the numbers');
  assert.equal(is('Terapagos & Friends', friends, 'Sprigatito'), true);
  assert.equal(is('Tropical Tidal Wave', [25, 54, 183, 187], 'Psyduck'), true, 'a Trainer with numbers');
});

test('a number the name contradicts is not believed, and the name still counts', () => {
  // TCGdex numbers these as another Pokémon. Each stays its named Pokémon's card and is
  // not filed under the number's.
  assert.equal(is('Electrode', [130], 'Gyarados'), false);
  assert.equal(is('Electrode', [130], 'Electrode'), true);
  assert.equal(is('Lapras', [129], 'Magikarp'), false);
  assert.equal(is('Lapras', [129], 'Lapras'), true);
  // Knowing only that a card carries the number (the live number search, GraphQL down):
  // a name naming another Pokémon outside it is a contradiction too.
  assert.equal(is('Terapagos & Friends', [25], 'Pikachu'), false);
});

test('cards without numbers fall back to the name rule', () => {
  assert.equal(is('Rotom Bike', [], 'Rotom'), true, 'a Trainer');
  assert.equal(is('Rotom Bike', undefined, 'Rotom'), true);
  assert.equal(is('Heat Rotom ex', [], 'Rotom'), true, 'the newest set, before TCGdex numbers it');
  assert.equal(is('Porygon-Z', [], 'Porygon'), false);
});

test('without the species list, or for a name it lacks, the name rule alone', () => {
  assert.equal(cardIsSpecies({ name: 'Nidoran ♀', dexIds: [29] }, 'Nidoran♀'), false);
  assert.equal(cardIsSpecies({ name: 'Nidoran♀', dexIds: [29] }, 'Nidoran♀'), true);
  assert.equal(cardIsSpecies({ name: 'Ho Oh', dexIds: [250] }, 'Hooh', DEX), false);
  assert.deepEqual([...dexByNameFrom([{ name: 'Mew', dex: 151 }, { name: 'Bad' }, null])], [['Mew', 151]]);
});
