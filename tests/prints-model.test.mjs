// Per-print tracking (js/ui/prints-model.js). The card checklists keep meaning "I have at
// least one print"; prints live in their own set as `${cardId}#${printKey}`. What is pinned
// here: which prints a card has and what they are keyed as (a key change orphans a tick),
// the three rules that tie a print to its card, the progress arithmetic, and the import
// path that has to keep old ids and old checklists valid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  printsOf, printKey, printId, splitPrintId, tracksPrints, ticked,
  applyPrint, applyCard, clearPrintsOf, printTotals, printUnset, slotCount, expandMeta,
  migratePrintId, prunePrints,
} from '../js/ui/prints-model.js';
import { normalizeVariants } from '../js/api/variants.js';
import { PRINT_VIEWS, DEFAULT_PRINT_VIEW, isValidPrintView } from '../js/config.js';
import { encodeSessionPayload, decodeSession } from '../js/ui/session-codec.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keys = list => list.map(p => p.key);
const flags = (o = {}) => ({ normal: false, reverse: false, holo: false, firstEdition: false, wPromo: false, ...o });

// ── which prints, keyed how ───────────────────────────────────────────────────
test('a modern normal + reverse card has two prints, keyed by their bare type', () => {
  const list = printsOf(flags({ normal: true, reverse: true }));
  assert.deepEqual(keys(list), ['normal', 'reverse']);
  assert.deepEqual(list.map(p => p.short), ['N', 'RH']);
  assert.deepEqual(list.map(p => p.label), ['Normal', 'Reverse holo']);
  assert.ok(tracksPrints(list));
});

test('a single-print card is not tracked per print', () => {
  assert.equal(printsOf(flags({ holo: true })).length, 1);
  assert.equal(tracksPrints(printsOf(flags({ holo: true }))), false);
  assert.deepEqual(printsOf(null), []);
  assert.deepEqual(printsOf(undefined), []);
});

test('detailed WotC prints key on every distinguishing field, in a stable order', () => {
  const list = printsOf(flags({
    holo: true, firstEdition: true,
    prints: [
      { type: 'holo', subtype: 'unlimited' },
      { type: 'holo', subtype: 'shadowless', stamp: ['1st-edition'] },
      { type: 'holo', subtype: 'shadowless' },
      { type: 'holo', subtype: '1999-2000-copyright' },
    ],
  }));
  assert.deepEqual(keys(list), [
    'holo.unlimited', 'holo.shadowless.1st-edition', 'holo.shadowless', 'holo.1999-2000-copyright',
  ]);
  // One type on the card, so the chips name only what differs.
  assert.deepEqual(list.map(p => p.short), ['UNL', 'SL 1ED', 'SL', '©99-00']);
  assert.equal(list[1].label, 'Holo · Shadowless · 1st Edition stamp');
});

test('with mixed types the type is kept in the short label, so two foils cannot collide', () => {
  const list = printsOf(flags({
    normal: true, reverse: true,
    prints: [{ type: 'normal' }, { type: 'reverse' }, { type: 'reverse', foil: 'pokeball' }, { type: 'reverse', foil: 'masterball' }],
  }));
  assert.deepEqual(keys(list), ['normal', 'reverse', 'reverse.pokeball', 'reverse.masterball']);
  assert.deepEqual(list.map(p => p.short), ['N', 'RH', 'RH PB', 'RH MB']);
});

test('a plain print keys the same with or without the detailed list', () => {
  // A tick made today must survive TCGdex adding detail to the card later.
  const before = keys(printsOf(flags({ normal: true, reverse: true })));
  const after = keys(printsOf(flags({
    normal: true, reverse: true,
    prints: [{ type: 'normal' }, { type: 'reverse' }, { type: 'normal', stamp: ['pre-release'] }],
  })));
  for (const k of before) assert.ok(after.includes(k), `${k} lost when detail was added`);
});

test('a flag the detailed list does not cover is topped up — the inferred BW/XY/SM reverse', () => {
  const v = normalizeVariants({
    set: { id: 'xy1' }, localId: '3', rarity: 'Common', category: 'Pokemon', name: 'Seedot',
    variants: { normal: true, reverse: false, holo: false, firstEdition: false, wPromo: false },
    variants_detailed: [{ type: 'normal' }, { type: 'normal', stamp: ['pre-release'] }],
  });
  const list = printsOf(v);
  assert.deepEqual(keys(list), ['normal', 'reverse', 'normal.pre-release']);
  assert.equal(list.find(p => p.key === 'reverse').inferred, true);
  assert.equal(list.find(p => p.key === 'normal').inferred, false);
});

