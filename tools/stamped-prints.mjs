#!/usr/bin/env node
// =============================================================================
// tools/stamped-prints.mjs — add the stamped prints TCGdex lacks to data/print-overrides.json.
//
// TCGplayer files many stamped prints (prerelease, staff, W, event and set-logo stamps)
// under the original card's number, mostly in its promo groups. Each is traced back to
// that card and its notes become TCGdex's stamp words (tools/lib/stamped.mjs); a print
// TCGdex does not list gets a row. All rows belong to one GitHub issue, the import's: a
// rerun replaces them, so rerunning after TCGdex adds a print drops its row (the app
// already skips it). The Jumbo rows are tools/jumbo-prints.mjs's, under their own issue.
//
// Reads the TCGplayer answers tools/tcgcsv-probe.mjs cached (newest build in
// tools/.cache/tcgcsv/; run the probe first). Requests: TCGdex GraphQL for every English
// card's prints (7), and TCGCSV for the printings of the groups that get rows, once per
// group and build (about 8, cached next to the products, as TCGCSV's guidelines ask).
// What does not trace goes to tools/stamped-prints-report.md (gitignored: it quotes
// TCGplayer's product names).
// Run: node tools/stamped-prints.mjs --issue N [--dry-run]
// =============================================================================

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatPrintOverrides, readPrintOverrides, withImport } from './lib/print-overrides.mjs';
import { catalogueIndex } from './lib/jumbo.mjs';
import { loose } from './lib/tcgcsv.mjs';
import { priceGuide, stampedPrintRows } from './lib/stamped.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const FILE = resolve(DATA, 'print-overrides.json');
const CACHE = resolve(ROOT, 'tools/.cache/tcgcsv');
const REPORT = resolve(ROOT, 'tools/stamped-prints-report.md');
// TCGCSV asks for a User-Agent of the tool's own (its usage guidelines), as the probe sends.
const USER_AGENT = process.env.TCGCSV_USER_AGENT || 'CardCoverageProbe/0.1';
const PAUSE_MS = 150;
const GQL = 'https://api.tcgdex.net/v2/graphql';
const GQL_QUERY = 'query($f:CardsFilters,$p:Int!,$k:Int){ cards(filters:$f, pagination:{page:$p,itemsPerPage:$k}){ id variants{normal holo reverse} variants_detailed{type subtype stamp size foil} } }';
const GQL_PAGE = 5000;

const readJSON = p => JSON.parse(readFileSync(p, 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** The newest cached TCGCSV build: its folder, and every group with its products. */
function tcgplayer() {
  const build = (existsSync(CACHE) ? readdirSync(CACHE).sort() : []).at(-1);
  const dir = build && resolve(CACHE, build);
  const groupsFile = dir && resolve(dir, 'tcgplayer__3__groups.json');
  if (!groupsFile || !existsSync(groupsFile)) throw new Error('no TCGCSV answers cached: run node tools/tcgcsv-probe.mjs first');
  const groups = [];
  for (const g of readJSON(groupsFile).results || []) {
    const file = resolve(dir, `tcgplayer__3__${g.groupId}__products.json`);
    if (!existsSync(file)) throw new Error(`build ${build} has no products cached for a group: rerun node tools/tcgcsv-probe.mjs`);
    groups.push({ id: g.groupId, name: g.name, products: readJSON(file).results || [] });
  }
  return { build, dir, groups };
}

/** product id → TCGplayer printings, for the given groups (cached; fetched once per build). */
async function printingsOf(dir, groups) {
  const out = new Map();
  let requests = 0;
  for (const g of groups) {
    const file = resolve(dir, `tcgplayer__3__${g.id}__prices.json`);
    if (!existsSync(file)) {
      if (requests) await sleep(PAUSE_MS);
      requests++;
      const r = await fetch(`https://tcgcsv.com/tcgplayer/3/${g.id}/prices`, { headers: { 'User-Agent': USER_AGENT } });
      if (r.status === 403 || r.status === 429) throw new Error(`TCGCSV answered ${r.status}: stopping, as its guidelines ask`);
      if (!r.ok) throw new Error(`TCGCSV prices: HTTP ${r.status}`);
      writeFileSync(file, JSON.stringify(await r.json()));
    }
    for (const p of readJSON(file).results || []) {
      if (p?.productId != null && p.subTypeName) out.set(p.productId, [...(out.get(p.productId) || []), p.subTypeName]);
    }
  }
  return { printings: out, requests };
}

/** card id → { flags, prints }, for every English TCGdex card. */
async function tcgdexPrints() {
  const out = new Map();
  let requests = 0;
  for (const category of ['Pokemon', 'Trainer', 'Energy']) {
    for (let page = 1; ; page++) {
      if (page > 20) throw new Error(`GraphQL ${category}: still paging at ${GQL_PAGE * 20} cards`);
      requests++;
      const r = await fetch(GQL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: GQL_QUERY, variables: { f: { category }, p: page, k: GQL_PAGE } }),
      });
      if (!r.ok) throw new Error(`TCGdex GraphQL: HTTP ${r.status}`);
      const list = (await r.json())?.data?.cards;
      if (!Array.isArray(list)) throw new Error(`TCGdex GraphQL ${category}: no data`);
      for (const c of list) if (c?.id) out.set(c.id, { flags: c.variants || {}, prints: c.variants_detailed || [] });
      if (list.length < GQL_PAGE) break;
    }
  }
  if (out.size < 10000) throw new Error(`TCGdex GraphQL answered for only ${out.size} cards`);
  return { prints: out, requests };
}

