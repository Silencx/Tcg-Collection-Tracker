// =============================================================================
// ui/setnav.js — the set-navigation sidebar (Master Set mode).
//
// The app had no set navigation at all: #dyn is one flat, document-order run of
// era labels and set blocks, and the only way to reach a set was to scroll. The
// default Pokémon list is 41 sets over a ~24000px page; a popular Pokémon is
// several hundred. This panel lists them, jumps to them, shows per-set progress,
// and tracks which one you are looking at.
//
// IMPORT DIRECTION: this module must NOT import masterset.js. tms.js already
// imports masterset, so that would close a cycle. It doesn't need to — it holds
// the set-block ELEMENTS, so it jumps by scrolling one of them into view, and
// "select every card in this set" is delegated by clicking the set head's own
// .set-select-btn, reusing the listener mkSetBlock already attached.
//
// Everything DOM-free (grouping, ids, query matching) lives in setnav-index.js so
// `node --test` can cover it without jsdom.
// =============================================================================

import * as storage from '../storage.js';
import { SETNAVSTORE } from '../config.js';
import { buildSetNavIndex, matchesNavQuery } from './setnav-index.js';
import { toggleCollapseAll } from './collapse.js';
import { collapseButtonLabel } from './collapse-model.js';

// Docked at this width and above; a drawer over the content below it.
const DOCK_MIN_PX = 1000;

// Row state lives here, NOT on the shared `state` object: it is owned by exactly
// this module, and every key added to that object is added to the name list
// tools/state-prefix-scan.mjs derives, which then fails the build on any bare
// identifier of the same name anywhere in js/**.
let rows = [];              // [{ row, block, name, eraLabel, countEl, section }]
let sections = [];          // [{ el, sets:number, shown:number }]
let query = '';
let open = false;
let spy = null;             // IntersectionObserver over .set-head
let pointerInPanel = false;
let animating = false;      // true while the panel is mid-slide (see beginAnim)
let animEnd = null;         // the transitionend handler currently attached, if any
let animTimer = 0;
let lastStickyH = -1;       // last value published to --sticky-h, to skip no-op republishes
let stickyRaf = 0;

// ── SHELL ─────────────────────────────────────────────────────────────────────

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function panel()   { return document.getElementById('set-nav'); }
function listEl()  { return document.getElementById('set-nav-list'); }
function scrimEl() { return document.getElementById('set-nav-scrim'); }

/**
 * The sticky header wraps to several rows and its height changes with the
 * viewport, so no fixed jump offset works. Publish the measured height as
 * --sticky-h; style.css turns it into scroll-margin-top on set blocks and era
 * labels, which scrollIntoView then honours without any manual arithmetic.
 */
function watchStickyHeight() {
  const top = document.querySelector('.sticky-top');
  if (!top || typeof ResizeObserver === 'undefined') return;
  const publish = h => {
    const px = Math.round(h);
    // Bail on a no-op republish. installSpy() disconnects and re-observes EVERY
    // .set-head in the document — 41 on the demo list, hundreds on a popular Pokémon —
    // so it must not run for a resize that did not actually change the height. The
    // sticky header re-wraps on window resizes and whenever a Pokémon chip is added or
    // removed, and ResizeObserver reports those as a burst; this collapses the burst
    // to at most one rebuild per genuine height change.
    // (The panel itself no longer affects this: it overlays rather than reserving
    // width, so opening it does not re-wrap the header at all.)
    if (px === lastStickyH) return;
    lastStickyH = px;
    document.documentElement.style.setProperty('--sticky-h', px + 'px');
    if (spy) installSpy();   // rootMargin is derived from it
  };
  publish(top.offsetHeight);
  new ResizeObserver(() => {
    // ResizeObserver can deliver several callbacks per frame; collapse them into one.
    if (stickyRaf) return;
    stickyRaf = requestAnimationFrame(() => { stickyRaf = 0; publish(top.offsetHeight); });
  }).observe(top);
}

function stickyH() {
  return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sticky-h'), 10) || 140;
}

// ── OPEN / CLOSED ─────────────────────────────────────────────────────────────

