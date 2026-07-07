import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSessionPayload, decodeSession } from '../js/ui/session-codec.js';

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
