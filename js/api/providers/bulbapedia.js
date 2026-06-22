// =============================================================================
// providers/bulbapedia.js — PURE Japanese-card source (no state/storage/DOM).
//
// TCGdex's JA coverage is unusable, so Japanese cards come from Bulbapedia wikitext.
// This module is deliberately dependency-free (only the global fetch) so the SAME
// code runs in the browser AND in Node (tools/build-data.mjs), letting JA be baked
// into the snapshot (data/jp.json) like the TCGdex card index.
//
// Exposes: JP_BULBA_SET_MAP (static set table), parseBulbaJPCards (pure parser),
// and fetchJpCardsData (live fetch). legacy.js re-exports the first two so existing
// importers keep working.
// =============================================================================

// JP set name → Limitless image code + era + release date + symbol.
// ORB blocks some older sets (BW split, DP, PCG) — those fall back to placeholder.
export const JP_BULBA_SET_MAP = {
  // ── EX / PCG era ── Limitless ORB blocked → placeholder
  'Movie Commemoration VS Pack':      {code:null,  era:'ex',   date:'2003-07-01', sym:'https://images.pokemontcg.io/ex2/symbol.png'},
  'Miracle of the Desert':            {code:null,  era:'ex',   date:'2004-01-16', sym:'https://images.pokemontcg.io/ex2/symbol.png'},
  'Latios ex Half Deck':              {code:null,  era:'ex',   date:'2004-01-16', sym:'https://images.pokemontcg.io/ex2/symbol.png'},
  'Undone Seal':                      {code:null,  era:'ex',   date:'2004-08-20', sym:'https://images.pokemontcg.io/ex5/symbol.png'},
  'Deoxys Constructed Starter Deck':  {code:null,  era:'ex',   date:'2004-11-01', sym:'https://images.pokemontcg.io/ex8/symbol.png'},
  'Mirage Forest':                    {code:null,  era:'ex',   date:'2004-10-22', sym:'https://images.pokemontcg.io/ex12/symbol.png'},
  'Miracle Crystal':                  {code:null,  era:'ex',   date:'2005-11-25', sym:'https://images.pokemontcg.io/ex14/symbol.png'},
  'World Champions Pack':             {code:null,  era:'ex',   date:'2006-08-20', sym:'https://images.pokemontcg.io/ex16/symbol.png'},
  // ── DP era ── Limitless ORB blocked → placeholder
  'Bonds to the End of Time':         {code:null,  era:'dp',   date:'2008-07-10', sym:'https://images.pokemontcg.io/dp5/symbol.png'},
  // ── BW era ── Limitless ORB blocked → placeholder
  'Psycho Drive':                     {code:null,  era:'bw',   date:'2011-09-16', sym:'https://images.pokemontcg.io/bw3/symbol.png'},
  // ── XY era ── mixed (split sets ORB-blocked)
  'Wild Blaze':                       {code:'XY2', era:'xy',   date:'2014-02-08', sym:'https://images.pokemontcg.io/xy2/symbol.png'},
  'Fever-Burst Fighter':              {code:null,  era:'xy',   date:'2014-10-25', sym:'https://images.pokemontcg.io/xy5/symbol.png'},
  'XY-P Promotional cards':           {code:'XYP', era:'xy',   date:'2013-10-12', sym:'https://images.pokemontcg.io/xyp/symbol.png'},
  'Rage of the Broken Heavens':       {code:'XY9', era:'xy',   date:'2016-01-09', sym:'https://images.pokemontcg.io/xy9/symbol.png'},
  // ── SM era ── all load ✅
  'Sky-Splitting Charisma':           {code:'SM7', era:'sm',   date:'2018-05-03', sym:'https://images.pokemontcg.io/sm7/symbol.png'},
  'SM-P Promotional cards':           {code:'SMP', era:'sm',   date:'2017-01-27', sym:'https://assets.tcgdex.net/univ/sm/smp/symbol.webp'},
  // ── S era (Sword & Shield JP) ── all load ✅
  'Amazing Volt Tackle':              {code:'S4',  era:'swsh', date:'2020-10-16', sym:'https://images.pokemontcg.io/swsh4/symbol.png'},
  'Jet-Black Spirit':                 {code:'S6K', era:'swsh', date:'2021-09-24', sym:'https://images.pokemontcg.io/swsh6/symbol.png'},
  'Lost Abyss':                       {code:'S11', era:'swsh', date:'2022-07-15', sym:'https://images.pokemontcg.io/swsh11/symbol.png'},
  // ── SV era ── all load ✅
  'Cyber Judge':                      {code:'SV5M',era:'sv',   date:'2024-01-26', sym:'https://images.pokemontcg.io/sv5/symbol.png'},
  // ── M era (Mega expansions) ── load ✅
  'Mega Brave':                       {code:'M1L', era:'sv',   date:'2025-08-01', sym:null},
};

/** Pure parser: pull {jpset,jpnum} pairs out of Bulbapedia wikitext. */
export function parseBulbaJPCards(wikitext) {
  const results = [];
  // Match each release block — jpset always comes before jpnum in the template
  for (const m of wikitext.matchAll(/jpset=([^|}\n]+)[^}]*?jpnum=([^|}\n]+)/gs)) {
    results.push({ jpset: m[1].trim(), jpnum: m[2].trim() });
  }
  return results;
}

const BULBA_API = 'https://bulbapedia.bulbagarden.net/w/api.php';

/** Fetch one Pokémon's TCG wikitext (empty string on any failure). */
async function fetchWikitext(name, signal) {
  const url = `${BULBA_API}?action=parse&page=${encodeURIComponent(name + '_(TCG)')}&prop=wikitext&format=json&origin=*`;
  return fetch(url, { signal })
    .then(r => r.json())
    .then(j => j?.parse?.wikitext?.['*'] || '')
    .catch(() => '');
}

/**
 * Live JA card list for the given Pokémon, merged across names.
 * @returns {Promise<Array<{jpset:string,jpnum:string,pokemonName:string}>>}
 *   Same shape the Master Set's JA injection consumes.
 */
export async function fetchJpCardsData(names, { signal } = {}) {
  const out = [];
  for (const name of names) {
    const wt = await fetchWikitext(name, signal);
    if (!wt) continue;
    for (const e of parseBulbaJPCards(wt)) out.push({ jpset: e.jpset, jpnum: e.jpnum, pokemonName: name });
  }
  return out;
}
