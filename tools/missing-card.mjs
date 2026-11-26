#!/usr/bin/env node
// =============================================================================
// tools/missing-card.mjs — check one "Missing card" issue and turn it into an override.
//
// Run by .github/workflows/missing-card.yml for every opened or edited report. It reads
// the issue body from the ISSUE_BODY environment variable (never from the command line,
// where a shell would see it) and checks it against the committed data (tools/lib/
// overrides.mjs): the set exists in that language, the number is plausible, no source
// lists the card already, the proof link is on an allowed site.
//
//   valid    → data/overrides.json gains (or updates) the issue's row, and the workflow
//              opens a pull request from the files written to --out;
//   invalid  → --out gets the comment that says what to fix; data/ is not touched.
// Exit code 0 either way; anything else is a fault in this script or the data.
//
//   ISSUE_NUMBER=12 ISSUE_BODY="$(cat body.md)" node tools/missing-card.mjs --out tmp/mc
//   node tools/missing-card.mjs --issue 12 --body-file body.md --out tmp/mc --dry-run
//
// Writes to --out: result.json, and comment.md (invalid) or title.txt, pr-body.md and
// commit-msg.txt (valid). With GITHUB_OUTPUT set, also `valid` and `changed`.
// =============================================================================

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSpeciesFile } from '../js/api/species-model.js';
import { dexByNameFrom } from '../js/api/match-model.js';
import { overrideId } from '../js/api/overrides-model.js';
import {
  parseIssueForm, resolveLang, checkReport, upsertOverride, formatOverrides,
  problemComment, prTitle, prBody, commitMessage,
} from './lib/overrides.mjs';
import { listedNumbers, readOverridesFile } from './lib/override-files.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const OVERRIDES = resolve(DATA, 'overrides.json');

function parseArgs(argv) {
  const o = { out: null, issue: null, bodyFile: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = argv[++i];
    else if (a === '--issue') o.issue = argv[++i];
    else if (a === '--body-file') o.bodyFile = argv[++i];
    else if (a === '--dry-run') o.dryRun = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.out) throw new Error('--out <dir> is required');
  return o;
}

const readJSON = p => JSON.parse(readFileSync(p, 'utf8'));

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const issueText = String(opts.issue ?? process.env.ISSUE_NUMBER ?? '');
  if (!/^\d{1,9}$/.test(issueText) || Number(issueText) < 1) throw new Error('the issue number must be a positive integer');
  const issue = Number(issueText);
  const body = opts.bodyFile ? readFileSync(opts.bodyFile, 'utf8') : process.env.ISSUE_BODY ?? '';

  const { rows: overrides } = readOverridesFile(OVERRIDES);
  const parsed = parseIssueForm(body);
  let result = { ok: false, problems: parsed.problems };
  if (!parsed.problems.length) {
    const lang = resolveLang(parsed.values.lang);
    const numbers = listedNumbers(DATA);
    // A report is only checked against a list we have: without one, "not listed yet"
    // cannot be told apart from "this script could not look".
    if (lang && numbers(lang, '') === null) throw new Error(`no committed card list for ${lang}`);
    result = checkReport(parsed.values, {
      issue,
      sets: readJSON(resolve(DATA, 'sets.json')),
      jpSets: readJSON(resolve(DATA, 'jp-cat', 'sets.json')).sets || [],
      numbersFor: numbers,
      dexByName: dexByNameFrom(readSpeciesFile(readJSON(resolve(DATA, 'species.json')))?.catalog),
      overrides,
    });
  }

  const out = resolve(opts.out);
  mkdirSync(out, { recursive: true });
  const outputs = {};
  if (!result.ok) {
    writeFileSync(resolve(out, 'comment.md'), problemComment(result.problems));
    outputs.valid = 'false';
    outputs.changed = 'false';
    console.log(`[missing-card] #${issue}: needs info (${result.problems.length} problem(s))`);
  } else {
    if (result.changed && !opts.dryRun) writeFileSync(OVERRIDES, formatOverrides(upsertOverride(overrides, result.row)));
    writeFileSync(resolve(out, 'title.txt'), `${prTitle(result.row)}\n`);
    writeFileSync(resolve(out, 'pr-body.md'), prBody(result.row, result.setName));
    writeFileSync(resolve(out, 'commit-msg.txt'), commitMessage(result.row));
    outputs.valid = 'true';
    outputs.changed = String(result.changed);
    console.log(`[missing-card] #${issue}: valid, ${result.row.lang} ${overrideId(result.row)}${result.changed ? '' : ' (already in data/overrides.json)'}${opts.dryRun ? ' (dry run)' : ''}`);
  }
  writeFileSync(resolve(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([k, v]) => `${k}=${v}\n`).join(''));
  }
}

try {
  main();
} catch (err) {
  console.error(`[missing-card] ${err.message}`);
  process.exit(1);
}
