// "Missing card" reports (tools/lib/overrides.mjs): reading the issue form, hostile input
// included, checking a report against our data, the override file, and pruning. Plus the
// two workflows that run it, scanned for the rules they must keep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  FORM_FIELDS, FORM_LANGS, cleanText, quote, parseIssueForm, resolveLang, resolveSet, normaliseNumber,
  resolveDex, checkProof, checkReport, rowJson, formatOverrides, upsertOverride, pruneOverrides,
  numbersBySet, problemComment, prBody, prTitle, commitMessage, prunedComment,
} from '../tools/lib/overrides.mjs';
import { readOverrides } from '../js/api/overrides-model.js';
import { dexByNameFrom } from '../js/api/match-model.js';

const DEX = dexByNameFrom([
  { name: 'Pikachu', dex: 25 }, { name: 'Mew', dex: 151 }, { name: 'Mewtwo', dex: 150 },
  { name: 'Zekrom', dex: 644 }, { name: 'Mr. Mime', dex: 122 }, { name: 'Ho-Oh', dex: 250 },
]);
const SETS = {
  names: {
    en: { swshp: 'SWSH Black Star Promos', svp: 'SVP Black Star Promos', base1: 'Base Set', swsh9: 'Brilliant Stars', A1: 'Genetic Apex', bw1: 'Black & White', bw1b: 'Black & White' },
    de: { svp: 'SVP Black Star Promos', swsh9: 'Strahlende Sterne' },
  },
  counts: { swshp: { official: 307, total: 307 }, svp: { official: 225, total: 226 }, base1: { official: 102, total: 102 }, swsh9: { official: 172, total: 216 } },
  setSeries: { A1: 'tcgp', swshp: 'swsh', svp: 'sv', base1: 'base', swsh9: 'swsh' },
  lang: { de: { counts: { svp: { official: 230, total: 230 } } } },
};
const JP_SETS = [
  { key: 'vstar-universe', code: 'S12a', name: 'VSTAR Universe', cards: 262 },
  { key: 'battle-academy-svi', code: 'svI', name: 'Battle Academy', cards: 74 },
  { key: 'battle-academy-sviba', code: 'svIba', name: 'Battle Academy', cards: 98 },
];
const LISTED = {
  'en|swshp': ['SWSH001', 'SWSH036', 'SWSH307'],
  'en|svp': ['001', '011', '201'],
  'de|svp': ['001', '022', '025'],
  'en|base1': ['1', '7', '102'],
  'en|swsh9': ['1', '172', 'TG01', 'TG30'],
  'ja|vstar-universe': ['001/172', '262/172'],
};
const numbersFor = (lang, set) => LISTED[`${lang}|${set}`] || [];

function body(v) {
  const answers = { lang: 'English', set: 'swshp', number: '20', name: 'Pikachu', dex: '', proof: 'https://pkmncards.com/card/x', ...v };
  return FORM_FIELDS.map(f => `### ${f.label}\n\n${answers[f.id] || '_No response_'}\n`).join('\n');
}
const ctx = (o = {}) => ({ issue: 9, sets: SETS, jpSets: JP_SETS, numbersFor, dexByName: DEX, overrides: [], ...o });
const check = (v, o) => checkReport(parseIssueForm(body(v)).values, ctx(o));

// ── The form ──────────────────────────────────────────────────────────────────

test('the form is read field by field, empty optional answers as empty', () => {
  const { values, problems } = parseIssueForm(body({ dex: '' }));
  assert.deepEqual(problems, []);
  assert.deepEqual(values, { lang: 'English', set: 'swshp', number: '20', name: 'Pikachu', dex: '', proof: 'https://pkmncards.com/card/x' });
  // Windows line endings, extra blank lines, a heading GitHub never writes.
  const crlf = `${body({}).replace(/\n/g, '\r\n')}\r\n### Something else\r\n\r\nignored`;
  assert.deepEqual(parseIssueForm(crlf).values, values);
});

test('hostile issue bodies are refused or cleaned, never trusted', () => {
  for (const b of [undefined, null, 42, '', '   ', 'just some text']) {
    assert.ok(parseIssueForm(b).problems.length, String(b));
  }
  assert.match(parseIssueForm('x'.repeat(20001)).problems[0], /too long/);
  // A second "### Set" written into the body is ambiguous, not a second chance.
  const twice = `${body({})}\n### Set\n\nbase1\n`;
  assert.match(parseIssueForm(twice).problems.join(' '), /"Set" appears more than once/);
  // Control, zero-width and right-to-left characters become spaces; lines join.
  assert.equal(cleanText('Pika\u200Bchu\u202E\u0000 V\n\nline'), 'Pika chu V line');
  assert.equal(cleanText('Pi\u00ADka\uFEFFchu'), 'Pi ka chu');
  const over = parseIssueForm(body({ name: 'P'.repeat(81) }));
  assert.match(over.problems.join(' '), /"Card name" is longer than 80/);
  const missing = parseIssueForm(body({ proof: '' }));
  assert.match(missing.problems.join(' '), /"Proof link" is empty/);
});

