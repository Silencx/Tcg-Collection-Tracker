// =============================================================================
// ui/print.js — print views for both modes.
//   • Master Set      : printSelected (9-up card images / A4) + printChecklist (2-col text)
//   • True Master Set : printTmsSelected + printTmsChecklist (same layouts)
//
// The two modes print the SAME two documents; they differ only in where the card
// metadata comes from. That shared shape is `buildCardSheetDoc` /
// `buildChecklistDoc`, with `openPrintDoc` doing the Blob-and-open dance. Each of
// the four entry points is then just "collect metas, hand them over".
//
// They used to be four near-identical copies, ~90% the same, and the copies had
// already drifted: TMS card printing hardcoded low-res images while Master Set
// asked for high-res, and one of the two checklists escaped its closing script
// tag while the other did not.
//
// A "meta" is the render metadata shape state._meta holds:
//   { name:{en,native}|string, setName, num, lang, langColor, symSrc,
//     imgSources, hiSources, imgOk }
// The three image fields are built by img-cache.imgMeta and read via metaSources —
// candidates plus the url that actually decoded, never a bare guess.
//
// NOTE ON ESCAPING: these documents are built as strings, put in a Blob and
// opened in a new tab — and a blob: document inherits the OPENER'S ORIGIN. Script
// injected here therefore reads the same localStorage as the app. Card and set
// names come from remote APIs and the Pokémon list can come from a shared "#s="
// link, so everything interpolated below goes through escapeHtml/escapeUrl.
// =============================================================================

import { state } from '../state.js';
import { NATIVE_NAMES } from '../config.js';
import { buildPlaceholderHTML } from './masterset.js';
import { imgMeta, metaSources } from '../api/img-cache.js';
import { setModeMetas, openSetName } from './setmode.js';
import { escapeHtml, escapeUrl } from './html.js';

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

const CHECKLIST_CSS = [
  '*{box-sizing:border-box;margin:0;padding:0;}',
  'body{font-family:Arial,sans-serif;font-size:7pt;padding:5mm;}',
  'h1{font-size:8pt;margin-bottom:2mm;color:#333;}',
  'table{width:100%;border-collapse:collapse;}',
  '.set-row td{font-weight:bold;font-size:6.5pt;background:#ebebeb;padding:.8mm 1.5mm;' +
  'border-top:.5px solid #bbb;color:#444;text-transform:uppercase;letter-spacing:.3px;}',
  '.name-col{max-width:60mm;}',
  'tr:not(.set-row) td{padding:.35mm 1.5mm;border-bottom:.15mm solid #f2f2f2;' +
  'vertical-align:middle;line-height:1.3;}',
  '.chk-col{width:4mm;text-align:center;}.sep{width:1.5mm;border-left:.2mm solid #ddd;}',
  '.lang-col{width:9mm;text-align:center;}',
  '.num-col{width:9mm;text-align:right;color:#999;}',
  '.badge{color:white;padding:0 2px;border-radius:2px;font-size:6pt;font-weight:bold;}',
  '@media print{@page{size:A4 portrait;margin:5mm;}-webkit-print-color-adjust:exact;print-color-adjust:exact;}',
].join('');

const CARD_SHEET_CSS = [
  '*{box-sizing:border-box;margin:0;padding:0;}',
  'body{background:white;}',
  '.pg{display:grid;grid-template-columns:repeat(3,63.5mm);gap:3mm;padding:0;}',
  '.pw{width:63.5mm;height:88.9mm;border-radius:3.5mm;overflow:hidden;position:relative;}',
  '.pi{width:63.5mm;height:88.9mm;display:block;object-fit:cover;}',
  '.pi-ov{position:absolute;inset:0;width:100%!important;height:100%!important;}',
  PLACEHOLDER_PRINT_CSS,
  '@media print{-webkit-print-color-adjust:exact;print-color-adjust:exact;@page{size:A4 portrait;margin:5mm;}}',
].join('');

// Split so this file's own </script> can't terminate the parent document's when
// these modules are ever inlined. One of the four originals did this and the
// other did not — keep the safe form.
const CLOSE_SCRIPT = '</scr' + 'ipt>';

