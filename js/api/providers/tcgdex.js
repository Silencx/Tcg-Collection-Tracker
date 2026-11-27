// =============================================================================
// providers/tcgdex.js — PRIMARY provider (master card index + set metadata).
//
// Live facts (verified 2026-06-11):
//   Base https://api.tcgdex.net/v2/{lang}/… — keyless, CORS-open, fast.
//   /{lang}/cards?name=X  → [{ id, localId, name, image }]  (contains-match on the
//                           LOCALIZED name; image may be absent on list items).
//   /{lang}/cards?dexId=eq:N → the same items, for cards whose Pokédex numbers include
//                           N. The `eq:` matters: a bare ?dexId=29 is a contains-match
//                           on the digits and also answers 129, 229, 295… (2026-11-26).
//   /{lang}/sets          → [{ id, name, releaseDate, symbol, logo, cardCount }].
//   /{lang}/cards/{id}    → full detail incl. variants {normal,reverse,holo,
//                           firstEdition,wPromo} + variants_detailed (one entry per print).
//   /graphql              → the same full cards in BULK; used for variants (see below).
//   Images: {image}/low.webp or /high.png.
//
// This provider emits cards in the exact shape ui/masterset.buildSetsMap already
// consumes on its TCGdex branch: { id, name, image } where `image` is a valid
// asset BASE url (no extension). EN is the MASTER INDEX; other languages are
// hydrated downstream by renderBySet building per-language image URLs (so the
// full checklist always shows; missing-language images simply fail to load and
// are hidden — never a shorter list).
// =============================================================================

import { LANGUAGES } from '../../config.js';
import { tcgdexAssetBase, tcgdexSerieSegment } from '../images.js';
import { listedImageBase } from '../card-image-model.js';
import { SET_LIST_QUIRKS, setListFor } from '../set-list-model.js';
import { namesSpecies, cardIsSpecies, readDexIds } from '../match-model.js';
import { normalizeVariants } from '../variants.js';

// The name rule moved to match-model.js with the Pokédex-number rule; re-exported for
// the callers that have always imported it from here.
export { namesSpecies };

const API = 'https://api.tcgdex.net/v2';

// Every serie lookup in this file goes through tcgdexSerieSegment — the id-slicing rule
// it falls back to is wrong for 48 of the sets that carry art, and getting it wrong
// yields 404 image URLs and silently skipped variant data. See that function.

// Split a card id "sv05-163" → { setId:"sv05", localId:"163" }.
function splitId(id) {
  const i = id.lastIndexOf('-');
  return i < 0 ? { setId: id, localId: '' } : { setId: id.slice(0, i), localId: id.slice(i + 1) };
}

// Construct an EN asset base from a card id, for when the list omits `image`.
// Format matches what buildSetsMap parses: /en/{serie}/{setId}/{localId}. The serie
// comes from `setSeries` (data/sets.json's map); the id-slicing guess is only the last
// resort for a set the map does not know yet. buildSetsMap also groups the card's era
// by this segment, so a wrong guess filed the card under a stray era of its own.
function imageBaseFromId(id, setSeries) {
  const { setId, localId } = splitId(id);
  return tcgdexAssetBase('en', tcgdexSerieSegment(setId, setSeries), setId, localId);
}

