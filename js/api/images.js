// =============================================================================
// images.js — pure image-URL builders. No DOM, no fetch, no state.
//
// Limitless CDN holds international scans (EN/DE/FR/ES/IT/PT via /tpci/, JP via
// /tpc/). TCGdex assets CDN is the cross-language fallback. The pokemontcg.io →
// TCGdex id/localId mappers are here too (they only shape strings for URLs).
// Ported verbatim from the old single-file tool's config region.
// =============================================================================

// Limitless TPCI CDN language codes (international, non-JP).
// URL form: /tpci/{PTCGO_CODE}/{PTCGO_CODE}_{NUM_3DIG}_R_{LANG_CODE}.png
export const LIMITLESS_LANG_CODE = {
  EN:'EN', DE:'DE', FR:'FR', ES:'ES', IT:'IT', PT:'PT',
};

export function limitlessIntlUrl(ptcgoCode, num, langBadge){
  const langCode = LIMITLESS_LANG_CODE[langBadge];
  if(!ptcgoCode || !langCode) return null;
  const n = String(parseInt(num,10)).padStart(3,'0');
  if(!n || n==='NaN') return null;
  return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${ptcgoCode}/${ptcgoCode}_${n}_R_${langCode}.png`;
}

// pokemontcg.io setId → TCGdex CDN setId (SV and ME series need zero-padding).
export function ptcgioToTcgdexSetId(setId){
  const svM = setId.match(/^sv(\d+)(.*)/);
  if(svM) return `sv${svM[1].padStart(2,'0')}${svM[2]}`;
  const meM = setId.match(/^(me)(\d+)/);
  if(meM) return `me${meM[2].padStart(2,'0')}`;
  return setId; // bw4, swsh11, xy9, etc. — already match
}

// pokemontcg.io card number → TCGdex CDN localId (zero-pad newer eras).
export function ptcgioToTcgdexLocalId(num, series){
  if(/^\d+$/.test(num) && ['swsh','sv'].includes(series))
    return num.padStart(3,'0');
  return num; // XY23, 97, etc. — use as-is
}

// JP scans via Limitless TPC CDN. URL form: /tpc/{CODE}/{CODE}_{num}_R_JP_SM.png
export function limitlessJpUrl(code, jpnum){
  if(!code||!jpnum) return null;
  const num=parseInt(jpnum.split('/')[0],10);
  if(isNaN(num)) return null;
  return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/${code}/${code}_${num}_R_JP_SM.png`;
}

// ── TCGdex asset CDN builders (fallback images + set symbols) ─────────────────
// The Master-Set render still inlines these URLs verbatim from the old tool;
// these helpers centralize the pattern for Phase 3's image-routing pass.

/**
 * The CDN path segment for a set's assets — its TCGdex SERIES, not a slice of its id.
 *
 * LOAD-BEARING, and the fix for a long-standing wrong-URL bug. The old rule was
 * `setId.replace(/\d.*$/,'')`, which happens to work for sv05→sv and base1→base and is
 * WRONG for a large minority of sets. Measured against the art URLs TCGdex actually
 * serves: wrong for 48 of the 179 sets in data/sets.json that carry one, including
 *
 *     swshp → guessed "swshp", served under "swsh"   (SWSH Black Star Promos)
 *     cel25 → guessed "cel",   served under "swsh"   (Celebrations)
 *     A1    → guessed "A",     served under "tcgp"   (TCG Pocket)
 *     dpp   → guessed "dpp",   served under "dp"
 *     np    → guessed "np",    served under "pop"
 *     tk-*  → guessed the whole id, served under "tk" (all 20 Trainer Kits)
 *
 * and yielding the EMPTY STRING for 2021swsh, which built
 * `assets.tcgdex.net/en//2021swsh/…`. Verified live: /en/A/A1/001/low.webp is a 404,
 * /en/tcgp/A1/001/low.webp is a 200.
 *
 * `setSeries` is data/sets.json's build-time map, derived from TCGdex's own /series
 * endpoints. The guess survives only as a fallback for callers that have no map yet.
 *
 * @param {string} setId
 * @param {Object<string,string>|null} [setSeries] sets.json's setSeries map
 */
export function tcgdexSerieSegment(setId, setSeries = null) {
  const known = setSeries && setSeries[setId];
  if (known) return known;
  const guess = String(setId).replace(/\d.*$/, '');
  // Never '' — that is what produced the double-slash URLs for the McDonald's sets and
  // every other id that starts with a digit.
  return guess || String(setId);
}

/** Set symbol (language-neutral). */
export function tcgdexSymbolUrl(series, setId) {
  return `https://assets.tcgdex.net/univ/${series}/${setId}/symbol.webp`;
}
/** Asset base URL (no extension) — the renderer/provider append /low.webp etc. */
export function tcgdexAssetBase(lang, series, setId, localId) {
  return `https://assets.tcgdex.net/${lang}/${series}/${setId}/${localId}`;
}
/** Card image. quality: 'low' → low.webp, 'high' → high.png. */
export function tcgdexAssetUrl(lang, series, setId, localId, quality = 'low') {
  const ext = quality === 'high' ? 'high.png' : 'low.webp';
  return `${tcgdexAssetBase(lang, series, setId, localId)}/${ext}`;
}
