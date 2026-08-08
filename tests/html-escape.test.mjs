// A crafted "#s=" share link used to run script in the victim's page: the
// Pokémon list went from the URL fragment straight into innerHTML, and print
// views are Blob documents that inherit the page ORIGIN — so injected script
// there reads the same localStorage as the app. These pin the escaping down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, escapeUrl } from '../js/ui/html.js';

test('escapeHtml neutralizes tag and attribute breakout', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml('</script><script>alert(1)</script>'),
    '&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml('" onmouseover="alert(1)'), '&quot; onmouseover=&quot;alert(1)');
  assert.equal(escapeHtml("' onmouseover='alert(1)"), '&#39; onmouseover=&#39;alert(1)');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
});

test('escapeHtml leaves real Pokémon and set names intact', () => {
  for (const name of ['Seedot', 'Ho-Oh', 'Tapu Koko', 'Nidoran♀', 'Mr. Mime', 'Flabébé', '151']) {
    assert.equal(escapeHtml(name), name);
  }
});

test('escapeHtml coerces non-strings without throwing', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml(42), '42');
});

test('escapeUrl passes the image URLs this app actually builds', () => {
  for (const url of [
    'https://assets.tcgdex.net/en/sv/sv05/003/low.webp',
    'https://images.pokemontcg.io/sv5/163_hires.png',
    'http://example.test/sym.png',
    'data:image/png;base64,iVBORw0KGgo=',
    'img/relative.png',
    '/absolute/path.png',
  ]) {
    assert.equal(escapeUrl(url), url, `expected ${url} to survive`);
  }
});

// An attribute-safe string is still dangerous if the scheme itself executes:
// javascript: contains not one character escapeHtml would touch.
test('escapeUrl drops script-bearing schemes', () => {
  for (const url of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '  javascript:alert(1)  ',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
  ]) {
    assert.equal(escapeUrl(url), '', `expected ${JSON.stringify(url)} to be dropped`);
  }
});

test('escapeUrl still escapes quotes in an otherwise allowed URL', () => {
  assert.equal(
    escapeUrl('https://x.test/a"onerror="alert(1)'),
    'https://x.test/a&quot;onerror=&quot;alert(1)',
  );
});
