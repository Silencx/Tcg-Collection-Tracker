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
  PTCGIO_SERIES_ERA, POKEMON_CATALOG, CACHE_TTL,
} from '../config.js';
import {
  limitlessIntlUrl, ptcgioToTcgdexSetId, ptcgioToTcgdexLocalId, limitlessJpUrl,
  tcgdexAssetBase, tcgdexSymbolUrl,
} from '../api/images.js';
import { detectNew, JP_BULBA_SET_MAP } from '../api/providers/legacy.js';
import { router } from '../api/router.js';
import {
  viableSources, markBad, markGood, loadFirstImage, clearImgFailures,
  imgMeta, metaSources,
} from '../api/img-cache.js';
import { escapeHtml, escapeUrl } from './html.js';
import {
  planGridVisibility, blockAllHidden, estimateGridHeight,
  KIND_CARD, KIND_DIVIDER, KIND_OTHER,
} from './filter-pass.js';
import { setNavReset, setNavRebuild, setNavSync } from './setnav.js';
import { toggleBlockCollapsed, applyCollapseState, resetCollapse } from './collapse.js';
import { ttlFor, cacheAge } from './notify-model.js';
import { record as recordNotice } from './notify.js';
import {
  openPokemonPicker as openPokemonPickerModal, openLanguagePicker, renderLangSummary,
} from './pickers.js';

// Running totals behind the "N / M collected" badge. Nothing recounts by walking
// the document any more: applyFilter is the one place that visits every card, so
// it assigns these outright, and every later mutation adjusts them by a delta.
// (A recount ran on every single checkbox click once, over ~776 cards on the
// default list and ten times that for a popular Pokémon.)
let statVisible = 0, statChecked = 0;

// Per-set tallies from the last applyFilter pass: block → {vis, done}. Populated
// by the pass that was going to compute them anyway, so per-set progress in the
// sidebar — and set-scoped stat deltas below — cost no extra traversal.
// A WeakMap, not a Map: every re-render throws its set blocks away, and a strong
// map would pin all of them — the same unbounded-growth bug the _meta comments
// in toggleSort record.
const blockTallies = new WeakMap();

/** Adjust the running totals for one card whose checked state just changed. */
function bumpStats(delta){
  statChecked += delta;
  renderStats();
}

/** Adjust one block's tally alongside the global one, and tell the sidebar. */
function bumpBlock(block,delta){
  if(!block) return;
  const t=blockTallies.get(block);
  if(t){ t.done+=delta; setNavSync(block,t.vis,t.done,block.classList.contains('all-hidden')); }
}

// EXPLICIT ownership, not "not TMS". #stats is shared by every mode — TMS writes
// 'N cards included' from _updateTmsStats, the dashboard doesn't use it at all — and
// the old `appMode==='tms'` guard meant any mode that wasn't TMS got Master's numbers
// stamped over whatever the mode actually owned.
function renderStats(){
  if(state.appMode!=='master') return;
  const el=document.getElementById('stats');
  if(el){
    // "collected" is in its own element so the phone layout can drop it — at 390px the
    // identity row is within ~10px of wrapping, and this word is the difference.
    el.textContent=`${statChecked} / ${statVisible}`;
    const word=document.createElement('span');
    word.className='stats-word'; word.textContent=' collected';
    el.appendChild(word);
  }
  const b=document.getElementById('btn-print-sel'); if(b) b.textContent=`Print selected (${state.checked.size})`;
}

// Repaint the badge from the running totals. #stats is shared between the two
// modes, and in TMS mode it belongs to _updateTmsStats ('N cards included') —
// renderStats guards on that, mirroring how renderPokeChips branches for the
// page title. main.js calls this when switching back into Master mode, where the
// totals are still whatever the last filter pass left them.
function updateStats(){ renderStats(); }

// Whole-document mutations (reset, select-all) go back through applyFilter rather
// than trying to patch every block's tally by hand: it is a single pass, it is the
// one place that owns these numbers, and it also refreshes the sidebar rows. Both
// are rare, deliberate actions — the per-card and per-set paths below stay deltas.
function resetAll(){
  if(!confirm('Mark every card as not owned?')) return;
  state.checked.clear(); saveChk();
  document.querySelectorAll('.card.done').forEach(e=>{
    e.classList.remove('done');
    e.setAttribute('aria-checked','false');
  });
  applyFilter();
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
    installCardDelegation(container);   // idempotent; guards against a sort before the first buildAll
    // _meta is rebuilt by renderBySet, so it must be cleared alongside
    // setBlockNamesMap — otherwise every sort toggle and Pokémon change leaves
    // the previous render's ids behind. It grew without bound, and the stale ids
    // leaked into the import validator and Print Selected.
    state.setBlockNamesMap.clear(); state._meta.clear(); state.totalCards = 0;
    setNavReset();   // renderBySet rebuilds it; the old rows point at removed blocks
    resetCollapse(); // a re-render starts expanded, or the flag outlives the blocks
    renderBySet(cached.cards, cached.setNamesAll||{}, container, cached.setMeta||{dates:{},symbols:{}});
    fetchAndInjectJPCards(container).catch(e=>console.warn('JP sort re-inject failed:',e.message));
    buildPills();
  }
}

// Card interaction is DELEGATED: click, dblclick and change on #dyn for the whole grid,
// rather than three per card. The demo set alone renders 776 cards (~2,300
// listeners); a popular Pokémon renders tens of thousands. Cards are identified
// by their data-id, which renderBySet already sets, so nothing has to be
// re-bound when the grid re-renders.
function setCardChecked(el,id,on){
  el.classList.toggle('done',on);
  el.setAttribute('aria-checked',on?'true':'false');
  if(on) state.checked.add(id); else state.checked.delete(id);
  // Only count it if the card is currently visible, so the running total keeps
  // matching the "N / M" denominator, which excludes lang-hidden cards.
  if(!el.classList.contains('lang-hidden')){
    const delta=on?1:-1;
    bumpStats(delta);
    // Bounded walk (card → grid → block), not a document query, so the sidebar's
    // per-set progress stays live at the cost of three parentNode hops.
    bumpBlock(el.closest('.set-block'),delta);
  }
  saveChk();
}

