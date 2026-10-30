// =============================================================================
// tools/lib/jp-catalog.mjs — pure helpers for the Japanese card catalogue
// (tools/build-jp-catalog.mjs). No I/O, so the rules are testable offline.
//
// The catalogue replaces two hand-made things: Bulbapedia's per-Pokémon wikitext (which
// blocks our builds) and JP_BULBA_SET_MAP (21 sets, written for the Seedot line). It is
// built from PokéWallet's /sets/:set_id, which lists every card of a set.
// =============================================================================

import { SET_ALIASES, setMatchKey } from './pokewallet.mjs';

/**
 * PokéWallet set name → the name we show and key checklist ids on.
 *   · its code prefix goes ("SV5M: Cyber Judge" → "Cyber Judge"), because Bulbapedia —
 *     whose names our existing JP ids already contain — never has one;
 *   · a set Bulbapedia also has keeps BULBAPEDIA's exact spelling, so a ticked card's id
 *     stays the same when the source changes underneath it.
 * @param {string} pwName
 * @param {string[]} knownNames  JP_BULBA_SET_MAP keys
 */
export function canonicalSetName(pwName, knownNames = []) {
  const byKey = new Map(knownNames.map(n => [setMatchKey(n), n]));
  for (const [bulba, pw] of Object.entries(SET_ALIASES)) byKey.set(setMatchKey(pw), bulba);
  const hit = byKey.get(setMatchKey(pwName));
  if (hit) return hit;
  return String(pwName || '').replace(/^[^:]{1,12}:\s*/, '').trim() || String(pwName || '');
}

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12 };

/** "3rd August, 2007" → "2007-08-03"; anything unreadable → null. Never guesses. */
export function parseReleaseDate(text) {
  const m = String(text || '').trim().match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  const day = Number(m[1]);
  if (!month || day < 1 || day > 31) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Many PokéWallet JP names carry the card number as a suffix: "Alolan Exeggutor - 002/103",
 * "Garchomp LV.X - 058/DP-P". Split it off — it is not part of the name (and it put 9,000
 * rows into the digit shard) — and hand it back, because for some rows it is the only
 * number there is.
 * @returns {{name:string, number:string|null}}
 */
export function splitNumberSuffix(name) {
  const s = String(name || '').trim();
  // "- 002/103", "- 058/DP-P", and deck cards' bare "- 13". One token only, so a name
  // with a spaced phrase after the dash is left alone.
  const m = s.match(/^(.*\S)\s+-\s+(\S*\d\S*\/\S+|\d+[a-z]?)$/i);
  return m ? { name: m[1], number: m[2] } : { name: s, number: null };
}

/** "Weedle (Mirror Holofoil)" → { base: "Weedle", print: "Mirror Holofoil" }. */
export function splitPrint(name) {
  const s = String(name || '').trim();
  const m = s.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  return m && m[1] ? { base: m[1], print: m[2] } : { base: s, print: null };
}

/**
 * One PokéWallet card row → the compact tuple the catalogue stores:
 *   [setIndex, number, name, print|null, rarity|null, ref]
 * Tuples, not objects: ~28,000 rows, and repeating six key names in each would roughly
 * double the file.
 */
export function cardTuple(setIndex, c) {
  const ci = c?.card_info || {};
  const { base, print } = splitPrint(ci.name);
  const { name, number } = splitNumberSuffix(base);
  const own = ci.card_number == null || String(ci.card_number).trim() === 'null' ? '' : String(ci.card_number).trim();
  return [setIndex, own || number || '', name, print, ci.rarity ?? null, String(c?.id ?? '')];
}

/** The same clean-up for a tuple stored by an older build (names still suffixed). */
export function cleanTuple(t) {
  const { name, number } = splitNumberSuffix(t[2]);
  return [t[0], t[1] || number || '', name, ...t.slice(3)];
}

/**
 * PokéWallet files some other-language promo sets under "jap": "Scarlet & Violet Thai
 * Promos" and "… Indonesian Promos" (428 cards). Those are not Japanese prints and must
 * not appear as JP tiles; the app has TH/ID columns of its own. "Chinese/Japanese Promos"
 * are Japanese-language prints and stay.
 */
export function isJapaneseSet(pwName) {
  const n = String(pwName || '');
  return !/\b(thai|indonesian|korean)\b/i.test(n) || /japanese/i.test(n);
}

/** `sets`/`cards` with the non-Japanese sets removed and card set indices remapped. */
export function japaneseOnly(sets, cards) {
  const remap = new Map();
  const keptSets = [];
  sets.forEach((s, i) => { if (isJapaneseSet(s.pwName || s.name)) { remap.set(i, keptSets.length); keptSets.push(s); } });
  const keptCards = [];
  for (const c of cards) if (remap.has(c[0])) keptCards.push([remap.get(c[0]), ...c.slice(1)]);
  return { sets: keptSets, cards: keptCards };
}

/**
 * May this run replace the committed app files (data/jp-cat/)? Only a COMPLETE walk may:
 * the weekly CI run has no cache, so a walk cut short by the quota or an outage would
 * otherwise commit a catalogue missing whole sets — and every visitor would lose those
 * cards until the next good week. Also refuses a set list that shrank by more than 10%
 * against the committed one, which is what a degraded /sets answer looks like.
 * @returns {{ok:boolean, why:string|null}}
 */
export function publishCheck({ incomplete = 0, sets = 0, committedSets = 0 } = {}) {
  if (incomplete > 0) return { ok: false, why: `${incomplete} set(s) not fetched` };
  if (!sets) return { ok: false, why: 'no sets' };
  if (committedSets && sets < committedSets * 0.9) {
    return { ok: false, why: `only ${sets} sets against ${committedSets} committed` };
  }
  return { ok: true, why: null };
}

/** Pages needed for a set at `limit` rows per page; at least one. */
export function pagesFor(cardCount, limit = 200) {
  return Math.max(1, Math.ceil((Number(cardCount) || 0) / limit));
}
