// =============================================================================
// ui/masterset.js — Master-Set mode: render + interactions.
//
// Owns: the per-set / per-era card grid (renderBySet), language filter pills,
// Pokémon chips + suggestions, the image-wrap/placeholder builders, the JP card
// injection (fetches via legacy, builds the DOM here), the data orchestrator
// (buildAll), refresh/clear/reset/sort, and the image preview modal.
//
// Ported from the old single-file tool. Per the project's state-object rule,
// bare state names were rewritten to `state.<name>` (checked → state.checked,
// activeLangs → state.activeLangs, _meta/_bulbaData/setBlockNamesMap/totalCards,
// sortDesc, pokemonList, dismissedBanners). Persistence + cache helpers and all
// data fetching are imported (state.js, legacy.js); URL builders from images.js.
//
// TMS render and the print modes are NOT here — they are Phase 4.
// =============================================================================

import {
  state, saveChk, savePoke, saveFilter, saveDismissed, saveSort,
  loadCache, saveCache, clearCardCache,
} from '../state.js';
import {
  LANGUAGES, PLACEHOLDER_LANGS, NATIVE_NAMES, BADGE_ORDER, ERA_MAP,
  RELEASE_DATE_OVERRIDES, PTCGIO_SERIES_ERA, POKEMON_CATALOG, CACHE_TTL,
} from '../config.js';
import {
  limitlessIntlUrl, ptcgioToTcgdexSetId, ptcgioToTcgdexLocalId, limitlessJpUrl,
  tcgdexAssetBase, tcgdexSymbolUrl,
} from '../api/images.js';
import { detectNew, JP_BULBA_SET_MAP } from '../api/providers/legacy.js';
import { router } from '../api/router.js';

function visibleCards(){
  return [...document.querySelectorAll('.card[data-id]')].filter(c=>!c.classList.contains('lang-hidden'));
}

function updateStats(){
  const vis = visibleCards();
  const visChecked = vis.filter(c=>c.classList.contains('done')).length;
  document.getElementById('stats').textContent=`${visChecked} / ${vis.length} collected`;
  const b=document.getElementById('btn-print-sel'); if(b) b.textContent=`📄 Print Selected (${state.checked.size})`;
}
function resetAll(){
  if(!confirm('Reset all checkboxes?')) return;
  state.checked.clear(); saveChk();
  document.querySelectorAll('.card').forEach(e=>e.classList.remove('done'));
  document.querySelectorAll('.chk').forEach(e=>e.checked=false);
  updateStats();
}

// ── SORT ORDER ────────────────────────────────────────────────────────────────
function updateSortBtn(){
  const btn=document.getElementById('btn-sort'); if(!btn) return;
  btn.textContent = state.sortDesc ? '↓ Newest first' : '↑ Oldest first';
  btn.title = state.sortDesc ? 'Currently: newest sets first. Click to reverse.' : 'Currently: oldest sets first. Click to reverse.';
}
function toggleSort(){
  state.sortDesc = !state.sortDesc;
  saveSort();
  updateSortBtn();
  // Re-render from cache — no network request needed
  const cached = loadCache();
  if(cached && cached.cards){
    const container = document.getElementById('dyn');
    // Save keyed (persistent) banners; let renderBySet re-create them if needed
    // mkBanner will skip any banner whose key already exists in the DOM
    const persistBanners = [...container.querySelectorAll('.banner[data-key]')];
    container.innerHTML = '';
    persistBanners.forEach(b => container.appendChild(b));
    state.setBlockNamesMap.clear(); state.totalCards = 0;
    renderBySet(cached.cards, cached.setNamesAll||{}, container, cached.setMeta||{dates:{},symbols:{}});
    fetchAndInjectJPCards(container).catch(e=>console.warn('JP sort re-inject failed:',e.message));
    buildPills(); updateStats();
  }
}

function attachToggle(el,id){
  const chk=el.querySelector('.chk');
  el.addEventListener('click',e=>{
    // Don't toggle if clicking preview btn or checkbox
    if(e.target.classList.contains('preview-btn')||e.target.classList.contains('chk')) return;
    const n=!chk.checked; chk.checked=n;
    if(n){state.checked.add(id);el.classList.add('done');}else{state.checked.delete(id);el.classList.remove('done');}
    saveChk(); updateStats();
  });
  chk.addEventListener('change',e=>{
    if(e.target.checked){state.checked.add(id);el.classList.add('done');}else{state.checked.delete(id);el.classList.remove('done');}
    saveChk(); updateStats();
  });
  // Preview button
  el.querySelector('.preview-btn')?.addEventListener('click',e=>{ e.stopPropagation(); openPreview(id); });
}

// ── SELECT ALL / SET ──────────────────────────────────────────────────────────
function selectSet(block){
  // Only affect visible (not lang-hidden) cards in this block
  const cards=[...block.querySelectorAll('.card[data-id]')].filter(c=>!c.classList.contains('lang-hidden'));
  const any=cards.some(c=>!c.classList.contains('done'));
  cards.forEach(c=>{
    const id=c.dataset.id; if(!id) return;
    const chk=c.querySelector('.chk');
    if(any){state.checked.add(id);c.classList.add('done');if(chk)chk.checked=true;}
    else{state.checked.delete(id);c.classList.remove('done');if(chk)chk.checked=false;}
  });
  saveChk(); updateStats();
}
function selectAll(){
  // Only affect visible (not lang-hidden) cards
  const all=visibleCards();
  const any=all.some(c=>!c.classList.contains('done'));
  all.forEach(c=>{
    const id=c.dataset.id; const chk=c.querySelector('.chk');
    if(any){state.checked.add(id);c.classList.add('done');if(chk)chk.checked=true;}
    else{state.checked.delete(id);c.classList.remove('done');if(chk)chk.checked=false;}
  });
  saveChk(); updateStats();
  const btn=document.getElementById('btn-select-all'); if(btn) btn.textContent=any?'☐ Deselect All':'☑ Select All';
}