async function getJSON(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`);
  return r.json();
}

// Simultaneous card-detail requests. Previously every modern card fired at once:
// a popular Pokémon meant hundreds of parallel requests, which the browser queues
// six-per-host anyway while TCGdex sees a burst that looks like abuse.
const DETAIL_CONCURRENCY = 6;

/**
 * Run `worker` over `items` with at most `limit` in flight — a fixed pool of
 * workers pulling from a shared cursor. `worker` must handle its own failures;
 * one rejection aborts the whole pool.
 */
export async function pooledForEach(items, limit, worker) {
  let cursor = 0;
  const runner = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
}

// ── PRINT VARIANTS (GraphQL) ──────────────────────────────────────────────────
// Variants live only on the FULL card object. REST serves that one card per request;
// GraphQL serves it in bulk: one query covers a whole Pokémon or a whole set (measured
// 2026-10-22: Pikachu, 246 cards, 0.2 s, 36 KB — REST needed 246 detail calls).
// Same host, keyless, CORS-open. The traps, all measured:
//   · page size is `itemsPerPage`; `count` is silently ignored and you get 100.
//   · `filters` match by substring ("Mew" also finds "Mewtwo", "sv05-" every sv05 card),
//     so callers merge results by exact id and ignore the rest.
//   · never select set{serie}: it is null on some sets, and a null in a non-null field
//     makes GraphQL drop the WHOLE card from the answer.
//   · `dexId` is a nullable list, null on Trainers and Energy; `filters:{dexId:N}` is an
//     exact match on one of the numbers (2026-11-26).
const GQL = `${API}/graphql`;
const GQL_PAGE = 1000;
const GQL_MAX_PAGES = 5;
const GQL_QUERY = 'query($f:CardsFilters,$p:Int!,$k:Int){ cards(filters:$f, pagination:{page:$p,itemsPerPage:$k}){ '
  + 'id localId name suffix rarity category trainerType dexId set{id} '
  + 'variants{normal reverse holo firstEdition wPromo} '
  + 'variants_detailed{type subtype stamp size foil} } }';

// Variants are a footer badge; the card list is the page. Give the variant step its own
// budget inside the caller's, so a slow GraphQL answer costs the badges, never the cards
// (the router aborts the WHOLE call at 8 s, and the card index has no fallback).
const VARIANT_BUDGET_MS = 4000;
function budgetSignal(signal) {
  if (typeof AbortSignal === 'undefined' || !AbortSignal.timeout || !AbortSignal.any) return signal;
  const t = AbortSignal.timeout(VARIANT_BUDGET_MS);
  return signal ? AbortSignal.any([signal, t]) : t;
}

async function gqlCards(filters, signal) {
  const out = [];
  for (let page = 1; page <= GQL_MAX_PAGES; page++) {
    const r = await fetch(GQL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: GQL_QUERY, variables: { f: filters, p: page, k: GQL_PAGE } }),
      signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} — ${GQL}`);
    const j = await r.json();
    const list = j?.data?.cards;
    if (!Array.isArray(list)) throw new Error(`TCGdex GraphQL: ${j?.errors?.[0]?.message || 'no data'}`);
    out.push(...list.filter(Boolean));
    if (list.length < GQL_PAGE) break;
  }
  return out;
}

// A whole-GraphQL outage must not turn into the old one-request-per-card storm: that is
// hundreds of calls for a popular Pokémon, which blows the router's 8 s budget and
// demotes TCGdex for the session. Only a handful of stragglers go to REST.
const REST_VARIANT_FALLBACK_MAX = 30;

/**
 * Attach `variants` (see variants.normalizeVariants) to `cards` in place. GraphQL first,
 * one query per filter; then REST detail for the few cards it did not return. Best
 * effort: a card with no data keeps no `variants` and is never dropped.
 * @param {Map<string, number[]>} [dexOut] filled with the Pokédex numbers of every card
 *   an answer covered ([] for a card that has none); a card missing from it is unknown
 */
async function attachVariants(cards, filters, signal, apiCode = 'en', dexOut = null) {
  if (!cards.length) return;
  const sig = budgetSignal(signal);
  const byId = new Map(cards.map(c => [c.id, c]));
  const note = d => { if (dexOut && byId.has(d.id) && !dexOut.has(d.id)) dexOut.set(d.id, readDexIds(d.dexId)); };
  const results = await Promise.allSettled(filters.map(f => gqlCards(f, sig)));
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const d of r.value) {
      note(d);
      const c = byId.get(d.id);
      if (!c || c.variants) continue;
      const v = normalizeVariants(d);
      if (v) c.variants = v;
    }
  }
  const rest = cards.filter(c => !c.variants);
  if (!rest.length || rest.length > REST_VARIANT_FALLBACK_MAX) return;
  await pooledForEach(rest, DETAIL_CONCURRENCY, async c => {
    try {
      const d = await getJSON(`${API}/${apiCode}/cards/${c.id}`, sig);
      if (d?.id) note(d);
      const v = normalizeVariants(d);
      if (v) c.variants = v;
    } catch { /* no variant data for this card — leave it absent */ }
  });
}

