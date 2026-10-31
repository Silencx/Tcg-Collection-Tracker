// =============================================================================
// api/merge.js — combining a partial snapshot hit with a live fetch, as pure
// functions.
//
// Kept apart from router.js so the two rules most worth testing in the partial-hit
// path can be tested on their own, with no providers or network behind them.
// =============================================================================

/**
 * Combine card lists, preserving getCards' deterministic dedup: a cameo card shared by
 * two Pokémon ("Seedot & Nuzleaf-GX") resolves to the FIRST-LISTED Pokémon, whichever
 * list it happened to arrive in. tcgdex.getCards documents that determinism as
 * deliberate; a merge that changed it would silently re-attribute cards.
 *
 * @param {string[]} names the requested Pokémon, in order
 * @param {Array<Array|null>} lists card lists to combine
 */
export function mergeCardSets(names, lists) {
  const bySpecies = new Map();
  for (const list of lists) {
    for (const c of list || []) {
      if (!c?.id) continue;
      // `species` fallback: snapshots built before species existed carry only `name`.
      const sp = c.species || c.name;
      if (!bySpecies.has(sp)) bySpecies.set(sp, []);
      bySpecies.get(sp).push(c);
    }
  }
  const seen = new Set();
  const out = [];
  for (const n of names) {
    for (const c of bySpecies.get(n) || []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
  }
  // Anything whose species is not in `names` still belongs in the result: a provider
  // that answers with more than it was asked for must not have the extra dropped
  // silently.
  for (const list of lists) {
    for (const c of list || []) {
      if (!c?.id || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

// Provider strength, weakest last.
const SOURCE_RANK = { snapshot: 0, tcgdex: 1 };

/**
 * The weakest provider that actually contributed.
 *
 * masterset's buildAll stores this string in the cache. A single provider name, never
 * a compound like 'snapshot+tcgdex', so any caller can compare it with plain equality.
 */
export function mergeSource(sources) {
  return sources.filter(Boolean).reduce((a, b) => (SOURCE_RANK[b] > SOURCE_RANK[a] ? b : a));
}
