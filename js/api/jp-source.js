// =============================================================================
// jp-source.js — the Japanese cards for a Pokémon list, from the best source present.
//
//   1. The CATALOGUE (data/jp-cat/, built by tools/build-jp-catalog.mjs from PokéWallet):
//      every Japanese set, any Pokémon. Committed and served; step 2 answers only if
//      the files are missing (for example after the catalogue is withdrawn).
//   2. BULBAPEDIA (data/jp/ snapshot → live wikitext, via the router): only the Pokémon
//      pre-built in the snapshot (or reachable live), and only the 21 sets
//      JP_BULBA_SET_MAP knows.
// With the catalogue present, Bulbapedia's snapshot still fills in cards the catalogue
// lacks (World Champions Pack). Either way every row gets the stable id from
// jp-model.js, so a tick survives the source changing underneath it.
//
// @returns {{ rows: JpRow[], sets: Map<setKey, JpSet>, source: 'catalogue'|'bulbapedia' }}
//   JpRow { id, setKey, number, numKey, cardName, pokemonName }
//   JpSet { key, name, code, date, era, limitless, sym }
// =============================================================================

import { JP_BULBA_SET_MAP } from './bulba-jp.js';
import { router } from './router.js';
import { snapshot } from './providers/snapshot.js';
import { namesSpecies } from './providers/tcgdex.js';
import { setSlug } from './local-images.js';
import { jpCardId, jpNumKey, speciesShardLetter } from './jp-model.js';

const CAT_BASE = new URL('../../data/jp-cat/', import.meta.url);

// Session memo of promises, like snapshot.js: a missing catalogue is answered once.
const memo = new Map();
function loadCat(file) {
  if (!memo.has(file)) {
    memo.set(file, fetch(new URL(file, CAT_BASE), { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null));
  }
  return memo.get(file);
}

/** The catalogue's set table, or null when there is no catalogue. */
export async function catalogueSets() {
  const j = await loadCat('sets.json');
  return Array.isArray(j?.sets) && j.sets.length ? j.sets : null;
}

/** A JP set's metadata from the hand-made Bulbapedia table, in catalogue shape. */
function bulbaSet(jpset) {
  const m = JP_BULBA_SET_MAP[jpset];
  return m ? { key: setSlug(jpset), name: jpset, code: m.code, date: m.date || null, era: m.era || null,
    limitless: m.code || null, sym: m.sym || null } : null;
}

function addBulbaRows(raw, rows, sets, seen) {
  for (const r of raw || []) {
    const meta = sets.get(setSlug(r.jpset)) || bulbaSet(r.jpset);
    if (!meta) continue;                         // unknown set — same rule as before
    const numKey = jpNumKey(r.jpnum);
    const id = jpCardId(meta.key, numKey);
    if (seen.has(id)) continue;
    seen.add(id);
    sets.set(meta.key, meta);
    rows.push({ id, setKey: meta.key, number: r.jpnum, numKey, cardName: r.pokemonName, pokemonName: r.pokemonName });
  }
}

/**
 * @param {string[]} names  the Pokémon list
 * @param {{live?:boolean}} [opts]  `live:false` never reaches Bulbapedia over the
 *   network (used by the boot migration, which must stay quick)
 */
export async function getJpCards(names, { live = true } = {}) {
  const rows = [], seen = new Set(), sets = new Map();
  const catSets = await catalogueSets();

  if (catSets) {
    for (const s of catSets) sets.set(s.key, s);
    const letters = [...new Set(names.map(speciesShardLetter).filter(Boolean))];
    const shards = new Map(await Promise.all(letters.map(async l => [l, (await loadCat(`cards-${l}.json`))?.rows || []])));
    for (const name of names) {
      for (const r of shards.get(speciesShardLetter(name)) || []) {
        // [setKey, number, name, print, numKey]. Separately-listed prints are variants of a
        // base card, not cards of their own — the checklist shows the base card.
        if (r[3] || !namesSpecies(r[2], name)) continue;
        const id = jpCardId(r[0], r[4]);
        if (seen.has(id)) continue;              // a shared card goes to the first-listed Pokémon
        seen.add(id);
        rows.push({ id, setKey: r[0], number: r[1], numKey: r[4], cardName: r[2], pokemonName: name });
      }
    }
    // Whatever Bulbapedia's committed snapshot has that the catalogue does not.
    const snap = await snapshot.getJpRawPartial(names).catch(() => null);
    addBulbaRows(snap?.data, rows, sets, seen);
    return { rows, sets, source: 'catalogue' };
  }

  const raw = live
    ? await router.getJpRaw(names)
    : (await snapshot.getJpRawPartial(names).catch(() => null))?.data || [];
  addBulbaRows(raw, rows, sets, seen);
  return { rows, sets, source: 'bulbapedia' };
}