// GraphQL filters for one Pokémon: by name, and by Pokédex number when it is known. The
// number finds the cards the name cannot ("Nidoran ♀", "Farfetch’d", Tag Teams); the name
// finds the ones with no number (Trainers, the newest set).
const pokemonFilters = (names, dexByName) => (names || []).flatMap(name => {
  const dex = dexByName?.get(name);
  return Number.isInteger(dex) ? [{ name }, { dexId: dex }] : [{ name }];
});

/**
 * Print variants for cards that came from somewhere else (the catalogue, data/cat/),
 * looked up by Pokémon like getCards does. In place, best effort, never throws.
 * @param {Map<string, number>} [opts.dexByName] Pokémon name → National Dex number
 */
export async function getVariants(cards, names, { signal, dexByName = null } = {}) {
  await attachVariants(cards, pokemonFilters(names, dexByName), signal);
}

const asList = data => (Array.isArray(data) ? data : (data?.data || []));

/**
 * EN master card index for the given Pokémon names.
 * @returns {Promise<Array<{id:string,name:string,species:string,image:string,localId:string}>>}
 *   `name` is the card's REAL printed name (drives the poke-divider grouping);
 *   `species` is the queried Pokémon it matched (keys the native-name tables and
 *   the snapshot's coverage filter). `image` is ALWAYS a valid asset base url
 *   (filled from the id if the list omits it), so no card is ever dropped for a
 *   missing image.
 * @param {object} [opts]
 * @param {Object<string,string>|null} [opts.setSeries] set id → CDN series (data/sets.json),
 *   used for the image base of a card the list returns without one
 * @param {Map<string, number>|null} [opts.dexByName] every Pokémon's name → National Dex
 *   number. With it, a card numbered for the Pokémon counts as well as one named for it
 *   (match-model.js, cardIsSpecies), and a second search by number finds the ones the
 *   name search cannot ("Nidoran ♀", "Farfetch’d"). Without it, the name rule alone.
 */
