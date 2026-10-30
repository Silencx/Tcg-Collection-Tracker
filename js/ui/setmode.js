// =============================================================================
// ui/setmode.js — single-set mode: complete one expansion, start to finish.
//
// SEPARATE CHECKLIST, deliberately (state.ssChecked / tcgSetChk_v1). The same physical
// card can be ticked independently here and in Master Set, and nothing reconciles them.
// That is the accepted cost of the decision: the two modes answer different questions
// ("every printing of my Pokémon" vs "this whole expansion"), and the id formats are
// identical (`EN_base1-4`), so merging them later is cheap. Un-merging would not be.
//
// TILES ARE BUILT HERE rather than by reusing renderBySet: that function is organised
// around era → set → Pokémon grouping over a multi-set page, and a single set needs
// none of it. The shared pieces that actually matter — the placeholder card, the
// variant badges, the language colours — are imported from masterset.js, which is the
// same arrangement tms.js already uses.
//
// NO LANGUAGE FILTER. The language is chosen in the PICKER, before the set, so the open
// set has exactly one and the grid renders one tile per card — not one per card per
// language. This mode therefore owns no `.filter-pill` at all, which is also why
// tests/pill-scope.test.mjs has nothing to say about it.
// =============================================================================

import { state, saveSetChk, saveSsPrints, saveSetTarget, saveSetPicker } from '../state.js';
import { LANGUAGES, PLACEHOLDER_LANGS, NATIVE_NAMES } from '../config.js';
import { router } from '../api/router.js';
import { tcgdexAssetBase, tcgdexSerieSegment } from '../api/images.js';
import {
  langColor, mkPlaceholderEl, variantBadgesHtml, openPreviewMeta, markCardToggle,
} from './masterset.js';
import { expansionCard } from './dashboard.js';
import { viableSources, markGood, markBad, imgMeta } from '../api/img-cache.js';
import { escapeHtml } from './html.js';
import { el } from './dom.js';
import {
  setProgress, percentComplete, buildSetList, matchesSetQuery, groupSetsBySeries,
  belongsToSet, pickerLanguages,
} from './setmode-model.js';
import { formatSetDate } from './dashboard-model.js';
import {
  printsOf, tracksPrints, printId, applyPrint, applyCard, clearPrintsOf, printTotals,
  printUnset, expandMeta, splitPrintId,
} from './prints-model.js';
import { mkPrintChips, syncChips, markUnset, mkPrintTag } from './prints-ui.js';

// Cards for the currently-open set, so a language-pill click re-filters without refetching.
let openSet = null;      // { id, name, releaseDate, symbol, serie, count, lang }
let openCards = [];      // the provider's card array
let pickerMeta = null;   // data/sets.json, loaded once
let pickerRows = [];     // buildSetList output for rowsCacheKey
let rowsCacheKey = null; // the language pickerRows was built for
let pickerQuery = '';
// Per-print tracking: checklist card id → its prints, for the open set's cards that have
// two or more. Rebuilt by paintSet; read by the tiles, the stats and the print sheet.
const openPrints = new Map();

const app = () => document.getElementById('set-app');

// ── SET PICKER ────────────────────────────────────────────────────────────────

/** The whole snapshot, memoised — the picker reads five of its maps, not just rows. */
async function loadPickerMeta() {
  if (pickerMeta) return pickerMeta;
  // Snapshot-first, like every other read — data/sets.json covers every set, so the
  // picker normally costs no network at all.
  pickerMeta = await router.getSetMeta({ setIds: [] });
  // Cache the denominators on state so the header can show one before the set loads.
  state.ssCardCounts = pickerMeta.counts || {};
  return pickerMeta;
}

/** Rows for the current language + digital setting, memoised until either changes. */
function currentRows() {
  const key = state.ssPickerLang;
  if (rowsCacheKey !== key) {
    pickerRows = buildSetList(pickerMeta || {}, { lang: key });
    rowsCacheKey = key;
  }
  return pickerRows;
}

