// =============================================================================
// ui/session-codec.js — pure base64url session encode/decode.
// No DOM, no state — safe to import in Node (tests) or the browser.
// Extracted from io.js so it can be unit-tested without pulling in state.js
// (which touches localStorage at module load) or the DOM (encodeSession() itself
// still reads document.body's palette class — that stays in io.js).
// =============================================================================

/**
 * Is this a set id safe to accept from a shared "#s=" link?
 *
 * Lives here rather than in io.js for the reason at the top of this file: it is pure
 * logic and its regression needs a Node test, and importing io.js pulls in state.js,
 * which reads localStorage at module load.
 *
 * TCGdex set ids are letters, digits, the dot in half-sets (swsh12.5) and the HYPHEN in
 * Trainer Kits (tk-ex-latia), Pocket promos (P-A) and the JP promo lines (S-P). The
 * hyphen was missing when this first shipped, which silently dropped 29 of the 218 EN
 * set ids from every shared link. It failed closed, so nothing looked broken — the set
 * simply was not there.
 *
 * The value reaches a fetch path segment, so traversal is rejected separately from the
 * shape: the character class alone would allow '..'.
 */
const SET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9.\-]{0,23}$/;
export function safeSetId(v) {
  return typeof v === 'string' && SET_ID_RE.test(v) && !v.includes('..') && !v.includes('/');
}

export function b64urlEncode(s) {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(b) {
  b = b.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return decodeURIComponent(escape(atob(b)));
}

/** Encode a settings payload object to a base64url string. */
export function encodeSessionPayload(payload) {
  return b64urlEncode(JSON.stringify(payload));
}

export function decodeSession(hash) {
  try { return JSON.parse(b64urlDecode(hash)); } catch { return null; }
}
