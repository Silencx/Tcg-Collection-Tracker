// =============================================================================
// img-cache.js — negative cache for card-image URLs that don't exist.
//
// WHY: the app builds image URLs by STRING TEMPLATE for every language (see
// renderBySet in ui/masterset.js), because the checklist must show every language
// whether or not artwork exists — "never a shorter list" (providers/tcgdex.js).
// The cost is requests that can never succeed:
//
//   • TCGdex has NO card images for zh-Hant / th / id — verified 404 across
//     bw4, xy11, sm7, swsh11 and sv05, i.e. every era. Whole-language absence.
//   • The Latin languages are near-complete but have sparse per-card gaps
//     (e.g. it/sm/sm7/1 404s while sm7/2 and sm7/3 are fine).
//   • Limitless returns 403 for scans it doesn't hold (SM7_105 vs SM7_6).
//
// Both CDNs answer a miss with an XML error body. TCGdex additionally mislabels
// it `Content-Type: image/webp`, so Firefox's ORB sniffs the body, blocks it, and
// cancels the channel — which is why one missing image logs BOTH
// "OpaqueResponseBlocking" and "NS_BINDING_ABORTED". The fallback always worked;
// the noise was every render re-asking questions already answered.
//
// This module remembers the answers. It is deliberately NOT a hardcoded table of
// which languages have images: a URL earns its place here only by actually
// failing, and the entry expires (IMG_FAIL_TTL), so newly-added artwork appears
// on its own with nothing to edit.
//
// Loads once at import, writes are debounced (onerror arrives in bursts).
// =============================================================================

import * as storage from '../storage.js';
import { IMGFAILSTORE, IMG_FAIL_TTL, IMG_FAIL_MAX } from '../config.js';

/** cache key → epoch ms of the failure. @type {Map<string, number>} */
const failed = new Map();

// TCGdex serves every quality of one card from a single directory
// (/{lang}/{series}/{set}/{localId}/low.webp, /high.png, …), and a card the CDN does
// not hold is a missing S3 PREFIX — the error body is literally NoSuchKey. Measured:
// low and high always agree (404/404 for th/id/zh-Hant, 200/200 for en/de).
//
// So a TCGdex failure is remembered against the DIRECTORY, not the file. That makes
// the knowledge transferable: the grid only ever requests low.webp, while preview and
// print want high.webp, and keying by exact URL meant each card had to fail twice
// before it stopped costing requests.
//
// Other hosts stay keyed by exact URL — Limitless uses flat per-scan filenames
// (SM7_105_R_JP_SM.png) with no such grouping, so there is nothing to generalize.
const TCGDEX_ASSET_RE =
  /^(https:\/\/assets\.tcgdex\.net\/.+?)\/(?:low|high)\.(?:webp|png|jpg|jpeg)$/i;

/** Collapse quality variants of the same TCGdex card onto one key. */
function cacheKey(url) {
  const m = TCGDEX_ASSET_RE.exec(url);
  return m ? m[1] : url;
}

// Restore, dropping anything already expired. Defensive parse: this runs at
// import time, and state.js documents why a corrupt blob must not throw here.
(function restore() {
  const raw = storage.getJSON(IMGFAILSTORE, null);
  if (!raw || typeof raw !== 'object' || !raw.urls || typeof raw.urls !== 'object') return;
  const now = Date.now();
  for (const [url, ts] of Object.entries(raw.urls)) {
    if (typeof url !== 'string' || typeof ts !== 'number') continue;
    if (now - ts < IMG_FAIL_TTL) failed.set(url, ts);
  }
})();

let writeTimer = null;
function persist() {
  if (writeTimer !== null) return;              // a write is already queued
  writeTimer = setTimeout(() => {
    writeTimer = null;
    // Evict oldest first if we're over the cap. Map preserves insertion order and
    // markBad re-inserts, so iteration order is close enough to age order.
    if (failed.size > IMG_FAIL_MAX) {
      const excess = failed.size - IMG_FAIL_MAX;
      let i = 0;
      for (const url of failed.keys()) { if (i++ >= excess) break; failed.delete(url); }
    }
    storage.setJSON(IMGFAILSTORE, { urls: Object.fromEntries(failed) });
  }, 500);
}

