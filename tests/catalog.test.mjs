// TCGdex's card catalogue: how the build turns /{lang}/cards into data/cat/
// (tools/lib/catalog.mjs), how the app reads and matches it (js/api/catalog-model.js),
// and the committed files themselves. The router's use of it is in
// router-catalog.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATALOG_LANGS, categoryCode, cardSet, catalogRows, rowLetters, shardRows, indexFile, acceptCount,
} from '../tools/lib/catalog.mjs';
import {
  naturalCompare, readCatalogIndex, readCatalogShard, shardLettersFor, matchCatalog, catalogSetCards,
  catalogSetInfo,
} from '../js/api/catalog-model.js';
import { nameShardLetters, speciesShardLetter } from '../js/api/jp-model.js';
import { namesSpecies } from '../js/api/providers/tcgdex.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = rel => JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8'));

// ── build side ────────────────────────────────────────────────────────────────

test('every category word TCGdex used, in every language, reads as P / T / E', () => {
  const seen = {
    P: ['Pokemon', 'Pokémon'],
    T: ['Trainer', 'Dresseur', 'Entrenador', 'Allenatore', 'Treinador'],
    E: ['Energy', 'Energie', 'Énergie', 'Energía', 'Energia'],
  };
  for (const [code, words] of Object.entries(seen)) for (const w of words) assert.equal(categoryCode(w), code, w);
  assert.equal(categoryCode('Stadium'), null);
  assert.equal(categoryCode(undefined), null);
});

test('the set id is the card id minus its number, hyphens in the set and all', () => {
  assert.equal(cardSet('swsh1-1', '1'), 'swsh1');
  assert.equal(cardSet('exu-!', '!'), 'exu');
  assert.equal(cardSet('tk-ex-latia-1', '1'), 'tk-ex-latia');
  assert.equal(cardSet('sv05-163', '16'), null, 'an id that does not end in its number is not guessed at');
  assert.equal(cardSet('sv05-1', ''), null);
});

test('rows are sorted by set and number, numbers as numbers', () => {
  const list = [
    { id: 'base1-10', localId: '10', name: 'Electabuzz' },
    { id: 'base1-2', localId: '2', name: 'Blastoise' },
    { id: 'base10-1', localId: '1', name: 'Alakazam' },
    { id: 'base2-1', localId: '1', name: 'Clefable' },
    { id: 'base1-2', localId: '2', name: 'Blastoise' },
    { id: 'base1-3', localId: '3', name: '' },
    { id: 'odd', localId: '7', name: 'Mew' },
  ];
  const { rows, skipped } = catalogRows(list, new Map([['base1-2', 'P']]));
  // None of these items has an `image`, hence the trailing 0 (next test).
  assert.deepEqual(rows, [
    ['base1', '2', 'Blastoise', 'P', 0], ['base1', '10', 'Electabuzz', null, 0],
    ['base2', '1', 'Clefable', null, 0], ['base10', '1', 'Alakazam', null, 0],
  ]);
  assert.deepEqual(skipped, ['base1-3', 'odd']);
  assert.ok(naturalCompare('TG2', 'TG10') < 0 && naturalCompare('SV001', 'SV001') === 0);
});

test('a card TCGdex lists without a scan gets a trailing 0, and only that card', () => {
  const { rows } = catalogRows([
    { id: 'SV1S-001', localId: '001', name: '皮卡丘', image: 'https://assets.tcgdex.net/zh-tw/SV/SV1S/001' },
    { id: 'SV1S-002', localId: '002', name: '妙蛙種子' },
    { id: 'SV1S-003', localId: '003', name: '小火龍', image: '' },
  ], new Map([['SV1S-001', 'P'], ['SV1S-002', 'P']]));
  assert.deepEqual(rows, [
    ['SV1S', '001', '皮卡丘', 'P'], ['SV1S', '002', '妙蛙種子', 'P', 0], ['SV1S', '003', '小火龍', null, 0],
  ]);
});

test('a card is filed under every word of its name; a name with no Latin letter under "0"', () => {
  assert.deepEqual(rowLetters('Pikachu & Zekrom-GX'), ['p', 'z']);
  assert.deepEqual(rowLetters("Professor's Research"), ['p', 'r']);
  assert.deepEqual(rowLetters('皮卡丘'), ['0']);
  const shards = shardRows([['sv1', '1', 'Pikachu & Zekrom-GX', 'P'], ['sv1', '2', '皮卡丘', 'P']]);
  assert.deepEqual(Object.keys(shards), ['0', 'p', 'z']);
  assert.deepEqual(shards.z, [['sv1', '1', 'Pikachu & Zekrom-GX', 'P']]);
});

