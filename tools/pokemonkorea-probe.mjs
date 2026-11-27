#!/usr/bin/env node
// =============================================================================
// tools/pokemonkorea-probe.mjs — can Pokémon Korea's official card search give a Korean
// card list (set, number, name)?
//
// Phase 7 of docs/card-coverage-plan.md (🔑 OWNER). TCGdex lists 95 Korean sets but has
// cards for only 3. pokemoncard.co.kr (Pokémon Korea) has every card: its search page
// offers 581 products (sets and promo lines back to DP), and loads a product's cards
// from a JSON endpoint the page itself calls (POST /v2/ajax2_dev2, action
// get_more_cards) that gives each card's internal id, image and title. The number, the
// rarity and the set name are on each card's own page (/cards/detail/{id}).
//
// DO NOT RUN without Pokémon Korea's written permission. Its terms
// (pokemonkorea.co.kr/terms, art. 11 and 12, read 2026-11-27) claim the service's data
// as its own and forbid copying or distributing it without prior consent, and Korean law
// protects a database as a whole. Even with permission, only facts (set, number, name)
// would be taken, never images. robots.txt allows everything.
//
// Cost: 4 requests, 2 s apart, under a generic User-Agent; it stops at once on 403 or
// 429. 1) the search page, for the product list; 2) one product's first page of cards;
// 3–4) two of those cards' pages. Answers are kept in tools/.cache/pokemonkorea/
// (gitignored), so a rerun makes no request; --refresh fetches again.
//
// Writes tools/pokemonkorea-probe-report.md (gitignored): the product list's size and
// groups, what one page of cards holds, what a card page holds, and what a full Korean
// card list would cost in requests. Nothing from it is published.
// Run: node tools/pokemonkorea-probe.mjs [--product "<product name>"] [--refresh]
// =============================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = resolve(ROOT, 'tools/.cache/pokemonkorea');
const REPORT = resolve(ROOT, 'tools/pokemonkorea-probe-report.md');
const BASE = 'https://pokemoncard.co.kr';
// A generic tool name, with nothing about who runs it.
const UA = 'CardCoverageProbe/0.1';
const PAUSE_MS = 2000;
const refresh = process.argv.includes('--refresh');
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const lines = ['# Pokémon Korea probe', '', `Run ${new Date().toISOString()}, User-Agent "${UA}".`, ''];
const say = (...l) => { lines.push(...l); };
let requests = 0;

class Blocked extends Error {}

/** One request, cached under `key`; POST when `form` is given. */
async function cached(key, path, form = null) {
  const file = resolve(CACHE, `${key}.txt`);
  if (!refresh && existsSync(file)) return readFileSync(file, 'utf8');
  if (requests) await sleep(PAUSE_MS);
  requests++;
  const init = { headers: { 'User-Agent': UA } };
  if (form) {
    init.method = 'POST';
    init.body = new FormData();
    for (const [k, v] of Object.entries(form)) init.body.append(k, v);
    init.headers['X-Requested-With'] = 'XMLHttpRequest';
  }
  const r = await fetch(`${BASE}${path}`, init);
  if (r.status === 403 || r.status === 429) throw new Blocked(`${path}: HTTP ${r.status}; stopping`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  const text = await r.text();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, text);
  return text;
}

const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
const textOf = html => decode(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');

try {
  // 1) The product list: <select name="GoodsName">, grouped by <optgroup>.
  const page = await cached('cards', '/cards');
  const select = page.match(/<select[^>]*name=["']GoodsName["'][\s\S]*?<\/select>/i)?.[0] || '';
  const products = [], groups = new Map();
  let group = '(none)';
  for (const m of select.matchAll(/<optgroup[^>]*label=["']([^"']*)["']|<option[^>]*value=["']([^"']*)["'][^>]*>([^<]*)/gi)) {
    if (m[1] != null) { group = decode(m[1]); continue; }
    const value = decode(m[2]), label = decode(m[3]).trim();
    if (/전체$/.test(value)) continue;               // "썬&문 전체": an era, not a product
    products.push({ value, label, group });
    groups.set(group, (groups.get(group) || 0) + 1);
  }
  say('## Products', '', `${products.length} products in ${groups.size} groups: ${[...groups].map(([g, n]) => `${g} (${n})`).join(', ')}.`, '');
  if (!products.length) throw new Error('no product list found on /cards (the page changed?)');

  // 2) One product's first page of cards, as the page asks for it.
  const product = arg('--product') || products[0].value;
  const raw = await cached('product-page-1', '/v2/ajax2_dev2', {
    action: 'get_more_cards', limit: '0', GoodsName: product,
    CardTypeNum: '', CardType: '', CardMonType: '', Weakness: '', Resistance: '', TechErg: '',
    ability_label1: '', hp: '', retreat: '', order: '', orderby: '',
  });
  let obj = null;
  try { obj = JSON.parse(raw); } catch { /* reported below */ }
  if (!obj) throw new Error(`the card list answer is not JSON: ${raw.slice(0, 120)}`);
  const result = Array.isArray(obj.result) ? obj.result : [];
  say('## One page of cards', '', `Product "${product}": count ${obj.count}, ${result.length} cards, next limit ${obj.limit}, msg "${obj.msg}".`,
    `Fields per card: ${[...new Set(result.flatMap(r => Object.keys(r || {})))].join(', ')}.`, '',
    ...result.slice(0, 5).map(r => `- \`${JSON.stringify({ ...r, content: String(r.content ?? '').slice(0, 60) }).slice(0, 220)}\``), '');

  // 3–4) Two cards' own pages: where are number, rarity, name and set?
  for (const [i, c] of result.slice(0, 2).entries()) {
    const html = await cached(`card-${i + 1}`, `/cards/detail/${encodeURIComponent(c.CardNum)}`);
    const text = textOf(html);
    const at = text.search(/\b\d{1,3}\/[A-Za-z0-9-]{1,10}\b/);
    say(`## Card page ${c.CardNum}`, '', '```', (at >= 0 ? text.slice(Math.max(0, at - 40), at + 400) : text.slice(0, 400)), '```', '');
  }

  const pageSize = result.length || 1;
  say('## Cost of a full list', '',
    `At ${pageSize} cards a page, the product pages cost about ${products.length} requests plus one per further page;`,
    'if the number and set are only on each card\'s page, every card costs one more request (Korean has roughly',
    '8,000–15,000 cards, so a first full walk would be spread over weeks, like the Japanese list).', '');
} catch (err) {
  say('', `**Stopped:** ${err.message}`);
  console.error(`[pokemonkorea] ${err.message}`);
  process.exitCode = err instanceof Blocked ? 2 : 1;
} finally {
  say(`${requests} request(s).`);
  writeFileSync(REPORT, `${lines.join('\n')}\n`);
  console.log(`[pokemonkorea] ${requests} request(s); report: tools/pokemonkorea-probe-report.md (local)`);
}
