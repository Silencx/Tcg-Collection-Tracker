#!/usr/bin/env node
// =============================================================================
// tools/tcgcsv-probe.mjs — what does TCGplayer's catalogue (via TCGCSV) list that our
// catalogues do not? Run locally for the full report, and every Monday by
// .github/workflows/refresh-data.yml for the build log.
//
// Phase 6 of docs/card-coverage-plan.md: a second source used for CHECKING. Nothing from
// it is served. TCGCSV (https://tcgcsv.com) mirrors TCGplayer's catalogue once a day,
// keyless. Its usage guidelines (read 2026-11-26) ask scripts to:
//   · send a custom User-Agent of the form AppName/X.Y.Z (generic or missing ones may
//     be blocked);
//   · pause ~100 ms between requests (this waits 150 ms), stay well under 10,000 a day;
//   · check last-updated.txt first and re-download only when it is newer;
//   · never call it from a user-facing app (this is a build-side probe only).
// This script keeps to all four. It made this machine's IP blocked once before
// (2026-10-22, a few requests with a generic User-Agent), so on a 403 or 429 it stops
// at once: no retry, no workaround. It exits 2 then, and the next run is a week later.
//
// Cost: last-updated.txt, the category list, then for each category one groups list
// and one products list per group: about 225 requests for English, about 330 more with
// --jp. Answers are kept in tools/.cache/tcgcsv/{build}/ (gitignored); while
// last-updated.txt has not changed, a rerun makes 1 request, and --offline makes none.
//
// The matching and the diff are tools/lib/tcgcsv.mjs. Out of it come:
//   · tools/tcgcsv-probe-report.md (gitignored): everything, with TCGplayer's names;
//   · [coverage] lines in the log: what the English diff has that
//     tools/tcgcsv-baseline.json (committed) does not. Set ids, numbers and counts only:
//     the Monday log is public, and TCGplayer's names and ids stay out of it.
// Once the new differences are looked at, --update-baseline writes the baseline afresh.
//
//   node tools/tcgcsv-probe.mjs                     # English (category 3) vs data/cat/en/
//   node tools/tcgcsv-probe.mjs --jp                # ... and Pokémon Japan vs data/jp-cat/
//   node tools/tcgcsv-probe.mjs --offline           # the newest cached build, no request
//   node tools/tcgcsv-probe.mjs --update-baseline   # the English diff becomes the baseline
//   TCGCSV_USER_AGENT=Name/1.0 node tools/tcgcsv-probe.mjs   # another User-Agent
// =============================================================================

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baselineOf, compareCatalogue, formatBaseline, groupCards, logLines, newSince, ourSets } from './lib/tcgcsv.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const CACHE = resolve(ROOT, 'tools/.cache/tcgcsv');
const REPORT = resolve(ROOT, 'tools/tcgcsv-probe-report.md');
const BASELINE = resolve(ROOT, 'tools/tcgcsv-baseline.json');
const BASE = 'https://tcgcsv.com';
// A generic tool name, as TCGCSV asks, with nothing about who runs it.
const UA = process.env.TCGCSV_USER_AGENT || 'CardCoverageProbe/0.1';
const withJp = process.argv.includes('--jp');
const offline = process.argv.includes('--offline');
const updateBaseline = process.argv.includes('--update-baseline');
const PAUSE_MS = 150;

