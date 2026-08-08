#!/usr/bin/env node
// =============================================================================
// tools/apitcg-probe.mjs — find out what API TCG can actually do, once, cheaply.
//
// The published docs are a client-rendered SPA, so the response shape cannot be read
// without calling the API. This script makes that one-off discovery run and writes a
// REDACTED report to tools/apitcg-probe-report.md, which is safe to read and to commit.
//
// THE ENDPOINT (docs.apitcg.com, tag: products):
//   GET /api/products?tcg=pokemon&type=card&name=charizard&limit=50&page=2
// One endpoint, everything as QUERY parameters. There is no /{game}/cards path — an
// earlier version of this script assumed one from a stale third-party example and burnt
// 11 requests proving it wrong. "Please provide a TCG" was the API saying the `tcg`
// parameter was missing, not that a path slug was unrecognised.
//
// WHY IT EXISTS AS A SEPARATE SCRIPT: the key is deliberately unreadable by the
// assistant (see .claude/hooks/block-secrets*.mjs), so the assistant cannot run this.
// You run it; the report is the hand-off.
//
// BUDGET: hard-capped at MAX_REQUESTS. The free tier is ~1000 requests total, so this
// spends at most 1% of it, once. The cap is enforced in the fetch wrapper, not by
// counting call sites, so it holds even if the adaptive branches below change.
//
// The key is NEVER written to the report: request headers are never recorded, and the
// finished text is checked for the key before anything is saved.
//
// Run: node tools/apitcg-probe.mjs
// =============================================================================

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadApiTcgKey, KEY_HELP } from './lib/apitcg-key.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = resolve(ROOT, 'tools/apitcg-probe-report.md');

// Host candidates. apitcg.com/api/ answers with a Vercel marketing 404, so the API may
// not live there at all; and a cross-host redirect would explain the server reporting a
// missing `tcg` when the query string plainly contains one.
const BASES = [
  // api.apitcg.com answers "Cannot GET /products" — an Express 404, i.e. a REAL API
  // server on the right host with the wrong path. So it wants the /api prefix too.
  // Tried first because it is the only candidate that behaves like an API rather than
  // like the marketing site.
  'https://api.apitcg.com/api',
  'https://www.apitcg.com/api',
  'https://apitcg.com/api',
];
let BASE = BASES[0];
const MAX_REQUESTS = 10;

const key = loadApiTcgKey();
if (!key) {
  console.error('[probe] No API key configured.');
  console.error('[probe] ' + KEY_HELP);
  process.exit(1);
}

let spent = 0;
const log = [];

/** The only place a request is made. Enforces the budget and records a redacted entry. */
async function request(path) {
  if (spent >= MAX_REQUESTS) {
    throw new Error(`request budget exhausted (${MAX_REQUESTS})`);
  }
  spent++;
  const url = `${BASE}${path}`;
  const started = Date.now();
  let status = 0, ok = false, body = null, error = null, finalUrl = null, redirected = false;
  try {
    const res = await fetch(url, { headers: { 'x-api-key': key } });
    status = res.status;
    ok = res.ok;
    // A redirect is the prime suspect for a query string arriving empty, and for a
    // cross-origin hop silently dropping the x-api-key header.
    redirected = res.redirected;
    finalUrl = res.url;
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
  } catch (e) {
    error = e.message;
  }
  const ms = Date.now() - started;
  // A failing response usually NAMES the cause in its body, and the first run threw that
  // away — four 500s with no explanation. Keep a short snippet for anything not OK.
  let snippet = null;
  if (!ok) {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    snippet = (raw || '').slice(0, 220).replace(/\s+/g, ' ').trim() || '(empty body)';
  }
  // `path` and the resolved URL only — never the headers, which carry the key.
  log.push({ n: spent, path: `${BASE}${path}`, status, ok, ms, error, snippet, redirected, finalUrl });
  console.log(`[probe] ${spent}/${MAX_REQUESTS}  ${status || 'ERR'}  ${ms}ms  ${BASE}${path}`
    + (redirected ? `  -> REDIRECTED to ${finalUrl}` : ''));
  return { status, ok, body, error, snippet, redirected, finalUrl };
}

