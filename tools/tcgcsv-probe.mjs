#!/usr/bin/env node
// =============================================================================
// tools/tcgcsv-probe.mjs — what does TCGplayer's catalogue (via TCGCSV) list that our
// catalogues do not?
//
// Phase 6 of docs/card-coverage-plan.md: a second source used for CHECKING. Nothing from
// it is published; the report stays local. TCGCSV (https://tcgcsv.com) mirrors
// TCGplayer's catalogue once a day, keyless. Its usage guidelines (read 2026-11-26) ask
// scripts to:
//   · send a custom User-Agent of the form AppName/X.Y.Z (generic or missing ones may
//     be blocked);
//   · pause ~100 ms between requests (this waits 150 ms), stay well under 10,000 a day;
//   · check last-updated.txt first and re-download only when it is newer;
//   · never call it from a user-facing app (this is a build-side probe only).
// This script keeps to all four. It made this machine's IP blocked once before
// (2026-10-22, a few requests with a generic User-Agent), so on a 403 or 429 it stops
// at once: no retry, no workaround.
//
// Cost: last-updated.txt, the category list, then for each category one groups list
// and one products list per group: about 230 requests for English, about 330 more with
// --jp. Answers are kept in tools/.cache/tcgcsv/ (gitignored); while last-updated.txt
// has not changed, a rerun makes 1 request.
//
// Sealed products are left out (no "Number" field). Prints of one card that TCGplayer
// lists as separate products ("Pikachu (Cosmos Holo)") share a number, so the diff is
// per number, like our catalogues. Groups are matched to our sets by name, then by date.
//
// Writes tools/tcgcsv-probe-report.md (gitignored).
//   node tools/tcgcsv-probe.mjs                # English (category 3) vs data/cat/en/
//   node tools/tcgcsv-probe.mjs --jp           # ... and Pokémon Japan vs data/jp-cat/
//   TCGCSV_USER_AGENT=Name/1.0 node tools/tcgcsv-probe.mjs   # another User-Agent
// =============================================================================

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { numberKey } from '../js/api/overrides-model.js';
import { naturalCompare } from '../js/api/catalog-model.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const CACHE = resolve(ROOT, 'tools/.cache/tcgcsv');
const REPORT = resolve(ROOT, 'tools/tcgcsv-probe-report.md');
const BASE = 'https://tcgcsv.com';
// A generic tool name, as TCGCSV asks, with nothing about who runs it.
const UA = process.env.TCGCSV_USER_AGENT || 'CardCoverageProbe/0.1';
const withJp = process.argv.includes('--jp');
const PAUSE_MS = 150;

