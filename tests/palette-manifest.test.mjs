// A palette is declared in FOUR places that have no compile-time link to each other:
//
//   css/style.css   body.palette-<name> { … }        the actual colours
//   index.html      data-palette="palette-<name>"    the Master "⋯ More" picker
//   index.html      data-palette="palette-<name>"    the TMS "⋯ More" picker (a copy)
//   js/main.js      PALETTES = [ … ]                 what setPalette can REMOVE
//
// Two failure modes this catches, both silent in a browser:
//   • adding the CSS + swatches but forgetting main.js's PALETTES — the theme applies
//     and can never be switched away from, because classList.remove(...PALETTES) does
//     not know about it;
//   • editing one copy of the picker and not the other — the swatch is missing in one
//     of the two modes.
//
// Source-scanning rather than importing, in the same zero-dependency style as
// tests/import-graph.test.mjs: main.js touches document at import time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_MODES } from '../js/config.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const css = read('css/style.css');
const html = read('index.html');
const mainJs = read('js/main.js');

// `body.palette-ocean{` / `body.palette-dark {`
const cssPalettes = new Set(
  [...css.matchAll(/^body\.(palette-[\w-]+)\s*\{/gm)].map((m) => m[1]),
);

// The picker is the .theme-grid inside the settings panel. '' is the Forest default,
// which is a real option but deliberately has no CSS class of its own.
//
// There used to be TWO copies — one per mode control row, because applyModeUI hides
// whichever row is inactive — and this file asserted they stayed identical. The settings
// panel sits at .header level and survives both modes, so a single copy is now correct
// and duplication is the thing to guard against.
const pickerBlocks = [...html.matchAll(/<div class="theme-grid">([\s\S]*?)<\/div>/g)]
  .map((m) => new Set([...m[1].matchAll(/data-palette="([^"]*)"/g)].map((d) => d[1])));

const jsPalettes = (() => {
  const m = mainJs.match(/const PALETTES\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'could not find the PALETTES array literal in js/main.js');
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map((s) => s[1]));
})();

const sorted = (s) => [...s].sort();

test('the CSS declares at least the five original palettes', () => {
  for (const name of ['palette-ocean', 'palette-dusk', 'palette-fire', 'palette-mono']) {
    assert.ok(cssPalettes.has(name), `css/style.css is missing body.${name}`);
  }
});

test('there is exactly one theme picker', () => {
  // A second copy would mean the settings panel had been pushed back inside a mode row,
  // which is what forced the duplication — and the drift — in the first place.
  assert.equal(pickerBlocks.length, 1, 'expected exactly one .theme-grid picker in index.html');
});

test('the picker lives outside EVERY mode-switched container', () => {
  // If it sat inside one of these, applyModeUI would hide it in the other modes and the
  // duplication that this file exists to prevent would be back. Listing all of them,
  // not just the two control rows: the dashboard is a third mode now, and "the settings
  // panel comes before the two mode rows" stopped being the same statement as "the
  // settings panel is outside every mode container" the moment a third one existed.
  const panel = html.indexOf('id="settings-menu"');
  assert.ok(panel > -1, 'settings panel not found');
  for (const id of ['master-controls', 'tms-header-controls', 'set-controls', 'dash', 'dyn', 'tms-app', 'set-app']) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > -1, `#${id} not found in index.html`);
    assert.ok(panel < at, `the settings panel must precede #${id}`);
  }
});

test('every control row opens with Print selected, then Print checklist', () => {
  // The point is muscle memory: the two controls people reach for should be in the same
  // place whichever mode they are in. Master Set used to bury "Print checklist" at
  // position six, where a 500px viewport clipped it off the row entirely.
  for (const id of ['master-controls', 'tms-header-controls', 'set-controls']) {
    const open = html.indexOf(`id="${id}"`);
    assert.ok(open > -1, `#${id} not found`);
    const row = html.slice(open, html.indexOf('</div>', open));
    const handlers = [...row.matchAll(/onclick="(\w+)\(\)"/g)].map((m) => m[1]);
    assert.equal(handlers.length > 1, true, `#${id} has fewer than two buttons`);
    assert.match(handlers[0], /^print\w*Selected$/,
      `#${id}'s first button is ${handlers[0]}, expected a Print selected handler`);
    assert.match(handlers[1], /^print\w*Checklist$/,
      `#${id}'s second button is ${handlers[1]}, expected a Print checklist handler`);
  }
});

test('every mode has a switch button, and every button names a real mode', () => {
  // applyModeUI drives .active from a table keyed on these ids; a mode with no button
  // is unreachable, and a button for a mode that does not exist is a dead control.
  const buttons = [...html.matchAll(/id="btn-mode-([\w-]+)"[^>]*onclick="setMode\('([\w-]+)'\)"/g)];
  const byId = new Map(buttons.map(m => [m[1], m[2]]));
  for (const [suffix, mode] of byId) {
    assert.equal(suffix, mode, `#btn-mode-${suffix} switches to '${mode}' — keep the id in step`);
  }
  // Derived from APP_MODES, not a literal: config.js is the single source of truth for
  // how many modes exist, and a test that restates the list is just a fourth place to
  // forget to update.
  assert.deepEqual([...byId.values()].sort(), [...APP_MODES].sort(),
    'index.html must offer exactly the modes config.js declares in APP_MODES');
});

test('main.js PALETTES matches the palettes declared in the CSS', () => {
  assert.deepEqual(
    sorted(jsPalettes),
    sorted(cssPalettes),
    'PALETTES in js/main.js must list every body.palette-* rule — setPalette uses it to ' +
    'REMOVE the previous theme, so an omission makes that palette impossible to leave',
  );
});

test('the picker offers every CSS palette, plus the empty default', () => {
  const expected = sorted(new Set([...cssPalettes, '']));
  assert.deepEqual(sorted(pickerBlocks[0]), expected);
});
