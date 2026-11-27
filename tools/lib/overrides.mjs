// =============================================================================
// tools/lib/overrides.mjs — "Missing card" reports, from issue form to override row
// (data/overrides.json), and the weekly pruning of rows a source now lists. Pure: the
// scripts (tools/missing-card.mjs, tools/prune-overrides.mjs) do the file reading.
//
// The issue body is hostile input: anyone can open an issue, and edit it into anything.
// So every field is cleaned to one line of plain text, checked against a strict shape,
// and only then resolved against our own data; the row is rebuilt from what resolved,
// never copied. Text this module writes for GitHub (comments, the PR) quotes a user's
// value only inside a code span, where a mention or an issue link does nothing.
// =============================================================================

import { LANGUAGES, DIGITAL_SERIES } from '../../js/config.js';
import { namesSpecies } from '../../js/api/match-model.js';
import { naturalCompare } from '../../js/api/catalog-model.js';
import { jpNumKey } from '../../js/api/jp-model.js';
import { OVERRIDE_LANGS, numberKey, cardKey, overrideId, readOverrides } from '../../js/api/overrides-model.js';

// ── The form ──────────────────────────────────────────────────────────────────

/** The form's fields, by the heading GitHub writes for each (.github/ISSUE_TEMPLATE/missing-card.yml). */
export const FORM_FIELDS = Object.freeze([
  { id: 'lang', label: 'Language', required: true },
  { id: 'set', label: 'Set', required: true },
  { id: 'number', label: 'Card number', required: true },
  { id: 'name', label: 'Card name', required: true },
  { id: 'dex', label: 'Pokémon on the card', required: false },
  { id: 'proof', label: 'Proof link', required: true },
]);

/** The form's language choices, in its order: every TCGdex language, then Japanese. */
export const FORM_LANGS = Object.freeze([
  ...LANGUAGES.map(l => ({ code: l.code, label: l.label })),
  { code: 'ja', label: 'Japanese' },
]);

/** Sites a proof link may point at (the host, or any subdomain of it). */
export const PROOF_HOSTS = Object.freeze([
  'bulbapedia.bulbagarden.net', 'archives.bulbagarden.net', 'pkmncards.com', 'limitlesstcg.com',
  'serebii.net', 'tcgplayer.com', 'cardmarket.com', 'pricecharting.com', 'tcgcollector.com',
  'pokellector.com', 'pokemon.com', 'pokemon-card.com', 'pokemon.co.jp',
]);

const BODY_MAX = 20000;
const FIELD_MAX = { lang: 40, set: 100, number: 24, name: 80, dex: 120, proof: 300 };

/**
 * One line of plain text: Unicode NFC, control, zero-width and direction-changing
 * characters turned into spaces, runs of white space collapsed.
 */
export function cleanText(s) {
  return String(s ?? '').normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A user's value, safe to quote in a GitHub comment: a short code span. */
export function quote(s, max = 60) {
  const t = cleanText(s).replace(/`/g, "'");
  return `\`${t.length > max ? `${t.slice(0, max)}…` : t}\``;
}

/**
 * The form's answers from an issue body. GitHub writes each field as `### Label`, a
 * blank line and the answer, "_No response_" for an empty optional one. A heading the
 * form does not have is ignored; one written twice makes the report ambiguous.
 * @returns {{ values: Record<string,string>, problems: string[] }}
 */
export function parseIssueForm(body) {
  const values = {}, problems = [];
  if (typeof body !== 'string' || !body.trim()) return { values, problems: ['The issue has no form answers. Please open it with the "Missing card" form.'] };
  if (body.length > BODY_MAX) return { values, problems: ['The issue is too long to be a form answer. Please open it with the "Missing card" form.'] };

  const byLabel = new Map(FORM_FIELDS.map(f => [f.label.toLowerCase(), f]));
  const seen = new Set();
  let field = null, lines = [];
  const flush = () => {
    if (!field) return;
    const v = cleanText(lines.join(' '));
    values[field.id] = v === '_No response_' ? '' : v;
  };
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const h = /^###\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const f = byLabel.get(cleanText(h[1]).toLowerCase()) || null;
      if (f && seen.has(f.id)) problems.push(`The field "${f.label}" appears more than once.`);
      if (f) seen.add(f.id);
      field = f && !values[f.id] ? f : null;
      lines = [];
      continue;
    }
    if (field) lines.push(line);
  }
  flush();
  for (const f of FORM_FIELDS) {
    if (f.required && !values[f.id]) problems.push(`"${f.label}" is empty.`);
    else if ((values[f.id] || '').length > FIELD_MAX[f.id]) problems.push(`"${f.label}" is longer than ${FIELD_MAX[f.id]} characters.`);
  }
  return { values, problems };
}

