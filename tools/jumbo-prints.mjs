#!/usr/bin/env node
// =============================================================================
// tools/jumbo-prints.mjs — add the Jumbo prints TCGdex lacks to data/print-overrides.json.
//
// TCGdex files a Jumbo card as a print of the normal card, and has one for about 210
// cards. TCGplayer lists more; each is traced back to the card it enlarges
// (tools/lib/jumbo.mjs), and a card TCGdex gives no Jumbo print gets a row. All rows
// belong to one GitHub issue, the import's: a rerun replaces them, so rerunning after
// TCGdex adds Jumbo prints drops the rows it no longer needs (the app already skips them).
// docs/card-coverage-plan.md, Phase 6, has the plan for sending them to TCGdex.
//
// Reads the TCGplayer answers tools/tcgcsv-probe.mjs cached (newest build in
// tools/.cache/tcgcsv/; run the probe first), plus at most one request of its own: the
// Jumbo group's printings, cached next to them. Asks TCGdex GraphQL which cards have a
// Jumbo print (7 requests). What does not trace to one card goes to
// tools/jumbo-prints-report.md (gitignored: it quotes TCGplayer's product names).
// Run: node tools/jumbo-prints.mjs --issue N [--dry-run]
// =============================================================================

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatPrintOverrides, readPrintOverrides, withImport } from './lib/print-overrides.mjs';
import { JUMBO_GROUP, catalogueIndex, jumboPrintRows } from './lib/jumbo.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const FILE = resolve(DATA, 'print-overrides.json');
const CACHE = resolve(ROOT, 'tools/.cache/tcgcsv');
const REPORT = resolve(ROOT, 'tools/jumbo-prints-report.md');
/** The proof every row links: TCGplayer's public price guide of the group. */
const SOURCE = 'https://www.tcgplayer.com/categories/trading-and-collectible-card-games/pokemon/price-guides/jumbo-cards';
// TCGCSV asks for a User-Agent of the tool's own (its usage guidelines), as the probe sends.
const USER_AGENT = process.env.TCGCSV_USER_AGENT || 'CardCoverageProbe/0.1';
const GQL = 'https://api.tcgdex.net/v2/graphql';
const GQL_QUERY = 'query($f:CardsFilters,$p:Int!,$k:Int){ cards(filters:$f, pagination:{page:$p,itemsPerPage:$k}){ id variants{normal holo reverse} variants_detailed{size} } }';
const GQL_PAGE = 5000;

const readJSON = p => JSON.parse(readFileSync(p, 'utf8'));

async function tcgplayer() {
  const builds = existsSync(CACHE) ? readdirSync(CACHE).sort() : [];
  const build = builds.at(-1);
  const dir = build && resolve(CACHE, build);
  const groupsFile = dir && resolve(dir, 'tcgplayer__3__groups.json');
  if (!groupsFile || !existsSync(groupsFile)) throw new Error('no TCGCSV answers cached: run node tools/tcgcsv-probe.mjs first');
  const group = (readJSON(groupsFile).results || []).find(g => g.name === JUMBO_GROUP);
  if (!group) throw new Error(`TCGplayer has no group named "${JUMBO_GROUP}" in build ${build}`);
  const productsFile = resolve(dir, `tcgplayer__3__${group.groupId}__products.json`);
  if (!existsSync(productsFile)) throw new Error(`build ${build} has no Jumbo products cached: rerun node tools/tcgcsv-probe.mjs`);

  const pricesFile = resolve(dir, `tcgplayer__3__${group.groupId}__prices.json`);
  let requests = 0;
  if (!existsSync(pricesFile)) {
    requests++;
    const r = await fetch(`https://tcgcsv.com/tcgplayer/3/${group.groupId}/prices`, { headers: { 'User-Agent': USER_AGENT } });
    if (r.status === 403 || r.status === 429) throw new Error(`TCGCSV answered ${r.status}: stopping, as its guidelines ask`);
    if (!r.ok) throw new Error(`TCGCSV prices: HTTP ${r.status}`);
    writeFileSync(pricesFile, JSON.stringify(await r.json()));
  }
  const printings = new Map();
  for (const p of readJSON(pricesFile).results || []) {
    if (p?.productId != null && p.subTypeName) printings.set(p.productId, [...(printings.get(p.productId) || []), p.subTypeName]);
  }
  return { build, products: readJSON(productsFile).results || [], printings, requests };
}

/** card id → { flags, jumbo }, for every English TCGdex card. */
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
      for (const c of list) {
        if (!c?.id) continue;
        out.set(c.id, { flags: c.variants || {}, jumbo: (c.variants_detailed || []).some(v => v?.size === 'jumbo') });
      }
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
  const sets = readJSON(resolve(DATA, 'sets.json'));
  const catRows = [];
  for (const f of readdirSync(resolve(DATA, 'cat/en')).filter(f => /^cards-[a-z0]\.json$/.test(f))) {
    catRows.push(...(readJSON(resolve(DATA, 'cat/en', f)).rows || []));
  }

  const tp = await tcgplayer();
  const td = await tcgdexPrints();
  const index = catalogueIndex(catRows, { setSeries: sets.setSeries || {} });
  const { rows, covered, left } = jumboPrintRows(tp.products, index, {
    counts: sets.counts || {}, printings: tp.printings, tcgdex: td.prints, source: SOURCE, issue,
  });
  const next = formatPrintOverrides(withImport(existing, rows, issue));
  const changed = next !== before;
  if (changed && !dryRun) writeFileSync(FILE, next);

  const reason = l => l.reason.replace(/ (of|for) \S+$/, '');
  const reasons = {};
  for (const l of left) reasons[reason(l)] = (reasons[reason(l)] || 0) + 1;
  const types = {};
  for (const r of rows) types[r.type] = (types[r.type] || 0) + 1;
  writeFileSync(REPORT, [
    '# Jumbo prints', '',
    `TCGCSV build ${tp.build}: ${tp.products.length} Jumbo products. ${covered.length} trace to a card TCGdex already gives a Jumbo print, ${rows.length} to one it does not (rows for #${issue}: ${Object.entries(types).map(([k, v]) => `${k} ${v}`).join(', ')}), ${left.length} left out.`, '',
    ...Object.entries(reasons).map(([k, v]) => `- ${k}: ${v}`), '',
    '| Number | TCGplayer name | Why |', '|---|---|---|',
    ...left.map(l => `| ${l.number || '—'} | ${l.name.replace(/\|/g, '/')} | ${l.reason} |`), '',
  ].join('\n'));

  console.log(`[jumbo] ${tp.products.length} TCGplayer Jumbo product(s): ${covered.length} covered by TCGdex, ${rows.length} row(s) for #${issue}, ${left.length} left out (tools/jumbo-prints-report.md)`);
  console.log(`[jumbo] requests: TCGCSV ${tp.requests}, TCGdex ${td.requests}; data/print-overrides.json ${changed ? (dryRun ? 'would change (dry run)' : 'written') : 'unchanged'}`);
}

main().catch(err => {
  console.error(`[jumbo] ${err.message}`);
  process.exit(1);
});
