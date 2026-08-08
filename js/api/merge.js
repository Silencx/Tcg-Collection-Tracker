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
  // Anything whose species is not in `names` still belongs in the result: legacy's
  // fetchEnCards serves the whole configured list rather than the subset asked for.
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
 * LOAD-BEARING: masterset's buildAll stores this string in the cache and tests
 * `source === 'legacy'` to raise the "showing data from the backup source" banner. A
 * compound value like 'snapshot+legacy' would silently suppress that banner — a
 * regression nobody would notice until the backup data went stale. Returning the
 * weakest name preserves the existing equality check exactly.
 */
export function mergeSource(sources) {
  return sources.filter(Boolean).reduce((a, b) => (SOURCE_RANK[b] > SOURCE_RANK[a] ? b : a));
}
