// card-image-model.js decides which TCGdex scan URL a card gets. Two facts measured on
// 2026-11-25 sit underneath it: Traditional Chinese art lives under /zh-tw/ (the app's
// own code, zh-Hant, is a 404 folder), and a set listing gives a card an `image` base
// exactly when the CDN holds that scan.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  tcgdexCdnLang, tcgdexCardBase, listedImageBase, isMisfiledCdnUrl,
} from '../js/api/card-image-model.js';
import { LANGUAGES } from '../js/config.js';

test('Traditional Chinese art is filed under zh-tw, not the app code zh-Hant', () => {
  assert.equal(tcgdexCdnLang('zh-Hant'), 'zh-tw');
  assert.equal(tcgdexCardBase('zh-Hant', 'SV', 'SV1S', '001'),
    'https://assets.tcgdex.net/zh-tw/SV/SV1S/001');
});

test('Thai and Indonesian art is filed under their own codes', () => {
  assert.equal(tcgdexCdnLang('th'), 'th');
  assert.equal(tcgdexCdnLang('id'), 'id');
  assert.equal(tcgdexCardBase('th', 'SV', 'SV1S', '001'), 'https://assets.tcgdex.net/th/SV/SV1S/001');
  assert.equal(tcgdexCardBase('id', 'SV', 'SV1S', '001'), 'https://assets.tcgdex.net/id/SV/SV1S/001');
});

test('every TCGdex language gets a CDN folder, and the Latin ones are unchanged', () => {
  for (const l of LANGUAGES) assert.ok(tcgdexCdnLang(l.code), `${l.badge} has no folder`);
  for (const code of ['en', 'de', 'fr', 'es', 'it', 'pt']) assert.equal(tcgdexCdnLang(code), code);
  assert.equal(tcgdexCardBase('de', 'sv', 'sv05', '163'), 'https://assets.tcgdex.net/de/sv/sv05/163');
});

test('a language TCGdex has no art for gets no folder and no URL', () => {
  // KR and SC are PLACEHOLDER_LANGS with no `code`; an unknown code is the same case.
  assert.equal(tcgdexCdnLang(undefined), null);
  assert.equal(tcgdexCdnLang('ko'), null);
  assert.equal(tcgdexCardBase('ko', 'sv', 'sv05', '163'), null);
});

test('a language without an apiCode falls back to its code', () => {
  assert.equal(tcgdexCdnLang('xx', [{ code: 'xx' }]), 'xx');
});

test('a listed image is used as given', () => {
  // The exact shape /v2/zh-tw/sets/SV1S returns.
  assert.equal(listedImageBase('https://assets.tcgdex.net/zh-tw/SV/SV1S/001'),
    'https://assets.tcgdex.net/zh-tw/SV/SV1S/001');
});

test('no listed image means no scan, so no URL', () => {
  // SV1S-021 comes back as { id, localId, name } with no image; its /low.webp is a 404.
  for (const v of [undefined, null, '', '   ', 42, {}]) assert.equal(listedImageBase(v), null);
});

test('a listed image with a quality file or trailing slash is reduced to its base', () => {
  const base = 'https://assets.tcgdex.net/th/SV/SV1S/001';
  assert.equal(listedImageBase(`${base}/low.webp`), base);
  assert.equal(listedImageBase(`${base}/high.png`), base);
  assert.equal(listedImageBase(`${base}/`), base);
});

test('a listed image that is not an https URL is ignored', () => {
  assert.equal(listedImageBase('/zh-tw/SV/SV1S/001'), null);
  assert.equal(listedImageBase('http://assets.tcgdex.net/zh-tw/SV/SV1S/001'), null);
  assert.equal(listedImageBase('javascript:alert(1)'), null);
});

test('a URL built under zh-Hant is recognised as misfiled', () => {
  assert.equal(isMisfiledCdnUrl('https://assets.tcgdex.net/zh-Hant/sv/sv05/163/low.webp'), true);
});

test('correctly filed and non-TCGdex URLs are not misfiled', () => {
  for (const url of [
    'https://assets.tcgdex.net/zh-tw/SV/SV1S/001/low.webp',
    'https://assets.tcgdex.net/th/SV/SV1S/001/low.webp',
    'https://assets.tcgdex.net/en/sv/sv05/163/low.webp',
    'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/SV5K/SV5K_1_R_JP_SM.png',
    null, undefined, '',
  ]) assert.equal(isMisfiledCdnUrl(url), false, String(url));
});