export async function getCards(names, { signal, withVariants = true, setSeries = null, dexByName = null } = {}) {
  // Per name, in parallel — they are independent, and awaiting them in sequence made a
  // multi-Pokémon list take the SUM of its round trips: the name search, and the exact
  // number search when the number is known. A failed number search costs only what it
  // would have added; a failed name search fails the call, as it always has.
  const found = await Promise.all(names.map(async name => {
    const n = dexByName?.get(name);
    const dex = Number.isInteger(n) ? n : undefined;
    const [byName, byDex] = await Promise.all([
      getJSON(`${API}/en/cards?name=${encodeURIComponent(name)}`, signal),
      dex ? getJSON(`${API}/en/cards?dexId=eq:${dex}`, signal).catch(() => null) : null,
    ]);
    return { name, dex, byName: asList(byName), byDex: byDex ? asList(byDex) : [] };
  }));

  // Every candidate once, whichever search and Pokémon found it. `numbered`: the number
  // search found it, so its numbers include this Pokémon's.
  const pool = new Map();
  const keep = c => {
    if (!pool.has(c.id)) {
      pool.set(c.id, {
        id: c.id,
        // Keep the API's own name. Overwriting it with the query term made every
        // Mewtwo card claim to be "Mew", and erased the real names of cameo cards.
        name: c.name,
        image: c.image || imageBaseFromId(c.id, setSeries),
        localId: c.localId != null ? String(c.localId) : splitId(c.id).localId,
      });
    }
  };
  for (const f of found) {
    f.ids = [];
    const mine = new Set();
    for (const c of f.byName) {
      // namesSpecies drops the contains-match false positives (Mewtwo for Mew).
      if (!c?.id || mine.has(c.id) || !namesSpecies(c.name, f.name)) continue;
      keep(c); mine.add(c.id); f.ids.push(c.id);
    }
    f.numbered = new Set();
    for (const c of f.byDex) {
      if (!c?.id) continue;
      f.numbered.add(c.id);
      if (mine.has(c.id)) continue;
      keep(c); mine.add(c.id); f.ids.push(c.id);
    }
  }
  if (!pool.size) throw new Error('TCGdex returned no cards');

  // Every era now: TCGdex fixed the old-era data (ex16-97 reports holo:true today), and
  // the one remaining hole — BW/XY/SM reverse holos — is filled in normalizeVariants.
  // The same answers carry each card's Pokédex numbers.
  const dexIds = new Map();
  if (withVariants) await attachVariants([...pool.values()], pokemonFilters(names, dexByName), signal, 'en', dexIds);

  // Consumed in the original order, so a shared cameo card resolves to the first-listed
  // Pokémon deterministically.
  const out = [];
  const seen = new Set();
  for (const f of found) {
    for (const id of f.ids) {
      if (seen.has(id)) continue;
      const c = pool.get(id);
      // A card the number search found is checked against its name (cardIsSpecies). Its
      // full numbers come from GraphQL; without that answer, it is known only to carry
      // this Pokémon's.
      const ids = dexIds.get(id) ?? (f.numbered.has(id) ? [f.dex] : []);
      if (!cardIsSpecies({ name: c.name, dexIds: ids }, f.name, dexByName)) continue;
      seen.add(id);
      const card = { id: c.id, name: c.name, species: f.name, image: c.image, localId: c.localId };
      if (c.variants) card.variants = c.variants;
      out.push(card);
    }
  }
  if (!out.length) throw new Error('TCGdex returned no cards');
  return out;
}

/**
 * Set metadata across all eligible languages, in one pass.
 * @param {object} [opts]
 * @param {string[]} [opts.setIds] set ids whose release dates we need; any not
 *   carrying a date from the /sets list are filled via a bounded /sets/{id} fetch.
 * @param {boolean} [opts.allEnSets] fill dates for EVERY EN set instead of just
 *   `setIds`. Used by tools/build-data.mjs so the committed snapshot carries a
 *   complete date map: snapshot.getSetMeta rejects a partial one (a missing date
 *   collapses a set to the 1999 sort fallback), so a snapshot built from only the
 *   demo Pokémon's sets was a guaranteed miss for everybody else. Not for browser
 *   use — it costs one request per set that the list omitted a date for.
 * @param {boolean} [opts.withSeries] also sweep /{lang}/series to build the set→series
 *   map and the per-language series lists the single-set picker groups by. 116 requests,
 *   so it is on by default for the build and off for the browser, which reads them from
 *   the committed snapshot.
 * @param {(langCode:string, setId:string, set:object)=>void} [opts.onDetail] called with
 *   every /sets/{id} answer the sweep below reads, so the build can use the card lists it
 *   already paid for (tools/lib/coverage.mjs) without a second sweep. Nothing it returns
 *   or throws reaches the result.
 * @returns {Promise<{names,dates,symbols,logos,counts,setSeries,series,lang}>}
 *   names:     { langCode: { setId: localizedName } }
 *   dates:     { setId: 'YYYY-MM-DD' }                — release dates (drives set/era sort)
 *   symbols:   { setId: symbolUrl }                   — set symbols (.webp), small mono glyph
 *   logos:     { setId: logoUrl }                     — set logos (.webp), the wordmark art
 *   counts:    { setId: officialCardCount }           — the DENOMINATOR for single-set mode
 *   setSeries: { setId: seriesId }                    — language-INVARIANT (0 disagreements measured)
 *   series:    { langCode: [{id,name,date}] }         — newest first, for picker grouping
 *   lang:      { langCode: {dates,counts,noCards} }   — ONLY values that differ from the flat maps
 *   cleaned:   { langCode: {copies,twins,repeats,missing} } — what set-list-model.js left
 *              out of a language's list (zh-Hans), for the build's log; not written out
 *
 * SHAPE NOTE: dates/symbols/logos/counts stay FLAT `{setId: value}` maps keyed on the
 * set id, exactly as before, and are now the UNION across languages rather than EN only.
 * That is deliberate and is what keeps this change additive: masterset.js, tms.js,
 * dashboard.js and snapshot.js's coverage check all look ids up in them, and every id
 * they looked up before still resolves to the same value. Only the Asian namespaces
 * (zh-Hant/th/id/ko/zh-Hans), which share no ids with English, need per-language
 * values, and those go in `lang` as sparse overrides rather than duplicating all five
 * maps per language (measured: 88 KB this way, 275 KB duplicated, on a file fetched
 * every boot, with nine languages).
 */
