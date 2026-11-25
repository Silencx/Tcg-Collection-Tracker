// The Pokémon catalogue: data/species.json from PokéAPI (tools/build-species.mjs,
// tools/lib/species.mjs), how the app reads and searches it (js/api/species-model.js),
// the dashboard's "N of M", and the fallback to the built-in lists when the file is
// missing. fetch is stubbed where the loader is tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanName, genNumber, speciesRow, speciesFile } from '../tools/lib/species.mjs';
import {
  readSpeciesFile, mergeNativeNames, foldName, searchSpecies, catalogGens,
} from '../js/api/species-model.js';
import { trackedOfCatalog } from '../js/ui/dashboard-model.js';
import { POKEMON_CATALOG, NATIVE_NAMES } from '../js/config.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The shape of a real /pokemon-species/{id} answer, cut to what the build reads.
const raw = (id, gen, names) => ({
  id, generation: { name: `generation-${gen}` },
  names: Object.entries(names).map(([language, name]) => ({ language: { name: language }, name })),
});
const FARFETCHD = raw(83, 'i', {
  'ja-hrkt': 'カモネギ', 'ja-roma': 'Kamonegi', ko: '파오리', 'zh-hant': '大蔥鴨', fr: 'Canarticho',
  de: 'Porenta', es: 'Farfetch’d', it: 'Farfetch’d', en: 'Farfetch’d', ja: 'カモネギ', 'zh-hans': '大葱鸭',
});

test('PokéAPI names get the apostrophe TCGdex uses', () => {
  assert.equal(cleanName('Farfetch’d'), "Farfetch'd");
  assert.equal(cleanName('  Mr.  Mime '), 'Mr. Mime');
});

test('generation names read as numbers', () => {
  assert.deepEqual(['generation-i', 'generation-iv', 'generation-ix', 'generation-x'].map(genNumber), [1, 4, 9, 10]);
  assert.equal(genNumber('gen-1'), null);
});

test('a species row keeps native names that differ from English', () => {
  const r = speciesRow(FARFETCHD);
  assert.deepEqual(r, {
    dex: 83, gen: 1, name: "Farfetch'd",
    native: { JP: 'カモネギ', KR: '파오리', TW: '大蔥鴨', SC: '大葱鸭', DE: 'Porenta', FR: 'Canarticho' },
  });
});

test('Japanese falls back to plain "ja" when there is no katakana name', () => {
  assert.equal(speciesRow(raw(1, 'i', { en: 'Bulbasaur', ja: 'フシギダネ' })).native.JP, 'フシギダネ');
});

test('a species with no dex, generation or English name is rejected', () => {
  assert.equal(speciesRow(raw(1, 'i', { de: 'Bisasam' })), null);
  assert.equal(speciesRow({ ...raw(1, 'i', { en: 'Bulbasaur' }), generation: null }), null);
  assert.equal(speciesRow({ ...raw(0, 'i', { en: 'X' }) }), null);
});

test('the file is sorted by dex, with parallel native columns', () => {
  const rows = [
    speciesRow(raw(2, 'i', { en: 'Ivysaur', de: 'Bisaknosp' })),
    speciesRow(raw(1, 'i', { en: 'Bulbasaur', de: 'Bisasam', es: 'Bulbasaur' })),
    speciesRow(raw(1, 'i', { en: 'Duplicate' })),
    null,
  ];
  const f = speciesFile(rows);
  assert.deepEqual(f.species, [[1, 1, 'Bulbasaur'], [2, 1, 'Ivysaur']]);
  assert.deepEqual(f.native, { DE: ['Bisasam', 'Bisaknosp'] }, 'a column with no names is left out');
  assert.equal(f.source, 'pokeapi');
});

test('the app reads the file into a catalogue and name maps', () => {
  const sp = readSpeciesFile({ ...speciesFile([speciesRow(FARFETCHD), speciesRow(raw(1, 'i', { en: 'Bulbasaur' }))]), builtAt: 'x' });
  assert.deepEqual(sp.catalog, [{ name: 'Bulbasaur', dex: 1, gen: 1 }, { name: "Farfetch'd", dex: 83, gen: 1 }]);
  assert.deepEqual(sp.native.JP, { "Farfetch'd": 'カモネギ' });
});

test('anything not shaped like a built file is refused, so the built-in lists stay', () => {
  const good = { builtAt: 'x', species: [[1, 1, 'Bulbasaur']], native: {} };
  assert.ok(readSpeciesFile(good));
  assert.equal(readSpeciesFile(null), null);
  assert.equal(readSpeciesFile({ ...good, builtAt: null }), null);
  assert.equal(readSpeciesFile({ ...good, species: [] }), null);
  assert.equal(readSpeciesFile({ ...good, species: [[1, 1, 'Bulbasaur'], ['2', 1, 'Ivysaur']] }), null);
  // A column of the wrong length would name the wrong Pokémon: it is dropped, not used.
  assert.deepEqual(readSpeciesFile({ ...good, native: { JP: ['フシギダネ', 'extra'] } }).native, {});
});

test('native names from the file win over the built-in ones, badge by badge', () => {
  const merged = mergeNativeNames({ JP: { Seedot: 'old' }, KR: { Seedot: '도토링' } }, { JP: { Seedot: 'タネボー', Pikachu: 'ピカチュウ' } });
  assert.deepEqual(merged, { JP: { Seedot: 'タネボー', Pikachu: 'ピカチュウ' }, KR: { Seedot: '도토링' } });
});

