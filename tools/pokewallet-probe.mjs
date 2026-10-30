#!/usr/bin/env node
// =============================================================================
// tools/pokewallet-probe.mjs — find out what PokéWallet's API can do for us, cheaply,
// before anything in the app depends on it.
//
// THE API (pokewallet.io/api-docs, read 2026-10-30):
//   Base https://api.pokewallet.io, key in the `X-API-Key` header.
//   Free: /sets, /sets/:setCode (page, limit ≤ 200), /search (limit ≤ 100), /cards/:id,
//   /images/:id. Pro only: /prices/:setCode and the analytics endpoints.
//   Names are ENGLISH even on Japanese cards; card_number is "001/070"; a printing with
//   its own TCGplayer product ("Weedle (Mirror Holofoil)") is its own row.
//
// RUN 1 (2026-10-30) established the catalogue: 853 sets (462 jap / 330 eng / 60 chn),
// per-card finishes and prices on /cards/:id, 19 KB key-gated JPEGs, Pro gate on /prices.
// Its Black & White lookup failed: set codes are NOT unique (/sets/BLW is also a Trainer
// Kit and answers with a disambiguation list), so sets are addressed by set_id here.
//
// RUN 2 (this script) answers the two questions that decide whether it is worth asking
// PokéWallet for permission:
//   1. Could it REPLACE BULBAPEDIA for Japanese cards? Card-by-card comparison of its JP
//      rows for the three snapshot Pokémon against data/jp/{slug}.json.
//   2. Could its IMAGES fill our JP gap? 11 of the 21 JP sets in JP_BULBA_SET_MAP have no
//      Limitless code, so those cards render as placeholders today. This downloads a few
//      of exactly those images, plus one Chinese card, into a gitignored folder so they
//      can be looked at, and records type, size and pixel dimensions.
//   Plus the Black & White reverse-holo check against js/api/variants.js, by set_id.
//
// WHY YOU RUN IT, NOT THE ASSISTANT: the key lives in .env.local, which is deliberately
// unreadable by the assistant (.claude/hooks/block-secrets*.mjs). You run this; the
// REDACTED report (and the sample images) are the hand-off.
//
// BUDGET: hard-capped at MAX_REQUESTS (enforced in the one fetch wrapper). The free tier
// allows 100/hour. The key is never written anywhere: request headers are never recorded,
// and the report is checked for the key before it is saved. Report and images hold
// PokéWallet's data, whose terms grant no right to republish — both are gitignored.
//
// Run: node tools/pokewallet-probe.mjs
// =============================================================================

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadEnvKey } from './lib/env-key.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = resolve(ROOT, 'tools/pokewallet-probe-report.md');
const IMG_DIR = resolve(ROOT, 'tools/pokewallet-probe-images');
const BASE = 'https://api.pokewallet.io';
const KEY_NAME = 'POKEWALLET_IO_PROD_KEY';
const MAX_REQUESTS = 14;
const POKEMON = { Seedot: 'seedot', Nuzleaf: 'nuzleaf', Shiftry: 'shiftry' };
const GAP_IMAGES = 3;   // JP placeholder cards to download

const mod = p => import(pathToFileURL(resolve(ROOT, p)).href);
const { normalizeVariants } = await mod('js/api/variants.js');
const { JP_BULBA_SET_MAP } = await mod('js/api/bulba-jp.js');

const key = loadEnvKey(KEY_NAME);
if (!key) {
  console.error(`[probe] No key. Set ${KEY_NAME} in .env.local (gitignored) and run again.`);
  process.exit(1);
}

let spent = 0;
const log = [];
let quota = null;   // latest X-RateLimit-* values seen

