#!/usr/bin/env node
// =============================================================================
// tools/ptcg-data-probe.mjs — what does PokemonTCG/pokemon-tcg-data list that our English
// catalogue does not, and the other way round?
//
// Phase 6 of docs/card-coverage-plan.md: a second source used for CHECKING, not served.
// pokemon-tcg-data is the MIT-licensed JSON behind pokemontcg.io (English only), one file
// per set on GitHub: sets/en.json, then cards/en/{set}.json. No key. Answers are kept in
// tools/.cache/ptcg-data/ (gitignored), so a rerun costs nothing; --refresh re-fetches.
//
// Sets are matched to TCGdex's by name (loosely), then by release date, then by id;
// trainer galleries ("swsh9tg") stay sets of their own, as TCGdex files them too.
// Numbers compare without case or zero padding ("001" is "1").
//
// Writes tools/ptcg-data-probe-report.md (gitignored, like every probe report): per set,
// the numbers one source has and the other lacks, and the sets that did not match.
// Run: node tools/ptcg-data-probe.mjs [--refresh]
// =============================================================================

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { numberKey } from '../js/api/overrides-model.js';
import { naturalCompare } from '../js/api/catalog-model.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const CACHE = resolve(ROOT, 'tools/.cache/ptcg-data');
const REPORT = resolve(ROOT, 'tools/ptcg-data-probe-report.md');
const RAW = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master';
const refresh = process.argv.includes('--refresh');

const readJSON = p => JSON.parse(readFileSync(p, 'utf8'));
let requests = 0;

async function cached(path) {
  const file = resolve(CACHE, path.replace(/\//g, '__'));
  if (!refresh && existsSync(file)) return readJSON(file);
  requests++;
  const r = await fetch(`${RAW}/${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  const json = await r.json();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, JSON.stringify(json));
  return json;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const loose = s => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/^pok[eé]mon\s+/, '').replace(/\b(set|the)\b/g, '').replace(/[^a-z0-9]+/g, '');
const day = s => String(s || '').replace(/\//g, '-').slice(0, 10);

// ── Our side: the English catalogue and set table ─────────────────────────────
const sets = readJSON(resolve(DATA, 'sets.json'));
const enNames = sets.names.en;
const ours = new Map();                      // TCGdex set id → Map numberKey → [number, name]
for (const f of readdirSync(resolve(DATA, 'cat/en')).filter(f => /^cards-[a-z0]\.json$/.test(f))) {
  for (const r of readJSON(resolve(DATA, 'cat/en', f)).rows) {
    if (!ours.has(r[0])) ours.set(r[0], new Map());
    ours.get(r[0]).set(numberKey('en', r[1]), [r[1], r[2]]);
  }
}

// ── Their side ────────────────────────────────────────────────────────────────
const t0 = Date.now();
const ptSets = await cached('sets/en.json');
const ptCards = await pool(ptSets, 8, s => cached(`cards/en/${s.id}.json`).catch(e => { console.warn(`  ${e.message}`); return null; }));

// Their set → our set id. Trainer and galarian galleries ("swsh9tg") are sets of their
// own on both sides.
const byName = new Map(), byDate = new Map();
for (const [id, name] of Object.entries(enNames)) {
  if (sets.setSeries?.[id] === 'tcgp') continue;
  const k = loose(name);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(id);
  const d = sets.dates?.[id];
  if (d) { if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push(id); }
}
function matchSet(s) {
  if (enNames[s.id] && loose(enNames[s.id]) === loose(s.name)) return { id: s.id, how: 'id' };
  const n = byName.get(loose(s.name)) || [];
  if (n.length === 1) return { id: n[0], how: 'name' };
  const d = (byDate.get(day(s.releaseDate)) || []).filter(id => !n.length || n.includes(id));
  if (d.length === 1) return { id: d[0], how: 'date' };
  if (enNames[s.id]) return { id: s.id, how: 'id' };
  return { id: null, how: n.length > 1 ? `name ×${n.length}` : 'none' };
}

const theirs = new Map();                    // our set id → Map numberKey → [number, name, their set]
const unmatched = [], how = {};
ptSets.forEach((s, i) => {
  const m = matchSet(s);
  how[m.how] = (how[m.how] || 0) + 1;
  if (!m.id) { unmatched.push(`${s.id} "${s.name}" (${day(s.releaseDate)}, ${s.total} cards): ${m.how}`); return; }
  if (!theirs.has(m.id)) theirs.set(m.id, new Map());
  for (const c of ptCards[i] || []) theirs.get(m.id).set(numberKey('en', c.number), [c.number, c.name, s.id]);
});

// ── Diff ──────────────────────────────────────────────────────────────────────
const rows = [];
let onlyTheirs = 0, onlyOurs = 0, both = 0;
for (const [id, cards] of theirs) {
  const mine = ours.get(id) || new Map();
  const a = [...cards].filter(([k]) => !mine.has(k)).map(([, v]) => v);
  const b = [...mine].filter(([k]) => !cards.has(k)).map(([, v]) => v);
  both += cards.size - a.length;
  onlyTheirs += a.length; onlyOurs += b.length;
  if (a.length || b.length) rows.push({ id, name: enNames[id], theirs: cards.size, ours: mine.size, a, b });
}
const notInTheirs = [...ours.keys()].filter(id => !theirs.has(id) && sets.setSeries?.[id] !== 'tcgp');

const fmt = list => list.sort((x, y) => naturalCompare(x[0], y[0])).map(([n, name]) => `${n} ${name}`).join('; ');
const lines = [
  '# pokemon-tcg-data probe', '',
  `Run ${new Date().toISOString()}: ${ptSets.length} sets, ${requests} request(s), ${((Date.now() - t0) / 1000).toFixed(1)} s.`, '',
  `Set matching: ${Object.entries(how).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
  `Cards in both: ${both}. Only in pokemon-tcg-data: ${onlyTheirs}. Only in our catalogue (matched sets): ${onlyOurs}.`,
  `Our English sets with no pokemon-tcg-data match: ${notInTheirs.length} (${notInTheirs.join(', ')}).`, '',
  '## Sets that differ', '',
  '| Set | Name | Theirs | Ours | Only theirs | Only ours |', '|---|---|---|---|---|---|',
  ...rows.sort((x, y) => (y.a.length + y.b.length) - (x.a.length + x.b.length))
    .map(r => `| ${r.id} | ${r.name} | ${r.theirs} | ${r.ours} | ${r.a.length} | ${r.b.length} |`),
  '', '## Cards only pokemon-tcg-data lists', '',
  ...rows.filter(r => r.a.length).map(r => `- **${r.id}** (${r.a.length}): ${fmt(r.a)}`),
  '', '## Cards only our catalogue lists', '',
  ...rows.filter(r => r.b.length).map(r => `- **${r.id}** (${r.b.length}): ${fmt(r.b)}`),
  '', '## Their sets that matched none of ours', '', ...unmatched.map(u => `- ${u}`), '',
];
writeFileSync(REPORT, lines.join('\n'));
console.log(lines.slice(2, 7).join('\n'));
console.log(`[probe] ${rows.length} set(s) differ; report: tools/ptcg-data-probe-report.md`);
