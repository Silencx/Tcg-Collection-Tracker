// Print variants: TCGdex variant data → the `variants` object the app stores and the
// footer badges it renders. Offline — every card below is a trimmed copy of what TCGdex
// returned on 2026-10-22 (REST /cards/{id} and GraphQL give the same fields).
//
// The BW/XY/SM reverse-holo rule was scored against TCGplayer's printing list (via
// pokemontcg.io) for every card in those eras: 6,245 cards, 6,240 right (99.92%). The
// five misses are bw6-53 (inferred, TCGplayer lists none), bw1-110 (a lone basic Energy
// reverse) and three Black Star promos with reverses (bwp-BW41/42/52, promos are out of
// scope). The cases below pin each branch of the rule to a real card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeVariants, inferReverse, compactPrint, variantBadges, printLabel, printsSummary,
  REVERSE_GAP,
} from '../js/api/variants.js';

const flags = (o = {}) => ({ normal: false, reverse: false, holo: false, firstEdition: false, wPromo: false, ...o });
const card = (id, extra = {}) => {
  const setId = id.slice(0, id.lastIndexOf('-'));
  return { id, localId: id.slice(setId.length + 1), set: { id: setId }, category: 'Pokemon', ...extra };
};

// ── normalizeVariants ─────────────────────────────────────────────────────────
test('no flags means no variant data, not "normal only"', () => {
  assert.equal(normalizeVariants({ id: 'x-1' }), null);
  assert.equal(normalizeVariants(null), null);
});

test('a plain modern card keeps the five flags and no prints array', () => {
  const v = normalizeVariants(card('sv05-010', {
    rarity: 'Common',
    variants: flags({ normal: true, reverse: true }),
    variants_detailed: [{ type: 'normal', size: 'standard' }, { type: 'reverse', size: 'standard' }],
  }));
  assert.deepEqual(v, flags({ normal: true, reverse: true }));
});

test('Base Set Charizard keeps shadowless, 1st Edition and the copyright print', () => {
  const v = normalizeVariants(card('base1-4', {
    rarity: 'Rare',
    variants: flags({ holo: true, firstEdition: true }),
    variants_detailed: [
      { type: 'holo', subtype: 'unlimited', size: 'standard', variantId: 'x', pricing: {}, thirdParty: {} },
      { type: 'holo', subtype: 'shadowless', size: 'standard', stamp: ['1st-edition'] },
      { type: 'holo', subtype: 'shadowless', size: 'standard' },
      { type: 'holo', subtype: '1999-2000-copyright', size: 'standard' },
    ],
  }));
  assert.deepEqual(v.prints, [
    { type: 'holo', subtype: 'unlimited' },
    { type: 'holo', subtype: 'shadowless', stamp: ['1st-edition'] },
    { type: 'holo', subtype: 'shadowless' },
    { type: 'holo', subtype: '1999-2000-copyright' },
  ]);
  assert.equal(v.inferred, undefined);
});

test('compactPrint drops prices, ids, the default size and empty stamp lists', () => {
  assert.deepEqual(
    compactPrint({ type: 'reverse', foil: 'pokeball', size: 'standard', stamp: [], variantId: 'v', pricing: { a: 1 } }),
    { type: 'reverse', foil: 'pokeball' },
  );
  assert.deepEqual(compactPrint({ type: 'normal', size: 'jumbo' }), { type: 'normal', size: 'jumbo' });
  assert.equal(compactPrint({ size: 'standard' }), null);
});

// ── the EX-era stamped reverse ────────────────────────────────────────────────
test('ex11–ex16 "normal + set-logo stamp" is the set\'s reverse holo', () => {
  const v = normalizeVariants(card('ex12-61', {
    rarity: 'Common',
    variants: flags({ normal: true }),
    variants_detailed: [{ type: 'normal', size: 'standard' }, { type: 'normal', size: 'standard', stamp: ['set-logo'] }],
  }));
  assert.deepEqual(v, flags({ normal: true, reverse: true }));
  assert.deepEqual(variantBadges(v).map(b => b.text), ['RH']);
});