export async function getSetMeta({ signal, setIds = [], allEnSets = false, withSeries = true, onDetail } = {}) {
  const eligible = LANGUAGES.filter(l => l.hasSetsApi && l.apiCode);
  const results = await Promise.allSettled(
    eligible.map(l => getJSON(`${API}/${l.apiCode}/sets`, signal).then(s => ({ l, s })))
  );
  const names = {}, dates = {}, symbols = {}, logos = {}, counts = {};
  const setSeries = {}, series = {}, lang = {};
  // Each language's /sets answer by API code: cleaning zh-cn's list needs zh-tw's next
  // to it (api/set-list-model.js).
  const listOf = apiCode => {
    const r = results[eligible.findIndex(l => l.apiCode === apiCode)];
    return r?.status === 'fulfilled' && Array.isArray(r.value.s) ? r.value.s : null;
  };
  // What the cleaning left out, per language, for the build's log. A cleaned language is
  // also "closed": the series sweep adds none of its sets, or the copies would be back.
  const cleaned = {}, closed = new Set();
  results.forEach((r, i) => {
    const code = eligible[i].code;
    const isEn = eligible[i].apiCode === 'en';
    names[code] = {};
    if (r.status !== 'fulfilled') return;
    const { sets: arr, ...left } = setListFor(eligible[i].apiCode, listOf);
    if (SET_LIST_QUIRKS[eligible[i].apiCode]) { closed.add(code); cleaned[code] = left; }
    for (const set of arr) {
      if (!set?.id) continue;
      names[code][set.id] = set.name || set.id;
      if (set.releaseDate && !dates[set.id]) dates[set.id] = set.releaseDate;
      // Symbols live under /univ/ and are language-neutral (0 disagreements measured),
      // so first writer wins. Logos are per-language but overwhelmingly EN-only; taking
      // the first non-EN one for a set English does not have is strictly better than
      // nothing.
      if (set.symbol && !symbols[set.id]) symbols[set.id] = assetUrl(set.symbol);
      // The set's wordmark art, distinct from the symbol glyph. TCGdex returns both on
      // the same list entry, so this is free — and it is what makes a set recognisable
      // at a glance where the mono symbol does not.
      if (set.logo && !logos[set.id]) logos[set.id] = assetUrl(set.logo);
      // cardCount.official is the printed set size (33/33), cardCount.total includes
      // secret rares. "Complete this expansion" means the official run, so that is the
      // denominator; total is kept because the secrets are collectable too and the
      // picker shows both when they differ.
      const c = readCardCount(set.cardCount);
      if (!c) continue;
      // EN sweeps first, so the flat map holds English's count for every set English
      // has, and the first listing language's for the rest (TW's, for most Asian ids).
      if (!counts[set.id]) { counts[set.id] = c; continue; }
      // cardCount genuinely differs per language (A1 is 226/286 EN vs 226/226 DE; SV4M
      // is 66/66 TW vs 66/95 KR), so a language whose count disagrees with the flat
      // map's records an override. Compared with English's alone, TH, ID and KR showed
      // TW's count for the ids they share with it.
      if (!isEn && !sameCount(counts[set.id], c)) {
        (lang[code] ||= {}).counts = { ...(lang[code].counts || {}), [set.id]: c };
      }
    }
  });

  if (withSeries) await sweepSeries(eligible, signal, { names, symbols, logos, setSeries, series }, closed);

  // The /sets LIST often omits releaseDate (only /sets/{id} carries it), which would
  // collapse every set to the 1999 sort fallback. Fill dates for the sets we actually
  // use via bounded per-set detail calls.
  // Pooled at DETAIL_CONCURRENCY, matching the variant-detail fetch above. This
  // used to be an unbounded Promise.allSettled: one request per set in play, all
  // at once — which for a Pokémon spanning 200 sets is the very fan-out the pool
  // was introduced to stop.
  //
  // BROWSER PATH (allEnSets false): EN only, exactly as before — the caller wants dates
  // for the handful of sets its cards landed in.
  // BUILD PATH (allEnSets true): every language's own ids, because the zh-Hant/th/id
  // namespaces share nothing with English and are reachable only through their own
  // language's endpoint.
  const sweeps = allEnSets
    ? eligible.map(l => ({ l, ids: Object.keys(names[l.code] || {}) }))
    : [{ l: eligible.find(l => l.apiCode === 'en'), ids: [...new Set(setIds)].filter(Boolean) }];

  for (const { l, ids } of sweeps) {
    if (!l) continue;
    const isEn = l.apiCode === 'en';
    // On the browser path, skip ids the list already dated. On the build path every id
    // is fetched: only the detail endpoint carries a date at all (the list never does),
    // and it is also where `serie` and the card list live.
    const need = allEnSets ? ids : ids.filter(id => !dates[id]);
    if (!need.length) continue;
    await pooledForEach(need, DETAIL_CONCURRENCY, async id => {
      try {
        // Encoded: four Korean ids end in "+" (SM1+), which unencoded is a 404.
        const s = await getJSON(`${API}/${l.apiCode}/sets/${encodeURIComponent(id)}`, signal);
        try { onDetail?.(l.code, id, s); } catch { /* a caller's hook never costs the meta */ }
        // First writer wins, and EN sweeps first, so the flat map holds EN's value for
        // every id English has. A later language that DISAGREES records an override
        // rather than overwriting — that is the whole invariant this shape rests on.
        if (s?.releaseDate) {
          if (!dates[id]) dates[id] = s.releaseDate;
          else if (!isEn && dates[id] !== s.releaseDate) {
            (lang[l.code] ||= {}).dates = { ...(lang[l.code].dates || {}), [id]: s.releaseDate };
          }
        }
        if (s?.symbol && !symbols[id]) symbols[id] = assetUrl(s.symbol);
        if (s?.logo && !logos[id]) logos[id] = assetUrl(s.logo);
        // Free: this request is already being made for the date. Some deployments omit
        // cardCount from the /sets LIST but carry it on /sets/{id}.
        const c = readCardCount(s?.cardCount);
        if (c && !counts[id]) counts[id] = c;
        // FALLBACK A for the series map: /series missed this set, but the set detail
        // knows its own serie. Measured to fire 0 times today; cheap insurance against
        // a set added between the two sweeps vanishing from the picker.
        if (s?.serie?.id && !setSeries[id]) setSeries[id] = s.serie.id;
        // TCGdex lists these sets but has no card data for them — 60% of Thai and 70%
        // of Indonesian. Recording it here is free (the response is already in hand) and
        // is what lets the picker render them inert instead of as a dead click.
        //
        // PER LANGUAGE, not global: a set can have a card list in English and none in
        // German, so a single flat list would mark the English one dead too. (It also
        // collected the same id once per language — 288 entries for 146 sets.)
        if (Array.isArray(s?.cards) && s.cards.length === 0) {
          ((lang[l.code] ||= {}).noCards ||= []).push(id);
        }
      } catch { /* a missing date just falls back to the sort default, as before */ }
    });
  }
  return { names, dates, symbols, logos, counts, setSeries, series, lang, cleaned };
}