function docked() { return window.innerWidth >= DOCK_MIN_PX; }

function applyOpenState() {
  const p = panel(); if (!p) return;
  const isDocked = docked();
  document.body.classList.toggle('sb-docked', open && isDocked);
  document.body.classList.toggle('sb-open', open && !isDocked);
  p.classList.toggle('open', open);
  p.setAttribute('aria-hidden', open ? 'false' : 'true');
  const btn = document.getElementById('set-nav-toggle');
  if (btn) {
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.title = open ? 'Hide the set list' : 'Show the set list';
  }
}

/**
 * Flag the panel as mid-slide, and clear the flag when the slide ends.
 *
 * DEFENSIVE, not load-bearing. It was written when the docked panel animated body's
 * padding-left: that reflowed the page every frame, churned the scroll-spy's
 * intersection ratios, and made markCurrent scrollIntoView a panel that was still
 * moving. The panel overlays now, so a docked open changes no layout and the spy stays
 * quiet — but the drawer path still toggles body{overflow:hidden}, and suppressing an
 * auto-scroll for 220ms costs nothing, so the guard stays.
 * pointerInPanel covers "the user is scrolling the list"; this covers an open triggered
 * by the toggle button, Escape or a shared link.
 */
function beginAnim() {
  const p = panel();
  clearTimeout(animTimer);
  if (animEnd) { p?.removeEventListener('transitionend', animEnd); animEnd = null; }
  animating = true;

  const stop = () => {
    animating = false;
    clearTimeout(animTimer);
    if (animEnd) { p?.removeEventListener('transitionend', animEnd); animEnd = null; }
  };
  animEnd = e => { if (e.target === p && e.propertyName === 'transform') stop(); };
  p?.addEventListener('transitionend', animEnd);
  // Backstop. transitionend never arrives when the transition is zero-length
  // (prefers-reduced-motion) or the panel is display:none (TMS mode).
  animTimer = setTimeout(stop, 400);
}

function setOpen(next) {
  if (next !== open) beginAnim();
  open = next;
  storage.set(SETNAVSTORE, open ? '1' : '0');
  applyOpenState();
}

/** Inline-onclick target, published on window by main.js. */
export function toggleSetNav() { setOpen(!open); }

// ── ROW RENDERING ─────────────────────────────────────────────────────────────

function jumpTo(block) {
  if (!block) return;
  block.scrollIntoView({ block: 'start', behavior: 'smooth' });
  // With content-visibility:auto the blocks above the target contribute their
  // estimated height, not their real one, so a long jump lands short and then
  // shifts as the newly-relevant grids lay out for real. Re-scroll once the
  // layout has settled, and flash the head so a residual few pixels don't matter.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    block.scrollIntoView({ block: 'start', behavior: 'auto' });
    const head = block.querySelector('.set-head');
    if (!head) return;
    head.classList.remove('sb-flash');
    void head.offsetWidth;                 // restart the animation
    head.classList.add('sb-flash');
  }));
  if (!docked()) setOpen(false);           // a drawer covers what you jumped to
}

function mkRow(entry, block) {
  const row = el('button', 'sb-row' + (entry.isJp ? ' jp' : ''));
  row.type = 'button';
  row.id = entry.navId;
  const name = el('span', 'sb-row-name', entry.name);
  const count = el('span', 'sb-row-count', '');
  row.append(name, count);
  row.addEventListener('click', () => jumpTo(block));
  // Shift-click selects/deselects the set instead of navigating to it, by
  // clicking the set head's own button — no duplicated selection logic here.
  row.addEventListener('click', e => {
    if (!e.shiftKey) return;
    block.querySelector('.set-select-btn')?.click();
  }, true);
  return { row, count };
}

/**
 * Rebuild the index from #dyn's DIRECT CHILDREN.
 *
 * This walk (~40 elements for the default list) is the only representation that
 * is correct after fetchAndInjectJPCards splices JP blocks into computed
 * positions inside existing eras — reproducing that order from the card data
 * would mean duplicating the insertion logic. It is also why the display name
 * comes from setBlockNamesMap's `enName` rather than the live .set-name-en text,
 * which applyFilter rewrites per active language and would churn on every pill
 * click.
 *
 * @param {HTMLElement} container #dyn
 * @param {Map} namesMap state.setBlockNamesMap
 */
