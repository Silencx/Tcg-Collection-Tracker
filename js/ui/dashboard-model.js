// =============================================================================
// ui/dashboard-model.js — everything the start page counts, DOM-free.
//
// Same split as filter-pass.js / setnav-index.js / collapse-model.js / notify-model.js
// / hscroll-model.js: the arithmetic lives here so `node --test` can cover it.
//
// WHERE THE NUMBERS COME FROM, and what they deliberately do NOT come from:
//
//   • state.checked — the Master Set checklist. The only honest source for
//     "how much have I collected", because it survives offline, survives a page
//     with nothing rendered, and covers Pokémon that are not currently tracked.
//   • state.tmsIncluded — the True Master Set checklist, counted whole.
//   • data/sets.json — set names and dates.
//
// NOT statChecked/statVisible (module-private to masterset.js and FILTER-scoped —
// they answer "how much of what is on screen right now", not "how much do I own"),
// NOT state.totalCards (counts rendered tiles including hidden ones), and NOT
// state._meta (runtime-only, cleared on every render, and only ever holds the
// currently-rendered Pokémon).
// =============================================================================

/**
 * Split a checklist id into its language badge and TCGdex set id.
 *
 * The normal shape is `${badge}_${setId}-${localId}` — 'EN_sv05-003', 'DE_bw4-2'.
 * The badge ends at the FIRST underscore; the set id ends at the LAST hyphen, because
 * TCGdex local ids are hyphen-free while set ids are not always (`swshp-SWSH001`).
 *
 * THE JP EXCEPTION. Master-Set JP ids are built as `JP_jp_${pokemon}_${set}_${index}`
 * (see fetchAndInjectJPCards) — e.g. 'JP_jp_Seedot_Miracle of the Desert_0'. They come
 * from Bulbapedia, not TCGdex: they carry no TCGdex set id at all, and they embed a
 * render-order ordinal, so two runs can disagree. Applying the last-hyphen rule to them
 * does not fail loudly — it invents a set id out of whatever punctuation the Japanese
 * set name happens to contain. So JP is bucketed explicitly: it counts toward the
 * language histogram and toward the card total, and is excluded from "sets touched".
 *
 * @returns {{badge:string|null, setId:string|null}}
 */
export function parseCardId(id) {
  if (typeof id !== 'string') return { badge: null, setId: null };
  const us = id.indexOf('_');
  if (us <= 0) return { badge: null, setId: null };
  const badge = id.slice(0, us);
  const rest = id.slice(us + 1);
  if (!rest) return { badge, setId: null };
  if (badge === 'JP') return { badge, setId: null };   // see above — never parseable
  const dash = rest.lastIndexOf('-');
  return { badge, setId: dash > 0 ? rest.slice(0, dash) : null };
}

