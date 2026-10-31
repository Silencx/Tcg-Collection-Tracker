// A card the TCGdex list returns WITHOUT `image` gets an asset base built from its id.
// The CDN segment in that URL must be the set's real series (data/sets.json's
// setSeries), not a slice of the id: masterset.buildSetsMap reads both the image URLs
// and the era grouping off it, so a guess like "xyp" for an XY promo 404s in every
// language and files the card under a stray era of its own.
//
// fetch is stubbed: data/ files come from an in-memory table, TCGdex answers one card
// list per name, and everything else (GraphQL variants, REST detail) fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const files = {
  'sets.json': { builtAt: '2026-10-30', names: { en: {} }, setSeries: { xyp: 'xy', B1: 'tcgp' } },
};
const lists = {
  Seedot: [{ id: 'xyp-XY123', localId: 'XY123', name: 'Seedot' }],
  Shiftry: [{ id: 'B1-001', localId: '001', name: 'Shiftry' }],
};

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith('file:')) {
    const key = Object.keys(files).find(k => u.endsWith(`/data/${k}`));
    if (!key) return { ok: false, status: 404, json: async () => null };
    return { ok: true, status: 200, json: async () => files[key] };
  }
  const m = /\/v2\/en\/cards\?name=([^&]+)$/.exec(u);
  if (m) return { ok: true, status: 200, json: async () => lists[decodeURIComponent(m[1])] || [] };
  throw new TypeError('fetch failed');
};

const { getCards } = await import('../js/api/providers/tcgdex.js');
const router = await import('../js/api/router.js');

test('the provider builds a missing image base from the series map', async () => {
  const [card] = await getCards(['Seedot'], { setSeries: { xyp: 'xy' }, withVariants: false });
  assert.equal(card.image, 'https://assets.tcgdex.net/en/xy/xyp/XY123');
});

test('without a map it still falls back to the id-slicing guess', async () => {
  const [card] = await getCards(['Seedot'], { withVariants: false });
  assert.equal(card.image, 'https://assets.tcgdex.net/en/xyp/xyp/XY123');
});

test('the router hands the snapshot\'s series map to the live card index', async () => {
  router.resetHealth();
  const res = await router.getCards(['Shiftry']);
  assert.equal(res.source, 'tcgdex');
  assert.equal(res.cards[0].image, 'https://assets.tcgdex.net/en/tcgp/B1/001');
});
