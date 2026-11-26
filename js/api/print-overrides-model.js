// =============================================================================
// api/print-overrides-model.js — prints no source lists, added by hand
// (data/print-overrides.json). The print counterpart of overrides-model.js: there a card
// is missing, here a print of a card TCGdex does list. Today that is the Jumbo cards
// TCGdex has no Jumbo print for (tools/jumbo-prints.mjs).
//
// A row is { lang, card, type, size?, stamp?, source, issue }:
//   lang    the language whose card it is: a LANGUAGES code ('en', 'de', …)
//   card    the card's TCGdex id ('xyp-XY17')
//   type    the print's type, as TCGdex's variants_detailed has it ('holo', 'normal', …)
//   size    'jumbo' for an oversized print
//   stamp   stamps on the print, as TCGdex spells them (['pre-release'])
//   source  the proof link
//   issue   the GitHub issue the row belongs to; one issue may hold a whole import
//
// A row's print joins its card's `variants` (api/variants.js shape) after the card's own
// prints, unless the card already has a print of that kind (any Jumbo print, for a Jumbo
// row). So once TCGdex lists a card's Jumbo print, the row steps aside on its own.
// Pure: no fetch, no DOM. js/api/print-overrides.js loads the file; the tools read it too.
// =============================================================================

import { LANGUAGES } from '../config.js';

/** Print types TCGdex uses (its VariantType). */
export const PRINT_TYPES = Object.freeze(['normal', 'holo', 'reverse', 'lenticular', 'metal']);
const SIZES = new Set(['jumbo']);
const LANGS = new Set(LANGUAGES.map(l => l.code));
// A TCGdex card id: set id, '-', local id ('swsh12.5-160', 'tk-ex-p-1'). The local id is
// what follows the last '-', as everywhere in the app.
export const CARD_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}-[A-Za-z0-9]{1,16}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * The valid rows of a print-overrides file, in file order. No file, a malformed file or
 * a malformed row reads as no override: the app never depends on this file.
 */
export function readPrintOverrides(json) {
  const list = Array.isArray(json?.prints) ? json.prints : [];
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    if (!LANGS.has(r.lang)) continue;
    if (typeof r.card !== 'string' || !CARD_RE.test(r.card)) continue;
    if (!PRINT_TYPES.includes(r.type)) continue;
    if (r.size !== undefined && !SIZES.has(r.size)) continue;
    if (r.stamp !== undefined && !(Array.isArray(r.stamp) && r.stamp.length && r.stamp.every(s => typeof s === 'string' && SLUG_RE.test(s)))) continue;
    if (!Number.isInteger(r.issue) || r.issue < 1) continue;
    const row = { lang: r.lang, card: r.card, type: r.type };
    if (r.size) row.size = r.size;
    if (r.stamp) row.stamp = [...r.stamp];
    row.source = typeof r.source === 'string' ? r.source : '';
    row.issue = r.issue;
    out.push(row);
  }
  return out;
}

/** A row's print, in api/variants.js's compact shape ({type, size?, stamp?}). */
export function rowPrint(r) {
  const p = { type: r.type };
  if (r.size) p.size = r.size;
  if (r.stamp?.length) p.stamp = [...r.stamp];
  return p;
}

/**
 * What makes a print special beyond its type: 'jumbo', 'pre-release', 'shadowless.1st-edition'.
 * '' for a plain print. Two prints of one kind are one print, whatever their type, so a
 * Jumbo row steps aside for ANY Jumbo print the card has.
 */
export function printKind(p) {
  return [p.subtype, p.foil, p.size, ...[...(p.stamp || [])].sort()].filter(Boolean).join('.');
}
const sameKind = (a, b) => {
  const k = printKind(b);
  return k ? printKind(a) === k : !printKind(a) && a.type === b.type;
};

// The plain prints the five flags stand for (as ui/prints-model.js printsOf reads them).
const FLAG_TYPES = ['normal', 'holo', 'reverse'];

/**
 * `variants` with `extra` prints added after the card's own, each unless the card has a
 * print of its kind already. The card's own list is written out first, flags included
 * (exactly what printsOf would show), so a Holo Jumbo print never hides the plain holo.
 * Returns `v` itself when nothing is added, and never changes it.
 */
export function addPrints(v, extra) {
  if (!v || typeof v !== 'object' || !extra?.length) return v;
  const own = Array.isArray(v.prints) ? v.prints.filter(p => p && typeof p.type === 'string') : [];
  for (const type of FLAG_TYPES) if (v[type] && !own.some(p => p.type === type)) own.push({ type });
  const add = [];
  for (const p of extra) if (![...own, ...add].some(h => sameKind(h, p))) add.push(p);
  return add.length ? { ...v, prints: [...own, ...add] } : v;
}

/**
 * The cards with the language's print overrides added to their `variants`. A card with
 * no variant data keeps none: a print list made of overrides alone would hide the
 * card's own prints. Changed cards are copies; the rest are the same objects.
 */
export function withPrintOverrides(cards, rows, lang = 'en') {
  const byCard = new Map();
  for (const r of rows || []) {
    if (r.lang === lang) byCard.set(r.card, [...(byCard.get(r.card) || []), rowPrint(r)]);
  }
  if (!byCard.size || !Array.isArray(cards)) return cards;
  let changed = false;
  const out = cards.map(c => {
    const extra = c && byCard.get(c.id);
    if (!extra || !c.variants) return c;
    const v = addPrints(c.variants, extra);
    if (v === c.variants) return c;
    changed = true;
    return { ...c, variants: v };
  });
  return changed ? out : cards;
}
