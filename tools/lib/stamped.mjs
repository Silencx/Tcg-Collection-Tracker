// =============================================================================
// tools/lib/stamped.mjs — TCGplayer's stamped prints of a card (prerelease, staff, W,
// event and set-logo stamps), as print rows for data/print-overrides.json
// (tools/stamped-prints.mjs); and, for the TCGplayer check, which products are such
// prints, so they do not count as numbers of the set their group matched.
//
// TCGplayer files many stamped prints in a promo group under the ORIGINAL card's number:
// "Arcanine - 12/99 (Prerelease) [Staff]" in its Black and White Promos is a prerelease
// staff print of Next Destinies' Arcanine, which TCGdex lists as `bw4-12`. Such a product
// is traced back to its card the way a Jumbo card is (tools/lib/jumbo.mjs: number, set
// size, name), and its notes become TCGdex's stamp words. Every note must be one: a
// product with a note we cannot spell as a TCGdex stamp ("League Cup", "Cosmos Holo") is
// left out, never written with half its stamps. TCGdex already lists many of these prints;
// only the ones it lacks get a row. Pure: no fs, no fetch.
// =============================================================================

import { loose } from './tcgcsv.mjs';
import { JUMBO_GROUP, productFacts, traceOriginal, printingType, flagType } from './jumbo.mjs';
import { printKind } from '../../js/api/print-overrides-model.js';
import { naturalCompare } from '../../js/api/catalog-model.js';

/** TCGplayer's public price guide of a group: the proof link a row carries. */
export const PRICE_GUIDES = 'https://www.tcgplayer.com/categories/trading-and-collectible-card-games/pokemon/price-guides/';
export function priceGuide(groupName) {
  const slug = String(groupName || '').toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return PRICE_GUIDES + slug;
}

// A note in a TCGplayer product name → TCGdex's stamp word (variants_detailed `stamp`),
// checked against TCGdex's answers of 2026-11-27. The whole note must match.
const NOTES = [
  [/^prerelease$/i, 'pre-release'],
  [/^staff$/i, 'staff'],
  [/^w stamped$/i, 'wotc'],
  [/^city championships?$/i, 'city-championships'],
  [/^state championships?$/i, 'state-championships'],
  [/^regional championships?$/i, 'regional-championships'],
  [/^national championships?$/i, 'national-championships'],
  [/^origins game fair 2008$/i, 'origins-2008'],
  [/^toys r'? ?us promo$/i, 'toys-r-us'],
];
// Notes that are part of the card's name, not a stamp.
const NAME_NOTES = [/^delta species$/i];
// "XY Evolutions Prerelease": a set's name, maybe after its era's letters.
const ERA = /^(?:xy|sm|swsh|sv|bw|dp|hgss|me|ex)\s+/i;

/**
 * The stamp a note names, or null. `setNames`: loose() names of our sets, for
 * "Silver Tempest Stamped" (TCGdex's `set-logo`) and "XY Evolutions Prerelease".
 */
export function noteStamp(note, setNames = new Set()) {
  const n = String(note || '').trim();
  for (const [re, stamp] of NOTES) if (re.test(n)) return stamp;
  const isSet = s => setNames.has(loose(s)) || setNames.has(loose(s.replace(ERA, '')));
  let m = /^(.+?)\s+prerelease$/i.exec(n);
  if (m && isSet(m[1])) return 'pre-release';
  m = /^(.+?)\s+stamp(?:ed)?$/i.exec(n);
  if (m && isSet(m[1])) return 'set-logo';
  return null;
}

/**
 * A product name's stamps, in TCGdex's order (`staff` last): { stamps } when every note
 * is a stamp or part of the name and one at least is a stamp; { unknown: note } when a
 * stamp note sits next to one we cannot spell; null when no note is a stamp.
 */
export function stampsOf(name, setNames = new Set()) {
  const notes = [...String(name || '').matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)].map(m => (m[1] ?? m[2]).trim());
  const stamps = [];
  let unknown = null;
  for (const n of notes) {
    if (NAME_NOTES.some(re => re.test(n))) continue;
    const s = noteStamp(n, setNames);
    if (!s) { unknown ??= n; continue; }
    if (!stamps.includes(s)) stamps.push(s);
  }
  if (!stamps.length) return null;
  if (unknown) return { unknown };
  return { stamps: [...stamps.filter(s => s !== 'staff'), ...stamps.filter(s => s === 'staff')] };
}

