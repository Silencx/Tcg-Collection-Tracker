#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import { scanRepo } from './state-prefix-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function findFiles(dir, ext) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...findFiles(full, ext));
    } else if (entry.endsWith(ext)) {
      files.push(full);
    }
  }
  return files;
}

// tools/ is SCANNED rather than listed. It used to name tools/build-data.mjs alone, so
// every script added here since then silently escaped the syntax check — including this
// one. A scan cannot go stale.
const targets = [
  ...findFiles(resolve(ROOT, 'js'), '.js'),
  ...findFiles(resolve(ROOT, 'tools'), '.mjs'),
].sort();

let failures = 0;
for (const file of targets) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) {
    failures++;
    console.error(`[check] FAILED: ${relative(ROOT, file)}`);
  }
}

if (failures > 0) {
  console.error(`[check] ${failures}/${targets.length} file(s) failed`);
  process.exit(1);
}

console.log(`[check] ${targets.length}/${targets.length} files passed syntax check`);

// `node --check` only proves the file parses. A bare `activeLangs` where
// `state.activeLangs` was meant parses fine and throws at runtime, so scan for
// that separately — see tools/state-prefix-scan.mjs.
const scan = scanRepo(ROOT);
for (const { file, name } of scan.suppressed) {
  console.log(`[check] note: "${name}" is bound locally in ${file}; not scanned there`);
}
if (scan.findings.length > 0) {
  for (const f of scan.findings) {
    console.error(`[check] FAILED: ${f.file}:${f.line}:${f.column} — "${f.name}" used bare; did you mean state.${f.name}?`);
    console.error(`          ${f.text}`);
  }
  console.error(`[check] ${scan.findings.length} missing "state." prefix(es)`);
  process.exit(1);
}

console.log(`[check] ${scan.files} files clean of bare state references (${scan.keys.length} state keys)`);
