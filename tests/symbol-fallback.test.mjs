// Set symbols fall back /univ/ → /en/ → /fr/ → /de/ before the render sites hide them.
// On 2026-10-30 every /univ/ symbol answered HTTP 400 and the app showed none at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextTcgdexSymbolUrl, tcgdexSymbolUrl } from '../js/api/images.js';
import { JP_BULBA_SET_MAP } from '../js/api/bulba-jp.js';
import { installSymbolFallback } from '../js/ui/symbol-fallback.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sets = JSON.parse(readFileSync(resolve(ROOT, 'data/sets.json'), 'utf8'));
const CDN = 'https://assets.tcgdex.net';

test('walks /univ/ → /en/ → /fr/ → /de/, then stops', () => {
  const chain = [tcgdexSymbolUrl('sm', 'sm7')];
  for (let next; (next = nextTcgdexSymbolUrl(chain.at(-1))); ) chain.push(next);
  assert.deepEqual(chain, [
    `${CDN}/univ/sm/sm7/symbol.webp`,
    `${CDN}/en/sm/sm7/symbol.webp`,
    `${CDN}/fr/sm/sm7/symbol.webp`,
    `${CDN}/de/sm/sm7/symbol.webp`,
  ]);
});

test('leaves everything that is not a TCGdex symbol alone', () => {
  for (const url of [
    `${CDN}/en/sm/sm7/001/low.webp`,           // card art has its own fallback chain
    `${CDN}/en/base/base1/logo.webp`,
    `${CDN}/ja/SV/SV1a/symbol.webp`,           // not a folder in the chain
    'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/SM7/SM7_1_R_JP_SM.png',
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    '', null, undefined,
  ]) assert.equal(nextTcgdexSymbolUrl(url), null, String(url));
});

test('every symbol the app ships has an /en/ fallback', () => {
  const urls = [
    ...Object.values(sets.symbols),
    ...Object.values(JP_BULBA_SET_MAP).map(m => m.sym).filter(Boolean),
  ];
  assert.ok(urls.length > 100);
  for (const url of urls) {
    const next = nextTcgdexSymbolUrl(url);
    assert.ok(next && next.startsWith(`${CDN}/en/`) && next.endsWith('/symbol.webp'), url);
  }
});

test('the listener swaps src and hides the error from the site handler until the chain ends', () => {
  globalThis.HTMLImageElement ??= class {};
  let listener, capture;
  installSymbolFallback({ addEventListener: (type, fn, opt) => { assert.equal(type, 'error'); listener = fn; capture = opt; } });
  assert.equal(capture, true);

  const img = Object.assign(new HTMLImageElement(), { src: tcgdexSymbolUrl('sv', 'sv05') });
  const fire = () => {
    let stopped = false;
    listener({ target: img, stopImmediatePropagation: () => { stopped = true; } });
    return stopped;
  };
  assert.equal(fire(), true);  assert.equal(img.src, `${CDN}/en/sv/sv05/symbol.webp`);
  assert.equal(fire(), true);  assert.equal(img.src, `${CDN}/fr/sv/sv05/symbol.webp`);
  assert.equal(fire(), true);  assert.equal(img.src, `${CDN}/de/sv/sv05/symbol.webp`);
  assert.equal(fire(), false); assert.equal(img.src, `${CDN}/de/sv/sv05/symbol.webp`);

  let stopped = false;
  listener({ target: {}, stopImmediatePropagation: () => { stopped = true; } });
  assert.equal(stopped, false, 'non-img targets pass through');
});
