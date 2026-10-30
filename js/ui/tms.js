// =============================================================================
// ui/tms.js — "True Master Set" mode: the Pokémon-catalog browser, the per-Pokémon
// card popup (include/exclude individual prints), the sticky language filter, and
// reset/clear/auto-populate. Print views live in print.js.
//
// The popup's cards come through the same paths as Master Set — the router for the
// TCGdex languages, api/jp-source.js for Japanese — so ids match across the two modes.
// Each Pokémon's built card list is cached in state.tmsPokeCache (persisted).
// =============================================================================

import {
  state, saveTms, saveTmsPrints, saveTmsFilter, saveTmsCache, removeTmsCache,
} from '../state.js';
import {
  LANGUAGES, PLACEHOLDER_LANGS, NATIVE_NAMES, BADGE_ORDER, POKEMON_CATALOG,
} from '../config.js';
import {
  limitlessJpUrl, tcgdexAssetBase, tcgdexSymbolUrl,
} from '../api/images.js';
import { router } from '../api/router.js';
import { viableSources, markBad, markGood } from '../api/img-cache.js';
import { loadImageIndex, localImage } from '../api/local-images.js';
import { getJpCards } from '../api/jp-source.js';
import { jpImageKeyFor } from '../api/jp-model.js';
import { langColor, mkPlaceholderEl, variantBadgesHtml } from './masterset.js';
import { escapeHtml } from './html.js';
import { openLanguagePicker, renderLangSummary } from './pickers.js';
import {
  printsOf, tracksPrints, printId, applyPrint, applyCard, clearPrintsOf, printUnset, slotCount,
} from './prints-model.js';
import { mkPrintChips, syncChips, markUnset, mkPrintTag } from './prints-ui.js';

// Per-print tracking in the popup: TMS card id → its prints, for the open Pokémon's cards
// that have two or more. Rebuilt by renderTmsPopupCards. In this mode a print is a binder
// SLOT to include, exactly as a card is — the three rules in prints-model.js are the same.
const popupPrints=new Map();
const popupKeys=id=>(popupPrints.get(id)||[]).map(p=>p.key);

/** Make one popup tile's classes match tmsIncluded / tmsPrints. */
function syncTmsTile(el){
  if(el.dataset.print){
    const on=state.tmsPrints.has(el.dataset.id);
    el.classList.toggle('tms-in',on);
    markUnset(el,printUnset(state.tmsIncluded,state.tmsPrints,el.dataset.card,popupKeys(el.dataset.card)));
    return;
  }
  const on=state.tmsIncluded.has(el.dataset.id);
  el.classList.toggle('tms-in',on);
  syncChips(el,state.tmsPrints,el.dataset.id,popupKeys(el.dataset.id),on);
}

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
    // The hosted-image manifest never rejects; it is read at RENDER time (see
    // renderTmsPopupCards) so entries already in the persisted TMS cache pick it up too.
    const [cards]=await Promise.all([fetchTmsCardsForPoke(pokeName), loadImageIndex()]);
    state._tmsPopupAllCards=cards;
    renderTmsPopup(pokeName);
  }catch(e){
    body.innerHTML=`<div style="padding:20px;color:#c62828;font-size:11px">Error: ${escapeHtml(e.message)}</div>`;
    subEl.textContent='Error loading cards';
  }
}

