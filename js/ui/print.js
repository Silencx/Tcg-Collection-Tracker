// =============================================================================
// ui/print.js — print views for both modes.
//   • Master Set : printSelected (9-up card images / A4) + printChecklist (2-col text)
//   • True Master Set : printTmsSelected + printTmsChecklist (same layouts)
// Each opens a self-contained printable document in a new tab. Ported verbatim
// from the old tool; state names rewritten to state.<name>. printPlaceholderCard
// + PLACEHOLDER_PRINT_CSS are shared by the image-print views and live here.
// =============================================================================

import { state } from '../state.js';
import { NATIVE_NAMES } from '../config.js';
import { buildPlaceholderHTML } from './masterset.js';

// Card-placeholder CSS injected into the image-print documents (mm-sized for A4).
const PLACEHOLDER_PRINT_CSS = [
  '.custom-placeholder{width:100%;aspect-ratio:63.5/88.9;border-radius:6px;' +
  'background:linear-gradient(160deg,#1a3a2a 0%,#2d5a3d 50%,#1a3a2a 100%);' +
  'border:2.5px solid #c8a400;display:flex;flex-direction:column;' +
  'align-items:center;justify-content:center;gap:3px;padding:8px 5px;' +
  'text-align:center;position:relative;overflow:hidden;box-sizing:border-box;}',
  '.custom-placeholder::before{content:"";position:absolute;inset:3px;' +
  'border-radius:4px;border:1px solid rgba(200,164,0,.35);pointer-events:none;}',
  '.cp-symbol{width:24px;height:24px;object-fit:contain;opacity:.5;' +
  'filter:brightness(0) invert(1);margin-bottom:2px;}',
  '.cp-lang{font-size:8px;font-weight:bold;color:white;padding:1px 5px;border-radius:2px;}',
  '.cp-name{font-size:11px;font-weight:bold;color:#ffd54f;line-height:1.2;' +
  'word-break:break-word;text-shadow:0 1px 2px rgba(0,0,0,.5);}',
  '.cp-native{font-size:10px;font-weight:bold;color:#ffe082;line-height:1.2;}',
  '.cp-set{font-size:8px;color:#a5d6a7;line-height:1.2;}',
  '.cp-num{font-size:7px;color:#81c784;font-style:italic;}',
  '.pw .custom-placeholder{width:63.5mm!important;height:88.9mm!important;border-radius:3.5mm!important;}',
].join('');

// ── MASTER SET PRINT ──────────────────────────────────────────────────────────
function printPlaceholderCard(m){
  const en  = typeof m.name==='object' ? m.name.en     : m.name;
  const nat = typeof m.name==='object' ? m.name.native : null;
  const localId = (m.num||'').replace('#','');
  return buildPlaceholderHTML(m.symSrc,m.lang,m.langColor,en,nat,m.setName,localId,false);
}

function printSelected(){
  if(!state.checked.size){ alert('No cards selected.'); return; }
  const cards = [...checked].map(id=>state._meta.get(id)).filter(Boolean);
  if(!cards.length){ alert('No printable card data found.'); return; }

  function safeImgUrl(url, quality){
    if(!url) return null;
    return /\.(webp|png|jpg|jpeg)$/i.test(url) ? url : `${url}/${quality}.webp`;
  }

  const cells = cards.map(m => {
    const imgUrl = safeImgUrl(m.hiImgSrc,'high') || safeImgUrl(m.imgSrc,'low');
    const ph  = printPlaceholderCard(m);
    const img = imgUrl
      ? `<img src="${imgUrl}" class="pi pi-ov" style="display:none" onload="this.style.display='block'" onerror="this.remove()">`
      : '';
    return `<div class="pw">${ph}${img}</div>`;
  }).join('');

  // A4 portrait: 5mm margins = 200mm × 287mm usable
  // 3 × 63.5mm + 2 × 2mm gaps = 194.5mm wide ✓
  // 3 × 88.9mm + 2 × 2mm gaps = 270.7mm tall ✓ → 9 cards per page
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Print</title><style>'
    + '*{box-sizing:border-box;margin:0;padding:0;}'
    + 'body{background:white;}'
    + '.pg{display:grid;grid-template-columns:repeat(3,63.5mm);gap:3mm;padding:0;}'
    + '.pw{width:63.5mm;height:88.9mm;border-radius:3.5mm;overflow:hidden;position:relative;}'
    + '.pi{width:63.5mm;height:88.9mm;display:block;object-fit:cover;}'
    + '.pi-ov{position:absolute;inset:0;width:100%!important;height:100%!important;}'
    + PLACEHOLDER_PRINT_CSS
    + '@media print{-webkit-print-color-adjust:exact;print-color-adjust:exact;@page{size:A4 portrait;margin:5mm;}}'
    + '</style></head><body>'
    + '<div class="pg">' + cells + '</div>'
    + '<script>const i=document.querySelectorAll("img");let p=i.length;function t(){if(--p<=0)window.print();}if(!p)window.print();else i.forEach(x=>{if(x.complete)t();else{x.onload=t;x.onerror=t;}})<\/script>'
    + '</body></html>';

  const blob = new Blob([html], {type:'text/html'});
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, '_blank');
  if(!win) alert('Pop-up blocked — please allow pop-ups.');
  setTimeout(()=>URL.revokeObjectURL(url), 60000);
}