async function main() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--issue');
  const issue = at >= 0 ? Number(argv[at + 1]) : NaN;
  if (!Number.isInteger(issue) || issue < 1) throw new Error('--issue N: the GitHub issue the import belongs to');
  const dryRun = argv.includes('--dry-run');

  const before = existsSync(FILE) ? readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n') : '';
  const json = before ? JSON.parse(before) : { prints: [] };
  const existing = readPrintOverrides(json);
  if (existing.length !== (json.prints || []).length) throw new Error('data/print-overrides.json has rows the app skips: fix them first');
  if (existing.some(r => r.issue === issue && r.size === 'jumbo')) throw new Error(`issue #${issue} holds the Jumbo import: give the stamped prints their own issue`);
  const sets = readJSON(resolve(DATA, 'sets.json'));
  const catRows = [];
  for (const f of readdirSync(resolve(DATA, 'cat/en')).filter(f => /^cards-[a-z0]\.json$/.test(f))) {
    catRows.push(...(readJSON(resolve(DATA, 'cat/en', f)).rows || []));
  }
  const index = catalogueIndex(catRows, { setSeries: sets.setSeries || {} });
  const opts = { counts: sets.counts || {}, setNames: new Set(Object.values(sets.names?.en || {}).map(loose)), issue };

  const tp = tcgplayer();
  const td = await tcgdexPrints();
  // Printings only for the groups that get rows.
  const first = stampedPrintRows(tp.groups, index, { ...opts, tcgdex: td.prints });
  const need = new Set(first.rows.map(r => r.source));
  const pr = await printingsOf(tp.dir, tp.groups.filter(g => need.has(priceGuide(g.name))));
  const { rows, covered, left } = stampedPrintRows(tp.groups, index, { ...opts, tcgdex: td.prints, printings: pr.printings });

  const next = formatPrintOverrides(withImport(existing, rows, issue));
  const changed = next !== before;
  if (changed && !dryRun) writeFileSync(FILE, next);

  const reason = l => l.reason.replace(/^"[^"]*"/, '"…"').replace(/ (of|for) \S+$/, '');
  const reasons = {};
  for (const l of left) reasons[reason(l)] = (reasons[reason(l)] || 0) + 1;
  const stamps = {};
  for (const r of rows) { const k = r.stamp.join('+'); stamps[k] = (stamps[k] || 0) + 1; }
  writeFileSync(REPORT, [
    '# Stamped prints', '',
    `TCGCSV build ${tp.build}. Stamped prints filed under an original card's number: ${covered.length} TCGdex lists, ${rows.length} it does not (rows for #${issue}: ${Object.entries(stamps).map(([k, v]) => `${k} ${v}`).join(', ')}), ${left.length} left out.`, '',
    ...Object.entries(reasons).map(([k, v]) => `- ${k}: ${v}`), '',
    '## Rows', '', '| Card | Type | Stamps | Group |', '|---|---|---|---|',
    ...rows.map(r => `| ${r.card} | ${r.type} | ${r.stamp.join(', ')} | ${r.source.slice(r.source.lastIndexOf('/') + 1)} |`), '',
    '## Left out', '', '| Group | Number | TCGplayer name | Why |', '|---|---|---|---|',
    ...left.map(l => `| ${l.group} | ${l.number} | ${l.name.replace(/\|/g, '/')} | ${l.reason.replace(/\|/g, '/')} |`), '',
  ].join('\n'));

  console.log(`[stamped] ${covered.length} stamped print(s) TCGdex lists, ${rows.length} row(s) for #${issue}, ${left.length} left out (tools/stamped-prints-report.md)`);
  console.log(`[stamped] requests: TCGCSV ${pr.requests}, TCGdex ${td.requests}; data/print-overrides.json ${changed ? (dryRun ? 'would change (dry run)' : 'written') : 'unchanged'}`);
}

main().catch(err => {
  console.error(`[stamped] ${err.message}`);
  process.exit(1);
});
