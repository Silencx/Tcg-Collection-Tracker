// Walks js/**/*.js, tools/*.mjs and tools/lib/*.mjs, parses import/export statements
// with regexes (no parser dependency — Node built-ins only), and asserts every relative
// import resolves to an existing file and every named import is actually exported by
// its target.
//
// The tools matter as much as the app: the weekly build imports the browser's own
// modules (the tcgdex provider, bulba-jp, jp-model, local-images, config, slug), so a
// removal in js/ can break tools/build-*.mjs without touching a single app import.
// Only STATIC imports are checked — the probes' dynamic import() is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JS_DIR = resolve(ROOT, 'js');
const TOOLS_DIR = resolve(ROOT, 'tools');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

/** The .mjs files directly in `dir` (tools/ holds caches and reports deeper down). */
const mjsIn = dir => readdirSync(dir).filter(f => f.endsWith('.mjs')).map(f => resolve(dir, f));

const files = walk(JS_DIR).sort();
const toolFiles = [...mjsIn(TOOLS_DIR), ...mjsIn(resolve(TOOLS_DIR, 'lib'))].sort();

const sourceCache = new Map();
function source(file) {
  if (!sourceCache.has(file)) sourceCache.set(file, readFileSync(file, 'utf8'));
  return sourceCache.get(file);
}

// import {a, b as c} from '...'   |   import * as ns from '...'
const IMPORT_RE = /^import\s+(?:\*\s+as\s+\w+|\{([^}]*)\})\s+from\s+['"]([^'"]+)['"]/gm;
const EXPORT_FUNC_RE = /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_CONST_RE = /^export\s+const\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_CLASS_RE = /^export\s+class\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_GROUP_RE = /^export\s*\{([^}]*)\}/gm;

// "a" → {local:'a', exposed:'a'}; "a as b" → {local:'a', exposed:'b'}.
function parseSpecifiers(raw) {
  return raw.split(',').map(s => s.trim()).filter(Boolean).map(tok => {
    const m = tok.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
    return m ? { local: m[1], exposed: m[2] } : { local: tok, exposed: tok };
  });
}

function exportedNames(file) {
  const src = source(file);
  const names = new Set();
  for (const re of [EXPORT_FUNC_RE, EXPORT_CONST_RE, EXPORT_CLASS_RE]) {
    for (const m of src.matchAll(re)) names.add(m[1]);
  }
  for (const m of src.matchAll(EXPORT_GROUP_RE)) {
    for (const { exposed } of parseSpecifiers(m[1])) names.add(exposed);
  }
  return names;
}

test('every js/**/*.js file was discovered', () => {
  assert.ok(files.length > 0, 'expected to find at least one .js file under js/');
});

test('the build tools were discovered', () => {
  const rel = toolFiles.map(f => relative(ROOT, f).split(/[\\/]/).join('/'));
  for (const must of ['tools/build-data.mjs', 'tools/build-jp-catalog.mjs', 'tools/build-images.mjs', 'tools/lib/jp-keep.mjs']) {
    assert.ok(rel.includes(must), `${must} not found`);
  }
});

function importOffenders(list) {
  const offenders = [];
  for (const file of list) {
    const rel = relative(ROOT, file);
    for (const m of source(file).matchAll(IMPORT_RE)) {
      const [, namedRaw, specifier] = m;
      if (!specifier.startsWith('.')) continue; // this repo only ever uses relative imports
      const resolved = resolve(dirname(file), specifier);
      if (!existsSync(resolved) || !statSync(resolved).isFile()) {
        offenders.push(`${rel}: imports missing file "${specifier}"`);
        continue;
      }
      if (namedRaw) {
        const targetExports = exportedNames(resolved);
        for (const { local } of parseSpecifiers(namedRaw)) {
          if (!targetExports.has(local)) {
            offenders.push(`${rel}: imports "${local}" from "${specifier}", which does not export it`);
          }
        }
      }
    }
  }
  return offenders;
}

test('every relative import resolves to an existing file, and every named import is exported by its target', () => {
  const offenders = importOffenders(files);
  assert.equal(offenders.length, 0, `import graph errors:\n${offenders.join('\n')}`);
});

test('the same holds for the build tools, including what they import from js/', () => {
  const offenders = importOffenders(toolFiles);
  assert.equal(offenders.length, 0, `import graph errors:\n${offenders.join('\n')}`);
});