// ── PRINT CHECKLIST ───────────────────────────────────────────────────────────
// Prints a text list of selected cards grouped by set, with checkboxes.
// One row per card: [ ] CardName · Lang · #Num
function printChecklist(){
  if(!state.checked.size){ alert('No cards selected.'); return; }
  const cards = [...checked].map(id=>state._meta.get(id)).filter(Boolean);
  if(!cards.length){ alert('No card data found.'); return; }

  // Group by set name
  const bySet = new Map();
  cards.forEach(m=>{
    if(!bySet.has(m.setName)) bySet.set(m.setName,[]);
    bySet.get(m.setName).push(m);
  });

  // Build rows: 2 cards side-by-side per table row for compactness
  const rows = [...bySet.entries()].map(([setName, items])=>{
    const sym = items[0]?.symSrc
      ? `<img src="${items[0].symSrc}" style="width:10px;height:10px;object-fit:contain;vertical-align:middle;margin-right:2px;filter:brightness(0);opacity:.5" onerror="this.style.display='none'">`
      : '';
    let setRows = '';
    for(let i=0; i<items.length; i+=2){
      const cell = m => {
        if(!m) return '<td colspan="3"></td>';
        const en  = typeof m.name==='object' ? m.name.en : m.name;
        const nat = typeof m.name==='object' && m.name.native ? ` <span style="color:#999">${m.name.native}</span>` : '';
        return `<td class="chk-col"><input type="checkbox" disabled></td>`
             + `<td class="name-col">${en}${nat} <span class="badge" style="background:${m.langColor}">${m.lang}</span></td>`
             + `<td class="num-col">${m.num}</td>`;
      };
      setRows += `<tr>${cell(items[i])}${cell(items[i+1]||null)}</tr>`;
    }
    return `<tr class="set-row"><td colspan="6">${sym}${setName}</td></tr>${setRows}`;
  }).join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Card Checklist</title><style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:Arial,sans-serif;font-size:7pt;padding:5mm;}