test('a list that lost over a tenth of its cards does not replace the committed one', () => {
  assert.equal(acceptCount(23912, null), true, 'first build');
  assert.equal(acceptCount(23000, 23912), true);
  assert.equal(acceptCount(20000, 23912), false);
  assert.equal(acceptCount(20000, 23912, { force: true }), true);
  assert.equal(acceptCount(0, null), false, 'an empty answer never does');
});

test('nine languages, English first, and the index keeps that order', () => {
  assert.deepEqual(CATALOG_LANGS.map(l => l.code), ['en', 'de', 'fr', 'es', 'it', 'pt', 'zh-Hant', 'th', 'id']);
  assert.equal(CATALOG_LANGS.find(l => l.code === 'zh-Hant').apiCode, 'zh-tw');
  const idx = indexFile({ th: { cards: 1 }, en: { cards: 2 }, xx: { cards: 3 } });
  assert.deepEqual(Object.keys(idx.langs), ['en', 'th']);
});

// ── app side ──────────────────────────────────────────────────────────────────

test('only built files are read; malformed rows and letters are dropped, not trusted', () => {
  assert.equal(readCatalogIndex(null), null);
  assert.equal(readCatalogIndex({ langs: { en: { shards: ['a'] } } }), null, 'no builtAt');
  assert.equal(readCatalogIndex({ builtAt: 'x', langs: { en: { shards: [] } } }), null);
  assert.deepEqual(readCatalogIndex({ builtAt: 'x', langs: { en: { cards: 2, shards: ['a', '../x', 'B', '0'] } } }).langs.en.shards, ['a', '0']);
  assert.equal(readCatalogShard({ rows: [] }), null);
  assert.deepEqual(readCatalogShard({ builtAt: 'x', rows: [['sv1', '1', 'Mew', 'P'], ['sv1', 2, 'Mew'], 'junk', ['sv1', '3', '']] }),
    [['sv1', '1', 'Mew', 'P']]);
});

const SERIES = { sv05: 'sv', B1: 'tcgp', bw4: 'bw' };
const SHARDS = new Map([
  ['m', [['sv05', '20', 'Mew', 'P'], ['sv05', '21', 'Mewtwo', 'P'], ['bw4', '50', 'Mew & Mewtwo-GX', 'P']]],
  ['s', [['B1', '009', 'Seedot', 'P'], ['sv05', '30', 'Seedot & Nuzleaf-GX', 'P']]],
  ['n', [['sv05', '30', 'Seedot & Nuzleaf-GX', 'P'], ['sv05', '31', 'Nuzleaf', 'P']]],
]);

test('matching: whole words only, so Mew does not pull in Mewtwo', () => {
  const { cards } = matchCatalog(SHARDS, ['Mew'], { setSeries: SERIES });
  assert.deepEqual(cards.map(c => c.id), ['sv05-20', 'bw4-50']);
  assert.deepEqual(cards[0], {
    id: 'sv05-20', name: 'Mew', species: 'Mew', image: 'https://assets.tcgdex.net/en/sv/sv05/20', localId: '20',
  });
});

test('matching: a card two listed Pokémon share goes to the first-listed one', () => {
  const a = matchCatalog(SHARDS, ['Nuzleaf', 'Seedot'], { setSeries: SERIES });
  assert.equal(a.cards.find(c => c.id === 'sv05-30').species, 'Nuzleaf');
  const b = matchCatalog(SHARDS, ['Seedot', 'Nuzleaf'], { setSeries: SERIES });
  assert.equal(b.cards.find(c => c.id === 'sv05-30').species, 'Seedot');
  assert.equal(b.cards.find(c => c.id === 'B1-009').image, 'https://assets.tcgdex.net/en/tcgp/B1/009', 'number kept as printed');
});

test('matching: Pokémon with no card are named, and only needed shards are asked for', () => {
  assert.deepEqual(matchCatalog(SHARDS, ['Mew', 'Shiftry']).empty, ['Shiftry']);
  assert.deepEqual(shardLettersFor(['Mew', 'Mewtwo', 'Seedot', 'Zygarde'], ['m', 's', 'n']), ['m', 's']);
});

test('one set: each card once, in number order, images in the API language folder', () => {
  const cards = catalogSetCards(SHARDS.values(), 'sv05', { setSeries: SERIES });
  assert.deepEqual(cards.map(c => c.localId), ['20', '21', '30', '31']);
  const tw = catalogSetCards([[['SV1S', '001', '皮卡丘', 'P']]], 'SV1S', { setSeries: { SV1S: 'SV' }, code: 'zh-Hant' });
  assert.equal(tw[0].image, 'https://assets.tcgdex.net/zh-tw/SV/SV1S/001');
});