export function setNavRebuild(container, namesMap) {
  const list = listEl();
  if (!list || !container) return;

  const blocks = [];
  const descriptors = [];
  for (const node of container.children) {
    const cl = node.classList;
    if (cl.contains('era-label')) {
      descriptors.push({ kind: 'era', label: node.textContent || '', series: node.dataset.series || null });
    } else if (cl.contains('set-block')) {
      const info = namesMap?.get(node);
      const name = info?.enName || node.querySelector('.set-name-en')?.textContent?.trim() || 'Set';
      descriptors.push({ kind: 'set', name, isJp: !!node.querySelector('.set-head.c-orange') });
      blocks.push(node);
    }
  }

  list.textContent = '';
  rows = [];
  sections = [];

  for (const section of buildSetNavIndex(descriptors)) {
    const wrap = el('div', 'sb-section');
    if (section.era) wrap.appendChild(el('div', 'sb-era', section.era.label));
    const rec = { el: wrap, sets: section.sets.length, shown: section.sets.length };
    for (const entry of section.sets) {
      const block = blocks[entry.index];
      const { row, count } = mkRow(entry, block);
      wrap.appendChild(row);
      rows.push({ row, block, name: entry.name, eraLabel: section.era?.label || '', countEl: count, section: rec });
    }
    sections.push(rec);
    list.appendChild(wrap);
  }

  applyQuery();
  installSpy();
  updateEmpty();
  syncToggleVisibility();
}

/** Drop every row. Called before #dyn is wiped, so nothing points at dead nodes. */
export function setNavReset() {
  rows = [];
  sections = [];
  spy?.disconnect();
  spy = null;
  const list = listEl();
  if (list) list.textContent = '';
  updateEmpty();
  syncToggleVisibility();   // back to 0 rows ⇒ un-hide, ready for the coming rebuild
}

/**
 * One set block's tallies changed. Called from applyFilter's per-block loop (which
 * already holds the block, so this costs no traversal) and from a single card
 * toggle. A block hidden by the language filter has its row removed from the list
 * outright, along with its era heading once nothing is left under it.
 */
export function setNavSync(block, vis, done, allHidden) {
  const r = rows.find(x => x.block === block);
  if (!r) return;
  r.countEl.textContent = vis ? `${done}/${vis}` : '';
  r.row.style.setProperty('--p', vis ? (done / vis).toFixed(3) : '0');
  r.row.classList.toggle('complete', vis > 0 && done === vis);
  r.filtered = !!allHidden;
  applyRowVisibility(r);
  updateSectionVisibility(r.section);
  updateEmpty();
}

function applyRowVisibility(r) {
  const hidden = r.filtered || !matchesNavQuery(r.name, r.eraLabel, query);
  r.row.hidden = hidden;
  return !hidden;
}

function updateSectionVisibility(rec) {
  if (!rec) return;
  const shown = rows.some(r => r.section === rec && !r.row.hidden);
  rec.el.hidden = !shown;
}

function applyQuery() {
  for (const r of rows) applyRowVisibility(r);
  for (const rec of sections) updateSectionVisibility(rec);
  updateEmpty();
}

function updateEmpty() {
  const empty = document.getElementById('set-nav-empty');
  if (!empty) return;
  const any = rows.some(r => !r.row.hidden);
  empty.textContent = rows.length ? 'No sets match.' : 'No sets loaded yet.';
  empty.hidden = any;
}

// ── SCROLL SPY ────────────────────────────────────────────────────────────────

/**
 * Highlight the set you are currently looking at.
 *
 * Observes .set-head, never .cards-grid — and this is exactly why style.css puts
 * content-visibility on the GRID rather than on .set-block. Inside a skipped
 * subtree an element never reports intersecting, so heads must stay rendered or
 * the spy would go blind on precisely the off-screen sets it needs to track.
 */