/** The only place PokéWallet is called. Enforces the budget; records a redacted entry. */
async function request(path, { binary = false } = {}) {
  if (spent >= MAX_REQUESTS) throw new Error(`request budget exhausted (${MAX_REQUESTS})`);
  spent++;
  const started = Date.now();
  let status = 0, ok = false, body = null, error = null, contentType = null, buf = null;
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { 'X-API-Key': key } });
    status = res.status;
    ok = res.ok;
    contentType = res.headers.get('content-type');
    const h = n => res.headers.get(n);
    if (h('x-ratelimit-remaining-hour') != null) {
      quota = {
        hour: `${h('x-ratelimit-remaining-hour')} / ${h('x-ratelimit-limit-hour')}`,
        day: `${h('x-ratelimit-remaining-day')} / ${h('x-ratelimit-limit-day')}`,
      };
    }
    if (binary && ok) {
      buf = Buffer.from(await res.arrayBuffer());
    } else {
      const text = await res.text();
      try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
    }
  } catch (e) {
    error = e.message;
  }
  const ms = Date.now() - started;
  let snippet = null;
  if (!ok) {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    snippet = (raw || '').slice(0, 220).replace(/\s+/g, ' ').trim() || '(empty body)';
  }
  // The path only — never the headers, which carry the key.
  log.push({ n: spent, path, status, ms, error, snippet });
  console.log(`[probe] ${spent}/${MAX_REQUESTS}  ${status || 'ERR'}  ${ms}ms  ${path}`);
  return { status, ok, body, error, snippet, contentType, buf };
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Long strings clipped and arrays cut to 3, so samples stay readable. */
function sample(value, depth = 0) {
  if (typeof value === 'string') return value.length > 100 ? value.slice(0, 100) + '…' : value;
  if (Array.isArray(value)) return value.slice(0, 3).map(v => sample(v, depth + 1));
  if (value && typeof value === 'object') {
    if (depth > 4) return '{…}';
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sample(v, depth + 1)]));
  }
  return value;
}

/** The record list of a response, whatever the envelope calls it. */
function listOf(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  for (const k of ['data', 'results', 'cards', 'sets', 'items', 'matches']) if (Array.isArray(body[k])) return body[k];
  return Object.values(body).find(Array.isArray) || [];
}

const json = v => '```json\n' + JSON.stringify(sample(v), null, 2) + '\n```';
const tally = (items, f) => items.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const fmtTally = t => Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join(', ') || 'none';
const info = c => c?.card_info || c || {};
const finishesOf = c => {
  const v = info(c).variants;
  if (Array.isArray(v) && v.length) return v.map(String);
  const rows = c?.tcgplayer?.prices;
  return Array.isArray(rows) ? rows.map(r => r.sub_type_name).filter(Boolean) : [];
};
// "001/070" → 1, "TG01/TG30" → NaN (kept as a string key below)
const numKey = n => { const s = String(n || '').split('/')[0]; const i = parseInt(s, 10); return Number.isNaN(i) ? s.toUpperCase() : String(i); };
// "SV5M: Cyber Judge" → "cyberjudge"; "Pt2: Bonds to the End of Time" → "bondstotheendoftime"
const setKey = name => String(name || '').replace(/^[^:]{1,12}:\s*/, '').normalize('NFKD')
  .replace(/[̀-ͯ]/g, '').toLowerCase().replace(/pokemon|card game|[^a-z0-9]/g, '');
