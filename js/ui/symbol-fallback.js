// =============================================================================
// symbol-fallback.js — keeps TCGdex set symbols visible when their /univ/ copy fails.
//
// Every set symbol (EN and JP) is a TCGdex /univ/ URL, and every place that renders
// one hides or removes the <img> on error. So when /univ/ breaks — on 2026-10-30 it
// answered HTTP 400 `InvalidBucketName` for every set — Master Set, TMS, the
// placeholders and the dashboard all lose their symbols at once.
//
// One capture-phase listener on the document walks the failing image through
// nextTcgdexSymbolUrl (/univ/ → /en/ → /fr/ → /de/) instead of touching each render
// site. Capture runs before the image's own handlers, and stopping propagation there
// keeps those handlers from firing, so an image is hidden only once the chain is out of
// URLs. `error` does not bubble, which is why this has to be a capture listener.
//
// It sees an image only if it is in the document when it fails. Every renderer attaches
// its detached blocks in the same task that builds them, so that holds today. Print
// windows are separate documents and keep their plain hide-on-error behaviour.
// =============================================================================

import { nextTcgdexSymbolUrl } from '../api/images.js';

export function installSymbolFallback(root = document) {
  root.addEventListener('error', e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    const next = nextTcgdexSymbolUrl(img.src);
    if (!next) return;   // not a symbol, or nothing left to try: the site's handler runs
    e.stopImmediatePropagation();
    img.src = next;
  }, true);
}
