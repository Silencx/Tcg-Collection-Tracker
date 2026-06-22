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
