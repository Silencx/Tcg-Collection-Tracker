// =============================================================================
// providers/snapshot.js — serves the pre-built static data committed to the repo
// (data/index.json → data/cards/<slug>.json + data/jp/<slug>.json, and
// data/sets.json), so the common case needs zero external API calls (instant, no rate
// limits, any number of users). Built weekly by tools/build-data.mjs via GitHub Actions.
//
// This is a thin READ layer; the router tries it FIRST and falls back to the live
// TCGdex provider on any miss — a missing or unbuilt file (no builtAt) is a miss, so
// the app works without it. A user-triggered refresh bypasses the snapshot.
//
// The snapshot is generated FROM TCGdex, so its card ids/shape are identical to the
// live tcgdex provider's — checklist ids line up either way.
// =============================================================================

// data/ sits at the site root; this module is js/api/providers/snapshot.js.
const DATA_BASE = new URL('../../../data/', import.meta.url);

// Session-lifetime memo, keyed by filename, so buildAll and every TMS popup share one
// fetch and one parse of each file (sets.json alone is ~94 KB).
//
// Safe for the whole session by construction: router.js skips the snapshot layer
// entirely when forceRefresh is set, and clearCache() ends in location.reload() —
// so there is no path that expects a *changed* snapshot without a fresh document.
// Promises (not results) are cached, which also collapses concurrent reads of the
// same file into one request.
const memo = new Map();

async function loadJSON(file) {
  let hit = memo.get(file);
  if (!hit) {
    // A rejection must not be memoized: a transient failure would otherwise
    // permanently disable the snapshot layer for the rest of the session.
    hit = (async () => {
      const res = await fetch(new URL(file, DATA_BASE), { cache: 'no-cache' });
      if (!res.ok) throw new Error(`snapshot ${file}: HTTP ${res.status}`);
      return res.json();
    })();
    hit.catch(() => { if (memo.get(file) === hit) memo.delete(file); });
    memo.set(file, hit);
  }
  return hit;
}

/**
 * Set metadata from the snapshot, IF it has a release date for every set asked
 * about. Throws when missing/placeholder/uncovered → live fallback.
 *
 * The date coverage check is the important half. The build fills a date for every
 * set it can (tools/build-data.mjs), but a set TCGdex adds between two builds has
 * none. Returning the snapshot regardless would put every such set on the
 * '1999/01/01' fallback in buildSetsMap: one giant fake era, in arbitrary order.
 * A gap is therefore a miss.
 *
 * @param {string[]} [setIds] set ids the caller needs dates for
 */
export async function getSetMeta(setIds = []) {
  const snap = await loadJSON('sets.json');
  if (!snap || !snap.builtAt || !snap.names || !Object.keys(snap.names).length) {
    throw new Error('set-meta snapshot not built yet');
  }
  const dates = snap.dates || {};
  const missing = [...new Set(setIds)].filter(id => id && !dates[id]);
  if (missing.length) {
    throw new Error(`set-meta snapshot has no release date for ${missing.length} set(s): ${missing.slice(0, 5).join(', ')}`);
  }
  // `counts` is NOT part of the coverage check, deliberately. It arrived with single-set
  // mode, so every snapshot built before it lacks the key entirely — treating that as a
  // miss would send every existing deployment to the live API for set names it already
  // has. An absent count degrades to "no denominator shown", which is cosmetic.
  // setSeries/series/lang get the same "absent is not a miss" treatment as counts: they
  // arrived with the set picker, so every snapshot built before it lacks them entirely,
  // and treating that as a miss would send a deployment that already has perfectly good
  // names and dates to the live API for nothing. Absent degrades the picker to one
  // ungrouped English list — which is exactly what it was before.
  return {
    names: snap.names || {}, dates,
    symbols: snap.symbols || {}, logos: snap.logos || {}, counts: snap.counts || {},
    setSeries: snap.setSeries || {}, series: snap.series || {}, lang: snap.lang || {},
  };
}

/**
 * data/sets.json's set id → CDN series map, or {} when there is no snapshot. Never
 * throws: the live card index uses it only to build image URLs for cards TCGdex lists
 * without one, and must not fail for want of it.
 */
export async function getSetSeries() {
  try { return (await loadJSON('sets.json'))?.setSeries || {}; }
  catch { return {}; }
}

// ── PER-POKÉMON SHARDS ────────────────────────────────────────────────────────
//
// Coverage is per Pokémon: serve what the shards have, report what they don't, and let
// the router fetch only the remainder — a visitor tracking three Pokémon, two of them
// pre-built, fetches one live.
//
// data/index.json is the authoritative name → filename map. Probing shard URLs by
// re-deriving the slug in the client was rejected: it fills a non-prebuilt visitor's
// console with 404s, it cannot distinguish "not built" from "network down", and it
// cannot resolve collisions ("Nidoran♀" and "Nidoran♂" slugify identically).

// Memoizes the ABSENCE of the index too. loadJSON deliberately does not cache
// rejections, so without this every call would re-request a 404 on a deployment
// that ships no snapshot. No index means no snapshot: the router goes live.
let indexProbe = null;
function loadIndex() {
  if (!indexProbe) indexProbe = loadJSON('index.json').then(i => (i?.pokemon ? i : null), () => null);
  return indexProbe;
}

/**
 * EN cards for whichever of `names` the snapshot covers.
 * @returns {Promise<{cards:Array, covered:string[], missing:string[]}>}
 * @throws when nothing at all is covered → the router goes fully live, as before.
 */
export async function getCardsPartial(names) {
  const index = await loadIndex();
  if (!index) throw new Error('no snapshot index');

  const known = names.filter(n => index.pokemon[n]);
  if (!known.length) throw new Error('snapshot covers none of the requested Pokémon');

  const loaded = await Promise.all(known.map(async n => {
    // A single missing shard marks just that Pokémon missing; it must not fail the call.
    try { return { n, shard: await loadJSON(`cards/${index.pokemon[n]}.json`) }; }
    catch { return { n, shard: null }; }
  }));

  const cards = [], covered = [];
  for (const { n, shard } of loaded) {
    if (!shard?.builtAt || !Array.isArray(shard.cards)) continue;
    covered.push(n);
    cards.push(...shard.cards);
  }
  if (!covered.length) throw new Error('no usable card shards');
  return { cards, covered, missing: names.filter(n => !covered.includes(n)) };
}

/** Raw JP entries for whichever of `names` the snapshot covers. Same contract. */
export async function getJpRawPartial(names) {
  const index = await loadIndex();
  if (!index) throw new Error('no snapshot index');

  const known = names.filter(n => index.pokemon[n]);
  if (!known.length) throw new Error('JP snapshot covers none of the requested Pokémon');
  const loaded = await Promise.all(known.map(async n => {
    try { return { n, shard: await loadJSON(`jp/${index.pokemon[n]}.json`) }; }
    catch { return { n, shard: null }; }
  }));
  const data = [], covered = [];
  for (const { n, shard } of loaded) {
    if (!shard?.builtAt || !Array.isArray(shard.jpCardsData)) continue;
    covered.push(n);
    data.push(...shard.jpCardsData);
  }
  if (!covered.length) throw new Error('no usable JP shards');
  return { data, covered, missing: names.filter(n => !covered.includes(n)) };
}

export const snapshot = { getSetMeta, getSetSeries, getCardsPartial, getJpRawPartial };
