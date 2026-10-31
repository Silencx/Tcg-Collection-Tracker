// =============================================================================
// ui/dom.js — the one tiny element builder the node-built views share.
//
// Kept out of html.js on purpose: that module is DOM-free so `node --test` can import
// it, and this one touches `document`.
// =============================================================================

/** createElement with an optional class and text content (text, never markup). */
export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