function installCardDelegation(container){
  if(!container||container.dataset.delegated) return;
  container.dataset.delegated='1';

  container.addEventListener('click',e=>{
    // Set head → collapse/expand just that set. Delegated like everything else here,
    // which is also what gives the JP blocks injected later the same behaviour with no
    // extra wiring. .set-select-btn stopPropagations so it never reaches this listener;
    // the guard is belt and braces for whoever removes that call.
    const head=e.target.closest?.('.set-head');
    if(head&&container.contains(head)){
      if(e.target.closest('.set-select-btn')) return;
      toggleBlockCollapsed(head.closest('.set-block'));
      return;
    }
    const card=e.target.closest?.('.card[data-id]');
    if(!card||!container.contains(card)) return;
    const id=card.dataset.id;
    if(e.target.classList.contains('preview-btn')){ e.stopPropagation(); openPreview(id); return; }
    // (The per-card checkbox is gone — the tile itself is the toggle, and owning a card
    // is shown by the artwork being in full colour. The two LOAD-BEARING notes that used
    // to live here were both about stopping the checkbox and this handler from toggling
    // the same card twice; with one control there is nothing left to disambiguate.)
    //
    // The second click of a double-click must not toggle: MouseEvent.detail is 2 there.
    // The dblclick listener below undoes the FIRST click's toggle, so a double-click is
    // net-zero on the checklist and just opens the preview.
    if(e.detail>1) return;
    setCardChecked(card,id,!card.classList.contains('done'));
  });

  // Double-click anywhere on a card opens the big preview — the 🔍 button stays for
  // discoverability and for keyboard/touch, but reaching for a 7px target was the
  // complaint. Deliberately NOT implemented by delaying the single click: the core
  // loop here is bulk-checking hundreds of tiles, and 250ms of latency on every check
  // to serve an occasional preview is the wrong trade.
  container.addEventListener('dblclick',e=>{
    const card=e.target.closest?.('.card[data-id]');
    if(!card||!container.contains(card)) return;
    if(e.target.classList.contains('preview-btn')||e.target.classList.contains('img-retry-btn')) return;
    // Revert the toggle the first click of this double already applied.
    setCardChecked(card,card.dataset.id,!card.classList.contains('done'));
    openPreview(card.dataset.id);
  });

  // Keyboard. The tile is role=checkbox now that the real one is gone, so it owes the
  // two keys a checkbox answers to. Space is preventDefault'd or the page scrolls under
  // the grid you are ticking.
  container.addEventListener('keydown',e=>{
    if(e.key!==' '&&e.key!=='Enter') return;
    const card=e.target.closest?.('.card[data-id]');
    if(!card||!container.contains(card)) return;
    e.preventDefault();
    setCardChecked(card,card.dataset.id,!card.classList.contains('done'));
  });
}

// ── SELECT ALL / SET ──────────────────────────────────────────────────────────
function selectSet(block){
  // Only affect visible (not lang-hidden) cards in this block
  const cards=[...block.querySelectorAll('.card[data-id]')].filter(c=>!c.classList.contains('lang-hidden'));
  const any=cards.some(c=>!c.classList.contains('done'));
  let delta=0;
  cards.forEach(c=>{
    const id=c.dataset.id; if(!id) return;
    if(any){ if(!c.classList.contains('done')) delta++;
             state.checked.add(id);c.classList.add('done');c.setAttribute('aria-checked','true'); }
    else{    if(c.classList.contains('done')) delta--;
             state.checked.delete(id);c.classList.remove('done');c.setAttribute('aria-checked','false'); }
  });
  saveChk();
  statChecked+=delta; renderStats(); bumpBlock(block,delta);
}
function selectAll(){
  // Only affect visible (not lang-hidden) cards
  const all=[...document.querySelectorAll('.card[data-id]')].filter(c=>!c.classList.contains('lang-hidden'));
  const any=all.some(c=>!c.classList.contains('done'));
  all.forEach(c=>{
    const id=c.dataset.id;
    if(any){state.checked.add(id);c.classList.add('done');c.setAttribute('aria-checked','true');}
    else{state.checked.delete(id);c.classList.remove('done');c.setAttribute('aria-checked','false');}
  });
  saveChk(); applyFilter();
  const btn=document.getElementById('btn-select-all'); if(btn) btn.textContent=any?'☐ Deselect all':'☑ Select all';
}

// ── POKÉMON SELECTOR UI ───────────────────────────────────────────────────────
// Master Set's chips ONLY. The h1 and the document title used to be decided here with
// an `appMode==='tms'` branch, which made this function the de-facto owner of both for
// every mode — so a third mode would have got Master's title. main.js's applyModeTitle
// owns them now, for all modes, from one table; this returns early anywhere but Master.
function renderPokeChips(){
  if(state.appMode!=='master') return;
  const c=document.getElementById('poke-chips'); if(!c) return; c.innerHTML='';
  // Built as nodes, not markup: pokemonList can come from a shared "#s=" link,
  // which is attacker-controlled. Interpolating it into innerHTML here made a
  // crafted share link run script in the victim's page — with access to their
  // whole localStorage.
  state.pokemonList.forEach(name=>{
    const chip=document.createElement('span'); chip.className='poke-chip';
    chip.appendChild(document.createTextNode(name));
    const rm=document.createElement('button');
    rm.className='poke-chip-remove'; rm.title=`Remove ${name}`; rm.textContent='×';
    rm.addEventListener('click',()=>removePoke(name));
    chip.appendChild(rm);
    c.appendChild(chip);
  });
  // (The h1 stays STATIC rather than listing the Pokémon: it used to be
  // `${names.join(' · ')} — Master Set Checklist`, which grew without bound, while
  // every one of those names is already a removable chip immediately below it. The
  // document title is where the long list IS useful — it names the tab and the bookmark,
  // neither of which competes with the layout for space. Both live in main.js's
  // MODE_TITLE table now; savePoke fires 'tcg:settings-changed', which re-applies them.)
}

/**
 * Everything that has to happen when the tracked-Pokémon list changes, whoever changed
 * it. The picker modal owns the list itself (it writes state.pokemonList and calls
 * savePoke); this is the render half, which is Master Set's business, not the modal's.
 */
export function onPokemonListChanged(){
  renderPokeChips();
  // Pokémon list changed → drop cached cards (+ in-memory Bulbapedia) so we refetch.
  clearCardCache();
  state._bulbaData=null;
  buildAll(false);
}

/** Inline-onclick target: open the add/remove modal. */
export function openPokemonPicker(){
  openPokemonPickerModal(onPokemonListChanged);
}

function removePoke(name){
  if(state.pokemonList.length<=1){ alert('You need at least one Pokémon.'); return; }
  state.pokemonList=state.pokemonList.filter(p=>p!==name); savePoke();
  onPokemonListChanged();
}

// NO normalizePokeName ANY MORE. It existed because the old bar let you TYPE a name, and
// title-casing it by hand got 'Ho-Oh' → 'Ho-oh' and 'Tapu Koko' → 'Tapu koko' — spellings
// the API matches nothing for, so the Pokémon silently returned zero cards. The picker
// only ever hands back a POKEMON_CATALOG entry, which already carries the real casing,
// irregulars included. The prefix-only autocomplete went with it.

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

