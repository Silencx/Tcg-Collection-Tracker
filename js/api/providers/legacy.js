// =============================================================================
// providers/legacy.js — the router's last set-meta fallback, and new-card detection.
//
// fetchAllSetNames reads localized set names straight from TCGdex /sets (names only:
// no dates, symbols or counts). detectNew drives the Refresh notice in buildAll.
// =============================================================================

import { LANGUAGES } from '../../config.js';

async function fetchSetNames(apiCode){
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
