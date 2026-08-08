// The CDN path segment for a set's assets is its TCGdex SERIES. Deriving it by slicing
// digits off the id — which is what this app did for a long time — is wrong for a large
// minority of sets, and wrong here means a 404 image and silently skipped variant data.
//
// The fixture below is the regression. Every pair was verified against the art URLs
// TCGdex actually serves (data/sets.json's symbols/logos carry the real segment), and
// live: assets.tcgdex.net/en/A/A1/001/low.webp is a 404 while
// assets.tcgdex.net/en/tcgp/A1/001/low.webp is a 200.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tcgdexSerieSegment, tcgdexAssetBase } from '../js/api/images.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sets = JSON.parse(readFileSync(resolve(ROOT, 'data/sets.json'), 'utf8'));

// setId → the series it is REALLY served under. The old id-slicing rule gets every one
// of these wrong; the comment is what it guessed.
const KNOWN_BAD = {
  A1: 'tcgp',            // guessed 'A'      — Pokémon TCG Pocket
  'P-A': 'tcgp',         // guessed 'P-A'
  B1: 'tcgp',            // guessed 'B'
  swshp: 'swsh',         // guessed 'swshp'  — SWSH Black Star Promos
  cel25: 'swsh',         // guessed 'cel'    — Celebrations
  fut2020: 'swsh',       // guessed 'fut'
  '2021swsh': 'mc',      // guessed ''  ← empty string, built a double-slash URL
  '2011bw': 'mc',        // guessed ''
  'tk-ex-latia': 'tk',   // guessed the whole id — Trainer Kits
  'tk-xy-sy': 'tk',
  dpp: 'dp',             // guessed 'dpp'
  np: 'pop',             // guessed 'np'
  si1: 'neo',            // guessed 'si'
  bog: 'ecard',          // guessed 'bog'
  ru1: 'pl',             // guessed 'ru'
  sve: 'sv',             // guessed 'sve'
  mep: 'me',             // guessed 'mep'
};

test('the shipped setSeries map agrees with the fixture', () => {
  // Guards the DATA as well as the function: a rebuild that lost the map would make
  // every assertion below pass vacuously against the fallback.
  for (const [id, serie] of Object.entries(KNOWN_BAD)) {
    assert.equal(sets.setSeries?.[id], serie, `data/sets.json maps ${id} wrongly`);
  }
});

test('the map wins over the id-slicing guess for every known-bad set', () => {
  for (const [id, serie] of Object.entries(KNOWN_BAD)) {
    assert.equal(tcgdexSerieSegment(id, sets.setSeries), serie, id);
  }
});

test('the ordinary sets the guess got right still come out right', () => {
  for (const [id, serie] of [['sv05', 'sv'], ['base1', 'base'], ['swsh11', 'swsh'], ['me01', 'me']]) {
    assert.equal(tcgdexSerieSegment(id, sets.setSeries), serie);
    assert.equal(tcgdexSerieSegment(id, null), serie, 'and the fallback agrees for these');
  }
});

test('with no map, the fallback NEVER returns an empty string', () => {
  // '' is the specific failure that produced assets.tcgdex.net/en//2021swsh/1/low.webp.
  // Ids beginning with a digit are the whole class: the twelve McDonald's sets and the
  // eight year-prefixed promo sets.
  for (const id of ['2021swsh', '2011bw', '2024sv', '2016xy']) {
    const seg = tcgdexSerieSegment(id, null);
    assert.notEqual(seg, '', `${id} produced an empty segment`);
    assert.equal(tcgdexAssetBase('en', seg, id, '1').includes('//', 8), false,
      `${id} produced a double-slash URL`);
  }
});

test('no set in the shipped map can produce a double-slash URL', () => {
  const offenders = [];
  for (const id of Object.keys(sets.names?.en || {})) {
    const url = tcgdexAssetBase('en', tcgdexSerieSegment(id, sets.setSeries), id, '1');
    // Skip the protocol's own '//'.
    if (url.slice(8).includes('//')) offenders.push(`${id} → ${url}`);
  }
  assert.deepEqual(offenders, []);
});

test('every shipped set resolves to a non-empty series', () => {
  const missing = Object.keys(sets.names?.en || {}).filter(id => !sets.setSeries?.[id]);
  assert.deepEqual(missing, [], 'these would fall into the "Other sets" bucket');
});

test('tcgdexSerieSegment tolerates junk rather than throwing', () => {
  assert.equal(typeof tcgdexSerieSegment('', null), 'string');
  assert.equal(tcgdexSerieSegment('sv05', undefined), 'sv');
  assert.equal(tcgdexSerieSegment('sv05', {}), 'sv');
});