// ── POKÉMON SELECTOR UI ───────────────────────────────────────────────────────
function renderPokeChips(){
  const t=document.getElementById('page-title');
  if(state.appMode==='tms'){
    if(t) t.textContent=`⭐ True Master Set Checklist`;
    return;
  }
  const c=document.getElementById('poke-chips'); if(!c) return; c.innerHTML='';
  state.pokemonList.forEach(name=>{
    const chip=document.createElement('span'); chip.className='poke-chip';
    chip.innerHTML=`${name}<button class="poke-chip-remove" title="Remove ${name}">×</button>`;
    chip.querySelector('button').addEventListener('click',()=>removePoke(name));
    c.appendChild(chip);
  });
  // Update page title
  if(t) t.textContent=`🌿 ${state.pokemonList.join(' · ')} — Master Set Checklist`;
}

function addPokeFromInput(){
  const inp=document.getElementById('poke-input'); if(!inp) return;
  const name=inp.value.trim();
  if(!name){return;}
  addPoke(name);
  inp.value=''; hideSuggestions();
}

function addPoke(name){
  const normalized=name.charAt(0).toUpperCase()+name.slice(1).toLowerCase();
  if(!state.pokemonList.includes(normalized)){
    state.pokemonList.push(normalized); savePoke(); renderPokeChips();
    // Pokémon list changed → drop cached cards (+ in-memory Bulbapedia) so we refetch
    clearCardCache();
    state._bulbaData = null;
    buildAll(false);
  }
}

function removePoke(name){
  if(state.pokemonList.length<=1){ alert('You need at least one Pokémon.'); return; }
  state.pokemonList=state.pokemonList.filter(p=>p!==name); savePoke(); renderPokeChips();
  clearCardCache();
  state._bulbaData = null;
  buildAll(false);
}

function onPokeKey(e){
  if(e.key==='Enter'){addPokeFromInput();}
  else if(e.key==='Escape'){hideSuggestions();}
}

function onPokeInput(val){
  if(!val.trim()){hideSuggestions();return;}
  const q=val.toLowerCase();
  const matches=POKEMON_CATALOG.map(p=>p.name).filter(p=>p.toLowerCase().startsWith(q)&&!state.pokemonList.includes(p)).slice(0,8);
  const sug=document.getElementById('poke-suggestions'); if(!sug) return;
  if(!matches.length){hideSuggestions();return;}
  sug.innerHTML=''; sug.classList.add('open');
  matches.forEach(m=>{
    const item=document.createElement('div'); item.className='poke-sug-item'; item.textContent=m;
    item.addEventListener('click',()=>{addPoke(m);document.getElementById('poke-input').value='';hideSuggestions();});
    sug.appendChild(item);
  });
}

function hideSuggestions(){
  const s=document.getElementById('poke-suggestions'); if(s) s.classList.remove('open');
}
document.addEventListener('click',e=>{
  if(!e.target.closest('.poke-input-container')) hideSuggestions();
});

// ── DOM HELPERS ───────────────────────────────────────────────────────────────
const JP_DEF = {badge:'JP', color:'#4527a0'};
function langColor(badge){
  return ([...LANGUAGES,...PLACEHOLDER_LANGS,JP_DEF].find(l=>l.badge===badge)||{}).color||'#555';
}

// Informational print-variant badges (modern eras only; null elsewhere). `variants`
// is TCGdex's {normal,reverse,holo,firstEdition,wPromo}. Normal prints get no badge.
export function variantBadgesHtml(v){
  if(!v) return '';
  const b=[];
  if(v.holo) b.push(['H','Holofoil']);
  if(v.reverse) b.push(['RH','Reverse holo']);
  if(v.firstEdition) b.push(['1ED','First edition']);
  if(v.wPromo) b.push(['P','Promo']);
  if(!b.length) return '';
  return `<span class="vbadges">`+b.map(([t,title])=>`<span class="vbadge" title="${title} variant exists">${t}</span>`).join('')+`</span>`;
}

function mkEra(parent,text,series){
  const e=document.createElement('div'); e.className='era-label'; e.textContent=text;
  if(series) e.dataset.series=series;
  parent.appendChild(e); return e;
}

// mkBanner: optional dismissKey saves dismissal to localStorage
// Also skips creation if a banner with the same key already exists in the DOM.
function mkBanner(parent,html,cls,dismissKey){
  if(dismissKey && state.dismissedBanners.has(dismissKey)) return null;
  if(dismissKey && document.querySelector(`.banner[data-key="${dismissKey}"]`)) return null;
  const e=document.createElement('div'); e.className=`banner ${cls}`;
  if(dismissKey) e.dataset.key=dismissKey;
  const body=document.createElement('div'); body.className='banner-body'; body.innerHTML=html;
  e.appendChild(body);
  if(dismissKey){
    const x=document.createElement('button'); x.className='banner-close'; x.textContent='×'; x.title='Dismiss';
    x.addEventListener('click',()=>{ state.dismissedBanners.add(dismissKey); saveDismissed(); e.remove(); });
    e.appendChild(x);
  }
  parent.appendChild(e); return e;
}