function renderPicker(root) {
  root.textContent = '';
  const head = el('div', 'set-picker-head');
  head.appendChild(el('h2', 'set-picker-title', 'Pick a set to complete'));

  // The search / language / sort row goes in the STICKY bar, not the page body: this
  // mode's one context bar (see the ONE CONTEXT BAR note in index.html), and it keeps
  // the controls reachable while you scroll 200 sets.
  const bar = document.getElementById('set-bar') || el('div', 'set-picker-bar');
  bar.textContent = '';
  bar.classList.add('set-picker-bar');
  const search = el('input', 'set-picker-search');
  search.type = 'search';
  search.placeholder = 'Search by name or set id (e.g. sv05)…';
  search.setAttribute('aria-label', 'Search sets');
  search.value = pickerQuery;

  // Language. Sets exist in different languages in different numbers — 218 English
  // against 70 Indonesian — and the three Asian namespaces are entirely different sets,
  // not translations, so this genuinely changes WHICH sets are listed, not just how
  // they are labelled. The count is in the option text for exactly that reason.
  const langSel = el('select', 'set-picker-lang');
  langSel.setAttribute('aria-label', 'Set language');
  for (const l of pickerLanguages(pickerMeta || {})) {
    const opt = el('option', null, `${l.badge} · ${l.label} (${l.count})`);
    opt.value = l.code;
    if (l.code === state.ssPickerLang) opt.selected = true;
    langSel.appendChild(opt);
  }

  const sortBtn = el('button', 'set-picker-sort');
  sortBtn.type = 'button';
  const paintSort = () => {
    sortBtn.textContent = state.ssPickerAsc ? '↑ Oldest first' : '↓ Newest first';
    sortBtn.title = 'Flip the release-date order';
  };
  paintSort();

  const list = el('div', 'set-picker-list');
  // addEventListener, not inline onclick=: these three are the picker's own chrome, so
  // keeping them here means index.html and main.js's window manifest need no entry.
  search.addEventListener('input', e => { pickerQuery = e.target.value; paintPickerList(list); });
  langSel.addEventListener('change', e => {
    state.ssPickerLang = e.target.value;
    saveSetPicker();
    paintPickerList(list);
  });
  sortBtn.addEventListener('click', () => {
    state.ssPickerAsc = !state.ssPickerAsc;
    saveSetPicker();
    paintSort();
    paintPickerList(list);
  });

  bar.append(search, langSel, sortBtn);
  root.append(head, list);
  paintPickerList(list);
}

/**
 * The open set's sticky bar: which set you are looking at.
 *
 * #set-bar is shown in BOTH of this mode's states — picker controls while choosing, set
 * identity once chosen — because hiding it for one of them made .sticky-top 34px shorter
 * with a set open than in the picker, and the whole page stepped up and down every time
 * you opened a set or backed out of one.
 *
 * Its content is the set header that used to be the first thing INSIDE the grid
 * (symbol · name · release date · size), so this is a move, not a duplicate: the grid now
 * starts at the top of the page and the set's identity stays on screen while you scroll
 * 200 cards. Progress lives at the bottom, in #set-status-bar.
 */
function renderSetBar() {
  const bar = document.getElementById('set-bar');
  if (!bar) return;
  bar.textContent = '';
  bar.classList.remove('set-picker-bar');
  bar.classList.add('set-open-bar');
  if (openSet?.symbol) {
    const sym = el('img', 'set-bar-sym');
    sym.src = openSet.symbol; sym.alt = '';
    sym.onerror = () => sym.remove();
    bar.appendChild(sym);
  }
  bar.appendChild(el('span', 'set-bar-name', openSet?.name || state.ssTarget || ''));
  if (openSet?.releaseDate) {
    bar.appendChild(el('span', 'set-bar-date', formatSetDate(openSet.releaseDate)));
  }
  const total = openSet?.count?.official || state.ssCardCounts[state.ssTarget]?.official || 0;
  if (total) bar.appendChild(el('span', 'set-bar-date', `${total} cards`));
}

/**
 * The open set's status bar, docked to the bottom of the viewport (index.html explains
 * why it is not a third strip under the header). Static markup — only the name and the
 * one-time click wiring are set here; renderSetStats owns the numbers.
 */