test('order is normal, holo, reverse, then the rest as TCGdex lists them', () => {
  const list = printsOf(flags({
    normal: true, holo: true, reverse: true,
    prints: [{ type: 'reverse' }, { type: 'normal', size: 'jumbo' }, { type: 'holo' }, { type: 'normal' }],
  }));
  assert.deepEqual(keys(list), ['normal', 'holo', 'reverse', 'normal.jumbo']);
});

test('firstEdition / wPromo flags with no detailed list key as their stamps', () => {
  assert.deepEqual(keys(printsOf(flags({ holo: true, firstEdition: true }))), ['holo', '1st-edition']);
  assert.deepEqual(keys(printsOf(flags({ normal: true, wPromo: true }))), ['normal', 'w-promo']);
});

test('duplicate prints collapse to one key', () => {
  const list = printsOf(flags({ normal: true, prints: [{ type: 'normal' }, { type: 'normal' }, { type: 'normal', stamp: ['set-logo'] }] }));
  assert.deepEqual(keys(list), ['normal', 'normal.set-logo']);
});

test('printKey is type + subtype + foil + size + stamps', () => {
  assert.equal(printKey({ type: 'holo' }), 'holo');
  assert.equal(printKey({ type: 'reverse', foil: 'cosmos', stamp: ['a', 'b'] }), 'reverse.cosmos.a.b');
  assert.equal(printKey({ type: 'normal', subtype: 'unlimited', size: 'jumbo' }), 'normal.unlimited.jumbo');
});

// ── ids ───────────────────────────────────────────────────────────────────────
test('print ids split back into card id and key; plain card ids have no key', () => {
  assert.equal(printId('EN_sv05-010', 'reverse'), 'EN_sv05-010#reverse');
  assert.deepEqual(splitPrintId('EN_sv05-010#reverse'), { cardId: 'EN_sv05-010', key: 'reverse' });
  assert.deepEqual(splitPrintId('EN_swshp-SWSH001#holo.1st-edition'), { cardId: 'EN_swshp-SWSH001', key: 'holo.1st-edition' });
  assert.deepEqual(splitPrintId('EN_sv05-010'), { cardId: 'EN_sv05-010', key: null });
});

// ── the three rules ───────────────────────────────────────────────────────────
const K = ['normal', 'reverse'];
const C = 'EN_sv05-010';

test('ticking a print ticks its card', () => {
  const cards = new Set(), prints = new Set();
  assert.equal(applyPrint(cards, prints, C, 'reverse', true, K), true);
  assert.ok(cards.has(C));
  assert.deepEqual([...prints], ['EN_sv05-010#reverse']);
});

test('unticking the last print unticks the card; unticking one of two does not', () => {
  const cards = new Set(), prints = new Set();
  applyPrint(cards, prints, C, 'normal', true, K);
  applyPrint(cards, prints, C, 'reverse', true, K);
  assert.equal(applyPrint(cards, prints, C, 'normal', false, K), true);
  assert.ok(cards.has(C));
  assert.equal(applyPrint(cards, prints, C, 'reverse', false, K), false);
  assert.equal(cards.has(C), false);
  assert.equal(prints.size, 0);
});

test('unticking a card clears its prints, and only its prints', () => {
  const cards = new Set([C, 'EN_sv05-011']);
  const prints = new Set([`${C}#normal`, `${C}#reverse`, 'EN_sv05-011#reverse', 'DE_sv05-010#reverse']);
  applyCard(cards, prints, C, false);
  assert.equal(cards.has(C), false);
  assert.deepEqual([...prints].sort(), ['DE_sv05-010#reverse', 'EN_sv05-011#reverse']);
});

test('ticking a card records no print — "owned, print not specified"', () => {
  const cards = new Set(), prints = new Set();
  applyCard(cards, prints, C, true);
  assert.ok(cards.has(C));
  assert.equal(prints.size, 0);
  assert.equal(printUnset(cards, prints, C, K), true);
  applyPrint(cards, prints, C, 'reverse', true, K);
  assert.equal(printUnset(cards, prints, C, K), false);
});

test('an old checklist id is untouched: a ticked card with no prints stays ticked', () => {
  const cards = new Set(['EN_sv05-163']), prints = new Set();
  assert.deepEqual(printTotals(cards, prints, 'EN_sv05-163', K), [2, 0]);
  assert.ok(cards.has('EN_sv05-163'));
});

test('clearPrintsOf takes a set of card ids or a predicate', () => {
  const prints = new Set(['EN_a-1#normal', 'EN_a-2#normal', 'EN_b-1#reverse']);
  clearPrintsOf(prints, new Set(['EN_a-1']));
  assert.deepEqual([...prints], ['EN_a-2#normal', 'EN_b-1#reverse']);
  clearPrintsOf(prints, id => id.startsWith('EN_b-'));
  assert.deepEqual([...prints], ['EN_a-2#normal']);
});

