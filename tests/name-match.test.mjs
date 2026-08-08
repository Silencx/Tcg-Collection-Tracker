// TCGdex's /cards?name=X is a CONTAINS match, so the provider has to decide for
// itself which returned cards really are the Pokémon that was asked for.
// Over-rejecting silently drops cards a collector owns; under-rejecting files
// another species' cards under the wrong name. Both failure modes are quiet, so
// the boundary rules are pinned down here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namesSpecies } from '../js/api/providers/tcgdex.js';

// [card name as printed, species queried, should it count]
const CASES = [
  // — plain hits —
  ['Mew', 'Mew', true],
  ['Shiftry', 'Shiftry', true],
  ['Charizard ex', 'Charizard', true],
  ['Dark Charizard', 'Charizard', true],
  ['Radiant Charizard', 'Charizard', true],
  ['Charizard V', 'Charizard', true],
  ['Iron Valiant ex', 'Iron Valiant', true],
  ["Farfetch'd V", "Farfetch'd", true],

  // — the bug this exists for: contains-match bleed —
  ['Mewtwo', 'Mew', false],
  ['Mewtwo ex', 'Mew', false],
  ['Charmander', 'Charizard', false],
  ['Raichu', 'Pikachu', false],
  ['Pikachu', 'Pika', false],
  ['Nuzleaf', 'Seedot', false],
  ['Tapu Lele', 'Tapu Koko', false],
  ['Porygon2', 'Porygon', false],
  ['Nidoran♂', 'Nidoran♀', false],

  // — cameos: two species on one card, both count (README calls this a feature) —
  ['Seedot & Nuzleaf-GX', 'Seedot', true],
  ['Seedot & Nuzleaf-GX', 'Nuzleaf', true],
  ['Mewtwo & Mew-GX', 'Mew', true],
  ['Mewtwo & Mew-GX', 'Mewtwo', true],

  // — hyphens: card SUFFIX (same Pokémon) vs another species' name —
  ['Charizard-GX', 'Charizard', true],
  ['Mew-EX', 'Mew', true],
  ['Ho-Oh-GX', 'Ho-Oh', true],
  ['Ho-Oh V', 'Ho-Oh', true],
  ['Porygon-Z', 'Porygon', false],   // Porygon-Z is its own species
  ['Porygon-Z ex', 'Porygon', false],
  ['Porygon-Z', 'Porygon-Z', true],
  ['Kommo-o', 'Kommo', false],
  ['Kommo-o GX', 'Kommo-o', true],
  ['Ho-Oh', 'Ho', false],

  // — names whose last character is not a word character: `\b` cannot help here —
  ['Nidoran♀', 'Nidoran♀', true],
  ["Farfetch'd", "Farfetch'd", true],
  ['Mr. Mime', 'Mr. Mime', true],
];

test('namesSpecies matches whole species names only', () => {
  const wrong = CASES
    .filter(([card, species, want]) => namesSpecies(card, species) !== want)
    .map(([card, species, want]) => `"${card}" ~ "${species}": expected ${want}, got ${!want}`);
  assert.deepEqual(wrong, []);
});

test('namesSpecies handles absent or non-string card names', () => {
  for (const bad of [undefined, null, '', 0, {}, []]) {
    assert.equal(namesSpecies(bad, 'Mew'), false, `expected false for ${JSON.stringify(bad)}`);
  }
});

test('a species containing regex metacharacters is matched literally', () => {
  // 'Mr. Mime' — an unescaped '.' would also match "Mr! Mime" / "MrXMime".
  assert.equal(namesSpecies('Mr. Mime', 'Mr. Mime'), true);
  assert.equal(namesSpecies('MrXMime', 'Mr. Mime'), false);
});