function installSpy() {
  spy?.disconnect();
  if (!rows.length || typeof IntersectionObserver === 'undefined') { spy = null; return; }
  spy = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const block = entry.target.closest('.set-block');
      markCurrent(rows.find(r => r.block === block));
    }
  }, { rootMargin: `-${stickyH()}px 0px -65% 0px`, threshold: 0 });
  for (const r of rows) {
    const head = r.block?.querySelector('.set-head');
    if (head) spy.observe(head);
  }
}

function markCurrent(r) {
  if (!r) return;
  for (const other of rows) {
    if (other === r) continue;
    other.row.classList.remove('current');
    other.row.removeAttribute('aria-current');
  }
  r.row.classList.add('current');
  r.row.setAttribute('aria-current', 'true');
  // Don't fight a user who is scrolling the list themselves, and don't chase the
  // reflow while the panel is still sliding — only the auto-scroll is suppressed,
  // the .current class and aria-current above still update throughout.
  if (!pointerInPanel && !animating && !r.row.hidden) r.row.scrollIntoView({ block: 'nearest' });
}

// ── COLLAPSE ALL ──────────────────────────────────────────────────────────────
//
// The state itself lives in ui/collapse.js — it operates on #dyn, which this module
// does not own, and keeping it here is what produced the dead end where the only way
// to expand was a control inside a panel the user had just closed. This module now
// only renders the button and keeps its label in step.
//
// Collapsing is an EXPLICIT user action, never a default: the DOM is left fully intact
// (the grids are only display:none) so applyFilter, buildPills' DOM-derived language
// list, the stats totals and print's state._meta all stay correct — but display:none
// content is not findable with Ctrl+F, which is why it is opt-in and the button says so.

// ── MODE ──────────────────────────────────────────────────────────────────────

// TWO independent reasons the sidebar can be a dead control, tracked separately on
// purpose. setNavApplyMode used to write `t.style.display = ''` UNCONDITIONALLY on the
// way out of TMS, so a single shared flag would have had the mode switch un-hide a
// toggle that the one-set rule had hidden.
let hiddenForMode = false;
let hiddenForOneSet = false;

/**
 * Hide the panel, its scrim and the ☰ Sets toggle when the sidebar has nothing to
 * offer; restore them when it does.
 *
 * LOAD-BEARING: this must NOT go through setOpen(false). setOpen persists to
 * SETNAVSTORE, so hiding a one-set page that way would silently overwrite the user's
 * open/closed preference for every other Pokémon they look at afterwards. Mirror what
 * TMS mode does instead — hide the elements, drop the body classes, and leave both
 * `open` and storage untouched, so the preference is still intact when a second set
 * arrives and the panel comes back.
 *
 * body.sb-docked is what offsets the content; leaving it set while the panel is hidden
 * gives an empty left gutter, which is why it is cleared here and not only in applyOpenState.
 */
function applyPanelVisibility() {
  const hide = hiddenForMode || hiddenForOneSet;
  const p = panel(), s = scrimEl(), t = document.getElementById('set-nav-toggle');
  if (t) t.style.display = hide ? 'none' : '';
  if (p) p.style.display = hide ? 'none' : '';
  if (s) s.style.display = hide ? 'none' : '';
  if (hide) document.body.classList.remove('sb-docked', 'sb-open');
  else applyOpenState();
}

/**
 * One set is nothing to navigate BETWEEN — the whole page is that set.
 *
 * Hides at EXACTLY ONE row, never at zero. buildAll calls setNavReset before it wipes
 * #dyn, so the count legitimately passes through 0 on every single refresh; hiding
 * there would make the button blink out and back each time. Zero means "not built
 * yet", and setNavReset calling this is what UN-hides the toggle at the start of a
 * rebuild that may well produce more than one set.
 *
 * Called from setNavRebuild rather than once at boot because the count changes late:
 * fetchAndInjectJPCards runs un-awaited and rebuilds again, so a 1-set page can become
 * a 2-set page seconds after first paint.
 */