/** Do two readCardCount results agree? */
function sameCount(a, b) {
  return !!a && !!b && a.official === b.official && a.total === b.total;
}

/**
 * Sweep /{lang}/series and /{lang}/series/{id} into the set→series map and the
 * per-language series lists.
 *
 * This is the DEFINITIVE source: TCGdex's own grouping, with localized series names and
 * a release date per series. It also returns the same name/symbol/logo/cardCount
 * coverage as the /sets list, so it is a strict superset — but the list call is kept
 * because it is one request per language against ~12 here.
 *
 * /{lang}/series arrives ascending by release date, so its index is a valid tiebreaker
 * for series whose own date is missing.
 */
async function sweepSeries(eligible, signal, { names, symbols, logos, setSeries, series }, closed = new Set()) {
  for (const l of eligible) {
    let list;
    try { list = await getJSON(`${API}/${l.apiCode}/series`, signal); }
    catch { series[l.code] = []; continue; }
    if (!Array.isArray(list)) { series[l.code] = []; continue; }

    const order = new Map(list.map((s, i) => [s.id, i]));
    const dated = [];
    await pooledForEach(list, DETAIL_CONCURRENCY, async s => {
      if (!s?.id) return;
      try {
        const d = await getJSON(`${API}/${l.apiCode}/series/${encodeURIComponent(s.id)}`, signal);
        dated.push({ id: s.id, name: s.name || d?.name || s.id, date: d?.releaseDate || null });
        for (const x of (Array.isArray(d?.sets) ? d.sets : [])) {
          if (!x?.id) continue;
          // A cleaned language's sets are its cleaned /sets list (set-list-model.js).
          if (closed.has(l.code) && !names[l.code]?.[x.id]) continue;
          // Language-invariant: measured 0 disagreements across all 9 languages AND
          // against /sets/{id}.serie, so first writer wins is safe.
          if (!setSeries[x.id]) setSeries[x.id] = s.id;
          if (names[l.code] && !names[l.code][x.id]) names[l.code][x.id] = x.name || x.id;
          if (x.symbol && !symbols[x.id]) symbols[x.id] = assetUrl(x.symbol);
          if (x.logo && !logos[x.id]) logos[x.id] = assetUrl(x.logo);
        }
      } catch { dated.push({ id: s.id, name: s.name || s.id, date: null }); }
    });

    // Newest first. Undated series sort last, tiebroken by the list's own order, which
    // is ascending — hence the reversed index comparison.
    dated.sort((a, b) => {
      if (a.date && b.date) return b.date < a.date ? -1 : b.date > a.date ? 1 : 0;
      if (a.date) return -1;
      if (b.date) return 1;
      return (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0);
    });
    series[l.code] = dated;
  }
}