test('a quoted value cannot break out of its code span', () => {
  assert.equal(quote('a`b'), "`a'b`");
  assert.equal(quote('x'.repeat(100), 10), `\`${'x'.repeat(10)}…\``);
  assert.equal(quote('two\nlines'), '`two lines`');
});

// ── Checking ──────────────────────────────────────────────────────────────────

test('languages by label or code; sets by id, name or English name', () => {
  assert.equal(resolveLang('German'), 'de');
  assert.equal(resolveLang('traditional chinese (tw/hk)'), 'zh-Hant');
  assert.equal(resolveLang('ja'), 'ja');
  assert.equal(resolveLang('Klingon'), null);
  assert.equal(resolveSet('en', 'SWSHP', { sets: SETS }).set, 'swshp');
  assert.equal(resolveSet('en', 'swsh black star promos', { sets: SETS }).set, 'swshp');
  assert.equal(resolveSet('de', 'Strahlende Sterne', { sets: SETS }).set, 'swsh9');
  assert.equal(resolveSet('de', 'Brilliant Stars', { sets: SETS }).set, 'swsh9', 'the English name of a set the language has');
  assert.equal(resolveSet('de', 'svp', { sets: SETS }).size, 230, "the language's own count");
  assert.match(resolveSet('de', 'Base Set', { sets: SETS }).problem, /no German set/);
  assert.match(resolveSet('en', 'Genetic Apex', { sets: SETS }).problem, /no English set/, 'TCG Pocket is not tracked');
  assert.match(resolveSet('en', 'Black & White', { sets: SETS }).problem, /More than one English set.*`bw1`, `bw1b`/);
  assert.equal(resolveSet('ja', 'S12A', { jpSets: JP_SETS }).set, 'vstar-universe');
  assert.equal(resolveSet('ja', 'vstar universe', { jpSets: JP_SETS }).set, 'vstar-universe');
  assert.equal(resolveSet('ja', 'battle-academy-svi', { jpSets: JP_SETS }).set, 'battle-academy-svi');
  assert.match(resolveSet('ja', 'Battle Academy', { jpSets: JP_SETS }).problem, /More than one Japanese set/);
});

test("numbers take the set's own prefix and padding", () => {
  const n = (lang, a, set, size = 0) => normaliseNumber(lang, a, { listed: numbersFor(lang, set), size });
  assert.equal(n('en', '20', 'swshp').number, 'SWSH020');
  assert.equal(n('en', 'swsh 20', 'swshp').number, 'SWSH020');
  assert.equal(n('en', '#7', 'svp').number, '007');
  assert.equal(n('en', '007', 'base1').number, '7');
  assert.equal(n('en', '163/198', 'base1', 102).number, '163');
  assert.equal(n('en', 'tg5', 'swsh9').number, 'TG05');
  assert.equal(n('en', '173', 'swsh9', 216).number, '173');
  assert.equal(n('en', '12', 'nothing-listed').number, '12');
  assert.equal(n('ja', '263/172', 'vstar-universe', 262).number, '263/172');
  assert.equal(n('ja', '001/sv-p', 'x').number, '001/SV-P');
});

test('implausible numbers are refused', () => {
  const n = (lang, a, set, size = 0) => normaliseNumber(lang, a, { listed: numbersFor(lang, set), size });
  assert.match(n('en', '0', 'base1', 102).problem, /not a plausible number/);
  assert.match(n('en', '999', 'base1', 102).problem, /about 102 cards/);
  assert.ok(n('en', '204', 'base1', 102).number, 'up to twice the set');
  assert.match(n('en', 'SWSH999', 'swshp').problem, /not a plausible number/);
  for (const bad of ['', '1 2 3', '12345', '../1', '1;rm', 'abc1234567', '$(x)', '1/2/3']) {
    assert.ok(n('en', bad, 'base1', 102).problem, bad);
  }
  assert.ok(n('ja', '1/<b>', 'vstar-universe', 262).problem);
});

test('proof links must be https pages on an allowed site', () => {
  assert.equal(checkProof('https://bulbapedia.bulbagarden.net/wiki/Pikachu_(SWSH_Promo_20)').source,
    'https://bulbapedia.bulbagarden.net/wiki/Pikachu_(SWSH_Promo_20)');
  assert.ok(checkProof('https://www.pokemon-card.com/card-search/').source, 'a subdomain');
  for (const bad of [
    'http://pkmncards.com/x', 'javascript:alert(1)', 'pkmncards.com/x', 'https://evil.example/pkmncards.com',
    'https://pkmncards.com@evil.example/', 'https://user:pw@pkmncards.com/', 'https://pkmncards.com.evil.example/',
    'https://notpkmncards.com/', 'https://pkmncards.com:8443/', 'https://xn--pkmncrds-5ya.com/', '',
  ]) {
    assert.ok(checkProof(bad).problem, bad);
  }
});