const baseName = n => String(n || '').replace(/\s*\([^)]*\)\s*$/, '');
const suffixOf = n => (String(n || '').match(/\(([^)]*)\)\s*$/) || [])[1] || null;
const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Pixel size from the first bytes of a JPEG / PNG / WebP — no image library needed. */
function dimensions(buf) {
  if (!buf || buf.length < 30) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fmt = buf.toString('ascii', 12, 16);
    if (fmt === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (fmt === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (fmt === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}
const extFor = (ct, buf) => /png/.test(ct || '') ? 'png' : /webp/.test(ct || '') || buf?.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : 'jpg';

// ── the probe ────────────────────────────────────────────────────────────────

const findings = [];
const sections = [];
const saved = [];

async function downloadImage(card, label, size = 'low') {
  const r = await request(`/images/${encodeURIComponent(card.id)}?size=${size}`, { binary: true });
  if (!r.ok || !r.buf) {
    saved.push(`- ${label} (${size}): HTTP ${r.status}${r.snippet ? ' — `' + r.snippet + '`' : ''}`);
    return;
  }
  const d = dimensions(r.buf);
  const file = `${slug(label)}-${size}.${extFor(r.contentType, r.buf)}`;
  mkdirSync(IMG_DIR, { recursive: true });
  writeFileSync(resolve(IMG_DIR, file), r.buf);
  saved.push(`- ${label} (${size}): ${r.contentType || '?'}, ${Math.round(r.buf.length / 1024)} KB, `
    + `${d ? d.w + '×' + d.h + ' px' : 'size unknown'} → \`tools/pokewallet-probe-images/${file}\``);
}

async function main() {
  // 1. Set list: set_id → language / name, for everything below.
  const setsRes = await request('/sets');
  if (setsRes.status === 401 || setsRes.status === 403) {
    findings.push(`The key was REJECTED (HTTP ${setsRes.status}): \`${setsRes.snippet}\`. Nothing else was attempted.`);
    return;
  }
  const sets = listOf(setsRes.body);
  if (!setsRes.ok || !sets.length) {
    findings.push(`/sets → HTTP ${setsRes.status}${setsRes.snippet ? ' — `' + setsRes.snippet + '`' : ''}`);
    return;
  }
  const setById = new Map(sets.map(s => [String(s.set_id), s]));
  const langOfCard = c => setById.get(String(info(c).set_id))?.language || '?';
  const dupCodes = Object.entries(tally(sets, s => s.set_code)).filter(([, n]) => n > 1);
  findings.push(`/sets → ${sets.length} sets. ${dupCodes.length} set codes are shared by more than one set (e.g. ${dupCodes.slice(0, 6).map(([c, n]) => `${c}×${n}`).join(', ')}) — address sets by set_id.`);

  // 2. Japanese cards for the three snapshot Pokémon vs Bulbapedia (data/jp/{slug}.json).
  const bulbaKeyToCode = new Map(Object.entries(JP_BULBA_SET_MAP).map(([name, v]) => [setKey(name), v.code]));
  const gapCandidates = [];
  let allJp = [];
  for (const [name, file] of Object.entries(POKEMON)) {
    const r = await request('/search?q=' + encodeURIComponent(name) + '&limit=100');
    if (!r.ok) { findings.push(`/search ${name} → HTTP ${r.status}${r.snippet ? ' — `' + r.snippet + '`' : ''}`); continue; }
    const pages = r.body?.pagination?.total_pages;
    // Whole-word, so "Shiftry ex" and "Shiftry LV.X" count and "Seedot" never matches inside another name.
    const word = new RegExp(`(^|[^a-z])${name}([^a-z]|$)`, 'i');
    const rows = listOf(r.body).filter(c => word.test(baseName(info(c).name)));
    const jp = rows.filter(c => langOfCard(c) === 'jap');
    allJp = allJp.concat(jp);
    const jpBase = jp.filter(c => !suffixOf(info(c).name));
    const bulba = JSON.parse(readFileSync(resolve(ROOT, `data/jp/${file}.json`), 'utf8')).jpCardsData || [];

    const pwByKey = new Map(jpBase.map(c => [`${setKey(info(c).set_name)}#${numKey(info(c).card_number)}`, c]));
    const used = new Set();
    const lines = [];
    let match = 0;
    for (const b of bulba) {
      const k = `${setKey(b.jpset)}#${numKey(b.jpnum)}`;
      const pw = pwByKey.get(k);
      const limitless = bulbaKeyToCode.get(setKey(b.jpset));
      const gap = !limitless;
      if (pw) {
        match++; used.add(k);
        if (gap) gapCandidates.push({ card: pw, label: `${name} ${b.jpset} ${b.jpnum.split('/')[0]}` });
      }
      lines.push(`| ${b.jpset} | ${b.jpnum} | ${pw ? `✅ ${info(pw).set_name} · ${info(pw).card_number} · [${info(pw).set_code}]` : '❌ not found'} | ${limitless || '— placeholder'} |`);
    }
    const pwOnly = [...pwByKey.entries()].filter(([k]) => !used.has(k)).map(([, c]) => `${info(c).set_name} · ${info(c).card_number}`);
    findings.push(`**${name}:** ${rows.length} PokéWallet rows (${jp.length} Japanese, ${jpBase.length} without a "(…)" print suffix)${pages > 1 ? `, ${pages} pages — only page 1 read` : ''}. `
      + `Bulbapedia has ${bulba.length}; **${match}/${bulba.length} matched** on set + number. PokéWallet-only: ${pwOnly.length ? pwOnly.join('; ') : 'none'}.`);
    sections.push([
      `## ${name}: Bulbapedia vs PokéWallet (Japanese)`, '',
      '| Bulbapedia set | number | PokéWallet | Limitless image today |',
      '|---|---|---|---|',
      ...lines,
      ...(pwOnly.length ? ['', `PokéWallet-only: ${pwOnly.join('; ')}`] : []),
    ].join('\n'));
  }
  findings.push(`Japanese print suffixes (separate rows): ${fmtTally(tally(allJp.filter(c => suffixOf(info(c).name)), c => suffixOf(info(c).name)))}.`);
  findings.push(`Japanese finish lists: ${fmtTally(tally(allJp, c => finishesOf(c).join('+') || '(none)'))}. Image languages on JP rows: ${fmtTally(tally(allJp, c => JSON.stringify(c?.images?.languages ?? null)))}.`);

  // 3. Images for JP cards that are placeholders today — one per set, oldest era first.
  const picked = [];
  const seenSets = new Set();
  for (const g of gapCandidates) {
    if (picked.length >= GAP_IMAGES) break;
    const s = info(g.card).set_id;
    if (seenSets.has(s)) continue;
    seenSets.add(s); picked.push(g);
  }
  for (const g of picked) await downloadImage(g.card, `jp ${g.label}`, 'low');
  if (picked[0]) await downloadImage(picked[0].card, `jp ${picked[0].label}`, 'high');
  if (!picked.length) saved.push('- No placeholder-gap JP card matched, so no gap images were fetched.');

  // 4. Black & White reverse holos vs our inferred rule — addressed by set_id this time.
  const bw = sets.find(s => /^black (and|&) white$/i.test(s.name || '') && s.language === 'eng');
  if (bw) {
    const r = await request(`/sets/${encodeURIComponent(bw.set_id)}?limit=200`);
    const cards = listOf(r.body).filter(c => info(c).card_number);
    if (r.ok && cards.length) await compareWithTcgdex('bw1', cards);
    else findings.push(`Black & White by set_id ${bw.set_id} → HTTP ${r.status}, ${listOf(r.body).length} rows; envelope \`${Object.keys(r.body || {}).join('`, `')}\`${r.snippet ? ' — `' + r.snippet + '`' : ''}.`);
  } else {
    findings.push('No English set named "Black and White" in /sets.');
  }

  // 5. Chinese: which script, and do images exist? Our SC/TW tiles are placeholders today.
  const chn = sets.filter(s => s.language === 'chn')
    .sort((a, b) => (Number(b.card_count) || 0) - (Number(a.card_count) || 0))[0];
  if (chn) {
    const r = await request(`/sets/${encodeURIComponent(chn.set_id)}?limit=3`);
    const cards = listOf(r.body).filter(c => c.id);
    findings.push(`Chinese sets: ${sets.filter(s => s.language === 'chn').length}; largest "${chn.name}" [${chn.set_code}] ${chn.card_count} cards. First names: ${cards.map(c => JSON.stringify(info(c).name)).join(', ') || '(none)'}.`);
    if (cards[0]) {
      sections.push(['## Chinese set sample (' + chn.name + ')', '', json(cards[0])].join('\n'));
      await downloadImage(cards[0], `chn ${chn.set_code} ${info(cards[0]).name} ${numKey(info(cards[0]).card_number)}`, 'low');
    }
  }
}

/** Black & White, card by card: PokéWallet's finishes vs js/api/variants.js on TCGdex data. */
async function compareWithTcgdex(tcgdexSetId, pwCards) {
  const q = 'query($f:CardsFilters,$p:Int!,$k:Int){ cards(filters:$f, pagination:{page:$p,itemsPerPage:$k}){ '
    + 'id localId name suffix rarity category trainerType set{id} variants{normal reverse holo firstEdition wPromo} '
    + 'variants_detailed{type subtype stamp size foil} } }';
  let tdx = [];
  try {
    const r = await fetch('https://api.tcgdex.net/v2/graphql', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: q, variables: { f: { id: `${tcgdexSetId}-` }, p: 1, k: 1000 } }),
    });
    tdx = ((await r.json())?.data?.cards || []).filter(c => c?.set?.id === tcgdexSetId);
  } catch (e) {
    findings.push(`TCGdex comparison skipped: ${e.message}`);
    return;
  }
  // A print with its own product ("… (Reverse Holo)") counts toward its base card.
  const pwByNum = new Map();
  for (const c of pwCards) {
    const k = numKey(info(c).card_number);
    const f = finishesOf(c).concat(suffixOf(info(c).name) ? [suffixOf(info(c).name)] : []);
    pwByNum.set(k, (pwByNum.get(k) || []).concat(f));
  }
  let agree = 0, compared = 0;
  const differ = [];
  for (const d of tdx) {
    const f = pwByNum.get(String(d.localId));
    if (!f) continue;
    compared++;
    const ours = !!normalizeVariants(d)?.reverse;
    const theirs = f.some(x => /reverse/i.test(x));
    if (ours === theirs) agree++;
    else differ.push(`${d.id} ${d.name} (${d.rarity}): ours ${ours ? 'RH' : 'no RH'}, PokéWallet ${f.join('+') || 'none'}`);
  }
  findings.push(`**Reverse-holo check, ${tcgdexSetId}:** ${agree}/${compared} cards agree with our inferred rule (TCGdex ${tdx.length} cards, PokéWallet ${pwCards.length} rows).`);
  if (differ.length) sections.push(['## Reverse-holo disagreements (' + tcgdexSetId + ')', '', ...differ.map(x => '- ' + x)].join('\n'));
}

