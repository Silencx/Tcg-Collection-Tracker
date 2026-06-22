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
      el.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:99999;background:#b71c1c;' +
        'color:#fff;padding:8px 12px;font:13px/1.4 Arial,sans-serif;text-align:center;' +
        'display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;';
      const msg = document.createElement('span');
      msg.id = 'storage-quota-msg';
      const exportBtn = document.createElement('button');
      exportBtn.textContent = 'Export data';
      exportBtn.style.cssText = 'cursor:pointer;border:1px solid #fff;background:transparent;color:#fff;border-radius:4px;padding:2px 8px;';
      exportBtn.addEventListener('click', () => { if (typeof window.exportData === 'function') window.exportData(); });
      const close = document.createElement('button');
      close.textContent = '\u00d7';
      close.title = 'Dismiss';
      close.style.cssText = 'cursor:pointer;border:none;background:transparent;color:#fff;font-size:16px;line-height:1;';
      close.addEventListener('click', () => el.remove());
      el.append(msg, exportBtn, close);
      document.body.appendChild(el);
    }
    el.querySelector('#storage-quota-msg').textContent =
      `Storage is full — "${key}" could not be saved. Back up, then clear some space.`;
  });
}