test('Pokédex numbers from the name, plus any the report lists', () => {
  assert.deepEqual(resolveDex('Pikachu & Zekrom-GX', '', DEX).dexId, [25, 644]);
  assert.deepEqual(resolveDex('Mewtwo', '', DEX).dexId, [150], 'Mewtwo is not Mew');
  assert.deepEqual(resolveDex('Surfing Friends', 'pikachu, #644', DEX).dexId, [25, 644]);
  assert.deepEqual(resolveDex('Imposter Professor Oak', 'mr mime', DEX).dexId, [122]);
  assert.match(resolveDex('Pikachu', '9999', DEX).problem, /not a Pokémon/);
  assert.match(resolveDex('Pikachu', 'Agumon', DEX).problem, /not a Pokémon/);
});

test('a good report becomes a row; a listed or already-reported card does not', () => {
  const ok = check({});
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.row, { lang: 'en', set: 'swshp', number: 'SWSH020', name: 'Pikachu', dexId: [25], source: 'https://pkmncards.com/card/x', issue: 9 });
  assert.equal(ok.changed, true);
  assert.equal(ok.setName, 'SWSH Black Star Promos');

  assert.match(check({ number: '36' }).problems[0], /already lists card `SWSH036`/);
  assert.match(check({ lang: 'German', set: 'svp', number: '25' }).problems[0], /already lists card `025`/);
  assert.match(check({ lang: 'Japanese', set: 'S12a', number: '1' }).problems[0], /already lists card `001\/172`/);

  const other = { ...ok.row, issue: 4 };
  assert.match(check({}, { overrides: [other] }).problems[0], /already reported in #4/);
  // The same report, checked again after an edit: nothing new, or a changed row.
  assert.equal(check({}, { overrides: [ok.row] }).changed, false);
  assert.equal(check({ name: 'Pikachu V' }, { overrides: [ok.row] }).changed, true);
});

test('every problem is reported at once, with hostile values quoted', () => {
  const res = check({ lang: 'English', set: 'base1', number: '999', name: 'Pika`$(id)` @owner', dex: '9999', proof: 'http://x' });
  assert.equal(res.ok, false);
  assert.equal(res.problems.length, 4);
  const text = problemComment(res.problems);
  // Outside code spans: no backtick from the reporter, no mention, no HTML.
  const outside = text.replace(/`[^`\n]*`/g, '');
  assert.doesNotMatch(outside, /@owner|\$\(id\)|`/);
});

test('card names keep their punctuation and refuse markup', () => {
  for (const good of ["Team Rocket's Mewtwo ex", 'Professor’s Research (Professor Oak)', 'Pikachu & Zekrom-GX',
    'Nidoran ♀', 'Mewtwo ☆', 'Type: Null', 'Unown [A]', 'Flabébé', 'Mr. Mime', 'ピカチュウ']) {
    const res = check({ name: good, number: '21' });
    assert.ok(!res.problems?.some(p => /characters a card name/.test(p)), good);
  }
  for (const bad of ['<script>', 'Pika|chu', '`x`', '@someone', '{{x}}', '$HOME', '123', 'a\\b']) {
    assert.match(check({ name: bad, number: '21' }).problems.join(' '), /characters a card name/, bad);
  }
});

// ── The file ──────────────────────────────────────────────────────────────────

test('the file is one sorted row per line, and an edit replaces its own row', () => {
  assert.equal(formatOverrides([]), '{\n  "schemaVersion": 1,\n  "overrides": []\n}\n');
  const a = { lang: 'ja', set: 'vstar-universe', number: '263/172', name: 'Pikachu VMAX', dexId: [25], source: 'https://x', issue: 3 };
  const b = { lang: 'en', set: 'swshp', number: 'SWSH020', name: 'Pikachu', source: 'https://y', issue: 1 };
  const c = { lang: 'en', set: 'swshp', number: 'SWSH3', name: 'Mew', source: 'https://z', issue: 2 };
  const text = formatOverrides([a, b, c]);
  assert.deepEqual(text.split('\n').slice(3, 6).map(l => JSON.parse(l.trim().replace(/,$/, '')).issue), [2, 1, 3],
    'English before Japanese; SWSH3 before SWSH020');
  assert.deepEqual(readOverrides(JSON.parse(text)).length, 3);
  assert.equal(rowJson({ issue: 1, name: 'x', lang: 'en', dexId: [] }), '{"lang":"en","name":"x","issue":1}');
  const edited = upsertOverride([a, b, c], { ...b, name: 'Pikachu V' });
  assert.equal(edited.length, 3);
  assert.equal(edited.find(r => r.issue === 1).name, 'Pikachu V');
});