// Print once every image is DECODED (or has failed), so nothing prints blank.
//
// Two fixes over the previous version, both of which caused a first print run to show
// placeholders where the second run showed art:
//
//   1. It printed from `onload`, which fires before the bitmap is decoded — so the
//      print snapshot could be taken while images were still blank. `decode()` is the
//      actual "ready to paint" signal. (A cached image on run 2 was already decoded,
//      which is exactly why only the first run looked wrong.)
//   2. It assigned `x.onerror` over EVERY img, clobbering the inline
//      `onerror="this.style.display='none'"` that buildPlaceholderHTML puts on set
//      symbols — so a symbol that 404s printed as a broken-image icon. Listeners are
//      added now instead of overwriting the handler property.
//
// decode() rejects on a broken image, so the catch covers the error path too and every
// image resolves exactly once.
const PRINT_WHEN_IMAGES_SETTLE =
  '<script>Promise.all([...document.querySelectorAll("img")].map(x=>'
  + 'x.decode?x.decode().catch(()=>{}):new Promise(r=>{'
  + 'if(x.complete)return r();x.addEventListener("load",r);x.addEventListener("error",r);})'
  + ')).then(()=>window.print());'
  + CLOSE_SCRIPT;

const PRINT_IMMEDIATELY = '<script>window.print();' + CLOSE_SCRIPT;

/** Open an assembled document in a new tab. */
function openPrintDoc(html) {
  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, '_blank');
  if (!win) alert('Pop-up blocked — please allow pop-ups.');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const enNameOf  = m => (typeof m.name === 'object' ? m.name.en     : m.name);
const natNameOf = m => (typeof m.name === 'object' ? m.name.native : null);

function printPlaceholderCard(m) {
  const localId = (m.num || '').replace('#', '');
  // buildPlaceholderHTML escapes its own inputs.
  return buildPlaceholderHTML(m.symSrc, m.lang, m.langColor, enNameOf(m), natNameOf(m), m.setName, localId, false);
}

/**
 * Best printable image URL for a meta, or null when there is nothing worth asking for.
 *
 * Reads the resolution OUTCOME rather than a guessed URL (see img-cache.imgMeta): the
 * candidates come back best-first with anything already known to 404/403 removed, so a
 * language TCGdex holds no artwork for contributes no requests to the print document at
 * all — and the placeholder that results is correct on the FIRST run, not the second.
 *
 * A candidate may be a full file path or an asset BASE needing a quality suffix; the
 * regex keeps both working (metas built by renderBySet/tms.js already carry full URLs,
 * so this is belt-and-braces).
 */
function cardImageUrl(m) {
  const url = metaSources(m)[0];
  if (!url) return null;
  return /\.(webp|png|jpg|jpeg)$/i.test(url) ? url : `${url}/high.webp`;
}

/** Group metas by set name, preserving first-seen order. */
function groupBySet(metas) {
  const bySet = new Map();
  for (const m of metas) {
    if (!bySet.has(m.setName)) bySet.set(m.setName, []);
    bySet.get(m.setName).push(m);
  }
  return bySet;
}

/**
 * 2-column text checklist, grouped by set, one printable row per card pair.
 * @param {object[]} metas
 * @param {string} heading plain text — escaped here, not by the caller
 * @param {string} title   plain text, for the document <title>
 */
function buildChecklistDoc(metas, heading, title) {
  const cell = m => {
    if (!m) return '<td colspan="3"></td>';
    const nat = natNameOf(m) ? ` <span style="color:#999">${escapeHtml(natNameOf(m))}</span>` : '';
    return '<td class="chk-col"><input type="checkbox" disabled></td>'
         + `<td class="name-col">${escapeHtml(enNameOf(m))}${nat} `
         + `<span class="badge" style="background:${escapeHtml(m.langColor)}">${escapeHtml(m.lang)}</span></td>`
         + `<td class="num-col">${escapeHtml(m.num)}</td>`;
  };

  const rows = [...groupBySet(metas).entries()].map(([setName, items]) => {
    const symUrl = escapeUrl(items[0]?.symSrc);
    const sym = symUrl
      ? `<img src="${symUrl}" style="width:10px;height:10px;object-fit:contain;vertical-align:middle;`
        + `margin-right:2px;filter:brightness(0);opacity:.5" onerror="this.style.display='none'">`
      : '';
    let setRows = '';
    for (let i = 0; i < items.length; i += 2) {
      setRows += `<tr>${cell(items[i])}${cell(items[i + 1] || null)}</tr>`;
    }
    return `<tr class="set-row"><td colspan="6">${sym}${escapeHtml(setName)}</td></tr>${setRows}`;
  }).join('');

  return '<!DOCTYPE html><html><head><meta charset="UTF-8">'
    + `<title>${escapeHtml(title)}</title><style>${CHECKLIST_CSS}</style></head><body>`
    + `<h1>${escapeHtml(heading)}</h1>`
    + `<table><tbody>${rows}</tbody></table>`
    + PRINT_IMMEDIATELY
    + '</body></html>';
}

