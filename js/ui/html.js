// =============================================================================
// ui/html.js — escaping for the few places that must build markup as STRINGS.
//
// Most of the UI renders with createElement/textContent and needs none of this.
// Two things cannot: the card placeholder (one HTML string, reused by the grid
// and by print) and the print documents, which are assembled as text, wrapped in
// a Blob and opened in a new tab.
//
// Everything they interpolate is untrusted. Card and set names come from remote
// APIs (TCGdex, Bulbapedia wikitext); the Pokémon list can come from a shared
// "#s=" URL fragment, which anybody can craft. Blob documents inherit the
// opener's ORIGIN, so script injected into a print view reads exactly the same
// localStorage as the app itself — the checklist, and every other tcg* key.
//
// Pure — no DOM, no state — so it is importable in Node tests.
// =============================================================================

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape for interpolation into element text OR a quoted attribute value. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

/**
 * Escape a URL destined for a quoted src/href, dropping it entirely if its
 * scheme could execute. Attribute-safe is not enough on its own: `javascript:…`
 * contains no character escapeHtml touches, yet still runs when the browser
 * follows it.
 *
 * Relative URLs (no scheme) are allowed; absolute ones must be http(s), blob or
 * a data: image.
 */
export function escapeUrl(value) {
  // Browsers strip whitespace and control characters out of a URL before parsing
  // its scheme, so the check must run on the stripped form — otherwise
  // "java<TAB>script:alert(1)" reads as having no scheme and sails through.
  // Done by code point rather than a regex range to keep literal control
  // characters out of this source file.
  const url = [...String(value ?? '')].filter(ch => ch.codePointAt(0) > 0x20).join('');
  if (!url) return '';
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (scheme && !/^(?:https?|blob)$/i.test(scheme[1]) && !/^data:image\//i.test(url)) return '';
  return escapeHtml(url);
}
