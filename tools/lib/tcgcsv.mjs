// =============================================================================
// tools/lib/tcgcsv.mjs — TCGplayer's catalogue (via TCGCSV) diffed against ours, and the
// weekly check against a baseline of known differences. Pure: no fs, no fetch;
// tools/tcgcsv-probe.mjs reads the files and makes the requests.
//
// What may leave this machine (the public build log, tools/tcgcsv-baseline.json): our set
// ids, card numbers and counts. Never TCGplayer's product or group names, nor its ids;
// those stay in the local report.
// =============================================================================

import { numberKey } from '../../js/api/overrides-model.js';
import { naturalCompare } from '../../js/api/catalog-model.js';

// Set names as both sides write them, reduced to one spelling: "SWSH09: Brilliant Stars"
// and "Brilliant Stars", "SM Promos" and "SM Black Star Promos", "EX Ruby and Sapphire"
// and "Ruby & Sapphire", "Mega Evolution Energies" and "Mega Evolution Energy".
const ERA = [['svp', 'scarlet violet'], ['sv', 'scarlet violet'], ['swsh', 'sword shield'], ['sm', 'sun moon'],
  ['bw', 'black white'], ['hgss', 'heartgold soulsilver'], ['dp', 'diamond pearl'], ['mep', 'mega evolution'],
  ['wotc', 'wizards']];
export function loose(s) {
  let t = String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/^[a-z]{1,5}\d*[a-z]?\d*\s*(?::|\s-)\s+/, '')  // "SWSH09: ", "SM - "
    .replace(/^ex\s+/, '');                                   // "EX Unseen Forces"
  for (const [abbr, full] of ERA) t = t.replace(new RegExp(`^${abbr}\\b`), full);
  return t.replace(/\bpromo(?: cards?)?\b/g, 'promos').replace(/\bblack star\b/g, '')
    .replace(/\benergies\b/g, 'energy').replace(/\bpok[eé]mon\b/g, '')
    .replace(/\b(set|the|and|base)\b/g, '').replace(/[^a-z0-9]+/g, '');
}

/** "074/111" → "074"; the number a card is told apart by is the part before the slash. */
export const head = n => String(n || '').split('/')[0].trim();

/** A product's card number (extendedData "Number"), or null for sealed product. */
export const numberOf = p => (p?.extendedData || []).find(e => e?.name === 'Number')?.value || null;

/**
 * Our side: set id → { name, date, numbers: Map numberKey → { number, name } }.
 * @param {string} lang  'en' (TCGdex sets from data/sets.json) or 'ja' (data/jp-cat/)
 * @param {object} opts.sets  data/sets.json, for 'en'
 * @param {object[]} opts.jpSets  data/jp-cat/sets.json `sets`, for 'ja'
 * @param {Array[]} opts.rows  the catalogue rows: [set, number, …]
 */
export function ourSets(lang, { sets = {}, jpSets = [], rows = [] } = {}) {
  const out = new Map();
  if (lang === 'ja') {
    for (const s of jpSets) out.set(s.key, { name: s.name, date: s.date || null, numbers: new Map() });
  } else {
    for (const [id, name] of Object.entries(sets.names?.en || {})) {
      if (sets.setSeries?.[id] !== 'tcgp') out.set(id, { name, date: sets.dates?.[id] || null, numbers: new Map() });
    }
  }
  for (const r of rows) {
    if (!Array.isArray(r) || r[1] == null || !out.has(r[0])) continue;
    out.get(r[0]).numbers.set(numberKey(lang, r[1]), { number: String(r[1]), name: typeof r[2] === 'string' ? r[2] : '' });
  }
  return out;
}

/**
 * One group's card numbers: numberKey → { number, name }. Sealed product (no number) is
 * counted and left out; a second product with a number already seen is another print
 * of that card ("Pikachu (Cosmos Holo)"), counted and left out.
 */
export function groupCards(products, lang = 'en') {
  const theirs = new Map();
  let sealed = 0, prints = 0;
  for (const p of products || []) {
    const num = numberOf(p);
    if (!num) { sealed++; continue; }
    const k = numberKey(lang, head(num));
    if (theirs.has(k)) { prints++; continue; }
    theirs.set(k, { number: head(num), name: String(p.name || '') });
  }
  return { theirs, sealed, prints };
}

/**
 * Group → our set. First by name; then, for a group no name matched, by release date —
 * but only to a set no name claimed and of a similar size, so "McDonald's Promos 2018"
 * (12 cards, released with Lost Thunder) does not become Lost Thunder. Several groups may
 * land on one set, and compareCatalogue pools their numbers.
 * @param {{name:string, publishedOn?:string, cards:number}[]} groups
 * @returns {Map<object, {id:string|null, how:string}>}
 */