// ── shape description ────────────────────────────────────────────────────────

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** A key: type tree, so the card object's real field names are visible at a glance. */
function shape(value, depth = 0, maxDepth = 3) {
  const pad = '  '.repeat(depth);
  if (Array.isArray(value)) {
    if (!value.length) return `${pad}[] (empty)`;
    return `${pad}array(${value.length}) of:\n${shape(value[0], depth + 1, maxDepth)}`;
  }
  if (value && typeof value === 'object') {
    if (depth >= maxDepth) return `${pad}{…}`;
    return Object.entries(value)
      .map(([k, v]) => {
        const t = typeOf(v);
        if (v && typeof v === 'object') return `${pad}${k}: ${t}\n${shape(v, depth + 1, maxDepth)}`;
        return `${pad}${k}: ${t}`;
      })
      .join('\n');
  }
  return `${pad}${typeOf(value)}`;
}

/** Sample record with long strings clipped, so the report stays readable. */
function sample(value, depth = 0) {
  if (typeof value === 'string') return value.length > 100 ? value.slice(0, 100) + '…' : value;
  if (Array.isArray(value)) return value.slice(0, 3).map(v => sample(v, depth + 1));
  if (value && typeof value === 'object') {
    if (depth > 3) return '{…}';
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sample(v, depth + 1)]));
  }
  return value;
}

const firstCard = (body) => {
  const arr = Array.isArray(body) ? body : (body?.data ?? body?.cards ?? body?.results);
  return Array.isArray(arr) && arr.length ? arr[0] : null;
};

// ── the probe ────────────────────────────────────────────────────────────────

const sections = [];
const findings = [];

async function main() {
  // One endpoint, everything as query parameters — see the header note.
  const q = (params) => '/products?' + new URLSearchParams(params).toString();

  // 1. The documented example, tried against each host candidate until one answers.
  //    "Please provide a TCG" when tcg IS in the query string means the request is not
  //    arriving intact — wrong host, or a redirect eating it.
  const probePath = q({ tcg: 'pokemon', type: 'card', name: 'charizard', limit: '5' });
  let base = null;
  for (const candidate of BASES) {
    BASE = candidate;
    base = await request(probePath);
    if (base.redirected) findings.push(`\`${candidate}\` REDIRECTED to \`${base.finalUrl}\` — a cross-host hop drops the x-api-key header.`);
    if (base.ok && firstCard(base.body)) break;
    findings.push(`\`${candidate}\` → HTTP ${base.status}${base.snippet ? ' — `' + base.snippet + '`' : ''}`);
  }
  if (base.status === 401 || base.status === 403) {
    findings.push(`The key was REJECTED (HTTP ${base.status}). Nothing else was attempted.`);
    sections.push('## FAILED: key rejected\n\nCheck the value of `APITCG_KEY`.');
    return;
  }
  const card = base.ok ? firstCard(base.body) : null;
  if (!card) {
    findings.push(`The documented request returned HTTP ${base.status}${base.snippet ? ' — `' + base.snippet + '`' : ''}.`);
    sections.push('## FAILED\n\nThe endpoint and parameters match the docs, so this points at the account or the service rather than at the request.');
    return;
  }

  findings.push('**WORKING** — `GET /api/products?tcg=pokemon&type=card&name=…` returns cards.');

  const envelope = (base.body && !Array.isArray(base.body)) ? Object.keys(base.body) : ['(bare array)'];
  findings.push(`Response envelope: \`${envelope.join('`, `')}\``);
  findings.push(`Card fields: \`${Object.keys(card).join('`, `')}\``);

  sections.push([
    '## Card object',
    '',
    '```',
    shape(card),
    '```',
    '',
    '### Sample record',
    '```json',
    JSON.stringify(sample(card), null, 2),
    '```',
  ].join('\n'));

  // Capability detection against the real field names — these decide what, if anything,
  // API TCG can do for us that TCGdex does not already.
  const flat = JSON.stringify(card).toLowerCase();
  const has = (...needles) => needles.filter(n => flat.includes(n));
  findings.push(`image-ish keys: ${has('image', 'images', 'thumbnail').join(', ') || 'NONE'}`);
  findings.push(`set/expansion keys: ${has('"set"', 'setid', 'expansion', 'series').join(', ') || 'NONE'}`);
  findings.push(`rarity/variant keys: ${has('rarity', 'holo', 'reverse', 'variant', 'foil').join(', ') || 'NONE'}`);
  findings.push(`language keys: ${has('language', 'lang', 'locale', 'japan').join(', ') || 'NONE'}`);
  findings.push(`price keys: ${has('price', 'market', 'tcgplayer', 'cardmarket').join(', ') || 'NONE'}`);

  // 2. A Pokémon this app actually tracks. Decides whether it is viable as a gap-filler:
  //    a source that only knows famous cards is no use for filling gaps.
  const seedot = await request(q({ tcg: 'pokemon', type: 'card', name: 'seedot', limit: '50' }));
  if (seedot.ok) {
    const arr = Array.isArray(seedot.body) ? seedot.body : (seedot.body?.data ?? []);
    findings.push(`\`name=seedot\` returned **${Array.isArray(arr) ? arr.length : '?'}** record(s) — TCGdex has 21 for comparison.`);
    if (Array.isArray(arr) && arr.length) {
      sections.push(['## Gap-filler check (Seedot)', '', '```json', JSON.stringify(sample(arr[0]), null, 2), '```'].join('\n'));
    }
  } else {
    findings.push(`\`name=seedot\` → HTTP ${seedot.status}${seedot.snippet ? ' — `' + seedot.snippet + '`' : ''}`);
  }

  // 3. Paging envelope — needed to know whether a bounded fetch is possible.
  const paged = await request(q({ tcg: 'pokemon', type: 'card', name: 'charizard', limit: '2', page: '2' }));
  if (paged.ok) {
    const arr = Array.isArray(paged.body) ? paged.body : (paged.body?.data ?? []);
    findings.push(`\`limit=2&page=2\` returned ${Array.isArray(arr) ? arr.length : '?'} record(s) — limit ${Array.isArray(arr) && arr.length === 2 ? 'HONOURED' : 'possibly IGNORED'}.`);
    if (paged.body && !Array.isArray(paged.body)) {
      sections.push(['## Paging envelope', '', '```', shape({ ...paged.body, data: undefined }), '```'].join('\n'));
    }
  }

  // 4. Other `type` values. An expansion/set resource would matter for set metadata,
  //    which is the single most expensive thing the app fetches.
  for (const type of ['expansion', 'set']) {
    if (spent >= MAX_REQUESTS - 1) { findings.push('Budget reached before finishing the type probes.'); break; }
    const r = await request(q({ tcg: 'pokemon', type, limit: '3' }));
    if (r.ok && firstCard(r.body)) {
      findings.push(`\`type=${type}\` EXISTS.`);
      sections.push([`## type=${type}`, '', '```', shape(firstCard(r.body)), '```'].join('\n'));
      break;
    }
    findings.push(`\`type=${type}\` → HTTP ${r.status}${r.snippet ? ' — `' + r.snippet + '`' : ''}`);
  }

  // 5. Japanese — decides whether the fragile Bulbapedia wikitext scrape can be replaced.
  if (spent < MAX_REQUESTS) {
    const jp = await request(q({ tcg: 'pokemon', type: 'card', name: 'pikachu', language: 'ja', limit: '3' }));
    const jpCard = jp.ok ? firstCard(jp.body) : null;
    findings.push(`\`language=ja\` → HTTP ${jp.status}${jpCard ? ', first name: ' + JSON.stringify(sample(jpCard.name ?? jpCard.id ?? '?')) : ', no cards'}`);
  }
}
// ── report ───────────────────────────────────────────────────────────────────

