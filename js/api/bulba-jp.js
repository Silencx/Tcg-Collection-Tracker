// =============================================================================
// bulba-jp.js — the Bulbapedia Japanese-card source, decoupled from app state so
// it can run in BOTH the browser and Node (tools/build-data.mjs pre-builds JA into
// data/jp.json). Pure: imports nothing, touches no localStorage/DOM. `fetch` is a
// parameter (defaults to the global, present in browsers and Node 18+).
//
// Returns RAW parsed entries [{jpset, jpnum, pokemonName}] — the same shape the MS
// JP-injection and TMS popup already consume; image URLs + set metadata are applied
// downstream via JP_BULBA_SET_MAP + images.limitlessJpUrl.
//
// JP_BULBA_SET_MAP is a static table (JP set name → Limitless code + era + date +
// symbol); it only needs editing when a new JP set with our Pokémon ships. `sym` is
// the TCGdex symbol of the closest EN set (TCGdex has no usable JP symbols), written
// out exactly as data/sets.json's `symbols` map has it for that set id.
// =============================================================================

export const JP_BULBA_SET_MAP = {
  // ── EX / PCG era ── Limitless ORB blocked → placeholder
  'Movie Commemoration VS Pack':      {code:null,  era:'ex',   date:'2003-07-01', sym:'https://assets.tcgdex.net/univ/ex/ex2/symbol.webp'},
  'Miracle of the Desert':            {code:null,  era:'ex',   date:'2004-01-16', sym:'https://assets.tcgdex.net/univ/ex/ex2/symbol.webp'},
  'Latios ex Half Deck':              {code:null,  era:'ex',   date:'2004-01-16', sym:'https://assets.tcgdex.net/univ/ex/ex2/symbol.webp'},
  'Undone Seal':                      {code:null,  era:'ex',   date:'2004-08-20', sym:'https://assets.tcgdex.net/univ/ex/ex5/symbol.webp'},
  'Deoxys Constructed Starter Deck':  {code:null,  era:'ex',   date:'2004-11-01', sym:'https://assets.tcgdex.net/univ/ex/ex8/symbol.webp'},
  'Mirage Forest':                    {code:null,  era:'ex',   date:'2004-10-22', sym:'https://assets.tcgdex.net/univ/ex/ex12/symbol.webp'},
  'Miracle Crystal':                  {code:null,  era:'ex',   date:'2005-11-25', sym:'https://assets.tcgdex.net/univ/ex/ex14/symbol.webp'},
  'World Champions Pack':             {code:null,  era:'ex',   date:'2006-08-20', sym:'https://assets.tcgdex.net/univ/ex/ex16/symbol.webp'},
  // ── DP era ── Limitless ORB blocked → placeholder
  'Bonds to the End of Time':         {code:null,  era:'dp',   date:'2008-07-10', sym:'https://assets.tcgdex.net/univ/dp/dp5/symbol.webp'},
  // ── BW era ── Limitless ORB blocked → placeholder
  'Psycho Drive':                     {code:null,  era:'bw',   date:'2011-09-16', sym:'https://assets.tcgdex.net/univ/bw/bw3/symbol.webp'},
  // ── XY era ── mixed (split sets ORB-blocked)
  'Wild Blaze':                       {code:'XY2', era:'xy',   date:'2014-02-08', sym:'https://assets.tcgdex.net/univ/xy/xy2/symbol.webp'},
  'Fever-Burst Fighter':              {code:null,  era:'xy',   date:'2014-10-25', sym:'https://assets.tcgdex.net/univ/xy/xy5/symbol.webp'},
  'XY-P Promotional cards':           {code:'XYP', era:'xy',   date:'2013-10-12', sym:'https://assets.tcgdex.net/univ/xy/xyp/symbol.webp'},
  'Rage of the Broken Heavens':       {code:'XY9', era:'xy',   date:'2016-01-09', sym:'https://assets.tcgdex.net/univ/xy/xy9/symbol.webp'},
  // ── SM era ── all load ✅
  'Sky-Splitting Charisma':           {code:'SM7', era:'sm',   date:'2018-05-03', sym:'https://assets.tcgdex.net/univ/sm/sm7/symbol.webp'},
  'SM-P Promotional cards':           {code:'SMP', era:'sm',   date:'2017-01-27', sym:'https://assets.tcgdex.net/univ/sm/smp/symbol.webp'},
  // ── S era (Sword & Shield JP) ── all load ✅
  'Amazing Volt Tackle':              {code:'S4',  era:'swsh', date:'2020-10-16', sym:'https://assets.tcgdex.net/univ/swsh/swsh4/symbol.webp'},
  'Jet-Black Spirit':                 {code:'S6K', era:'swsh', date:'2021-09-24', sym:'https://assets.tcgdex.net/univ/swsh/swsh6/symbol.webp'},
  'Lost Abyss':                       {code:'S11', era:'swsh', date:'2022-07-15', sym:'https://assets.tcgdex.net/univ/swsh/swsh11/symbol.webp'},
  // ── SV era ── all load ✅
  'Cyber Judge':                      {code:'SV5M',era:'sv',   date:'2024-01-26', sym:'https://assets.tcgdex.net/univ/sv/sv05/symbol.webp'},
  // ── M era (Mega expansions) ── load ✅
  'Mega Brave':                       {code:'M1L', era:'sv',   date:'2025-08-01', sym:null},
};