/** Flush a pending write NOW (pagehide — mirrors state.flushChk). */
export function flushImgCache() {
  if (writeTimer === null) return;
  clearTimeout(writeTimer);
  writeTimer = null;
  storage.setJSON(IMGFAILSTORE, { urls: Object.fromEntries(failed) });
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushImgCache);
}

/**
 * Has this exact URL failed recently enough to skip?
 * Expiry is checked on read as well as on load, so a long-lived tab still lets
 * entries lapse without a reload.
 */
export function isKnownBad(url) {
  if (!url) return false;
  const key = cacheKey(url);
  const ts = failed.get(key);
  if (ts === undefined) return false;
  if (Date.now() - ts < IMG_FAIL_TTL) return true;
  failed.delete(key);          // lapsed — allow a fresh attempt
  persist();
  return false;
}

/** Record that `url` did not yield an image. */
export function markBad(url) {
  if (!url) return;
  const key = cacheKey(url);
  failed.delete(key);          // re-insert so eviction order tracks recency
  failed.set(key, Date.now());
  persist();
}

/** Record that `url` DID yield an image — clears any stale negative for it. */
export function markGood(url) {
  if (!url) return;
  const key = cacheKey(url);
  if (!failed.has(key)) return;
  failed.delete(key);
  persist();
}

/**
 * Candidate list with known-bad URLs removed, preserving priority order.
 * Falsy entries are dropped too, so callers can pass `[loSrc, fallbackSrc]`
 * straight in without filtering first.
 */
export function viableSources(urls) {
  return (urls || []).filter(u => u && !isKnownBad(u));
}

// ── _meta IMAGE FIELDS ────────────────────────────────────────────────────────
// The render index (state._meta) used to store a GUESSED url plus an `isCustom`
// flag that nothing ever read. Preview and print then re-requested that guess, so
// a card whose tile had not lazy-loaded yet showed a placeholder in the preview and
// took two runs to print. These three fields replace that: the candidates, and the
// one thing worth remembering — which url actually produced an image.

/**
 * Build the image half of a _meta entry.
 * @param {(string|null)[]} loSources low-res candidates, priority order
 * @param {(string|null)[]} hiSources high-res candidates, priority order
 */
export function imgMeta(loSources, hiSources) {
  return {
    imgSources: (loSources || []).filter(Boolean),
    hiSources:  (hiSources || []).filter(Boolean),
    imgOk: null,   // set to the url that decoded, by whichever surface got there first
  };
}

/**
 * Best-first image candidates for a meta, known-bad URLs removed.
 *
 * High-res leads because preview and print both want the best available scan.
 * `imgOk` sits next: it is the one URL something has already PROVEN decodes, so
 * when the unproven high-res guess misses, the fallback is immediate and certain.
 *
 * @param {object} m a state._meta entry
 * @param {object} [opts]
 * @param {boolean} [opts.recheck] ignore the negative cache
 */
export function metaSources(m, { recheck = false } = {}) {
  if (!m) return [];
  const ordered = [...(m.hiSources || []), m.imgOk, ...(m.imgSources || [])];
  const seen = new Set();
  const deduped = ordered.filter(u => u && !seen.has(u) && seen.add(u));
  return recheck ? deduped : viableSources(deduped);
}

/**
 * Load the first candidate that actually decodes.
 *
 * Awaits decode(), not just load: `onload` fires before the bitmap is ready, which
 * is what let the print sheet snapshot undecoded images (see ui/print.js).
 *
 * Known-bad candidates are skipped without a request; every attempt updates the
 * cache. Resolves `{ url, img }`, or null when every candidate is exhausted.
 *
 * @param {string[]} urls candidates in priority order
 * @param {object}   [opts]
 * @param {boolean}  [opts.recheck] ignore the negative cache (user-triggered retry)
 * @returns {Promise<{url:string, img:HTMLImageElement}|null>}
 */
export async function loadFirstImage(urls, { recheck = false } = {}) {
  const candidates = recheck ? (urls || []).filter(Boolean) : viableSources(urls);
  for (const url of candidates) {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
      markGood(url);
      return { url, img };
    } catch {
      markBad(url);
    }
  }
  return null;
}

/** Drop every remembered failure (wired into the "Clear cache" button). */
export function clearImgFailures() {
  failed.clear();
  if (writeTimer !== null) { clearTimeout(writeTimer); writeTimer = null; }
  storage.remove(IMGFAILSTORE);
}

/** Entry count — for tests and diagnostics. */
export function imgFailureCount() { return failed.size; }
