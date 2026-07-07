import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateCardId, migrateIdToken } from '../js/api/id-migration.js';

test('migrateCardId zero-pads an SV set id', () => {
  assert.equal(migrateCardId('sv5-163'), 'sv05-163');
});

test('migrateCardId zero-pads an SWSH local id', () => {
  assert.equal(migrateCardId('swsh11-13'), 'swsh11-013');
});

test('migrateCardId leaves an already-correct id unchanged', () => {
  assert.equal(migrateCardId('ex14-97'), 'ex14-97');
});

test('migrateIdToken leaves JP-sourced ids untouched', () => {
  const id = 'JP_jp_Shiftry_Miracle of the Desert_5';
  assert.equal(migrateIdToken(id), id);
});

test('migrateIdToken preserves the badge prefix while migrating the card id', () => {
  assert.equal(migrateIdToken('EN_sv5-163'), 'EN_sv05-163');
});

test('migrateIdToken leaves ids without a badge prefix unchanged', () => {
  assert.equal(migrateIdToken('sv5-163'), 'sv5-163');
});
