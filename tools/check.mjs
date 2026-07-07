#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function findJsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...findJsFiles(full));
    } else if (entry.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

const targets = [
  ...findJsFiles(resolve(ROOT, 'js')),
  resolve(ROOT, 'tools/build-data.mjs'),
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