test('on an ex11–ex16 holo rare the stamped reverse is typed holo', () => {
  const v = normalizeVariants(card('ex12-12', {
    rarity: 'Rare',
    variants: flags({ holo: true }),
    variants_detailed: [{ type: 'holo' }, { type: 'holo', stamp: ['set-logo'] }],
  }));
  assert.deepEqual(v, flags({ holo: true, reverse: true }));
  assert.deepEqual(variantBadges(v).map(b => b.text), ['H', 'RH']);
});

test('ex7–ex10 already type it reverse; the stamp is not counted as an extra print', () => {
  const v = normalizeVariants(card('ex8-71', {
    rarity: 'Common',
    variants: flags({ normal: true, reverse: true }),
    variants_detailed: [{ type: 'normal' }, { type: 'reverse', stamp: ['set-logo'] }],
  }));
  assert.deepEqual(v, flags({ normal: true, reverse: true }));
});

test('a set-logo stamp outside the EX era stays a special print', () => {
  const v = normalizeVariants(card('sv03.5-001', {
    rarity: 'Common',
    variants: flags({ normal: true, reverse: true }),
    variants_detailed: [{ type: 'normal' }, { type: 'reverse' }, { type: 'normal', stamp: ['set-logo'] }],
  }));
  assert.deepEqual(variantBadges(v).map(b => b.text), ['RH', '+1']);
});

// ── the BW/XY/SM reverse-holo rule ────────────────────────────────────────────
test('a BW common TCGdex lists as normal-only gets an INFERRED reverse', () => {
  const v = normalizeVariants(card('bw1-1', { rarity: 'Common', variants: flags({ normal: true }) }));
  assert.equal(v.reverse, true);
  assert.deepEqual(v.inferred, ['reverse']);
});

test('the rule is never consulted when TCGdex already lists a reverse', () => {
  const v = normalizeVariants(card('bw3-1', { rarity: 'Common', variants: flags({ normal: true, reverse: true }) }));
  assert.equal(v.reverse, true);
  assert.equal(v.inferred, undefined);
});

test('the rule stays inside the listed sets', () => {
  // DP had real reverse data all along; Dragon Vault and the promos never had reverses.
  for (const id of ['dp1-100', 'dv1-1', 'bwp-BW52', 'xyp-XY01', 'smp-SM60', 'det1-1', 'sma-SV1']) {
    assert.equal(inferReverse(card(id, { rarity: 'Common' })), false, id);
  }
  assert.ok(REVERSE_GAP.has('sm115') && REVERSE_GAP.has('g1') && !REVERSE_GAP.has('sma'));
});

test('chase tiers get no reverse: EX / GX suffix, Prism Star, Ultra and Secret rares', () => {
  assert.equal(inferReverse(card('bw4-54', { rarity: 'Rare', name: 'Mewtwo-EX', suffix: 'EX' })), false);
  assert.equal(inferReverse(card('sm2-92', { rarity: 'Rare', name: 'Sylveon GX', suffix: 'GX' })), false);
  assert.equal(inferReverse(card('sm5-89', { rarity: 'Rare', name: 'Solgaleo ◇' })), false);
  assert.equal(inferReverse(card('xy1-1', { rarity: 'Ultra Rare' })), false);
  assert.equal(inferReverse(card('sm12-250', { rarity: 'Secret Rare' })), false);
});

test('Radiant Collection and lettered alternates are not part of the reverse run', () => {
  assert.equal(inferReverse(card('g1-RC1', { rarity: 'Common' })), false);
  assert.equal(inferReverse(card('bw11-RC12', { rarity: 'Uncommon' })), false);
  assert.equal(inferReverse(card('xy2-88a', { rarity: 'Uncommon', category: 'Trainer' })), false);
  assert.equal(inferReverse(card('g1-26', { rarity: 'Common' })), true);
});

