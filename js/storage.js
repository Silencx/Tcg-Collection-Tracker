// =============================================================================
// storage.js — the ONLY module that talks to localStorage directly.
//
// Why a wrapper: a future migration to a server / IndexedDB backend should only
// need to edit this file. Also, the old single-file tool wrapped every setItem
// in `try{}catch(e){}` and SWALLOWED quota errors silently — so a full quota
// could make checklist/TMS data appear to vanish with no warning. Here, write
// failures are surfaced through a replaceable handler (banners.js installs a
// nicer one in Phase 5); until then a minimal always-on red banner guarantees
// the failure is never silent.
// =============================================================================

/**
 * UI hook for storage write failures (quota exceeded, private-mode, etc.).
 * banners.js can override this via setQuotaErrorHandler().
 * @type {(key: string, err: unknown) => void}
 */
let onQuotaError = (key, err) => {
  console.error('[storage] write failed for key:', key, err);
  showFallbackBanner(
    `Storage is full — "${key}" could not be saved. ` +
    `Use "Export data" to back up, then clear space.`
  );
};

/** Replace the default quota/write-error handler (called by banners.js). */
export function setQuotaErrorHandler(fn) { onQuotaError = fn; }

/** Bare-bones fixed banner so write failures are visible even before banners.js loads. */
function showFallbackBanner(msg) {
  let el = document.getElementById('storage-quota-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'storage-quota-banner';
    el.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:99999;background:#b71c1c;' +
      'color:#fff;padding:8px 12px;font:13px/1.4 Arial,sans-serif;text-align:center;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
}

// ── RAW STRING ACCESS ─────────────────────────────────────────────────────────

/** @returns {string|null} */
export function get(key) { return localStorage.getItem(key); }

/** @returns {boolean} true on success, false if the write was rejected. */
export function set(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch (err) { onQuotaError(key, err); return false; }
}

export function remove(key) { localStorage.removeItem(key); }

export function has(key) { return localStorage.getItem(key) !== null; }

/** All keys, optionally filtered by prefix (e.g. 'tcg' for the export feature). */
export function keys(prefix) {
  const all = Object.keys(localStorage);
  return prefix ? all.filter(k => k.startsWith(prefix)) : all;
}

// ── JSON HELPERS ──────────────────────────────────────────────────────────────

/** Parse a JSON value; on missing key or parse error, return `fallback`. */
export function getJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

/** @returns {boolean} true on success, false if the write was rejected. */
export function setJSON(key, value) { return set(key, JSON.stringify(value)); }