// ── GRID HEIGHT HINT (content-visibility) ─────────────────────────────────────
// An off-screen .cards-grid contributes contain-intrinsic-block-size instead of
// its real height, so a flat guess makes the scrollbar jump and lands sidebar
// jumps short. Derive the column count from the container's real width ONCE per
// render (grids are built inside a DocumentFragment and would measure 0), then
// give each grid its own estimate. Only the first paint uses it — `auto` remembers
// the true size once a grid has been rendered.
// MEASURES, never mirrors. This used to restate twelve CSS values in JS — tile width,
// gap, grid padding, card padding, the 63.5:88.9 ratio, an assumed footer height — and
// two of them were already wrong: the gap and padding were the desktop figures even on a
// phone, and the card's 2px border was ignored despite box-sizing:border-box. Sizes are
// clamp()-on-vw now and the card's own text scales with the tile, so restating any of it
// is not merely fragile, it is unrepresentable.
//
// Instead: build one real grid holding one real card, let the browser lay it out, read
// the answers back, throw it away. Appended and removed within a single task, so no
// paint happens in between and nothing flickers.
function gridMetrics(container){
  const FALLBACK={cols:7,tilePx:280,gapPx:10,padPx:16,dividerPx:22};
  if(!container) return FALLBACK;

  const probe=document.createElement('div');
  probe.className='cards-grid';
  // .cards-grid carries content-visibility:auto, which would let the browser SKIP
  // laying this out and hand back zeros. Force it to render.
  probe.style.cssText='content-visibility:visible;contain-intrinsic-block-size:auto none;';

  const card=document.createElement('div'); card.className='card';
  const wrap=document.createElement('div'); wrap.className='img-wrap';
  // A div, not an <img>: .card-img is width:100% + aspect-ratio, so it resolves its own
  // height with no source, and this costs no network request.
  const img=document.createElement('div'); img.className='card-img';
  wrap.appendChild(img); card.appendChild(wrap);
  card.appendChild(footerTemplate().cloneNode(true));
  const divider=document.createElement('div'); divider.className='poke-divider'; divider.textContent='M';
  // Card first: .poke-divider:first-child drops its border and padding, which would
  // measure short.
  probe.append(card,divider);
  container.appendChild(probe);

  let m=FALLBACK;
  try{
    const cs=getComputedStyle(probe);
    // On a laid-out grid this resolves auto-fill to a real track list, e.g.
    // "200px 200px 200px …" — column count and cell width for free.
    const tracks=cs.gridTemplateColumns.split(/\s+/).filter(Boolean);
    m={
      cols:Math.max(1,tracks.length),
      tilePx:Math.round(card.getBoundingClientRect().height)||FALLBACK.tilePx,
      gapPx:Math.round(parseFloat(cs.rowGap)||0),
      padPx:Math.round((parseFloat(cs.paddingTop)||0)+(parseFloat(cs.paddingBottom)||0)),
      dividerPx:Math.round(divider.getBoundingClientRect().height)||FALLBACK.dividerPx,
    };
  }catch(e){ /* keep the fallback — a bad hint only costs scroll accuracy */ }
  probe.remove();
  return m;
}
// `groups` is the per-Pokémon card counts. Each divider starts a fresh row, so the
// row count is the sum of each group's rows, not one division of the total.
function setGridHeightHint(grid,cards,dividers,m,groups){
  grid.style.setProperty('--cv-h',estimateGridHeight({cards,dividers,groups,...m})+'px');
}

function mkEra(parent,text,series){
  const e=document.createElement('div'); e.className='era-label'; e.textContent=text;
  if(series) e.dataset.series=series;
  parent.appendChild(e); return e;
}

// mkBanner: optional dismissKey saves dismissal to localStorage
// Also skips creation if a banner with the same key already exists in the DOM.
//
// opts.ttl overrides the classification in notify-model.ttlFor; opts.hasAction marks a
// banner that contains a control the user may want to click, which forces ttl 0.
// Every banner is also RECORDED to the notification log, including ones suppressed as
// already-dismissed — routing them all through one call is what stops the log and the
// page disagreeing about what happened.
function mkBanner(parent,html,cls,dismissKey,opts={}){
  recordNotice(html,cls);
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
  parent.appendChild(e);
  const ttl=opts.ttl!=null?opts.ttl:ttlFor(cls,{dismissKey,hasAction:!!opts.hasAction});
  if(ttl>0) autoDismiss(e,ttl);
  return e;
}

// Fade a transient banner out, PAUSING while the pointer or keyboard focus is on it —
// a 6-second notice on a page someone is mid-read of is otherwise unreadable. Expiry
// is never a loss: the bell keeps a copy of every message.
function autoDismiss(e,ms){
  let timer=0;
  const go=()=>{
    e.classList.add('banner-leaving');
    const done=()=>e.remove();
    e.addEventListener('transitionend',done,{once:true});
    setTimeout(done,400);   // backstop: under prefers-reduced-motion there is no transition to end
  };
  const start=()=>{ clearTimeout(timer); timer=setTimeout(go,ms); };
  const hold=()=>clearTimeout(timer);
  e.addEventListener('pointerenter',hold);
  e.addEventListener('pointerleave',start);
  e.addEventListener('focusin',hold);
  e.addEventListener('focusout',start);
  start();
}

