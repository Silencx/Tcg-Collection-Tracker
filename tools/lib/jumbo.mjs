// =============================================================================
// tools/lib/jumbo.mjs — TCGplayer's Jumbo cards, as Jumbo prints of the cards they
// enlarge (rows for data/print-overrides.json; tools/jumbo-prints.mjs).
//
// TCGdex files a Jumbo card as a print of the normal card (variants_detailed size
// "jumbo"), and has one for about 210 cards. TCGplayer lists each Jumbo card under the
// number of the card it enlarges ("XY17", "074/111"). It is traced back to that card in
// our English catalogue: same number, a set of that size when the number gives one, same
// name. A card TCGdex already gives a Jumbo print needs nothing; the others get a row.
// The print's type is TCGplayer's printing (Holofoil → holo), else the card's own.
// Whatever does not trace to exactly one card is left out and listed, for a person.
// Pure: no fs, no fetch.
// =============================================================================

import { numberKey } from '../../js/api/overrides-model.js';
import { naturalCompare } from '../../js/api/catalog-model.js';

/** TCGdex's Jumbo set: listed with no card, never a card's original. */
export const JUMBO_SET = 'jumbo';
/** TCGplayer's name for the group (tcgcsv.com/tcgplayer/3/groups). */
export const JUMBO_GROUP = 'Jumbo Cards';

const NUMBER_SHAPE = /^[A-Za-z0-9]+(?:\/[A-Za-z0-9]+)?$/;

/** A TCGplayer product's id, card number (extendedData "Number") and name. */
export function productFacts(product) {
  const ext = {};
  for (const d of product?.extendedData || []) ext[d?.name] = d?.value;
  return { id: product?.productId ?? null, number: String(ext.Number ?? '').trim(), name: String(product?.name ?? '').trim() };
}

/**
 * The card name in a TCGplayer product name: "Charizard EX - XY17 (XY Black Star Promos)"
 * → "Charizard EX". Drops (…) and […] notes, " - number" tails and the word "Oversized".
 */
export function bareName(name) {
  return String(name ?? '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s+-\s*\S.*$/, '')
    .replace(/\b(?:oversized|jumbo)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** A name for comparing: no accents, case, spaces or punctuation ("Charizard-EX" = "Charizard EX"). */
export function looseName(s) {
  return String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * numberKey → the English catalogue's cards with that number, one per set and number,
 * as { set, number, name }. Rows are data/cat/en/'s [set, number, name, …]. The Jumbo
 * set and TCG Pocket (not printed cards) are left out.
 */
export function catalogueIndex(rows, { setSeries = {} } = {}) {
  const index = new Map(), seen = new Set();
  for (const r of rows || []) {
    if (!Array.isArray(r) || typeof r[0] !== 'string' || r[1] == null || typeof r[2] !== 'string') continue;
    const [set, number, name] = r;
    if (set === JUMBO_SET || setSeries[set] === 'tcgp') continue;
    const id = `${set}-${number}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const key = numberKey('en', number);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ set, number: String(number), name });
  }
  return index;
}

/**
 * The one card of ours a Jumbo card enlarges, or why there is none.
 * @param {{number:string, name:string}} facts  productFacts()
 * @param {Map} index  catalogueIndex()
 * @param {object} [opts.counts]  data/sets.json `counts`: set → { official }
 * @returns {{card:object}|{reason:string}}
 */
export function traceOriginal({ number, name }, index, { counts = {} } = {}) {
  if (!number) return { reason: 'no number' };
  if (!NUMBER_SHAPE.test(number)) return { reason: 'not one card number' };
  const [n, size] = number.split('/');
  let cards = index.get(numberKey('en', n)) || [];
  if (size && /^\d+$/.test(size)) cards = cards.filter(c => counts[c.set]?.official === Number(size));
  const want = looseName(bareName(name));
  const named = want ? cards.filter(c => looseName(c.name) === want) : [];
  if (named.length === 1) return { card: named[0] };
  return { reason: named.length ? `${named.length} cards of ours match` : 'no card of ours with this number and name' };
}

// TCGplayer printings (TCGCSV prices, subTypeName) and TCGdex flags, most special first:
// a Jumbo card printed holo is a holo Jumbo print.
const PRINTINGS = [['Holofoil', 'holo'], ['Normal', 'normal'], ['Reverse Holofoil', 'reverse']];

/** The print type TCGplayer's printings name, or null. */
export function printingType(subTypes) {
  const have = new Set(subTypes || []);
  return PRINTINGS.find(([name]) => have.has(name))?.[1] ?? null;
}

/** The print type a card's TCGdex flags name, or null. */
export function flagType(flags) {
  return ['holo', 'normal', 'reverse'].find(t => flags?.[t]) ?? null;
}

/**
 * Print rows for the Jumbo cards TCGdex has no Jumbo print for; the cards it has one
 * for (`covered`); and the rest with a reason.
 * @param {Map<number, string[]>} opts.printings  TCGplayer product id → printings
 * @param {Map<string, {flags:object, jumbo:boolean}>} opts.tcgdex  card id → TCGdex's prints
 * @returns {{rows:object[], covered:string[], left:{number:string, name:string, reason:string}[]}}
 */
export function jumboPrintRows(products, index, { counts = {}, printings = new Map(), tcgdex = new Map(), source, issue } = {}) {
  const facts = (products || []).map(productFacts)
    .sort((a, b) => naturalCompare(a.number, b.number) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const rows = [], left = [], covered = new Set(), used = new Set();
  for (const f of facts) {
    const t = traceOriginal(f, index, { counts });
    if (!t.card) { left.push({ number: f.number, name: f.name, reason: t.reason }); continue; }
    const card = `${t.card.set}-${t.card.number}`;
    const td = tcgdex.get(card);
    if (!td) { left.push({ number: f.number, name: f.name, reason: `TCGdex did not answer for ${card}` }); continue; }
    if (td.jumbo) { covered.add(card); continue; }
    if (used.has(card)) { left.push({ number: f.number, name: f.name, reason: `a second Jumbo card of ${card}` }); continue; }
    used.add(card);
    const type = printingType(printings.get(f.id)) || flagType(td.flags) || 'holo';
    rows.push({ lang: 'en', card, type, size: 'jumbo', source, issue });
  }
  return { rows, covered: [...covered], left };
}