function showStatusBar() {
  const bar = document.getElementById('set-status-bar');
  if (!bar) return;
  // style.display, not [hidden], because applyModeUI drives this element the same way it
  // drives every other panel — a `hidden` attribute would be silently outranked by the
  // inline display it sets on a mode switch.
  bar.style.display = 'block';
  const name = document.getElementById('set-status-name');
  if (name) name.textContent = openSet?.name || state.ssTarget || '';
  const back = document.getElementById('set-status-back');
  // Once, not on every paintSet: the element is in index.html and survives every render,
  // so re-adding would stack a listener per repaint.
  if (back && !back.dataset.wired) {
    back.dataset.wired = '1';
    back.addEventListener('click', changeSet);
  }
}

function hideStatusBar() {
  const bar = document.getElementById('set-status-bar');
  if (bar) bar.style.display = 'none';
}

function paintPickerList(list) {
  list.textContent = '';
  const rows = currentRows().filter(r => matchesSetQuery(r, pickerQuery));
  if (!rows.length) {
    list.appendChild(el('p', 'set-picker-empty', 'No sets match that search.'));
    return;
  }
  const seriesList = pickerMeta?.series?.[state.ssPickerLang] || [];
  for (const group of groupSetsBySeries(rows, seriesList, { asc: state.ssPickerAsc })) {
    const h = el('div', 'set-picker-series');
    h.append(el('span', 'set-picker-series-name', group.name),
             el('span', 'set-picker-series-count',
                `${group.rows.length} ${group.rows.length === 1 ? 'set' : 'sets'}`));
    list.appendChild(h);
    const grid = el('div', 'dash-exp-grid');
    for (const row of group.rows) grid.appendChild(pickerCard(row));
    list.appendChild(grid);
  }
}

/** One set, in the same card shape the dashboard's Expansions section uses. */
function pickerCard(row) {
  // Progress against the SEPARATE single-set checklist, so a set you have already
  // started is obvious in the list — and scoped to the language being browsed, because
  // that is the language you would be completing it in.
  const badge = (LANGUAGES.find(l => l.code === state.ssPickerLang)
    || PLACEHOLDER_LANGS.find(l => l.code === state.ssPickerLang) || {}).badge || null;
  const prog = setProgress(state.ssChecked, row.id, badge);
  const official = row.count?.official || 0;
  const card = expansionCard({
    id: row.id,
    name: row.name,
    date: row.date,
    symbol: row.symbol,
    logo: row.logo,
    owned: prog.cards,
    printings: prog.printings,
    total: official,
    pct: percentComplete(prog.cards, official),
  }, { onPick: chooseSet, inert: row.empty });
  if (row.empty) {
    // Says WHY it cannot be opened. TCGdex lists the set but ships no card list for it
    // in this language — 80 of Italian's 190 sets, 43 of Thai's 72.
    card.title = `${row.name} — no card list published in this language yet`;
  }
  return card;
}

/** Pick a set: persist the choice and render it. */
export function chooseSet(setId) {
  // Clear the previous set BEFORE persisting, for the reason spelled out in changeSet.
  if (setId !== state.ssTarget) { openSet = null; openCards = []; }
  state.ssTarget = setId || null;
  saveSetTarget();
  renderSetMode();
}

/** Inline-onclick target (published on window by main.js): back to the picker. */
export function changeSet() {
  // ORDER IS LOAD-BEARING: saveSetTarget fires 'tcg:settings-changed', which main.js
  // uses to re-apply the page title — and the title for this mode is openSetName().
  // Clearing openSet after that call left the h1 reading the set you had just left.
  openSet = null;
  openCards = [];
  state.ssTarget = null;
  saveSetTarget();
  renderSetMode();
}

// ── THE SET ITSELF ────────────────────────────────────────────────────────────

/**
 * Asset base for one card in one CDN language, or null for languages with no image
 * source at all (KR, SC).
 *
 * The ONE place this mode derives a CDN path, so the serie-segment fix has a single
 * call site. `openSet.serie` comes straight from the TCGdex response and is
 * authoritative; the string rule below it is wrong for a large minority of sets
 * (swshp → swsh, cel25 → swsh, A1 → tcgp) and is only a fallback for a snapshot hit,
 * which carries no serie.
 */
