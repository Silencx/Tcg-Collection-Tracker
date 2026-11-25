// =============================================================================
// tools/lib/species.mjs — pure helpers for tools/build-species.mjs: one PokéAPI
// /pokemon-species/{id} answer → one row of data/species.json. No I/O, so the rules are
// testable offline.
// =============================================================================

/**
 * App badge → PokéAPI language names, first one that has a name wins. Japanese is the
 * katakana name (タネボー), as printed on the cards; PokéAPI's plain "ja" is the
 * fallback. Thai and Indonesian are absent: PokéAPI has no Thai names, and Indonesian
 * cards print the English ones.
 */
export const POKEAPI_LANGS = {
  JP: ['ja-hrkt', 'ja'],
  KR: ['ko'],
  TW: ['zh-hant'],
  SC: ['zh-hans'],
  DE: ['de'],
  FR: ['fr'],
  ES: ['es'],
  IT: ['it'],
  PT: ['pt-br'],
};

/** PokéAPI spells "Farfetch’d" with a typographic apostrophe; the cards and TCGdex
 *  use a straight one, and the app's names have to match TCGdex's. */
export function cleanName(s) {
  return String(s ?? '').replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ').trim();
}

const ROMAN = { i: 1, v: 5, x: 10 };
/** "generation-iv" → 4; anything else → null. */
export function genNumber(name) {
  const m = String(name ?? '').match(/^generation-([ivx]+)$/i);
  if (!m) return null;
  const s = m[1].toLowerCase();
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]], next = ROMAN[s[i + 1]] || 0;
    n += v < next ? -v : v;
  }
  return n || null;
}

/**
 * One /pokemon-species/{id} answer → { dex, gen, name, native: {BADGE: name} }, or null
 * when it lacks a dex number, a generation or an English name. A native name equal to
 * the English one is left out: readers fall back to English anyway, and it would only
 * be shown twice.
 */
export function speciesRow(raw) {
  const dex = Number(raw?.id);
  const gen = genNumber(raw?.generation?.name);
  const byLang = new Map();
  for (const n of Array.isArray(raw?.names) ? raw.names : []) {
    const lang = n?.language?.name;
    const name = cleanName(n?.name);
    if (lang && name && !byLang.has(lang)) byLang.set(lang, name);
  }
  const name = byLang.get('en');
  if (!Number.isInteger(dex) || dex < 1 || !gen || !name) return null;
  const native = {};
  for (const [badge, langs] of Object.entries(POKEAPI_LANGS)) {
    const hit = langs.map(l => byLang.get(l)).find(Boolean);
    if (hit && hit !== name) native[badge] = hit;
  }
  return { dex, gen, name, native };
}

/**
 * The body of data/species.json. Columns, not objects, because the app fetches it at
 * boot: `species` rows are [dex, gen, englishName], sorted by dex, and each `native`
 * column runs parallel to them (null = same as English, or not known).
 * @param {Array} rows  speciesRow results; nulls and repeated dex numbers are dropped
 */
export function speciesFile(rows, { builtAt = null, schemaVersion = 1 } = {}) {
  const byDex = new Map();
  for (const r of rows || []) if (r && !byDex.has(r.dex)) byDex.set(r.dex, r);
  const sorted = [...byDex.values()].sort((a, b) => a.dex - b.dex);
  const native = {};
  for (const badge of Object.keys(POKEAPI_LANGS)) {
    const col = sorted.map(r => r.native?.[badge] ?? null);
    if (col.some(Boolean)) native[badge] = col;
  }
  return {
    schemaVersion, builtAt, source: 'pokeapi',
    species: sorted.map(r => [r.dex, r.gen, r.name]),
    native,
  };
}