const CATALOG = [
  { name: 'Pikachu', dex: 25, gen: 1 }, { name: 'Raichu', dex: 26, gen: 1 },
  { name: 'Mew', dex: 151, gen: 1 }, { name: 'Mewtwo', dex: 150, gen: 1 },
  { name: 'Pichu', dex: 172, gen: 2 }, { name: 'Flabébé', dex: 669, gen: 6 },
];
const NATIVE = { JP: { Pikachu: 'ピカチュウ' }, DE: { Flabébé: 'Flabébé' }, FR: { Raichu: 'Raichu' } };
const names = list => list.map(p => p.name);

test('picker search: English name, native name, accents and case ignored', () => {
  assert.deepEqual(names(searchSpecies(CATALOG, 'pi', { native: NATIVE })), ['Pikachu', 'Pichu']);
  assert.deepEqual(names(searchSpecies(CATALOG, 'ピカ', { native: NATIVE })), ['Pikachu']);
  assert.deepEqual(names(searchSpecies(CATALOG, 'FLABEBE')), ['Flabébé']);
  assert.equal(foldName('Flabébé'), 'flabebe');
  assert.equal(foldName('ダーテング'), 'ダーテング', 'kana keep their voicing marks');
});

test('picker search: a number finds that dex entry', () => {
  assert.deepEqual(names(searchSpecies(CATALOG, '25')), ['Pikachu']);
  assert.deepEqual(names(searchSpecies(CATALOG, '#151')), ['Mew']);
});

test('picker search: tracked Pokémon and other generations are left out', () => {
  assert.deepEqual(names(searchSpecies(CATALOG, 'mew', { exclude: ['Mew'] })), ['Mewtwo']);
  assert.deepEqual(names(searchSpecies(CATALOG, '', { gen: 2 })), ['Pichu']);
  assert.equal(searchSpecies(CATALOG, '').length, CATALOG.length, 'an empty query matches everything');
  assert.deepEqual(catalogGens(CATALOG), [1, 2, 6]);
});

test('the dashboard counts tracked Pokémon against the catalogue in use', () => {
  const full = readSpeciesFile(JSON.parse(readFileSync(resolve(ROOT, 'data/species.json'), 'utf8')));
  assert.equal(trackedOfCatalog(['Seedot', 'Nuzleaf', 'Shiftry'], full.catalog), `3 of ${full.catalog.length.toLocaleString('en-US')}`);
  assert.equal(trackedOfCatalog(['Seedot'], POKEMON_CATALOG), '1 of 357');
  assert.equal(trackedOfCatalog(), '0 of 0');
});

test('the committed file is the whole National Dex and keeps every built-in name', () => {
  const json = JSON.parse(readFileSync(resolve(ROOT, 'data/species.json'), 'utf8'));
  const sp = readSpeciesFile(json);
  assert.ok(sp, 'data/species.json must read');
  assert.ok(sp.catalog.length >= 1025);
  assert.deepEqual(sp.catalog.map(p => p.dex), sp.catalog.map((_, i) => i + 1), 'dex numbers 1..N');
  // A tracked Pokémon is stored by name: a built-in name the file spelled differently
  // would drop out of everyone's picker and Master set.
  const byName = new Map(sp.catalog.map(p => [p.name, p]));
  for (const p of POKEMON_CATALOG) {
    assert.ok(byName.has(p.name), `${p.name} is in the file`);
    assert.equal(byName.get(p.name).dex, p.dex, `${p.name} dex`);
    assert.equal(byName.get(p.name).gen, p.gen, `${p.name} gen`);
  }
  // And the hand-made native names agree with PokéAPI's.
  for (const [badge, map] of Object.entries(NATIVE_NAMES)) {
    for (const [en, nat] of Object.entries(map)) assert.equal(sp.native[badge]?.[en], nat, `${badge} ${en}`);
  }
  // Names TCGdex spells with a straight apostrophe.
  assert.ok(byName.has("Farfetch'd") && byName.has("Sirfetch'd"));
});

test('loading: a missing or broken file resolves to null, never throws', async () => {
  const realFetch = globalThis.fetch;
  const { loadSpecies } = await import('../js/api/species.js');
  try {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => null });
    assert.equal(await loadSpecies(), null);
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } });
    assert.equal(await loadSpecies(), null);
    globalThis.fetch = async () => { throw new TypeError('offline'); };
    assert.equal(await loadSpecies(), null);
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ builtAt: 'x', species: [[1, 1, 'Bulbasaur']] }) });
    assert.deepEqual((await loadSpecies()).catalog, [{ name: 'Bulbasaur', dex: 1, gen: 1 }]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the app starts from the built-in lists and only boot swaps in the file', () => {
  // state.js reads localStorage at import time, so this is a source check: the defaults
  // are the config.js fallbacks, and the readers go through state, not config.js.
  const stateSrc = readFileSync(resolve(ROOT, 'js/state.js'), 'utf8');
  assert.match(stateSrc, /speciesCatalog:\s+POKEMON_CATALOG,/);
  assert.match(stateSrc, /nativeNames:\s+NATIVE_NAMES,/);
  for (const rel of ['js/ui/pickers.js', 'js/ui/onboarding.js', 'js/ui/tms.js', 'js/ui/dashboard.js',
    'js/ui/masterset.js', 'js/ui/setmode.js', 'js/ui/print.js']) {
    const src = readFileSync(resolve(ROOT, rel), 'utf8');
    assert.doesNotMatch(src, /\b(POKEMON_CATALOG|NATIVE_NAMES)\b/, `${rel} reads the catalogue from state`);
  }
});
