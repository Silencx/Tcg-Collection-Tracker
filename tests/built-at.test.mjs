// tools/lib/built-at.mjs: an unchanged data file must come back byte-identical, so the
// weekly refresh has nothing to commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampBuiltAt } from '../tools/lib/built-at.mjs';

const prev = { schemaVersion: 1, builtAt: 'OLD', rows: [['cyber-judge', '001/101', 'Seedot', null, '1']] };

test('an unchanged file keeps its committed builtAt, a changed one gets the new one', () => {
  const same = { schemaVersion: 1, builtAt: 'NEW', rows: [['cyber-judge', '001/101', 'Seedot', null, '1']] };
  const changed = { schemaVersion: 1, builtAt: 'NEW', rows: [['cyber-judge', '002/101', 'Seedot', null, '2']] };
  // Byte-identical to the committed file, key order included: no diff to commit.
  assert.equal(JSON.stringify(stampBuiltAt(same, prev, 'NEW')), JSON.stringify(prev));
  assert.equal(stampBuiltAt(changed, prev, 'NEW').builtAt, 'NEW');
  assert.equal(stampBuiltAt(same, null, 'NEW').builtAt, 'NEW', 'a new file gets this run\'s stamp');
  assert.equal(stampBuiltAt(same, { ...prev, builtAt: null }, 'NEW').builtAt, 'NEW');
});

test('the same data with its keys in another order is not a change', () => {
  const committed = { builtAt: 'OLD', names: { en: { sv05: 'Temporal Forces', cel25: 'Celebrations' } } };
  const reordered = { names: { en: { cel25: 'Celebrations', sv05: 'Temporal Forces' } }, builtAt: 'NEW' };
  assert.equal(JSON.stringify(stampBuiltAt(reordered, committed, 'NEW')), JSON.stringify(committed));
});

test('array order still counts: the caller sorts lists that arrive in no fixed order', () => {
  const committed = { builtAt: 'OLD', cards: [{ id: 'a' }, { id: 'b' }] };
  assert.equal(stampBuiltAt({ builtAt: 'NEW', cards: [{ id: 'b' }, { id: 'a' }] }, committed, 'NEW').builtAt, 'NEW');
});
