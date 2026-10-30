// Japanese card identity (js/api/jp-model.js): the new stable ids, eras, and the
// migration of both old id formats. The old ids below are real ones from the Seedot-line
// build (Master Set's index-based ids and TMS's code-based ids, 2026-10-30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  jpNumKey, jpCardId, jpImageKeyFor, isStableJpId, assignJpKeys, jpEra,
  parseOldMasterId, parseOldTmsId, isOldJpId, replayOldMasterOrder, migrateJpId,
} from '../js/api/jp-model.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seedotRows = JSON.parse(readFileSync(resolve(ROOT, 'data/jp/seedot.json'), 'utf8')).jpCardsData;

// ── keys ──────────────────────────────────────────────────────────────────────
test('ids are set slug + card number, lower case, matching the image key', () => {
  assert.equal(jpCardId('miracle-of-the-desert', jpNumKey('001/053')), 'JP_miracle-of-the-desert_1');
  assert.equal(jpNumKey('TG01/TG30'), 'tg01');
  assert.equal(jpImageKeyFor('miracle-of-the-desert', '1'), 'jp/miracle-of-the-desert/1');
  assert.ok(isStableJpId('JP_miracle-of-the-desert_1'));
  assert.ok(!isStableJpId('JP_SV5M_003'));
  assert.ok(!isStableJpId('JP_jp_Seedot_Miracle of the Desert_0'));
});

test('a card with no printed number is keyed on its name', () => {
  assert.equal(jpNumKey('', 'Pikachu'), 'n-pikachu');
  assert.equal(jpNumKey(null, "Farfetch'd"), 'n-farfetch-d');
  assert.equal(jpNumKey('null', 'Mr. Mime'), 'n-mr-mime');
});

test('shared set names get their code; repeats and prints never collide', () => {
  const sets = [
    { name: 'Battle Academy', code: 'svI', id: '1' },
    { name: 'Battle Academy', code: 'svIba', id: '2' },
    { name: 'Unnumbered Promotional cards', code: 'P', id: '3' },
  ];
  const cards = [
    [0, '001/074', 'Pikachu', null], [1, '001/098', 'Pikachu', null],
    [2, '', 'Pikachu', null], [2, '', 'Pikachu', null], [2, '', 'Pikachu', 'Mirror Holofoil'],
  ];
  const { setKeys, numKeys } = assignJpKeys(sets, cards);
  assert.deepEqual(setKeys, ['battle-academy-svi', 'battle-academy-sviba', 'unnumbered-promotional-cards']);
  assert.deepEqual(numKeys, ['1', '1', 'n-pikachu', 'n-pikachu-2', 'n-pikachu--mirror-holofoil']);
  for (let i = 0; i < cards.length; i++) assert.ok(isStableJpId(jpCardId(setKeys[cards[i][0]], numKeys[i])));
});

// ── eras ──────────────────────────────────────────────────────────────────────
test('eras come from the Japanese release date first', () => {
  assert.equal(jpEra('ADV2', '2004-01-16'), 'ex');
  assert.equal(jpEra('BW3', '2011-09-16'), 'bw');
  assert.equal(jpEra('SV5M', '2024-01-26'), 'sv');
  assert.equal(jpEra('m1L', '2025-08-01'), 'me');
  assert.equal(jpEra(null, '1997-03-05'), 'base');
});

test('an undated set falls back to its code, and to null when that says nothing', () => {
  assert.equal(jpEra('DP-P', null), 'dp');
  assert.equal(jpEra('Pt3', null), 'pl');
  assert.equal(jpEra('SM4+', null), 'sm');
  assert.equal(jpEra('S-P/CS', null), 'swsh');
  assert.equal(jpEra('svIba', null), 'sv');
  assert.equal(jpEra('23730', null), null);
});

