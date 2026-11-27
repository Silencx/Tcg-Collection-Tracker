#!/usr/bin/env node
// =============================================================================
// tools/cardmarket-probe.mjs — what does Cardmarket's product catalogue hold for
// Simplified Chinese Pokémon cards?
//
// Phase 7 of docs/card-coverage-plan.md (🔑 OWNER). Cardmarket lists every Simplified
// Chinese set and single since May 2026, and publishes its product catalogue per game as
// two public JSON files (singles and non-singles; Pokémon is game 6). Fields per product:
// idProduct, name (English, with the attacks in brackets), idCategory, categoryName,
// idExpansion, idMetacard, dateAdded. No card number, no Chinese name, no expansion name
// (checked on the files of 2026-11-26).
//
// Simplified Chinese expansions are told apart by their sealed products, whose names
// start with the set code ("CSM1aC: Storming Emergence - Radiant Booster"). Those codes
// are TCGdex's zh-cn set ids, so each one is compared with TCGdex's set list.
//
// The owner reads Cardmarket's terms first (cardmarket.com/en/Pokemon/Data/Product-List
// and Policies/GeneralTermsAndConditions, both behind Cloudflare's bot check). Nothing
// from this probe is published; Cardmarket's own ids never leave this machine.
//
//   node tools/cardmarket-probe.mjs --file <products_singles_6.json> --nonsingles <products_nonsingles_6.json>
//       files the owner downloaded: no request to Cardmarket
//   node tools/cardmarket-probe.mjs [--refresh]
//       downloads both files (a HEAD, then a GET each), kept in tools/.cache/cardmarket/
//       (gitignored), so a rerun makes no request
// Either way, one keyless request to TCGdex for its zh-cn set list (--no-tcgdex skips it).
// Writes tools/cardmarket-probe-report.md (gitignored, like every probe report).
// =============================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = resolve(ROOT, 'tools/.cache/cardmarket');
const REPORT = resolve(ROOT, 'tools/cardmarket-probe-report.md');
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const GAME = String(Number(arg('--game')) || 6);
const LIST = 'https://downloads.s3.cardmarket.com/productCatalog/productList';
// A generic tool name, with nothing about who runs it.
const UA = 'CardCoverageProbe/0.1';
const refresh = process.argv.includes('--refresh');
const withTcgdex = !process.argv.includes('--no-tcgdex');
const MAX_BYTES = 80 * 1024 * 1024;   // Cardmarket caps these files at 64 MiB; refuse anything bigger

const lines = ['# Cardmarket probe', '', `Run ${new Date().toISOString()}, game ${GAME}.`, ''];
const say = (...l) => { lines.push(...l); };
let requests = 0;

