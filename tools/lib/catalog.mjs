// =============================================================================
// tools/lib/catalog.mjs — TCGdex's whole card list, per language, as the files the app
// reads (data/cat/). The network half is tools/build-catalog.mjs; this half is pure.
//
// One row per card: [set id, number, name, category], then, when they apply, the card's
// Pokédex numbers (an array) and a 0 when TCGdex lists the card without a scan. The card
// id is always `${set}-${number}` and the image address is rebuilt from data/sets.json's
// series map (both measured on every card in all nine languages, 2026-11-25), so neither
// is stored. Category is one letter (P / T / E): 24,000 rows repeating "Pokemon" would
// cost 170 KB.
//
// Pokédex numbers are English only: they come from TCGdex's GraphQL, which answers in
// English, and only the master set (English) matches cards to Pokémon. 20,132 of 20,246
// English Pokémon cards have them (2026-11-26); js/api/match-model.js is the rule.
//
// The 0 follows js/api/card-image-model.js: a card has an `image` exactly when the CDN
// holds its scan, and /{lang}/cards gives the same answer as a set listing (2,146 of
// 7,436 zh-tw, 1,224 of 2,921 th, 1,152 of 2,788 id, 2026-11-26). It is the exception
// rather than a flag on every row because most English cards have one.
//
// Rows are filed by name like data/jp-cat/: under the first letter of every word of the
// card's name (js/api/jp-model.js, nameShardLetters), so the app finds a Pokémon's cards
// by loading one shard. Names with no Latin letter (Traditional Chinese, Thai) go to "0".
// A row is also filed under the shard of every Pokémon its numbers name, so a card whose
// name lacks one ("Terapagos & Friends" numbers Pikachu) is still in Pikachu's shard.
// =============================================================================

import { LANGUAGES } from '../../js/config.js';
import { nameShardLetters, speciesShardLetter } from '../../js/api/jp-model.js';
import { naturalCompare, rowDexIds } from '../../js/api/catalog-model.js';
import { listedImageBase } from '../../js/api/card-image-model.js';
import { readDexIds } from '../../js/api/match-model.js';

export const SCHEMA_VERSION = 1;

/** The languages TCGdex has a card list for, English first: { code, apiCode }. */
export const CATALOG_LANGS = LANGUAGES
  .filter(l => l.hasSetsApi && l.apiCode)
  .map(l => ({ code: l.code, apiCode: l.apiCode }));

// TCGdex's /{lang}/categories answers in the language itself. Every value it gave on
// 2026-11-25, folded (accents off, lower case). An unknown word leaves those cards with
// no category, and the build says so.
const CATEGORY_WORDS = {
  pokemon: 'P',
  trainer: 'T', dresseur: 'T', entrenador: 'T', allenatore: 'T', treinador: 'T',
  energy: 'E', energie: 'E', energia: 'E',
};
export const CATEGORY_NAMES = { P: 'Pokemon', T: 'Trainer', E: 'Energy' };

const fold = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** 'Énergie' → 'E', 'Dresseur' → 'T'; anything else → null. */
export function categoryCode(word) {
  return CATEGORY_WORDS[fold(word)] || null;
}

/** The set id of card `id` numbered `localId`, or null when the id is not `${set}-${localId}`. */
export function cardSet(id, localId) {
  const n = String(localId ?? '');
  const s = String(id ?? '');
  if (!n || !s.endsWith(`-${n}`)) return null;
  const set = s.slice(0, s.length - n.length - 1);
  return set || null;
}

const rowCompare = (a, b) => naturalCompare(a[0], b[0]) || naturalCompare(a[1], b[1]);

/**
 * TCGdex /{lang}/cards items → catalogue rows, sorted by set then number.
 * @param {Array<{id,localId,name,image?}>} list
 * @param {Map<string,string>} [catById] card id → 'P' | 'T' | 'E'
 * @param {Map<string,unknown>} [dexById] card id → TCGdex's `dexId` (English only)
 * @returns {{ rows: Array<[string,string,string,string|null,number[]?,0?]>, skipped: string[] }}
 *   `skipped`: ids that could not be read (no name, or not `${set}-${localId}`)
 */
export function catalogRows(list, catById = new Map(), dexById = new Map()) {
  const rows = [], skipped = [], seen = new Set();
  for (const c of list || []) {
    const set = cardSet(c?.id, c?.localId);
    const name = typeof c?.name === 'string' ? c.name.trim() : '';
    if (!set || !name) { skipped.push(String(c?.id ?? '?')); continue; }
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const row = [set, String(c.localId), name, catById.get(c.id) || null];
    const dex = readDexIds(dexById.get(c.id));
    if (dex.length) row.push(dex);
    if (!listedImageBase(c.image)) row.push(0);
    rows.push(row);
  }
  rows.sort(rowCompare);
  return { rows, skipped };
}

/** The shard letters a row is filed under: its name's word letters, or "0" when it has none. */
export function rowLetters(name) {
  const l = nameShardLetters(name);
  return l.length ? l : ['0'];
}

/** data/species.json's rows ([dex, gen, name]) → dex → the shard letter that Pokémon is looked up in. */
export function dexLetters(species) {
  const map = new Map();
  for (const s of species || []) if (Number.isInteger(s?.[0]) && typeof s[2] === 'string') map.set(s[0], speciesShardLetter(s[2]));
  return map;
}

/**
 * Every shard letter a row is filed under: its name's letters and, with `byDex`
 * (dexLetters), the letter of every Pokémon its numbers name.
 */
export function rowShardLetters(row, byDex = new Map()) {
  const letters = new Set(rowLetters(row[2]));
  for (const n of rowDexIds(row)) if (byDex.get(n)) letters.add(byDex.get(n));
  return [...letters];
}

/** Rows → { letter: rows }, letters sorted, each shard keeping the rows' order. */
export function shardRows(rows, byDex = new Map()) {
  const out = {};
  for (const r of rows) for (const l of rowShardLetters(r, byDex)) (out[l] ||= []).push(r);
  return Object.fromEntries(Object.keys(out).sort().map(l => [l, out[l]]));
}

/** One shard file's body (builtAt is stamped by the caller). */
export function shardFile(code, rows) {
  return { schemaVersion: SCHEMA_VERSION, builtAt: null, source: 'tcgdex', lang: code, rows };
}

/** What data/cat/index.json says about one language. */
export function langSummary(rows, shards) {
  return { cards: rows.length, sets: new Set(rows.map(r => r[0])).size, shards: Object.keys(shards) };
}

/** data/cat/index.json's body: which languages have a catalogue, and which shards each has. */
export function indexFile(langs) {
  const ordered = {};
  for (const { code } of CATALOG_LANGS) if (langs[code]) ordered[code] = langs[code];
  return { schemaVersion: SCHEMA_VERSION, builtAt: null, source: 'tcgdex', langs: ordered };
}

/**
 * Whether a new list may replace the committed one. A TCGdex answer that lost more than
 * a tenth of a language's cards is far likelier to be an outage than a real removal, so
 * the old files stay until someone looks (or reruns with --force).
 */
export function acceptCount(next, prev, { force = false } = {}) {
  if (!next) return false;
  if (force || !prev) return true;
  return next >= prev * 0.9;
}
