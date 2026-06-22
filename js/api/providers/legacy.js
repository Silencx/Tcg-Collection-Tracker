// =============================================================================
// providers/legacy.js — FROZEN port of the old tool's data pipeline.
// BUGFIX ONLY — never extend. The new master source is TCGdex (Phase 3); this
// remains the fallback provider and the JA path. Behaviour is identical to the
// old single-file tool.
//
// Pipeline: Bulbapedia wikitext (EN card lists + JP jpset/jpnum) → pokemontcg.io
// (EN metadata, images, ptcgoCode) → TCGdex (last-resort EN). Set names come
// from TCGdex per language. The result is cached by the caller (state.loadCache/
// saveCache, 24h TTL checked in buildAll).
//
// The formal provider contract consumed by the router (getCardsForPokemon /
// getCardDetail / normalized shape) is finalized in Phase 3; here we expose the
// pipeline functions plus a behaviour-faithful `legacy` surface.
//
// NOTE on state.: app state lives on the shared `state` object (see state.js),
// because ES-module bindings can't be reassigned across files. The old bare
// `_bulbaData` and `pokemonList` are therefore `state._bulbaData` /
// `state.pokemonList` here.
// =============================================================================

import { state } from '../../state.js';
import { LANGUAGES } from '../../config.js';
import { JP_BULBA_SET_MAP, parseBulbaJPCards } from '../bulba-jp.js';
export { JP_BULBA_SET_MAP, parseBulbaJPCards };   // re-export for existing consumers

// ── BULBAPEDIA (EN card lists; shared EN+JP fetch, cached on state._bulbaData) ─
export function parseBulbaEN(wikitext, pokemonName){
  const cards=[];
  for(const m of wikitext.matchAll(/enset=([^|}\n]+)[^}]*?ennum=([^|}\n]+)/gs)){
    const enSet=m[1].trim();
    const rawNum=m[2].trim().split('/')[0].trim();
    // Numeric numbers: strip leading zeros (pokemontcg.io stores "5" not "005")
    // Non-numeric (promos like "XY23"): keep as-is
    const num=/^\d+$/.test(rawNum)?String(parseInt(rawNum,10)):rawNum;
    if(enSet&&num) cards.push({pokemonName,enSet,num});
  }
  return cards;
}

// Fetch Bulbapedia wikitext for all Pokémon in state.pokemonList.
// Returns {enCards:[{pokemonName,enSet,num}], jpCardsData:[{jpset,jpnum,pokemonName}]}
// Result is cached in state._bulbaData so JP fetch doesn't re-fetch.
export async function fetchBulbaData(){
  if(state._bulbaData) return state._bulbaData; // reuse within same session
  const results=await Promise.allSettled(state.pokemonList.map(name=>
    fetch(`https://bulbapedia.bulbagarden.net/w/api.php?action=parse&page=${encodeURIComponent(name+'_(TCG)')}&prop=wikitext&format=json&origin=*`)
      .then(r=>r.json())
      .then(d=>({name,text:d.parse?.wikitext?.['*']||''}))
      .catch(()=>({name,text:''}))
  ));
  const enCards=[], jpCardsData=[];
  results.forEach(r=>{
    if(r.status!=='fulfilled') return;
    const {name,text}=r.value;
    if(!text) return;
    enCards.push(...parseBulbaEN(text,name));
    jpCardsData.push(...parseBulbaJPCards(text).map(c=>({...c,pokemonName:name})));
  });
  state._bulbaData={enCards,jpCardsData};
  return state._bulbaData;
}

// Fetch all pokemontcg.io sets → Map<setName, setObj>
// Used to look up set metadata (id, releaseDate, symbol) from Bulbapedia EN set names.
export async function fetchPtcgioSetsMap(){
  try{
    const r=await fetch('https://api.pokemontcg.io/v2/sets?pageSize=250&select=id,name,series,releaseDate,images,ptcgoCode');
    if(!r.ok) return new Map();
    const d=await r.json();
    return new Map((d.data||[]).map(s=>[s.name,s]));
  }catch(e){ return new Map(); }
}

export async function fetchEnCards(){
  // 1. Fetch Bulbapedia + pokemontcg.io sets in parallel
  const [bulba, ptcgioSets]=await Promise.all([fetchBulbaData(), fetchPtcgioSetsMap()]);

  // 2. Build EN cards: Bulbapedia supplies card list, pokemontcg.io supplies metadata+images
  const cards=[];
  const seen=new Set();
  for(const {pokemonName,enSet,num} of bulba.enCards){
    const setData=ptcgioSets.get(enSet);
    if(!setData) continue; // set not in pokemontcg.io — will be caught by fallback
    const cardId=`${setData.id}-${num}`;
    if(seen.has(cardId)) continue;
    seen.add(cardId);
    cards.push({
      id:cardId, name:pokemonName, number:num, set:setData, ptcgoCode:setData.ptcgoCode||null,
      images:{
        small:`https://images.pokemontcg.io/${setData.id}/${num}.png`,
        large:`https://images.pokemontcg.io/${setData.id}/${num}_hires.png`,
      }
    });
  }
  if(cards.length) return cards;

  // 3. Fallback A: pokemontcg.io name search (if Bulbapedia or set mapping failed)
  console.warn('Bulbapedia→pokemontcg.io mapping failed, falling back to name search');
  const ptcgCards=[];
  await Promise.allSettled(state.pokemonList.map(async name=>{
    try{
      const r=await fetch(`https://api.pokemontcg.io/v2/cards?q=name:"${encodeURIComponent(name)}"&pageSize=250&select=id,name,number,set,images`);
      if(!r.ok) return;
      const d=await r.json();
      if(Array.isArray(d.data)) ptcgCards.push(...d.data);
    }catch(e){}
  }));
  if(ptcgCards.length) return ptcgCards;

  // 4. Fallback B: TCGdex (last resort)
  console.warn('pokemontcg.io also failed, falling back to TCGdex');
  const tcgCards=[]; const errors=[];
  for(const name of state.pokemonList){
    const urls=[
      `https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(name)}`,
      `https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(name.toLowerCase())}`,
    ];
    let ok=false;
    for(const url of urls){
      try{
        const r=await fetch(url); if(!r.ok) continue;
        const d=await r.json();
        if(Array.isArray(d)&&d.length){tcgCards.push(...d);ok=true;break;}
        if(d?.data?.length){tcgCards.push(...d.data);ok=true;break;}
      }catch(e){}
    }
    if(!ok) errors.push(`${name}:not found`);
  }
  if(!tcgCards.length) throw new Error(`All sources failed (${errors.slice(0,3).join('; ')})`);
  return tcgCards;
}

export async function fetchSetNames(apiCode){
  try{
    const r=await fetch(`https://api.tcgdex.net/v2/${apiCode}/sets`);
    if(!r.ok) return {};
    const s=await r.json();
    return Array.isArray(s)?Object.fromEntries(s.map(x=>[x.id,x.name])):{};
  }catch(e){return {};}
}

// Fetch native Pokémon names for a given language by querying one card per
// unique species name. We use the card ID derived from the EN image URL.
// Returns { enName: nativeName, … }  — 3 requests total (one per species).

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
  getCards:     fetchEnCards,      // → EN master card list for state.pokemonList
  getSets:      fetchAllSetNames,  // → { langCode: { setId: setName } }
  getBulbaData: fetchBulbaData,    // → { enCards, jpCardsData } (cached)
  detectNew,                       // (oldCards, newCards) → cards new since last fetch
  JP_BULBA_SET_MAP,
};
