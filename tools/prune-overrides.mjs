#!/usr/bin/env node
// =============================================================================
// tools/prune-overrides.mjs — drop every override a source now lists.
//
// Run by the data refresh (.github/workflows/refresh-data.yml) after the card lists are
// rebuilt: a row of data/overrides.json whose language, set and number the committed
// list now has (data/cat/{lang}/, or data/jp-cat/ for Japanese) has done its job. Numbers
// compare without case or zero padding ("SWSH020" is "swsh20"). A language whose list
// cannot be read keeps all its rows. No requests; the file is rewritten only when a row
// goes.
//
//   node tools/prune-overrides.mjs                     # prune, log what went
//   node tools/prune-overrides.mjs --report <dir>      # ... and write <dir>/<issue>.md,
//                                                      # the comment for each report
// =============================================================================

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overrideId } from '../js/api/overrides-model.js';
import { pruneOverrides, formatOverrides, prunedComment } from './lib/overrides.mjs';
import { listedNumbers, readOverridesFile } from './lib/override-files.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const FILE = resolve(DATA, 'overrides.json');

function main() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--report');
  const reportDir = at >= 0 ? argv[at + 1] : null;
  if (at >= 0 && !reportDir) throw new Error('--report needs a directory');

  const { rows, malformed, exists } = readOverridesFile(FILE);
  if (!exists) { console.log('[overrides] no data/overrides.json; nothing to prune'); return; }
  // Rewriting the file would drop a malformed row unseen, so nothing is pruned until a
  // person fixes it.
  if (malformed) { console.warn(`[overrides] ${malformed} malformed row(s) the app skips; not pruning until they are fixed`); return; }

  const { keep, dropped } = pruneOverrides(rows, listedNumbers(DATA));
  console.log(`[overrides] ${rows.length} override(s); ${dropped.length} now listed upstream`);
  if (!dropped.length) return;
  for (const r of dropped) console.log(`[overrides]   dropped ${r.lang} ${overrideId(r)} (#${r.issue})`);
  writeFileSync(FILE, formatOverrides(keep));

  if (reportDir) {
    mkdirSync(reportDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    for (const r of dropped) writeFileSync(resolve(reportDir, `${r.issue}.md`), prunedComment(r, date));
  }
}

try {
  main();
} catch (err) {
  console.error(`[overrides] ${err.message}`);
  process.exit(1);
}
