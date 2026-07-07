// =============================================================================
// ui/session-codec.js — pure base64url session encode/decode.
// No DOM, no state — safe to import in Node (tests) or the browser.
// Extracted from io.js so it can be unit-tested without pulling in state.js
// (which touches localStorage at module load) or the DOM (encodeSession() itself
// still reads document.body's palette class — that stays in io.js).
// =============================================================================

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