// ── TMS: Fetch card data for one Pokémon ─────────────────────────────────────
async function fetchTmsCardsForPoke(pokeName){
  // A cached list from before the stable JP ids (no `imgKey` on its JP cards) is stale:
  // it predates the catalogue, so refetch rather than show the old, shorter JP list.
  if(state.tmsPokeCache.has(pokeName)){
    const cached=state.tmsPokeCache.get(pokeName);
    if(!cached.some(c=>c&&c.lang==='JP'&&!c.imgKey)) return cached;
  }

  // Intl card index through the ROUTER (snapshot → TCGdex), so TMS ids match the
  // Master Set (TCGdex format) and the popup gets the same failover path. JP through
  // api/jp-source.js (catalogue → Bulbapedia), exactly like the Master-Set JP injection.
  const [cardRes, jp]=await Promise.all([
    router.getCards([pokeName]).catch(()=>({cards:[]})),
    getJpCards([pokeName]).catch(()=>({rows:[],sets:new Map()}))
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

  // JP cards (api/jp-source.js: catalogue → Bulbapedia) — the same stable
  // JP_{setKey}_{numKey} ids as the Master Set. `imgKey` is the hosted-image key, read at
  // render time (see renderTmsPopupCards) so a cached entry picks up images added later.
  for(const r of jp.rows){
    const m=jp.sets.get(r.setKey); if(!m||seen.has(r.id)) continue;
    seen.add(r.id);
    const localId=r.number?r.number.split('/')[0]:'—';
    const imgSrc=m.limitless&&r.number?limitlessJpUrl(m.limitless,r.number):null;
    state._tmsCardPokemon.set(r.id,pokeName);
    cards.push({id:r.id,pokeName,setId:r.setKey,setName:m.name,releaseDate:m.date||'1999/01/01',localId,lang:'JP',langColor:'#4527a0',imgSrc,hiSrc:null,symSrc:m.sym||null,imgKey:jpImageKeyFor(r.setKey,r.numKey)});
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

  popupPrints.clear();
  for(const c of visible){
    const list=printsOf(c.variants);
    if(tracksPrints(list)) popupPrints.set(c.id,list);
  }
  const pv=state.printView;

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
      const list=pv!=='off'?popupPrints.get(c.id):null;
      // Tiles view: one tile per print, in place of the card's single tile.
      if(list&&pv==='tiles'){ list.forEach(pr=>grid.appendChild(tmsPopupTile(c,pokeName,pr,null))); return; }
      grid.appendChild(tmsPopupTile(c,pokeName,null,list));
    });
  });

  body.appendChild(grid);

  // Update subtitle
  const inc=tmsCountForPoke(pokeName);
  if(subEl) subEl.textContent=`${inc} card${inc===1?'':'s'} in TMS · ${visible.length} visible`;
}

/**
 * One popup tile: a card, or (tiles view) one print `pr` of it. `chips` is the card's
 * print list when the chips view should give it a chip row.
 */
function tmsPopupTile(c,pokeName,pr,chips){
  const id=pr?printId(c.id,pr.key):c.id;
  const isIn=pr?state.tmsPrints.has(id):state.tmsIncluded.has(c.id);
  const el=document.createElement('div'); el.className='tms-popup-card'+(pr?' card-print':'')+(isIn?' tms-in':''); el.dataset.id=id;
  if(pr){ el.dataset.card=c.id; el.dataset.print=pr.key; }
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
  // A JP card falls back to our hosted copy when Limitless has none (or 403s).
  const srcs=viableSources([c.imgSrc, c.imgKey?localImage(c.imgKey,'low'):null].filter(Boolean));
  if(srcs.length){
    ph.classList.add('ph-over');
    const img=document.createElement('img'); img.className='card-img';
    img.loading='lazy'; img.decoding='async'; img.fetchPriority='low';
    img.alt=`${pokeName} #${c.localId} ${c.lang}`;
    let i=0;
    img.onload=()=>{ ph.remove(); markGood(srcs[i]); };
    img.onerror=()=>{ markBad(srcs[i]); if(++i<srcs.length){ img.src=srcs[i]; return; } img.remove(); ph.classList.remove('ph-over'); };
    img.src=srcs[0];
    wrap.appendChild(img);
  }
  const footer=document.createElement('div'); footer.className='card-footer';
  // With prints tracked, the chips / the print tag say what the badges did.
  const badges=(pr||chips)?'':variantBadgesHtml(c.variants);
  footer.innerHTML=`<span class="card-num">#${escapeHtml(c.localId)}</span>${badges}<span class="lang" style="background:${escapeHtml(c.langColor)}">${escapeHtml(c.lang)}</span>`;
  if(pr) footer.insertBefore(mkPrintTag(pr),footer.querySelector('.lang'));
  el.appendChild(wrap);
  if(chips) el.appendChild(mkPrintChips(chips));
  el.appendChild(footer);
  syncTmsTile(el);
  el.onclick=e=>{
    const chip=e.target.closest('.pchip');
    if(chip){ toggleTmsPrint(c.id,chip.dataset.key,[el],pokeName); return; }
    if(pr) toggleTmsPrint(c.id,pr.key,null,pokeName);
    else toggleTmsCard(c.id,el,pokeName);
  };
  return el;
}

