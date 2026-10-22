// =============================================================================
// ui/prints-model.js — per-print tracking, DOM-free.
//
// Same split as filter-pass.js / setmode-model.js / dashboard-model.js: the rules live
// here so `node --test` can cover them without a DOM or localStorage.
//
// THE MODEL. The three card checklists (state.checked / ssChecked / tmsIncluded) are
// untouched and keep meaning "I have at least one print of this card" — so the
// dashboard, set progress, parseCardId and every saved checklist stay valid. Prints
// live in a SEPARATE set per checklist, as `${cardId}#${printKey}` ('EN_sv05-010#reverse'),
// and three rules tie the two together (applyPrint / applyCard below):
//   · ticking a print ticks its card
//   · unticking a card's last print unticks the card
//   · unticking a card clears its prints
// A card that is ticked with no print recorded is "owned, print not specified" — every
// checklist saved before this feature is in that state, and it stays valid.
//
// Only cards with TWO OR MORE prints are tracked per print. A card with one print, or
// with no variant data at all (KR/SC placeholders, JP, the legacy path), is one unit as
// before: its card tick IS its print.
// =============================================================================

import { printLabel } from '../api/variants.js';
import { migrateIdToken } from '../api/id-migration.js';

/** Separates a card id from a print key. Never appears in a TCGdex or JP card id. */
export const PRINT_SEP = '#';

export const printId = (cardId, key) => `${cardId}${PRINT_SEP}${key}`;

/** 'EN_sv05-010#reverse' → {cardId:'EN_sv05-010', key:'reverse'}; no '#' → key null. */
export function splitPrintId(id) {
  const s = String(id);
  const i = s.indexOf(PRINT_SEP);
  return i < 0 ? { cardId: s, key: null } : { cardId: s.slice(0, i), key: s.slice(i + 1) };
}

/**
 * The stable key for one compact print (variants.compactPrint shape).
 * 'holo' · 'holo.shadowless.1st-edition' · 'reverse.pokeball' · 'normal.jumbo'.
 * A plain print keys as its bare type, which is also what the flag fallback produces —
 * so a tick survives TCGdex later adding detail to a card.
 */
export function printKey(p) {
  return [p.type, p.subtype, p.foil, p.size, ...(p.stamp || [])].filter(Boolean).join('.');
}

// Short chip / tile text. The full printLabel always rides along as title/aria-label.
const TYPE_SHORT = { normal: 'N', holo: 'H', reverse: 'RH', lenticular: 'LEN', metal: 'MTL' };
const MOD_SHORT = {
  unlimited: 'UNL', shadowless: 'SL', 'shadowless-red-cheek': 'SL red',
  '1999-2000-copyright': '©99-00', '1999-copyright': '©99',
  '1st-edition': '1ED', 'pre-release': 'PRE', 'set-logo': 'LOGO', 'w-promo': 'W',
  pokeball: 'PB', masterball: 'MB', duskball: 'DB', loveball: 'LB', friendball: 'FB',
  quickball: 'QB', 'cracked-ice': 'CI', 'team-rocket': 'TR', 'pokemon-center': 'PC',
  jumbo: 'J',
};
const modShort = m => MOD_SHORT[m] || '★';

function shortFor(p, withType) {
  const mods = [p.subtype, p.foil, p.size, ...(p.stamp || [])].filter(Boolean).map(modShort);
  const type = TYPE_SHORT[p.type] || p.type.slice(0, 3).toUpperCase();
  if (!mods.length) return type;
  return (withType ? [type, ...mods] : mods).join(' ');
}

// Plain prints the five flags stand for, and the two flags that are stamps rather than
// types. Used when a card carries no `prints` list, and to top up one that is missing a
// type the flags promise (an inferred BW/XY/SM reverse is only ever a flag).
const FLAG_PRINTS = [
  ['normal', { type: 'normal' }],
  ['holo', { type: 'holo' }],
  ['reverse', { type: 'reverse' }],
];
const TYPE_RANK = { normal: 0, holo: 1, reverse: 2 };

/**
 * A card's `variants` (api/variants.js shape) → its prints, in display order:
 * [{key, short, label, inferred}]. Fewer than two entries means "not tracked per print".
 */
export function printsOf(v) {
  if (!v || typeof v !== 'object') return [];
  const raw = Array.isArray(v.prints) ? v.prints.filter(p => p && typeof p.type === 'string') : [];
  const list = [...raw];
  for (const [flag, p] of FLAG_PRINTS) {
    if (v[flag] && !list.some(x => x.type === p.type)) list.push(p);
  }
  // firstEdition / wPromo with no print saying so: only possible when TCGdex sent the
  // flags without a detailed list. They are stamps, so they key on their own.
  const stamped = s => list.some(x => (x.stamp || []).includes(s));
  const extra = [];
  if (v.firstEdition && !stamped('1st-edition')) extra.push({ key: '1st-edition', short: '1ED', label: '1st Edition' });
  if (v.wPromo && !stamped('w-promo')) extra.push({ key: 'w-promo', short: 'W', label: 'W promo' });

  const inferred = new Set(Array.isArray(v.inferred) ? v.inferred : []);
  const multiType = new Set(list.map(p => p.type)).size > 1;
  const out = [];
  const seen = new Set();
  // Stable sort: the plain prints first, in a fixed type order; every special print
  // (stamped, patterned, jumbo, a WotC subtype…) after them, in TCGdex's own order.
  const rank = p => (printKey(p) === p.type ? TYPE_RANK[p.type] ?? 3 : 3);
  const ordered = list
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
    .map(x => x.p);
  for (const p of ordered) {
    const key = printKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      short: shortFor(p, multiType),
      label: printLabel(p),
      inferred: key === p.type && inferred.has(p.type),
    });
  }
  for (const e of extra) if (!seen.has(e.key)) { seen.add(e.key); out.push({ ...e, inferred: false }); }
  return out;
}

