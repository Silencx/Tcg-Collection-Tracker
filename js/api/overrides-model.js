// =============================================================================
// api/overrides-model.js — cards no source lists, added by hand (data/overrides.json).
//
// A row is { lang, set, number, name, dexId?, source, issue }:
//   lang    a LANGUAGES code ('en', 'de', …, 'zh-Hant', 'th', 'id') or 'ja'
//   set     the set's id in that language's data: a TCGdex set id ('swshp'), or for
//           Japanese the catalogue's set key (data/jp-cat/sets.json, 'battle-academy')
//   number  the card number as that set writes it ('SWSH020', '163'; Japanese '001/053')
//   name    the printed card name, in English for Japanese cards like data/jp-cat/
//   dexId   Pokédex numbers of the Pokémon on the card, when known
//   source  the proof link the report gave
//   issue   the GitHub issue that reported it
// Rows come from the "Missing card" issue form (tools/missing-card.mjs) and leave again
// once a source lists the card (tools/prune-overrides.mjs).
//
// Where they show up, always after every other source, never replacing one of its cards:
//   • English rows: master set and the True master set popup (router.getCards), matched
//     to Pokémon by the same name-or-number rule as every other card (match-model.js);
//   • any TCGdex language: single-set mode for that set and language (router.getSetCards);
//   • Japanese rows: the Japanese cards of master set and TMS (jp-source.js), for sets
//     the Japanese catalogue has.
// Pure: no fetch, no DOM. js/api/overrides.js loads the file; the build reads it too.
// =============================================================================

import { LANGUAGES } from '../config.js';
import { cardIsSpecies, readDexIds } from './match-model.js';
import { catalogCard, naturalCompare } from './catalog-model.js';
import { jpCardId, jpNumKey } from './jp-model.js';

/** Languages a row may name: every TCGdex language, plus Japanese. */
export const OVERRIDE_LANGS = Object.freeze([...LANGUAGES.map(l => l.code), 'ja']);

// The shapes a row's fields may take. The issue form's checks are stricter
// (tools/lib/overrides.mjs); these only keep a malformed row out of the app.
export const SET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9/-]{0,15}$/;
const NAME_MAX = 80;

/**
 * The valid rows of an overrides file, in file order. Anything else — no file, a
 * malformed file, a malformed row — reads as no override, so the app never depends on
 * this file being there or being right.
 */
export function readOverrides(json) {
  const list = Array.isArray(json?.overrides) ? json.overrides : [];
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    if (!OVERRIDE_LANGS.includes(r.lang)) continue;
    if (typeof r.set !== 'string' || !SET_RE.test(r.set)) continue;
    if (typeof r.number !== 'string' || !NUMBER_RE.test(r.number)) continue;
    if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > NAME_MAX) continue;
    if (!Number.isInteger(r.issue) || r.issue < 1) continue;
    const row = { lang: r.lang, set: r.set, number: r.number, name: r.name.trim() };
    const dex = readDexIds(r.dexId);
    if (dex.length) row.dexId = dex;
    row.source = typeof r.source === 'string' ? r.source : '';
    row.issue = r.issue;
    out.push(row);
  }
  return out;
}

/**
 * The number a card is told apart by: case and zero padding dropped ("SWSH020" and
 * "swsh20" are one card), and for Japanese the card's numKey ("001/053" → "1"), as in
 * its checklist id. Two rows with one key are the same card.
 */
export function numberKey(lang, number) {
  if (lang === 'ja') return jpNumKey(number);
  return String(number ?? '').trim().toUpperCase().replace(/\d+/g, d => String(Number(d)));
}

/** One card's identity across sources: language, set and number key. */
export function cardKey(lang, set, number) {
  return `${lang}|${set}|${numberKey(lang, number)}`;
}

/** The checklist id a row's card gets: TCGdex's `{set}-{number}`, or the Japanese id. */
export function overrideId(row) {
  return row.lang === 'ja' ? jpCardId(row.set, jpNumKey(row.number)) : `${row.set}-${row.number}`;
}

/**
 * English override cards for master set, in getCards' shape and order: Pokémon by
 * Pokémon in `names` order, a card shared by two of them going to the first-listed one.
 * Merged AFTER the other sources (router.js, mergeCardSets), so a card a source lists
 * keeps that source's entry.
 */
export function overrideCards(rows, names, { setSeries = null, dexByName = null } = {}) {
  const en = (rows || []).filter(r => r.lang === 'en');
  const cards = [], seen = new Set();
  for (const name of names || []) {
    for (const r of en) {
      if (!cardIsSpecies({ name: r.name, dexIds: r.dexId }, name, dexByName)) continue;
      const card = catalogCard([r.set, r.number, r.name], { species: name, setSeries });
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      cards.push(card);
    }
  }
  return cards;
}

/**
 * Override cards for one set in one TCGdex language, in getSetCards' shape. No image:
 * a card no source lists has no scan on TCGdex's CDN either, so the tile is the
 * placeholder and no request is made.
 */
export function overrideSetCards(rows, setId, code = 'en') {
  return (rows || [])
    .filter(r => r.lang === code && r.set === setId)
    .map(r => ({ id: `${r.set}-${r.number}`, name: r.name, species: r.name, image: null, localId: r.number }));
}

/**
 * `cards` with each of `extra` the list lacks, in number order: an extra card goes in
 * before the first card whose number sorts after it, and the listed cards keep the order
 * their source gave them. A card already listed (by id, or by number key) is left out.
 */
export function mergeSetCards(cards, extra) {
  const out = [...(cards || [])];
  const have = new Set(out.flatMap(c => [c.id, numberKey('en', c.localId)]));
  for (const c of extra || []) {
    if (have.has(c.id) || have.has(numberKey('en', c.localId))) continue;
    have.add(c.id); have.add(numberKey('en', c.localId));
    const at = out.findIndex(o => naturalCompare(numberKey('en', o.localId), numberKey('en', c.localId)) > 0);
    out.splice(at < 0 ? out.length : at, 0, c);
  }
  return out;
}

/**
 * Japanese override rows for jp-source.js, in its row shape, for the sets `sets` knows
 * (the Japanese catalogue's). Matched like the catalogue's rows (by name), plus the
 * row's Pokédex numbers. `seen` holds the ids already listed and is extended.
 */
export function overrideJpRows(rows, names, sets, { seen = new Set(), dexByName = null } = {}) {
  const out = [];
  const ja = (rows || []).filter(r => r.lang === 'ja' && sets?.has(r.set));
  for (const name of names || []) {
    for (const r of ja) {
      if (!cardIsSpecies({ name: r.name, dexIds: r.dexId }, name, dexByName)) continue;
      const numKey = jpNumKey(r.number);
      const id = jpCardId(r.set, numKey);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, setKey: r.set, number: r.number, numKey, cardName: r.name, pokemonName: name });
    }
  }
  return out;
}
