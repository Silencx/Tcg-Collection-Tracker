import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCardSets, mergeSource } from '../js/api/merge.js';
import { slugify, uniqueSlug } from '../js/slug.js';

const card = (id, species, name = species) => ({ id, species, name });

// ── mergeCardSets ─────────────────────────────────────────────────────────────
test('a partial snapshot hit merged with a live fetch keeps every card, once', () => {
  const fromSnapshot = [card('bw4-2', 'Seedot'), card('bw4-3', 'Nuzleaf')];
  const fromLive = [card('sv5-1', 'Shiftry')];
  const out = mergeCardSets(['Seedot', 'Nuzleaf', 'Shiftry'], [fromSnapshot, fromLive]);
  assert.deepEqual(out.map(c => c.id), ['bw4-2', 'bw4-3', 'sv5-1']);
});

test('a cameo shared by two Pokémon resolves to the first-listed one', () => {
  // tcgdex.getCards documents this dedup as deliberately deterministic; merging must
  // not quietly change which Pokémon a shared card is attributed to.
  const seedotShard = [card('x-1', 'Seedot', 'Seedot & Nuzleaf-GX')];
  const nuzleafShard = [card('x-1', 'Nuzleaf', 'Seedot & Nuzleaf-GX')];
  const out = mergeCardSets(['Seedot', 'Nuzleaf'], [nuzleafShard, seedotShard]);
  assert.equal(out.length, 1);
  assert.equal(out[0].species, 'Seedot', 'first-listed name wins regardless of list order');

  const reversed = mergeCardSets(['Nuzleaf', 'Seedot'], [seedotShard, nuzleafShard]);
  assert.equal(reversed[0].species, 'Nuzleaf');
});

test('output follows the requested name order, not the order lists arrived in', () => {
  const live = [card('c-1', 'Shiftry')];
  const snap = [card('a-1', 'Seedot')];
  const out = mergeCardSets(['Seedot', 'Shiftry'], [live, snap]);
  assert.deepEqual(out.map(c => c.species), ['Seedot', 'Shiftry']);
});

test('cards for unrequested species are kept, not silently dropped', () => {
  // legacy.fetchEnCards serves the whole configured list rather than a subset.
  const out = mergeCardSets(['Seedot'], [[card('a-1', 'Seedot'), card('z-9', 'Lotad')]]);
  assert.deepEqual(out.map(c => c.id), ['a-1', 'z-9']);
});

test('cards with no id are skipped rather than throwing', () => {
  const out = mergeCardSets(['Seedot'], [[{ species: 'Seedot' }, card('a-1', 'Seedot')], null]);
  assert.deepEqual(out.map(c => c.id), ['a-1']);
});

test('falls back to `name` when `species` is absent (pre-species snapshots)', () => {
  const out = mergeCardSets(['Seedot'], [[{ id: 'a-1', name: 'Seedot' }]]);
  assert.deepEqual(out.map(c => c.id), ['a-1']);
});

// ── mergeSource ───────────────────────────────────────────────────────────────
test('the reported source is the WEAKEST provider that contributed', () => {
  // buildAll tests `source === 'legacy'` to raise the backup-source banner. A compound
  // value would suppress it silently.
  assert.equal(mergeSource(['snapshot', 'legacy']), 'legacy');
  assert.equal(mergeSource(['snapshot', 'tcgdex']), 'tcgdex');
  assert.equal(mergeSource(['snapshot']), 'snapshot');
  assert.equal(mergeSource(['tcgdex', 'legacy']), 'legacy');
  assert.equal(mergeSource(['legacy', 'snapshot']), 'legacy');
});

// ── slug ──────────────────────────────────────────────────────────────────────
test('slugify produces filename-safe stems', () => {
  assert.equal(slugify('Seedot'), 'seedot');
  assert.equal(slugify('Mr. Mime'), 'mr-mime');
  assert.equal(slugify('Farfetch’d'), 'farfetch-d');
  assert.equal(slugify('Type: Null'), 'type-null');
  assert.equal(slugify('ポケモン'), 'x', 'nothing survivable still yields a usable name');
  assert.equal(slugify('ポケモン', 'set'), 'set');
});

test('uniqueSlug resolves the Nidoran collision instead of overwriting a shard', () => {
  const taken = new Set();
  assert.equal(uniqueSlug('Nidoran♀', taken), 'nidoran');
  assert.equal(uniqueSlug('Nidoran♂', taken), 'nidoran-2');
  assert.equal(uniqueSlug('Nidoran', taken), 'nidoran-3');
});