function assetBaseFor(card, code) {
  if (!code) return null;
  const serie = openSet?.serie?.id || tcgdexSerieSegment(state.ssTarget, pickerMeta?.setSeries);
  return tcgdexAssetBase(code, serie, state.ssTarget, card.localId);
}

/**
 * Print/preview metadata for one card in one language.
 *
 * ONE builder for both consumers. The preview modal and the print sheet want the same
 * object (masterset.js documents the shape), and building it in two places is how they
 * drift — this mode keeps no state._meta index to read it back from, deliberately:
 * buildAll clears that map and refills it with Master Set's cards, so an id present in
 * both modes would race.
 */
function cardMeta(card, def) {
  const base = assetBaseFor(card, def.code || null);
  return {
    name: { en: card.name, native: (NATIVE_NAMES[def.badge] || {})[card.species || card.name] || null },
    setName: openSet?.name || state.ssTarget,
    num: `#${card.localId}`,
    lang: def.badge,
    langColor: def.color,
    symSrc: openSet?.symbol || null,
    ...imgMeta(base ? [`${base}/low.webp`] : [], base ? [`${base}/high.webp`] : []),
  };
}

/**
 * One tile per card, mirroring Master Set's checklist unit — or, in the tiles view of
 * per-print tracking, one tile per PRINT (`pr`), with the same data-card / data-print
 * shape Master Set uses (see the note above its togglePrint).
 */
function cardTile(card, badge, color, code, pr = null) {
  const cardId = `${badge}_${card.id}`;
  const list = openPrints.get(cardId) || [];
  const chips = !pr && state.printView === 'chips' && tracksPrints(list);
  const id = pr ? printId(cardId, pr.key) : cardId;
  const isDone = pr ? state.ssPrints.has(id) : state.ssChecked.has(id);
  const tile = el('div', 'card' + (pr ? ' card-print' : '') + (isDone ? ' done' : ''));
  tile.dataset.id = id;
  tile.dataset.lang = badge;
  if (pr) {
    tile.dataset.card = cardId;
    tile.dataset.print = pr.key;
  }
  // Owning a card is shown by the artwork being in full colour, which a screen reader
  // cannot see and a keyboard cannot reach — so the tile carries the role the deleted
  // checkbox used to. Shared with Master Set so both grids announce the same thing.
  markCardToggle(tile, isDone);
  if (pr) tile.setAttribute('aria-label', pr.label);

  const wrap = el('div', 'img-wrap');
  const nat = (NATIVE_NAMES[badge] || {})[card.species || card.name] || null;
  // Placeholder first, image underneath — same ordering as mkImgWrap and the TMS popup,
  // so a language with no artwork shows a card-shaped stand-in rather than an empty box.
  const ph = mkPlaceholderEl(openSet?.symbol || null, badge, color, card.name, nat,
    openSet?.name || state.ssTarget, card.localId);
  wrap.appendChild(ph);

  // `code` is null for the placeholder-only languages (KR, SC) — they have no public
  // image source at all, so they get the placeholder and no request.
  const base = assetBaseFor(card, code);
  const src = base ? `${base}/low.webp` : null;
  // Known-missing artwork is skipped without a request (img-cache.js). TCGdex has no
  // images at all for zh-Hant/th/id, and this grid renders every active language.
  if (src && viableSources([src]).length) {
    ph.classList.add('ph-over');
    const img = el('img', 'card-img');
    img.loading = 'lazy'; img.decoding = 'async'; img.fetchPriority = 'low';
    img.alt = `${card.name} #${card.localId} ${badge}`;
    img.onload = () => { ph.remove(); markGood(src); };
    img.onerror = () => { img.remove(); markBad(src); ph.classList.remove('ph-over'); };
    img.src = src;
    wrap.appendChild(img);
  }

  const footer = el('div', 'card-footer');
  // innerHTML with escaped interpolation, matching mkCardFooter and the TMS popup.
  // With prints tracked, the chips / the print tag say what the badges did.
  footer.innerHTML = `<span class="card-num">#${escapeHtml(card.localId)}</span>`
    + (chips || pr ? '' : variantBadgesHtml(card.variants))
    + `<span class="lang lang-${escapeHtml(badge)}" style="background:${escapeHtml(color)}">${escapeHtml(badge)}</span>`;
  if (pr) footer.insertBefore(mkPrintTag(pr), footer.querySelector('.lang'));

  tile.append(wrap);
  if (chips) tile.append(mkPrintChips(list));
  tile.append(footer);
  syncSetTile(tile);
  // Single click ticks; double click opens the preview and UNDOES the first click's
  // tick, so a double-click is net-zero on the checklist. Same contract as Master Set's
  // delegated handler — see installCardDelegation — including why this is not done by
  // delaying the single click: the core loop here is ticking a whole set.
  tile.addEventListener('click', e => {
    // A chip ticks its print, never the card under it; a double-tap on one is one toggle.
    const chip = e.target.closest('.pchip');
    if (chip) { if (e.detail <= 1) toggleSetPrint(tile, cardId, chip.dataset.key); return; }
    if (e.detail > 1) return;                 // second click of a double-click
    toggleSetTile(tile);
  });
  tile.addEventListener('dblclick', e => {
    if (e.target.closest('.pchip')) return;
    toggleSetTile(tile);                      // revert the first click of this double
    openPreviewMeta(cardMeta(card, { badge, color, code }));
  });
  return tile;
}

