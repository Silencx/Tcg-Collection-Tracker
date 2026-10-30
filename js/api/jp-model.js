// =============================================================================
// jp-model.js — Japanese card identity: stable ids, eras, and the one-time migration of
// the two old id formats. Pure (no DOM, no fetch, no state), shared by the browser, the
// build (tools/) and the tests.
//
// THE ID: `JP_{setKey}_{numKey}`, e.g. JP_miracle-of-the-desert_1. All lower case.
//   setKey  the set's name slugged (local-images.setSlug); a name two sets share
//           ("Battle Academy", "Champion Road") gets its code appended.
//   numKey  the card number without padding or total ("001/053" → "1"); a card with no
//           printed number — every Japanese WotC and early-DP card — is keyed on its
//           name instead ("n-pikachu"), with "-2", "-3" for repeats within a set.
// The same `{setKey}/{numKey}` names the card's hosted image (img/jp/…), so a tile and
// its file can never disagree about which card they are.
//
// WHY IT CHANGED: Master Set used `JP_jp_{pokemon}_{set}_{index}`, where index counted
// every JP row rendered so far — adding one card anywhere shifted every tick after it.
// TMS used `JP_{code|set}_{number}`, which was stable but disagreed with Master Set.
// =============================================================================

import { setSlug, cardNumber } from './local-images.js';
import { JP_BULBA_SET_MAP } from './bulba-jp.js';

const blank = n => n == null || String(n).trim() === '' || String(n).trim() === 'null';

/** Card number → key; numberless cards fall back to their name. */
export function jpNumKey(number, name) {
  return blank(number) ? `n-${setSlug(name)}` : cardNumber(number).toLowerCase();
}

export function jpCardId(setKey, numKey) { return `JP_${setKey}_${numKey}`; }

/** The hosted-image key for the same card (api/local-images.js layout). */
export function jpImageKeyFor(setKey, numKey) { return `jp/${setKey}/${numKey}`; }

/** An id already in the new format — lower case, two slug segments. */
export function isStableJpId(id) { return /^JP_[a-z0-9-]+_[a-z0-9-]+$/.test(String(id)); }

/**
 * Give every set a key and every card a numKey, deterministically, in place.
 * `sets` [{name, code, id}], `cards` [[setIndex, number, name, print, …]] (catalogue
 * tuples). Separately-listed prints share their base card's number, so they get the
 * same numKey with "--{print}" appended and never take a base card's slot. (A slug never
 * starts with "-", so "--" cannot occur in a base key, and the id stays isStableJpId.)
 * @returns {{setKeys:string[], numKeys:string[]}} parallel to sets / cards
 */
export function assignJpKeys(sets, cards) {
  const counts = new Map();
  for (const s of sets) counts.set(s.name, (counts.get(s.name) || 0) + 1);
  const setKeys = sets.map(s => {
    const base = setSlug(s.name);
    return counts.get(s.name) > 1 ? `${base}-${setSlug(s.code || s.id)}` : base;
  });
  const taken = sets.map(() => new Map());
  const numKeys = cards.map(c => {
    const base = jpNumKey(c[1], c[2]);
    const k = c[3] ? `${base}--${setSlug(c[3])}` : base;
    const seen = taken[c[0]];
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    return n === 1 ? k : `${k}-${n}`;
  });
  return { setKeys, numKeys };
}

// ── name shards ───────────────────────────────────────────────────────────────
// The app-facing catalogue is split by the first letter of every word in a card's name
// (data/jp-cat/cards-{a…z,0}.json), so looking up one Pokémon loads ~1/26th of 28,000
// rows. A card is filed under each of its words' letters — "Pikachu & Zekrom-GX" sits in
// p, z and g — and a Pokémon is looked up under its FIRST word's letter, which is always
// one of its cards' words because matching is whole-word (tcgdex.namesSpecies).
const words = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const letterOf = w => (/^[a-z]/.test(w) ? w[0] : '0');
// Words that are never the FIRST word of a Pokémon's name, so filing under them only
// bloats a shard ("ex" and "Energy" alone made cards-e 9,440 rows). Single letters too
// ("Team Aqua's" → "s"). A card is still filed under every other word it has.
const NOT_A_SPECIES_WORD = new Set(['ex', 'gx', 'vmax', 'vstar', 'lv', 'break', 'prime', 'legend',
  'tag', 'team', 'energy', 'dark', 'light', 'shining', 'radiant', 'alolan', 'galarian', 'hisuian',
  'paldean', 'mega', 'rocket', 'trainer', 'the', 'of', 'and', 'box', 'star']);

export function nameShardLetters(cardName) {
  const keep = words(cardName).filter(w => w.length > 1 && !NOT_A_SPECIES_WORD.has(w));
  return [...new Set(keep.map(letterOf))];
}
export function speciesShardLetter(species) { const w = words(species)[0]; return w ? letterOf(w) : null; }

