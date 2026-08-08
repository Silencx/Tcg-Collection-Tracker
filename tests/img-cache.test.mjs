// img-cache.js is the negative cache that stops the app re-requesting image URLs
// already known to 404/403 (TCGdex has no artwork at all for zh-Hant/th/id; Limitless
// 403s individual scans). It reads localStorage at IMPORT time, so the shim has to be
// installed before the dynamic import below — no other test in this suite needs
// browser globals, hence the local shim rather than a shared helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IMGFAILSTORE, IMG_FAIL_TTL } from '../js/config.js';

function installLocalStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
    key: i => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  return store;
}

const A = 'https://assets.tcgdex.net/th/xy/xy11/9/low.webp';
const B = 'https://assets.tcgdex.net/id/xy/xy11/9/low.webp';
const HI = 'https://assets.tcgdex.net/en/xy/xy11/9/high.webp';
const LO = 'https://assets.tcgdex.net/en/xy/xy11/9/low.webp';
// A different HOST, so tests about candidate ordering aren't also exercising the
// TCGdex quality-variant collapsing (which has its own test below).
const LIMITLESS = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/LOR/LOR_002_R_EN.png';

// A fresh module instance per test — module state is per-import, and these tests
// each want their own starting cache.
async function freshModule(seed) {
  const store = installLocalStorage(seed);
  // Cache-bust the specifier so each call re-executes the module body (and its
  // localStorage restore) instead of returning the cached instance.
  const mod = await import(`../js/api/img-cache.js?t=${Math.random()}`);
  return { mod, store };
}

test('imgMeta drops falsy candidates and starts with no confirmed url', async () => {
  const { mod } = await freshModule();
  assert.deepEqual(mod.imgMeta([LO, null], [HI]), {
    imgSources: [LO], hiSources: [HI], imgOk: null,
  });
  // Placeholder-only languages (KR/SC) legitimately have no candidates at all.
  assert.deepEqual(mod.imgMeta([], []), { imgSources: [], hiSources: [], imgOk: null });
  assert.deepEqual(mod.imgMeta(undefined, undefined), { imgSources: [], hiSources: [], imgOk: null });
});

test('a marked-bad url is skipped, and markGood un-marks it', async () => {
  const { mod } = await freshModule();
  assert.equal(mod.isKnownBad(A), false);

  mod.markBad(A);
  assert.equal(mod.isKnownBad(A), true);
  assert.deepEqual(mod.viableSources([A, B]), [B], 'known-bad url should be filtered out');

  mod.markGood(A);
  assert.equal(mod.isKnownBad(A), false, 'a url that later loads must stop being skipped');
  mod.flushImgCache();
});

test('viableSources preserves priority order and drops falsy entries', async () => {
  const { mod } = await freshModule();
  assert.deepEqual(mod.viableSources([HI, null, LO]), [HI, LO]);
  assert.deepEqual(mod.viableSources([]), []);
  assert.deepEqual(mod.viableSources(undefined), []);
});

test('metaSources orders high-res, then the confirmed url, then low-res, deduped', async () => {
  const { mod } = await freshModule();
  const m = { ...mod.imgMeta([LO], [HI]), imgOk: LO };
  // LO appears as both the confirmed url and a low-res candidate — it must be
  // listed once, and after the high-res candidate the preview/print would prefer.
  assert.deepEqual(mod.metaSources(m), [HI, LO]);
  assert.deepEqual(mod.metaSources(null), [], 'a missing meta must not throw');
});

test('metaSources removes known-bad candidates, and recheck ignores the cache', async () => {
  const { mod } = await freshModule();
  // Mirrors the real EN case: a Limitless scan as the low candidate and a TCGdex
  // asset as the high one — two independent hosts.
  const m = mod.imgMeta([LIMITLESS], [HI]);
  mod.markBad(HI);

  assert.deepEqual(mod.metaSources(m), [LIMITLESS], 'the failed high-res url should not be re-requested');
  assert.deepEqual(mod.metaSources(m, { recheck: true }), [HI, LIMITLESS], 'recheck must offer everything again');
  mod.flushImgCache();
});

test('a meta with no viable candidates yields nothing to request', async () => {
  const { mod } = await freshModule();
  const m = mod.imgMeta([A], [A]);   // th/id: one url, and it does not exist
  mod.markBad(A);
  assert.deepEqual(mod.metaSources(m), [],
    'this is the case that makes print show the placeholder on the FIRST run');
  mod.flushImgCache();
});