/** One click on a tile: a print tile toggles its print, a card tile its card. */
function toggleSetTile(tile) {
  if (tile.dataset.print) { toggleSetPrint(tile, tile.dataset.card, tile.dataset.print); return; }
  const id = tile.dataset.id;
  applyCard(state.ssChecked, state.ssPrints, id, !state.ssChecked.has(id));
  syncSetTile(tile);
  saveSsPrints(); saveSetChk();
  renderSetStats();
}

/** Tick/untick one print (chip or print tile); prints-model.js has the rules. */
function toggleSetPrint(tile, cardId, printKey) {
  const keys = keysFor(cardId);
  applyPrint(state.ssChecked, state.ssPrints, cardId, printKey,
    !state.ssPrints.has(printId(cardId, printKey)), keys);
  // In the tiles view one tick can change a sibling's "which print?" hint.
  const tiles = tile.dataset.print
    ? [...tile.parentNode.querySelectorAll(`.card[data-card="${CSS.escape(cardId)}"]`)]
    : [tile];
  tiles.forEach(syncSetTile);
  saveSsPrints(); saveSetChk();
  renderSetStats();
}

const keysFor = cardId => (openPrints.get(cardId) || []).map(p => p.key);

/** Make one tile's classes match the two sets. */
function syncSetTile(tile) {
  if (tile.dataset.print) {
    const on = state.ssPrints.has(tile.dataset.id);
    tile.classList.toggle('done', on);
    tile.setAttribute('aria-checked', on ? 'true' : 'false');
    markUnset(tile, printUnset(state.ssChecked, state.ssPrints, tile.dataset.card, keysFor(tile.dataset.card)));
    return;
  }
  const id = tile.dataset.id, on = state.ssChecked.has(id);
  tile.classList.toggle('done', on);
  tile.setAttribute('aria-checked', on ? 'true' : 'false');
  syncChips(tile, state.ssPrints, id, keysFor(id), on);
}

/**
 * The open set's "P / Q prints" and its print-sheet size, in its own language.
 * Q counts every card (min one print each); P the prints ticked; `slots` is one per
 * ticked print plus one per owned card with no print recorded — what Print selected prints.
 */
function setPrintStats(badge) {
  let total = 0, done = 0, slots = 0;
  for (const card of openCards) {
    const id = `${badge}_${card.id}`;
    const keys = keysFor(id);
    const [t, d] = printTotals(state.ssChecked, state.ssPrints, id, keys);
    total += t; done += d;
    if (state.ssChecked.has(id)) slots += tracksPrints(keys) ? Math.max(1, d) : 1;
  }
  return { total, done, slots };
}