function syncToggleVisibility() {
  hiddenForOneSet = rows.length === 1;
  applyPanelVisibility();
}

/**
 * Only Master Set renders #dyn, and #dyn is the only thing this panel indexes. TMS's
 * main view is the Pokémon catalogue and the dashboard has no card list at all, so in
 * both the panel and its toggle are dead controls and get hidden outright.
 *
 * The test is `!== 'master'`, NOT `=== 'tms'`. Every "not TMS means Master" assumption
 * in this app broke the moment a third mode existed; this one would have shown an empty
 * set list over the dashboard.
 */
export function setNavApplyMode(mode) {
  hiddenForMode = mode !== 'master';
  applyPanelVisibility();
}

// ── INIT ──────────────────────────────────────────────────────────────────────

export function initSetNav() {
  const p = panel();
  if (!p) return;

  const head = el('div', 'sb-head');

  // Title row with a close button. Below 1000px the scrim (z 149) deliberately covers
  // .sticky-top (z 20), so the ☰ Sets toggle that opened the panel is dimmed and cannot
  // be clicked to close it again — the only ways out were a scrim tap or Escape, neither
  // of which is discoverable on a phone. Shown at every width: harmless on desktop,
  // essential on mobile.
  const top = el('div', 'sb-head-top');
  const title = el('span', 'sb-title', 'Sets');
  const closeBtn = el('button', 'sb-close', '×');
  closeBtn.type = 'button';
  closeBtn.title = 'Close the set list';
  closeBtn.setAttribute('aria-label', 'Close set list');
  closeBtn.addEventListener('click', () => setOpen(false));
  top.append(title, closeBtn);

  const row = el('div', 'sb-head-row');
  const search = el('input', 'sb-search');
  search.type = 'search';
  search.placeholder = 'Filter sets…';
  search.setAttribute('aria-label', 'Filter sets');
  search.addEventListener('input', e => { query = e.target.value; applyQuery(); });
  const collapseBtn = el('button', 'sb-collapse', '▾ Collapse all');
  collapseBtn.type = 'button';
  collapseBtn.id = 'set-nav-collapse';
  collapseBtn.title = 'Hide every set’s cards. Collapsed sets are not reachable with Ctrl+F.';
  collapseBtn.addEventListener('click', toggleCollapseAll);
  // Relabel from the event rather than from a local flag, so this button, the ⋯ More
  // menu's twin and the per-set chevrons can never disagree — including when the state
  // changes from somewhere this module knows nothing about.
  document.addEventListener('tcg:collapse-changed', e => {
    collapseBtn.textContent = collapseButtonLabel(!!e.detail?.allCollapsed);
  });
  row.append(search, collapseBtn);
  head.append(top, row);

  const list = el('div', 'sb-list');
  list.id = 'set-nav-list';
  const empty = el('div', 'sb-empty', 'No sets loaded yet.');
  empty.id = 'set-nav-empty';

  p.append(head, list, empty);
  p.addEventListener('pointerenter', () => { pointerInPanel = true; });
  p.addEventListener('pointerleave', () => { pointerInPanel = false; });

  scrimEl()?.addEventListener('click', () => setOpen(false));
  // Escape closes in BOTH modes. It used to be drawer-only, on the reasoning that a
  // docked panel sat beside the content and was never in the way. It overlays now, and
  // between 1000px and ~1628px it covers the left edge of the grid — so the quickest
  // way out of it should not be mouse-only. The scrim, which is the drawer's other
  // escape hatch, does not exist when docked.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && open) setOpen(false);
  });

  // Default when never set: open where it fits, closed where it would cover the
  // content. The feature has to be discoverable, but not in the way on a phone.
  const saved = storage.get(SETNAVSTORE);
  open = saved === null ? docked() : saved === '1';

  watchStickyHeight();
  applyOpenState();
  // Dock ↔ drawer as the viewport crosses the breakpoint, without changing the
  // user's open/closed preference.
  window.matchMedia(`(min-width:${DOCK_MIN_PX}px)`).addEventListener('change', applyOpenState);
}
