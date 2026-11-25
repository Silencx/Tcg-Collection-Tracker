// =============================================================================
// api/species-model.js — DOM-free half of the Pokémon catalogue: reading
// data/species.json (tools/build-species.mjs, from PokéAPI) and searching it.
//
// The catalogue lives on state.speciesCatalog and the native names on state.nativeNames
// (js/state.js). Both start as the built-in POKEMON_CATALOG / NATIVE_NAMES from
// config.js; boot swaps in the file's full National Dex when it loads (js/main.js), so
// the app works the same, only with fewer Pokémon, when the file is missing.
// =============================================================================

/**
 * data/species.json → { catalog: [{name, dex, gen}], native: {BADGE: {englishName: name}} }.
 * null for anything not shaped like a built file (no builtAt, no rows, a malformed row):
 * the caller then keeps the built-in lists rather than half of a broken one.
 */
export function readSpeciesFile(json) {
  const rows = json?.species;
  if (!json?.builtAt || !Array.isArray(rows) || !rows.length) return null;
  const catalog = [];
  for (const r of rows) {
    if (!Array.isArray(r)) return null;
    const [dex, gen, name] = r;
    if (!Number.isInteger(dex) || !Number.isInteger(gen) || typeof name !== 'string' || !name) return null;
    catalog.push({ name, dex, gen });
  }
  const native = {};
  for (const [badge, col] of Object.entries(json.native || {})) {
    if (!Array.isArray(col) || col.length !== rows.length) continue;   // a misaligned column would name the wrong Pokémon
    const map = {};
    col.forEach((n, i) => { if (typeof n === 'string' && n) map[catalog[i].name] = n; });
    native[badge] = map;
  }
  return { catalog, native };
}

/** Native names from the file over the built-in ones, badge by badge. */
export function mergeNativeNames(base = {}, extra = {}) {
  const out = {};
  for (const badge of new Set([...Object.keys(base), ...Object.keys(extra)])) {
    out[badge] = { ...(base[badge] || {}), ...(extra[badge] || {}) };
  }
  return out;
}

/** Case- and accent-blind form for search: "Flabébé" and "flabebe" match. Recomposed
 *  afterwards, so Hangul syllables and kana stay whole. */
export function foldName(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase();
}

/**
 * Catalogue entries matching a search, in catalogue (dex) order.
 *   · the English name or any native name contains the query ("pika", "ピカ", "Glurak");
 *   · "25" or "#25" finds dex number 25.
 * An empty query matches everything that passes `gen` and `exclude`.
 * @param {Array<{name,dex,gen}>} catalog
 * @param {string} query
 * @param {object} [opts]
 * @param {object} [opts.native]  state.nativeNames
 * @param {number} [opts.gen]  0 = every generation
 * @param {string[]} [opts.exclude]  English names to leave out (already tracked)
 */
export function searchSpecies(catalog, query, { native = {}, gen = 0, exclude = [] } = {}) {
  const q = foldName(query).trim();
  const dex = /^#?\d+$/.test(q) ? Number(q.replace('#', '')) : null;
  const skip = new Set(exclude);
  const maps = Object.values(native || {});
  return (catalog || []).filter(p => {
    if (gen && p.gen !== gen) return false;
    if (skip.has(p.name)) return false;
    if (!q) return true;
    if (dex != null) return p.dex === dex;
    if (foldName(p.name).includes(q)) return true;
    return maps.some(m => m?.[p.name] && foldName(m[p.name]).includes(q));
  });
}

/** The generations a catalogue covers, ascending: the True master set filter buttons. */
export const catalogGens = catalog => [...new Set((catalog || []).map(p => p.gen))].sort((a, b) => a - b);
