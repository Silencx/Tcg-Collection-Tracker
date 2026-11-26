#!/usr/bin/env node
// =============================================================================
// tools/tcgdex-catalog-probe.mjs — can TCGdex hand over its whole card list cheaply?
//
// Phase 3 of docs/card-coverage-plan.md needs every card per language: id, set, number,
// name, category. This answers, with a handful of keyless requests, which way to get it:
//   · GET /v2/{lang}/cards with no filter (one answer, if it is really the whole list),
//   · the same with ?category= (the list items carry no category of their own),
//   · GraphQL `cards` with big pages (category and set come with every row),
//   · or the set walk: /v2/{lang}/sets then /v2/{lang}/sets/{id}.
//
// Writes tools/tcgdex-catalog-probe-report.md (gitignored, like every probe report).
// Run: node tools/tcgdex-catalog-probe.mjs [lang…]   (default: en)
// =============================================================================

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = resolve(ROOT, 'tools/tcgdex-catalog-probe-report.md');
const API = 'https://api.tcgdex.net/v2';
const langs = process.argv.slice(2).length ? process.argv.slice(2) : ['en'];

const lines = [`# TCGdex catalogue probe`, ``, `Run ${new Date().toISOString()}`, ``];
const say = (s = '') => { console.log(s); lines.push(s); };

async function timed(url, init) {
  const t = Date.now();
  const r = await fetch(url, init);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* reported below */ }
  return { status: r.status, ms: Date.now() - t, bytes: Buffer.byteLength(text), json };
}

const kb = n => `${(n / 1024).toFixed(0)} KB`;
const setOf = id => id.slice(0, id.lastIndexOf('-'));

for (const lang of langs) {
  say(`## ${lang}`);
  say();

  // 1. The unfiltered list.
  const all = await timed(`${API}/${lang}/cards`);
  const list = Array.isArray(all.json) ? all.json : [];
  say(`- \`GET /${lang}/cards\`: HTTP ${all.status}, ${all.ms} ms, ${kb(all.bytes)}, ${list.length} items`);
  if (list.length) {
    const keys = [...new Set(list.flatMap(c => Object.keys(c)))].sort();
    say(`  - item keys: ${keys.join(', ')}`);
    say(`  - distinct sets: ${new Set(list.map(c => setOf(c.id))).size}`);
    say(`  - without image: ${list.filter(c => !c.image).length}`);
    say(`  - sample: \`${JSON.stringify(list[0])}\``);
  }

  // 2. Category filter on the list.
  let catTotal = 0;
  for (const cat of ['Pokemon', 'Trainer', 'Energy']) {
    const r = await timed(`${API}/${lang}/cards?category=${cat}`);
    const n = Array.isArray(r.json) ? r.json.length : 0;
    catTotal += n;
    say(`- \`?category=${cat}\`: HTTP ${r.status}, ${r.ms} ms, ${kb(r.bytes)}, ${n} items`);
  }
  say(`  - sum of the three: ${catTotal} (unfiltered: ${list.length})`);

  // 3. Sets list, and one set's card briefs.
  const sets = await timed(`${API}/${lang}/sets`);
  const setList = Array.isArray(sets.json) ? sets.json : [];
  const sumCounts = setList.reduce((n, s) => n + (s.cardCount?.total || 0), 0);
  say(`- \`GET /${lang}/sets\`: HTTP ${sets.status}, ${setList.length} sets, cardCount.total summed: ${sumCounts}`);
  if (list.length && setList.length) {
    const listed = new Set(list.map(c => setOf(c.id)));
    const missing = setList.filter(s => !listed.has(s.id) && (s.cardCount?.total || 0) > 0);
    say(`  - sets with cards in /sets but none in /cards: ${missing.length}${missing.length ? ` (${missing.slice(0, 10).map(s => s.id).join(', ')}${missing.length > 10 ? ', …' : ''})` : ''}`);
  }
  const one = setList.find(s => s.id === 'swsh1') || setList[0];
  if (one) {
    const d = await timed(`${API}/${lang}/sets/${encodeURIComponent(one.id)}`);
    const cards = d.json?.cards || [];
    say(`- \`GET /${lang}/sets/${one.id}\`: HTTP ${d.status}, ${d.ms} ms, ${cards.length} cards; card keys: ${[...new Set(cards.flatMap(c => Object.keys(c)))].sort().join(', ')}`);
  }

  // 4. GraphQL with big pages: category and dexId come with every row.
  const q = 'query($p:Int!,$k:Int){ cards(pagination:{page:$p,itemsPerPage:$k}){ id localId name category dexId set{id} } }';
  let gqlRows = 0, gqlMs = 0, gqlBytes = 0, pages = 0, gqlErr = '';
  for (let p = 1; p <= 40; p++) {
    const r = await timed(`${API}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept-language': lang },
      body: JSON.stringify({ query: q, variables: { p, k: 5000 } }),
    });
    pages++; gqlMs += r.ms; gqlBytes += r.bytes;
    const rows = r.json?.data?.cards;
    if (!Array.isArray(rows)) { gqlErr = r.json?.errors?.[0]?.message || `HTTP ${r.status}`; break; }
    gqlRows += rows.filter(Boolean).length;
    if (p === 1) {
      say(`- GraphQL page 1 sample: \`${JSON.stringify(rows[0])}\``);
      say(`  - category values on page 1: ${[...new Set(rows.map(c => c?.category))].join(', ')}`);
      say(`  - rows without dexId on page 1 (Pokémon only): ${rows.filter(c => c?.category === 'Pokemon' && !(c.dexId || []).length).length}`);
    }
    if (rows.length < 5000) break;
  }
  say(`- GraphQL, 5000 a page: ${gqlRows} rows in ${pages} pages, ${gqlMs} ms, ${kb(gqlBytes)}${gqlErr ? `, stopped: ${gqlErr}` : ''}`);
  say(`  - (GraphQL answers in English unless told otherwise; the language header is a guess)`);
  say();
}

writeFileSync(REPORT, lines.join('\n') + '\n');
console.log(`\n[probe] wrote ${REPORT}`);
