// The key file itself is deliberately unreadable (see .claude/hooks/block-secrets*.mjs)
// and may or may not exist on any given machine, so it can never be the thing under
// test. The PARSING is pure and exported, which is what these cover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvValue, loadApiTcgKey, KEY_HELP } from '../tools/lib/apitcg-key.mjs';

test('reads a plain KEY=VALUE line', () => {
  assert.equal(parseEnvValue('APITCG_KEY=abc123', 'APITCG_KEY'), 'abc123');
  assert.equal(parseEnvValue('  APITCG_KEY = abc123  ', 'APITCG_KEY'), 'abc123');
});

test('strips one layer of matching quotes', () => {
  assert.equal(parseEnvValue('APITCG_KEY="abc123"', 'APITCG_KEY'), 'abc123');
  assert.equal(parseEnvValue("APITCG_KEY='abc123'", 'APITCG_KEY'), 'abc123');
  // Mismatched quotes are left alone rather than half-stripped.
  assert.equal(parseEnvValue('APITCG_KEY="abc123', 'APITCG_KEY'), '"abc123');
});

test('ignores comments, blank lines and other keys', () => {
  const text = [
    '# a comment',
    '',
    'OTHER_KEY=nope',
    'APITCG_KEY=yes',
    'TRAILING=after',
  ].join('\n');
  assert.equal(parseEnvValue(text, 'APITCG_KEY'), 'yes');
  assert.equal(parseEnvValue(text, 'MISSING'), null);
});

test('a key that is present but empty counts as absent', () => {
  // Otherwise an empty value would be sent as a header and produce a confusing 401
  // rather than the intended "no key configured, skip the API" path.
  assert.equal(parseEnvValue('APITCG_KEY=', 'APITCG_KEY'), null);
  assert.equal(parseEnvValue('APITCG_KEY=""', 'APITCG_KEY'), null);
});

test('handles CRLF, which is what a Windows editor writes', () => {
  assert.equal(parseEnvValue('OTHER=1\r\nAPITCG_KEY=abc\r\n', 'APITCG_KEY'), 'abc');
});

test('a value containing = survives (base64 keys are padded with it)', () => {
  assert.equal(parseEnvValue('APITCG_KEY=ab=cd==', 'APITCG_KEY'), 'ab=cd==');
});

test('the environment variable wins over the file', () => {
  const prev = process.env.APITCG_KEY;
  try {
    process.env.APITCG_KEY = 'from-env';
    assert.equal(loadApiTcgKey(), 'from-env');
  } finally {
    if (prev === undefined) delete process.env.APITCG_KEY; else process.env.APITCG_KEY = prev;
  }
});

test('loadApiTcgKey returns null, never throws, when nothing is configured', () => {
  const prev = process.env.APITCG_KEY;
  try {
    delete process.env.APITCG_KEY;
    // May legitimately find a real .env.local on a configured machine; the contract is
    // only that it is a non-empty string or null, and that it never throws.
    const got = loadApiTcgKey();
    assert.ok(got === null || (typeof got === 'string' && got.length > 0));
  } finally {
    if (prev === undefined) delete process.env.APITCG_KEY; else process.env.APITCG_KEY = prev;
  }
});

test('the help text names the file but never implies a value', () => {
  assert.match(KEY_HELP, /\.env\.local/);
  assert.match(KEY_HELP, /secret/i);
});
