// `.filter-pill` is a shared STYLE class, not an identity. Three independent pill
// sets carry it and all three are in the document at the same time:
//
//   Master sticky filter  → #filter-pills        (state.activeLangs)
//   TMS sticky filter     → #tms-filter-pills    (state.tmsActiveLangs)
//   TMS card popup        → #tms-popup-toolbar   (state._tmsPopupActive)
//
// applyModeUI only toggles their `display`; it never removes them. So a
// document-rooted `querySelectorAll('.filter-pill')` in any one of them repaints the
// other two from the wrong source of truth, and their pills then lie about the filter
// that is actually applied. Master's "Show All" shipped exactly that bug.
//
// Anchoring on `querySelector(` (rather than on the bare class name) is what keeps the
// construction sites out of the results — those assign `className='filter-pill'` and
// are legitimate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JS_DIR = resolve(ROOT, 'js');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

// querySelector('…') / querySelectorAll("…") / querySelectorAll(`…`)
const QUERY_RE = /query(?:Selector|SelectorAll)\(\s*(['"`])([^'"`]*)\1/g;
// A scoped selector leads with an id, e.g. "#filter-pills .filter-pill".
const SCOPED_RE = /^#[\w-]+[\s>]/;

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

test('every .filter-pill query is scoped to a pill container id', () => {
  const offenders = [];
  for (const file of walk(JS_DIR).sort()) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(QUERY_RE)) {
      const selector = m[2];
      if (!selector.includes('.filter-pill')) continue;
      if (SCOPED_RE.test(selector)) continue;
      offenders.push(`${relative(ROOT, file)}:${lineOf(src, m.index)}: unscoped "${selector}"`);
    }
  }
  assert.equal(
    offenders.length,
    0,
    `.filter-pill is shared by #filter-pills, #tms-filter-pills and #tms-popup-toolbar — ` +
    `these queries must name one of them:\n${offenders.join('\n')}`,
  );
});

test('the pill-scope guard actually matches an unscoped selector', () => {
  // Without this the test above passes vacuously if QUERY_RE ever stops matching.
  const sample = `document.querySelectorAll('.filter-pill').forEach(p=>p.remove());`;
  const found = [...sample.matchAll(QUERY_RE)].map(m => m[2]);
  assert.deepEqual(found, ['.filter-pill']);
  assert.equal(SCOPED_RE.test('.filter-pill'), false);
  assert.equal(SCOPED_RE.test('#filter-pills .filter-pill'), true);
  assert.equal(SCOPED_RE.test('#tms-filter-pills .filter-pill'), true);
});