/** The one place that recomputes the header numbers, from the checklist. */
function renderSetStats() {
  const badge = openBadge();
  // Scoped to the set's language — see the comment on setProgress. With one language
  // per view, cards and printings are the same number.
  const prog = setProgress(state.ssChecked, state.ssTarget, badge);
  const official = openSet?.count?.official || state.ssCardCounts[state.ssTarget]?.official || 0;
  const pct = percentComplete(prog.cards, official);

  const pr = state.printView !== 'off' && openSet?.id === state.ssTarget ? setPrintStats(badge) : null;
  const stats = document.getElementById('stats');
  if (stats) {
    stats.textContent = official ? `${prog.cards} / ${official} cards` : `${prog.cards} cards`;
    if (pr) stats.appendChild(el('span', 'stats-prints', ` · ${pr.done} / ${pr.total} prints`));
  }

  const bar = document.getElementById('set-progress-fill');
  if (bar) bar.style.width = `${pct ?? 0}%`;
  const label = document.getElementById('set-progress-label');
  if (label) {
    const lang = (LANGUAGES.find(l => l.badge === badge)
      || PLACEHOLDER_LANGS.find(l => l.badge === badge) || {}).label || badge;
    label.textContent = (pct === null
      ? `${prog.cards} collected · ${lang}`
      : `${pct}% complete · ${prog.cards} of ${official} · ${lang}`)
      + (pr ? ` · ${pr.done} of ${pr.total} prints` : '');
  }
  const pb = document.getElementById('btn-set-print-sel');
  if (pb) pb.textContent = `Print selected (${pr ? pr.slots : prog.cards})`;
}

// NO IN-PAGE SET HEADER, DELIBERATELY. The symbol/name/date block that used to open the
// grid is now the contents of the sticky #set-bar (renderSetBar), so it stays on screen
// for all 200 cards instead of scrolling away after the first row.

// ── NO LANGUAGE FILTER HERE, DELIBERATELY ─────────────────────────────────────
//
// This mode used to carry a copy of Master Set's twelve language pills. That was
// incoherent: you choose the language in the PICKER, before choosing the set, so the set
// you are looking at already has exactly one. Offering to "add German" to a set you
// opened from the English list asked the same question twice and answered it differently.
//
// So the grid renders one tile per card in the set's own language, and completion is
// scoped to that language — "Temporal Forces in German" is its own goal, with its own
// progress, against the same 162-card denominator.

/** The badge the open set's cards are checked under — its own language. */
function openBadge() {
  const code = openSet?.lang || setLanguage(state.ssTarget);
  return (LANGUAGES.find(l => l.code === code)
       || PLACEHOLDER_LANGS.find(l => l.code === code) || LANGUAGES[0]).badge;
}

/** Inline-onclick target: tick every tile (or untick them all if already done). */
export function selectAllSet() {
  const root = app();
  if (!root) return;
  const tiles = [...root.querySelectorAll('.card[data-lang]')];
  if (!tiles.length) return;
  // .done is the tile's own unit — its card, or in the tiles view its print.
  const allDone = tiles.every(t => t.classList.contains('done'));
  const dropped = new Set();
  for (const t of tiles) {
    if (t.dataset.print) {
      const { cardId, key: printKey } = splitPrintId(t.dataset.id);
      if (state.ssPrints.has(t.dataset.id) === allDone) {
        applyPrint(state.ssChecked, state.ssPrints, cardId, printKey, !allDone, keysFor(cardId));
      }
    } else if (allDone) { state.ssChecked.delete(t.dataset.id); dropped.add(t.dataset.id); }
    else state.ssChecked.add(t.dataset.id);
  }
  // Unticked cards lose their prints, in one pass rather than one per card.
  if (dropped.size) clearPrintsOf(state.ssPrints, dropped);
  tiles.forEach(syncSetTile);
  saveSsPrints(); saveSetChk();
  renderSetStats();
}

/** Inline-onclick target: clear THIS set's ticks only, never the other checklists. */
export function resetSet() {
  if (!state.ssTarget) return;
  if (!confirm(`Clear every tick in ${openSet?.name || state.ssTarget}?`)) return;
  for (const id of [...state.ssChecked]) {
    if (belongsToSet(id, state.ssTarget)) state.ssChecked.delete(id);
  }
  clearPrintsOf(state.ssPrints, cardId => belongsToSet(cardId, state.ssTarget));
  saveSsPrints(); saveSetChk();
  app()?.querySelectorAll('.card[data-id]').forEach(syncSetTile);
  renderSetStats();
}