// ── eras ──────────────────────────────────────────────────────────────────────
// A JP set block is spliced into the Master Set page under the EN era it belongs to
// (the page's .era-label[data-series]). Japanese release dates, by era start.
const ERA_STARTS = [
  ['1996-01-01', 'base'], ['1998-10-01', 'gym'], ['1999-07-01', 'neo'],
  ['2001-10-01', 'ecard'], ['2003-07-01', 'ex'], ['2006-12-01', 'dp'],
  ['2008-09-01', 'pl'], ['2009-12-01', 'hgss'], ['2010-12-01', 'bw'],
  ['2013-12-01', 'xy'], ['2016-12-01', 'sm'], ['2019-12-01', 'swsh'],
  ['2023-01-01', 'sv'], ['2025-08-01', 'me'],
];
// For the sets PokéWallet gives no date. Order matters: SM/SV before plain S.
const ERA_CODES = [
  [/^(sv|svm|svi)/i, 'sv'], [/^sm/i, 'sm'], [/^m\d/i, 'me'], [/^s(\d|[a-z]\b|-p)/i, 'swsh'],
  [/^xy/i, 'xy'], [/^bw/i, 'bw'], [/^(l\d|hs|ll)/i, 'hgss'], [/^pt/i, 'pl'], [/^dp/i, 'dp'],
  [/^(adv|pcg)/i, 'ex'], [/^(e\d|vs|web)/i, 'ecard'],
];

/** EN series id for a JP set, or null when neither its date nor its code says. */
export function jpEra(code, isoDate) {
  if (isoDate) {
    let era = null;
    for (const [start, id] of ERA_STARTS) if (isoDate >= start) era = id;
    if (era) return era;
  }
  const c = String(code || '');
  for (const [re, id] of ERA_CODES) if (re.test(c)) return id;
  return null;
}

// ── migration of the old ids ──────────────────────────────────────────────────
/** 'JP_jp_Seedot_Miracle of the Desert_0' → {pokemonName, jpset, index}. */
export function parseOldMasterId(id) {
  const m = /^JP_jp_([^_]+)_(.+)_(\d+)$/.exec(String(id));
  return m ? { pokemonName: m[1], jpset: m[2], index: Number(m[3]) } : null;
}

/** 'JP_SV5M_003' / 'JP_Miracle of the Desert_001' → {setRef, localId}. */
export function parseOldTmsId(id) {
  const s = String(id);
  if (!s.startsWith('JP_') || s.startsWith('JP_jp_') || isStableJpId(s)) return null;
  const rest = s.slice(3);
  const u = rest.lastIndexOf('_');
  return u > 0 ? { setRef: rest.slice(0, u), localId: rest.slice(u + 1) } : null;
}

export const isOldJpId = id => !!(parseOldMasterId(id) || parseOldTmsId(id));

/**
 * The rows the old Master Set numbered, in the order it numbered them: data/jp*.json rows
 * for the Pokémon list, skipping sets JP_BULBA_SET_MAP did not know (the old code skipped
 * those without advancing the index).
 */
export function replayOldMasterOrder(rows) {
  return (rows || []).filter(r => r && JP_BULBA_SET_MAP[r.jpset]);
}

/**
 * Old id → new id, or null when it cannot be resolved with certainty (the caller keeps
 * the old id then: a tick is never dropped, only left unrendered).
 * @param {object} ctx
 * @param {Array}  ctx.replay  replayOldMasterOrder(...) for the current Pokémon list
 * @param {(pokemonName:string, jpset:string)=>string[]} ctx.candidates  card numbers
 *   known for that Pokémon in that set (Bulbapedia snapshot and/or catalogue)
 */
export function migrateJpId(id, { replay = [], candidates = () => [] } = {}) {
  const m = parseOldMasterId(id);
  if (m) {
    const r = replay[m.index];
    // The index is only trusted when the row it points at is the same Pokémon and set —
    // a Pokémon list reordered since the tick would otherwise move it to another card.
    if (r && r.pokemonName === m.pokemonName && r.jpset === m.jpset) {
      return jpCardId(setSlug(m.jpset), jpNumKey(r.jpnum));
    }
    const nums = [...new Set(candidates(m.pokemonName, m.jpset).map(n => jpNumKey(n)))];
    return nums.length === 1 ? jpCardId(setSlug(m.jpset), nums[0]) : null;
  }
  const t = parseOldTmsId(id);
  if (t) {
    const byCode = Object.entries(JP_BULBA_SET_MAP).find(([, v]) => v.code && v.code === t.setRef);
    const name = byCode ? byCode[0] : t.setRef;
    return jpCardId(setSlug(name), jpNumKey(t.localId));
  }
  return null;
}
