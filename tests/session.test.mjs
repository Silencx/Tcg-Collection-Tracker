import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeSessionPayload, decodeSession, safeSetId } from '../js/ui/session-codec.js';
import { APP_MODES, DEFAULT_MODE, isValidMode } from '../js/config.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('round-trips a settings object', () => {
  const payload = { v: 1, mode: 'tms', msf: ['EN', 'JP'], pokes: ['Seedot', 'Nuzleaf'], sort: 'd', pal: 'palette-ocean' };
  const encoded = encodeSessionPayload(payload);
  assert.deepEqual(decodeSession(encoded), payload);
});

test('encoded output is base64url-safe (no +, /, or = padding)', () => {
  // A payload whose JSON/base64 form is virtually guaranteed to contain +, / and
  // = when standard-base64 encoded, to actually exercise the url-safe replacement.
  const payload = { pokes: Array.from({ length: 40 }, (_, i) => `Pokémon-${i}-☆`) };
  const encoded = encodeSessionPayload(payload);
  assert.equal(/[+/=]/.test(encoded), false, `expected no +, / or = in: ${encoded}`);
});

test('garbage input decodes to null instead of throwing', () => {
  assert.equal(decodeSession('not-valid-base64url!!'), null);
  assert.equal(decodeSession(''), null);
  assert.equal(decodeSession(undefined), null);
});

// ── modes through the codec ───────────────────────────────────────────────────
// There used to be TWO inline mode whitelists — state.js's boot read and io.js's
// applySession — and both coerced anything unrecognised to 'master'. A third mode
// therefore could not survive a reload OR a shared #s= link, silently. These tests
// pin the single source of truth and the round trip that used to drop it.
test('EVERY declared mode round-trips through the session codec', () => {
  for (const mode of APP_MODES) {
    const encoded = encodeSessionPayload({ v: 1, mode });
    assert.equal(decodeSession(encoded).mode, mode, `${mode} did not survive the codec`);
  }
});

test('isValidMode accepts exactly the declared modes', () => {
  for (const mode of APP_MODES) assert.equal(isValidMode(mode), true, mode);
  for (const bad of ['', 'Master', 'single', 'dashboard', null, undefined, 0, {}]) {
    assert.equal(isValidMode(bad), false, `accepted ${String(bad)}`);
  }
});

test('the default mode is one of the declared modes', () => {
  assert.equal(isValidMode(DEFAULT_MODE), true);
});

// ── set ids in shared links ───────────────────────────────────────────────────
// The first version of this regex had no hyphen, which silently dropped 29 of the 218
// EN set ids from every "#s=" link — all 20 Trainer Kits among them. It failed CLOSED
// (ssTarget became null), so nothing broke visibly; the set just was not there.
test('every shipped set id survives a shared link', () => {
  const ids = Object.keys(JSON.parse(readFileSync(resolve(ROOT, 'data/sets.json'), 'utf8')).names.en);
  const rejected = ids.filter((id) => !safeSetId(id));
  assert.deepEqual(rejected, [], 'these set ids would be dropped from a shared view link');
});

test('set ids that could escape a URL path are still rejected', () => {
  for (const bad of ['../x', 'a/b', '..', 'a//b', '<script>', 'javascript:alert(1)',
    '', ' ', '.leading', 'a'.repeat(40), null, undefined, 42, {}]) {
    assert.equal(safeSetId(bad), false, `accepted ${JSON.stringify(bad)}`);
  }
});

test('the shapes real set ids take are all accepted', () => {
  for (const good of ['sv05', 'base1', 'swsh12.5', 'tk-ex-latia', 'P-A', 'A1a', '2011bw', 'cel25cc']) {
    assert.equal(safeSetId(good), true, `rejected ${good}`);
  }
});

test('no module hard-codes a mode whitelist any more', () => {
  // The exact shape of the two whitelists that used to exist. A new one would
  // reintroduce the drift this test exists to prevent.
  const offenders = [];
  for (const rel of ['js/state.js', 'js/ui/io.js', 'js/main.js']) {
    const src = readFileSync(resolve(ROOT, rel), 'utf8')
      .replace(/\/\/[^\n]*/g, '')              // line comments quote the old code
      .replace(/\/\*[\s\S]*?\*\//g, '');
    if (/===\s*'tms'\s*\?\s*'tms'\s*:\s*'master'/.test(src)) offenders.push(`${rel}: ternary whitelist`);
    if (/mode\s*===\s*'master'\s*\|\|\s*.*===\s*'tms'/.test(src)) offenders.push(`${rel}: or-chain whitelist`);
  }
  assert.deepEqual(offenders, [], 'use isValidMode() from config.js instead');
});