// ── TMS: Toggle a single card in/out of TMS ───────────────────────────────────
function toggleTmsCard(cardId,el,pokeName){
  // applyCard: excluding a card also drops the prints of it you had included.
  const on=!state.tmsIncluded.has(cardId);
  applyCard(state.tmsIncluded,state.tmsPrints,cardId,on);
  if(on) state._tmsCardPokemon.set(cardId,pokeName||state._tmsOpenPoke);
  syncTmsTile(el);
  afterTmsToggle();
}

/**
 * Include/exclude one print. `tiles` are the elements to re-sync — the chip's own tile,
 * or null for every print tile of the card (tiles view: one tick can change a sibling's
 * "which print?" hint).
 */
function toggleTmsPrint(cardId,printKey,tiles,pokeName){
  const on=!state.tmsPrints.has(printId(cardId,printKey));
  applyPrint(state.tmsIncluded,state.tmsPrints,cardId,printKey,on,popupKeys(cardId));
  if(on) state._tmsCardPokemon.set(cardId,pokeName||state._tmsOpenPoke);
  const els=tiles||[...document.querySelectorAll(`#tms-popup-body .tms-popup-card[data-card="${CSS.escape(cardId)}"]`)];
  els.forEach(syncTmsTile);
  afterTmsToggle();
}

function afterTmsToggle(){
  saveTmsPrints();
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
  // In the tiles view a print tile is what you see, so "include all" includes every print.
  const everyPrint=include&&state.printView==='tiles';
  visible.forEach(c=>{
    if(include){
      state.tmsIncluded.add(c.id); state._tmsCardPokemon.set(c.id,state._tmsOpenPoke);
      if(everyPrint){
        const keys=popupKeys(c.id);
        for(const k of keys) applyPrint(state.tmsIncluded,state.tmsPrints,c.id,k,true,keys);
      }
    }
    else state.tmsIncluded.delete(c.id);
  });
  // Excluded cards lose their prints — one pass, not one per card.
  if(!include) clearPrintsOf(state.tmsPrints,new Set(visible.map(c=>c.id)));
  saveTmsPrints();
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
  if(el&&state.appMode==='tms'){
    el.textContent=`${t} card${t===1?'':'s'} included`;
    if(state.printView!=='off'){
      // A TMS has no fixed size, so no denominator: this is the number of binder slots —
      // one per included print, one per included card with no print chosen.
      const sp=document.createElement('span'); sp.className='stats-prints';
      const n=slotCount(state.tmsIncluded,state.tmsPrints);
      sp.textContent=` · ${n} print${n===1?'':'s'}`;
      el.appendChild(sp);
    }
  }
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
  state.tmsIncluded.clear(); state.tmsPrints.clear();
  saveTmsPrints(); saveTms();
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
  // With prints on, the sheet prints one cell per included print (print.js).
  const n=state.printView!=='off'?slotCount(state.tmsIncluded,state.tmsPrints):state.tmsIncluded.size;
  btn.textContent=`Print selected (${n})`;
}

/** Re-render the open popup in the current print view (js/ui/printview.js). */
function rerenderTmsPopup(){
  if(state._tmsOpenPoke) renderTmsPopupCards(state._tmsOpenPoke);
  updateTmsPrintSelBtn();
  _updateTmsStats();
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
  resetTms, clearTmsCache, closeTmsPopup, rerenderTmsPopup,
};
