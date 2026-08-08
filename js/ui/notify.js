// =============================================================================
// ui/notify.js — the notification log behind the header bell.
//
// Banners are in-flow notices above the sets. They never disappeared, so the page
// accumulated "Loaded from cache (3m ago)" and friends until the next full render,
// and anything that scrolled past was simply missed. Transient banners now expire on
// a timer (see notify-model.ttlFor) — which would make them unrecoverable, hence this
// log: every banner is recorded here as it is created, and the bell keeps an unread
// count until the panel is opened.
//
// NOT persisted, deliberately. Every entry describes THIS session's fetch, so a
// stored "Loaded from cache (5m ago)" would resurface days later, stale and wrong.
// If persistence is ever wanted the key would be NOTIFSTORE='tcgNotif_v1' in
// config.js (the tcg prefix is functional — storage.keys('tcg') drives export), and
// that is the point at which the log should move onto `state`.
//
// The <details> shell is reused from .more-menu, which buys the open/close, the
// outside-click close and the Escape close already wired in main.js — so nothing here
// needs to appear in main.js's window manifest.
// =============================================================================

import {
  pushNotice, unreadCount, bellLabel, cacheAge, toPlainText,
  nextNoticeId, dropNotice,
} from './notify-model.js';

const CAP = 30;

let log = [];
let lastSeenTs = 0;
// Keys already recorded this session. Standing facts (the placeholder-language notes)
// are re-emitted by every buildAll, and without this a Refresh would stack a second
// identical "Korean cards exist but…" row on top of the first. NOT applied to ordinary
// banners: "No new cards since last check" repeating IS the information.
const seenKeys = new Set();

// #notif-list is the PANEL. renderList clears its target outright, so the rows get their
// own inner container — a "Clear all" header placed directly in the panel would be wiped
// on every render.
function els() {
  return {
    menu:  document.getElementById('notif-menu'),
    count: document.getElementById('notif-count'),
    rows:  document.getElementById('notif-rows'),
    head:  document.getElementById('notif-head'),
    clear: document.getElementById('notif-clear-all'),
    live:  document.getElementById('notif-live'),
    summary: document.querySelector('#notif-menu > summary'),
  };
}

function renderBadge() {
  const { count, summary } = els();
  const unread = unreadCount(log, lastSeenTs);
  if (count) {
    count.textContent = String(unread);
    count.hidden = unread === 0;
  }
  // The count must not be visual-only.
  if (summary) summary.setAttribute('aria-label', bellLabel(unread));
}

function renderList() {
  const { rows, head } = els();
  if (!rows) return;
  rows.textContent = '';
  if (head) head.hidden = !log.length;      // nothing to clear ⇒ no "Clear all"
  if (!log.length) {
    const empty = document.createElement('div');
    empty.className = 'notif-empty';
    empty.textContent = 'No messages yet.';
    rows.appendChild(empty);
    return;
  }
  // Newest first: the reason you opened the panel is almost always the latest thing.
  for (const n of [...log].reverse()) {
    const row = document.createElement('div');
    row.className = `notif-item notif-${n.level}`;
    const text = document.createElement('span');
    text.className = 'notif-text';
    text.textContent = n.text;              // textContent, not innerHTML — see mkBanner
    const when = document.createElement('time');
    when.className = 'notif-when';
    when.dateTime = new Date(n.ts).toISOString();
    when.textContent = cacheAge(n.ts);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'notif-close';
    close.textContent = '×';
    close.title = 'Dismiss';
    close.setAttribute('aria-label', `Dismiss: ${n.text}`);
    close.addEventListener('click', e => dismissClick(e, () => dismiss(n.id)));
    row.append(text, when, close);
    rows.appendChild(row);
  }
}

// LOAD-BEARING: main.js closes any open .more-menu on a document click that falls
// OUTSIDE it (`!d.contains(e.target)`). Dismissing re-renders and detaches the very
// button that was clicked, so by the time the event reaches document the target is no
// longer inside the panel and the whole thing would snap shut. Stop it here instead —
// the click was inside the panel, so the document handler has nothing to do with it.
function dismissClick(e, fn) {
  e.stopPropagation();
  fn();
}

/** Drop one entry. renderBadge recomputes from the log, so an unread row decrements it. */
function dismiss(id) {
  log = dropNotice(log, id);
  renderBadge();
  renderList();
}

/** Drop everything. */
function clearAll() {
  log = [];
  renderBadge();
  renderList();
}

/** Map a banner variant class to a coarse level for styling and screen-reader urgency. */
function levelFor(cls) {
  if (cls === 'banner-error') return 'error';
  if (cls === 'banner-amber') return 'warn';
  return 'info';
}

/**
 * Record a notice. Called from mkBanner for EVERY banner, including sticky ones and
 * ones suppressed as already-dismissed — they are still things that happened, and
 * routing them all through one call is what stops the log and the page diverging.
 *
 * @param {string} html  the banner's HTML; stored as plain text
 * @param {string} cls   the banner variant class
 * @param {object} [opts]
 * @param {string} [opts.once] record at most once per session under this key
 */
export function record(html, cls, { once = null } = {}) {
  if (once) {
    if (seenKeys.has(once)) return;
    seenKeys.add(once);
  }
  const text = toPlainText(html);
  if (!text) return;
  log = pushNotice(log, { id: nextNoticeId(), ts: Date.now(), text, level: levelFor(cls) }, CAP);
  renderBadge();
  renderList();

  const { live } = els();
  // Banners are appended into #dyn, which nothing announces. aria-live goes on this
  // small dedicated node instead — never on #dyn itself, which would try to announce
  // a 776-tile render.
  if (live) live.textContent = text;
}

/** Wire the bell. Safe to call once at boot; no-op if the markup is absent. */
export function initNotify() {
  const { menu, clear } = els();
  if (!menu) return;
  renderBadge();
  renderList();
  // addEventListener, not an inline onclick=: the header comment's promise that this
  // module needs no entry in main.js's window manifest is worth keeping.
  clear?.addEventListener('click', e => dismissClick(e, clearAll));
  menu.addEventListener('toggle', () => {
    if (!menu.open) return;
    lastSeenTs = Date.now();   // opening the panel is what clears the count
    renderBadge();
    renderList();              // refresh the relative times while it is open
  });
}
