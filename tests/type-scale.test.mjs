// Font sizes were 79 hardcoded px values across 18 distinct sizes, so a phone and a 4K
// monitor got identical 7px badge text. They now come from a nine-step --fs-* scale of
// clamp()s, or — inside a card — from container units that track the tile.
//
// This guards the conversion from erosion: one `font-size:11px` added later is invisible
// in review and silently opts that element out of scaling.
//
// Two exemptions, both deliberate:
//   @media print   — a printed page is physical; px is the correct unit there.
//   the :root block — where the scale itself is defined.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(ROOT, 'css/style.css'), 'utf8');

const lineOf = (index) => css.slice(0, index).split('\n').length;

/** Brace-matched ranges of every `@media print { … }` block. */
function printRanges(text) {
  const out = [];
  for (const m of text.matchAll(/@media\s+print\s*\{/g)) {
    let i = m.index + m[0].length, depth = 1;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    }
    out.push([m.index, i]);
  }
  return out;
}

const PRINT = printRanges(css);
const inPrint = (i) => PRINT.some(([a, b]) => i >= a && i < b);

test('the nine scale steps are all defined', () => {
  for (const step of ['3xs', '2xs', 'xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl']) {
    assert.match(css, new RegExp(`--fs-${step}\\s*:\\s*clamp\\(`), `--fs-${step} missing or not a clamp()`);
  }
});

test('every scale step is expressed in rem, not px', () => {
  // A px clamp overrides the reader's browser font-size setting; a rem one scales with it.
  //
  // Checked per DECLARATION rather than over a span of the file: there are two token
  // blocks now (:root, and the tighter chrome ramp on .sticky-top) with unrelated CSS
  // between them, and a span-based match swept that up and failed on it.
  const decls = [...css.matchAll(/(--fs-[\w-]+)\s*:\s*([^;]+);/g)];
  assert.ok(decls.length >= 9, `expected at least the nine steps, found ${decls.length}`);
  const offenders = decls
    // Strip trailing comments — each step documents its px range in one, which is useful.
    .map(m => [m[1], m[2].replace(/\/\*[\s\S]*?\*\//g, '').trim()])
    .filter(([, value]) => /\dpx/.test(value))
    .map(([name, value]) => `  ${name}: ${value}`);
  assert.equal(offenders.length, 0, `scale steps must not contain px:\n${offenders.join('\n')}`);
});

test('the chrome ramp tops out lower than the content scale', () => {
  // The whole point of the .sticky-top block: if its ceilings ever drift up to match
  // :root's, the top bar silently starts growing with a 4K monitor again.
  const chrome = css.match(/\.sticky-top\{[\s\S]*?\n\}/);
  assert.ok(chrome, 'could not find the .sticky-top rule');
  const ceil = (block, step) => {
    const m = block.match(new RegExp(`--fs-${step}\\s*:\\s*clamp\\([^;]*?,\\s*([\\d.]+)rem\\s*\\)`));
    return m ? parseFloat(m[1]) : null;
  };
  // Several :root blocks exist (palettes, layout knobs); take the one holding the scale.
  const root = [...css.matchAll(/:root\{[\s\S]*?\n\}/g)].map(m => m[0]).find(b => b.includes('--fs-sm'));
  assert.ok(root, 'could not find the :root block containing the type scale');
  for (const step of ['sm', 'base', 'md', 'lg']) {
    const a = ceil(chrome[0], step), b = ceil(root, step);
    assert.ok(a !== null && b !== null, `--fs-${step} missing a clamp ceiling in one of the blocks`);
    assert.ok(a < b, `chrome --fs-${step} ceiling (${a}rem) must be below the content one (${b}rem)`);
  }
});

test('no bare px font-size outside @media print', () => {
  const offenders = [...css.matchAll(/font-size:\s*[0-9.]+px/g)]
    .filter(m => !inPrint(m.index))
    .map(m => `  css/style.css:${lineOf(m.index)}  ${m[0]}`);
  assert.equal(
    offenders.length, 0,
    `use a --fs-* token (or container units inside a card) instead:\n${offenders.join('\n')}`,
  );
});

test('no px font-size hidden in a `font:` shorthand outside print', () => {
  // font:13px/1.4 … sets font-size just as surely, and the check above would miss it.
  const offenders = [...css.matchAll(/[^-]font:\s*[^;{]*\d+px/g)]
    .filter(m => !inPrint(m.index))
    .map(m => `  css/style.css:${lineOf(m.index)}  ${m[0].trim()}`);
  assert.equal(offenders.length, 0, `expand the shorthand and use a token:\n${offenders.join('\n')}`);
});

test('card internals use container units so they track the tile', () => {
  // .card is container-type:inline-size; its children size in cqw. If these regress to
  // viewport units or fixed px, a 108px phone tile and a 200px desktop tile get the same
  // text and the card stops looking like one design at two scales.
  // (selector, body) pairs. Selectors never contain braces, so this is enough structure
  // for the question being asked without pulling in a CSS parser.
  const pairs = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(m => !inPrint(m.index))                    // print keeps physical px, by design
    .map(m => ({ sel: m[1].trim().split('\n').pop().trim(), body: m[2] }));

  for (const sel of ['.card-num', '.lang', '.vbadge', '.cp-name', '.cp-set', '.preview-btn']) {
    // EXACT selector only. `.preview-placeholder .cp-name` deliberately uses vw clamps —
    // the modal is not inside a card, so it has no container to measure against.
    // A class can also appear in several rules (the palette block re-declares .cp-* for
    // colour alone), so only the ones that set a font-size are interesting.
    const rules = pairs.filter(p => p.sel === sel || p.sel.startsWith(sel + ','));
    assert.ok(rules.length, `${sel} not found as a standalone rule`);
    const sizing = rules.filter(p => /font-size:/.test(p.body)).map(p => p.body);
    assert.ok(sizing.length, `${sel} never sets a font-size`);
    for (const body of sizing) {
      assert.match(body, /font-size:[^;]*cqw/, `${sel} should size in cqw, got:\n${body}`);
    }
  }
  assert.match(css, /\.card\{[\s\S]*?container-type:inline-size/, '.card must be a container');
});

test('print keeps its physical px sizes', () => {
  // Not an oversight — the exemption is load-bearing and should stay visible.
  const printCss = PRINT.map(([a, b]) => css.slice(a, b)).join('\n');
  assert.match(printCss, /font-size:\s*[0-9.]+px/);
});
