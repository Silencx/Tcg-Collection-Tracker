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
import { tcgdexAssetBase } from '../images.js';

const API = 'https://api.tcgdex.net/v2';

// TCGdex serie code from a setId (strip trailing digits/suffix):
// "sv05"→"sv", "swsh11"→"swsh", "sm7"→"sm", "ex14"→"ex", "base1"→"base", "me01"→"me".
function serieOf(setId) { return setId.replace(/\d.*$/, ''); }

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

/**
 * EN master card index for the given Pokémon names.
 * @returns {Promise<Array<{id:string,name:string,image:string,localId:string}>>}
 *   `image` is ALWAYS a valid asset base url (filled from the id if the list omits it),
 *   so no card is ever dropped for a missing image.
 */
export async function getCards(names, { signal, withVariants = true } = {}) {
  const out = [];
  const seen = new Set();
  for (const name of names) {
    const data = await getJSON(`${API}/en/cards?name=${encodeURIComponent(name)}`, signal);
    const list = Array.isArray(data) ? data : (data?.data || []);
    for (const c of list) {
      if (!c?.id || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({
        id: c.id,
        name,                                   // canonical EN species name (the query term)
        image: c.image || imageBaseFromId(c.id),
        localId: c.localId != null ? String(c.localId) : splitId(c.id).localId,
      });
    }
  }
  if (!out.length) throw new Error('TCGdex returned no cards');

  // Variant flags (reverse/holo/1st-ed/…) live only on the card DETAIL endpoint and
  // are only trustworthy on modern eras. Fetch detail for just those cards (bounded)
  // and attach `variants`; failures simply leave it absent (never drops the card).
  if (withVariants) {
    const modern = out.filter(c => eraSupportsVariants(serieOf(splitId(c.id).setId)));
    if (modern.length) {
      const settled = await Promise.allSettled(
        modern.map(c => getJSON(`${API}/en/cards/${c.id}`, signal).then(d => ({ c, d })))
      );
      for (const s of settled) {
        if (s.status === 'fulfilled' && s.value.d?.variants) s.value.c.variants = s.value.d.variants;
      }
    }
  }
  return out;
}

/**
 * Set metadata across all eligible languages, in one pass.
 * @param {object} [opts]
 * @param {string[]} [opts.setIds] set ids whose release dates we need; any not
 *   carrying a date from the /sets list are filled via a bounded /sets/{id} fetch.
 * @returns {Promise<{names:Object, dates:Object, symbols:Object}>}
 *   names:   { langCode: { setId: localizedName } }  — same shape as legacy.fetchAllSetNames
 *   dates:   { setId: 'YYYY-MM-DD' }                  — EN release dates (drives set/era sort)
 *   symbols: { setId: symbolUrl }                     — EN set symbols (.webp)
 */
export async function getSetMeta({ signal, setIds = [] } = {}) {
  const eligible = LANGUAGES.filter(l => l.hasSetsApi && l.apiCode);
  const results = await Promise.allSettled(
    eligible.map(l => getJSON(`${API}/${l.apiCode}/sets`, signal).then(s => ({ l, s })))
  );
  const names = {}, dates = {}, symbols = {};
  results.forEach((r, i) => {
    const code = eligible[i].code;
    names[code] = {};
    if (r.status !== 'fulfilled') return;
    const arr = Array.isArray(r.value.s) ? r.value.s : [];
    for (const set of arr) {
      if (!set?.id) continue;
      names[code][set.id] = set.name || set.id;
      if (eligible[i].apiCode === 'en') {
        if (set.releaseDate) dates[set.id] = set.releaseDate;   // present on some deployments
        if (set.symbol) symbols[set.id] = /\.(webp|png)$/.test(set.symbol) ? set.symbol : `${set.symbol}.webp`;
      }
    }
  });

  // The /sets LIST often omits releaseDate (only /sets/{id} carries it), which would
  // collapse every set to the 1999 sort fallback. Fill dates for the sets we actually
  // use via bounded per-set detail calls.
  const need = [...new Set(setIds)].filter(id => id && !dates[id]);
  if (need.length) {
    const detail = await Promise.allSettled(
      need.map(id => getJSON(`${API}/en/sets/${id}`, signal).then(s => ({ id, s })))
    );
    for (const d of detail) {
      if (d.status === 'fulfilled' && d.value.s?.releaseDate) dates[d.value.id] = d.value.s.releaseDate;
      if (d.status === 'fulfilled' && d.value.s?.symbol && !symbols[d.value.id]) {
        const sym = d.value.s.symbol;
        symbols[d.value.id] = /\.(webp|png)$/.test(sym) ? sym : `${sym}.webp`;
      }
    }
  }
  return { names, dates, symbols };
}

// Variant data is only trustworthy on modern eras (old-era TCGdex variants are wrong
// — e.g. ex16-97 reports holo:false), so getCards only fetches/attaches variants for
// these series. This predicate is the gate.
const VARIANT_ERAS = new Set(['swsh', 'sv', 'me']);
export function eraSupportsVariants(series) { return VARIANT_ERAS.has(series); }

export const tcgdex = { getCards, getSetMeta, eraSupportsVariants };