// ── progress ──────────────────────────────────────────────────────────────────
test('printTotals: tracked cards count their prints, others count as one', () => {
  const cards = new Set([C, 'EN_x-1']);
  const prints = new Set([`${C}#reverse`]);
  assert.deepEqual(printTotals(cards, prints, C, K), [2, 1]);
  assert.deepEqual(printTotals(cards, prints, 'EN_x-1', ['holo']), [1, 1]);
  assert.deepEqual(printTotals(cards, prints, 'EN_x-2', []), [1, 0]);
  assert.equal(ticked(prints, C, K), 1);
});

test('slotCount: one per ticked print, one per ticked card with none recorded', () => {
  const cards = new Set(['A', 'B', 'C']);
  const prints = new Set(['A#normal', 'A#reverse', 'B#holo', 'Z#normal']);   // Z is not ticked
  assert.equal(slotCount(cards, prints), 2 + 1 + 1);
  assert.equal(slotCount(new Set(), prints), 0);
});

test('expandMeta: one print-sheet entry per ticked print, else the card itself', () => {
  const list = printsOf(flags({ normal: true, reverse: true }));
  const meta = { name: 'Seedot', num: '#010' };
  assert.deepEqual(expandMeta(meta, C, list, new Set()), [meta]);
  const two = expandMeta(meta, C, list, new Set([`${C}#normal`, `${C}#reverse`]));
  assert.deepEqual(two.map(m => m.print.short), ['N', 'RH']);
  assert.equal(two[1].print.label, 'Reverse holo');
  assert.equal(two[0].num, '#010');
  assert.equal(meta.print, undefined, 'the input meta is not mutated');
  assert.deepEqual(expandMeta(meta, C, list.slice(0, 1), new Set([`${C}#normal`])), [meta]);
});

// ── import / load ─────────────────────────────────────────────────────────────
test('migratePrintId migrates the card part and keeps the print key', () => {
  assert.equal(migratePrintId('EN_sv5-163#reverse'), 'EN_sv05-163#reverse');
  assert.equal(migratePrintId('EN_sv05-163#holo.1st-edition'), 'EN_sv05-163#holo.1st-edition');
  assert.equal(migratePrintId('EN_sv5-163'), 'EN_sv05-163');
});

test('prunePrints drops prints whose card is not ticked, keyless ids and junk', () => {
  const cards = new Set(['EN_a-1']);
  assert.deepEqual(
    prunePrints(['EN_a-1#normal', 'EN_a-1#normal', 'EN_a-2#normal', 'EN_a-1', 7, null], cards),
    ['EN_a-1#normal']);
  assert.deepEqual(prunePrints(null, cards), []);
  assert.deepEqual(prunePrints({ not: 'an array' }, cards), []);
});

// ── the setting ───────────────────────────────────────────────────────────────
test('the print view is off by default and only the three views are accepted', () => {
  assert.deepEqual(PRINT_VIEWS, ['off', 'chips', 'tiles']);
  assert.equal(DEFAULT_PRINT_VIEW, 'off');
  for (const v of PRINT_VIEWS) assert.ok(isValidPrintView(v));
  for (const v of ['', 'Chips', 'grid', null, undefined, 1, '<img>']) assert.equal(isValidPrintView(v), false);
});

test('the print view rides the session hash and is whitelisted on the way in', () => {
  assert.equal(decodeSession(encodeSessionPayload({ v: 1, pv: 'tiles' })).pv, 'tiles');
  const io = readFileSync(resolve(ROOT, 'js/ui/io.js'), 'utf8');
  assert.match(io, /pv:\s*state\.printView/, 'encodeSession must write pv');
  assert.match(io, /isValidPrintView\(p\.pv\)/, 'applySession must whitelist pv');
});

test('every print store is exported (tcg* prefix) and pruned on import', () => {
  const config = readFileSync(resolve(ROOT, 'js/config.js'), 'utf8');
  for (const k of ['CHKPRINTSTORE', 'SETCHKPRINTSTORE', 'TMSPRINTSTORE', 'PRINTVIEWSTORE']) {
    const m = new RegExp(`export const ${k}\\s*=\\s*'([^']+)'`).exec(config);
    assert.ok(m, `${k} not declared`);
    assert.ok(m[1].startsWith('tcg'), `${k} must start with tcg or exportData skips it`);
  }
  const io = readFileSync(resolve(ROOT, 'js/ui/io.js'), 'utf8');
  for (const k of ['CHKPRINTSTORE', 'SETCHKPRINTSTORE', 'TMSPRINTSTORE']) {
    assert.ok(io.includes(`[${k},`), `${k} missing from io.js PRINT_STORES`);
  }
});