/**
 * Whether a product is a stamped print of one card of ours.
 * @param {object} product  a TCGCSV product
 * @param {string} groupName  its TCGplayer group
 * @param {Map} index  jumbo.mjs catalogueIndex()
 * @param {object} opts.counts  data/sets.json `counts`
 * @param {Set<string>} opts.setNames  loose() names of our sets
 * @returns {null|{card:string, stamp:string[]}|{reason:string}} null: not a stamped
 *   print filed under an original number (no stamp note, or no "n/size" number)
 */
export function stampedPrintOf(product, groupName, index, { counts = {}, setNames = new Set() } = {}) {
  const f = productFacts(product);
  if (!/^[A-Za-z0-9]+\/\d+$/.test(f.number)) return null;
  const st = stampsOf(f.name, setNames);
  if (!st) return null;
  if (groupName === JUMBO_GROUP) return null;
  if (/alternate art/i.test(`${groupName} ${f.name}`)) return { reason: 'alternate art: a card of its own, not a print' };
  if (st.unknown) return { reason: `"${st.unknown}" is no TCGdex stamp we know` };
  if (st.stamps.length === 1 && st.stamps[0] === 'staff') return { reason: 'staff alone: the event it is for is not in the name' };
  // "Gigalith 53/98 (Prerelease)": the number again, with no dash before it.
  const t = traceOriginal({ number: f.number, name: f.name.replace(/\s+\d+\/\d+(?=\s*(?:[([]|$))/, '') }, index, { counts });
  if (!t.card) return { reason: t.reason };
  return { card: `${t.card.set}-${t.card.number}`, stamp: st.stamps };
}

/** A TCGdex print's kind, as print-overrides-model compares them. */
const tcgdexKind = v => printKind({
  subtype: v?.subtype || undefined, foil: v?.foil || undefined,
  size: v?.size && v.size !== 'standard' ? v.size : undefined, stamp: v?.stamp || undefined,
});

/**
 * Print rows for the stamped prints TCGdex lacks; the ones it lists (`covered`); and the
 * rest with a reason, for a person.
 * @param {{name:string, products:object[]}[]} groups  TCGplayer groups with their products
 * @param {Map} index  jumbo.mjs catalogueIndex()
 * @param {Map<number, string[]>} opts.printings  product id → TCGplayer printings
 * @param {Map<string, {flags:object, prints:object[]}>} opts.tcgdex  card id → TCGdex's
 *   flags and variants_detailed
 * @returns {{rows:object[], covered:string[], left:{group:string, number:string, name:string, reason:string}[]}}
 */
export function stampedPrintRows(groups, index, { counts = {}, setNames = new Set(), printings = new Map(), tcgdex = new Map(), issue } = {}) {
  const found = [];
  for (const g of groups || []) {
    for (const p of g.products || []) {
      const s = stampedPrintOf(p, g.name, index, { counts, setNames });
      if (s) found.push({ group: g.name, facts: productFacts(p), ...s });
    }
  }
  found.sort((a, b) => naturalCompare(a.facts.number, b.facts.number) || (a.facts.name < b.facts.name ? -1 : a.facts.name > b.facts.name ? 1 : 0));
  const rows = [], left = [], covered = new Set(), done = new Set();
  const leave = (x, reason) => left.push({ group: x.group, number: x.facts.number, name: x.facts.name, reason });
  for (const x of found) {
    if (!x.card) { leave(x, x.reason); continue; }
    const td = tcgdex.get(x.card);
    if (!td) { leave(x, `TCGdex did not answer for ${x.card}`); continue; }
    const kind = printKind({ stamp: x.stamp });
    const key = `${x.card}|${kind}`;
    if ((td.prints || []).some(v => tcgdexKind(v) === kind)) { covered.add(key); continue; }
    if (done.has(key)) continue;   // a second product of one print (another printing)
    done.add(key);
    const type = printingType(printings.get(x.facts.id)) || flagType(td.flags) || 'normal';
    rows.push({ lang: 'en', card: x.card, type, stamp: x.stamp, source: priceGuide(x.group), issue });
  }
  return { rows, covered: [...covered].sort(), left };
}
