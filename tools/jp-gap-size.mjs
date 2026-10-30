#!/usr/bin/env node
// =============================================================================
// tools/jp-gap-size.mjs — how big is the Japanese image gap, really? Measure before
// building anything for "every Pokémon".
//
// ONE PokéWallet request (/sets), everything else against the free Limitless CDN:
//   1. /sets → every Japanese set: name, code, set_id, card count, release date.
//   2. For each set, ask Limitless for a scan. Measured 2026-10-30: the CDN answers
//      200 image/png when it has the scan and 403 application/xml when it does not
//      (ADV2, PCG5, BW3, Pt2, DP1 → 403; SV5M, M1L, S4, XY2 → 200). Its paths are
//      CASE-SENSITIVE — SV4a is a 200, SV4A a 403 — and the first run upper-cased every
//      code, which counted 151, Shiny Treasure ex, VMAX Climax and every other "a/b" set
//      as missing. So the code is tried as PokéWallet spells it first, then upper-cased,
//      then with punctuation removed ("XY11-Bb" → "XY11BB").
//      A set counts as COVERED when card #1 (or, failing that, the middle card) is there.
//   3. Covered sets still miss single cards (SM7 #105, a secret rare, is a 403), so three
//      cards spread through each covered set are sampled to estimate that in-set gap.
// Then it prices the gap: storage at the averages measured on the 28 Seedot-line images
// (low 14 KB, high 73 KB) and requests at 1 per image size.
//
// Writes tools/jp-gap-size-report.md and tools/jp-gap-size.json (per-set results, reused
// later as the starting point for a full Japanese set table). Both hold PokéWallet's
// set list, so both are gitignored.
//
// WHY YOU RUN IT: the key lives in .env.local, unreadable to the assistant by design.
// Run: node tools/jp-gap-size.mjs                # fresh set list from PokéWallet
//      node tools/jp-gap-size.mjs --from-cache   # reuse tools/jp-gap-size.json — no key,
//                                                #   no PokéWallet request, re-checks Limitless
// =============================================================================

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvKey } from './lib/env-key.mjs';
import { createClient, listOf } from './lib/pokewallet.mjs';
import { limitlessCodeVariants } from './lib/limitless.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = resolve(ROOT, 'tools/jp-gap-size-report.md');
const DATA = resolve(ROOT, 'tools/jp-gap-size.json');
const LIMITLESS = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc';
const CONCURRENCY = 4;            // a public CDN: stay polite
const LOW_KB = 14, HIGH_KB = 73;  // measured averages, Seedot-line images, 2026-10-30
const PAGES_CAP_MB = 1024;        // GitHub Pages published-site cap

const fromCache = process.argv.includes('--from-cache');
const key = fromCache ? null : loadEnvKey('POKEWALLET_IO_PROD_KEY');
if (!fromCache && !key) {
  console.error('[jp-gap] No POKEWALLET_IO_PROD_KEY in .env.local or the environment.');
  process.exit(1);
}
if (fromCache && !existsSync(DATA)) {
  console.error('[jp-gap] --from-cache needs tools/jp-gap-size.json from an earlier run.');
  process.exit(1);
}

let cdnRequests = 0;
async function limitlessHas(code, num) {
  cdnRequests++;
  const url = `${LIMITLESS}/${code}/${code}_${num}_R_JP_SM.png`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
      if (r.status === 200) return /image/i.test(r.headers.get('content-type') || '');
      if (r.status === 403 || r.status === 404) return false;
    } catch { /* retry once, then treat as unknown-missing */ }
  }
  return false;
}

