// Hosted card images: the manifest layout the app reads (js/api/local-images.js) and the
// PokéWallet matching + budget rules the build relies on (tools/lib/pokewallet.mjs).
// Offline — the PokéWallet rows below are trimmed copies of what the probe saw on
// 2026-10-30, and the client is driven by a fake fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setSlug, cardNumber, imagePath, lookupImage, emptyIndex,
} from '../js/api/local-images.js';
import { jpImageKeyFor, jpNumKey } from '../js/api/jp-model.js';
const jpImageKey = (jpset, jpnum) => jpImageKeyFor(setSlug(jpset), jpNumKey(jpnum));
import {
  setMatchKey, numberMatchKey, matchJpRows, createClient, extFor, SET_ALIASES,
} from '../tools/lib/pokewallet.mjs';

// ── layout ────────────────────────────────────────────────────────────────────
test('keys are built from OUR set names and numbers, not the source\'s ids', () => {
  assert.equal(jpImageKey('Miracle of the Desert', '001/053'), 'jp/miracle-of-the-desert/1');
  assert.equal(jpImageKey('Deoxys Constructed Starter Deck', '003/015'), 'jp/deoxys-constructed-starter-deck/3');
  assert.equal(imagePath('jp/miracle-of-the-desert/1', 'high'), 'img/jp/miracle-of-the-desert/1-high.jpg');
});

test('set slugs fold accents and punctuation and are never empty', () => {
  assert.equal(setSlug('Pokémon Card Game: Movie Commemoration VS Pack'), 'pokemon-card-game-movie-commemoration-vs-pack');
  assert.equal(setSlug(''), 'set');
});

test('card numbers drop padding and totals, keep non-numeric heads', () => {
  assert.equal(cardNumber('001/053'), '1');
  assert.equal(cardNumber('229/SM-P'), '229');
  assert.equal(cardNumber('tg01/TG30'), 'TG01');
});

test('lookup returns the asked size, falls back to the other, and misses cleanly', () => {
  const idx = { images: {
    'jp/a/1': { sizes: { low: 'jpg', high: 'jpg' } },
    'jp/a/2': { sizes: { low: 'jpg' } },
  } };
  assert.equal(lookupImage(idx, 'jp/a/1', 'high'), 'img/jp/a/1-high.jpg');
  assert.equal(lookupImage(idx, 'jp/a/2', 'high'), 'img/jp/a/2-low.jpg');
  assert.equal(lookupImage(idx, 'jp/a/3', 'low'), null);
  assert.equal(lookupImage(null, 'jp/a/1', 'low'), null);
  assert.deepEqual(emptyIndex().images, {});
});

// ── matching ──────────────────────────────────────────────────────────────────
const pw = (name, set_name, card_number, id = `pk_${set_name}_${card_number}`) =>
  ({ id, card_info: { name, set_name, card_number } });

test('PokéWallet code prefixes are ignored when comparing set names', () => {
  assert.equal(setMatchKey('SV5M: Cyber Judge'), setMatchKey('Cyber Judge'));
  assert.equal(setMatchKey('XY11-Bb: Fever-Burst Fighter'), setMatchKey('Fever-Burst Fighter'));
  assert.equal(numberMatchKey('001/053'), numberMatchKey('1'));
});

test('rows match on set + number; World Champions Pack is reported missing', () => {
  const rows = [
    { jpset: 'Miracle of the Desert', jpnum: '001/053', pokemonName: 'Seedot' },
    { jpset: 'Bonds to the End of Time', jpnum: '004/090', pokemonName: 'Seedot' },
    { jpset: 'World Champions Pack', jpnum: '001/108', pokemonName: 'Seedot' },
  ];
  const cards = [pw('Seedot', 'Miracle of the Desert', '001/053'), pw('Seedot', 'Pt2: Bonds to the End of Time', '004/090')];
  const { matched, missing } = matchJpRows(rows, cards);
  assert.equal(matched.length, 2);
  assert.deepEqual(missing.map(r => r.jpset), ['World Champions Pack']);
});