/** A catalogue file: the owner's local copy, else the cache, else one download. */
async function catalogue(kind, local) {
  if (local) { say(`- ${kind}: local file ${local} (no request)`); return JSON.parse(readFileSync(resolve(local), 'utf8')); }
  const file = resolve(CACHE, `products_${kind}_${GAME}.json`);
  if (!refresh && existsSync(file)) { say(`- ${kind}: cached copy (no request)`); return JSON.parse(readFileSync(file, 'utf8')); }
  const url = `${LIST}/products_${kind}_${GAME}.json`;
  requests++;
  const head = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA } });
  const size = Number(head.headers.get('content-length')) || 0;
  say(`- ${kind}: HEAD ${head.status}, ${(size / 1048576).toFixed(1)} MB, last modified ${head.headers.get('last-modified') || '?'}`);
  if (!head.ok) throw new Error(`${kind}: HEAD answered ${head.status}`);
  if (size > MAX_BYTES) throw new Error(`${kind}: ${(size / 1048576).toFixed(0)} MB, over the ${MAX_BYTES / 1048576} MB this probe allows`);
  requests++;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${kind}: GET answered ${r.status}`);
  const text = await r.text();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, text);
  return JSON.parse(text);
}

// "CSM1aC: Storming Emergence - Radiant Jumbo Booster" → code CSM1aC, set name.
const CODE = /^(CS[A-Za-z0-9.]*C)\s*:\s*(.+)$/;
const PRODUCT_TAIL = /\s+(?:Jumbo\s+)?(?:Booster Box|Booster|Starter Deck|Deck Building.*|Gift Box.*|Premium.*|Collection.*)$/i;

try {
  const singles = await catalogue('singles', arg('--file'));
  const nonsingles = await catalogue('nonsingles', arg('--nonsingles'));
  const S = singles.products || [], N = nonsingles.products || [];
  say(`- singles: ${S.length} products, built ${singles.createdAt}; non-singles: ${N.length}, built ${nonsingles.createdAt}`, '');

  const fields = [...new Set(S.flatMap(r => Object.keys(r || {})))];
  const numberish = fields.filter(k => /num|number|collector|local/i.test(k));
  const han = S.filter(r => /\p{Script=Han}/u.test(r?.name || '')).length;
  const categories = new Map();
  for (const r of S) categories.set(r?.categoryName, (categories.get(r?.categoryName) || 0) + 1);
  say('## The file', '',
    `- Fields: ${fields.join(', ')}.`,
    `- A field that looks like a card number: ${numberish.length ? numberish.join(', ') : 'none'}.`,
    `- Names written in Chinese characters: ${han} of ${S.length}.`,
    `- Categories: ${[...categories].map(([c, n]) => `${c} (${n})`).join(', ')}.`, '');

  // Simplified Chinese expansions, from their sealed products' names.
  const sets = new Map();
  for (const r of N) {
    const m = String(r?.name || '').match(CODE);
    if (!m) continue;
    const s = sets.get(r.idExpansion) || { code: m[1], name: m[2].replace(PRODUCT_TAIL, '').trim() };
    sets.set(r.idExpansion, s);
  }
  const perExpansion = new Map();
  for (const r of S) perExpansion.set(r.idExpansion, (perExpansion.get(r.idExpansion) || 0) + 1);

  let tcgdex = new Map();
  if (withTcgdex) {
    requests++;
    const r = await fetch('https://api.tcgdex.net/v2/zh-cn/sets');
    if (r.ok) {
      // TCGdex has listed one id twice (CSV1C, 127 and 9 cards): keep the larger, say so.
      const dupes = [];
      for (const s of await r.json()) {
        const k = s.id.toLowerCase(), had = tcgdex.get(k);
        if (had) dupes.push(`${s.id} (${had.cardCount?.total} and ${s.cardCount?.total})`);
        if (!had || (s.cardCount?.total || 0) > (had.cardCount?.total || 0)) tcgdex.set(k, s);
      }
      if (dupes.length) say(`- TCGdex lists these zh-cn set ids more than once: ${dupes.join(', ')}.`);
    } else say(`- TCGdex zh-cn sets: HTTP ${r.status}`);
  }
  const rows = [...sets].map(([id, s]) => ({ ...s, cards: perExpansion.get(id) || 0, td: tcgdex.get(s.code.toLowerCase()) }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const matched = rows.filter(r => r.td);
  say('## Simplified Chinese sets', '',
    `${rows.length} expansions carry a CS…C set code on their sealed products, with ${rows.reduce((n, r) => n + r.cards, 0)} singles.`,
    withTcgdex ? `${matched.length} of them are a TCGdex zh-cn set id; TCGdex lists ${tcgdex.size} zh-cn sets.` : '', '',
    '| Code | Set (Cardmarket, English) | Singles | TCGdex official | TCGdex cards |', '|---|---|---|---|---|',
    ...rows.map(r => `| ${r.code} | ${r.name} | ${r.cards} | ${r.td?.cardCount?.official ?? '—'} | ${r.td?.cardCount?.total ?? '—'} |`), '');
  if (withTcgdex) {
    const codes = new Set(rows.map(r => r.code.toLowerCase()));
    say(`TCGdex zh-cn sets with no Cardmarket code: ${[...tcgdex.values()].filter(s => !codes.has(s.id.toLowerCase())).map(s => `${s.id} (${s.cardCount?.total})`).join(', ') || 'none'}.`, '');
  }
  const expansionsWithoutSealed = [...perExpansion.keys()].filter(id => !N.some(r => r.idExpansion === id)).length;
  say(`${expansionsWithoutSealed} of ${perExpansion.size} expansions with singles have no sealed product, so no set code here (promos among them).`, '',
    '## Sample rows', '', ...S.slice(0, 3).map(r => `- \`${JSON.stringify(r).slice(0, 200)}\``), '');
} catch (err) {
  say('', `**Stopped:** ${err.message}`);
  console.error(`[cardmarket] ${err.message}`);
  process.exitCode = 1;
} finally {
  say(`${requests} request(s).`);
  writeFileSync(REPORT, `${lines.join('\n')}\n`);
  console.log(`[cardmarket] ${requests} request(s); report: tools/cardmarket-probe-report.md (local)`);
}