// `nameText` is plain TEXT despite the old parameter name — buildSetsMap joins the
// localized set names with ' | '. It and symSrc both come from remote set metadata,
// so they go in as a text node and a property: interpolated into innerHTML, a quote
// in either would break out of the markup (symSrc landed inside a src="…" attribute
// right next to an inline onerror handler).
function mkSetBlock(nameText,symSrc,headClass,parent){
  const block=document.createElement('div'); block.className='set-block';
  // .set-chevron is a real <button> rather than role=button on the head itself: the
  // head already contains .set-select-btn, and nesting one interactive element inside
  // another is invalid ARIA. A native button also gets Enter and Space for free, and
  // its click bubbles to the head's delegated handler, so there is no keydown code.
  block.innerHTML=`<div class="set-head ${headClass}"><div class="set-head-left"><div class="set-name-block"><span class="set-name-en"></span></div></div><div class="set-head-right"><button class="set-chevron" type="button" aria-expanded="true" aria-label="Collapse this set" title="Collapse this set">▾</button><span class="set-count">0 entries</span><button class="set-select-btn">☑ Set</button></div></div><div class="cards-grid"></div>`;
  block.querySelector('.set-name-en').textContent=nameText;
  if(symSrc){
    const sym=document.createElement('img');
    sym.className='set-symbol'; sym.alt=''; sym.src=symSrc;
    sym.addEventListener('error',()=>{ sym.style.display='none'; });
    block.querySelector('.set-head-left').prepend(sym);
  }
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
//
// PLACEHOLDER-FIRST: the placeholder is painted immediately, and the candidate image
// loads *underneath* it — the placeholder is what gets absolutely positioned (.ph-over),
// not the image. The old order was image-then-placeholder-on-error, so a card sat as an
// empty box for the whole of its image load, and through up to two sequential 404s when
// it had no artwork at all.
//
// The image deliberately keeps its original normal-flow layout: `width:100%` +
// `aspect-ratio` means it reserves its full box even before it decodes (so the wrap
// never collapses), and leaving it unpositioned keeps `loading="lazy"` behaving exactly
// as it did before this change. Overlaying the *image* instead would have altered the
// layout of every lazy image in the grid — not worth the risk for the same visual result.
// speciesName: the Pokémon this card was matched for. NATIVE_NAMES is keyed by
// species, while cardName is the real printed name ("Seedot & Nuzleaf-GX"), so
// the two differ on cameo cards. Defaults to cardName for callers with no species.
// A URL that has already 404'd/403'd is skipped WITHOUT a request (img-cache.js), so
// a language TCGdex holds no artwork for costs one failed request per URL ever
// instead of one per render. `recheck` (the retry button) ignores that memory.
function mkImgWrap(loSrc,cardName,localId,enSetName,symSrc,badge,bColor,cardId,fallbackSrc=null,speciesName=cardName){
  const wrap=document.createElement('div');
  wrap.className='img-wrap';
  const nat=(NATIVE_NAMES[badge]||{})[speciesName]||null;
  const allSources=[loSrc,fallbackSrc].filter(Boolean);

  // Retry is only offered once every candidate has failed — otherwise the button would
  // flash over every card that is merely still loading.
  function addRetry(ph){
    if(!ph||ph.querySelector('.img-retry-btn')) return;
    const btn=document.createElement('button');
    btn.className='img-retry-btn'; btn.textContent='↺ retry';
    // An explicit retry means "I don't believe the cached failure" — clear these
    // URLs' entries so the request is actually re-issued.
    btn.addEventListener('click',e=>{ e.stopPropagation(); start(true); });
    ph.appendChild(btn);
  }

  // Walk the candidate list in order; the first that decodes wins and drops the
  // placeholder. When they are all exhausted the placeholder returns to normal flow
  // (nothing is left to give the wrap its height) and gains the retry button.
  function tryFrom(sources,idx,ph){
    const src=sources[idx];
    if(!src){ ph.classList.remove('ph-over'); addRetry(ph); return; }
    const img=document.createElement('img');
    img.className='card-img';
    // loading/aspect-ratio: see the PLACEHOLDER-FIRST note above — do not change.
    // decoding:async keeps a decode off the main thread; fetchPriority:low keeps
    // hundreds of grid tiles from competing with the page's own requests.
    img.loading='lazy'; img.decoding='async'; img.fetchPriority='low';
    img.alt=`${cardName} #${localId} ${badge}`;
    img.onload=()=>{
      ph.remove();
      markGood(src);
      // Record the OUTCOME, not the guess: preview and print read imgOk so they
      // no longer re-request a URL this tile already proved works (or doesn't).
      const m=state._meta.get(cardId);
      if(m) m.imgOk=src;
    };
    img.onerror=()=>{ img.remove(); markBad(src); tryFrom(sources,idx+1,ph); };
    img.src=src;
    wrap.appendChild(img);
  }

  function start(recheck=false){
    wrap.innerHTML='';
    const ph=mkPlaceholderEl(symSrc,badge,bColor,cardName,nat,enSetName,localId);
    wrap.appendChild(ph);
    const sources=recheck?allSources:viableSources(allSources);
    // Every candidate already known bad → straight to the placeholder, no requests.
    if(!sources.length){ addRetry(ph); return; }
    ph.classList.add('ph-over');
    tryFrom(sources,0,ph);
  }

  start();
  return wrap;
}

// Returns an HTML STRING (not an element) because the print views embed the same
// markup into their generated documents. Every interpolated value is remote or
// user-supplied, so each is escaped here — this one function is the choke point
// for the grid tiles AND for print.
function buildPlaceholderHTML(symSrc,badge,bColor,cardName,nativeName,setName,localId,showRetry){
  const symUrl=escapeUrl(symSrc);
  const sym=symUrl?`<img class="cp-symbol" src="${symUrl}" alt="" onerror="this.style.display='none'">`:'' ;
  const nat=nativeName?`<span class="cp-native">${escapeHtml(nativeName)}</span>`:'';
  const retry=showRetry?`<button class="img-retry-btn">↺ retry</button>`:'';
  return `<div class="custom-placeholder">${sym}<span class="cp-lang" style="background:${escapeHtml(bColor)}">${escapeHtml(badge)}</span><span class="cp-name">${escapeHtml(cardName)}</span>${nat}<span class="cp-set">${escapeHtml(setName)}</span><span class="cp-num">#${escapeHtml(localId)}</span>${retry}</div>`;
}

/**
 * Same placeholder as buildPlaceholderHTML, but returned as a detached ELEMENT so the
 * caller can hold a reference to it (to toggle .ph-over, or remove it once the real
 * image decodes) without re-querying the wrap. Retry is never baked in here — callers
 * add it only after every image source has failed.
 */
//
// The markup is parsed ONCE, at first use, and cloned per card thereafter. It used
// to be parsed per card, through a throwaway wrapper div — together with the two
// card footers that is ~1550 HTML parses for the default Pokémon list, and ten
// times that for a popular one.
//
// The template is derived FROM buildPlaceholderHTML rather than hand-written as DOM
// calls, so the structure cannot drift from the escaping choke point documented
// above (which print.js still consumes as a string). Dummy values are chosen so
// every OPTIONAL node exists in the template; the clone removes the ones a given
// card has no value for. Filling by property assignment means no escaping is
// involved on this path at all.
// The template's dummy symbol src has two hard requirements, both learned the hard
// way. It must SURVIVE escapeUrl (a scheme'd dummy like 'about:blank' is dropped,
// leaving a template with no .cp-symbol node to clone at all), and it must LOAD
// successfully — buildPlaceholderHTML bakes in `onerror="this.style.display='none'"`,
// so any dummy that 404s fires that handler against the TEMPLATE and every clone
// inherits style="display:none", hiding all ~770 set symbols. A 1×1 transparent GIF
// satisfies both: escapeUrl explicitly permits data:image/, and it always decodes.
const PH_TEMPLATE_SYM = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
let phTemplate=null;
function placeholderTemplate(){
  if(!phTemplate){
    const holder=document.createElement('div');
    holder.innerHTML=buildPlaceholderHTML(PH_TEMPLATE_SYM,'X','#000','n','n','s','0',false);
    phTemplate=holder.firstElementChild;
  }
  return phTemplate;
}
function mkPlaceholderEl(symSrc,badge,bColor,cardName,nativeName,setName,localId){
  const el=placeholderTemplate().cloneNode(true);
  const sym=el.querySelector('.cp-symbol');
  // escapeUrl still gates the scheme: it returns '' for anything that could execute,
  // and that must keep meaning "no symbol", exactly as in the string path.
  const symUrl=escapeUrl(symSrc);
  if(sym){
    if(symUrl){
      sym.src=symUrl;
      // Belt and braces: never let a hidden template leak into a clone, whatever
      // the dummy above turns out to do in some future browser.
      sym.removeAttribute('style');
    } else sym.remove();
  }
  const lang=el.querySelector('.cp-lang');
  lang.style.background=bColor; lang.textContent=badge;
  el.querySelector('.cp-name').textContent=cardName;
  const nat=el.querySelector('.cp-native');
  if(nativeName) nat.textContent=nativeName; else nat.remove();
  el.querySelector('.cp-set').textContent=setName;
  el.querySelector('.cp-num').textContent=`#${localId}`;
  return el;
}

// Same idea for the card footer, which all three grid paths built by string.
//
// NO CHECKBOX any more. Owning a card is shown by the ARTWORK: unowned cards render
// desaturated, owned ones in full colour, and the whole tile is the toggle. That reads
// at a glance across a 776-tile grid in a way a 14px tick never did, and it removes the
// tap-target problem the checkbox needed a <label> wrapper to work around.
// The tile carries role="checkbox" + aria-checked so the control is still a control —
// see mkCardShell and the keydown handler in installCardDelegation.
let footerTpl=null;
function footerTemplate(){
  if(!footerTpl){
    const f=document.createElement('div'); f.className='card-footer';
    f.innerHTML='<span class="card-num"></span><span class="lang"></span><button class="preview-btn" title="Preview (or double-click the card)">🔍</button>';
    footerTpl=f;
  }
  return footerTpl;
}
/**
 * @param {string} langClass e.g. 'lang-EN' — the stylesheet carries the colour.
 * @param {string} color inline background, for badges with no stylesheet class
 *   (the placeholder languages, whose colours live in config.js).
 * @param {object} variants TCGdex print variants; modern eras only, so the one
 *   remaining innerHTML parse here is rare.
 */
function mkCardFooter(localId,badge,{langClass=null,color=null,variants=null,isDone=false}={}){
  const f=footerTemplate().cloneNode(true);
  f.querySelector('.card-num').textContent=`#${localId}`;
  const lang=f.querySelector('.lang');
  lang.textContent=badge;
  if(langClass) lang.classList.add(langClass);
  else if(color) lang.style.background=color;
  const vb=variants?variantBadgesHtml(variants):'';
  if(vb){
    const holder=document.createElement('div'); holder.innerHTML=vb;
    f.insertBefore(holder.firstElementChild,lang);
  }
  // isDone is handled by the TILE (.done → full colour + aria-checked), not here.
  return f;
}

/**
 * Make a card tile a real toggle for assistive tech.
 *
 * The visible affordance is now colour, which a screen reader cannot see and a keyboard
 * cannot reach — so the tile takes the role the deleted checkbox used to carry.
 * role=checkbox rather than button: "owned / not owned" is a two-state choice, and that
 * is what aria-checked announces.
 */
function markCardToggle(el,isDone){
  el.setAttribute('role','checkbox');
  el.setAttribute('aria-checked',isDone?'true':'false');
  el.tabIndex=0;
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
      releaseDate  = card.set.releaseDate || '1999/01/01';
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
      // name = the card's real printed name (shown, and grouped on);
      // species = the Pokémon it was matched for (keys NATIVE_NAMES). Providers
      // that don't distinguish the two fall back to name.
      name:card.name, species:card.species||card.name,
      id:`${tcgdexSetId}-${tcgdexLocalId}`,
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
  const gm=gridMetrics(container);
  // Group by ERA for display — use si.era so that e.g. "me" sets appear under XY Era
  const bySeries=new Map();
  setsMap.forEach(si=>{
    const key=si.era||si.series;
    if(!bySeries.has(key)) bySeries.set(key,[]);
    bySeries.get(key).push(si);
  });

  // Placeholder-language notices go to the BELL ONLY — recordNotice, not mkBanner.
  //
  // "Korean cards exist but no public image database yet" is a standing fact about the
  // data, not an event: it was true before you opened the page and will be true after.
  // As an in-flow banner it was two permanent amber strips pinned above the sets on every
  // single render, saying the same thing every time — and mkBanner's dismissKey only hid
  // them until the next Clear cache. The notification log is exactly the right home for a
  // message you read once and go back to when you wonder why KR tiles are blank.
  for(const pl of PLACEHOLDER_LANGS){
    const links=pl.sources.map(s=>`<a href="${s.url}" target="_blank" style="color:inherit;font-weight:bold">${s.name}</a>`).join(' · ');
    recordNotice(`<strong>${pl.label} (${pl.badge})</strong>: ${pl.note} — ${links}`,'banner-amber',{once:`plang-${pl.badge}`});
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

    // Build the whole era detached, then attach it in one go (flushed below).
    const frag=document.createDocumentFragment();
    mkEra(frag,ERA_MAP[series]||series||'Other Sets',series);
    sortedSets.forEach(si=>{
      try{
      const block=mkSetBlock(si.combined,si.symSrc,'c-green',frag);
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

      // Tiles rendered per divider group. Each group starts on a fresh row, so the
      // height estimate needs the per-group counts, not just the total.
      const groups=[];
      byPokemon.forEach((cards,pokeName)=>{
        const groupStart=count;
        // Pokémon name divider — all names inline. NATIVE_NAMES is keyed by
        // SPECIES while the divider shows the card's real printed name, so look
        // up via the species the provider matched ('Nuzleaf' for a card printed
        // 'Seedot & Nuzleaf-GX'), falling back to the displayed name for
        // providers that don't set it.
        const speciesKey=cards[0]?.species||pokeName;
        const altNames=[...new Set([
          NATIVE_NAMES.JP?.[speciesKey],
          NATIVE_NAMES.TW?.[speciesKey],
          NATIVE_NAMES.KR?.[speciesKey],
        ].filter(Boolean))].join(' · ');
        const divider=document.createElement('div');
        divider.className='poke-divider';
        // Nodes, not markup — pokeName is a remote card name (and can originate
        // from a shared link's Pokémon list).
        divider.appendChild(document.createTextNode(pokeName));
        if(altNames){
          const alt=document.createElement('span');
          alt.className='poke-divider-names-alt'; alt.textContent=`· ${altNames}`;
          divider.appendChild(document.createTextNode(' '));
          divider.appendChild(alt);
        }
        grid.appendChild(divider);

        cards.forEach(card=>{
          // NATIVE_NAMES is keyed by species, not by printed card name.
          const spec=card.species||card.name;
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
            state._meta.set(id,{name:{en:card.name,native:(NATIVE_NAMES[langDef.badge]||{})[spec]||null},setName:si.enName,num:`#${card.localId}`,lang:langDef.badge,langColor:langDef.color,...imgMeta([loSrc,fallbackSrc],[hiSrc]),symSrc:si.symSrc});
            const el=document.createElement('div');
            el.className='card'+(isDone?' done':''); el.dataset.id=id; el.dataset.lang=langDef.badge;
            markCardToggle(el,isDone);
            // EN: TCGdex fallback; non-EN: TCGdex fallback when Limitless fails
            // (hiSrc is not passed — mkImgWrap only renders the low-res tile; the
            // high-res candidates reach the preview/print via _meta.hiSources above.)
            const enFallback = fallbackSrc;
            const iw=mkImgWrap(loSrc,card.name,card.localId,si.enName,si.symSrc,langDef.badge,langDef.color,id,enFallback,spec);
            const footer=mkCardFooter(card.localId,langDef.badge,
              {langClass:`lang-${langDef.badge}`,variants:card.variants,isDone});
            el.appendChild(iw); el.appendChild(footer);
            grid.appendChild(el); count++;
          }
          // Placeholder langs (KR, SC)
          for(const pl of PLACEHOLDER_LANGS){
            const id=`${pl.badge}_${card.id}`, isDone=state.checked.has(id);
            const nat=(NATIVE_NAMES[pl.badge]||{})[spec]||null;
            state._meta.set(id,{name:{en:card.name,native:nat},setName:si.enName,num:`#${card.localId}`,lang:pl.badge,langColor:pl.color,...imgMeta([],[]),symSrc:si.symSrc});
            const el=document.createElement('div');
            el.className='card'+(isDone?' done':''); el.dataset.id=id; el.dataset.lang=pl.badge;
            markCardToggle(el,isDone);
            const phWrap=document.createElement('div'); phWrap.className='img-wrap';
            phWrap.appendChild(mkPlaceholderEl(si.symSrc,pl.badge,pl.color,card.name,nat,si.enName,card.localId));
            const footer=mkCardFooter(card.localId,pl.badge,{color:pl.color,isDone});
            el.appendChild(phWrap); el.appendChild(footer);
            grid.appendChild(el); count++;
          }
        });
        groups.push(count-groupStart);
      });

      state.totalCards+=count; updCount(block,count);
      setGridHeightHint(grid,count,byPokemon.size,gm,groups);
      }catch(setErr){ console.error('Error rendering set',si.setId,':',setErr); }
    });
    // One flush per era, not one append per card. mkSetBlock no longer attaches
    // the block itself, so the visible blocks are laid out once instead of being
    // re-laid-out as their 33–3000 cards streamed into the live document.
    container.appendChild(frag);
  });
  setNavRebuild(container,state.setBlockNamesMap);
  // No updateStats() here: buildAll/toggleSort both reach applyFilter via
  // buildPills() immediately after, and that is what owns the totals now.
}

