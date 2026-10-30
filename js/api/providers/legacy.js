// =============================================================================
// providers/legacy.js — what is left of the old tool's data pipeline.
// BUGFIX ONLY — never extend. The master source is TCGdex (Phase 3).
//
// The EN card-index fallback (Bulbapedia EN card lists → pokemontcg.io metadata and
// images → TCGdex name search) was REMOVED on 2026-10-30. pokemontcg.io is being
// shut down (its data repo tells developers to move to Scrydex before 2027-03-01, and
// Scrydex is paid), and the chain's own last step was TCGdex, which the router has
// already tried by the time it gets here. The card index is now snapshot → TCGdex.
//
// What remains: localized set names straight from TCGdex /sets (the router's set-meta
// fallback), new-card detection for the Refresh notice, and the JP set table
// re-export that masterset.js and tms.js import from here.
// =============================================================================

import { LANGUAGES } from '../../config.js';
import { JP_BULBA_SET_MAP, parseBulbaJPCards } from '../bulba-jp.js';
export { JP_BULBA_SET_MAP, parseBulbaJPCards };   // re-export for existing consumers

export async function fetchSetNames(apiCode){
  try{
    const r=await fetch(`https://api.tcgdex.net/v2/${apiCode}/sets`);
    if(!r.ok) return {};
    const s=await r.json();
    return Array.isArray(s)?Object.fromEntries(s.map(x=>[x.id,x.name])):{};
  }catch(e){return {};}
}

export async function fetchAllSetNames(){
  const eligible=LANGUAGES.filter(l=>l.hasSetsApi&&l.apiCode);
  const results=await Promise.allSettled(eligible.map(l=>fetchSetNames(l.apiCode).then(n=>({code:l.code,names:n}))));
  const map={};
  results.forEach((r,i)=>{ map[eligible[i].code]=(r.status==='fulfilled')?r.value.names:{}; });
  return map;
}

export function detectNew(oldCards,newCards){
  const old=new Set((oldCards||[]).map(c=>c.id));
  return newCards.filter(c=>!old.has(c.id));
}


// ── JAPANESE CARDS ───────────────────────────────────────────────────────────
//
// Strategy:
//   1. Fetch Bulbapedia wikitext for each Pokémon's TCG page (3 requests)
//   2. Parse every {{card list/release}} block to extract jpset + jpnum
//   3. Map Bulbapedia JP set name → metadata via JP_BULBA_SET_MAP
//   4. Build Limitless CDN image URL where available (XY2+ era mostly works)
//   5. Inject sorted set blocks into the correct era in the DOM
//
// Limitless image URL format:
//   https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/{CODE}/{CODE}_{num}_R_JP_SM.png
// Note: <img> tags load fine cross-origin; only fetch() is CORS-blocked.
// ORB blocks some older sets (BW split, DP, PCG) — those fall back to placeholder.

// JP set table + wikitext parser now live in ../bulba-jp.js (state-free so build-data
// can pre-build JA). Imported here and re-exported below for existing consumers.

// ── PROVIDER SURFACE (behaviour-faithful; router formalizes this in Phase 3) ──
export const legacy = {
  getSets:      fetchAllSetNames,  // → { langCode: { setId: setName } }
  detectNew,                       // (oldCards, newCards) → cards new since last fetch
  JP_BULBA_SET_MAP,
};