/** Is this card tracked per print (two or more prints)? */
export const tracksPrints = list => Array.isArray(list) && list.length >= 2;

// ── THE THREE RULES ───────────────────────────────────────────────────────────
// All of these MUTATE the two sets passed in — the callers own them (they are state.*
// sets) and persist afterwards. `keys` is the card's print keys (printsOf → .key).

/** How many of this card's prints are ticked. */
export function ticked(prints, cardId, keys) {
  let n = 0;
  for (const k of keys) if (prints.has(printId(cardId, k))) n++;
  return n;
}

/**
 * Tick or untick one print. Returns whether the CARD is ticked afterwards.
 * Ticking a print ticks the card; unticking the last one unticks it.
 */
export function applyPrint(cards, prints, cardId, key, on, keys) {
  const id = printId(cardId, key);
  if (on) {
    prints.add(id);
    cards.add(cardId);
    return true;
  }
  prints.delete(id);
  if (!ticked(prints, cardId, keys)) cards.delete(cardId);
  return cards.has(cardId);
}

/** Tick or untick a whole card. Unticking clears its prints. */
export function applyCard(cards, prints, cardId, on) {
  if (on) { cards.add(cardId); return; }
  cards.delete(cardId);
  clearPrintsOf(prints, new Set([cardId]));
}

/**
 * Drop every print of the given cards, in ONE pass over the print set — bulk deselect
 * would otherwise be cards × prints.
 * @param {Set<string>} prints
 * @param {Set<string>|((cardId:string)=>boolean)} which card ids, or a predicate
 */
export function clearPrintsOf(prints, which) {
  const hit = typeof which === 'function' ? which : id => which.has(id);
  for (const id of [...prints]) {
    if (hit(splitPrintId(id).cardId)) prints.delete(id);
  }
}

/**
 * [total, done] for one card, for the "P / Q prints" figure. A card that is not tracked
 * per print counts as one print, done when the card is ticked. An owned card with no
 * print recorded counts 0 done: the prints figure is about prints you have NAMED.
 */
export function printTotals(cards, prints, cardId, keys) {
  if (!tracksPrints(keys)) return [1, cards.has(cardId) ? 1 : 0];
  return [keys.length, ticked(prints, cardId, keys)];
}

/** Owned, but no print recorded — the state every pre-existing checklist is in. */
export function printUnset(cards, prints, cardId, keys) {
  return tracksPrints(keys) && cards.has(cardId) && ticked(prints, cardId, keys) === 0;
}

/**
 * Binder slots: one per ticked print, plus one per ticked card with no print recorded.
 * Needs no print lists, so TMS can count it for Pokémon whose popup was never opened.
 */
export function slotCount(cards, prints) {
  const withPrints = new Map();
  for (const id of prints) {
    const { cardId } = splitPrintId(id);
    if (cards.has(cardId)) withPrints.set(cardId, (withPrints.get(cardId) || 0) + 1);
  }
  let n = 0;
  for (const c of cards) n += withPrints.get(c) || 1;
  return n;
}

/**
 * One print-sheet entry per ticked print, or the card's own entry when it is not
 * tracked per print or no print is recorded. Each expanded copy carries
 * `print: {key, label, short}`.
 */
export function expandMeta(meta, cardId, list, prints) {
  if (!tracksPrints(list)) return [meta];
  const on = list.filter(p => prints.has(printId(cardId, p.key)));
  if (!on.length) return [meta];
  return on.map(p => ({ ...meta, print: { key: p.key, label: p.label, short: p.short } }));
}

// ── IMPORT ────────────────────────────────────────────────────────────────────

/** Migrate the card part of a print id (pokemontcg.io → TCGdex), keep the key. */
export function migratePrintId(id) {
  const { cardId, key } = splitPrintId(id);
  return key === null ? migrateIdToken(cardId) : printId(migrateIdToken(cardId), key);
}

/**
 * Valid print ids only: a string, with a key, whose card is in `cards`. A print whose
 * card is not ticked breaks the first rule, so it is dropped rather than restored.
 */
export function prunePrints(ids, cards) {
  const out = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== 'string') continue;
    const { cardId, key } = splitPrintId(id);
    if (key && cards.has(cardId)) out.push(id);
  }
  return [...new Set(out)];
}