export function matchGroups(groups, ours) {
  const byName = new Map(), byDate = new Map();
  for (const [id, s] of ours) {
    const k = loose(s.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(id);
    if (s.date) { if (!byDate.has(s.date)) byDate.set(s.date, []); byDate.get(s.date).push(id); }
  }
  const out = new Map(), claimed = new Set(), names = new Map();
  for (const g of groups) {
    const n = byName.get(loose(g.name)) || [];
    if (n.length === 1) { out.set(g, { id: n[0], how: 'name' }); claimed.add(n[0]); }
    else { out.set(g, { id: null, how: n.length > 1 ? `name ×${n.length}` : 'none' }); names.set(g, n); }
  }
  for (const [g, m] of out) {
    if (m.id) continue;
    const n = names.get(g), size = g.cards || 0;
    const d = (byDate.get(String(g.publishedOn || '').slice(0, 10)) || [])
      .filter(id => !claimed.has(id) && (!n.length || n.includes(id)))
      .filter(id => { const ourSize = ours.get(id).numbers.size; return ourSize && size >= ourSize / 2 && size <= ourSize * 2; });
    if (d.length === 1) out.set(g, { id: d[0], how: 'date' });
  }
  return out;
}

const byNumber = (x, y) => naturalCompare(x.number, y.number);

/**
 * The diff: per set of ours that some group matched, the numbers only TCGplayer lists
 * (`theirs`) and only we list (`ours`), each [{key, number, name}] in number order.
 * @param {{name, publishedOn, cards, theirs:Map}[]} cardGroups  groups with card numbers
 */
export function compareCatalogue(cardGroups, ours) {
  const how = {}, unmatched = [], bySet = new Map();
  for (const [g, m] of matchGroups(cardGroups, ours)) {
    how[m.how] = (how[m.how] || 0) + 1;
    if (!m.id) { unmatched.push({ name: g.name, date: String(g.publishedOn || '').slice(0, 10), cards: g.cards, how: m.how }); continue; }
    if (!bySet.has(m.id)) bySet.set(m.id, { groups: [], theirs: new Map() });
    const s = bySet.get(m.id);
    s.groups.push(g.name);
    for (const [k, v] of g.theirs) if (!s.theirs.has(k)) s.theirs.set(k, v);
  }
  let inBoth = 0, onlyTheirs = 0, onlyOurs = 0;
  const diffs = [];
  for (const [id, { groups, theirs }] of bySet) {
    const mine = ours.get(id).numbers;
    const a = [...theirs].filter(([k]) => !mine.has(k)).map(([key, v]) => ({ key, ...v })).sort(byNumber);
    const b = [...mine].filter(([k]) => !theirs.has(k)).map(([key, v]) => ({ key, ...v })).sort(byNumber);
    inBoth += theirs.size - a.length; onlyTheirs += a.length; onlyOurs += b.length;
    if (a.length || b.length) diffs.push({ id, groups, theirsSize: theirs.size, oursSize: mine.size, theirs: a, ours: b });
  }
  diffs.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const lonely = [...ours].filter(([id, s]) => !bySet.has(id) && s.numbers.size).map(([id]) => id).sort();
  return { how, matched: cardGroups.length - unmatched.length, groups: cardGroups.length, unmatched, diffs, inBoth, onlyTheirs, onlyOurs, lonely };
}

// ── The baseline: differences already known ──────────────────────────────────

/** A result's differences as a baseline (tools/tcgcsv-baseline.json): ids, numbers and counts only. */
export function baselineOf(res, build = '') {
  const side = k => Object.fromEntries(res.diffs.filter(d => d[k].length).map(d => [d.id, d[k].map(x => x.key)]));
  return { schemaVersion: 1, build, unmatchedGroups: res.unmatched.length, unmatchedSets: [...res.lonely], onlyTcgplayer: side('theirs'), onlyOurs: side('ours') };
}

/** The baseline file's text: one set per line, so an update is a short diff. */
export function formatBaseline(b) {
  const side = o => {
    const lines = Object.keys(o || {}).sort().map(id => `    ${JSON.stringify(id)}: ${JSON.stringify(o[id])}`);
    return lines.length ? `{\n${lines.join(',\n')}\n  }` : '{}';
  };
  return [
    '{',
    `  "schemaVersion": 1,`,
    `  "build": ${JSON.stringify(b.build || '')},`,
    `  "unmatchedGroups": ${Number(b.unmatchedGroups) || 0},`,
    `  "unmatchedSets": ${JSON.stringify(b.unmatchedSets || [])},`,
    `  "onlyTcgplayer": ${side(b.onlyTcgplayer)},`,
    `  "onlyOurs": ${side(b.onlyOurs)}`,
    '}',
    '',
  ].join('\n');
}

/**
 * What a result has that the baseline does not: numbers per set on either side, our sets
 * no group matches, how many more groups match none of ours; and how many of the
 * baseline's numbers are now in both (`resolved`), which an update would drop.
 */
export function newSince(res, base = {}) {
  const known = (side, id) => new Set(base[side]?.[id] || []);
  const fresh = k => res.diffs
    .map(d => ({ id: d.id, numbers: d[k].filter(x => !known(k === 'theirs' ? 'onlyTcgplayer' : 'onlyOurs', d.id).has(x.key)).map(x => x.number) }))
    .filter(d => d.numbers.length);
  const still = new Set(res.diffs.flatMap(d => [...d.theirs.map(x => `t|${d.id}|${x.key}`), ...d.ours.map(x => `o|${d.id}|${x.key}`)]));
  let resolved = 0;
  for (const [side, tag] of [['onlyTcgplayer', 't'], ['onlyOurs', 'o']]) {
    for (const [id, keys] of Object.entries(base[side] || {})) for (const k of keys) if (!still.has(`${tag}|${id}|${k}`)) resolved++;
  }
  const knownSets = new Set(base.unmatchedSets || []);
  return {
    theirs: fresh('theirs'),
    ours: fresh('ours'),
    sets: res.lonely.filter(id => !knownSets.has(id)),
    groups: Math.max(0, res.unmatched.length - (Number(base.unmatchedGroups) || 0)),
    resolved,
  };
}

const MAX_SETS = 25, MAX_NUMBERS = 40;
const list = nums => (nums.length > MAX_NUMBERS ? `${nums.slice(0, MAX_NUMBERS).join(', ')} … (+${nums.length - MAX_NUMBERS})` : nums.join(', '));
const count = (sets, what) => `${sets.reduce((n, s) => n + s.numbers.length, 0)} ${what} in ${sets.length} set(s)`;

/**
 * The build log's lines: ids, numbers and counts, never TCGplayer's names. `base` null
 * means no baseline, and everything counts as new.
 */
export function logLines(res, fresh, { build = '', baseline = 'tools/tcgcsv-baseline.json', prefix = '[coverage]' } = {}) {
  const out = [`${prefix} TCGplayer via TCGCSV (build ${build}): ${res.matched} of ${res.groups} groups match our sets; ${res.inBoth} card numbers in both`];
  const anything = fresh.theirs.length || fresh.ours.length || fresh.sets.length || fresh.groups;
  if (!anything) out.push(`${prefix}   nothing new since ${baseline} (${res.onlyTheirs} numbers only TCGplayer lists and ${res.onlyOurs} only we list are known)`);
  if (fresh.theirs.length) {
    out.push(`${prefix}   new: TCGplayer lists ${count(fresh.theirs, 'number(s) we lack')}`);
    for (const d of fresh.theirs.slice(0, MAX_SETS)) out.push(`${prefix}     ${d.id}: ${list(d.numbers)}`);
    if (fresh.theirs.length > MAX_SETS) out.push(`${prefix}     … and ${fresh.theirs.length - MAX_SETS} more set(s)`);
  }
  if (fresh.ours.length) {
    out.push(`${prefix}   new: we list ${count(fresh.ours, 'number(s) TCGplayer lacks')}`);
    for (const d of fresh.ours.slice(0, MAX_SETS)) out.push(`${prefix}     ${d.id}: ${list(d.numbers)}`);
    if (fresh.ours.length > MAX_SETS) out.push(`${prefix}     … and ${fresh.ours.length - MAX_SETS} more set(s)`);
  }
  if (fresh.sets.length) out.push(`${prefix}   new: our sets no TCGplayer group matches: ${fresh.sets.join(', ')}`);
  if (fresh.groups) out.push(`${prefix}   new: ${fresh.groups} more TCGplayer group(s) match no set of ours (a set TCGdex lacks?); run node tools/tcgcsv-probe.mjs locally for their names`);
  if (fresh.resolved) out.push(`${prefix}   ${fresh.resolved} number(s) in ${baseline} are now in both; node tools/tcgcsv-probe.mjs --update-baseline drops them`);
  return out;
}
