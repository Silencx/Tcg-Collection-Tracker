// =============================================================================
// tools/lib/limitless.mjs — does the Limitless CDN have scans for a Japanese set?
//
// Measured 2026-10-30 (tools/jp-gap-size.mjs): the CDN answers 200 image/png when it has
// a scan and 403 application/xml when it does not, and its paths are CASE-SENSITIVE
// (SV4a is a 200, SV4A a 403). So the code is tried as PokéWallet spells it first, then
// upper-cased, then with punctuation removed ("XY11-Bb" → "XY11BB"). A set counts as
// covered when card #1, or failing that the middle card, is there.
// =============================================================================

const LIMITLESS = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc';

export function limitlessCodeVariants(code) {
  const raw = String(code || '').trim();
  return [...new Set([raw, raw.toUpperCase(), raw.replace(/[^A-Za-z0-9]/g, ''), raw.toUpperCase().replace(/[^A-Z0-9]/g, '')])]
    .filter(v => v && /^[A-Za-z0-9+-]+$/.test(v));
}

async function has(code, num, fetchImpl) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetchImpl(`${LIMITLESS}/${code}/${code}_${num}_R_JP_SM.png`, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
      if (r.status === 200) return /image/i.test(r.headers.get('content-type') || '');
      if (r.status === 403 || r.status === 404) return false;
    } catch { /* retry once, then treat as missing */ }
  }
  return false;
}

/** The Limitless code that serves this set's scans, or null. At most ~8 HEAD requests. */
export async function findLimitlessCode(setCode, cardCount, fetchImpl = fetch) {
  const n = Number(cardCount) || 0;
  for (const v of limitlessCodeVariants(setCode)) {
    if (await has(v, 1, fetchImpl) || (n > 2 && await has(v, Math.ceil(n / 2), fetchImpl))) return v;
  }
  return null;
}