// ── LANGUAGE FILTER ───────────────────────────────────────────────────────────
function buildPills(){
  const c=document.getElementById('filter-pills'); if(!c) return;
  c.innerHTML='';

  const present=new Set([...document.querySelectorAll('.card[data-lang]')].map(x=>x.dataset.lang));

  // Reset state.activeLangs only if the saved set is STALE — non-empty, but with no
  // overlap with the cards actually present (localStorage from a previous Pokémon
  // selection, say). Empty is now a deliberate, reachable choice, not a broken one:
  // it means "the user turned every language off", and applyFilter's empty notice
  // explains the blank grid. The old `size===0 ||` clause silently re-selected every
  // language, which is what made the English-only default impossible to hold.
  const overlap=[...state.activeLangs].filter(b=>present.has(b));
  if(state.activeLangs.size>0&&overlap.length===0) state.activeLangs=new Set([...present]);

  // A SUMMARY BUTTON, not twelve pills. Twelve two-letter badges in a 34px row were
  // clipped mid-badge on anything narrower than a laptop, and 'TW' vs 'TH' vs 'SC' told
  // you nothing about which language you were toggling. The modal has room for a flag and
  // the full name; this row keeps the flags of what is currently on, which is the part
  // you need at a glance.
  renderLangSummary(c,{
    available:[...present],
    active:state.activeLangs,
    onOpen:()=>openLanguagePicker({
      available:[...present],
      active:state.activeLangs,
      // Recount: the filter changes which cards count toward "N / M collected".
      // (The badge used to go stale here — nothing recomputed it on a pill click.)
      // buildPills ends in applyFilter, which owns the stats recount — hence no
      // separate applyFilter()/updateStats() call here.
      onChange:()=>{ saveFilter(); buildPills(); },
    }),
  });
  applyFilter();
}

