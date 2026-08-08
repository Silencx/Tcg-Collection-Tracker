// Tests the guard from tools/state-prefix-scan.mjs — the scan that fails the
// build when a state property is used as a bare identifier instead of
// `state.<name>`. A guard that silently stops catching things is worse than no
// guard, so the synthetic snippets below pin down both halves: what it must
// flag, and what it must not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { blankNonCode, localBindings, readStateKeys, scanRepo, scanSource }
  from '../tools/state-prefix-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEYS = ['checked', 'activeLangs', 'tmsActiveLangs', '_meta', 'sortDesc', 'pokemonList'];

const names = src => scanSource(src, KEYS).findings.map(f => f.name);

test('the state key list is read from the state literal, not hardcoded', () => {
  const { keys, literalRange } = readStateKeys(readFileSync(resolve(ROOT, 'js/state.js'), 'utf8'));
  for (const expected of ['checked', 'activeLangs', 'tmsActiveLangs', '_meta', 'appMode']) {
    assert.ok(keys.includes(expected), `expected "${expected}" among the derived state keys`);
  }
  assert.ok(literalRange[1] > literalRange[0], 'the literal range should be non-empty');
});

test('flags a bare state reference', () => {
  const found = scanSource('function f(){ if (sortDesc) return 1; }', KEYS).findings;
  assert.deepEqual(found.map(f => f.name), ['sortDesc']);
  assert.equal(found[0].line, 1);
  assert.equal(found[0].text, 'function f(){ if (sortDesc) return 1; }');
});

// The four ReferenceErrors this guard exists for were ALL spreads. A scanner
// that skips everything after a "." looks correct and catches none of them.
test('flags a spread of a state key, which reads as "after a dot"', () => {
  assert.deepEqual(names('const a = [...checked];'), ['checked']);
  assert.deepEqual(names('state._tmsPopupActive = new Set([...tmsActiveLangs]);'), ['tmsActiveLangs']);
  assert.deepEqual(names('const overlap = [...activeLangs].filter(b => present.has(b));'), ['activeLangs']);
});

test('ignores property access, including the correctly prefixed form', () => {
  assert.deepEqual(names('const a = [...state.checked];'), []);
  assert.deepEqual(names('if (state.sortDesc) state._meta.clear();'), []);
  assert.deepEqual(names('cb.checked = true;'), []);
  assert.deepEqual(names('el?.checked;'), []);
});

test('ignores names that merely contain a state key', () => {
  assert.deepEqual(names('const unchecked = 1; let checkedCount = 2; foo.myactiveLangs;'), []);
});

test('ignores comments and string literals', () => {
  assert.deepEqual(names('// port checked → state.checked'), []);
  assert.deepEqual(names('/* activeLangs\n   sortDesc */'), []);
  assert.deepEqual(names("const s = 'checked';\nconst t = \"activeLangs\";"), []);
  assert.deepEqual(names('const u = `plain checked text`;'), []);
});

// masterset.js builds most of its DOM out of template literals, so an
// interpolation is exactly where a missing prefix is likely to hide.
test('still scans inside template-literal interpolations', () => {
  assert.deepEqual(names('el.innerHTML = `<b>${checked.size}</b>`;'), ['checked']);
  assert.deepEqual(names('el.innerHTML = `<b>${state.checked.size}</b>`;'), []);
  assert.deepEqual(names('el.innerHTML = `${a} ${`inner ${sortDesc}`}`;'), ['sortDesc']);
});

test('ignores a name that is bound locally in the same file', () => {
  const src = 'function finish(pokemonList) {\n  state.pokemonList = pokemonList;\n}';
  const result = scanSource(src, KEYS);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.suppressed, ['pokemonList']);
  assert.deepEqual(localBindings(src, KEYS), new Set(['pokemonList']));
  // …but only in the file that binds it.
  assert.deepEqual(names('savePoke(pokemonList);'), ['pokemonList']);
});

test('reports the file position of each hit', () => {
  const found = scanSource('const a = 1;\nconst b = [...checked];\n', KEYS).findings;
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 2);
  assert.equal(found[0].column, 'const b = [...'.length + 1);
});

test('blanking preserves source length and line structure', () => {
  const src = readFileSync(resolve(ROOT, 'js/ui/masterset.js'), 'utf8');
  const blanked = blankNonCode(src);
  assert.equal(blanked.length, src.length);
  assert.equal(blanked.split('\n').length, src.split('\n').length);
});

test('the repository itself is free of bare state references', () => {
  const { findings, files } = scanRepo(ROOT);
  const report = findings.map(f => `${f.file}:${f.line}:${f.column} "${f.name}" — ${f.text}`).join('\n');
  assert.equal(findings.length, 0, `missing "state." prefix:\n${report}`);
  assert.ok(files > 0, 'expected the scan to cover at least one file');
});