const readJSON = p => JSON.parse(readFileSync(p, 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let requests = 0;

class Blocked extends Error {}

async function get(path, as = 'json') {
  if (requests) await sleep(PAUSE_MS);
  requests++;
  const r = await fetch(`${BASE}/${path}`, { headers: { 'User-Agent': UA, Accept: as === 'json' ? 'application/json' : 'text/plain' } });
  if (r.status === 403 || r.status === 429) throw new Blocked(`${path}: HTTP ${r.status}; stopping, as TCGCSV asks`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return as === 'json' ? r.json() : r.text();
}

// One cache folder per TCGCSV build: a new build means everything is read again, once.
let stamp = null;
async function cached(path) {
  const file = resolve(CACHE, stamp, `${path.replace(/\//g, '__')}.json`);
  if (existsSync(file)) return readJSON(file);
  const json = await get(path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(json));
  return json;
}

// Set names as both sides write them, reduced to one spelling: "SWSH09: Brilliant Stars"
// and "Brilliant Stars", "SM Promos" and "SM Black Star Promos", "EX Ruby and Sapphire"
// and "Ruby & Sapphire", "Mega Evolution Energies" and "Mega Evolution Energy".
const ERA = [['svp', 'scarlet violet'], ['sv', 'scarlet violet'], ['swsh', 'sword shield'], ['sm', 'sun moon'],
  ['bw', 'black white'], ['hgss', 'heartgold soulsilver'], ['dp', 'diamond pearl'], ['mep', 'mega evolution'],
  ['wotc', 'wizards']];
const loose = s => {
  let t = String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/^[a-z]{1,5}\d*[a-z]?\d*\s*(?::|\s-)\s+/, '')  // "SWSH09: ", "SM - "
    .replace(/^ex\s+/, '');                                   // "EX Unseen Forces"
  for (const [abbr, full] of ERA) t = t.replace(new RegExp(`^${abbr}\\b`), full);
  return t.replace(/\bpromo(?: cards?)?\b/g, 'promos').replace(/\bblack star\b/g, '')
    .replace(/\benergies\b/g, 'energy').replace(/\bpok[eé]mon\b/g, '')
    .replace(/\b(set|the|and|base)\b/g, '').replace(/[^a-z0-9]+/g, '');
};
const head = n => String(n || '').split('/')[0].trim();
const numberOf = p => (p.extendedData || []).find(e => e.name === 'Number')?.value || null;

/** Our side: set id → { name, date, numbers: Map numberKey → [number, name] }. */
function ourSets(lang) {
  const out = new Map();
  if (lang === 'ja') {
    for (const s of readJSON(resolve(DATA, 'jp-cat/sets.json')).sets) out.set(s['key'], { name: s.name, date: s.date, numbers: new Map() });
  } else {
    const sets = readJSON(resolve(DATA, 'sets.json'));
    for (const [id, name] of Object.entries(sets.names.en)) {
      if (sets.setSeries?.[id] !== 'tcgp') out.set(id, { name, date: sets.dates?.[id] || null, numbers: new Map() });
    }
  }
  const dir = resolve(DATA, lang === 'ja' ? 'jp-cat' : 'cat/en');
  for (const f of readdirSync(dir).filter(f => /^cards-[a-z0]\.json$/.test(f))) {
    for (const r of readJSON(resolve(dir, f)).rows) {
      if (r[1] == null || !out.has(r[0])) continue;
      out.get(r[0]).numbers.set(numberKey(lang, r[1]), [r[1], r[2]]);
    }
  }
  return out;
}

/**
 * Group → our set. First by name; then, for a group no name matched, by release date —
 * but only to a set no name claimed and of a similar size, so "McDonald's Promos 2018"
 * (12 cards, released with Lost Thunder) does not become Lost Thunder. Several groups may
 * land on one set ("Generations" and "Generations: Radiant Collection" are both g1).
 */
function matchGroups(groups, ours) {
  const byName = new Map(), byDate = new Map();
  for (const [id, s] of ours) {
    const k = loose(s.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(id);
    if (s.date) { if (!byDate.has(s.date)) byDate.set(s.date, []); byDate.get(s.date).push(id); }
  }
  const out = new Map(), claimed = new Set();
  for (const g of groups) {
    const n = byName.get(loose(g.name)) || [];
    if (n.length === 1) { out.set(g, { id: n[0], how: 'name' }); claimed.add(n[0]); }
    else out.set(g, { id: null, how: n.length > 1 ? `name ×${n.length}` : 'none', names: n });
  }
  for (const [g, m] of out) {
    if (m.id) continue;
    const size = g.cards || 0;
    const d = (byDate.get(String(g.publishedOn || '').slice(0, 10)) || [])
      .filter(id => !claimed.has(id) && (!m.names.length || m.names.includes(id)))
      .filter(id => { const ourSize = ours.get(id).numbers.size; return ourSize && size >= ourSize / 2 && size <= ourSize * 2; });
    if (d.length === 1) out.set(g, { id: d[0], how: 'date' });
  }
  return out;
}

async function probeCategory(categoryId, lang, say) {
  const ours = ourSets(lang);
  const groups = (await cached(`tcgplayer/${categoryId}/groups`)).results || [];
  let products = 0, sealed = 0, prints = 0, inBoth = 0, onlyTheirs = 0, onlyOurs = 0;
  const cardGroups = [];
  for (const g of groups) {
    const list = (await cached(`tcgplayer/${categoryId}/${g.groupId}/products`)).results || [];
    products += list.length;
    const theirs = new Map();
    for (const p of list) {
      const num = numberOf(p);
      if (!num) { sealed++; continue; }
      const k = numberKey(lang, head(num));
      if (theirs.has(k)) { prints++; continue; }
      theirs.set(k, [head(num), p.name]);
    }
    if (theirs.size) cardGroups.push({ ...g, cards: theirs.size, theirs });
  }

  const how = {}, unmatched = [], bySet = new Map();
  for (const [g, m] of matchGroups(cardGroups, ours)) {
    how[m.how] = (how[m.how] || 0) + 1;
    if (!m.id) { unmatched.push(`${g.name} (${String(g.publishedOn || '').slice(0, 10)}, ${g.cards} cards): ${m.how}`); continue; }
    if (!bySet.has(m.id)) bySet.set(m.id, { groups: [], theirs: new Map() });
    const s = bySet.get(m.id);
    s.groups.push(g.name);
    for (const [k, v] of g.theirs) if (!s.theirs.has(k)) s.theirs.set(k, v);
  }
  const diffs = [];
  for (const [id, { groups: names, theirs }] of bySet) {
    const mine = ours.get(id).numbers;
    const a = [...theirs].filter(([k]) => !mine.has(k)).map(([, v]) => v);
    const b = [...mine].filter(([k]) => !theirs.has(k)).map(([, v]) => v);
    inBoth += theirs.size - a.length; onlyTheirs += a.length; onlyOurs += b.length;
    if (a.length || b.length) diffs.push({ id, group: names.join(' + '), theirs: theirs.size, ours: mine.size, a, b });
  }
  const fmt = l => l.sort((x, y) => naturalCompare(x[0], y[0])).map(([n, name]) => `${n} ${name}`).join('; ');
  say(`## Category ${categoryId} vs ${lang === 'ja' ? 'data/jp-cat/' : 'data/cat/en/'}`, '');
  say(`${groups.length} groups, ${products} products: ${sealed} sealed or without a number, ${prints} extra prints of a number already counted.`);
  say(`Group matching: ${Object.entries(how).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  say(`Cards in both: ${inBoth}. Only TCGplayer: ${onlyTheirs}. Only ours (matched sets): ${onlyOurs}.`, '');
  say('| Set | TCGplayer group | Theirs | Ours | Only theirs | Only ours |', '|---|---|---|---|---|---|');
  for (const d of diffs.sort((x, y) => (y.a.length + y.b.length) - (x.a.length + x.b.length))) {
    say(`| ${d.id} | ${d.group} | ${d.theirs} | ${d.ours} | ${d.a.length} | ${d.b.length} |`);
  }
  say('', '### Only TCGplayer lists', '', ...diffs.filter(d => d.a.length).map(d => `- **${d.id}** (${d.a.length}): ${fmt(d.a)}`));
  say('', '### Only ours lists', '', ...diffs.filter(d => d.b.length).map(d => `- **${d.id}** (${d.b.length}): ${fmt(d.b)}`));
  say('', '### Groups that matched none of our sets', '', ...unmatched.map(u => `- ${u}`), '');
  const lonely = [...ours].filter(([id, s]) => !bySet.has(id) && s.numbers.size).map(([id, s]) => `${id} "${s.name}" (${s.numbers.size})`);
  say('### Our sets no group matched', '', lonely.join(', ') || 'none', '');
}

const lines = ['# TCGCSV probe', ''];
const say = (...l) => lines.push(...l);
const t0 = Date.now();
try {
  stamp = (await get('last-updated.txt', 'text')).trim().replace(/[^0-9A-Za-z-]/g, '_').slice(0, 40) || 'unknown';
  say(`Run ${new Date().toISOString()}, TCGCSV build ${stamp}, User-Agent "${UA}".`, '');
  const cats = (await cached('tcgplayer/categories')).results || [];
  const en = cats.find(c => c.categoryId === 3);
  if (!en) throw new Error('no category 3 in the category list');
  await probeCategory(3, 'en', say);
  if (withJp) {
    const jp = cats.find(c => /pok[eé]mon japan/i.test(`${c.name} ${c.displayName || ''}`));
    if (!jp) throw new Error('no Pokémon Japan category in the category list');
    await probeCategory(jp.categoryId, 'ja', say);
  }
} catch (err) {
  say('', `**Stopped:** ${err.message}`);
  console.error(`[tcgcsv] ${err.message}`);
  process.exitCode = err instanceof Blocked ? 2 : 1;
} finally {
  say(`${requests} request(s), ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
  writeFileSync(REPORT, `${lines.join('\n')}\n`);
  console.log(`[tcgcsv] ${requests} request(s); report: tools/tcgcsv-probe-report.md`);
}