/** Descending by count, then by key, so equal counts render in a stable order. */
function ranked(map) {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Everything the start page displays, from the two checklists plus the Pokémon list.
 *
 * The parameters are msIds/tmsIds rather than the obvious checked/tms because `checked`
 * is a key on the shared `state` object, which makes it a RESERVED bare identifier
 * everywhere under js/** — tools/state-prefix-scan.mjs fails the build on it, and it is
 * right to: a bare `checked` where `state.checked` was meant is a ReferenceError that
 * only shows up at runtime.
 *
 * @param {object}   input
 * @param {string[]} [input.msIds]    state.checked, as an array
 * @param {string[]} [input.tmsIds]   state.tmsIncluded, as an array
 * @param {string[]} [input.setIds]   state.ssChecked, as an array — single-set mode
 * @param {string[]} [input.pokemon]  state.pokemonList
 * @param {object}   [input.setDates] data/sets.json `dates`, for ordering the set list
 */
export function summarise({ msIds = [], tmsIds = [], setIds = [], pokemon = [], setDates = {} } = {}) {
  const byLang = new Map();
  const bySet = new Map();      // setId → { printings, cards:Set<tcgdexCardId> }
  let unplaced = 0;             // JP printings, which belong to no resolvable set

  for (const id of msIds) {
    const { badge, setId } = parseCardId(id);
    if (!badge) continue;                                   // malformed — ignore entirely
    byLang.set(badge, (byLang.get(badge) || 0) + 1);
    if (!setId) { unplaced++; continue; }
    let rec = bySet.get(setId);
    if (!rec) { rec = { printings: 0, cards: new Set() }; bySet.set(setId, rec); }
    rec.printings++;
    // DISTINCT CARDS as well as printings, because they answer different questions and
    // only one of them has a denominator. A set's official card count is a count of
    // CARDS; twelve language badges per card means printings can run 12× higher, so
    // "printings / official" would happily report 400 of 218.
    rec.cards.add(id.slice(id.indexOf('_') + 1));
  }

  const languages = ranked(byLang);
  const sets = [...bySet.entries()]
    .map(([key, r]) => ({ key, count: r.printings, cards: r.cards.size }))
    .sort((a, b) => b.cards - a.cards || b.count - a.count
      || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  // Newest set first, matching the app's own default sort. Sets with no date in
  // sets.json sort last rather than pretending to be from 1970.
  const setsByDate = [...sets].sort((a, b) => {
    const da = setDates[a.key] || '', db = setDates[b.key] || '';
    if (!da && !db) return a.key < b.key ? -1 : 1;
    if (!da) return 1;
    if (!db) return -1;
    return db < da ? -1 : db > da ? 1 : 0;
  });

  return {
    cards: msIds.length,
    // Distinct TCGdex sets. Excludes JP by construction — see parseCardId.
    setsTouched: bySet.size,
    unplaced,
    languages,                       // [{key:'EN', count:65}, …] most-collected first
    topLanguage: languages[0] || null,
    sets,                            // most-collected first
    setsByDate,                      // newest first
    tmsCards: tmsIds.length,
    setCards: setIds.length,
    pokemon: pokemon.length,
    // THREE distinct numbers, never one merged total. The three checklists are
    // independent by design, so the same physical card can be ticked in more than one
    // of them — adding them together would double-count and quietly overstate the
    // collection. See the header comment in setmode.js.
    empty: msIds.length === 0 && tmsIds.length === 0 && setIds.length === 0,
  };
}

/**
 * Bar heights for the per-language breakdown, as percentages of the LARGEST language
 * rather than of the total: with English at 65 and everything else in single figures,
 * share-of-total bars are all invisible together.
 *
 * `share` is the honest proportion, kept alongside for the tooltip — the bar is scaled
 * for legibility, so the number that means "a third of my collection" has to come from
 * somewhere that is not the bar's height.
 */
export function languageBars(languages) {
  const max = languages.reduce((m, l) => Math.max(m, l.count), 0);
  const total = languages.reduce((n, l) => n + l.count, 0);
  if (!max) return [];
  return languages.map(l => ({
    ...l,
    pct: Math.round((l.count / max) * 100),
    share: total ? Math.round((l.count / total) * 100) : 0,
  }));
}

// No locale lookup: toLocaleDateString would render differently per visitor and is
// untestable without pinning an ICU build. sets.json dates are always ISO-ish.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2024-03-22' → 'Mar 22, 2024'. '' for anything unparseable. */
export function formatSetDate(iso) {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(String(iso ?? ''));
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : '';
}

/**
 * The "Expansions" cards: one row per set you hold cards from, enriched with the name,
 * date, symbol and official size from data/sets.json.
 *
 * `pct` is null — not 0 — when sets.json carries no count for the set. The two look the
 * same in a progress bar and mean completely different things ("none of 218" vs "of an
 * unknown total"), so the caller renders them differently.
 *
 * @param {Array} setsByDate summarise().setsByDate
 * @param {object} meta      data/sets.json
 */
export function expansionRows(setsByDate = [], meta = {}, limit = 6) {
  const names = meta.names?.en || {};
  const dates = meta.dates || {};
  const symbols = meta.symbols || {};
  const logos = meta.logos || {};
  const counts = meta.counts || {};
  return setsByDate.slice(0, limit).map(s => {
    const total = counts[s.key]?.official || 0;
    const owned = s.cards ?? s.count ?? 0;
    return {
      id: s.key,
      name: names[s.key] || s.key,
      date: dates[s.key] || null,
      symbol: symbols[s.key] || null,
      // 157 of 218 sets have a logo; the symbol is the fallback art, and some sets have
      // neither — hence a card that has to look right with an empty art box.
      logo: logos[s.key] || null,
      owned,
      printings: s.count ?? 0,
      total,
      pct: total ? Math.min(100, Math.round((owned / total) * 100)) : null,
    };
  });
}

/** '1 card' / '2 cards' — enough plural handling for the three places that need it. */
export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