// TCGdex asset fields are extension-less bases ("…/sv05/symbol"); some deployments
// already include one. Adding a second .webp yields a 404, so check before appending.
function assetUrl(base) {
  return /\.(webp|png|jpg)$/i.test(base) ? base : `${base}.webp`;
}

/**
 * TCGdex's cardCount is `{official, total, …}`; some deployments send a bare number.
 * @returns {{official:number,total:number}|null} null when neither form is usable, so a
 *   set with no count is ABSENT from the map rather than present as a fake zero — the
 *   picker renders "—" for absent and "0/0" for a real zero, and those differ.
 */
export function readCardCount(raw) {
  if (typeof raw === 'number' && raw > 0) return { official: raw, total: raw };
  if (!raw || typeof raw !== 'object') return null;
  const official = Number(raw.official) || 0;
  const total = Number(raw.total) || 0;
  if (!official && !total) return null;
  return { official: official || total, total: total || official };
}

/**
 * Every card IN a set, for single-set mode.
 *
 * A genuinely new access path, and the reason it had to be added: every fetch in this
 * app is keyed by POKÉMON NAME (`/en/cards?name=…`), so nothing could answer "what is
 * in this expansion". `/en/sets/{setId}` returns the set with its full `cards` array,
 * which is one request for the whole set — cheaper than the per-name sweep the master
 * index needs.
 *
 * Emits the same card shape as getCards, with one difference: `image` is null for a card
 * TCGdex lists without a scan, instead of a guessed base. Single-set mode reads it to
 * decide whether to request an image at all.
 * `species` is the card's own name here — there is no queried Pokémon to attribute it
 * to — which is also what makes the per-Pokémon dividers group sensibly.
 *
 * @param {string} [opts.lang] LANGUAGES `code` to fetch in. zh-Hant/th/id sets exist
 *   ONLY in their own language's namespace — /en/sets/SC2b is a 404 — so the caller
 *   must pass the language the set actually belongs to.
 * @returns {Promise<{cards:Array, set:{id,name,releaseDate,symbol,logo,serie,count,lang}}>}
 *   `set.lang` is the LANGUAGES `code` the set was fetched in (zh-Hant, not zh-tw).
 */
