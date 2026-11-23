// =============================================================================
// tools/lib/jp-catalog.mjs — pure helpers for the Japanese card catalogue
// (tools/build-jp-catalog.mjs). No I/O, so the rules are testable offline.
//
// The catalogue replaces two hand-made things: Bulbapedia's per-Pokémon wikitext (which
// blocks our builds) and JP_BULBA_SET_MAP (21 sets, written for the Seedot line). It is
// built from PokéWallet's /sets/:set_id, which lists every card of a set.
// =============================================================================

import { SET_ALIASES, setMatchKey } from './pokewallet.mjs';
import { jpSetIdentity } from '../../js/api/jp-model.js';

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

/** A set is a twin when at least this share of its cards repeat ONE other set… */
export const TWIN_SHARE = 0.7;
/** …and it has at least this many cards to compare (smaller sets are left alone). */
export const TWIN_MIN_CARDS = 5;

const twinName = s => String(s ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
const twinNumber = n => String(n ?? '').split('/')[0].trim().toLowerCase().replace(/^0+(?=.)/, '');

/**
 * PokéWallet lists some sets twice, under another name or code: "xsv2a" repeats Pokémon
 * Card 151 (SV2a), "Evolutions Collection 1" repeats the Japanese Base Set, "Rulers of the
 * Gym" repeats Rocket Gang. Each would show as a second tile with the same cards, and its
 * images would be fetched twice. This drops a set that is NOT in the published list
 * (`prior`, data/jp-cat/sets.json) when TWIN_SHARE of its cards repeat one other set that
 * stays. A published set is never dropped, whatever arrives later: that would take away
 * cards people already own. Between two new sets, the one Limitless has, then the bigger
 * one, stays.
 * Cards compare by number + name. A card with no number compares by name, and only with
 * the other set's numberless cards, so a numberless promo list of common Pokémon does not
 * match every big numbered set. Separately-listed prints are left out.
 * `sets` [{name, code, limitless}], `cards` [[setIndex, number, name, print, …]].
 * @returns {{sets, cards, dropped: {set, twinOf}[]}} card set indices remapped
 */
export function dropTwinSets(sets, cards, prior = []) {
  const published = new Set(prior.map(jpSetIdentity));
  const isNew = sets.map(s => !published.has(jpSetIdentity(s)));
  const size = sets.map(() => 0);
  const sigs = sets.map(() => new Set());
  for (const c of cards) {
    size[c[0]]++;
    if (!c[3]) sigs[c[0]].add(`${twinNumber(c[1]) || '-'}|${twinName(c[2])}`);
  }
  const holders = new Map();                     // card signature → set indices
  sigs.forEach((ss, i) => ss.forEach(g => (holders.get(g) || holders.set(g, []).get(g)).push(i)));
  // Published first, then on Limitless, then bigger, then listed first: a total order.
  const rank = i => [isNew[i] ? 0 : 1, sets[i].limitless ? 1 : 0, size[i], -i];
  const cmp = (a, b) => { const x = rank(a), y = rank(b); for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return y[k] - x[k]; return 0; };
  // Strongest first, so every set a candidate could repeat is already settled — a new set
  // that repeats another new set which itself repeats a published one ends up dropped too.
  const twinOf = new Map();
  for (const b of sets.map((_, i) => i).sort(cmp)) {
    if (!isNew[b] || sigs[b].size < TWIN_MIN_CARDS) continue;
    const hits = new Map();
    for (const g of sigs[b]) {
      for (const a of holders.get(g)) if (a !== b && !twinOf.has(a) && cmp(a, b) < 0) hits.set(a, (hits.get(a) || 0) + 1);
    }
    let best = -1, n = 0;
    for (const [a, k] of hits) if (k > n) { best = a; n = k; }
    if (best >= 0 && n >= TWIN_SHARE * sigs[b].size) twinOf.set(b, best);
  }
  if (!twinOf.size) return { sets, cards, dropped: [] };
  const remap = new Map();
  const keptSets = [];
  sets.forEach((s, i) => { if (!twinOf.has(i)) { remap.set(i, keptSets.length); keptSets.push(s); } });
  const keptCards = [];
  for (const c of cards) if (remap.has(c[0])) keptCards.push([remap.get(c[0]), ...c.slice(1)]);
  const dropped = [...twinOf].map(([b, a]) => ({ set: sets[b], twinOf: sets[a] }));
  return { sets: keptSets, cards: keptCards, dropped };
}

/**
 * May this run replace the committed app files (data/jp-cat/)? Only a COMPLETE walk may:
 * when CI's kept cache is lost, the walk starts over from nothing and takes several days
 * on the free tier, and publishing part of it would commit a catalogue missing whole
 * sets — every visitor would lose those cards until it finished. Also refuses a set list
 * that shrank by more than 10% against the committed one, which is what a degraded
 * /sets answer looks like.
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

/**
 * Which sets a run fetches, in order. The raw answer for each set is cached (and CI keeps
 * that cache between runs), so a run only pays for what may have changed:
 *   1. new      no cached copy: a new release, or the first fill;
 *   2. changed  /sets reports a different card_count than the cached copy;
 *   3. stale    the `rotate` least recently fetched of the rest, so a fix PokéWallet makes
 *               without changing the count still arrives, within sets/rotate runs.
 * `refresh` takes every set. The request cap and the live quota can still stop the run
 * part-way; whatever is left comes first next time (new) or stays oldest (stale).
 * @param {Array<{set_id, card_count}>} jpSets  /sets entries, in their order
 * @param {(id:string) => ({count:number|null, fetched:number}|null)} cachedOf
 *   the cached copy's card_count and fetch time (ms), or null when there is none
 * @param {{refresh?:boolean, rotate?:number}} [opts]
 * @returns {Array<{set:object, why:'new'|'changed'|'stale'|'refresh'}>}
 */
export function planFetch(jpSets, cachedOf, { refresh = false, rotate = 0 } = {}) {
  if (refresh) return jpSets.map(set => ({ set, why: 'refresh' }));
  const fresh = [], changed = [], rest = [];
  for (const set of jpSets) {
    const c = cachedOf(String(set.set_id));
    if (!c) fresh.push({ set, why: 'new' });
    else if (c.count != null && Number(set.card_count) !== c.count) changed.push({ set, why: 'changed' });
    else rest.push({ set, fetched: c.fetched || 0 });
  }
  const stale = rest.sort((a, b) => a.fetched - b.fetched)        // stable: ties keep /sets order
    .slice(0, Math.max(0, rotate)).map(({ set }) => ({ set, why: 'stale' }));
  return [...fresh, ...changed, ...stale];
}

/** Pages needed for a set at `limit` rows per page; at least one. */
export function pagesFor(cardCount, limit = 200) {
  return Math.max(1, Math.ceil((Number(cardCount) || 0) / limit));
}