// ── Checking a report ─────────────────────────────────────────────────────────

// Letters of every script count: a Korean, Chinese or Thai name kept only a-z0-9 was
// empty, and so matched every set of its language.
const loose = s => cleanText(s).normalize('NFKD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A language from the form's answer: its label ("German") or code ("de"). */
export function resolveLang(answer) {
  const a = cleanText(answer).toLowerCase();
  return FORM_LANGS.find(l => l.label.toLowerCase() === a || l.code.toLowerCase() === a)?.code || null;
}

export const langLabel = code => FORM_LANGS.find(l => l.code === code)?.label || code;

/**
 * The set a report names, among the sets of its language: by id or code, else by name.
 * @param {object} ctx  { sets: data/sets.json, jpSets: data/jp-cat/sets.json `sets` }
 * @returns {{ set?: string, setName?: string, size?: number, problem?: string }}
 */
export function resolveSet(lang, answer, { sets = {}, jpSets = [] } = {}) {
  const a = cleanText(answer);
  if (!a) return { problem: '"Set" is empty.' };
  let found;
  if (lang === 'ja') {
    const byKey = jpSets.filter(s => s.key === a.toLowerCase());
    const byCode = jpSets.filter(s => s.code && s.code.toLowerCase() === a.toLowerCase());
    const byName = jpSets.filter(s => loose(s.name) === loose(a));
    found = [byKey, byCode, byName].find(l => l.length) || [];
    found = found.map(s => ({ set: s.key, setName: s.name, size: s.cards || 0 }));
  } else {
    const names = sets.names?.[lang] || {};
    const en = sets.names?.en || {};
    const ids = Object.keys(names).filter(id => !DIGITAL_SERIES.has(sets.setSeries?.[id]));
    const la = loose(a);
    const byId = ids.filter(id => id.toLowerCase() === a.toLowerCase());
    const byName = la ? ids.filter(id => loose(names[id]) === la) : [];
    const byEnName = la ? ids.filter(id => en[id] && loose(en[id]) === la) : [];
    found = [byId, byName, byEnName].find(l => l.length) || [];
    const counts = sets.lang?.[lang]?.counts || sets.counts || {};
    found = found.map(id => {
      const c = counts[id] || sets.counts?.[id] || {};
      return { set: id, setName: names[id], size: Math.max(c.official || 0, c.total || 0) };
    });
  }
  if (found.length === 1) return found[0];
  if (found.length > 1) {
    return { problem: `More than one ${langLabel(lang)} set is called ${quote(a)}: ${found.map(f => quote(f.set)).join(', ')}. Please give the code instead.` };
  }
  return { problem: `There is no ${langLabel(lang)} set called ${quote(a)}. Use the set's name or code as the tracker shows it.` };
}

const NUM_SHAPE = /^([A-Za-z]{0,6})(\d{1,4})([A-Za-z]{0,2})$/;
const LETTERS_ONLY = /^[A-Za-z]{1,6}$/;
const JP_TAIL = /^[A-Za-z0-9-]{1,8}$/;

/** Largest number a set of `size` cards may plausibly print, secret rares included. */
export const numberLimit = size => (size > 0 ? Math.max(2 * size, size + 50) : 999);

/**
 * A card number in the set's own spelling. For a TCGdex set the listed numbers set the
 * style: their prefix ("20" in SWSH Black Star Promos is "SWSH020") and their zero
 * padding ("7" in Scarlet & Violet is "007", "007" in Base Set is "7"). A Japanese
 * number is kept as printed ("001/053"); its checklist key drops the padding anyway.
 * @param {string[]} listed  the numbers the set's card list already has
 * @returns {{ number?: string, problem?: string }}
 */
export function normaliseNumber(lang, answer, { listed = [], size = 0 } = {}) {
  let s = cleanText(answer).replace(/^(?:#|no\.?)\s*/i, '')
    .replace(/\s*\/\s*/g, '/')                   // "163 / 198"
    .replace(/([A-Za-z])\s+(?=\d)/g, '$1');      // "SWSH 020"
  const bad = { problem: `${quote(answer)} does not look like a card number. Give it as printed, e.g. "SWSH020", "163/198" or "TG05".` };
  if (!s || /\s/.test(s) || s.split('/').length > 2) return bad;

  if (lang === 'ja') {
    const [head, tail, ...more] = s.split('/');
    if (more.length || (tail !== undefined && !JP_TAIL.test(tail))) return bad;
    const m = NUM_SHAPE.exec(head);
    if (!m && !LETTERS_ONLY.test(head)) return bad;
    const total = tail && /^\d+$/.test(tail) ? Number(tail) : 0;
    const known = Math.max(size, total, ...listed.map(n => Number(jpNumKey(n)) || 0));
    if (m && (Number(m[2]) < 1 || Number(m[2]) > numberLimit(known))) return implausible(answer, known);
    return { number: (tail !== undefined ? `${head}/${tail}` : head).toUpperCase() };
  }

  s = s.split('/')[0];
  if (LETTERS_ONLY.test(s)) return { number: s.toUpperCase() };
  const m = NUM_SHAPE.exec(s);
  if (!m) return bad;
  let [, prefix, digits, suffix] = m;
  const parts = listed.map(n => NUM_SHAPE.exec(n)).filter(Boolean);
  // No prefix given, and every listed number has the same one: it is that set's style.
  const prefixes = [...new Set(parts.map(p => p[1].toUpperCase()))];
  if (!prefix && prefixes.length === 1 && prefixes[0]) prefix = prefixes[0];
  const group = parts.filter(p => p[1].toUpperCase() === prefix.toUpperCase());
  if (group.length) prefix = group[0][1];
  else prefix = prefix.toUpperCase();
  const value = Number(digits);
  if (group.length) {
    const padded = group.filter(p => p[2].length > 1 && p[2].startsWith('0'));
    if (padded.length) {
      const widths = new Map();
      for (const p of group) widths.set(p[2].length, (widths.get(p[2].length) || 0) + 1);
      const width = [...widths].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0][0];
      digits = String(value).padStart(width, '0');
    } else {
      digits = String(value);
    }
  }
  const known = Math.max(prefix ? 0 : size, ...group.map(p => Number(p[2])));
  if (value < 1 || value > numberLimit(known)) return implausible(answer, known);
  return { number: `${prefix}${digits}${suffix}` };
}

function implausible(answer, known) {
  return { problem: `${quote(answer)} is not a plausible number for this set${known ? ` (it has about ${known} cards)` : ''}.` };
}

// Letters of any script, digits, spaces and the punctuation card names use: "Team
// Rocket's Mewtwo ex", "Professor's Research (Professor Oak)", "Pikachu & Zekrom-GX",
// "Nidoran ♀", "Mewtwo ☆", "Type: Null", "Unown [A]". No markup, mention or link syntax.
const NAME_RE = /^[\p{L}\p{M}\p{N} '’.,&:!?()[\]♀♂☆★δ+-]+$/u;

/**
 * The Pokédex numbers of the Pokémon on a card: those its name names, plus any the
 * report lists ("25", "Pikachu, Zekrom").
 * @returns {{ dexId: number[], problem?: string }}
 */
export function resolveDex(name, answer, dexByName) {
  const ids = new Set();
  const maxDex = Math.max(0, ...(dexByName?.values() || []));
  for (const [species, dex] of dexByName || []) if (namesSpecies(name, species)) ids.add(dex);
  const byLoose = new Map([...(dexByName || [])].map(([n, d]) => [loose(n), d]));
  for (const tok of cleanText(answer).split(',').map(t => t.trim()).filter(Boolean)) {
    const n = /^#?(\d{1,4})$/.exec(tok);
    const dex = n ? Number(n[1]) : byLoose.get(loose(tok));
    if (!dex || dex > maxDex) return { dexId: [], problem: `${quote(tok)} in "Pokémon on the card" is not a Pokémon or a Pokédex number.` };
    ids.add(dex);
  }
  return { dexId: [...ids].sort((a, b) => a - b) };
}

/** The proof link, if it is an https page on an allowed site. */
export function checkProof(answer) {
  const s = cleanText(answer);
  let u = null;
  try { u = new URL(s); } catch { /* not a URL */ }
  const host = u?.hostname.toLowerCase().replace(/\.$/, '') || '';
  const ok = u && u.protocol === 'https:' && !u.username && !u.password && !u.port
    && PROOF_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
  if (!ok) {
    return { problem: `The proof link ${quote(s)} must be an https page on one of: ${PROOF_HOSTS.join(', ')}.` };
  }
  return { source: u.href };
}

/**
 * Check one report against our data, and build its override row.
 * @param {Record<string,string>} values  parseIssueForm's answers
 * @param {object} ctx
 *   issue       the issue number
 *   sets        data/sets.json;  jpSets  data/jp-cat/sets.json's `sets`
 *   numbersFor  (lang, set) → the numbers that set's card list has
 *   dexByName   Map English Pokémon name → Pokédex number
 *   overrides   the override rows already committed
 * @returns {{ ok: true, row, changed: boolean, setName: string }
 *         | { ok: false, problems: string[] }}
 */
export function checkReport(values, { issue, sets, jpSets, numbersFor = () => [], dexByName = new Map(), overrides = [] } = {}) {
  const problems = [];
  const lang = resolveLang(values.lang);
  if (!lang) return { ok: false, problems: [`${quote(values.lang)} is not one of the form's languages.`] };

  const where = resolveSet(lang, values.set, { sets, jpSets });
  if (where.problem) problems.push(where.problem);

  const name = cleanText(values.name);
  if (!name || name.length > FIELD_MAX.name || !NAME_RE.test(name) || !/\p{L}/u.test(name)) {
    problems.push(`The card name ${quote(name)} has characters a card name does not use. Give it as printed, in English for Japanese cards.`);
  }
  const proof = checkProof(values.proof);
  if (proof.problem) problems.push(proof.problem);
  const dex = resolveDex(name, values.dex, dexByName);
  if (dex.problem) problems.push(dex.problem);

  let number;
  if (!where.problem) {
    const listed = numbersFor(lang, where.set) || [];
    const n = normaliseNumber(lang, values.number, { listed, size: where.size });
    if (n.problem) problems.push(n.problem);
    else {
      number = n.number;
      const key = numberKey(lang, number);
      const same = listed.find(l => numberKey(lang, l) === key);
      if (same) problems.push(`${langLabel(lang)} ${quote(where.set)} already lists card ${quote(same)}, so it is not missing. If the tracker still does not show it, say where you looked in a comment.`);
      const dup = overrides.find(r => cardKey(r.lang, r.set, r.number) === cardKey(lang, where.set, number) && r.issue !== issue);
      if (dup) problems.push(`This card was already reported in #${dup.issue}.`);
    }
  }
  if (problems.length) return { ok: false, problems };

  const row = { lang, set: where.set, number, name };
  if (dex.dexId.length) row.dexId = dex.dexId;
  row.source = proof.source;
  row.issue = issue;
  const before = overrides.find(r => r.issue === issue);
  const changed = !before || rowJson(before) !== rowJson(row);
  return { ok: true, row, changed, setName: where.setName || where.set };
}

// ── The file ──────────────────────────────────────────────────────────────────

const KEYS = ['lang', 'set', 'number', 'name', 'dexId', 'source', 'issue'];

/** One row as one line of JSON, keys always in the same order. */
export function rowJson(r) {
  const o = {};
  for (const k of KEYS) {
    if (r[k] === undefined || (k === 'dexId' && !r.dexId?.length)) continue;
    o[k] = r[k];
  }
  return JSON.stringify(o);
}

/** Rows by language (the app's order), set, number, issue. */
export function sortOverrides(rows) {
  const li = l => OVERRIDE_LANGS.indexOf(l);
  return [...rows].sort((a, b) => li(a.lang) - li(b.lang)
    || (a.set < b.set ? -1 : a.set > b.set ? 1 : 0)
    || naturalCompare(a.number, b.number)
    || a.issue - b.issue);
}

/** The file's text: one row per line, sorted, so a report's PR is a one-line diff. */
export function formatOverrides(rows) {
  const lines = sortOverrides(rows).map(rowJson);
  const list = lines.length ? `\n    ${lines.join(',\n    ')}\n  ` : '';
  return `{\n  "schemaVersion": 1,\n  "overrides": [${list}]\n}\n`;
}

/** The rows with `row` in place of any earlier one from the same issue. */
export function upsertOverride(rows, row) {
  return sortOverrides([...rows.filter(r => r.issue !== row.issue), row]);
}

export { readOverrides };

// ── Pruning ───────────────────────────────────────────────────────────────────

/**
 * Split the rows into those still needed and those a source now lists.
 * @param {(lang:string, set:string) => string[]|null} numbersFor  the set's listed
 *   numbers; null when that language's list could not be read, which keeps its rows
 */
export function pruneOverrides(rows, numbersFor) {
  const keep = [], dropped = [];
  for (const r of rows) {
    const listed = numbersFor(r.lang, r.set);
    const key = numberKey(r.lang, r.number);
    if (listed && listed.some(n => numberKey(r.lang, n) === key)) dropped.push(r);
    else keep.push(r);
  }
  return { keep, dropped };
}

/** set → numbers, from catalogue rows ([set, number, …], data/cat/ and data/jp-cat/). */
export function numbersBySet(rows) {
  const map = new Map();
  for (const r of rows || []) {
    if (!Array.isArray(r) || typeof r[0] !== 'string' || r[1] == null || r[1] === '') continue;
    if (!map.has(r[0])) map.set(r[0], new Set());
    map.get(r[0]).add(String(r[1]));
  }
  return new Map([...map].map(([k, v]) => [k, [...v]]));
}

// ── Text for GitHub ───────────────────────────────────────────────────────────

const SIGN_OFF = 'Edit the issue to fix it (the ⋯ menu → Edit) and it is checked again. If the card really is missing and the form cannot say it, explain in a comment and a maintainer will add it by hand.';

export function problemComment(problems) {
  return `Thanks for the report! It cannot become a pull request yet:\n\n${problems.map(p => `- ${p}`).join('\n')}\n\n${SIGN_OFF}\n`;
}

export function prTitle(row) {
  return `feat(overrides): add ${langLabel(row.lang)} card ${overrideId(row)}`;
}

export function commitMessage(row) {
  return `${prTitle(row)}\n\n- ${row.name}, reported in #${row.issue}\n- proof: ${row.source}\n`;
}

export function prBody(row, setName) {
  const dex = row.dexId?.length ? row.dexId.join(', ') : 'none';
  return [
    '## Summary',
    `Adds a card no source lists, reported in #${row.issue}.`,
    '',
    `- language: ${langLabel(row.lang)}`,
    `- set: ${quote(row.set)} (${quote(setName, 80)})`,
    `- number: ${quote(row.number)}`,
    `- name: ${quote(row.name, 80)}`,
    `- Pokédex numbers: ${dex}`,
    `- proof: <${row.source}>`,
    '',
    '## Changes',
    '- add one row to `data/overrides.json`',
    '',
    '## Testing',
    '- checked by `tools/missing-card.mjs`: the set exists, the number is plausible, no source lists the card, and the proof link is on an allowed site',
    '- please open the proof link before merging',
    '',
    `Closes #${row.issue}`,
    '',
  ].join('\n');
}

export function prunedComment(row, date) {
  const by = row.lang === 'ja' ? 'the Japanese card list' : `TCGdex's ${langLabel(row.lang)} card list`;
  return `${by} now has ${quote(row.set)} ${quote(row.number)}, so the hand-added entry for it was removed in the data refresh of ${date}. The card stays in the tracker. Thanks for reporting it!\n`;
}
