// =============================================================================
// ui/tms.js — "True Master Set" mode: the Pokémon-catalog browser, the per-Pokémon
// card popup (include/exclude individual prints), the sticky language filter, and
// reset/clear/auto-populate. Print views live in print.js.
//
// The popup fetches its own data via the legacy pipeline (Bulbapedia + pokemontcg.io
// + Limitless/TCGdex images) — independent of the router — exactly as the old tool
// did. Ported verbatim; state names rewritten to state.<name>; the inline
// assets.tcgdex.net URL now uses the images.js builder; the old direct
// localStorage cache-clear now uses state.removeTmsCache().
// =============================================================================

import {
  state, saveTms, saveTmsFilter, saveTmsCache, removeTmsCache,
} from '../state.js';
import {
  LANGUAGES, PLACEHOLDER_LANGS, NATIVE_NAMES, BADGE_ORDER, POKEMON_CATALOG,
} from '../config.js';
import {
  limitlessJpUrl, tcgdexAssetBase, tcgdexSymbolUrl,
} from '../api/images.js';
import {
  JP_BULBA_SET_MAP,
} from '../api/providers/legacy.js';
import { router } from '../api/router.js';
import { viableSources, markBad, markGood } from '../api/img-cache.js';
import { langColor, buildPlaceholderHTML, mkPlaceholderEl, variantBadgesHtml } from './masterset.js';
import { escapeHtml } from './html.js';
import { openLanguagePicker, renderLangSummary } from './pickers.js';

function tmsCountForPoke(pokeName){
  let n=0;
  state.tmsIncluded.forEach(id=>{ if(state._tmsCardPokemon.get(id)===pokeName) n++; });
  return n;
}

/**
 * pokeName → number of included cards, built in ONE pass over tmsIncluded.
 *
 * The grid render needs a count for each of up to 357 tiles, and
 * tmsCountForPoke walks the whole of tmsIncluded every time it is called — so
 * the render was O(tiles × includes). One shared map makes it O(tiles + includes).
 */
function tmsCountsByPoke(){
  const counts=new Map();
  state.tmsIncluded.forEach(id=>{
    const poke=state._tmsCardPokemon.get(id);
    if(poke) counts.set(poke,(counts.get(poke)||0)+1);
  });
  return counts;
}

// Pending search debounce, at module scope so a full re-render can cancel a
// keystroke that is still in flight against the old (now discarded) input.
let tmsSearchTimer=null;

