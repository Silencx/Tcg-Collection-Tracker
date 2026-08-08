// =============================================================================
// ui/flags.js — a small inline SVG flag per language badge.
//
// NOT emoji. 🇬🇧🇩🇪🇫🇷 are regional-indicator PAIRS, and Windows ships no flag
// glyphs at all — Chrome on Windows renders every one of them as two boxed
// letters, which is the platform the app is developed and used on. Twemoji or a
// flag-icon package would fix that with a network dependency, and this is a
// static site with no build step and a CSP-free file:// fallback, so the flags
// are drawn here instead.
//
// Deliberately SIMPLIFIED. At the 22×15 these render at, a faithful Union Jack
// or Taegeuk is a grey smudge; what has to survive is "which flag is this" at a
// glance, so each is reduced to its bands and its one identifying mark.
//
// viewBox is 30×20 (3:2) for every flag, so they all scale as one set. Colours
// are literal, not palette tokens — a national flag does not re-theme. The
// greyscale-when-off treatment is a CSS filter applied by the caller, matching
// what the card grid already does for unowned cards.
// =============================================================================

// Keyed by the language BADGE, which is what every caller already has in hand
// (state.activeLangs, card.dataset.lang, LANGUAGES[].badge).
const FLAGS = {
  // Union Jack, reduced to the two crosses — the diagonals are dropped rather
  // than drawn wrong at this size.
  EN: '<rect width="30" height="20" fill="#012169"/><path d="M0 7h12V0h6v7h12v6H18v7h-6v-7H0z" fill="#fff"/><path d="M0 8.5h13.5V0h3v8.5H30v3H16.5V20h-3v-8.5H0z" fill="#C8102E"/>',
  DE: '<rect width="30" height="6.67" fill="#000"/><rect y="6.67" width="30" height="6.66" fill="#DD0000"/><rect y="13.33" width="30" height="6.67" fill="#FFCE00"/>',
  FR: '<rect width="10" height="20" fill="#002395"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#ED2939"/>',
  ES: '<rect width="30" height="20" fill="#AA151B"/><rect y="5" width="30" height="10" fill="#F1BF00"/>',
  IT: '<rect width="10" height="20" fill="#008C45"/><rect x="10" width="10" height="20" fill="#F4F5F0"/><rect x="20" width="10" height="20" fill="#CD212A"/>',
  PT: '<rect width="30" height="20" fill="#DA291C"/><rect width="12" height="20" fill="#046A38"/><circle cx="12" cy="10" r="4.4" fill="#FFE900" stroke="#046A38" stroke-width="1"/>',
  JP: '<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="6" fill="#BC002D"/>',
  // Traditional Chinese (Taiwan): red field, blue canton, white sun.
  TW: '<rect width="30" height="20" fill="#FE0000"/><rect width="15" height="10" fill="#000095"/><circle cx="7.5" cy="5" r="3" fill="#fff"/>',
  TH: '<rect width="30" height="20" fill="#A51931"/><rect y="3.33" width="30" height="13.34" fill="#F4F5F8"/><rect y="6.67" width="30" height="6.66" fill="#2D2A4A"/>',
  ID: '<rect width="30" height="20" fill="#fff"/><rect width="30" height="10" fill="#CE1126"/>',
  // Korea: the Taegeuk reduced to its two halves — recognisable, and legible at 15px
  // in a way the real interlocking comma shape is not.
  KR: '<rect width="30" height="20" fill="#fff"/><path d="M15 4a6 6 0 010 12z" fill="#003478"/><path d="M15 4a6 6 0 000 12z" fill="#CD2E3A"/><path d="M15 4a6 6 0 010 12 6 6 0 010-12z" fill="none" stroke="#0a0a0a" stroke-width=".5" opacity=".25"/>',
  // Simplified Chinese (mainland): the large star only.
  SC: '<rect width="30" height="20" fill="#EE1C25"/><path d="M8 3.6l1.3 4h4.2l-3.4 2.5 1.3 4L8 11.6l-3.4 2.5 1.3-4L2.5 7.6h4.2z" fill="#FFFF00"/>',
};

/** Inline SVG markup for a badge, or null when there is no flag for it. */
export function flagSvg(badge) {
  const body = FLAGS[badge];
  if (!body) return null;
  // aria-hidden + focusable=false: the language NAME is always rendered beside it,
  // so the flag is decoration and must not be announced or tabbed to.
  return `<svg class="lang-flag" viewBox="0 0 30 20" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Every badge this module can draw. Used by tests and by the language picker. */
export function flagBadges() {
  return Object.keys(FLAGS);
}