/**
 * 9-up A4 card sheet. Each cell is the placeholder with the real image overlaid
 * once it decodes, so a card with no artwork still prints something meaningful.
 *
 * A4 portrait, 5mm margins = 200mm × 287mm usable:
 *   3 × 63.5mm + 2 × 3mm gaps = 196.5mm wide ✓
 *   3 × 88.9mm + 2 × 3mm gaps = 272.7mm tall ✓ → 9 cards per page
 */
function buildCardSheetDoc(metas) {
  const cells = metas.map(m => {
    const imgUrl = escapeUrl(cardImageUrl(m));
    const img = imgUrl
      ? `<img src="${imgUrl}" class="pi pi-ov" style="display:none" onload="this.style.display='block'" onerror="this.remove()">`
      : '';
    return `<div class="pw">${printPlaceholderCard(m)}${img}</div>`;
  }).join('');

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Print</title>'
    + `<style>${CARD_SHEET_CSS}</style></head><body>`
    + `<div class="pg">${cells}</div>`
    + PRINT_WHEN_IMAGES_SETTLE
    + '</body></html>';
}

// ── COLLECTING METAS ──────────────────────────────────────────────────────────

/** Master Set: the checked ids, resolved through the live render index. */
function masterMetas() {
  return [...state.checked].map(id => state._meta.get(id)).filter(Boolean);
}

/**
 * True Master Set: included ids, resolved through the per-Pokémon card cache.
 * Cards whose Pokémon popup has never been opened have no cached data and are
 * skipped — hence the "open each popup first" hint the callers show.
 */
function tmsMetas() {
  const metas = [];
  state.tmsIncluded.forEach(id => {
    const poke = state._tmsCardPokemon.get(id); if (!poke) return;
    const pc = state.tmsPokeCache.get(poke);    if (!pc) return;
    const c = pc.find(x => x.id === id);        if (!c) return;
    metas.push({
      name: { en: poke, native: (NATIVE_NAMES[c.lang] || {})[poke] || null },
      setName: c.setName, num: `#${c.localId}`, lang: c.lang, langColor: c.langColor,
      symSrc: c.symSrc, ...imgMeta([c.imgSrc], [c.hiSrc]),
    });
  });
  return metas;
}

// ── ENTRY POINTS ──────────────────────────────────────────────────────────────

function printSelected() {
  if (!state.checked.size) { alert('No cards selected.'); return; }
  const metas = masterMetas();
  if (!metas.length) { alert('No printable card data found.'); return; }
  openPrintDoc(buildCardSheetDoc(metas));
}

function printChecklist() {
  if (!state.checked.size) { alert('No cards selected.'); return; }
  const metas = masterMetas();
  if (!metas.length) { alert('No card data found.'); return; }
  const heading = `${state.pokemonList.join(' · ')} — ${metas.length} card${metas.length === 1 ? '' : 's'}`;
  openPrintDoc(buildChecklistDoc(metas, heading, 'Card Checklist'));
}

function printTmsSelected() {
  if (!state.tmsIncluded.size) { alert('No cards in your True Master Set yet.'); return; }
  const metas = tmsMetas();
  if (!metas.length) { alert('Card data not loaded yet — open each Pokémon\'s popup first.'); return; }
  openPrintDoc(buildCardSheetDoc(metas));
}

function printTmsChecklist() {
  if (!state.tmsIncluded.size) {
    alert('No cards in your True Master Set yet.\nOpen some Pokémon and include cards first.');
    return;
  }
  const metas = tmsMetas();
  if (!metas.length) {
    alert('Card data not loaded yet.\nPlease open each Pokémon\'s popup first, then try again.');
    return;
  }
  const heading = `True Master Set — ${metas.length} card${metas.length === 1 ? '' : 's'}`;
  openPrintDoc(buildChecklistDoc(metas, heading, 'True Master Set Checklist'));
}

// Single set. `setModeMetas` lives in setmode.js because the card data it synthesises
// from is module-private there — the same arrangement as tmsMetas above, just on the
// other side of the import. (setmode.js does not import this file, so no cycle.)
function printSetSelected() {
  if (!state.ssTarget) { alert('Pick a set first.'); return; }
  const metas = setModeMetas();
  if (!metas.length) { alert('No cards ticked in this set yet.'); return; }
  openPrintDoc(buildCardSheetDoc(metas));
}

function printSetChecklist() {
  if (!state.ssTarget) { alert('Pick a set first.'); return; }
  const metas = setModeMetas();
  if (!metas.length) { alert('No cards ticked in this set yet.'); return; }
  const heading = `${openSetName()} — ${metas.length} card${metas.length === 1 ? '' : 's'}`;
  openPrintDoc(buildChecklistDoc(metas, heading, 'Set Checklist'));
}

export {
  printSelected, printChecklist,
  printTmsSelected, printTmsChecklist,
  printSetSelected, printSetChecklist,
};
