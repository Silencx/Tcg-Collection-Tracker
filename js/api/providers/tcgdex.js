// =============================================================================
// providers/tcgdex.js — PRIMARY provider (master card index + set metadata).
//
// Live facts (verified 2026-06-11, see rebuild brief — do not re-verify here):
//   Base https://api.tcgdex.net/v2/{lang}/… — keyless, CORS-open, fast.
//   /{lang}/cards?name=X  → [{ id, localId, name, image }]  (contains-match on the
//                           LOCALIZED name; image may be absent on list items).
//   /{lang}/sets          → [{ id, name, releaseDate, symbol, logo, cardCount }].
//   /{lang}/cards/{id}    → full detail incl. variants {normal,reverse,holo,
//                           firstEdition,wPromo}. Old-era variants unreliable.
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

const API = 'https://api.tcgdex.net/v2';

// Every serie lookup in this file goes through tcgdexSerieSegment — the id-slicing rule
// it falls back to is wrong for 48 of the sets that carry art, and getting it wrong
// yields 404 image URLs and silently skipped variant data. See that function.
const serieOf = setId => tcgdexSerieSegment(setId);

// Split a card id "sv05-163" → { setId:"sv05", localId:"163" }.
function splitId(id) {
  const i = id.lastIndexOf('-');
  return i < 0 ? { setId: id, localId: '' } : { setId: id.slice(0, i), localId: id.slice(i + 1) };
}

