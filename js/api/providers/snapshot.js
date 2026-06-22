// =============================================================================
// providers/snapshot.js — serves the pre-built static data committed to the repo
// (data/cards.json + data/sets.json), so the common case needs zero external API
// calls (instant, no rate limits, any number of users). Built weekly by
// tools/build-data.mjs via GitHub Actions.
//
// This is a thin READ layer; the router tries it FIRST and falls back to the live
// TCGdex provider (then legacy) on any miss — so the app works even before the
// first build (the shipped placeholder files report builtAt:null → treated as a
// miss). A user-triggered refresh bypasses the snapshot to fetch live.
//
// The snapshot is generated FROM TCGdex, so its card ids/shape are identical to the
// live tcgdex provider's — checklist ids line up either way.
// =============================================================================

// data/ sits at the site root; this module is js/api/providers/snapshot.js.
const DATA_BASE = new URL('../../../data/', import.meta.url);

async function loadJSON(file) {
  const res = await fetch(new URL(file, DATA_BASE), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`snapshot ${file}: HTTP ${res.status}`);
  return res.json();
}

/**
 * EN master card index from the snapshot, IF it covers every requested Pokémon.
 * Throws (→ router falls back to live) when the file is missing, a placeholder
 * (builtAt null), or doesn't include one of the requested names.
 */
export async function getCards(names) {
  const snap = await loadJSON('cards.json');
  if (!snap || !snap.builtAt) throw new Error('snapshot not built yet');
  const have = new Set(snap.pokemon || []);
  if (!names.every(n => have.has(n))) throw new Error('snapshot does not cover requested Pokémon');
  const wanted = new Set(names);
  const cards = (snap.cards || []).filter(c => wanted.has(c.name));
  if (!cards.length) throw new Error('snapshot empty for requested Pokémon');
  return cards;
}

/** Set metadata from the snapshot. Throws when missing/placeholder → live fallback. */
export async function getSetMeta() {
  const snap = await loadJSON('sets.json');
  if (!snap || !snap.builtAt || !snap.names || !Object.keys(snap.names).length) {
    throw new Error('set-meta snapshot not built yet');
  }
  return { names: snap.names || {}, dates: snap.dates || {}, symbols: snap.symbols || {} };
}

/**
 * Raw Bulbapedia JP entries [{jpset, jpnum, pokemonName}] from the snapshot, IF it
 * covers every requested Pokémon. Throws (→ live Bulbapedia) when missing/placeholder/
 * uncovered.
 */
export async function getJpRaw(names) {
  const snap = await loadJSON('jp.json');
  if (!snap || !snap.builtAt) throw new Error('JP snapshot not built yet');
  const have = new Set(snap.pokemon || []);
  if (!names.every(n => have.has(n))) throw new Error('JP snapshot does not cover requested Pokémon');
  const wanted = new Set(names);
  return (snap.jpCardsData || []).filter(e => wanted.has(e.pokemonName));
}

export const snapshot = { getCards, getSetMeta, getJpRaw };
