// =============================================================================
// api/merge.js — combining a partial snapshot hit with a live fetch, as pure
// functions.
//
// Split out of router.js for the usual reason (see filter-pass.js, setnav-index.js,
// collapse-model.js): importing router.js pulls in legacy.js → state.js → storage.js,
// which touches localStorage at import time, so `node --test` cannot reach it without
// a jsdom or a shim. These two rules are the ones most worth testing in the whole
// partial-hit path, so they live where they can be.
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
  // that answers with more than it was asked for (the removed legacy fetchEnCards
  // served the whole configured list) must not have the extra dropped silently.
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
const SOURCE_RANK = { snapshot: 0, tcgdex: 1, legacy: 2 };

/**
 * The weakest provider that actually contributed.
 *
 * masterset's buildAll stores this string in the cache, and callers compare it with
 * plain equality. It used to drive a "backup source" banner on `source === 'legacy'`,
 * which a compound value like 'snapshot+legacy' would have silently suppressed; the
 * card index has had no legacy branch since 2026-10-30, but returning the weakest
 * single name keeps every such equality check working.
 */
export function mergeSource(sources) {
  return sources.filter(Boolean).reduce((a, b) => (SOURCE_RANK[b] > SOURCE_RANK[a] ? b : a));
}