test('a row leaves once its set lists the card; a language we cannot read keeps its rows', () => {
  const rows = [
    { lang: 'en', set: 'swshp', number: 'SWSH020', name: 'Pikachu', source: '', issue: 1 },
    { lang: 'de', set: 'svp', number: '023', name: 'Pikachu', source: '', issue: 2 },
    { lang: 'ja', set: 'vstar-universe', number: '263/172', name: 'Pikachu VMAX', source: '', issue: 3 },
    { lang: 'th', set: 'x', number: '1', name: 'Pikachu', source: '', issue: 4 },
  ];
  const listed = { 'en|swshp': ['SWSH20'], 'de|svp': ['022'], 'ja|vstar-universe': ['263/172'] };
  const { keep, dropped } = pruneOverrides(rows, (lang, set) => (lang === 'th' ? null : listed[`${lang}|${set}`] || []));
  assert.deepEqual(dropped.map(r => r.issue), [1, 3]);
  assert.deepEqual(keep.map(r => r.issue), [2, 4]);
  assert.deepEqual(numbersBySet([['a', '1'], ['a', '1'], ['a', '2'], ['b', null], 'x', ['c', '']]), new Map([['a', ['1', '2']]]));
});

test('the pull request and the comments name the report and quote safely', () => {
  const r = { lang: 'de', set: 'svp', number: '023', name: 'Pikachu', dexId: [25], source: 'https://www.pokemon.com/de/x', issue: 21 };
  assert.equal(prTitle(r), 'feat(overrides): add German card svp-023');
  assert.match(commitMessage(r), /^feat\(overrides\): add German card svp-023\n\n- Pikachu, reported in #21\n/);
  const pr = prBody(r, 'SVP Black Star Promos');
  assert.match(pr, /^## Summary\n/);
  assert.match(pr, /\nCloses #21\n/);
  assert.match(pr, /- proof: <https:\/\/www\.pokemon\.com\/de\/x>/);
  assert.match(prunedComment(r, '2026-11-30'), /`svp` `023`.*2026-11-30/);
});

// ── The form file and the workflows ───────────────────────────────────────────

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');

test('the issue form has exactly the fields and languages the parser reads', () => {
  const yml = read('.github/ISSUE_TEMPLATE/missing-card.yml');
  const labels = [...yml.matchAll(/^ {6}label: (.+)$/gm)].map(m => m[1]);
  assert.deepEqual(labels, FORM_FIELDS.map(f => f.label));
  const options = [...yml.matchAll(/^ {8}- (.+)$/gm)].map(m => m[1]);
  assert.deepEqual(options, FORM_LANGS.map(l => l.label));
  assert.match(yml, /^labels: \["missing-card"\]$/m);
  assert.match(yml, /^title: "\[Missing card\]: "$/m);
});

/** Every `run:` script of a workflow, as text. */
function runBlocks(yml) {
  const out = [];
  const lines = yml.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:- )?run: ?(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (!/^[|>]/.test(m[2])) { out.push(m[2]); continue; }
    const indent = m[1].length;
    const block = [];
    for (i++; i < lines.length && (!lines[i].trim() || lines[i].search(/\S/) > indent); i++) block.push(lines[i]);
    i--;
    out.push(block.join('\n'));
  }
  return out;
}

test('no workflow pastes event text into a shell script', () => {
  const dir = new URL('.github/workflows/', root);
  for (const f of readdirSync(dir).filter(f => f.endsWith('.yml'))) {
    for (const script of runBlocks(read(`.github/workflows/${f}`))) {
      assert.doesNotMatch(script, /\$\{\{\s*(github\.event|github\.head_ref|inputs\.)/, `${f}: ${script.slice(0, 80)}`);
    }
  }
});

test('the report workflow starts with no permissions and pushes only its own branch', () => {
  const yml = read('.github/workflows/missing-card.yml');
  assert.match(yml, /^permissions: \{\}$/m);
  assert.match(yml, /ISSUE_BODY: \$\{\{ github\.event\.issue\.body \}\}/, 'the body arrives as an environment variable');
  const pushes = runBlocks(yml).join('\n').split('\n').filter(l => /git push/.test(l));
  assert.deepEqual(pushes.map(l => l.trim()), ['git push --force origin "HEAD:refs/heads/$branch"']);
  assert.match(yml, /branch="missing-card\/issue-\$ISSUE_NUMBER"/);
  assert.doesNotMatch(yml, /pull_request_target|workflow_run/);
});