// NO toggleAllFilter HERE ANY MORE. "All / None" was a single button that flipped
// between the two extremes depending on where you already were, which meant its effect
// could not be predicted from its label. The language modal has an explicit "Select all"
// and "Select none" instead — two buttons, each of which does exactly one thing.
//
// HISTORY WORTH KEEPING: it used to repaint the pills with a document-rooted, UNSCOPED
// query for the bare .filter-pill class. (Spelling that query out here is not possible —
// tests/pill-scope.test.mjs is a raw source scan and would flag the comment.)
// `.filter-pill` is a shared STYLE class owned by pill sets that are all in the document
// at the same time — TMS's #tms-filter-pills (state.tmsActiveLangs) and the TMS popup's
// #tms-popup-toolbar (state._tmsPopupActive). applyModeUI only toggles their `display`,
// it never removes them, so the unscoped query repainted TMS's pills from Master's state
// and they then lied about the filter actually applied. tests/pill-scope.test.mjs still
// fails the build if an unscoped query comes back.

// Update one set head to show only the names of the languages still active.
function syncSetHeadName(block){
  const info=state.setBlockNamesMap.get(block); if(!info) return;
  const nameEl=block.querySelector('.set-name-en'); if(!nameEl) return;
  const names=[...new Set(
    BADGE_ORDER.filter(b=>state.activeLangs.has(b)&&info.namesByBadge[b]).map(b=>info.namesByBadge[b])
  )];
  nameEl.textContent=names.length>0?names.join(' | '):info.enName;
}

// applyFilter OWNS the stats recount — it already visits every card, so a separate
// walk afterwards was pure duplication. Nothing that calls applyFilter() (or
// buildPills(), which ends in it) may also call updateStats(): that was five
// whole-document walks per language-pill click.
//
// One pass in document order over #dyn's children handles everything the four
// querySelectorAll passes and the two sibling walks used to: per-block card
// visibility and divider hiding (planGridVisibility), the block's own .all-hidden
// state, its head names, its tallies, the running stats totals, and the era
// labels — eras resolve for free because set blocks are visited in order after
// the label they belong to.
function applyFilter(){
  const container=document.getElementById('dyn'); if(!container) return;

  statVisible=0; statChecked=0;
  let eraLabel=null, eraHasVisibleSet=false;
  const finishEra=()=>{ if(eraLabel) eraLabel.classList.toggle('era-hidden',!eraHasVisibleSet); };

  for(const node of container.children){
    const cl=node.classList;

    if(cl.contains('era-label')){ finishEra(); eraLabel=node; eraHasVisibleSet=false; continue; }
    if(!cl.contains('set-block')) continue;            // banners etc.

    const grid=node.querySelector('.cards-grid'); if(!grid) continue;
    const kids=grid.children, n=kids.length;
    const plan=planGridVisibility(n,
      i=>{ const k=kids[i].classList;
           return k.contains('card') ? KIND_CARD : k.contains('poke-divider') ? KIND_DIVIDER : KIND_OTHER; },
      i=>state.activeLangs.has(kids[i].dataset.lang),
      i=>kids[i].classList.contains('done'));

    for(let i=0;i<n;i++){
      const on=plan.show[i]===1;
      if(plan.kind[i]===KIND_CARD) kids[i].classList.toggle('lang-hidden',!on);
      // '' not 'block': a divider is a grid item spanning grid-column:1/-1.
      else if(plan.kind[i]===KIND_DIVIDER) kids[i].style.display=on?'':'none';
    }

    const allHidden=blockAllHidden(plan.cards,plan.visible);
    node.classList.toggle('all-hidden',allHidden);
    if(!allHidden) eraHasVisibleSet=true;

    statVisible+=plan.visible; statChecked+=plan.done;
    blockTallies.set(node,{vis:plan.visible,done:plan.done});
    setNavSync(node,plan.visible,plan.done,allHidden);
    syncSetHeadName(node);
  }
  finishEra();
  syncEmptyNotice(container);

  renderStats();
}