/** Parse every {{card list/release}} block's jpset + jpnum from Bulbapedia wikitext. */
export function parseBulbaJPCards(wikitext) {
  const results = [];
  for (const m of wikitext.matchAll(/jpset=([^|}\n]+)[^}]*?jpnum=([^|}\n]+)/gs)) {
    results.push({ jpset: m[1].trim(), jpnum: m[2].trim() });
  }
  return results;
}

/**
 * Fetch one Pokémon's Bulbapedia TCG-page wikitext.
 *   → { ok: true,  wikitext }  Bulbapedia ANSWERED (wikitext '' when there is no such page)
 *   → { ok: false, error }     the request itself failed
 *
 * This used to collapse every failure into '' — the same value as "this page lists no
 * JP cards". That was harmless in the browser (an empty JP list for one session) and
 * ruinous at build time: every weekly CI build from 2026-09-14 on got "no JP cards" for
 * every Pokémon (Bulbapedia answered HTTP 403 when probed on 2026-10-22), and the job
 * committed an empty data/jp.json that every visitor then trusted over a live fetch.
 * Build time needs to tell the two apart, so the failure is carried out, not swallowed.
 */
async function fetchWikitext(pokeName, fetchImpl) {
  const url = `https://bulbapedia.bulbagarden.net/w/api.php?action=parse&page=${encodeURIComponent(pokeName + '_(TCG)')}&prop=wikitext&format=json&origin=*`;
  try {
    const res = await fetchImpl(url);
    // A block is an HTML challenge page, so without this check it would only surface
    // as a JSON parse error — the status is the useful part of the log line.
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const j = await res.json();
    if (j?.error) {
      // 'missingtitle' is MediaWiki's "no such page": a real answer (no TCG page, so no
      // JP cards), not an outage. Any other API error is a failure to get an answer.
      if (j.error.code === 'missingtitle') return { ok: true, wikitext: '' };
      return { ok: false, error: `API error ${j.error.code || '?'}` };
    }
    const wikitext = j?.parse?.wikitext?.['*'];
    if (typeof wikitext !== 'string') return { ok: false, error: 'response has no wikitext' };
    return { ok: true, wikitext };
  } catch (e) { return { ok: false, error: e?.message || String(e) }; }
}

/**
 * Per-Pokémon JP results, in `names` order:
 *   [{ name, ok: true,  entries: [{jpset, jpnum, pokemonName}] }
 *    { name, ok: false, entries: [], error }]
 * tools/build-data.mjs uses this one: it must not mistake "Bulbapedia blocked us" for
 * "this Pokémon has no JP cards" (see fetchWikitext).
 */
export async function fetchJpRawByName(names, fetchImpl = fetch) {
  // Parallel, as the old legacy.js fetchBulbaData requested the same pages — this
  // was a sequential for/await, so a five-Pokémon list paid
  // five round-trips end to end instead of one.
  //
  // Promise.all rather than the tcgdex pool on purpose: this module imports
  // nothing, which is what lets tools/build-data.mjs run it under Node. Mapping
  // (instead of pushing as results arrive) keeps the output order tied to `names`,
  // so the built snapshot stays byte-stable between runs.
  return Promise.all(names.map(async name => {
    const r = await fetchWikitext(name, fetchImpl);
    if (!r.ok) return { name, ok: false, entries: [], error: r.error };
    return { name, ok: true, entries: parseBulbaJPCards(r.wikitext).map(e => ({ ...e, pokemonName: name })) };
  }));
}

/**
 * Raw JP card entries for a list of Pokémon: [{jpset, jpnum, pokemonName}].
 * Used live by the browser (via router.getJpRaw). A Pokémon whose fetch failed just
 * contributes nothing, exactly as before — the browser has no older copy to fall back
 * to, and an empty JP list for one session is the least-bad answer there.
 */
export async function fetchJpRaw(names, fetchImpl = fetch) {
  return (await fetchJpRawByName(names, fetchImpl)).flatMap(r => r.entries);
}