function buildReport() {
  return [
    '# API TCG capability probe',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Requests spent: **${spent} / ${MAX_REQUESTS}** (budget cap; free tier is ~1000 total)`,
    '',
    '> Generated by `tools/apitcg-probe.mjs`. Contains no credentials: request headers are',
    '> never recorded, and the text is checked for the key before being written.',
    '',
    '## Findings',
    '',
    ...(findings.length ? findings.map(f => `- ${f}`) : ['- (none — the probe failed early)']),
    '',
    ...sections,
    '',
    '## Request log',
    '',
    '| # | path | status | ms | response (failures only) |',
    '|---|------|--------|----|--------------------------|',
    ...log.map(e => `| ${e.n} | \`${e.path || '/'}\` | ${e.error ? 'ERR: ' + e.error : e.status} | ${e.ms} | ${e.snippet ? '`' + e.snippet.replace(/\|/g, '\\|') + '`' : ''} |`),
    '',
  ].join('\n');
}

try {
  await main();
} catch (e) {
  sections.push(`## Probe aborted\n\n\`${e.message}\``);
} finally {
  const report = buildReport();
  // Belt and braces on top of never recording headers.
  if (key && report.includes(key)) {
    console.error('[probe] ABORTED: the key appeared in the report text. Nothing was written.');
    process.exit(1);
  }
  writeFileSync(REPORT, report);
  console.log(`[probe] wrote tools/apitcg-probe-report.md (${spent} request(s) spent)`);
}