// ── report ───────────────────────────────────────────────────────────────────

function buildReport() {
  return [
    '# PokéWallet capability probe — run 2 (Japanese + images)',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Requests spent: **${spent} / ${MAX_REQUESTS}**. Quota left after the run: ${quota ? `hour ${quota.hour}, day ${quota.day}` : 'unknown (no rate-limit headers seen)'}`,
    '',
    '> Generated by `tools/pokewallet-probe.mjs`. Contains no credentials: request headers',
    '> are never recorded, and the text is checked for the key before being written.',
    '> Holds PokéWallet data — gitignored, do not commit (nor the images folder).',
    '',
    '## Findings',
    '',
    ...(findings.length ? findings.map(f => `- ${f}`) : ['- (none — the probe failed early)']),
    '',
    '## Images',
    '',
    ...(saved.length ? saved : ['- none fetched']),
    '',
    ...sections,
    '',
    '## Request log',
    '',
    '| # | path | status | ms | response (failures only) |',
    '|---|------|--------|----|--------------------------|',
    ...log.map(e => `| ${e.n} | \`${e.path}\` | ${e.error ? 'ERR: ' + e.error : e.status} | ${e.ms} | ${e.snippet ? '`' + e.snippet.replace(/\|/g, '\\|') + '`' : ''} |`),
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
  if (report.includes(key)) {
    console.error('[probe] ABORTED: the key appeared in the report text. Nothing was written.');
    process.exit(1);
  }
  writeFileSync(REPORT, report);
  console.log(`[probe] wrote tools/pokewallet-probe-report.md (${spent} request(s) spent)`);
}