test('one set: a card with no scan has image null, as live getSetCards gives it', () => {
  const rows = [['SV1S', '001', '皮卡丘', 'P'], ['SV1S', '002', '妙蛙種子', 'P', 0]];
  const tw = catalogSetCards([rows], 'SV1S', { setSeries: { SV1S: 'SV' }, code: 'zh-Hant' });
  assert.deepEqual(tw.map(c => c.image), ['https://assets.tcgdex.net/zh-tw/SV/SV1S/001', null]);
  assert.deepEqual(catalogSetCards([rows], 'SV1S', { code: 'ko' }).map(c => c.image), [null, null],
    'a language TCGdex has no art for gets no address');
  // The master set still gets a base for it: it reads the card's set and era from it.
  const { cards } = matchCatalog(new Map([['m', [['sv05', '99', 'Mew', 'P', 0]]]]), ['Mew'], { setSeries: SERIES });
  assert.equal(cards[0].image, 'https://assets.tcgdex.net/en/sv/sv05/99');
});

test('the committed catalogue marks cards with no scan', () => {
  const idx = readCatalogIndex(readJson('data/cat/index.json'));
  const rows = idx.langs['zh-Hant'].shards.flatMap(l => readCatalogShard(readJson(`data/cat/zh-Hant/cards-${l}.json`)));
  const unique = new Map(rows.map(r => [`${r[0]}-${r[1]}`, r]));
  const withScan = [...unique.values()].filter(r => r[4] !== 0).length;
  // About a third of TW cards have one (2,146 of 7,436 on 2026-11-26).
  assert.ok(withScan > 0 && withScan < unique.size / 2, `${withScan} of ${unique.size}`);
});

test('the set details for a catalogue answer come from data/sets.json, per language', () => {
  const meta = {
    names: { en: { sv05: 'Temporal Forces' }, de: { sv05: 'Gewalten der Zeit' } },
    dates: { sv05: '2024-03-22' }, symbols: { sv05: 'sym' }, logos: {},
    counts: { sv05: { official: 162, total: 218 } }, setSeries: { sv05: 'sv' },
    series: { en: [{ id: 'sv', name: 'Scarlet & Violet' }], de: [{ id: 'sv', name: 'Karmesin & Purpur' }] },
    lang: { de: { counts: { sv05: { official: 162, total: 200 } } } },
  };
  assert.deepEqual(catalogSetInfo('sv05', 'de', meta), {
    id: 'sv05', name: 'Gewalten der Zeit', releaseDate: '2024-03-22', symbol: 'sym', logo: null,
    serie: { id: 'sv', name: 'Karmesin & Purpur' }, count: { official: 162, total: 200 }, lang: 'de',
  });
  assert.equal(catalogSetInfo('sv05', 'fr', meta).name, 'Temporal Forces', 'English name when the language has none');
  assert.equal(catalogSetInfo('zz', 'en', {}).name, 'zz');
});

// ── the committed files ───────────────────────────────────────────────────────

const species = readJson('data/species.json').species.map(s => s[2]);

test('every Pokémon is looked up under a letter its own name is filed under', () => {
  // Whole-word matching means a card naming the Pokémon has all of its words, so this is
  // what guarantees the one shard the app loads holds every one of its cards.
  for (const name of species) assert.ok(nameShardLetters(name).includes(speciesShardLetter(name)), name);
});

test('the committed catalogue reads, and its shards are all there', () => {
  const idx = readCatalogIndex(readJson('data/cat/index.json'));
  assert.ok(idx, 'data/cat/index.json must read');
  assert.deepEqual(Object.keys(idx.langs), CATALOG_LANGS.map(l => l.code));
  assert.ok(idx.langs.en.cards > 20000);
  for (const [code, s] of Object.entries(idx.langs)) {
    for (const l of s.shards) assert.ok(existsSync(resolve(ROOT, `data/cat/${code}/cards-${l}.json`)), `${code}/cards-${l}`);
  }
});

test('the English catalogue finds exactly what scanning every card would (sample)', () => {
  const idx = readCatalogIndex(readJson('data/cat/index.json'));
  const shards = new Map(idx.langs.en.shards.map(l => [l, readCatalogShard(readJson(`data/cat/en/cards-${l}.json`))]));
  const all = [...new Map([...shards.values()].flat().map(r => [`${r[0]}-${r[1]}`, r])).values()];
  const sample = species.filter((_, i) => i % 25 === 0).concat(['Mew', 'Nidoran♀', "Farfetch'd", 'Ho-Oh', 'Porygon-Z', 'Mr. Mime']);
  for (const name of sample) {
    const want = all.filter(r => namesSpecies(r[2], name)).map(r => `${r[0]}-${r[1]}`).sort();
    const got = matchCatalog(shards, [name]).cards.map(c => c.id).sort();
    assert.deepEqual(got, want, name);
  }
});
