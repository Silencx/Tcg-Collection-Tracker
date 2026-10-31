// =============================================================================
// tools/lib/pokewallet.mjs — PokéWallet API client + the matching rules, BUILD-TIME only.
//
// The key must never reach the browser (their docs: never expose it client-side, and the
// image endpoint needs it in a header, so a plain <img> could not use it anyway). This
// module is only imported from tools/.
//
// Facts it rests on (tools/pokewallet-probe.mjs, runs of 2026-10-30):
//   · /sets lists 853 sets; set codes are NOT unique (40 shared, e.g. BLW), so sets are
//     addressed by `set_id`. `language` is "jap" / "eng" / "chn".
//   · Card names are ENGLISH even on Japanese cards; card_number is "001/053".
//   · /images/:id?size=low|high → JPEG, 200×280 (~13 KB) / 500×699 (~57 KB), immutable.
//   · Every response carries X-RateLimit-Remaining-Hour / -Day; 4xx count against quota.
//   · Two Bulbapedia set names differ from PokéWallet's for the same product — see
//     SET_ALIASES. Matching on set + number found 58 of 61 JP cards for the three
//     snapshot Pokémon; the misses are World Champions Pack, which PokéWallet lacks.
// =============================================================================

export const POKEWALLET_BASE = 'https://api.pokewallet.io';

// Bulbapedia set name (our JP_BULBA_SET_MAP key) → PokéWallet set name, where they differ.
export const SET_ALIASES = {
  'Latios ex Half Deck': 'Gift Box (Latios)',
  'SM-P Promotional cards': 'Sun & Moon Promos',
  'XY-P Promotional cards': 'XY Promos',
};

/**
 * Comparable form of a set name. PokéWallet prefixes many names with a code
 * ("SV5M: Cyber Judge", "XY11-Bb: Fever-Burst Fighter"); Bulbapedia never does.
 */
export function setMatchKey(name) {
  return String(name || '').replace(/^[^:]{1,12}:\s*/, '').normalize('NFKD')
    .replace(/[̀-ͯ]/g, '').toLowerCase().replace(/pokemon|card game|[^a-z0-9]/g, '');
}

/** "001/053" → "1"; non-numeric heads kept, upper-cased. */
export function numberMatchKey(n) {
  const head = String(n ?? '').split('/')[0].trim();
  return /^\d+$/.test(head) ? String(parseInt(head, 10)) : head.toUpperCase();
}

const info = c => c?.card_info || {};
const hasPrintSuffix = name => /\([^)]*\)\s*$/.test(String(name || ''));

/** The record list of a response, whatever the envelope calls it. */
export function listOf(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  for (const k of ['results', 'data', 'cards', 'sets', 'items']) if (Array.isArray(body[k])) return body[k];
  return Object.values(body).find(Array.isArray) || [];
}

/**
 * Pair our Japanese rows with PokéWallet cards on set + number.
 * @param {Array<{jpset,jpnum,pokemonName}>} rows  Bulbapedia rows (data/jp/<slug>.json)
 * @param {Array} pwCards  PokéWallet search rows, already limited to Japanese sets
 * @returns {{matched:Array<{row,card}>, missing:Array}}
 *   A printing with its own product ("Weedle (Mirror Holofoil)") never stands in for the
 *   base card — it is a different print with different art treatment.
 */
export function matchJpRows(rows, pwCards) {
  const byKey = new Map();
  for (const c of pwCards) {
    if (!c?.id || hasPrintSuffix(info(c).name)) continue;
    const k = `${setMatchKey(info(c).set_name)}#${numberMatchKey(info(c).card_number)}`;
    if (!byKey.has(k)) byKey.set(k, c);
  }
  const matched = [], missing = [];
  for (const row of rows) {
    const setName = SET_ALIASES[row.jpset] || row.jpset;
    const card = byKey.get(`${setMatchKey(setName)}#${numberMatchKey(row.jpnum)}`);
    if (card) matched.push({ row, card }); else missing.push(row);
  }
  return { matched, missing };
}

/**
 * A small client: one place that calls PokéWallet, a hard request cap, and a stop when
 * the live hourly quota (read from the response headers) falls to `reserve`. Never
 * records or prints headers — they carry the key.
 * @param {string} key
 * @param {{maxRequests?:number, reserve?:number, fetchImpl?:Function, log?:Function}} [opts]
 */
export function createClient(key, { maxRequests = 300, reserve = 10, fetchImpl = fetch, log = () => {} } = {}) {
  let spent = 0;
  const quota = { hour: null, day: null, limitHour: null, limitDay: null, resets: {} };
  const stopped = () => spent >= maxRequests
    || (quota.hour != null && quota.hour <= reserve)
    || (quota.day != null && quota.day <= reserve);

  // The daily quota resets at a fixed time (03:00 the account owner's local time, per the
  // PokéWallet dashboard, 2026-10-30). Any X-RateLimit-Reset* or Retry-After header the
  // server sends is kept and named in the stop message, so a stopped run says when to resume.
  const resetHint = () => {
    const r = Object.entries(quota.resets).map(([k, v]) => `${k}: ${v}`).join(', ');
    return r ? ` — server says ${r}` : ' — the daily quota resets at 03:00 local time';
  };

  async function call(path, { binary = false } = {}) {
    if (stopped()) {
      const why = spent >= maxRequests ? `request cap ${maxRequests}`
        : `quota at reserve (${reserve})${quota.day != null && quota.day <= reserve ? resetHint() : ''}`;
      throw Object.assign(new Error(`stopped: ${why}`), { code: 'BUDGET' });
    }
    spent++;
    const res = await fetchImpl(`${POKEWALLET_BASE}${path}`, { headers: { 'X-API-Key': key } });
    const num = n => { const v = res.headers.get(n); return v == null ? null : Number(v); };
    if (num('x-ratelimit-remaining-hour') != null) {
      quota.hour = num('x-ratelimit-remaining-hour'); quota.day = num('x-ratelimit-remaining-day');
      quota.limitHour = num('x-ratelimit-limit-hour'); quota.limitDay = num('x-ratelimit-limit-day');
    }
    for (const n of ['x-ratelimit-reset', 'x-ratelimit-reset-hour', 'x-ratelimit-reset-day', 'retry-after']) {
      const v = res.headers.get(n);
      if (v != null) quota.resets[n] = v;
    }
    log(`${res.status} ${path.length > 90 ? path.slice(0, 87) + '…' : path}`);
    if (res.status === 429) throw Object.assign(new Error(`rate limited (429)${resetHint()}`), { code: 'BUDGET' });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(`HTTP ${res.status} ${path}: ${text.slice(0, 160)}`), { status: res.status });
    }
    if (binary) return { buf: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') };
    return res.json();
  }

  return {
    call,
    get spent() { return spent; },
    get quota() { return { ...quota, resets: { ...quota.resets } }; },
    stopped,
  };
}

/** File extension for a downloaded image. */
export function extFor(contentType, buf) {
  if (/png/i.test(contentType || '')) return 'png';
  if (/webp/i.test(contentType || '') || (buf && buf.toString('ascii', 8, 12) === 'WEBP')) return 'webp';
  return 'jpg';
}
