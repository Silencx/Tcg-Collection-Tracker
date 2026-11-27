// =============================================================================
// api/set-list-model.js — a TCGdex /{lang}/sets answer with its known slips taken out.
// No DOM, no fetch. Used by tcgdex.getSetMeta (the weekly build and the live refresh)
// and by tools/build-catalog.mjs, so data/sets.json and data/cat/ agree on which sets a
// language has.
//
// Simplified Chinese (zh-cn), checked 2026-11-27, 57 entries:
//   · the 7 with cards (SV7a, SV7, SV8, SV8a, SV9, SV9a, SV10) are copies of the
//     Traditional Chinese sets: the same id and the same name, in Traditional
//     characters. Those cards are Traditional Chinese cards, already listed as TW;
//   · CSV1C is listed twice (127 cards, and a 9-card gem pack);
//   · eight CSM sets also appear under a lowercase id (csm1a next to CSM1aC). Neither
//     has cards. The ones kept are the codes printed on the products (CSM1aC), which is
//     also how Cardmarket files them; the lowercase entries' names, dates and counts
//     look like the right ones for some of them, which is TCGdex's to fix.
// The real Simplified Chinese sets are the CS…C, CSM…C and CSV…C ids.
// =============================================================================

/**
 * Which TCGdex languages need cleaning, by API code. `copyOf`: the language whose sets
 * this one has copies of. `twins`: lowercase twins of `…C` ids are listed.
 */
export const SET_LIST_QUIRKS = Object.freeze({
  'zh-cn': Object.freeze({ copyOf: 'zh-tw', twins: true }),
});

const total = s => Number(s?.cardCount?.total) || 0;
const nameOf = s => String(s?.name ?? '').trim();

/**
 * One TCGdex set list, cleaned.
 * @param {unknown} sets a /{lang}/sets answer
 * @param {object} [opts]
 * @param {Array|null} [opts.copyOf] the /sets answer of the language this one copies
 *   sets from: a set listed there with the same id and name is left out
 * @param {boolean} [opts.twins] leave out an all-lowercase id `x` when `xC` (any case)
 *   is also listed: csm1a of CSM1aC
 * @returns {{sets:Array, copies:string[], twins:string[], repeats:string[]}} the sets
 *   kept, in TCGdex's order, and the ids left out for each reason
 */
export function cleanSetList(sets, { copyOf = null, twins = false } = {}) {
  const list = (Array.isArray(sets) ? sets : []).filter(s => s && typeof s.id === 'string' && s.id);

  // One entry per id: the one with more cards (first listed on a tie), in the place
  // the id was first listed.
  const byId = new Map();
  const repeats = [];
  for (const s of list) {
    const had = byId.get(s.id);
    if (!had) { byId.set(s.id, s); continue; }
    repeats.push(s.id);
    if (total(s) > total(had)) byId.set(s.id, s);
  }

  const other = new Map((Array.isArray(copyOf) ? copyOf : [])
    .filter(s => s && typeof s.id === 'string').map(s => [s.id, nameOf(s)]));
  const lower = new Set([...byId.keys()].map(id => id.toLowerCase()));
  const copies = [], twinIds = [], kept = [];
  for (const s of byId.values()) {
    if (other.has(s.id) && other.get(s.id) === nameOf(s)) { copies.push(s.id); continue; }
    if (twins && s.id === s.id.toLowerCase() && lower.has(`${s.id}c`)) { twinIds.push(s.id); continue; }
    kept.push(s);
  }
  return { sets: kept, copies, twins: twinIds, repeats };
}

/**
 * A language's set list as the app uses it: cleaned when SET_LIST_QUIRKS names it,
 * else as TCGdex sent it.
 * @param {string} apiCode TCGdex language code
 * @param {(apiCode:string) => (Array|null)} listOf the /sets answer of a TCGdex
 *   language, null when it is not there (its request failed)
 * @returns {{sets:Array, copies:string[], twins:string[], repeats:string[], missing:string|null}}
 *   `missing`: the language whose list the cleaning needs and did not get. `sets` is
 *   then empty, because the copies could not be told apart and would be published as
 *   this language's sets.
 */
export function setListFor(apiCode, listOf) {
  const own = listOf(apiCode);
  const q = SET_LIST_QUIRKS[apiCode];
  const none = { copies: [], twins: [], repeats: [], missing: null };
  if (!q) return { sets: Array.isArray(own) ? own : [], ...none };
  const ref = q.copyOf ? listOf(q.copyOf) : null;
  if (q.copyOf && !Array.isArray(ref)) return { sets: [], ...none, missing: q.copyOf };
  return { ...cleanSetList(own, { copyOf: ref, twins: !!q.twins }), missing: null };
}