h1{font-size:8pt;margin-bottom:2mm;color:#333;}
table{width:100%;border-collapse:collapse;}
.set-row td{font-weight:bold;font-size:6.5pt;background:#ebebeb;padding:.8mm 1.5mm;border-top:.5px solid #bbb;color:#444;text-transform:uppercase;letter-spacing:.3px;} .name-col{max-width:60mm;}
tr:not(.set-row) td{padding:.35mm 1.5mm;border-bottom:.15mm solid #f2f2f2;vertical-align:middle;line-height:1.3;}
.chk-col{width:4mm;text-align:center;}.sep{width:1.5mm;border-left:.2mm solid #ddd;}
.lang-col{width:9mm;text-align:center;}
.num-col{width:9mm;text-align:right;color:#999;}
.badge{color:white;padding:0 2px;border-radius:2px;font-size:6pt;font-weight:bold;}
@media print{@page{size:A4 portrait;margin:5mm;}-webkit-print-color-adjust:exact;print-color-adjust:exact;}
</style></head>
<body>
<h1>${state.pokemonList.join(' · ')} — ${cards.length} card${cards.length===1?'':'s'}</h1>
<table><tbody>${rows}</tbody></table>
<\x73cript>window.print();<\/script>
</body></html>`;

  const blob = new Blob([html], {type:'text/html'});
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, '_blank');
  if(!win) alert('Pop-up blocked — please allow pop-ups.');
  setTimeout(()=>URL.revokeObjectURL(url), 60000);
}

// ── TRUE MASTER SET PRINT ─────────────────────────────────────────────────────
function printTmsChecklist(){
  if(!state.tmsIncluded.size){ alert('No cards in your True Master Set yet.\nOpen some Pokémon and include cards first.'); return; }
  const cards=[];
  state.tmsIncluded.forEach(id=>{
    const poke=state._tmsCardPokemon.get(id); if(!poke) return;
    const pc=state.tmsPokeCache.get(poke); if(!pc) return;
    const c=pc.find(x=>x.id===id); if(!c) return;
    const nat=(NATIVE_NAMES[c.lang]||{})[poke]||null;
    cards.push({name:{en:poke,native:nat},setName:c.setName,num:`#${c.localId}`,lang:c.lang,langColor:c.langColor,symSrc:c.symSrc});
  });
  if(!cards.length){ alert('Card data not loaded yet.\nPlease open each Pokémon\'s popup first, then try again.'); return; }
  const bySet=new Map();
  cards.forEach(m=>{ if(!bySet.has(m.setName)) bySet.set(m.setName,[]); bySet.get(m.setName).push(m); });
  const rows=[...bySet.entries()].map(([setName,items])=>{
    const sym=items[0]?.symSrc?`<img src="${items[0].symSrc}" style="width:10px;height:10px;object-fit:contain;vertical-align:middle;margin-right:2px;filter:brightness(0);opacity:.5" onerror="this.style.display='none'">`:'';
    let setRows='';
    for(let i=0;i<items.length;i+=2){
      const cell=m=>{ if(!m) return '<td colspan="3"></td>'; const en=typeof m.name==='object'?m.name.en:m.name; const nat=typeof m.name==='object'&&m.name.native?` <span style="color:#999">${m.name.native}</span>`:''; return `<td class="chk-col"><input type="checkbox" disabled></td><td class="name-col">${en}${nat} <span class="badge" style="background:${m.langColor}">${m.lang}</span></td><td class="num-col">${m.num}</td>`; };
      setRows+=`<tr>${cell(items[i])}${cell(items[i+1]||null)}</tr>`;
    }
    return `<tr class="set-row"><td colspan="6">${sym}${setName}</td></tr>${setRows}`;
  }).join('');
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>True Master Set Checklist</title><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:7pt;padding:5mm;}h1{font-size:8pt;margin-bottom:2mm;color:#333;}table{width:100%;border-collapse:collapse;}.set-row td{font-weight:bold;font-size:6.5pt;background:#ebebeb;padding:.8mm 1.5mm;border-top:.5px solid #bbb;color:#444;text-transform:uppercase;letter-spacing:.3px;}.name-col{max-width:60mm;}tr:not(.set-row) td{padding:.35mm 1.5mm;border-bottom:.15mm solid #f2f2f2;vertical-align:middle;line-height:1.3;}.chk-col{width:4mm;text-align:center;}.num-col{width:9mm;text-align:right;color:#999;}.badge{color:white;padding:0 2px;border-radius:2px;font-size:6pt;font-weight:bold;}@media print{@page{size:A4 portrait;margin:5mm;}-webkit-print-color-adjust:exact;print-color-adjust:exact;}</style></head><body><h1>⭐ True Master Set — ${cards.length} card${cards.length===1?'':'s'}</h1><table><tbody>${rows}</tbody></table><script>window.print();<\/script></body></html>`;
  const blob=new Blob([html],{type:'text/html'});
  const url=URL.createObjectURL(blob);
  const win=window.open(url,'_blank');
  if(!win) alert('Pop-up blocked — please allow pop-ups.');
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}

// ── TMS: Reset selections only (keep cache) ───────────────────────────────────

function printTmsSelected(){
  if(!state.tmsIncluded.size){ alert('No cards in your True Master Set yet.'); return; }
  const metas=[];
  state.tmsIncluded.forEach(id=>{
    const poke=state._tmsCardPokemon.get(id); if(!poke) return;
    const pc=state.tmsPokeCache.get(poke); if(!pc) return;
    const c=pc.find(x=>x.id===id); if(!c) return;
    const nat=(NATIVE_NAMES[c.lang]||{})[poke]||null;
    metas.push({name:{en:poke,native:nat},setName:c.setName,num:`#${c.localId}`,lang:c.lang,langColor:c.langColor,symSrc:c.symSrc,imgSrc:c.imgSrc,hiImgSrc:c.hiSrc,isCustom:true});
  });
  if(!metas.length){ alert('Card data not loaded yet — open each Pokémon\'s popup first.'); return; }
  function safeImgUrl(url){ return url&&/\.(webp|png|jpg|jpeg)$/i.test(url)?url:url?`${url}/low.webp`:null; }
  const cells=metas.map(m=>{
    const imgUrl=safeImgUrl(m.hiImgSrc)||safeImgUrl(m.imgSrc);
    const ph=printPlaceholderCard(m);
    const img=imgUrl?`<img src="${imgUrl}" class="pi pi-ov" style="display:none" onload="this.style.display='block'" onerror="this.remove()">`: '';
    return `<div class="pw">${ph}${img}</div>`;
  }).join('');
  const html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Print</title><style>'
    +'*{box-sizing:border-box;margin:0;padding:0;}body{background:white;}'
    +'.pg{display:grid;grid-template-columns:repeat(3,63.5mm);gap:3mm;padding:0;}'
    +'.pw{width:63.5mm;height:88.9mm;border-radius:3.5mm;overflow:hidden;position:relative;}'
    +'.pi{width:63.5mm;height:88.9mm;display:block;object-fit:cover;}'
    +'.pi-ov{position:absolute;inset:0;width:100%!important;height:100%!important;}'
    +PLACEHOLDER_PRINT_CSS
    +'@media print{-webkit-print-color-adjust:exact;print-color-adjust:exact;@page{size:A4 portrait;margin:5mm;}}'
    +'</style></head><body><div class="pg">'+cells+'</div>'
    +'<script>const i=document.querySelectorAll("img");let p=i.length;function t(){if(--p<=0)window.print();}if(!p)window.print();else i.forEach(x=>{if(x.complete)t();else{x.onload=t;x.onerror=t;}})<\/script>'
    +'</body></html>';
  const blob=new Blob([html],{type:'text/html'});
  const url=URL.createObjectURL(blob);
  const win=window.open(url,'_blank');
  if(!win) alert('Pop-up blocked — please allow pop-ups.');
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}


export { printSelected, printChecklist, printTmsSelected, printTmsChecklist };
