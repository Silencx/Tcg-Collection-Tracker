#!/usr/bin/env node
// =============================================================================
// tools/tcgdex-dexid-probe.mjs — can cards be matched by Pokédex number instead of name?
//
// Phase 4 of docs/card-coverage-plan.md. Answers, with keyless requests:
//   · which filters GraphQL `cards` accepts, and whether a category filter lifts the
//     "no filter" error the Phase 3 probe hit, so dexId can be read in bulk;
//   · how many Pokémon cards carry no dexId, and in which sets;
//   · how many carry several (Tag Teams and other cameos);
//   · whether REST filters by it (/cards?dexId=151), for the live path;
//   · for the edge-case Pokémon, which cards dexId matching adds to and drops from the
//     current whole-word name match on the committed English catalogue.
//
// Writes tools/tcgdex-dexid-probe-report.md (gitignored, like every probe report).
// Run: node tools/tcgdex-dexid-probe.mjs
// =============================================================================

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { namesSpecies } from '../js/api/providers/tcgdex.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = resolve(ROOT, 'tools/tcgdex-dexid-probe-report.md');
const API = 'https://api.tcgdex.net/v2';
const EDGE = ['Seedot', 'Nuzleaf', 'Shiftry', 'Mew', 'Mewtwo', 'Nidoran♀', 'Nidoran♂', "Farfetch'd",
  'Pikachu', 'Porygon-Z', 'Ho-Oh', 'Mr. Mime', 'Flabébé', 'Type: Null', 'Kommo-o', 'Rotom', 'Unown'];

const lines = [`# TCGdex dexId probe`, ``, `Run ${new Date().toISOString()}`, ``];
const say = (s = '') => { console.log(s); lines.push(s); };

async function timed(url, init) {
  const t = Date.now();
  const r = await fetch(url, init);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* reported by the caller */ }
  return { status: r.status, ms: Date.now() - t, bytes: Buffer.byteLength(text), json };
}
const gql = (query, variables) => timed(`${API}/graphql`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }),
});
const kb = n => `${(n / 1024).toFixed(0)} KB`;
const setOf = id => id.slice(0, id.lastIndexOf('-'));

// 1. What the schema offers.
say('## Schema');
const intro = await gql('{ f: __type(name:"CardsFilters"){ inputFields{ name type{ name kind ofType{ name } } } } '
  + 'c: __type(name:"Card"){ fields{ name type{ name kind ofType{ name kind ofType{ name } } } } } }');
const filters = intro.json?.data?.f?.inputFields || [];
say(`- CardsFilters: ${filters.map(f => f.name).join(', ') || `(none: ${intro.json?.errors?.[0]?.message || intro.status})`}`);
const dexField = (intro.json?.data?.c?.fields || []).find(f => f.name === 'dexId');
say(`- Card.dexId: ${dexField ? JSON.stringify(dexField.type) : 'absent'}`);
say();

// 2. Every English Pokémon card's dexId, in bulk.
say('## Bulk read (English)');
const Q = 'query($f:CardsFilters,$p:Int!,$k:Int){ cards(filters:$f, pagination:{page:$p,itemsPerPage:$k}){ id name category dexId } }';
const rows = [];
let pages = 0, ms = 0, bytes = 0, err = '';
for (let p = 1; p <= 40; p++) {
  const r = await gql(Q, { f: { category: 'Pokemon' }, p, k: 5000 });
  pages++; ms += r.ms; bytes += r.bytes;
  const list = r.json?.data?.cards;
  if (!Array.isArray(list)) { err = r.json?.errors?.[0]?.message || `HTTP ${r.status}`; break; }
  rows.push(...list.filter(Boolean));
  if (list.length < 5000) break;
}
say(`- \`cards(filters:{category:"Pokemon"})\`, 5000 a page: ${rows.length} rows, ${pages} pages, ${ms} ms, ${kb(bytes)}${err ? `, stopped: ${err}` : ''}`);
const restPokemon = await timed(`${API}/en/cards?category=Pokemon`);
say(`- REST \`?category=Pokemon\` for comparison: ${Array.isArray(restPokemon.json) ? restPokemon.json.length : restPokemon.status} cards`);
const byId = new Map(rows.map(r => [r.id, r]));
say(`- distinct ids: ${byId.size}; categories seen: ${[...new Set(rows.map(r => r.category))].join(', ')}`);
const dexOf = r => (Array.isArray(r.dexId) ? r.dexId.filter(n => Number.isInteger(n)) : []);
const none = [...byId.values()].filter(r => !dexOf(r).length);
const several = [...byId.values()].filter(r => dexOf(r).length > 1);
say(`- without dexId: ${none.length} (${(100 * none.length / Math.max(1, byId.size)).toFixed(1)}%)`);
const noneBySet = {};
for (const r of none) noneBySet[setOf(r.id)] = (noneBySet[setOf(r.id)] || 0) + 1;
const topSets = Object.entries(noneBySet).sort((a, b) => b[1] - a[1]);
say(`  - in ${topSets.length} sets; most: ${topSets.slice(0, 25).map(([s, n]) => `${s} ${n}`).join(', ')}`);
say(`  - samples: ${none.slice(0, 15).map(r => `${r.id} "${r.name}"`).join('; ')}`);
say(`- with several dexIds: ${several.length}; samples: ${several.slice(0, 10).map(r => `${r.id} "${r.name}" ${JSON.stringify(r.dexId)}`).join('; ')}`);
const odd = [...byId.values()].filter(r => r.dexId != null && !Array.isArray(r.dexId));
if (odd.length) say(`- dexId not an array: ${odd.length}, e.g. ${JSON.stringify(odd[0])}`);
say();