function mkSetBlock(nameHtml,symSrc,headClass,parent){
  const block=document.createElement('div'); block.className='set-block';
  const symEl=symSrc?`<img class="set-symbol" src="${symSrc}" alt="" onerror="this.style.display='none'">`:'' ;
  block.innerHTML=`<div class="set-head ${headClass}"><div class="set-head-left">${symEl}<div class="set-name-block"><span class="set-name-en">${nameHtml}</span></div></div><div class="set-head-right"><span class="set-count">0 entries</span><button class="set-select-btn">☑ Set</button></div></div><div class="cards-grid"></div>`;
  parent.appendChild(block);
  block.querySelector('.set-select-btn').addEventListener('click',e=>{e.stopPropagation();selectSet(block);});
  return block;
}
function updCount(block,n){ const e=block.querySelector('.set-count'); if(e) e.textContent=`${n} ${n===1?'entry':'entries'}`; }

// ── IMAGE WRAP ────────────────────────────────────────────────────────────────
// Priority chain per language:
//   EN:     pokemontcg.io PNG  → TCGdex CDN (fallbackSrc) → placeholder
//   Non-EN: TCGdex CDN (loSrc) → placeholder
//   JP:     handled separately in fetchAndInjectJPCards
//
// fallbackSrc: optional secondary URL tried when loSrc fails (used for EN TCGdex fallback)
function mkImgWrap(loSrc,hiSrc,cardName,localId,enSetName,symSrc,badge,bColor,cardId,fallbackSrc=null){
  const wrap=document.createElement('div'); wrap.className='img-wrap';

  function showPh(){
    const nat=(NATIVE_NAMES[badge]||{})[cardName]||null;
    wrap.innerHTML=buildPlaceholderHTML(symSrc,badge,bColor,cardName,nat,enSetName,localId,true);
    wrap.querySelector('.img-retry-btn')?.addEventListener('click',e=>{e.stopPropagation();tryPrimary();});
  }

  function tryFallback(){
    // TCGdex CDN fallback (used when primary pokemontcg.io image fails for EN)
    if(!fallbackSrc){ showPh(); return; }
    wrap.innerHTML='';
    const fb=document.createElement('img');
    fb.className='card-img'; fb.loading='lazy'; fb.alt=`${cardName} #${localId} ${badge}`;
    fb.src=fallbackSrc;
    fb.onload=()=>{ const m=state._meta.get(cardId); if(m){ m.isCustom=false; m.imgSrc=fallbackSrc; } };
    fb.onerror=()=>{ fb.remove(); showPh(); };
    wrap.appendChild(fb);
  }

  function tryPrimary(){
    wrap.className='img-wrap'; wrap.innerHTML='';
    if(!loSrc){ showPh(); return; }
    const img=document.createElement('img');
    img.className='card-img'; img.loading='lazy';
    img.alt=`${cardName} #${localId} ${badge}`; img.src=loSrc;
    img.onload=()=>{ const m=state._meta.get(cardId); if(m) m.isCustom=false; };
    img.onerror=()=>{ img.remove(); tryFallback(); };
    wrap.appendChild(img);
  }

  tryPrimary(); return wrap;
}

function buildPlaceholderHTML(symSrc,badge,bColor,cardName,nativeName,setName,localId,showRetry){
  const sym=symSrc?`<img class="cp-symbol" src="${symSrc}" alt="" onerror="this.style.display='none'">`:'' ;
  const nat=nativeName?`<span class="cp-native">${nativeName}</span>`:'';
  const retry=showRetry?`<button class="img-retry-btn">↺ retry</button>`:'';
  return `<div class="custom-placeholder">${sym}<span class="cp-lang" style="background:${bColor}">${badge}</span><span class="cp-name">${cardName}</span>${nat}<span class="cp-set">${setName}</span><span class="cp-num">#${localId}</span>${retry}</div>`;
}

// ── BUILD SETS MAP ────────────────────────────────────────────────────────────
// Handles both pokemontcg.io cards (primary) and TCGdex cards (fallback).
// pokemontcg.io card structure: { id, name, number, set:{id,name,series,releaseDate,images}, images:{small,large} }
// TCGdex card structure:        { id, name, image:"https://assets.tcgdex.net/en/..." }
function isPtcgioCard(card){ return !!card.set?.id; }