// ── RENDER ────────────────────────────────────────────────────────────────────

/**
 * The language to FETCH a set in.
 *
 * The picker's language FIRST, but only when the set exists there — that is the set you
 * were actually looking at. The Chinese, Thai and Indonesian releases overlap heavily
 * (S12a is published in all three), so falling straight through to LANGUAGES order
 * handed you the Traditional Chinese set after you clicked a Thai-named card.
 *
 * Then English, then whichever language does own it. The last two steps are what stop
 * browsing in Thai from trying /th/sets/sv05, which is a 404 — a set you picked from a
 * DIFFERENT language's list still has to load.
 */
function setLanguage(setId) {
  const names = pickerMeta?.names;
  if (!names) return 'en';
  if (names[state.ssPickerLang]?.[setId]) return state.ssPickerLang;
  if (names.en?.[setId]) return 'en';
  const owner = LANGUAGES.find(l => names[l.code]?.[setId]);
  return owner?.code || 'en';
}

/** Entry point, called by main.js's MODE_ENTER. Idempotent. */
export async function renderSetMode() {
  const root = app();
  if (!root) return;
  const controls = document.getElementById('set-controls');

  const stickyBar = document.getElementById('set-bar');

  if (!state.ssTarget) {
    // Picker: no set chosen, so this mode's chrome has nothing to act on. applyModeUI
    // has already shown it (it works per MODE, and cannot know whether a set is picked);
    // overriding here holds until the next mode switch re-runs applyModeUI.
    if (controls) controls.style.display = 'none';
    if (stickyBar) { stickyBar.style.display = 'flex'; stickyBar.classList.remove('set-open-bar'); }
    hideStatusBar();
    // Emptying #stats leaves a bare rounded pill — .stats has its own padding and
    // background, so "no text" still paints. Hide it outright.
    const stats = document.getElementById('stats');
    if (stats) { stats.textContent = ''; stats.style.display = 'none'; }
    root.textContent = '';
    root.appendChild(el('p', 'set-loading', 'Loading sets…'));
    try {
      await loadPickerMeta();
    } catch (err) {
      root.textContent = '';
      root.appendChild(el('p', 'set-loading', `Could not load the set list: ${err.message}`));
      return;
    }
    if (state.ssTarget) return;   // a click landed while the list was loading
    renderPicker(root);
    return;
  }

  if (controls) controls.style.display = 'flex';
  // Same bar, different contents — see renderSetBar for why it is never hidden.
  if (stickyBar) stickyBar.style.display = 'flex';
  // Undo the picker branch's override — renderSetStats fills it in a moment.
  const stats = document.getElementById('stats');
  if (stats) stats.style.display = '';

  // Already in memory from an earlier visit to this same set — repaint without a fetch.
  // applyModeUI only toggles `display`, so switching away and back is common, and the
  // set's card list cannot change within one document.
  if (openSet?.id === state.ssTarget && openCards.length) {
    paintSet(root);
    return;
  }

  root.textContent = '';
  root.appendChild(el('p', 'set-loading', 'Loading cards…'));

  let res;
  try {
    // LOAD-BEARING: the fetch language comes from the SET's own namespace, never from
    // the picker's current language. zh-Hant/th/id sets share no ids with English, so
    // /en/sets/SC2b is a 404 — and browsing the picker in Thai while sv05 is the chosen
    // set must not make sv05 suddenly unfetchable.
    res = await router.getSetCards(state.ssTarget, { lang: setLanguage(state.ssTarget) });
  } catch (err) {
    root.textContent = '';
    const fail = el('div', 'set-loading');
    fail.appendChild(document.createTextNode(`Could not load ${state.ssTarget}: ${err.message} `));
    const retry = el('button', 'btn btn-secondary', '↺ Retry');
    retry.addEventListener('click', () => renderSetMode());
    fail.appendChild(retry);
    root.appendChild(fail);
    return;
  }
  // A mode switch or a different set can land while the fetch is in flight.
  if (state.appMode !== 'set' || !state.ssTarget) return;

  openCards = res.cards || [];
  openSet = {
    ...res.set,
    // The live response carries the authoritative count; sets.json is the fallback for
    // a snapshot build that predates `counts`.
    count: res.set?.count || state.ssCardCounts[state.ssTarget] || null,
  };
  // The page title is the SET NAME in this mode, and the name only exists once this
  // fetch resolves — main.js has the id long before it has the name. NOT reusing
  // 'tcg:settings-changed': that also fires saveSessionSoon, and finishing a render is
  // not a settings change.
  document.dispatchEvent(new CustomEvent('tcg:set-loaded'));
  paintSet(root);
}