// Turning every language off is a reachable state now that the default is English only,
// and it renders a completely blank page: every tile gets .lang-hidden, every block
// .all-hidden (which is display:none), and the sidebar reads "No sets match". Say why,
// rather than looking broken.
//
// Lives INSIDE #dyn on purpose — applyModeUI toggles #dyn's display, so the notice is
// hidden along with everything else in TMS mode for free, and buildAll's
// `container.innerHTML=''` disposes of it. Appended after the loop, never during it.
function syncEmptyNotice(container){
  const existing=document.getElementById('ms-empty');
  if(!(state.totalCards>0&&statVisible===0)){ existing?.remove(); return; }
  if(existing) return;
  const el=document.createElement('div');
  el.id='ms-empty';
  el.className='empty-note';
  el.textContent='No languages selected. Add one from the Language bar above to see your cards.';
  container.appendChild(el);
}

// ── CACHE ─────────────────────────────────────────────────────────────────────
// cacheAge now lives in notify-model.js (imported above): the notification log needs
// the same relative-time formatting, and moving it there made it testable.
// The label used to read `↺ Refresh (5m ago)`. Two problems with that: the button sits
// in .sticky-top, so a time-sensitive string was pinned on screen all session with no way
// to dismiss it; and cacheAge() was evaluated once at render, so it still said "5m ago"
// hours later. The age already reaches the user through the blue cache banner and the
// notification log, both of which expire. Here the exact timestamp goes in the tooltip.
function updRefreshBtn(ts){
  const btn=document.getElementById('btn-refresh'); if(!btn) return;
  btn.disabled=false;
  btn.textContent='↺ Refresh';
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
  const gm=gridMetrics(container);
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
    const symUrl=escapeUrl(si.sym);
    const symEl=symUrl?`<img class="set-symbol" src="${symUrl}" alt="" onerror="this.style.display='none'">`:'' ;
    block.innerHTML=`<div class="set-head c-orange"><div class="set-head-left">${symEl}<div class="set-name-block"><span class="set-name-en">${escapeHtml(si.bulbaName)} <span style="font-size:9px;opacity:.7">(JP)</span></span></div></div><div class="set-head-right"><button class="set-chevron" type="button" aria-expanded="true" aria-label="Collapse this set" title="Collapse this set">▾</button><span class="set-count">0 entries</span><button class="set-select-btn">☑ Set</button></div></div><div class="cards-grid"></div>`;
    // NOT inserted yet — the block is filled while detached and attached at the
    // bottom of this loop body, so its cards never lay out one-by-one in the live
    // document (the same reason renderBySet builds each era into a fragment).
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

    const groups=[];   // per-group tile counts — see setGridHeightHint
    byPokemon.forEach((cards,enName)=>{
      const groupStart=count;
      const jpNat=NATIVE_NAMES.JP?.[enName]||'';
      const divider=document.createElement('div'); divider.className='poke-divider';
      // Nodes, not markup — enName comes from Bulbapedia wikitext.
      divider.appendChild(document.createTextNode(enName));
      if(jpNat){
        const alt=document.createElement('span');
        alt.className='poke-divider-names-alt'; alt.textContent=`· ${jpNat}`;
        divider.appendChild(document.createTextNode(' '));
        divider.appendChild(alt);
      }
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
          // Limitless serves one resolution for JP, so lo and hi are the same URL.
          ...imgMeta([imgSrc],[imgSrc]), symSrc:si.sym,
        });

        const el=document.createElement('div');
        el.className='card'+(isDone?' done':''); el.dataset.id=id; el.dataset.lang='JP';
        markCardToggle(el,isDone);

        // Placeholder-first, same as mkImgWrap: Limitless JP art 404s frequently, and
        // painting only after the error left an empty box on screen meanwhile.
        const wrap=document.createElement('div'); wrap.className='img-wrap';
        const ph=mkPlaceholderEl(si.sym,'JP','#4527a0',enName,jpNatName,si.bulbaName,localId);
        wrap.appendChild(ph);
        // Skip the request outright when this scan is already known missing — Limitless
        // 403s a lot of older JP art (SM7_105 vs SM7_6), all of it ORB-blocked noise.
        if(imgSrc && viableSources([imgSrc]).length){
          ph.classList.add('ph-over');
          const img=document.createElement('img');
          img.className='card-img';
          img.loading='lazy'; img.decoding='async'; img.fetchPriority='low';
          img.alt=`${enName} JP #${localId}`;
          img.onload=()=>{ ph.remove(); markGood(imgSrc); const mm=state._meta.get(id); if(mm) mm.imgOk=imgSrc; };
          img.onerror=()=>{ img.remove(); markBad(imgSrc); ph.classList.remove('ph-over'); };
          img.src=imgSrc;
          wrap.appendChild(img);
        }

        const footer=mkCardFooter(localId,'JP',{langClass:'lang-JP',isDone});
        el.appendChild(wrap); el.appendChild(footer);
        grid.appendChild(el); count++;
      });
      groups.push(count-groupStart);
    });
    state.totalCards+=count; updCount(block,count);
    setGridHeightHint(grid,count,byPokemon.size,gm,groups);
    // Fully built — attach it now, in the position computed above.
    if(insertBefore) container.insertBefore(block,insertBefore);
    else container.appendChild(block);
  });

  // NO `state.activeLangs.add('JP')` here. This ran unconditionally on every JP
  // injection, so JP could never stay deselected: turn it off, and the next render
  // silently turned it back on. buildPills below renders a `+ JP` pill instead.
  //
  // This fetch is kicked off without `await`, so "Collapse all" can land while it is
  // still in flight. Stamp the current state onto the blocks it just appended, or they
  // arrive expanded into an otherwise collapsed page. No-op when nothing is collapsed.
  applyCollapseState(container);
  // JP blocks are spliced into the middle of existing eras, so the sidebar's index
  // has to be rebuilt from the DOM — its order cannot be derived from data alone.
  setNavRebuild(container,state.setBlockNamesMap);
  buildPills();
}
async function buildAll(forceRefresh){
  const container=document.getElementById('dyn');
  container.innerHTML=''; state.totalCards=0;
  // _meta is repopulated by renderBySet below; clear it with setBlockNamesMap so
  // ids from a previous Pokémon selection don't accumulate (see toggleSort).
  state.setBlockNamesMap.clear(); state._meta.clear();
  setNavReset();
  resetCollapse();   // see toggleSort: the flag must not outlive the blocks it described
  installCardDelegation(container);

  // The ONLY two things still rendered as in-flow banners are this one and the failure
  // banner in the catch below, and for the same reason: both describe the state of the
  // page you are looking at, and the failure one owns a Retry button. Everything else
  // buildAll used to say — loaded-from-cache, N new cards, no new cards, backup source,
  // the placeholder-language notes — goes to the bell instead. They were status, not
  // instructions, and each one shoved the grid down by its own height and then let it
  // spring back when its TTL ran out.
  const loadBanner=mkBanner(container,'Loading…','banner-load',null);
  const btn=document.getElementById('btn-refresh');
  if(btn){btn.disabled=true;btn.textContent='Loading…';}

  try{
    const cached=loadCache();
    const fresh=forceRefresh||!cached||(Date.now()-cached.ts)>CACHE_TTL;
    let cards, setNamesAll, setMeta, source;

    if(!fresh){
      cards=cached.cards; setNamesAll=cached.setNamesAll||{};
      setMeta=cached.setMeta||{dates:{},symbols:{}}; source=cached.source||'tcgdex';
      loadBanner.remove();
      // BELL, not a banner — see the note above buildAll's loadBanner. Nothing is asked
      // of the reader here, and as an in-flow strip it pushed the whole grid down 27px
      // for eight seconds and then let it snap back up when the TTL expired.
      recordNotice(`Loaded from cache (${cacheAge(cached.ts)}). Click Refresh to check for new cards.`,'banner-blue');
    } else {
      loadBanner.querySelector('.banner-body').textContent='Fetching cards, set names and translations…';
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
          recordNotice(`🆕 <strong>${nc.length} new card(s) found</strong>: ${[...new Set(nc.map(c=>c.name))].join(', ')}`,'banner-new');
        } else {
          recordNotice('No new cards since last check.','banner-green');
        }
      } else { loadBanner.remove(); }

      saveCache({cards,setNamesAll,setMeta,source});
    }

    // Clear any remaining loading banner before rendering
    loadBanner?.remove?.();
    // Non-blocking notice when the primary (TCGdex) was unavailable and the legacy fallback
    // was used. "Non-blocking" is the whole argument for it being in the bell.
    if(source==='legacy') recordNotice('Showing data from the backup source (TCGdex unavailable). Click Refresh to retry.','banner-amber',{once:'src-fallback'});
    renderBySet(cards,setNamesAll,container,setMeta);

    // JP: fetch all JP cards, filter by name, inject as own sets with images
    fetchAndInjectJPCards(container).catch(e=>console.warn('JP fetch failed:',e.message));

    updRefreshBtn(loadCache()?.ts);
    buildPills();

  }catch(err){
    console.error('[masterset] buildAll failed:',err);
    // Do NOT reuse loadBanner here. It has already been .remove()'d by the time
    // most failures happen — the cache path drops it at the top, and everything
    // after renderBySet runs with it detached — so rewriting it wrote the error
    // into a node that was no longer in the document. The failure, and its Retry
    // button, were invisible: the page just sat empty with the button re-enabled.
    loadBanner?.remove();
    // hasAction: this banner owns a Retry button, so it must never auto-hide — pulling
    // a control out from under the pointer on a timer is worse than leaving clutter.
    const errBanner=mkBanner(container,'','banner-error',null,{hasAction:true});
    const body=errBanner.querySelector('.banner-body');
    const msg=`Failed: ${err.message} `;
    body.textContent=msg;   // textContent: err.message is not ours to trust as HTML
    // mkBanner recorded an empty string above (the body is filled here, after the
    // fact), so log the real message explicitly or the failure is missing from the bell.
    recordNotice(msg,'banner-error');
    const retry=document.createElement('button');
    retry.id='retry-btn'; retry.className='banner-retry-btn'; retry.textContent='↺ Retry';
    retry.addEventListener('click',()=>doRefresh());
    body.appendChild(retry);
    if(btn){btn.disabled=false;btn.textContent='↺ Refresh';}
  }
}

