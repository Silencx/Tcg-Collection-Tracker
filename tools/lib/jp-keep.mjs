// =============================================================================
// tools/lib/jp-keep.mjs — decide which JP data a build may overwrite.
//
// Bulbapedia is the only JP source and it is not reliable from a build machine: every
// weekly CI build from 2026-09-14 on came back with zero JP entries (it answered HTTP
// 403 when probed on 2026-10-22). build-data used to write whatever it got, the job
// committed it, and data/jp.json + every data/jp/<slug>.json went from 61 entries to
// none. That is worse than no snapshot at all: snapshot.js treats a built shard as
// authoritative, so visitors stopped falling back to a live fetch and saw no JP cards.
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
 * The whole JP snapshot plan for one build.
 * @param {string[]} names                     build order (data/prebuilt.json order)
 * @param {Array} results                      fetchJpRawByName(names) output
 * @param {Object<string, Array|null>} previousByName  name → committed shard entries
 * @param {string[]|null} previousCombinedPokemon     `pokemon` of the committed jp.json
 *                                                    (null when absent or a placeholder)
 * @returns {{shards: Object<string, ReturnType<typeof decideJpShard>>,
 *            combined: {write:boolean, pokemon:string[], jpCardsData:Array}}}
 */
export function planJpSnapshot(names, results, previousByName, previousCombinedPokemon) {
  const byName = new Map(results.map(r => [r.name, r]));
  const shards = {};
  for (const name of names) shards[name] = decideJpShard(byName.get(name), previousByName[name] ?? null);

  // jp.json is the monolithic copy older cached JS still reads. Its `pokemon` list is the
  // coverage claim snapshot.getJpRaw checks, so a Pokémon with no data at all (failed,
  // nothing committed) is left OUT of it — listing it would serve "no JP cards" instead
  // of letting the visitor fetch live.
  const pokemon = names.filter(n => shards[n].entries);
  const jpCardsData = pokemon.flatMap(n => shards[n].entries);

  // When nothing fresh came in and the list is unchanged, the committed jp.json already
  // says exactly this. Rewriting it would only bump builtAt, and the weekly job commits
  // any diff — a blocked run should leave data/jp* byte-identical.
  const sameList = Array.isArray(previousCombinedPokemon) &&
    previousCombinedPokemon.length === pokemon.length &&
    previousCombinedPokemon.every((n, i) => n === pokemon[i]);
  const write = names.some(n => shards[n].write) || !sameList;

  return { shards, combined: { write, pokemon, jpCardsData } };
}