// ── TMS: Render the Pokémon catalog browser ───────────────────────────────────
function renderTMS(){
  const app=document.getElementById('tms-app'); if(!app) return;
  clearTimeout(tmsSearchTimer);
  app.innerHTML='';

  // Update header stats badge
  _updateTmsStats();

  // Toolbar: gen filter + search
  const toolbar=document.createElement('div'); toolbar.className='tms-toolbar';
  const genDiv=document.createElement('div'); genDiv.className='tms-gen-filter';
  [0,1,2,3,4,5,6,7,8,9].forEach((g,i)=>{
    const lbl=['All','Gen 1','Gen 2','Gen 3','Gen 4','Gen 5','Gen 6','Gen 7','Gen 8','Gen 9'][i];
    const btn=document.createElement('button'); btn.className='tms-gen-btn'+(state.tmsGenFilter===g?' active':'');
    btn.textContent=lbl;
    btn.onclick=()=>{
      state.tmsGenFilter=g;
      genDiv.querySelectorAll('.tms-gen-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      renderTmsGrid();
    };
    genDiv.appendChild(btn);
  });
  toolbar.appendChild(genDiv);
  const srch=document.createElement('input'); srch.type='text'; srch.className='tms-search';
  srch.placeholder='Search Pokémon…'; srch.value=state.tmsSearchQ;
  // Grid-only re-render, debounced. This used to call renderTMS(), which wipes
  // #tms-app — destroying the very input being typed into, so focus and caret
  // were lost after each character and the field could not hold a whole word.
  // 120ms is long enough that a fast typist filters the 357-tile catalog once
  // instead of once per keystroke, short enough to still feel immediate.
  srch.oninput=e=>{
    const q=e.target.value.trim().toLowerCase();
    clearTimeout(tmsSearchTimer);
    tmsSearchTimer=setTimeout(()=>{ state.tmsSearchQ=q; renderTmsGrid(); },120);
  };
  toolbar.appendChild(srch);
  app.appendChild(toolbar);

  // NO "Global language" ROW HERE, DELIBERATELY.
  //
  // It was 26 buttons (+EN −EN +DE −DE … for twelve languages plus JP) sitting between
  // the toolbar and the grid, and it only ever acted on state.tmsPokeCache — the Pokémon
  // whose popup you had ALREADY opened this session. So "+ DE" looked like a catalogue-
  // wide switch and was in fact a bulk edit of an invisible, order-dependent subset.
  //
  // The same job, scoped to something the user can see, is already in the popup: its
  // language pills plus "+ Include All Visible" / "− Exclude All Visible". That is where
  // per-language bulk selection belongs, and the header's own #tms-filter-bar is what
  // filters the view.

  // Pokémon grid — an empty shell here; renderTmsGrid fills it and is the only
  // thing search and the gen filter need to re-run.
  const grid=document.createElement('div');
  grid.className='tms-poke-grid'; grid.id='tms-poke-grid';
  app.appendChild(grid);
  renderTmsGrid();
}

// Re-render ONLY the Pokémon tiles, leaving the toolbar (and therefore the
// focused search input) untouched.
function renderTmsGrid(){
  const grid=document.getElementById('tms-poke-grid'); if(!grid) return;
  grid.innerHTML='';

  const filtered=POKEMON_CATALOG.filter(p=>{
    if(state.tmsGenFilter!==0&&p.gen!==state.tmsGenFilter) return false;
    if(state.tmsSearchQ&&!p.name.toLowerCase().includes(state.tmsSearchQ)) return false;
    return true;
  });
  if(!filtered.length){
    const empty=document.createElement('div'); empty.className='tms-no-results';
    empty.textContent='No Pokémon match the current filter.'; grid.appendChild(empty);
  }
  const counts=tmsCountsByPoke();   // one pass, shared by every tile below
  filtered.forEach(p=>{
    const cnt=counts.get(p.name)||0;
    const tile=document.createElement('div');
    tile.className='tms-poke-tile'+(cnt>0?' has-cards':'');
    tile.dataset.pokeName=p.name;
    const dexEl=document.createElement('div'); dexEl.className='tms-poke-dex';
    dexEl.textContent='#'+String(p.dex).padStart(3,'0');
    const nameEl=document.createElement('div'); nameEl.className='tms-poke-name';
    nameEl.textContent=p.name;
    tile.appendChild(dexEl); tile.appendChild(nameEl);
    if(cnt>0){
      const cntEl=document.createElement('div'); cntEl.className='tms-poke-count';
      cntEl.textContent=`${cnt} card${cnt===1?'':'s'}`; tile.appendChild(cntEl);
    }
    tile.onclick=()=>openTmsPopup(p.name);
    grid.appendChild(tile);
  });
}

// ── TMS: Open popup for a Pokémon ─────────────────────────────────────────────
async function openTmsPopup(pokeName){
  state._tmsOpenPoke=pokeName;
  state._tmsPopupActive=new Set([...state.tmsActiveLangs]); // inherit global language filter
  const overlay=document.getElementById('tms-overlay');
  const titleEl=document.getElementById('tms-popup-title');
  const subEl=document.getElementById('tms-popup-sub');
  const toolbar=document.getElementById('tms-popup-toolbar');
  const body=document.getElementById('tms-popup-body');
  titleEl.textContent=pokeName;
  subEl.textContent='Loading cards…';
  toolbar.innerHTML=''; body.innerHTML='<div style="padding:24px;text-align:center;color:#999;font-size:11px">Fetching card data…</div>';
  overlay.classList.add('open');
  try{
    const cards=await fetchTmsCardsForPoke(pokeName);
    state._tmsPopupAllCards=cards;
    renderTmsPopup(pokeName);
  }catch(e){
    body.innerHTML=`<div style="padding:20px;color:#c62828;font-size:11px">Error: ${escapeHtml(e.message)}</div>`;
    subEl.textContent='Error loading cards';
  }
}

// ── TMS: Fetch card data for one Pokémon ─────────────────────────────────────
async function fetchTmsCardsForPoke(pokeName){
  if(state.tmsPokeCache.has(pokeName)) return state.tmsPokeCache.get(pokeName);

  // Intl card index now comes through the ROUTER (snapshot → TCGdex → legacy), so
  // TMS ids match the Master Set (TCGdex format) and the popup gets the same
  // failover path. JP also goes through the router (snapshot data/jp.json → live
  // Bulbapedia), exactly like the Master-Set JP injection.
  const [cardRes, jpRaw]=await Promise.all([
    router.getCards([pokeName]).catch(()=>({cards:[]})),
    router.getJpRaw([pokeName]).catch(()=>[])
  ]);
  const tcgCards=cardRes.cards||[];
  const setIds=[...new Set(tcgCards.map(c=>(typeof c.id==='string'&&c.id.includes('-'))?c.id.slice(0,c.id.lastIndexOf('-')):null).filter(Boolean))];
  const meta=await router.getSetMeta({setIds}).catch(()=>({names:{},dates:{},symbols:{}}));
  const enNames=(meta.names&&meta.names.en)||{};

  const cards=[]; const seen=new Set();

  // EN + international + placeholder languages, hydrated from TCGdex (onerror hides
  // missing-language images in the popup, same as the Master Set).
  for(const tc of tcgCards){
    if(!tc||typeof tc.id!=='string'||!tc.id.includes('-')||seen.has(tc.id)) continue;
    seen.add(tc.id);
    const i=tc.id.lastIndexOf('-');
    const tcgdexSetId=tc.id.slice(0,i), tcgdexLocalId=tc.id.slice(i+1);
    const series=tcgdexSetId.replace(/\d.*$/,'');
    const setName=enNames[tcgdexSetId]||tcgdexSetId;
    const releaseDate=(meta.dates&&meta.dates[tcgdexSetId])||'1999/01/01';
    const symSrc=(meta.symbols&&meta.symbols[tcgdexSetId])||tcgdexSymbolUrl(series,tcgdexSetId);
    for(const langDef of LANGUAGES){
      const id=`${langDef.badge}_${tc.id}`;
      const base=tcgdexAssetBase(langDef.code, series, tcgdexSetId, tcgdexLocalId);
      state._tmsCardPokemon.set(id,pokeName);
      cards.push({id,pokeName,setId:tcgdexSetId,setName,releaseDate,localId:tcgdexLocalId,lang:langDef.badge,langColor:langDef.color,imgSrc:`${base}/low.webp`,hiSrc:`${base}/high.webp`,symSrc,variants:tc.variants||null});
    }
    for(const pl of PLACEHOLDER_LANGS){
      const id=`${pl.badge}_${tc.id}`;
      state._tmsCardPokemon.set(id,pokeName);
      cards.push({id,pokeName,setId:tcgdexSetId,setName,releaseDate,localId:tcgdexLocalId,lang:pl.badge,langColor:pl.color,imgSrc:null,hiSrc:null,symSrc});
    }
  }

  // JP cards (router → snapshot/Bulbapedia) — ids stay JP_{code}_{localId}.
  for(const {jpset,jpnum} of jpRaw){
    const m=JP_BULBA_SET_MAP[jpset]; if(!m) continue;
    const localId=jpnum.split('/')[0];
    const uid=`JP_${m.code||jpset}_${localId}`;
    if(seen.has(uid)) continue; seen.add(uid);
    const imgSrc=m.code?limitlessJpUrl(m.code,jpnum):null;
    state._tmsCardPokemon.set(uid,pokeName);
    cards.push({id:uid,pokeName,setId:m.code||jpset,setName:jpset,releaseDate:m.date||'1999/01/01',localId,lang:'JP',langColor:'#4527a0',imgSrc,hiSrc:null,symSrc:m.sym||null});
  }

  state.tmsPokeCache.set(pokeName,cards);
  saveTmsCache();
  return cards;
}

// ── TMS: Render the popup content ─────────────────────────────────────────────
function renderTmsPopup(pokeName){
  const toolbar=document.getElementById('tms-popup-toolbar');
  toolbar.innerHTML='';

  // Language pills — same filter-pill style as MS
  const present=[...new Set(state._tmsPopupAllCards.map(c=>c.lang))];
  const ordered=BADGE_ORDER.filter(b=>present.includes(b));
  ordered.forEach(badge=>{
    const pill=document.createElement('button'); pill.className='filter-pill'+(state._tmsPopupActive.has(badge)?' active':'');
    pill.textContent=badge; pill.style.background=langColor(badge);
    const l=LANGUAGES.find(x=>x.badge===badge)||PLACEHOLDER_LANGS.find(x=>x.badge===badge);
    pill.title=(l?l.label:badge==='JP'?'Japanese':badge);
    pill.onclick=()=>{
      state._tmsPopupActive.has(badge)?state._tmsPopupActive.delete(badge):state._tmsPopupActive.add(badge);
      pill.classList.toggle('active',state._tmsPopupActive.has(badge));
      renderTmsPopupCards(pokeName);
    };
    toolbar.appendChild(pill);
  });
  // Separator
  const sep=document.createElement('span'); sep.className='tms-toolbar-sep'; toolbar.appendChild(sep);
  // Action buttons
  const incAll=document.createElement('button'); incAll.className='tms-act-btn success';
  incAll.textContent='+ Include All Visible'; incAll.onclick=()=>tmsPopupBulk(true);
  toolbar.appendChild(incAll);
  const excAll=document.createElement('button'); excAll.className='tms-act-btn danger';
  excAll.textContent='− Exclude All Visible'; excAll.onclick=()=>tmsPopupBulk(false);
  toolbar.appendChild(excAll);

  renderTmsPopupCards(pokeName);
}

function renderTmsPopupCards(pokeName){
  const subEl=document.getElementById('tms-popup-sub');
  const body=document.getElementById('tms-popup-body');
  body.innerHTML='';

  const visible=state._tmsPopupAllCards.filter(c=>state._tmsPopupActive.has(c.lang));

  // Group by set, sorted by release date
  const bySet=new Map();
  visible.forEach(c=>{
    const key=c.releaseDate+'|'+c.setId;
    if(!bySet.has(key)) bySet.set(key,{setName:c.setName,releaseDate:c.releaseDate,symSrc:c.symSrc,cards:[]});
    bySet.get(key).cards.push(c);
  });
  const sorted=[...bySet.values()].sort((a,b)=>new Date(a.releaseDate)-new Date(b.releaseDate));

  const grid=document.createElement('div'); grid.className='tms-popup-grid';

  if(!visible.length){
    const e=document.createElement('div'); e.style.cssText='grid-column:1/-1;padding:20px;text-align:center;color:#999;font-size:11px;';
    e.textContent='No cards match the selected languages.'; grid.appendChild(e);
  }

  sorted.forEach(si=>{
    // Set divider
    const div=document.createElement('div'); div.className='tms-popup-set-divider';
    if(si.symSrc){
      const sym=document.createElement('img'); sym.src=si.symSrc;
      sym.style.cssText='width:12px;height:12px;object-fit:contain;filter:brightness(0.3);';
      sym.onerror=()=>sym.remove(); div.appendChild(sym);
    }
    div.appendChild(document.createTextNode(si.setName));
    grid.appendChild(div);

    si.cards.forEach(c=>{
      const isIn=state.tmsIncluded.has(c.id);
      const el=document.createElement('div'); el.className='tms-popup-card'+(isIn?' tms-in':''); el.dataset.id=c.id;
      // Image
      // Placeholder-first (mirrors mkImgWrap in masterset.js): paint the stand-in
      // immediately and let the image load underneath it, so a popup full of
      // missing-language prints never shows a grid of empty boxes while the 404s land.
      const wrap=document.createElement('div'); wrap.className='img-wrap';
      const nat=(NATIVE_NAMES[c.lang]||{})[pokeName]||null;
      const ph=mkPlaceholderEl(c.symSrc,c.lang,c.langColor,pokeName,nat,c.setName,c.localId);
      wrap.appendChild(ph);
      // Known-missing artwork is skipped without a request (img-cache.js), the same as
      // the Master-Set grid — this popup renders every language for a Pokémon, so it hit
      // the TCGdex language gaps hardest.
      if(c.imgSrc && viableSources([c.imgSrc]).length){
        ph.classList.add('ph-over');
        const img=document.createElement('img'); img.className='card-img';
        img.loading='lazy'; img.decoding='async'; img.fetchPriority='low';
        img.alt=`${pokeName} #${c.localId} ${c.lang}`;
        img.onload=()=>{ ph.remove(); markGood(c.imgSrc); };
        img.onerror=()=>{ img.remove(); markBad(c.imgSrc); ph.classList.remove('ph-over'); };
        img.src=c.imgSrc;
        wrap.appendChild(img);
      }
      const footer=document.createElement('div'); footer.className='card-footer';
      footer.innerHTML=`<span class="card-num">#${escapeHtml(c.localId)}</span>${variantBadgesHtml(c.variants)}<span class="lang" style="background:${escapeHtml(c.langColor)}">${escapeHtml(c.lang)}</span>`;
      el.appendChild(wrap); el.appendChild(footer);
      el.onclick=()=>toggleTmsCard(c.id,el,pokeName);
      grid.appendChild(el);
    });
  });

  body.appendChild(grid);

  // Update subtitle
  const inc=tmsCountForPoke(pokeName);
  if(subEl) subEl.textContent=`${inc} card${inc===1?'':'s'} in TMS · ${visible.length} visible`;
}

// ── TMS: Toggle a single card in/out of TMS ───────────────────────────────────
function toggleTmsCard(cardId,el,pokeName){
  if(state.tmsIncluded.has(cardId)){ state.tmsIncluded.delete(cardId); el.classList.remove('tms-in'); }
  else{ state.tmsIncluded.add(cardId); el.classList.add('tms-in'); state._tmsCardPokemon.set(cardId,pokeName||state._tmsOpenPoke); }
  saveTms();
  // Update subtitle + tile count
  const sub=document.getElementById('tms-popup-sub');
  if(sub&&state._tmsOpenPoke){
    const inc=tmsCountForPoke(state._tmsOpenPoke);
    const vis=state._tmsPopupAllCards.filter(c=>state._tmsPopupActive.has(c.lang)).length;
    sub.textContent=`${inc} card${inc===1?'':'s'} in TMS · ${vis} visible`;
  }
  _updateTmsTile(state._tmsOpenPoke);
  _updateTmsStats();
}

// ── TMS: Bulk include/exclude all visible popup cards ─────────────────────────
function tmsPopupBulk(include){
  const visible=state._tmsPopupAllCards.filter(c=>state._tmsPopupActive.has(c.lang));
  visible.forEach(c=>{
    if(include){ state.tmsIncluded.add(c.id); state._tmsCardPokemon.set(c.id,state._tmsOpenPoke); }
    else state.tmsIncluded.delete(c.id);
  });
  saveTms();
  renderTmsPopupCards(state._tmsOpenPoke);
  _updateTmsTile(state._tmsOpenPoke);
  _updateTmsStats();
}

// ── TMS: Update a Pokémon tile count in the grid ──────────────────────────────
function _updateTmsTile(pokeName){
  if(!pokeName) return;
  const tile=document.querySelector(`.tms-poke-tile[data-poke-name="${CSS.escape(pokeName)}"]`);
  if(!tile) return;
  const cnt=tmsCountForPoke(pokeName);
  let cntEl=tile.querySelector('.tms-poke-count');
  if(cnt>0){
    if(!cntEl){ cntEl=document.createElement('div'); cntEl.className='tms-poke-count'; tile.appendChild(cntEl); }
    cntEl.textContent=`${cnt} card${cnt===1?'':'s'}`; tile.classList.add('has-cards');
  }else{
    cntEl?.remove(); tile.classList.remove('has-cards');
  }
}

function _updateTmsStats(){
  const t=state.tmsIncluded.size;
  const el=document.getElementById('stats');
  if(el&&state.appMode==='tms') el.textContent=`${t} card${t===1?'':'s'} included`;
}

// ── TMS: Close popup ──────────────────────────────────────────────────────────
function closeTmsPopup(e){
  if(e&&e.target!==document.getElementById('tms-overlay')) return;
  document.getElementById('tms-overlay').classList.remove('open');
  state._tmsOpenPoke=null; state._tmsPopupAllCards=[];
}


function resetTms(){
  if(!state.tmsIncluded.size){ alert('No cards selected.'); return; }
  if(!confirm('Reset all TMS selections? Card data cache is kept.')) return;
  state.tmsIncluded.clear(); saveTms();
  renderTMS(); updateTmsPrintSelBtn();
}

// ── TMS: Clear card data cache (keep selections) ──────────────────────────────
function clearTmsCache(){
  if(!confirm('Clear TMS card data cache? Selections are kept, but card images/data will need to reload.')) return;
  state.tmsPokeCache.clear();
  removeTmsCache();
  renderTMS();
}

// ── TMS: Update Print Selected button count ───────────────────────────────────
function updateTmsPrintSelBtn(){
  const btn=document.getElementById('btn-tms-print-sel'); if(!btn) return;
  btn.textContent=`Print selected (${state.tmsIncluded.size})`;
}

// ── TMS: Language filter pills (sticky bar) ───────────────────────────────────
// Same summary-plus-modal as Master Set's language bar (js/ui/pickers.js), reading THIS
// mode's state. Two-letter pills could not tell TW from TH from SC; the modal shows a
// flag and the full language name for each.
//
// BADGE_ORDER whole, not a "present in the current render" subset: this mode's catalogue
// is every Pokémon, so every language is reachable from here whether or not a card in it
// happens to be included yet.
function buildTmsPillsTms(){
  const c=document.getElementById('tms-filter-pills'); if(!c) return;
  renderLangSummary(c,{
    available:[...BADGE_ORDER],
    active:state.tmsActiveLangs,
    onOpen:()=>openLanguagePicker({
      available:[...BADGE_ORDER],
      active:state.tmsActiveLangs,
      onChange:()=>{ saveTmsFilter(); buildTmsPillsTms(); },
    }),
  });
}

// ── TMS: Print Selected (card images, same layout as MS printSelected) ─────────

async function tmsAutoPopulate(){
  const poke=state.pokemonList[0]; if(!poke) return;
  try{
    const cards=await fetchTmsCardsForPoke(poke);
    const enCards=cards.filter(c=>c.lang==='EN');
    if(!enCards.length) return;
    enCards.sort((a,b)=>{
      const dd=new Date(b.releaseDate)-new Date(a.releaseDate); if(dd!==0) return dd;
      return (parseInt(b.localId,10)||0)-(parseInt(a.localId,10)||0);
    });
    const best=enCards[0];
    state.tmsIncluded.add(best.id); state._tmsCardPokemon.set(best.id,poke);
    saveTms();
    renderTMS(); updateTmsPrintSelBtn();
  }catch(e){ console.warn('TMS auto-populate failed:',e.message); }
}

// state.saveTms() dispatches 'tcg:tms-changed' on document (it can't call UI
// directly); keep the "Print Selected (n)" button count in sync here.
document.addEventListener('tcg:tms-changed', updateTmsPrintSelBtn);

export {
  renderTMS, buildTmsPillsTms, updateTmsPrintSelBtn, tmsAutoPopulate,
  resetTms, clearTmsCache, closeTmsPopup,
};
