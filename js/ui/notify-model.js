// =============================================================================
// ui/notify-model.js — notification rules and relative times, DOM-free.
//
// Same split as filter-pass.js / setnav-index.js / collapse-model.js: the decisions
// live here so `node --test` can cover them without jsdom.
//
// cacheAge moved here from masterset.js. It was untested and unreachable from
// anywhere else, and the notification log needs the same relative-time formatting
// for its entries, so it is genuine reuse rather than relocation for its own sake.
// =============================================================================

/** Relative age of a timestamp: 'just now' / '5m ago' / '3h ago' / '2d ago'. */
export function cacheAge(ts, now = Date.now()) {
  const m = Math.floor((now - ts) / 60000), h = Math.floor(m / 60), dd = Math.floor(h / 24);
  return dd > 0 ? `${dd}d ago` : h > 0 ? `${h}h ago` : m > 0 ? `${m}m ago` : 'just now';
}

/**
 * How long a banner should stay on screen, in ms. 0 means "never auto-hide".
 *
 * The rule: a banner auto-dismisses only if it is purely informational — no
 * interactive control inside it, and no dismissKey.
 *
 *  • hasAction — the fetch-failure banner carries its own "↺ Retry" button. Yanking a
 *    control out from under the pointer on a timer is worse than leaving clutter.
 *  • dismissKey — that already means "the user decides, and the decision persists to
 *    state.dismissedBanners". A timer would quietly override a deliberate design.
 *  • banner-load — an in-progress notice. It is removed programmatically when the work
 *    finishes; a timeout would make it vanish while the work is still running.
 *
 * @param {string} cls        the banner variant class (banner-blue, banner-green, …)
 * @param {object} [opts]
 * @param {string|null} [opts.dismissKey]
 * @param {boolean} [opts.hasAction] banner contains a button the user may want to click
 */
export function ttlFor(cls, { dismissKey = null, hasAction = false } = {}) {
  if (dismissKey || hasAction) return 0;
  switch (cls) {
    case 'banner-blue':  return 8000;   // "Loaded from cache (5m ago)"
    case 'banner-green': return 6000;   // "No new cards since last check"
    case 'banner-new':   return 20000;  // "N new cards found" — worth reading properly
    default:             return 0;      // banner-load (in progress), banner-error, unknown
  }
}

/** Append to a capped log, newest last. Returns a NEW array; never mutates. */
export function pushNotice(list, notice, cap = 30) {
  const next = [...list, notice];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

// LOAD-BEARING: entries are identified by this counter, NOT by their ts.
// The fetch-failure path records twice within the same tick — once from mkBanner and
// once from the explicit recordNotice(msg,'banner-error') in masterset.js's catch — so
// Date.now() collides and a ts-keyed dismiss would remove both rows at once.
let noticeSeq = 0;

/** Next id for a log entry. Monotonic within the session; unique even within one tick. */
export function nextNoticeId() {
  return ++noticeSeq;
}

/** Remove one entry by id. Returns a NEW array; never mutates. */
export function dropNotice(list, id) {
  return list.filter(n => n.id !== id);
}

/** How many entries arrived after the log was last opened. */
export function unreadCount(list, lastSeenTs = 0) {
  return list.filter(n => n.ts > lastSeenTs).length;
}

/** Accessible name for the bell, so the count is not conveyed by the badge alone. */
export function bellLabel(unread) {
  if (!unread) return 'Notifications';
  return `Notifications, ${unread} unread`;
}

/** Strip markup so a banner written as HTML can be logged and announced as text. */
export function toPlainText(html) {
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