// withVariants used to default FALSE here: over REST it cost one request per card, 162
// extra for Temporal Forces on every entry into the mode. GraphQL answers the whole set
// in ONE request, so the set view gets its badges too. The print facts come from the EN
// namespace, which shares set ids with every Latin-script language; zh-Hant/th/id ids
// are absent there, so those sets simply get no badges.
export async function getSetCards(setId, { signal, withVariants = true, lang = 'en' } = {}) {
  const def = LANGUAGES.find(l => l.code === lang);
  const apiCode = def?.apiCode || 'en';
  const appLang = def?.code || 'en';
  const s = await getJSON(`${API}/${apiCode}/sets/${encodeURIComponent(setId)}`, signal);
  const list = Array.isArray(s?.cards) ? s.cards : [];
  // An empty `cards` array is a legitimate TCGdex answer, not a transport failure — it
  // is what 60% of Thai and 70% of Indonesian sets return. Name the cause so the caller
  // can say something truthful.
  if (!list.length) throw new Error(`TCGdex has no card list for ${setId} in ${apiCode}`);

  // The response knows its own serie; that beats guessing from the id, which is wrong
  // for 48 of the sets that carry art (see tcgdexSerieSegment).
  const serie = s?.serie?.id || tcgdexSerieSegment(setId);
  const cards = list
    .filter(c => c?.id)
    .map(c => ({
      id: c.id,
      name: c.name || c.id,
      species: c.name || c.id,
      // The listing's own base, or null: a card listed without `image` has no scan on
      // the CDN (card-image-model.js), so there is nothing worth building a URL for.
      // Unlike getCards, where `image` is always a base because buildSetsMap reads the
      // set and era from it.
      image: listedImageBase(c.image),
      localId: c.localId != null ? String(c.localId) : splitId(c.id).localId,
    }));

  if (withVariants) await attachVariants(cards, [{ id: `${setId}-` }], signal, apiCode);

  return {
    cards,
    set: {
      id: s.id || setId,
      name: s.name || setId,
      releaseDate: s.releaseDate || null,
      symbol: s.symbol ? assetUrl(s.symbol) : null,
      logo: s.logo ? assetUrl(s.logo) : null,
      serie: s.serie || { id: serie, name: serie },
      count: readCardCount(s.cardCount),
      lang: appLang,
    },
  };
}

export const tcgdex = { getCards, getSetCards, getSetMeta, getVariants, namesSpecies, readCardCount };