function doRefresh(){buildAll(true);}
function clearCache(){
  if(!confirm('Clear all cached card data and reload?')) return;
  clearCardCache();          // removes all tcgData* keys
  clearImgFailures();        // forget which image URLs 404'd, so all are retried
  state._bulbaData=null;
  location.reload();
}

function showPlaceholderInPreview(content, m, en, nat){
  const ph = buildPlaceholderHTML(m.symSrc, m.lang, m.langColor, en, nat, m.setName, m.num.replace('#',''), false);
  content.innerHTML = `<div class="preview-placeholder">${ph}</div>`;
  return content.firstElementChild;
}

// Guards against a slow load painting into an overlay the user has already closed
// and reopened on a different card: each open takes a token, and a resolved image
// is only mounted while its token is still the current one.
let previewToken = 0;

// PLACEHOLDER-FIRST, matching the grid (see mkImgWrap): paint the stand-in
// synchronously, resolve the image underneath, swap on success.
//
// The old order was image-first with the placeholder built only from onerror, so the
// overlay opened EMPTY while the meta line (name/set/number) was already on screen —
// that is the "shows just the name, then the card appears a moment later" report. On a
// card with no artwork it also meant waiting out two sequential 404s to see anything.
async function openPreview(id){
  const m=state._meta.get(id); if(!m) return;
  return openPreviewMeta(m);
}

/**
 * The preview modal, from a meta object rather than an id.
 *
 * Split out for single-set mode, which renders its own tiles and keeps no index in
 * state._meta — and must NOT write to it, because buildAll clears that map and refills
 * it with Master Set's cards, so an id present in both modes would race.
 */
async function openPreviewMeta(m){
  if(!m) return;
  const overlay=document.getElementById('preview-overlay');
  const content=document.getElementById('preview-content');
  const meta=document.getElementById('preview-meta');
  if(!overlay||!content||!meta) return;

  const en=typeof m.name==='object'?m.name.en:m.name;
  const nat=typeof m.name==='object'?m.name.native:null;
  const token=++previewToken;

  const ph=showPlaceholderInPreview(content,m,en,nat);
  const sources=metaSources(m);
  // Spinner only while something is genuinely in flight. When every candidate is
  // absent or already known bad there is nothing to wait for, so the placeholder is
  // the final answer immediately rather than after a visible pause.
  if(sources.length) ph?.classList.add('ph-loading');

  meta.innerHTML=`
    <strong>${escapeHtml(en)}</strong>${nat?` · ${escapeHtml(nat)}`:''}
    <br>${escapeHtml(m.setName)} &middot; ${escapeHtml(m.num)} &middot;
    <span style="background:${escapeHtml(m.langColor)};color:white;padding:0 5px;border-radius:3px;font-size:10px">${escapeHtml(m.lang)}</span>
  `.trim();

  // Open BEFORE awaiting: the overlay must appear on click, not once the network says so.
  overlay.classList.add('open');

  if(!sources.length) return;
  const hit=await loadFirstImage(sources);
  if(token!==previewToken) return;         // superseded by a later open
  ph?.classList.remove('ph-loading');
  if(!hit) return;                          // every candidate failed — placeholder stands
  m.imgOk=m.imgOk||hit.url;                 // remember for print and the next open
  hit.img.className='preview-img'; hit.img.alt=en;
  content.replaceChildren(hit.img);
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
  clearCache, closePreview, doRefresh,
  resetAll, selectAll, toggleSort,
  langColor, buildPlaceholderHTML, mkPlaceholderEl, openPreviewMeta, markCardToggle,
};
