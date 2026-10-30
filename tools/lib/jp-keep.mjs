// =============================================================================
// tools/lib/jp-keep.mjs — decide which JP data a build may overwrite.
//
// Bulbapedia is the build's JP source and it is not reliable from a build machine: every
// weekly CI build from 2026-09-14 on came back with zero JP entries (it answered HTTP
// 403 when probed on 2026-10-22). Writing whatever came back took every
// data/jp/<slug>.json from 61 entries to none. That is worse than no snapshot at all:
// snapshot.js treats a built shard as authoritative, so visitors stopped falling back
// to a live fetch and saw no JP cards.
//
// The rule, per Pokémon:
//   • fetch FAILED (fetchJpRawByName says ok:false) → keep the committed shard as is.
//     With no committed shard there is nothing to keep, and none is written: a missing
//     shard sends visitors to a live fetch, an empty one tells them "no JP cards".
//   • fetch answered with FEWER entries than the committed shard → keep the shard. A
//     block page, a vandalised or half-migrated wiki page and a parser regression all
//     look like this; a real JP card disappearing almost never does. A genuine drop can
//     still be accepted by deleting that shard file and re-running the build.
//   • otherwise → write this build's answer.
//
// Pure and exported so tests cover the policy without a network or a data/ directory —
// the whole point is the case where the network is the thing that is broken.
// =============================================================================

/**
 * One Pokémon's outcome.
 * @param {{ok:boolean, entries:Array, error?:string}|undefined} result  fetchJpRawByName row
 * @param {Array|null} previous  the committed shard's jpCardsData, or null when there is none
 * @returns {{write:boolean, entries:Array|null, warning:string|null}}
 *   write:true  → write `entries` as this Pokémon's shard
 *   write:false → leave the committed shard untouched; `entries` is what it already holds
 *                 (null: there is no shard, so this Pokémon is left out of the snapshot)
 */
export function decideJpShard(result, previous) {
  if (!result?.ok) {
    const why = `fetch failed (${result?.error || 'no result'})`;
    return previous
      ? { write: false, entries: previous, warning: `${why}; keeping the committed ${previous.length} entries` }
      : { write: false, entries: null, warning: `${why}; no committed shard, so none is written and visitors fetch it live` };
  }
  if (previous && result.entries.length < previous.length) {
    return {
      write: false, entries: previous,
      warning: `got ${result.entries.length} entries but the committed shard has ${previous.length}; ` +
        'keeping it (delete the shard and rebuild to accept a real drop)',
    };
  }
  return { write: true, entries: result.entries, warning: null };
}

/**
 * The JP shard plan for one build: decideJpShard for every Pokémon, matched by name.
 * @param {string[]} names                     build order (data/prebuilt.json order)
 * @param {Array} results                      fetchJpRawByName(names) output
 * @param {Object<string, Array|null>} previousByName  name → committed shard entries
 * @returns {{shards: Object<string, ReturnType<typeof decideJpShard>>}}
 */
export function planJpSnapshot(names, results, previousByName) {
  const byName = new Map(results.map(r => [r.name, r]));
  const shards = {};
  for (const name of names) shards[name] = decideJpShard(byName.get(name), previousByName[name] ?? null);
  return { shards };
}
