// =============================================================================
// tools/lib/env-key.mjs — resolve a build-time API key (POKEWALLET_IO_PROD_KEY for the
// catalogue, image and probe tools; APITCG_KEY for tools/apitcg-probe.mjs).
//
// Keys must never reach the browser. This app is static files on GitHub Pages, so
// anything shipped in js/ is readable by anyone who views source; keyed APIs are
// therefore only ever called from tools/, from CI or a local build.
//
// Two sources, in order:
//   1. process.env[name]   — how a GitHub Action supplies it (repo secret)
//   2. .env.local          — how a local build supplies it; gitignored
//
// Returns null when neither is present. Callers MUST treat that as "skip the API",
// never as an error: a fork, a CI run on a PR from outside the repo, or a contributor
// without a key all need the build to keep working.
//
// This module never logs, prints or embeds a key — not in errors either.
// =============================================================================

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV_FILE = resolve(ROOT, '.env.local');

/**
 * Pull one KEY=VALUE out of dotenv-style text. Pure and exported so tests can cover the
 * parsing without a real .env.local existing — the actual file may or may not exist on a
 * given machine, so it can never be the thing under test.
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

/**
 * Any build-time key by name, from the same two places and in the same order: the process
 * environment (CI secret), then .env.local. Same contract — null when absent, never logged.
 * @returns {string|null}
 */
export function loadEnvKey(name) {
  const fromEnv = (process.env[name] || '').trim();
  if (fromEnv) return fromEnv;
  return fromEnvFile(name);
}

/** @returns {string|null} the API TCG key, or null when it is not configured. */
export function loadApiTcgKey() {
  return loadEnvKey('APITCG_KEY');
}

/** Where a human should put the API TCG key. Safe to print — names the file, never its contents. */
export const KEY_HELP =
  'Set APITCG_KEY in .env.local (gitignored) or in the environment. Only ' +
  'tools/apitcg-probe.mjs reads it; no build step or repository secret needs it.';