/** The chosen set's display name, for main.js's per-mode title table. */
export function openSetName() {
  return openSet?.name || state.ssTarget || null;
}

/**
 * Ticked cards of the OPEN set, as print metadata.
 *
 * Read by js/ui/print.js, mirroring how masterMetas reads state._meta and tmsMetas
 * reads state.tmsPokeCache. This mode keeps no meta index — tiles are built and
 * discarded — so the metas are synthesised from `openCards`, which is exactly what
 * tmsMetas does with its own cache.
 *
 * THREE filters, all load-bearing: state.ssChecked holds ids from every set you have
 * ever ticked (hence belongsToSet); the same set may have been ticked in another
 * LANGUAGE, which is a different goal and does not belong in this print job; and a set
 * can be re-opened after ticks were made against a different set, so an id with no
 * matching card in openCards is skipped rather than printed as a blank.
 */
export function setModeMetas() {
  if (!state.ssTarget || !openCards.length) return [];
  const only = openBadge();
  const byId = new Map(openCards.map(c => [c.id, c]));
  const metas = [];
  for (const id of state.ssChecked) {
    if (!belongsToSet(id, state.ssTarget)) continue;
    const cut = id.indexOf('_');
    const badge = id.slice(0, cut);
    if (badge !== only) continue;
    const card = byId.get(id.slice(cut + 1));
    if (!card) continue;
    const def = LANGUAGES.find(l => l.badge === badge)
             || PLACEHOLDER_LANGS.find(l => l.badge === badge);
    if (!def) continue;
    // With prints tracked: one sheet entry per ticked print (prints-model.expandMeta).
    if (state.printView !== 'off') metas.push(...expandMeta(cardMeta(card, def), id, openPrints.get(id) || [], state.ssPrints));
    else metas.push(cardMeta(card, def));
  }
  return metas;
}

/** Header + grid for whatever is in openSet/openCards. Pure DOM, no fetching. */
function paintSet(root) {
  root.textContent = '';
  renderSetBar();
  showStatusBar();
  // ONE tile per card, in the set's own language. This used to be one tile per card per
  // language — 12× the DOM, 11 of them guaranteed 404s for any single-namespace set, and
  // a question the picker had already answered.
  const code = openSet?.lang || setLanguage(state.ssTarget);
  const def = LANGUAGES.find(l => l.code === code)
           || PLACEHOLDER_LANGS.find(l => l.code === code)
           || LANGUAGES[0];
  const grid = el('div', 'cards-grid');
  openPrints.clear();
  for (const card of openCards) {
    const list = printsOf(card.variants);
    if (tracksPrints(list)) openPrints.set(`${def.badge}_${card.id}`, list);
  }
  for (const card of openCards) {
    const list = openPrints.get(`${def.badge}_${card.id}`);
    // Tiles view: one tile per print, in place of the card's single tile.
    if (list && state.printView === 'tiles') {
      for (const pr of list) grid.appendChild(cardTile(card, def.badge, def.color, def.code || null, pr));
    } else {
      grid.appendChild(cardTile(card, def.badge, def.color, def.code || null));
    }
  }
  root.appendChild(grid);
  renderSetStats();
}

/**
 * Repaint the open set in the current print view (js/ui/printview.js). Nothing to do on
 * the picker, or before the set's cards have arrived — the first paint will use it.
 */
export function repaintSet() {
  const root = app();
  // Only while this mode is ON SCREEN: paintSet also shows this mode's bars. Entering
  // the mode later repaints the open set anyway (renderSetMode), in whatever view is set.
  if (state.appMode !== 'set') return;
  if (!root || !state.ssTarget || openSet?.id !== state.ssTarget || !openCards.length) return;
  paintSet(root);
}
