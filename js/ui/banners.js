// =============================================================================
// ui/banners.js — shared user notices.
//
// The router's failover notice ("using backup data source") is rendered by
// masterset.buildAll via its existing mkBanner (so it matches the in-container
// banner styling exactly). This module owns the cross-cutting STORAGE-QUOTA
// banner: it replaces storage.js's bare fallback with a consistent fixed banner,
// wired once at boot from main.js.
// =============================================================================

import * as storage from '../storage.js';

/** Replace storage.js's default quota handler with a consistent fixed banner. */
export function installStorageQuotaHandler() {
  storage.setQuotaErrorHandler((key, err) => {
    console.error('[storage] write failed for key:', key, err);
    let el = document.getElementById('storage-quota-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'storage-quota-banner';
      // Presentation lives in css/style.css under #storage-quota-banner \u2014 it used to
      // be inline here AND in storage.js's fallback, two copies of one look.
      const msg = document.createElement('span');
      msg.id = 'storage-quota-msg';
      const exportBtn = document.createElement('button');
      exportBtn.textContent = 'Export data';
      exportBtn.addEventListener('click', () => { if (typeof window.exportData === 'function') window.exportData(); });
      const close = document.createElement('button');
      close.textContent = '\u00d7';
      close.title = 'Dismiss';
      close.className = 'quota-close';
      close.addEventListener('click', () => el.remove());
      el.append(msg, exportBtn, close);
      document.body.appendChild(el);
    }
    el.querySelector('#storage-quota-msg').textContent =
      `Storage is full — "${key}" could not be saved. Back up, then clear some space.`;
  });
}