// Construct an EN asset base from a card id, for when the list omits `image`.
// Format matches what buildSetsMap's TCGdex branch parses: /en/{serie}/{setId}/{localId}.
function imageBaseFromId(id) {
  const { setId, localId } = splitId(id);
  return tcgdexAssetBase('en', serieOf(setId), setId, localId);
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

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does `cardName` name this species, as a whole word?
 *
 * `?name=` is a CONTAINS match (see the header note), so querying "Mew" also
 * returns every Mewtwo, Mewtwo-EX and Mew & Mewtwo-GX card. Requiring the query
 * to sit between non-alphanumerics keeps genuine cameos — "Seedot & Nuzleaf-GX"
 * still counts for both Seedot and Nuzleaf, which the README treats as a feature
 * — while "Mewtwo" stops answering to "Mew".
 *
 * Hand-rolled boundaries rather than `\b`: names ending in a non-word character
 * (Nidoran♀, Farfetch'd) get no `\b` there at all, so `\bNidoran♀\b` could never
 * match.
 */
export function namesSpecies(cardName, species) {
  if (typeof cardName !== 'string' || !cardName) return false;
  const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(species)}(?![A-Za-z0-9])`, 'gi');
  for (let m = re.exec(cardName); m; m = re.exec(cardName)) {
    // A hyphen straight after the match is ambiguous. It either starts a card
    // suffix — "Nuzleaf-GX", same Pokémon, keep — or continues a DIFFERENT
    // species' name: "Porygon-Z" is not Porygon, "Kommo-o" is not Kommo,
    // "Ho-Oh" is not Ho. Suffix tags are all-caps and at least two letters;
    // species continuations ("Z", "o", "Oh") are not, which separates the two
    // cases without needing a hardcoded suffix list. An unrecognised all-caps
    // tag is kept, matching this provider's never-a-shorter-list rule.
    const hyphen = /^-([A-Za-z]+)/.exec(cardName.slice(m.index + m[0].length));
    if (hyphen && !(hyphen[1].length >= 2 && hyphen[1] === hyphen[1].toUpperCase())) continue;
    return true;
  }
  return false;
}

/**
 * EN master card index for the given Pokémon names.
 * @returns {Promise<Array<{id:string,name:string,species:string,image:string,localId:string}>>}
 *   `name` is the card's REAL printed name (drives the poke-divider grouping);
 *   `species` is the queried Pokémon it matched (keys the native-name tables and
 *   the snapshot's coverage filter). `image` is ALWAYS a valid asset base url
 *   (filled from the id if the list omits it), so no card is ever dropped for a
 *   missing image.
 */
export async function getCards(names, { signal, withVariants = true } = {}) {
  const out = [];
  const seen = new Set();
  // One request per name, in parallel — they are independent, and awaiting them
  // in sequence made a multi-Pokémon list take the SUM of its round trips.
  // Results are consumed in the original order so `seen` still resolves a shared
  // cameo card to the first-listed Pokémon deterministically.
  const lists = await Promise.all(
    names.map(name => getJSON(`${API}/en/cards?name=${encodeURIComponent(name)}`, signal))
  );
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const data = lists[i];
    const list = Array.isArray(data) ? data : (data?.data || []);
    for (const c of list) {
      if (!c?.id || seen.has(c.id)) continue;
      if (!namesSpecies(c.name, name)) continue;   // drop the contains-match false positives
      seen.add(c.id);
      out.push({
        id: c.id,
        // Keep the API's own name. Overwriting it with the query term made every
        // Mewtwo card claim to be "Mew", and erased the real names of cameo cards.
        name: c.name,
        species: name,
        image: c.image || imageBaseFromId(c.id),
        localId: c.localId != null ? String(c.localId) : splitId(c.id).localId,
      });
    }
  }
  if (!out.length) throw new Error('TCGdex returned no cards');

  // Variant flags (reverse/holo/1st-ed/…) live only on the card DETAIL endpoint and
  // are only trustworthy on modern eras. Fetch detail for just those cards and
  // attach `variants`; failures simply leave it absent (never drops the card).
  if (withVariants) {
    const modern = out.filter(c => eraSupportsVariants(serieOf(splitId(c.id).setId)));
    await pooledForEach(modern, DETAIL_CONCURRENCY, async c => {
      try {
        const d = await getJSON(`${API}/en/cards/${c.id}`, signal);
        if (d?.variants) c.variants = d.variants;
      } catch { /* no variant data for this card — leave it absent */ }
    });
  }
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
 * @returns {Promise<{names,dates,symbols,logos,counts,setSeries,series,lang}>}
 *   names:     { langCode: { setId: localizedName } } — same shape as legacy.fetchAllSetNames
 *   dates:     { setId: 'YYYY-MM-DD' }                — release dates (drives set/era sort)
 *   symbols:   { setId: symbolUrl }                   — set symbols (.webp), small mono glyph
 *   logos:     { setId: logoUrl }                     — set logos (.webp), the wordmark art
 *   counts:    { setId: officialCardCount }           — the DENOMINATOR for single-set mode
 *   setSeries: { setId: seriesId }                    — language-INVARIANT (0 disagreements measured)
 *   series:    { langCode: [{id,name,date}] }         — newest first, for picker grouping
 *   lang:      { langCode: {dates,counts,noCards} }   — ONLY values that differ from the flat maps
 *
 * SHAPE NOTE: dates/symbols/logos/counts stay FLAT `{setId: value}` maps keyed on the
 * set id, exactly as before, and are now the UNION across languages rather than EN only.
 * That is deliberate and is what keeps this change additive: masterset.js, tms.js,
 * dashboard.js and snapshot.js's coverage check all look ids up in them, and every id
 * they looked up before still resolves to the same value. Only the zh-Hant/th/id
 * namespace — which shares no ids with English — needs per-language values, and those
 * go in `lang` as sparse overrides rather than duplicating all five maps nine times
 * (measured: 88 KB this way, 275 KB duplicated, on a file fetched every boot).
 */
export async function getSetMeta({ signal, setIds = [], allEnSets = false, withSeries = true } = {}) {
  const eligible = LANGUAGES.filter(l => l.hasSetsApi && l.apiCode);
  const results = await Promise.allSettled(
    eligible.map(l => getJSON(`${API}/${l.apiCode}/sets`, signal).then(s => ({ l, s })))
  );
  const names = {}, dates = {}, symbols = {}, logos = {}, counts = {};
  const setSeries = {}, series = {}, lang = {};
  // EN is the reference namespace: a value differs "from the flat map" relative to it.
  const enCounts = {};
  results.forEach((r, i) => {
    const code = eligible[i].code;
    const isEn = eligible[i].apiCode === 'en';
    names[code] = {};
    if (r.status !== 'fulfilled') return;
    const arr = Array.isArray(r.value.s) ? r.value.s : [];
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
      if (isEn) { enCounts[set.id] = c; counts[set.id] = c; }
      else if (!counts[set.id]) counts[set.id] = c;
      // cardCount genuinely differs per language for 61 ids (A1 is 226/286 EN vs
      // 226/226 DE), so a language whose count disagrees with EN records an override.
      if (!isEn && enCounts[set.id] && !sameCount(enCounts[set.id], c)) {
        (lang[code] ||= {}).counts = { ...(lang[code].counts || {}), [set.id]: c };
      }
    }
  });

  if (withSeries) await sweepSeries(eligible, signal, { names, symbols, logos, setSeries, series });

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
        const s = await getJSON(`${API}/${l.apiCode}/sets/${id}`, signal);
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
  return { names, dates, symbols, logos, counts, setSeries, series, lang };
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
async function sweepSeries(eligible, signal, { names, symbols, logos, setSeries, series }) {
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
 * Emits the SAME card shape as getCards, deliberately: single-set mode reuses the
 * master-set tile renderer, and a second shape would mean a second renderer.
 * `species` is the card's own name here — there is no queried Pokémon to attribute it
 * to — which is also what makes the per-Pokémon dividers group sensibly.
 *
 * @param {string} [opts.lang] LANGUAGES `code` to fetch in. zh-Hant/th/id sets exist
 *   ONLY in their own language's namespace — /en/sets/SC2b is a 404 — so the caller
 *   must pass the language the set actually belongs to.
 * @returns {Promise<{cards:Array, set:{id,name,releaseDate,symbol,logo,serie,count}}>}
 */
// withVariants defaults FALSE here, unlike getCards. Variants live only on the card
// DETAIL endpoint, so they cost one request per card: for the master index that is a
// handful (the cards matching your Pokémon), but for a whole set it is the whole set —
// 162 extra requests for Temporal Forces, on every entry into the mode. The set view is
// a completion checklist; a reverse-holo badge is not worth turning a one-request page
// into a 163-request one. Callers that want them can still ask.
export async function getSetCards(setId, { signal, withVariants = false, lang = 'en' } = {}) {
  const def = LANGUAGES.find(l => l.code === lang);
  const apiCode = def?.apiCode || 'en';
  const cdnLang = def?.code || 'en';
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
      image: c.image || tcgdexAssetBase(cdnLang, serie, setId, splitId(c.id).localId),
      localId: c.localId != null ? String(c.localId) : splitId(c.id).localId,
    }));

  // Fed the REAL serie: the id-guess silently excluded swshp, sve, svp, mfb, mee, mep,
  // cel25 and fut2020 from variant fetching even though they are modern-era sets.
  if (withVariants && eraSupportsVariants(serie)) {
    await pooledForEach(cards, DETAIL_CONCURRENCY, async c => {
      try {
        const d = await getJSON(`${API}/${apiCode}/cards/${c.id}`, signal);
        if (d?.variants) c.variants = d.variants;
      } catch { /* no variant data for this card — leave it absent */ }
    });
  }

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
      lang: cdnLang,
    },
  };
}

// Variant data is only trustworthy on modern eras (old-era TCGdex variants are wrong
// — e.g. ex16-97 reports holo:false), so getCards only fetches/attaches variants for
// these series. This predicate is the gate.
const VARIANT_ERAS = new Set(['swsh', 'sv', 'me']);
export function eraSupportsVariants(series) { return VARIANT_ERAS.has(series); }

export const tcgdex = { getCards, getSetCards, getSetMeta, eraSupportsVariants, namesSpecies, readCardCount };