/** Run `fn` over `items`, at most CONCURRENCY at a time. */
async function pool(items, fn) {
  let i = 0;
  const out = new Array(items.length);
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

const yearOf = d => { const t = Date.parse(String(d || '').replace(/(\d+)(st|nd|rd|th)/, '$1').replace(',', '')); return Number.isNaN(t) ? null : new Date(t).getUTCFullYear(); };
const cardsOf = s => Number(s.number_count) || Number(s.card_count) || 0;
const mb = kb => Math.round(kb / 1024);
const days = (n, perDay) => Math.ceil(n / perDay);

async function main() {
  let pwRequests = 0, jp, chn;
  if (fromCache) {
    // The cached rows already carry everything below needs; map them back to /sets shape.
    const cached = JSON.parse(readFileSync(DATA, 'utf8'));
    jp = cached.sets.map(r => ({ set_id: r.set_id, name: r.name, set_code: r.set_code, release_date: r.release_date,
      number_count: r.cards, card_count: r.card_count, language: 'jap' }));
    chn = cached.chinese || [];
  } else {
    const client = createClient(key, { maxRequests: 2, log: m => console.log(`[jp-gap]   ${m}`) });
    const sets = listOf(await client.call('/sets'));
    pwRequests = client.spent;
    jp = sets.filter(s => s.language === 'jap');
    chn = sets.filter(s => s.language === 'chn').map(s => ({ set_id: s.set_id, name: s.name, number_count: s.number_count, card_count: s.card_count }));
  }
  console.log(`[jp-gap] ${jp.length} Japanese sets; checking Limitless (≈${jp.length * 2} CDN requests)…`);

  let done = 0;
  const results = await pool(jp, async s => {
    const n = cardsOf(s);
    let code = null;
    for (const v of limitlessCodeVariants(s.set_code)) {
      if (await limitlessHas(v, 1) || (n > 2 && await limitlessHas(v, Math.ceil(n / 2)))) { code = v; break; }
    }
    let sampled = 0, hits = 0;
    if (code && n > 3) {
      for (const f of [0.25, 0.6, 0.95]) {
        sampled++;
        if (await limitlessHas(code, Math.max(1, Math.round(n * f)))) hits++;
      }
    }
    if (++done % 50 === 0) console.log(`[jp-gap]   ${done}/${jp.length} sets checked`);
    return {
      set_id: s.set_id, name: s.name, set_code: s.set_code, release_date: s.release_date, year: yearOf(s.release_date),
      cards: n, card_count: Number(s.card_count) || 0, limitless: code, sampled, hits,
    };
  });

  const covered = results.filter(r => r.limitless);
  const uncovered = results.filter(r => !r.limitless);
  const sum = (a, f) => a.reduce((t, r) => t + f(r), 0);
  const jpCards = sum(results, r => r.cards);
  const uncoveredCards = sum(uncovered, r => r.cards);
  const sampled = sum(covered, r => r.sampled), hit = sum(covered, r => r.hits);
  const inSetMissRate = sampled ? 1 - hit / sampled : 0;
  const coveredCards = sum(covered, r => r.cards);
  const inSetGap = Math.round(coveredCards * inSetMissRate);
  const gap = uncoveredCards + inSetGap;

  const lowMB = mb(gap * LOW_KB), bothMB = mb(gap * (LOW_KB + HIGH_KB));
  const byYear = {};
  for (const r of results) {
    const y = r.year ?? 'no date';
    const b = byYear[y] ??= { sets: 0, cards: 0, gapSets: 0, gapCards: 0 };
    b.sets++; b.cards += r.cards;
    if (!r.limitless) { b.gapSets++; b.gapCards += r.cards; }
  }

  const lines = [
    '# Japanese image gap — sizing',
    '',
    `Generated: ${new Date().toISOString()}`,
    `PokéWallet requests: ${pwRequests}${fromCache ? ' (set list from tools/jp-gap-size.json)' : ''} · Limitless CDN requests: ${cdnRequests}`,
    '',
    '> Generated by `tools/jp-gap-size.mjs`. Holds PokéWallet\'s set list — gitignored.',
    '',
    '## Summary',
    '',
    `| | sets | cards |`,
    `|---|---|---|`,
    `| Japanese, total | ${results.length} | ${jpCards} |`,
    `| Limitless has the set | ${covered.length} | ${coveredCards} |`,
    `| Limitless lacks the set | **${uncovered.length}** | **${uncoveredCards}** |`,
    `| Missing inside covered sets (est. from ${sampled} samples, ${Math.round(inSetMissRate * 100)}% miss) | — | ~${inSetGap} |`,
    `| **Image gap (est.)** | | **~${gap}** |`,
    '',
    `Card counts use PokéWallet's \`number_count\` (distinct card numbers); its \`card_count\` also counts separately-listed prints: ${sum(results, r => r.card_count)} in total.`,
    '',
    '## What filling it would cost',
    '',
    `| | storage | requests | free (1,000/day) | Ko-fi (10,000/day) | Pro (50,000/day) |`,
    `|---|---|---|---|---|---|`,
    `| low only | ~${lowMB} MB | ~${gap} | ${days(gap, 1000)} days | ${days(gap, 10000)} days | ${days(gap, 50000)} day(s) |`,
    `| low + high | ~${bothMB} MB | ~${gap * 2} | ${days(gap * 2, 1000)} days | ${days(gap * 2, 10000)} days | ${days(gap * 2, 50000)} day(s) |`,
    '',
    `GitHub Pages caps a published site at ~${PAGES_CAP_MB} MB: low only ${lowMB < PAGES_CAP_MB * 0.5 ? 'fits comfortably' : lowMB < PAGES_CAP_MB ? 'fits, but tightly' : 'does NOT fit'}; low + high ${bothMB < PAGES_CAP_MB * 0.5 ? 'fits comfortably' : bothMB < PAGES_CAP_MB ? 'fits, but tightly' : 'does NOT fit — would need a separate image repo'}.`,
    `Card lists for every Pokémon (a walk of all Japanese sets, ≤200 per page): ~${sum(results, r => Math.max(1, Math.ceil(r.card_count / 200)))} PokéWallet requests, once.`,
    '',
    chn.length ? `Chinese (Simplified) for comparison: ${chn.length} sets, ${sum(chn, cardsOf)} cards.`
      : 'Chinese (Simplified): not in this cache (first run measured 60 sets, 6,890 cards).',
    '',
    '## By release year',
    '',
    '| year | sets | cards | sets Limitless lacks | cards in them |',
    '|---|---|---|---|---|',
    ...Object.entries(byYear).sort(([a], [b]) => String(a).localeCompare(String(b))).map(([y, b]) =>
      `| ${y} | ${b.sets} | ${b.cards} | ${b.gapSets} | ${b.gapCards} |`),
    '',
    '## Largest sets Limitless lacks',
    '',
    '| set | code | year | cards |',
    '|---|---|---|---|',
    ...uncovered.sort((a, b) => b.cards - a.cards).slice(0, 40).map(r => `| ${r.name} | ${r.set_code} | ${r.year ?? '?'} | ${r.cards} |`),
    '',
    `## Covered sets with in-set misses in the sample`,
    '',
    ...(covered.filter(r => r.sampled && r.hits < r.sampled).map(r => `- ${r.name} [${r.limitless}] — ${r.hits}/${r.sampled} sampled cards present`)),
    '',
  ];

  writeFileSync(REPORT, lines.join('\n'));
  writeFileSync(DATA, JSON.stringify({ generated: new Date().toISOString(), sets: results, chinese: chn }, null, 1) + '\n');
  console.log(`[jp-gap] gap ≈ ${gap} cards (${uncovered.length} uncovered sets + ~${inSetGap} in covered sets).`);
  console.log(`[jp-gap] wrote tools/jp-gap-size-report.md and tools/jp-gap-size.json`);
}

main().catch(err => {
  console.error('[jp-gap] FAILED:', err.message);
  process.exit(1);
});