// ── migration ─────────────────────────────────────────────────────────────────
test('both old formats are recognised; new ids are not', () => {
  assert.deepEqual(parseOldMasterId('JP_jp_Seedot_Miracle of the Desert_0'),
    { pokemonName: 'Seedot', jpset: 'Miracle of the Desert', index: 0 });
  assert.deepEqual(parseOldTmsId('JP_SV5M_003'), { setRef: 'SV5M', localId: '003' });
  assert.deepEqual(parseOldTmsId('JP_Miracle of the Desert_001'), { setRef: 'Miracle of the Desert', localId: '001' });
  assert.ok(!isOldJpId('JP_miracle-of-the-desert_1'));
  assert.ok(!isOldJpId('EN_sv05-163'));
});

test('a Master Set tick moves to the card its index pointed at', () => {
  const replay = replayOldMasterOrder(seedotRows);
  // Seedot's rows in snapshot order: 0 Miracle of the Desert 001/053, 1 Latios ex Half Deck 001/018, …
  assert.equal(migrateJpId('JP_jp_Seedot_Miracle of the Desert_0', { replay }), 'JP_miracle-of-the-desert_1');
  assert.equal(migrateJpId('JP_jp_Seedot_Latios ex Half Deck_1', { replay }), 'JP_latios-ex-half-deck_1');
  const sky = replay.findIndex(r => r.jpset === 'Sky-Splitting Charisma' && r.jpnum === '006/096');
  assert.equal(migrateJpId(`JP_jp_Seedot_Sky-Splitting Charisma_${sky}`, { replay }), 'JP_sky-splitting-charisma_6');
});

test('a Master Set index that no longer points at the same Pokémon and set is not trusted', () => {
  const replay = replayOldMasterOrder(seedotRows);
  // Index 0 is Seedot in Miracle of the Desert; an id claiming Nuzleaf at 0 came from a
  // different Pokémon-list order — resolved only when that Pokémon has one card there.
  const one = () => ['002/053'];
  assert.equal(migrateJpId('JP_jp_Nuzleaf_Miracle of the Desert_0', { replay, candidates: one }), 'JP_miracle-of-the-desert_2');
  const two = () => ['005/096', '006/096'];
  assert.equal(migrateJpId('JP_jp_Seedot_Sky-Splitting Charisma_0', { replay, candidates: two }), null);
});

test('a TMS tick maps through its Limitless code or its set name', () => {
  assert.equal(migrateJpId('JP_SV5M_003'), 'JP_cyber-judge_3');
  assert.equal(migrateJpId('JP_M1L_007'), 'JP_mega-brave_7');
  assert.equal(migrateJpId('JP_Miracle of the Desert_001'), 'JP_miracle-of-the-desert_1');
  assert.equal(migrateJpId('JP_SMP_229'), 'JP_sm-p-promotional-cards_229');
});

test('Master Set and TMS ticks of the same card land on the same new id', () => {
  const replay = replayOldMasterOrder(seedotRows);
  const i = replay.findIndex(r => r.jpset === 'Cyber Judge');
  assert.equal(migrateJpId(`JP_jp_Seedot_Cyber Judge_${i}`, { replay }), migrateJpId('JP_SV5M_003'));
});

// Per-print tracking (js/ui/prints-model.js) stores `${cardId}#${printKey}`. Such an id
// must never be read as an old JP card id and "migrated" into something else.
test('a print id is never an old JP id', async () => {
  const { PRINT_SEP, printId } = await import('../js/ui/prints-model.js');
  assert.equal(PRINT_SEP, '#', 'jp-model.js hard-codes the separator; keep the two in step');
  for (const id of [
    printId('JP_miracle-of-the-desert_1', 'reverse'),
    printId('JP_SV5M_003', 'reverse'),
    printId('JP_jp_Seedot_Miracle of the Desert_0', 'holo'),
    'JP_x_1#reverse',
  ]) {
    assert.equal(parseOldTmsId(id), null, id);
    assert.equal(parseOldMasterId(id), null, id);
    assert.equal(isOldJpId(id), false, id);
    assert.equal(migrateJpId(id), null, id);
  }
});
