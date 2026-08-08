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

// Session-lifetime memo, keyed by filename. Every read used to re-fetch AND
// re-parse: buildAll reads all three files, and each TMS popup read all three
// again, so opening five popups meant five more parses of sets.json (47 KB, 214
// set names). A sort flip re-fetched jp.json for nothing.
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
  // Filter on `species` (the Pokémon the card was matched for), NOT `name` —
  // `name` is now the card's real printed name, so a cameo like
  // "Seedot & Nuzleaf-GX" would not equal any requested species. Snapshots built
  // before `species` existed carry only `name`, which held the species then, so
  // fall back to it and keep older data/cards.json readable.
  const cards = (snap.cards || []).filter(c => wanted.has(c.species || c.name));
  if (!cards.length) throw new Error('snapshot empty for requested Pokémon');
  return cards;
}

/**
 * Set metadata from the snapshot, IF it has a release date for every set asked
 * about. Throws when missing/placeholder/uncovered → live fallback.
 *
 * The date coverage check is the important half. `names` and `symbols` are built
 * for every set that exists, but `dates` only covers the sets the build's own
 * Pokémon appear in — currently 20 entries against 214 EN set names. Returning
 * the snapshot regardless would hand back a date-less map for anyone who picked
 * their own Pokémon, and every one of their sets would take the '1999/01/01'
 * fallback in buildSetsMap: one giant fake era, in arbitrary order. A gap is
 * therefore a miss, mirroring the coverage check in getCards above.
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
 * Every card in one set, from the committed shard if it is there.
 *
 * There is no shard for arbitrary sets today — the build only ships the demo Pokémon —
 * so this throws and the router goes live. It exists so the snapshot-first ordering is
 * the same for this path as for every other one, and so shipping per-set shards later
 * is a build change with no app change.
 */
export async function getSetCards(setId) {
  const idx = await loadJSON('index.json').catch(() => null);
  const have = idx && Array.isArray(idx.sets) ? new Set(idx.sets) : null;
  if (!have || !have.has(setId)) throw new Error(`no snapshot shard for set ${setId}`);
  const shard = await loadJSON(`sets/${setId}.json`);
  if (!shard?.cards?.length) throw new Error(`empty snapshot shard for set ${setId}`);
  return { cards: shard.cards, set: shard.set || { id: setId } };
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

// ── PARTIAL HITS ──────────────────────────────────────────────────────────────
//
// The all-or-nothing checks above mean a visitor tracking three Pokémon, two of which
// are pre-built, fetched all three live. The per-Pokémon shards written by
// tools/build-data.mjs fix that: serve what we have, report what we don't, and let the
// router fetch only the remainder.
//
// data/index.json is the authoritative name → filename map. Probing shard URLs by
// re-deriving the slug in the client was rejected: it fills a non-prebuilt visitor's
// console with 404s, it cannot distinguish "not built" from "network down", and it
// cannot resolve collisions ("Nidoran♀" and "Nidoran♂" slugify identically).

// Memoizes the ABSENCE of the index too. loadJSON deliberately does not cache
// rejections, so without this every call would re-request a 404 on a deployment that
// predates sharding.
let indexProbe = null;
function loadIndex() {
  if (!indexProbe) indexProbe = loadJSON('index.json').then(i => (i?.pokemon ? i : null), () => null);
  return indexProbe;
}

/** Back-compat path: treat the monolithic cards.json as a shard covering its own list. */
async function monolithPartial(names) {
  const snap = await loadJSON('cards.json');
  if (!snap || !snap.builtAt) throw new Error('snapshot not built yet');
  const have = new Set(snap.pokemon || []);
  const covered = names.filter(n => have.has(n));
  if (!covered.length) throw new Error('snapshot covers none of the requested Pokémon');
  const wanted = new Set(covered);
  // `species` fallback: data/cards.json built before species existed carries only name.
  const cards = (snap.cards || []).filter(c => wanted.has(c.species || c.name));
  return { cards, covered, missing: names.filter(n => !have.has(n)) };
}

/**
 * EN cards for whichever of `names` the snapshot covers.
 * @returns {Promise<{cards:Array, covered:string[], missing:string[]}>}
 * @throws when nothing at all is covered → the router goes fully live, as before.
 */
export async function getCardsPartial(names) {
  const index = await loadIndex();
  if (!index) return monolithPartial(names);

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
  if (!index) {
    const snap = await loadJSON('jp.json');
    if (!snap || !snap.builtAt) throw new Error('JP snapshot not built yet');
    const have = new Set(snap.pokemon || []);
    const covered = names.filter(n => have.has(n));
    if (!covered.length) throw new Error('JP snapshot covers none of the requested Pokémon');
    const wanted = new Set(covered);
    return {
      data: (snap.jpCardsData || []).filter(e => wanted.has(e.pokemonName)),
      covered,
      missing: names.filter(n => !have.has(n)),
    };
  }

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

export const snapshot = { getCards, getSetCards, getSetMeta, getJpRaw, getCardsPartial, getJpRawPartial };
