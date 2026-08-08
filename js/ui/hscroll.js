// =============================================================================
// ui/hscroll.js — makes the sideways-scrolling chrome rows look scrollable.
//
// .hscroll, .filter-pills and .poke-chips scroll horizontally instead of wrapping
// (see the NON-WRAPPING CHROME block in css/style.css — wrapping cost seven header
// rows on a 390px phone). The catch: Windows 11 and macOS both default to OVERLAY
// scrollbars, so `overflow-x:auto` reserves a zero-height gutter and the bar only
// appears while you are already scrolling. Measured at a 500px viewport, the toolbar
// silently swallowed "Print checklist" and the language row five of its twelve pills,
// with nothing on screen to suggest either row continued.
//
// Two things fix that, and both are needed:
//   • a fade at whichever edge has more content — the signal;
//   • wheel-to-horizontal — the ACCESS. A plain mouse emits deltaY only, and these
//     rows are controls, so "you can see there is more" without "you can reach it"
//     would be a worse bug than the one being fixed.
//
// Everything DOM-free lives in hscroll-model.js so `node --test` can cover it.
// =============================================================================

import { edgeState, wheelTarget } from './hscroll-model.js';

// Every horizontal scroller in the chrome. All three are static in index.html, so one
// query at boot finds them; only their CONTENTS change later, which the observers below
// pick up.
const SELECTOR = '.hscroll, .filter-pills, .poke-chips';

const tracked = new Set();

function sync(el) {
  const { start, end } = edgeState(el.scrollLeft, el.scrollWidth, el.clientWidth);
  el.classList.toggle('hs-fade-start', start);
  el.classList.toggle('hs-fade-end', end);
}

/** Recompute every row's fades. Exported for callers that change content wholesale. */
export function syncHScroll() {
  for (const el of tracked) sync(el);
}

function track(el) {
  if (tracked.has(el)) return;
  tracked.add(el);

  el.addEventListener('scroll', () => sync(el), { passive: true });

  // NOT passive: this one has to be able to preventDefault. wheelTarget returns null
  // when the row is already at the end the gesture pushes toward, and then the event is
  // left alone so the PAGE scrolls — otherwise moving the pointer across the toolbar
  // would silently eat every wheel tick.
  el.addEventListener('wheel', e => {
    // A trackpad or tilt-wheel already sends deltaX, and Shift+wheel is the platform's
    // own horizontal gesture. Both are real horizontal input; don't second-guess them.
    if (e.deltaX !== 0 || e.shiftKey) return;
    const next = wheelTarget(el.scrollLeft, el.scrollWidth, el.clientWidth, e.deltaY);
    if (next === null) return;
    e.preventDefault();
    el.scrollLeft = next;
  }, { passive: false });

  // The row's own box changing (viewport resize, header re-wrap).
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => sync(el)).observe(el);
  }
  // Its CONTENT changing without its box changing — buildPills rebuilding the language
  // row, a Pokémon chip added or removed, applyModeUI swapping the visible control row.
  // Only the fades are written back, and they are attribute changes on `el` itself,
  // which this observer is not watching — so there is no feedback loop.
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(() => sync(el)).observe(el, { childList: true, subtree: true, characterData: true });
  }

  sync(el);
}

/** Wire every chrome scroller. Safe to call once at boot; no-op if the markup is absent. */
export function initHScroll() {
  document.querySelectorAll(SELECTOR).forEach(track);
}