// 3. REST filter by dexId, for the live path.
say('## REST filter');
for (const q of ['dexId=151', 'dexId=eq:151', 'dexId=29']) {
  const r = await timed(`${API}/en/cards?${q}`);
  const list = Array.isArray(r.json) ? r.json : [];
  say(`- \`/en/cards?${q}\`: HTTP ${r.status}, ${r.ms} ms, ${list.length} items; first: ${list.slice(0, 4).map(c => `${c.id} "${c.name}"`).join(', ')}`);
}
const gqlDex = await gql('{ cards(filters:{dexId:151}, pagination:{page:1,itemsPerPage:1000}){ id name dexId } }');
say(`- GraphQL \`filters:{dexId:151}\`: ${Array.isArray(gqlDex.json?.data?.cards) ? `${gqlDex.json.data.cards.length} cards` : gqlDex.json?.errors?.[0]?.message || gqlDex.status}`);
say();

// 4. Edge cases: name match on the committed catalogue vs dexId match on the bulk read.
say('## Edge cases (English)');
const species = JSON.parse(readFileSync(resolve(ROOT, 'data/species.json'), 'utf8')).species;
const dexByName = new Map(species.map(s => [s[2], s[0]]));
const catDir = resolve(ROOT, 'data/cat/en');
const catRows = new Map();
for (const f of readdirSync(catDir)) {
  for (const r of JSON.parse(readFileSync(resolve(catDir, f), 'utf8')).rows) catRows.set(`${r[0]}-${r[1]}`, r);
}
for (const name of EDGE) {
  const dex = dexByName.get(name);
  const byName = new Set([...catRows.entries()].filter(([, r]) => namesSpecies(r[2], name)).map(([id]) => id));
  const byDex = new Set([...byId.values()].filter(r => dexOf(r).includes(dex)).map(r => r.id));
  const added = [...byDex].filter(id => !byName.has(id));
  const dropped = [...byName].filter(id => !byDex.has(id));
  const label = id => `${id} "${catRows.get(id)?.[2] ?? byId.get(id)?.name}"${catRows.get(id)?.[3] && catRows.get(id)[3] !== 'P' ? ` [${catRows.get(id)[3]}]` : ''}${byId.has(id) && !dexOf(byId.get(id)).length ? ' [no dexId]' : ''}`;
  say(`- **${name}** (#${dex}): name ${byName.size}, dexId ${byDex.size}`);
  if (added.length) say(`  - dexId adds ${added.length}: ${added.slice(0, 12).map(label).join('; ')}${added.length > 12 ? '; …' : ''}`);
  if (dropped.length) say(`  - dexId drops ${dropped.length}: ${dropped.slice(0, 12).map(label).join('; ')}${dropped.length > 12 ? '; …' : ''}`);
}
say();

writeFileSync(REPORT, lines.join('\n') + '\n');
console.log(`\n[probe] wrote ${REPORT}`);