test('ACE SPEC / Hyper Gear get none; Sun & Moon rare Items do', () => {
  const trainer = (id, trainerType) => card(id, { rarity: 'Rare', category: 'Trainer', trainerType });
  assert.equal(inferReverse(trainer('bw7-137', 'Item')), false);   // Computer Search
  assert.equal(inferReverse(trainer('bw9-107', 'Tool')), false);   // Life Dew
  assert.equal(inferReverse(trainer('xy4-97', 'Tool')), false);    // Head Ringer (Hyper Gear)
  assert.equal(inferReverse(trainer('sm2-124', 'Item')), true);    // Enhanced Hammer
  assert.equal(inferReverse(trainer('bw9-101', 'Supporter')), true); // Ghetsis
});

test('special Energy gets a reverse; basic Energy only in Generations and Evolutions', () => {
  const energy = (id, rarity) => card(id, { rarity, category: 'Energy' });
  assert.equal(inferReverse(energy('xy1-130', 'Uncommon')), true);  // Double Colorless
  assert.equal(inferReverse(energy('bw1-105', 'Common')), false);   // basic Grass
  assert.equal(inferReverse(energy('xy12-91', 'Common')), true);    // Evolutions basic Grass
  assert.equal(inferReverse(energy('g1-75', 'Common')), true);      // Generations basic Grass
});

test('the rule reads localId from the id when a card omits it', () => {
  assert.equal(inferReverse({ id: 'sm3.5-1', set: { id: 'sm3.5' }, rarity: 'Common', category: 'Pokemon' }), true);
  assert.equal(inferReverse({ id: 'g1-RC1', set: { id: 'g1' }, rarity: 'Common', category: 'Pokemon' }), false);
});

// ── badges ────────────────────────────────────────────────────────────────────
const texts = v => variantBadges(v).map(b => b.text);

test('normal-only and missing data render no badge', () => {
  assert.deepEqual(variantBadges(null), []);
  assert.deepEqual(variantBadges(flags({ normal: true })), []);
});

test('flags map to the familiar short badges, in a stable order', () => {
  assert.deepEqual(texts(flags({ holo: true, reverse: true, firstEdition: true, wPromo: true })), ['H', 'RH', '1ED', 'P']);
});

test('an inferred reverse is flagged so the UI can draw it differently', () => {
  const [rh] = variantBadges({ ...flags({ normal: true, reverse: true }), inferred: ['reverse'] });
  assert.equal(rh.text, 'RH');
  assert.equal(rh.inferred, true);
  assert.match(rh.title, /likely/);
});

test('shadowless gets its own badge; everything unusual folds into +N', () => {
  const v = {
    ...flags({ normal: true, firstEdition: true }),
    prints: [
      { type: 'normal', subtype: 'unlimited' },
      { type: 'normal', subtype: 'shadowless', stamp: ['1st-edition'] },
      { type: 'normal', subtype: 'shadowless' },
      { type: 'normal', subtype: 'shadowless-red-cheek' },
      { type: 'normal', subtype: '1999-2000-copyright' },
      { type: 'normal', size: 'jumbo' },
      { type: 'normal', subtype: 'unlimited', stamp: ['poketour-99'] },
    ],
  };
  assert.deepEqual(texts(v), ['1ED', 'SL', '+3']);
  const extra = variantBadges(v).at(-1);
  assert.equal(extra.title, 'Other prints:\nNormal · 1999-2000 copyright\nNormal · Jumbo\nNormal · Unlimited · Poketour 99 stamp');
});

test('foil patterns are extras, not reverse-holo duplicates', () => {
  const v = { ...flags({ normal: true, reverse: true }), prints: [
    { type: 'normal' }, { type: 'reverse' }, { type: 'reverse', foil: 'pokeball' }, { type: 'reverse', foil: 'masterball' },
  ] };
  assert.deepEqual(texts(v), ['RH', '+2']);
});

test('print labels read as words', () => {
  assert.equal(printLabel({ type: 'holo', subtype: 'shadowless', stamp: ['1st-edition'] }), 'Holo · Shadowless · 1st Edition stamp');
  assert.equal(printLabel({ type: 'reverse', foil: 'cosmos' }), 'Reverse holo · Cosmos pattern');
  assert.equal(printLabel({ type: 'holo', stamp: ['jason-klaczynski'] }), 'Holo · Jason klaczynski stamp');
  assert.equal(printsSummary(flags()), '');
});