function buildSetsMap(enCards, setNamesAll, setMeta = { dates: {}, symbols: {} }){
  const map = new Map();
  for(const card of enCards){
    let ptcgioSetId, series, tcgdexSetId, localId, tcgdexLocalId,
        enName, releaseDate, symSrc, enImgSrc, enHiImgSrc;

    let era; // used for ERA_MAP display grouping (separate from TCGdex CDN series)
    if(isPtcgioCard(card)){
      // ── pokemontcg.io path ──
      ptcgioSetId  = card.set.id;                         // "swsh11", "sv5", "me1"
      // series = TCGdex CDN prefix, always derived from set ID (e.g. "me" not "xy" for me1)
      series       = ptcgioSetId.replace(/\d.*$/,'');     // "swsh","sv","me","bw","xy"...
      // era = display grouping, uses pokemontcg.io series name for consistent era labels
      era          = PTCGIO_SERIES_ERA[card.set.series] || series;
      tcgdexSetId  = ptcgioToTcgdexSetId(ptcgioSetId);   // "swsh11","sv05","me01"...
      localId      = card.number || '';                   // "13", "003", "XY23"
      tcgdexLocalId= ptcgioToTcgdexLocalId(localId, series);
      enName       = card.set.name;
      releaseDate  = RELEASE_DATE_OVERRIDES[card.set.id] || card.set.releaseDate || '1999/01/01';
      symSrc       = card.set.images?.symbol ||
                     `https://images.pokemontcg.io/${ptcgioSetId}/symbol.png`;
      enImgSrc     = card.images?.small  || null;
      enHiImgSrc   = card.images?.large  || null;
    } else {
      // ── TCGdex fallback path ──
      if(!card.image) continue;
      const stripped = card.image.replace(/^https?:\/\/assets\.tcgdex\.net\/[^/]+\//, '');
      const parts = stripped.split('/').filter(Boolean);
      if(parts.length < 2) continue;
      series       = parts[0];
      era          = PTCGIO_SERIES_ERA[series] || series;
      tcgdexSetId  = ptcgioSetId = parts[1];
      localId      = tcgdexLocalId = parts[2] || '';
      releaseDate  = setMeta.dates[tcgdexSetId] || '1999/01/01';
      enName       = (setNamesAll['en']||{})[tcgdexSetId] || tcgdexSetId;
      symSrc       = setMeta.symbols[tcgdexSetId] || tcgdexSymbolUrl(series, tcgdexSetId);
      enImgSrc     = `${card.image}/low.webp`;
      enHiImgSrc   = `${card.image}/high.webp`;
    }

    if(!map.has(ptcgioSetId)){
      const namesByBadge = {};
      for(const lang of LANGUAGES){
        namesByBadge[lang.badge] = (setNamesAll[lang.code]||{})[tcgdexSetId] || enName;
      }
      for(const pl of PLACEHOLDER_LANGS) namesByBadge[pl.badge] = enName;
      namesByBadge['JP'] = enName;
      const allUnique = [...new Set(Object.values(namesByBadge))];
      map.set(ptcgioSetId,{
        setId:ptcgioSetId, tcgdexSetId, series, era, enName, releaseDate,
        combined: allUnique.join(' | '), namesByBadge, symSrc, cards:[]
      });
    }
    map.get(ptcgioSetId).cards.push({
      localId, tcgdexLocalId, series,
      setId:ptcgioSetId, tcgdexSetId,
      // Unified checklist id = TCGdex format ("sv05-163") for BOTH providers, so a
      // checkmark survives a TCGdex↔legacy switch. For TCGdex cards this equals
      // card.id; for legacy cards it normalizes the pokemontcg.io id to TCGdex.
      name:card.name, id:`${tcgdexSetId}-${tcgdexLocalId}`,
      enImgSrc, enHiImgSrc,
      ptcgoCode: card.ptcgoCode||null,
      variants: card.variants||null,   // {normal,reverse,holo,firstEdition,wPromo} on modern eras, else null
    });
  }
  return map;
}

// Extract a sortable numeric key from a set ID so sets within an era sort correctly.
// e.g. "swsh11" → 11, "sv05" → 5, "sv5M" → 5.13, "xyp" → 0
function renderBySet(enCards, setNamesAll, container, setMeta = { dates: {}, symbols: {} }){
  if(!enCards.length) return;

  const setsMap=buildSetsMap(enCards,setNamesAll,setMeta);
  // Group by ERA for display — use si.era so that e.g. "me" sets appear under XY Era
  const bySeries=new Map();
  setsMap.forEach(si=>{
    const key=si.era||si.series;
    if(!bySeries.has(key)) bySeries.set(key,[]);
    bySeries.get(key).push(si);
  });

  // Placeholder lang banners (dismissible)
  for(const pl of PLACEHOLDER_LANGS){
    const links=pl.sources.map(s=>`<a href="${s.url}" target="_blank" style="color:inherit;font-weight:bold">${s.name}</a>`).join(' · ');
    mkBanner(container,`<strong>${pl.label} (${pl.badge})</strong>: ${pl.note} — ${links}`,'banner-amber',`plang-${pl.badge}`);
  }

  // Sort eras and sets by actual release date from pokemontcg.io
  function relDate(si){ return new Date(si.releaseDate||'1999/01/01').getTime(); }

  const eraEntries = [...bySeries.entries()].sort((a,b)=>{
    const aDate = Math.min(...a[1].map(relDate));
    const bDate = Math.min(...b[1].map(relDate));
    return state.sortDesc ? bDate - aDate : aDate - bDate;
  });

  eraEntries.forEach(([series, sets])=>{
    const sortedSets = [...sets].sort((a,b)=>{
      const diff = relDate(a) - relDate(b);
      return state.sortDesc ? -diff : diff;
    });

    mkEra(container,ERA_MAP[series]||series||'Other Sets',series);
    sortedSets.forEach(si=>{
      try{
      const block=mkSetBlock(si.combined,si.symSrc,'c-green',container);
      block.dataset.releaseDate=relDate(si); // used by JP sort insertion
      state.setBlockNamesMap.set(block,{namesByBadge:si.namesByBadge,enName:si.enName});
      const grid=block.querySelector('.cards-grid');
      let count=0;

      // Group cards by Pokémon name (preserving natural order)
      const byPokemon=new Map();
      si.cards.forEach(card=>{
        if(!byPokemon.has(card.name)) byPokemon.set(card.name,[]);
        byPokemon.get(card.name).push(card);
      });

      byPokemon.forEach((cards,pokeName)=>{
        // Pokémon name divider — all names inline
        const altNames=[...new Set([
          NATIVE_NAMES.JP?.[pokeName],
          NATIVE_NAMES.TW?.[pokeName],
          NATIVE_NAMES.KR?.[pokeName],
        ].filter(Boolean))].join(' · ');
        const divider=document.createElement('div');
        divider.className='poke-divider';
        divider.innerHTML=`${pokeName}${altNames?` <span class="poke-divider-names-alt">· ${altNames}</span>`:''}`;
        grid.appendChild(divider);

        cards.forEach(card=>{
          // TCGdex languages
          for(const langDef of LANGUAGES){
            const id=`${langDef.badge}_${card.id}`, isDone=state.checked.has(id);
            // All languages: Limitless TPCI CDN primary → fallback → placeholder
            // EN fallback: pokemontcg.io PNG; non-EN fallback: TCGdex CDN
            let loSrc, hiSrc, fallbackSrc;
            const limitlessSrc = limitlessIntlUrl(card.ptcgoCode, card.localId, langDef.badge);
            if(langDef.badge==='EN'){
              loSrc = limitlessSrc || card.enImgSrc;
              hiSrc = limitlessSrc || card.enHiImgSrc || card.enImgSrc;
              fallbackSrc = limitlessSrc ? (card.enImgSrc||null) : `${tcgdexAssetBase('en', card.series, card.tcgdexSetId, card.tcgdexLocalId)}/low.webp`;
            } else {
              const tcgdexBase=tcgdexAssetBase(langDef.code, card.series, card.tcgdexSetId, card.tcgdexLocalId);
              loSrc = limitlessSrc || `${tcgdexBase}/low.webp`;
              hiSrc = limitlessSrc || `${tcgdexBase}/high.webp`;
              fallbackSrc = limitlessSrc ? `${tcgdexBase}/low.webp` : null;
            }
            state._meta.set(id,{name:{en:card.name,native:(NATIVE_NAMES[langDef.badge]||{})[card.name]||null},setName:si.enName,num:`#${card.localId}`,lang:langDef.badge,langColor:langDef.color,imgSrc:loSrc,hiImgSrc:hiSrc,isCustom:true,symSrc:si.symSrc});
            const el=document.createElement('div');
            el.className='card'+(isDone?' done':''); el.dataset.id=id; el.dataset.lang=langDef.badge;
            // EN: TCGdex fallback; non-EN: TCGdex fallback when Limitless fails
            const enFallback = fallbackSrc;
            const iw=mkImgWrap(loSrc,hiSrc,card.name,card.localId,si.enName,si.symSrc,langDef.badge,langDef.color,id,enFallback);
            const footer=document.createElement('div'); footer.className='card-footer';
            const chk=document.createElement('input'); chk.type='checkbox'; chk.className='chk';
            if(isDone) chk.checked=true; chk.onclick=e=>e.stopPropagation();
            footer.innerHTML=`<span class="card-num">#${card.localId}</span>${variantBadgesHtml(card.variants)}<span class="lang lang-${langDef.badge}">${langDef.badge}</span><button class="preview-btn" title="Preview">🔍</button>`;
            footer.appendChild(chk); el.appendChild(iw); el.appendChild(footer);
            attachToggle(el,id); grid.appendChild(el); count++;
          }
          // Placeholder langs (KR, SC)
          for(const pl of PLACEHOLDER_LANGS){
            const id=`${pl.badge}_${card.id}`, isDone=state.checked.has(id);
            const nat=(NATIVE_NAMES[pl.badge]||{})[card.name]||null;
            state._meta.set(id,{name:{en:card.name,native:nat},setName:si.enName,num:`#${card.localId}`,lang:pl.badge,langColor:pl.color,imgSrc:null,isCustom:true,symSrc:si.symSrc});
            const el=document.createElement('div');
            el.className='card'+(isDone?' done':''); el.dataset.id=id; el.dataset.lang=pl.badge;
            const phWrap=document.createElement('div'); phWrap.className='img-wrap';
            phWrap.innerHTML=buildPlaceholderHTML(si.symSrc,pl.badge,pl.color,card.name,nat,si.enName,card.localId,false);
            const footer=document.createElement('div'); footer.className='card-footer';
            const chk=document.createElement('input'); chk.type='checkbox'; chk.className='chk';
            if(isDone) chk.checked=true; chk.onclick=e=>e.stopPropagation();
            footer.innerHTML=`<span class="card-num">#${card.localId}</span><span class="lang" style="background:${pl.color}">${pl.badge}</span><button class="preview-btn" title="Preview">🔍</button>`;
            footer.appendChild(chk); el.appendChild(phWrap); el.appendChild(footer);
            attachToggle(el,id); grid.appendChild(el); count++;
          }
        });
      });

      state.totalCards+=count; updCount(block,count);
      }catch(setErr){ console.error('Error rendering set',si.setId,':',setErr); }
    });
  });
  updateStats();
}

// ── LANGUAGE FILTER ───────────────────────────────────────────────────────────
function buildPills(){
  const c=document.getElementById('filter-pills'); if(!c) return; c.innerHTML='';
  const present=new Set([...document.querySelectorAll('.card[data-lang]')].map(x=>x.dataset.lang));
  // Reset state.activeLangs if empty OR if the saved set has no overlap with cards present
  // (stale localStorage from a previous Pokémon selection, for example)
  const overlap=[...activeLangs].filter(b=>present.has(b));
  if(state.activeLangs.size===0||overlap.length===0) state.activeLangs=new Set([...present]);
  const langLabel=badge=>{
    const l=LANGUAGES.find(x=>x.badge===badge)||PLACEHOLDER_LANGS.find(x=>x.badge===badge);
    if(l) return l.label;
    if(badge==='JP') return 'Japanese';
    return badge;
  };
  BADGE_ORDER.filter(b=>present.has(b)).forEach(badge=>{
    const p=document.createElement('button');
    p.className='filter-pill'+(state.activeLangs.has(badge)?' active':'');
    p.textContent=badge; p.style.background=langColor(badge);
    p.title=langLabel(badge);
    p.addEventListener('click',()=>{
      if(state.activeLangs.has(badge)){state.activeLangs.delete(badge);p.classList.remove('active');}
      else{state.activeLangs.add(badge);p.classList.add('active');}
      saveFilter(); applyFilter();
    });
    c.appendChild(p);
  });
  applyFilter();
}

function toggleAllFilter(){
  const present=new Set([...document.querySelectorAll('.card[data-lang]')].map(x=>x.dataset.lang));
  const allActive=[...present].every(b=>state.activeLangs.has(b));
  if(allActive){
    state.activeLangs.clear();
    document.querySelectorAll('.filter-pill').forEach(p=>p.classList.remove('active'));
  } else {
    state.activeLangs=new Set([...present]);
    document.querySelectorAll('.filter-pill').forEach(p=>p.classList.add('active'));
  }
  saveFilter(); applyFilter();
}

function applyFilter(){
  document.querySelectorAll('.card[data-lang]').forEach(c=>
    c.classList.toggle('lang-hidden',!state.activeLangs.has(c.dataset.lang)));

  // Hide poke-dividers if every card until the next divider is hidden
  document.querySelectorAll('.poke-divider').forEach(div=>{
    let sib=div.nextElementSibling, allHidden=true;
    while(sib && !sib.classList.contains('poke-divider')){
      if(sib.classList.contains('card') && !sib.classList.contains('lang-hidden')){ allHidden=false; break; }
      sib=sib.nextElementSibling;
    }
    div.style.display=allHidden?'none':'';
  });

  document.querySelectorAll('.set-block').forEach(b=>{
    const cards=b.querySelectorAll('.card[data-lang]');
    b.classList.toggle('all-hidden',cards.length>0&&![...cards].some(c=>!c.classList.contains('lang-hidden')));
  });
  document.querySelectorAll('.era-label').forEach(lbl=>{
    let s=lbl.nextElementSibling,v=false;
    while(s&&!s.classList.contains('era-label')){
      if(s.classList.contains('set-block')&&!s.classList.contains('all-hidden')){v=true;break;}
      s=s.nextElementSibling;
    }
    lbl.classList.toggle('era-hidden',!v);
  });
  // Update set headers to show only active language names
  state.setBlockNamesMap.forEach(({namesByBadge,enName},block)=>{
    const nameEl=block.querySelector('.set-name-en'); if(!nameEl) return;
    const names=[...new Set(
      BADGE_ORDER.filter(b=>state.activeLangs.has(b)&&namesByBadge[b]).map(b=>namesByBadge[b])
    )];
    nameEl.textContent=names.length>0?names.join(' | '):enName;
  });
  updateStats();
}

// ── CACHE ─────────────────────────────────────────────────────────────────────
function cacheAge(ts){
  const m=Math.floor((Date.now()-ts)/60000), h=Math.floor(m/60), dd=Math.floor(h/24);
  return dd>0?`${dd}d ago` : h>0?`${h}h ago` : m>0?`${m}m ago` : 'just now';
}
function updRefreshBtn(ts){
  const btn=document.getElementById('btn-refresh'); if(!btn) return;
  btn.disabled=false;
  btn.textContent=ts?`↺ Refresh (${cacheAge(ts)})`:'↺ Refresh';
  btn.title=ts?`Cached ${new Date(ts).toLocaleString()} — click to re-fetch`:'Fetch data from TCGdex';
}


// ── FETCH ─────────────────────────────────────────────────────────────────────
//
// Architecture:
//   Source of truth for card lists → Bulbapedia (CORS OK, has EN + JP)
//   EN images   → pokemontcg.io PNG  (primary) → TCGdex CDN (fallback) → placeholder
//   JP images   → Limitless CDN      (primary) → placeholder
//   Other langs → TCGdex CDN         (primary) → placeholder
//
// Language mapping:
//   JP is NOT hardcoded — card discovery is automatic via Bulbapedia wikitext.
//   JP_BULBA_SET_MAP is a static data table (set names → Limitless codes + metadata)
//   that only needs updating when new JP sets are released. The fetch/parse/inject
//   pipeline itself is fully dynamic.

// Parse EN card entries from Bulbapedia wikitext.
// Each {{card list/release}} block yields {pokemonName, enSet, num}.
async function fetchAndInjectJPCards(container){
  // 1. JP lists come only from Bulbapedia (TCGdex JA is unusable). The router serves
  //    the pre-built data/jp.json snapshot first, falling back to a live fetch.
  const jpCardsData = await router.getJpRaw(state.pokemonList);

  // 2. Parse all JP card entries grouped by JP set name
  // jpSets: Map<bulbaSetName, {meta, cards:[{enName,jpnum,cardId}]}>
  const jpSets=new Map();
  let cardIndex=0;
  jpCardsData.forEach(({jpset,jpnum,pokemonName})=>{
    const meta=JP_BULBA_SET_MAP[jpset];
    if(!meta) return; // unknown set — not in our map, skip
    if(!jpSets.has(jpset)) jpSets.set(jpset,{...meta, bulbaName:jpset, cards:[]});
    jpSets.get(jpset).cards.push({enName:pokemonName, jpnum, cardId:`jp_${pokemonName}_${jpset}_${cardIndex++}`});
  });

  if(!jpSets.size) return;

  // 3. Sort sets by release date, respecting state.sortDesc
  const sortedSets=[...jpSets.values()].sort((a,b)=>{
    const diff=new Date(a.date)-new Date(b.date);
    return state.sortDesc?-diff:diff;
  });

  // 4. Inject each JP set block into the correct era
  sortedSets.forEach(si=>{
    // Find era label in DOM
    const eraLabel=container.querySelector(`.era-label[data-series="${si.era}"]`);
    let insertBefore=null;
    if(eraLabel){
      // Find correct insertion point by comparing JP set date vs EN set dates in this era
      const jpDate=new Date(si.date).getTime();
      let sib=eraLabel.nextElementSibling;
      while(sib&&!sib.classList.contains('era-label')){
        if(sib.classList.contains('set-block')){
          const sibDate=parseInt(sib.dataset.releaseDate||'0',10);
          if(state.sortDesc ? sibDate < jpDate : sibDate > jpDate){ insertBefore=sib; break; }
        }
        sib=sib.nextElementSibling;
      }
      // If no insertion point found within era, insert before next era
      if(!insertBefore){
        let s2=eraLabel.nextElementSibling;
        while(s2&&!s2.classList.contains('era-label')) s2=s2.nextElementSibling;
        insertBefore=s2;
      }
    }

    const block=document.createElement('div'); block.className='set-block';
    const symEl=si.sym?`<img class="set-symbol" src="${si.sym}" alt="" onerror="this.style.display='none'">`:'' ;
    block.innerHTML=`<div class="set-head c-orange"><div class="set-head-left">${symEl}<div class="set-name-block"><span class="set-name-en">${si.bulbaName} <span style="font-size:9px;opacity:.7">(JP)</span></span></div></div><div class="set-head-right"><span class="set-count">0 entries</span><button class="set-select-btn">☑ Set</button></div></div><div class="cards-grid"></div>`;
    if(insertBefore) container.insertBefore(block,insertBefore);
    else container.appendChild(block);
    block.querySelector('.set-select-btn').addEventListener('click',e=>{e.stopPropagation();selectSet(block);});
    state.setBlockNamesMap.set(block,{namesByBadge:{JP:si.bulbaName},enName:si.bulbaName});

    const grid=block.querySelector('.cards-grid');
    let count=0;

    // Group cards by Pokémon
    const byPokemon=new Map();
    si.cards.forEach(c=>{
      if(!byPokemon.has(c.enName)) byPokemon.set(c.enName,[]);
      byPokemon.get(c.enName).push(c);
    });

    byPokemon.forEach((cards,enName)=>{
      const jpNat=NATIVE_NAMES.JP?.[enName]||'';
      const divider=document.createElement('div'); divider.className='poke-divider';
      divider.innerHTML=`${enName}${jpNat?` <span class="poke-divider-names-alt">· ${jpNat}</span>`:''}`;
      grid.appendChild(divider);

      cards.forEach(({enName,jpnum,cardId})=>{
        const localId=jpnum.split('/')[0]; // "005" from "005/071"
        const id=`JP_${cardId}`, isDone=state.checked.has(id);
        const imgSrc=limitlessJpUrl(si.code,jpnum);
        const jpNatName=NATIVE_NAMES.JP?.[enName]||null;

        state._meta.set(id,{
          name:{en:enName,native:jpNatName},
          setName:si.bulbaName, num:`#${localId}`,
          lang:'JP', langColor:'#4527a0',
          imgSrc, hiImgSrc:imgSrc, isCustom:true, symSrc:si.sym,
        });

        const el=document.createElement('div');
        el.className='card'+(isDone?' done':''); el.dataset.id=id; el.dataset.lang='JP';

        const wrap=document.createElement('div'); wrap.className='img-wrap';
        if(imgSrc){
          const img=document.createElement('img');
          img.className='card-img'; img.loading='lazy';
          img.alt=`${enName} JP #${localId}`; img.src=imgSrc;
          img.onload=()=>{ const mm=state._meta.get(id); if(mm) mm.isCustom=false; };
          img.onerror=()=>{
            img.remove();
            wrap.innerHTML=buildPlaceholderHTML(si.sym,'JP','#4527a0',enName,jpNatName,si.bulbaName,localId,false);
          };
          wrap.appendChild(img);
        } else {
          wrap.innerHTML=buildPlaceholderHTML(si.sym,'JP','#4527a0',enName,jpNatName,si.bulbaName,localId,false);
        }

        const footer=document.createElement('div'); footer.className='card-footer';
        const chk=document.createElement('input'); chk.type='checkbox'; chk.className='chk';
        if(isDone) chk.checked=true; chk.onclick=e=>e.stopPropagation();
        footer.innerHTML=`<span class="card-num">#${localId}</span><span class="lang lang-JP">JP</span><button class="preview-btn" title="Preview">🔍</button>`;
        footer.appendChild(chk); el.appendChild(wrap); el.appendChild(footer);
        attachToggle(el,id); grid.appendChild(el); count++;
      });
    });
    state.totalCards+=count; updCount(block,count);
  });

  state.activeLangs.add('JP'); saveFilter();
  buildPills(); updateStats();
}
async function buildAll(forceRefresh){
  const container=document.getElementById('dyn');
  container.innerHTML=''; state.totalCards=0; state.setBlockNamesMap.clear();

  const loadBanner=mkBanner(container,'⏳ Loading…','banner-load',null);
  const btn=document.getElementById('btn-refresh');
  if(btn){btn.disabled=true;btn.textContent='⏳ Loading…';}

  try{
    const cached=loadCache();
    const fresh=forceRefresh||!cached||(Date.now()-cached.ts)>CACHE_TTL;
    let cards, setNamesAll, setMeta, source;

    if(!fresh){
      cards=cached.cards; setNamesAll=cached.setNamesAll||{};
      setMeta=cached.setMeta||{dates:{},symbols:{}}; source=cached.source||'tcgdex';
      loadBanner.remove();
      mkBanner(container,`✅ Loaded from cache (${cacheAge(cached.ts)}). Click Refresh to check for new cards.`,'banner-blue',null);
    } else {
      loadBanner.querySelector('.banner-body').textContent='⏳ Fetching cards, set names and translations…';
      const cardRes=await router.getCards(state.pokemonList,{forceRefresh});
      cards=cardRes.cards; source=cardRes.source;
      // TCGdex set ids from the fetched cards (e.g. "sv05") → lets getSetMeta fetch
      // accurate release dates for exactly the sets in play.
      const setIds=[...new Set(cards.map(c=>(c&&typeof c.id==='string'&&c.id.includes('-'))?c.id.slice(0,c.id.lastIndexOf('-')):null).filter(Boolean))];
      const metaRes=await router.getSetMeta({forceRefresh,setIds});
      setNamesAll=metaRes.names; setMeta={dates:metaRes.dates||{},symbols:metaRes.symbols||{}};

      if(forceRefresh&&cached){
        const nc=detectNew(cached.cards,cards);
        loadBanner.remove();
        if(nc.length){
          mkBanner(container,`🆕 <strong>${nc.length} new card(s) found</strong>: ${[...new Set(nc.map(c=>c.name))].join(', ')}`,'banner-load',null);
        } else {
          mkBanner(container,'✅ No new cards since last check.','banner-green',null);
        }
      } else { loadBanner.remove(); }

      saveCache({cards,setNamesAll,setMeta,source});
    }

    // Clear any remaining loading banner before rendering
    loadBanner?.remove?.();
    // Non-blocking notice when the primary (TCGdex) was unavailable and the legacy fallback was used.
    if(source==='legacy') mkBanner(container,'⚠️ Showing data from the backup source (TCGdex unavailable). Click Refresh to retry.','banner-amber','src-fallback');
    renderBySet(cards,setNamesAll,container,setMeta);

    // JP: fetch all JP cards, filter by name, inject as own sets with images
    fetchAndInjectJPCards(container).catch(e=>console.warn('JP fetch failed:',e.message));

    updRefreshBtn(loadCache()?.ts);
    buildPills(); updateStats();

  }catch(err){
    if(loadBanner.parentNode) loadBanner.className='banner banner-error';
    if(loadBanner.parentNode) loadBanner.querySelector('.banner-body').innerHTML=`⚠️ Failed: ${err.message} <button id="retry-btn" style="margin-left:8px;padding:2px 8px;cursor:pointer;border-radius:3px;border:1px solid #880e4f;background:#fff;color:#880e4f;font-size:10px;">↺ Retry</button>`;
    loadBanner.querySelector('#retry-btn')?.addEventListener('click',()=>doRefresh());
    if(btn){btn.disabled=false;btn.textContent='↺ Refresh';}
  }
}

function doRefresh(){buildAll(true);}
function clearCache(){
  if(!confirm('Clear all cached card data and reload?')) return;
  clearCardCache();          // removes all tcgData* keys
  state._bulbaData=null;
  location.reload();
}

function showPlaceholderInPreview(content, m, en, nat){
  const ph = buildPlaceholderHTML(m.symSrc, m.lang, m.langColor, en, nat, m.setName, m.num.replace('#',''), false);
  content.innerHTML = `<div class="preview-placeholder">${ph}</div>`;
}

function openPreview(id){
  const m=state._meta.get(id); if(!m) return;
  const overlay=document.getElementById('preview-overlay');
  const content=document.getElementById('preview-content');
  const meta=document.getElementById('preview-meta');
  if(!overlay||!content||!meta) return;

  const en=typeof m.name==='object'?m.name.en:m.name;
  const nat=typeof m.name==='object'?m.name.native:null;

  // Try to show a real image: hi → lo → placeholder
  const hiSrc = m.hiImgSrc || m.imgSrc;
  const loSrc = m.imgSrc || m.hiImgSrc;

  if(hiSrc){
    content.innerHTML='';
    const img=document.createElement('img');
    img.className='preview-img'; img.alt=en;

    function tryLo(){
      if(loSrc && loSrc!==hiSrc){
        img.onerror=()=>{ img.remove(); showPlaceholderInPreview(content,m,en,nat); };
        img.src=loSrc;
      } else {
        img.remove(); showPlaceholderInPreview(content,m,en,nat);
      }
    }

    img.onerror=tryLo;
    img.src=hiSrc;
    content.appendChild(img);
  } else {
    showPlaceholderInPreview(content,m,en,nat);
  }

  meta.innerHTML=`
    <strong>${en}</strong>${nat?` · ${nat}`:''}
    <br>${m.setName} &middot; ${m.num} &middot;
    <span style="background:${m.langColor};color:white;padding:0 5px;border-radius:3px;font-size:10px">${m.lang}</span>
  `.trim();

  overlay.classList.add('open');
}

function closePreview(e){
  if(e && e.target!==document.getElementById('preview-overlay') && !e.target.classList.contains('preview-close')) return;
  document.getElementById('preview-overlay')?.classList.remove('open');
}

document.addEventListener('keydown',e=>{ if(e.key==='Escape') document.getElementById('preview-overlay')?.classList.remove('open'); });

// ── PRINT SELECTED ────────────────────────────────────────────────────────────
// Uses buildPlaceholderHTML (same as main page) so print placeholders match exactly.
// Placeholder CSS is inlined into the print window.

// ── PUBLIC API ────────────────────────────────────────────────────────────────
// main.js calls buildAll/renderPokeChips/updateSortBtn/updateStats directly and
// publishes the inline-onclick handlers on window (see main.js GLOBAL HANDLERS).
// Public API. main.js calls the renders directly + publishes the inline-onclick
// handlers on window; langColor + buildPlaceholderHTML are shared with print.js/tms.js.
export {
  buildAll, renderPokeChips, updateSortBtn, updateStats,
  addPokeFromInput, clearCache, closePreview, doRefresh,
  onPokeInput, onPokeKey, resetAll, selectAll, toggleAllFilter, toggleSort,
  langColor, buildPlaceholderHTML,
};