test('the Latios half deck is PokéWallet\'s "Gift Box (Latios)"', () => {
  assert.equal(SET_ALIASES['Latios ex Half Deck'], 'Gift Box (Latios)');
  const { matched } = matchJpRows(
    [{ jpset: 'Latios ex Half Deck', jpnum: '002/018', pokemonName: 'Nuzleaf' }],
    [pw('Nuzleaf', 'Gift Box (Latios)', '002/018')],
  );
  assert.equal(matched.length, 1);
});

test('a separately-listed print never stands in for the base card', () => {
  const { matched } = matchJpRows(
    [{ jpset: 'Undone Seal', jpnum: '010/083', pokemonName: 'Seedot' }],
    [pw('Seedot (Mirror Holofoil)', 'Undone Seal', '010/083', 'pk_mirror'), pw('Seedot', 'Undone Seal', '010/083', 'pk_base')],
  );
  assert.equal(matched[0].card.id, 'pk_base');
});

// ── client budget ─────────────────────────────────────────────────────────────
function fakeFetch(remainingHour, body = { results: [] }) {
  let left = remainingHour;
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, opts });
    left--;
    const headers = new Map([
      ['x-ratelimit-remaining-hour', String(left)], ['x-ratelimit-limit-hour', '100'],
      ['x-ratelimit-remaining-day', '900'], ['x-ratelimit-limit-day', '1000'],
      ['content-type', 'application/json'],
    ]);
    return { status: 200, ok: true, headers: { get: n => headers.get(n.toLowerCase()) ?? null }, json: async () => body, text: async () => '' };
  };
  return { impl, calls };
}

test('the client stops at the live hourly reserve, before the server says 429', async () => {
  const { impl, calls } = fakeFetch(13);
  const c = createClient('secret-test-key', { reserve: 10, fetchImpl: impl });
  await c.call('/sets'); await c.call('/sets'); await c.call('/sets');   // 12, 11, 10 left
  await assert.rejects(c.call('/sets'), e => e.code === 'BUDGET');
  assert.equal(calls.length, 3);
  assert.equal(c.quota.hour, 10);
});

test('the client stops at its own request cap', async () => {
  const { impl } = fakeFetch(1000);
  const c = createClient('k', { maxRequests: 2, fetchImpl: impl });
  await c.call('/a'); await c.call('/b');
  await assert.rejects(c.call('/c'), e => e.code === 'BUDGET');
});

test('the key travels only in the X-API-Key header, never in the URL', async () => {
  const { impl, calls } = fakeFetch(50);
  const c = createClient('secret-test-key', { fetchImpl: impl });
  await c.call('/search?q=Seedot');
  assert.equal(calls[0].opts.headers['X-API-Key'], 'secret-test-key');
  assert.ok(!calls[0].url.includes('secret-test-key'));
});

test('a 429 stops the run as a budget stop, not a crash', async () => {
  const impl = async () => ({ status: 429, ok: false, headers: { get: () => null }, text: async () => '{"error":"Rate limit exceeded"}' });
  const c = createClient('k', { fetchImpl: impl });
  await assert.rejects(c.call('/sets'), e => e.code === 'BUDGET' && /03:00/.test(e.message));
});

test('a server-sent reset time is reported instead of the 03:00 default', async () => {
  const h = new Map([['retry-after', '3600']]);
  const impl = async () => ({ status: 429, ok: false, headers: { get: n => h.get(n) ?? null }, text: async () => '' });
  const c = createClient('k', { fetchImpl: impl });
  await assert.rejects(c.call('/sets'), e => /retry-after: 3600/.test(e.message));
});

test('image extensions follow the content type, then the bytes', () => {
  assert.equal(extFor('image/jpeg'), 'jpg');
  assert.equal(extFor('image/png'), 'png');
  assert.equal(extFor(null, Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'webp');
});