test('a TCGdex failure covers every quality of the same card', async () => {
  const { mod } = await freshModule();
  const lo = 'https://assets.tcgdex.net/th/xy/xy11/9/low.webp';
  const hi = 'https://assets.tcgdex.net/th/xy/xy11/9/high.webp';
  const png = 'https://assets.tcgdex.net/th/xy/xy11/9/high.png';
  const otherCard = 'https://assets.tcgdex.net/th/xy/xy11/10/low.webp';

  // The grid only ever requests low.webp; preview and print want high.webp. Since the
  // CDN is missing the whole card directory, one failure has to answer for all of them.
  mod.markBad(lo);
  assert.equal(mod.isKnownBad(hi), true, 'high.webp of the same card must be skipped too');
  assert.equal(mod.isKnownBad(png), true, 'so must high.png');
  assert.equal(mod.isKnownBad(otherCard), false, 'a different card must be unaffected');
  assert.equal(mod.imgFailureCount(), 1, 'the variants collapse onto one entry');

  // And a success on any quality clears the whole card again.
  mod.markGood(hi);
  assert.equal(mod.isKnownBad(lo), false);
  mod.flushImgCache();
});

test('non-TCGdex urls are remembered exactly, not by directory', async () => {
  const { mod } = await freshModule();
  // Limitless uses flat per-scan filenames: one missing scan says nothing about its
  // neighbours in the same set, so these must NOT collapse together.
  const a = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/SM7/SM7_105_R_JP_SM.png';
  const b = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/SM7/SM7_6_R_JP_SM.png';
  mod.markBad(a);
  assert.equal(mod.isKnownBad(a), true);
  assert.equal(mod.isKnownBad(b), false, 'a sibling scan must still be attempted');
  mod.flushImgCache();
});

test('failures persist across a reload', async () => {
  const { mod, store } = await freshModule();
  mod.markBad(A);
  mod.flushImgCache();
  assert.ok(store.get(IMGFAILSTORE), 'the failure should be written to localStorage');

  // Re-import against the same persisted blob — a new page load. Asserted through the
  // public API rather than the stored key, which is an internal detail (TCGdex urls are
  // keyed by card directory — see the quality-variant test).
  installLocalStorage({ [IMGFAILSTORE]: store.get(IMGFAILSTORE) });
  const reloaded = await import(`../js/api/img-cache.js?t=${Math.random()}`);
  assert.equal(reloaded.isKnownBad(A), true, 'the failure should survive a reload');
});

test('entries older than the TTL lapse, so new artwork is picked up', async () => {
  // Seeded via markBad + flush so the stored keys are whatever the module uses, then
  // the timestamp of one is backdated past the TTL.
  const { mod: seeder, store } = await freshModule();
  seeder.markBad(A);
  seeder.markBad(B);
  seeder.flushImgCache();
  const blob = JSON.parse(store.get(IMGFAILSTORE));
  const [keyA, keyB] = Object.keys(blob.urls);
  blob.urls[keyA] = Date.now() - IMG_FAIL_TTL - 1000;

  const { mod } = await freshModule({ [IMGFAILSTORE]: JSON.stringify(blob) });
  assert.equal(mod.isKnownBad(A), false, 'an expired entry must not suppress a retry');
  assert.equal(mod.isKnownBad(B), true, 'a fresh entry should still suppress');
  assert.equal(mod.imgFailureCount(), 1, 'expired entries are dropped on load');
  assert.ok(keyB, 'both urls should have produced distinct keys');
  mod.flushImgCache();
});

test('a corrupt or foreign blob is ignored rather than thrown on', async () => {
  for (const bad of ['not json', '{}', '[]', 'null', '{"urls":"nope"}', '{"urls":{"u":"NaN"}}']) {
    const { mod } = await freshModule({ [IMGFAILSTORE]: bad });
    assert.equal(mod.imgFailureCount(), 0, `blob ${bad} should load as empty`);
  }
});

test('clearImgFailures forgets everything', async () => {
  const { mod, store } = await freshModule();
  mod.markBad(A);
  mod.markBad(B);
  assert.equal(mod.imgFailureCount(), 2);

  mod.clearImgFailures();
  assert.equal(mod.imgFailureCount(), 0);
  assert.equal(mod.isKnownBad(A), false);
  assert.equal(store.has(IMGFAILSTORE), false, 'the persisted blob should be removed too');
});
