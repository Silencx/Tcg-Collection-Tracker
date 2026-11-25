// =============================================================================
// card-image-model.js — which TCGdex scan URL a card gets. No DOM, no fetch, no state.
//
// Two rules, both measured on 2026-11-25:
//
// 1. The asset CDN's folder for a language is TCGdex's API code, not the LANGUAGES
//    `code`. The two differ for one language: Traditional Chinese is `zh-Hant` in this
//    app (data maps, the picker, sets.json keys) and `zh-tw` on TCGdex.
//    /zh-tw/SV/SV1S/001/low.webp is a 200; /zh-Hant/SV/SV1S/001/low.webp is a 404. TW
//    URLs built from `code` are why the app showed no TW scans at all.
//
// 2. In a set listing (/v2/{lang}/sets/{id}), a card has an `image` base exactly when
//    the CDN holds its scan. Probed across en, de, fr, es, it, pt, zh-tw, th and id:
//    109 of 109 listed scans were 200s, 48 of 48 unlisted cards were 404s. TCGdex lists
//    a scan for about a third of its TW, TH and ID cards (2,146 of 7,436 zh-tw, 1,224
//    of 2,921 th, 1,152 of 2,788 id), so single-set mode asks the listing instead of
//    requesting every card and collecting the 404s.
//
// Master Set and the TMS popup know cards only by their EN id, so they still build the
// URL from a template (rule 1) and leave misses to the negative cache in img-cache.js.
// TW, TH and ID set ids share nothing with English, so those tiles mostly get no scan.
// =============================================================================

import { LANGUAGES } from '../config.js';
import { tcgdexAssetBase } from './images.js';

/**
 * The TCGdex asset-CDN folder for one of the app's languages.
 * @param {string} code a LANGUAGES `code` ('en', 'zh-Hant', …)
 * @param {Array<{code:string, apiCode?:string}>} [languages] LANGUAGES, injectable for tests
 * @returns {string|null} null for a language TCGdex has no art for (KR, SC, unknown)
 */
export function tcgdexCdnLang(code, languages = LANGUAGES) {
  const def = languages.find(l => l.code === code);
  return def ? (def.apiCode || def.code) : null;
}

/**
 * Templated asset base (no extension) for a card known only by its set id and number,
 * in one of the app's languages. null when the language has no TCGdex art.
 * @param {string} code a LANGUAGES `code`
 */
export function tcgdexCardBase(code, series, setId, localId) {
  const folder = tcgdexCdnLang(code);
  return folder ? tcgdexAssetBase(folder, series, setId, localId) : null;
}

// A quality file on the end of a base ("…/001/low.webp"). TCGdex sends bare bases, but
// symbols already taught providers/tcgdex.js that some deployments add an extension.
const QUALITY_FILE_RE = /\/(?:low|high)\.(?:webp|png|jpe?g)$/i;

/**
 * The scan base a set listing gave a card, or null when it gave none — which means the
 * CDN has no scan for it (rule 2), so nothing should be requested.
 * @param {unknown} image the listing's `image` field
 * @returns {string|null}
 */
export function listedImageBase(image) {
  if (typeof image !== 'string') return null;
  const base = image.trim().replace(QUALITY_FILE_RE, '').replace(/\/+$/, '');
  return /^https:\/\/[^\s/]+\/\S+$/.test(base) ? base : null;
}

/**
 * Is `url` a TCGdex asset filed under an app language code that the CDN does not use?
 * Before rule 1, every TW image URL was built under /zh-Hant/, and the TMS popup keeps
 * its card lists (URLs included) in localStorage. A cached list holding one of these is
 * rebuilt.
 * @param {unknown} url
 * @param {Array<{code:string, apiCode?:string}>} [languages] LANGUAGES, injectable for tests
 */
export function isMisfiledCdnUrl(url, languages = LANGUAGES) {
  const m = /^https:\/\/assets\.tcgdex\.net\/([^/]+)\//.exec(typeof url === 'string' ? url : '');
  if (!m) return false;
  return languages.some(l => l.apiCode && l.apiCode !== l.code && l.code === m[1]);
}