const readJSON = p => JSON.parse(readFileSync(p, 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let requests = 0;

class Blocked extends Error {}

async function get(path, as = 'json') {
  if (offline) throw new Error(`${path} is not cached and --offline makes no request`);
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

/** Our side, from the committed files. */
function ours(lang) {
  const dir = resolve(DATA, lang === 'ja' ? 'jp-cat' : 'cat/en');
  const rows = readdirSync(dir).filter(f => /^cards-[a-z0]\.json$/.test(f)).flatMap(f => readJSON(resolve(dir, f)).rows || []);
  return lang === 'ja'
    ? ourSets('ja', { jpSets: readJSON(resolve(DATA, 'jp-cat/sets.json')).sets || [], rows })
    : ourSets('en', { sets: readJSON(resolve(DATA, 'sets.json')), rows });
}

async function probeCategory(categoryId, lang, say) {
  const mine = ours(lang);
  const groups = (await cached(`tcgplayer/${categoryId}/groups`)).results || [];
  let products = 0, sealed = 0, prints = 0;
  const cardGroups = [];
  for (const g of groups) {
    const list = (await cached(`tcgplayer/${categoryId}/${g.groupId}/products`)).results || [];
    products += list.length;
    const c = groupCards(list, lang);
    sealed += c.sealed; prints += c.prints;
    if (c.theirs.size) cardGroups.push({ name: g.name, publishedOn: g.publishedOn, cards: c.theirs.size, theirs: c.theirs, numbered: c.numbered });
  }
  const res = compareCatalogue(cardGroups, mine);

  const fmt = l => l.map(x => `${x.number} ${x.name}`.trim()).join('; ');
  say(`## Category ${categoryId} vs ${lang === 'ja' ? 'data/jp-cat/' : 'data/cat/en/'}`, '');
  say(`${groups.length} groups, ${products} products: ${sealed} sealed or without a number, ${prints} extra prints of a number already counted.`);
  say(`Group matching: ${Object.entries(res.how).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  if (res.byCards.length) say(`Sets found by their cards (${res.byCards.length}): ${res.byCards.join(', ')}.`);
  say(`Cards in both: ${res.inBoth}. Only TCGplayer: ${res.onlyTheirs}. Only ours (matched sets): ${res.onlyOurs}.`, '');
  say('| Set | TCGplayer group | Theirs | Ours | Only theirs | Only ours |', '|---|---|---|---|---|---|');
  for (const d of [...res.diffs].sort((x, y) => (y.theirs.length + y.ours.length) - (x.theirs.length + x.ours.length))) {
    say(`| ${d.id} | ${d.groups.join(' + ')} | ${d.theirsSize} | ${d.oursSize} | ${d.theirs.length} | ${d.ours.length} |`);
  }
  say('', '### Only TCGplayer lists', '', ...res.diffs.filter(d => d.theirs.length).map(d => `- **${d.id}** (${d.theirs.length}): ${fmt(d.theirs)}`));
  say('', '### Only ours lists', '', ...res.diffs.filter(d => d.ours.length).map(d => `- **${d.id}** (${d.ours.length}): ${fmt(d.ours)}`));
  say('', '### Groups that matched none of our sets', '', ...res.unmatched.map(u => `- ${u.name} (${u.date}, ${u.cards} cards): ${u.how}`), '');
  say('### Our sets no group matched', '', res.lonely.map(id => `${id} "${mine.get(id).name}" (${mine.get(id).numbers.size})`).join(', ') || 'none', '');
  return res;
}

const lines = ['# TCGCSV probe', ''];
const say = (...l) => lines.push(...l);
const t0 = Date.now();
try {
  if (offline) {
    stamp = (existsSync(CACHE) ? readdirSync(CACHE).sort() : []).at(-1);
    if (!stamp) throw new Error('nothing cached in tools/.cache/tcgcsv/: run once without --offline');
  } else {
    stamp = (await get('last-updated.txt', 'text')).trim().replace(/[^0-9A-Za-z-]/g, '_').slice(0, 40) || 'unknown';
  }
  say(`Run ${new Date().toISOString()}, TCGCSV build ${stamp}${offline ? ' (cached, --offline)' : ''}, User-Agent "${UA}".`, '');
  const cats = (await cached('tcgplayer/categories')).results || [];
  if (!cats.some(c => c.categoryId === 3)) throw new Error('no category 3 in the category list');
  const en = await probeCategory(3, 'en', say);

  // The English diff against the baseline: the build log's lines.
  const base = existsSync(BASELINE) ? readJSON(BASELINE) : null;
  if (updateBaseline) {
    const text = formatBaseline(baselineOf(en, stamp));
    // A Windows checkout may have CRLF line ends; git stores LF either way.
    const before = existsSync(BASELINE) ? readFileSync(BASELINE, 'utf8').replace(/\r\n/g, '\n') : '';
    // Only the build stamp changed: keep the file as it is.
    const changed = before.replace(/"build": "[^"]*"/, '') !== text.replace(/"build": "[^"]*"/, '');
    if (changed) writeFileSync(BASELINE, text);
    console.log(`[tcgcsv] baseline ${!before ? 'written' : changed ? 'updated' : 'unchanged'}: tools/tcgcsv-baseline.json (${en.onlyTheirs} numbers only TCGplayer lists, ${en.onlyOurs} only we list)`);
  } else {
    if (!base) console.log('[coverage] no tools/tcgcsv-baseline.json: every difference counts as new');
    for (const l of logLines(en, newSince(en, base || {}), { build: stamp })) console.log(l);
  }

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
  console.log(`[tcgcsv] ${requests} request(s); report: tools/tcgcsv-probe-report.md (local)`);
}
