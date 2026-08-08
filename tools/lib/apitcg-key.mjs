// =============================================================================
// tools/lib/apitcg-key.mjs — resolve the API TCG key for BUILD-TIME use only.
//
// The key must never reach the browser. This app is static files on GitHub Pages, so
// anything shipped in js/ is readable by anyone who views source; API TCG is therefore
// only ever called from tools/, and only ever from CI or a local build.
//
// Two sources, in order:
//   1. process.env.APITCG_KEY   — how the GitHub Action supplies it (repo secret)
//   2. .env.local               — how a local build supplies it; gitignored
//
// Returns null when neither is present. Callers MUST treat that as "skip the API",
// never as an error: a fork, a CI run on a PR from outside the repo, or a contributor
// without a key all need `npm run build-data` to keep working.
//
// This module never logs, prints or embeds the key — not in errors either. The file it
// reads is also blocked from the assistant by .claude/hooks/block-secrets*.mjs.
// =============================================================================

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV_FILE = resolve(ROOT, '.env.local');

/**
 * Pull one KEY=VALUE out of dotenv-style text. Pure and exported so tests can cover the
 * parsing without a real .env.local existing — the actual file is unreadable to tooling
 * and to the assistant by design, so it can never be the thing under test.
 */
export function parseEnvValue(text, name) {
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() !== name) continue;
    // Strip one layer of matching quotes, which people add out of habit.
    const value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    return value || null;
  }
  return null;
}

function fromEnvFile(name) {
  if (!existsSync(ENV_FILE)) return null;
  try {
    return parseEnvValue(readFileSync(ENV_FILE, 'utf8'), name);
  } catch {
    return null;   // unreadable is the same as absent — never surface the file's contents
  }
}

/** @returns {string|null} the key, or null when it is not configured. */
export function loadApiTcgKey() {
  const fromEnv = (process.env.APITCG_KEY || '').trim();
  if (fromEnv) return fromEnv;
  return fromEnvFile('APITCG_KEY');
}

/** Where a human should put the key. Safe to print — names the file, never its contents. */
export const KEY_HELP =
  'Set APITCG_KEY in .env.local (gitignored) for local builds, or as the APITCG_KEY ' +
  'repository secret for CI. Without it, API TCG steps are skipped.';
