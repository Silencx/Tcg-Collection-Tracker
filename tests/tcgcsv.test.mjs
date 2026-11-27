// TCGplayer's catalogue (via TCGCSV) diffed against ours, and the weekly check against a
// baseline of known differences (tools/lib/tcgcsv.mjs, tools/tcgcsv-probe.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  loose, looseCard, head, numberOf, ourSets, groupCards, matchGroups, matchByCards, compareCatalogue,
  baselineOf, formatBaseline, newSince, logLines,
} from '../tools/lib/tcgcsv.mjs';

const product = (number, name = 'Card') => ({ name, extendedData: number == null ? [{ name: 'Rarity', value: 'Promo' }] : [{ name: 'Number', value: number }] });

// data/sets.json's shape, and data/cat/en/'s rows: [set, number, name, …].
const SETS = {
  names: { en: { sm8: 'Lost Thunder', g1: 'Generations', xy6: 'Roaring Skies', swsh9: 'Brilliant Stars', A1: 'Genetic Apex', tk1: 'Trainer Kit' } },
  dates: { sm8: '2018-11-02', g1: '2016-02-22', xy6: '2015-05-06', swsh9: '2022-02-25', tk1: '2015-05-06' },
  setSeries: { A1: 'tcgp' },
};
const nums = (set, n, from = 1) => Array.from({ length: n }, (_, i) => [set, String(from + i), `${set} card ${from + i}`]);
const ROWS = [...nums('sm8', 20), ...nums('g1', 10), ['g1', 'RC1', 'Snivy'], ...nums('xy6', 12), ...nums('swsh9', 5), ['A1', '1', 'Bulbasaur'], ['nope', '1', 'Ghost'], ...nums('tk1', 3)];
const ours = () => ourSets('en', { sets: SETS, rows: ROWS });

test('set names reduce to one spelling across both sides', () => {
  assert.equal(loose('SWSH09: Brilliant Stars'), loose('Brilliant Stars'));
  assert.equal(loose('XY - Roaring Skies'), loose('Roaring Skies'));
  assert.equal(loose('SM Promos'), loose('SM Black Star Promos'));
  assert.equal(loose('EX Ruby and Sapphire'), loose('Ruby & Sapphire'));
  assert.equal(loose('Mega Evolution Energies'), loose('Mega Evolution Energy'));
  assert.equal(loose('Pokémon Futsal'), loose('Futsal'));
  assert.notEqual(loose('Generations: Radiant Collection'), loose('Generations'));
});

test('a number is the part before the slash; sealed product has none', () => {
  assert.equal(head('074/111'), '074');
  assert.equal(head(' XY17 '), 'XY17');
  assert.equal(numberOf(product('074/111')), '074/111');
  assert.equal(numberOf(product(null)), null);
  assert.equal(numberOf({}), null);
});

test('our side: TCG Pocket and unknown sets are left out, and 001 is 1', () => {
  const o = ourSets('en', { sets: SETS, rows: [...ROWS, ['sm8', '001', 'Dup']] });
  assert.ok(!o.has('A1') && !o.has('nope'));
  assert.equal(o.get('sm8').numbers.size, 20);
  assert.deepEqual(o.get('g1').numbers.get('RC1'), { number: 'RC1', name: 'Snivy' });
  assert.equal(o.get('sm8').date, '2018-11-02');
  const jp = ourSets('ja', { jpSets: [{ key: 'sv1', name: 'Scarlet ex', date: '2023-01-20' }], rows: [['sv1', '001/078', 'Sprigatito'], ['zz', '1', 'x']] });
  assert.deepEqual([...jp.keys()], ['sv1']);
  assert.equal(jp.get('sv1').numbers.size, 1);
});

test('a group counts sealed product and extra prints, and keeps one entry per number', () => {
  const g = groupCards([product('1/20', 'Pikachu'), product('001/020', 'Pikachu (Cosmos Holo)'), product(null, 'Booster Box'), product('RC1', 'Snivy')]);
  assert.equal(g.sealed, 1);
  assert.equal(g.prints, 1);
  assert.deepEqual([...g.theirs.keys()], ['1', 'RC1']);
  assert.deepEqual(g.theirs.get('1'), { number: '1', name: 'Pikachu' });
  // Every numbered product, prints too: a trainer kit's two half decks share numbers.
  assert.deepEqual(g.numbered.map(c => [c.key, c.name]), [['1', 'Pikachu'], ['1', 'Pikachu (Cosmos Holo)'], ['RC1', 'Snivy']]);
});

test('card names reduce to one spelling across both sides', () => {
  assert.equal(looseCard('Lombre (#6)'), 'lombre');
  assert.equal(looseCard('Psychic Energy (#8 - Latias)'), looseCard('Psychic Energy'));
  assert.equal(looseCard('Pikachu - 58/102'), 'pikachu');
  assert.equal(looseCard('Energy Search [Manaphy]'), 'energysearch');
  assert.equal(looseCard('Jolteon-EX'), looseCard('Jolteon EX'));
  assert.equal(looseCard('Flabébé'), 'flabebe');
  assert.equal(looseCard('Ho-Oh'), 'hooh');
  assert.equal(looseCard(null), '');
});

test('groups match by name, then by date only to an unclaimed set of similar size', () => {
  const o = ours();
  const lost = { name: 'SM - Lost Thunder', publishedOn: '2018-11-02T00:00:00', cards: 20 };
  const mcd = { name: "McDonald's Promos 2018", publishedOn: '2018-11-02T00:00:00', cards: 12 };
  const roaring = { name: 'Roaring Skies Promos', publishedOn: '2015-05-06T00:00:00', cards: 12 };
  const gallery = { name: 'Brilliant Stars Gallery', publishedOn: '2022-02-25', cards: 3 };
  const tiny = { name: 'Brilliant Stars Sampler', publishedOn: '2022-02-25', cards: 2 };
  const m = matchGroups([lost, mcd, roaring, gallery, tiny], o);
  assert.deepEqual(m.get(lost), { id: 'sm8', how: 'name' });
  assert.deepEqual(m.get(mcd), { id: null, how: 'none' }, 'Lost Thunder is claimed by name');
  assert.deepEqual(m.get(roaring), { id: 'xy6', how: 'date' }, 'two sets that day; only xy6 is of a similar size');
  assert.deepEqual(m.get(gallery), { id: 'swsh9', how: 'date' }, '3 cards is within ½–2× of 5');
  assert.deepEqual(m.get(tiny), { id: null, how: 'none' }, '2 cards is not');
});

test('a name several sets share is settled by date, or not at all', () => {
  const o = ourSets('en', {
    sets: { names: { en: { a: 'Black Star Promos', b: 'Black Star Promos' } }, dates: { a: '2000-01-01' } },
    rows: [['a', '1', 'x'], ['b', '1', 'y']],
  });
  const dated = { name: 'Black Star Promos', publishedOn: '2000-01-01', cards: 1 };
  const undated = { name: 'Black Star Promos', cards: 1 };
  const m = matchGroups([dated, undated], o);
  assert.deepEqual(m.get(dated), { id: 'a', how: 'date' });
  assert.deepEqual(m.get(undated), { id: null, how: 'name ×2' });
});

const theirs = (...numbers) => new Map(numbers.map(n => [String(n).toUpperCase().replace(/\d+/g, d => String(Number(d))), { number: String(n), name: `TCGplayer ${n}` }]));
const GROUPS = () => [
  { name: 'Lost Thunder', publishedOn: '2018-11-02', cards: 21, theirs: theirs(...Array.from({ length: 20 }, (_, i) => i + 1), 21) },
  { name: 'Generations', publishedOn: '2016-02-22', cards: 9, theirs: theirs(1, 2, 3, 4, 5, 6, 7, 8, 9) },
  { name: 'XY - Generations', publishedOn: '2016-02-22', cards: 2, theirs: theirs('RC1', 'RC2') },
  { name: 'Prize Pack Series One', publishedOn: '2021-01-01', cards: 50, theirs: theirs(1, 2) },
];

test('the diff pools groups on one set and lists numbers only one side has', () => {
  const res = compareCatalogue(GROUPS(), ours());
  assert.equal(res.groups, 4);
  assert.equal(res.matched, 3, 'both Generations groups land on g1, and their numbers are pooled');
  assert.deepEqual(res.diffs.map(d => d.id), ['g1', 'sm8']);
  const sm8 = res.diffs.find(d => d.id === 'sm8');
  assert.deepEqual(sm8.theirs.map(x => x.number), ['21']);
  assert.deepEqual(sm8.ours, []);
  const g1 = res.diffs.find(d => d.id === 'g1');
  assert.deepEqual(g1.theirs.map(x => x.number), ['RC2']);
  assert.deepEqual(g1.ours.map(x => x.number), ['10']);
  assert.equal(res.unmatched.length, 1);
  assert.equal(res.unmatched[0].name, 'Prize Pack Series One');
  assert.deepEqual(res.lonely, ['swsh9', 'tk1', 'xy6']);
  assert.equal(res.onlyTheirs, 2);
  assert.equal(res.onlyOurs, 1);
  assert.equal(res.inBoth, 30);
});

// ── Matching by cards (number and card name) ───────────────────────────────────
const group = (name, products, publishedOn = '2020-01-01') => {
  const c = groupCards(products);
  return { name, publishedOn, cards: c.theirs.size, theirs: c.theirs, numbered: c.numbered };
};
const deck = (set, names) => names.map((n, i) => [set, String(i + 1), n]);
const LATIAS = ['Treecko', 'Grovyle', 'Lotad', 'Lombre', 'Fire Energy', 'Tangela', 'Tangrowth', 'Surskit', 'Acro Bike', 'Latias', 'Grass Energy', 'Potion'];
const LATIOS = ['Skitty', 'Delcatty', 'Machop', 'Machoke', 'Rhyhorn', 'Rhydon', 'Solrock', 'Psychic Energy', 'Fighting Energy', 'Latios', 'Acro Bike'];
const BURGER = ['Rowlet', 'Litten', 'Popplio', 'Pikachu', 'Grubbin', 'Rockruff', 'Cutiefly', 'Mimikyu', 'Wimpod', 'Dewpider', 'Jangmo-o', 'Lycanroc'];
const LETTERS = 'ABCDEFGHIJKL'.split('');
const radiant = ([set, n, name]) => [set, `RC${n}`, `Radiant ${name}`];
const cardOurs = () => ourSets('en', {
  sets: {
    names: { en: { 'tk-a': 'Trainer Kit (Latias)', 'tk-b': 'Trainer Kit (Latios)', mcd: 'Burger Collection 2018', sm8: 'Lost Thunder', ex10: 'Unseen Forces', exu: 'Unseen Forces Unown Collection', g1: 'Generations' } },
    dates: { sm8: '2018-11-02', mcd: '2018-10-19' },
  },
  rows: [
    ...deck('tk-a', LATIAS), ...deck('tk-b', LATIOS),   // the Latios deck's 12, a Potion, is missing
    ...deck('mcd', BURGER), ...nums('sm8', 20),
    ...nums('ex10', 20), ...LETTERS.map(l => ['exu', l, 'Unown']),
    ...nums('g1', 10), ...nums('g1', 10).map(radiant),
  ],
});
const CARD_GROUPS = () => [
  group('Trainer Kit: Latias & Latios', [
    ...LATIAS.map((n, i) => product(`${i === 4 ? 4 : i + 1}/12`, `${n} (#${i + 1})`)),   // Fire Energy filed under 4
    product('10/12', 'Latias (#10 Holo)'),                                                // another print
    ...LATIOS.map((n, i) => product(`${i + 1}/12`, `${n} (Latios)`)),
    product('12/12', 'Potion (Latios)'),
    product(null, 'Trainer Kit: Latias & Latios'),
  ], '2015-04-29'),
  group('SM - Lost Thunder', nums('sm8', 20).map(([, n, name]) => product(`${n}/214`, name)), '2018-11-02'),
  group('Burger Promos 2018', [...BURGER.map((n, i) => product(`${i + 1}/12`, n)), product('4/12', 'Pikachu (Holo)')], '2018-11-02'),
  group('EX Unseen Forces', [
    ...nums('ex10', 20).map(([, n, name]) => product(`${n}/115`, name)),
    ...[...LETTERS, 'M'].map(l => product(`${l}/28`, `Unown (${l})`)),                    // TCGdex lacks M
  ], '2005-08-22'),
  group('Generations', nums('g1', 10).map(([, n, name]) => product(`${n}/83`, name)), '2016-02-22'),
  group('Generations: Radiant Collection', nums('g1', 10).map(radiant).map(([, n, name]) => product(`${n}/RC32`, name)), '2016-02-22'),
];

test('sets found inside a group and groups found inside a set, by number and card name', () => {
  const groups = CARD_GROUPS(), o = cardOurs();
  const byGroup = matchGroups(groups, o);
  assert.deepEqual([...byGroup.values()].map(m => m.id), [null, 'sm8', null, 'ex10', 'g1', null]);
  const { sets, groups: inSet } = matchByCards(groups, o, byGroup);
  // One kit group holds both half decks; Fire Energy filed under 4 still leaves 11 of 12.
  assert.deepEqual(sets.get(groups[0]), ['tk-a', 'tk-b']);
  assert.deepEqual(sets.get(groups[2]), ['mcd'], 'released with Lost Thunder, which its name already claims');
  assert.deepEqual(sets.get(groups[3]), ['exu'], 'inside the group that matched ex10 by name');
  assert.equal(inSet.get(groups[5]), 'g1');
  assert.equal(sets.size + inSet.size, 4);
});

test('a group feeding several sets splits its cards by number and name', () => {
  const res = compareCatalogue(CARD_GROUPS(), cardOurs());
  assert.deepEqual(res.how, { cards: 3, name: 3 });
  assert.equal(res.matched, 6);
  assert.deepEqual(res.unmatched, []);
  assert.deepEqual(res.lonely, []);
  assert.deepEqual(res.byCards, ['exu', 'mcd', 'tk-a', 'tk-b']);
  const diff = Object.fromEntries(res.diffs.map(d => [d.id, [d.theirs.map(x => x.number), d.ours.map(x => x.number)]]));
  assert.deepEqual(diff, {
    ex10: [['M'], []],          // an Unown exu lacks stays with the set its group matched
    'tk-a': [[], ['5']],        // TCGplayer files Fire Energy under 4, which both decks have
    'tk-b': [['12'], []],       // the Latios Potion: tk-a's 12 is taken, so it goes where 12 is free
  });
  assert.deepEqual(res.diffs.find(d => d.id === 'tk-b').groups, ['Trainer Kit: Latias & Latios']);
  assert.equal(res.inBoth, 11 + 11 + 12 + 20 + 20 + 12 + 20);
});

test('matching by cards needs 10 cards, one place, and a group mostly of the set', () => {
  const other = n => Array.from({ length: n }, (_, i) => product(`${100 + i}/200`, `Other ${i}`));
  const o = ourSets('en', {
    sets: { names: { en: { small: 'Small', twice: 'Twice', inside: 'Inside' } } },
    rows: [...nums('small', 9), ...deck('twice', BURGER), ...deck('inside', LATIOS.slice(0, 10))],
  });
  const groups = [
    group('Nine', nums('small', 9).map(([, n, name]) => product(n, name))),
    group('One', [...BURGER.map((n, i) => product(String(i + 1), n)), ...other(4)]),
    group('Two', [...BURGER.map((n, i) => product(String(i + 1), n)), ...other(4)]),
    group('Mixed', [...LATIOS.slice(0, 10).map((n, i) => product(String(i + 1), n)), ...other(20)]),
  ];
  const { sets, groups: inSet } = matchByCards(groups, o);
  assert.equal(sets.size, 0, 'small has 9 cards; twice is in two groups; inside is a third of Mixed');
  assert.equal(inSet.size, 0, 'Nine has 9 cards; One, Two and Mixed are not 9 in 10 inside one set');
  const res = compareCatalogue(groups, o);
  assert.deepEqual(res.lonely, ['inside', 'small', 'twice']);
  assert.equal(res.unmatched.length, 4);
});

test('the baseline holds set ids and number keys, never TCGplayer names', () => {
  const res = compareCatalogue(GROUPS(), ours());
  const b = baselineOf(res, '2026-11-26T20_05_59_0000');
  assert.deepEqual(b, {
    schemaVersion: 1, build: '2026-11-26T20_05_59_0000', unmatchedGroups: 1, unmatchedSets: ['swsh9', 'tk1', 'xy6'],
    onlyTcgplayer: { g1: ['RC2'], sm8: ['21'] }, onlyOurs: { g1: ['10'] },
  });
  const text = formatBaseline(b);
  assert.deepEqual(JSON.parse(text), b);
  assert.equal(formatBaseline(JSON.parse(text)), text, 'written back byte for byte');
  assert.ok(!/TCGplayer|Generations|Prize/.test(text));
  assert.match(text, /\n    "g1": \["RC2"\],\n    "sm8": \["21"\]\n  \},/);
  assert.match(formatBaseline({}), /"onlyTcgplayer": \{\},\n  "onlyOurs": \{\}\n\}\n$/);
});

test('only differences the baseline lacks are new; ones now in both are counted', () => {
  const base = baselineOf(compareCatalogue(GROUPS(), ours()));
  assert.deepEqual(newSince(compareCatalogue(GROUPS(), ours()), base), { theirs: [], ours: [], sets: [], groups: 0, resolved: 0 });

  const groups = GROUPS();
  groups[0].theirs.set('22', { number: '22', name: 'TCGplayer 22' });       // a new number at TCGplayer
  groups[1].theirs.set('10', { number: '10', name: 'TCGplayer 10' });       // g1 10 is now in both
  groups.push({ name: 'Battle Academy', publishedOn: '2020-01-01', cards: 3, theirs: theirs(1, 2, 3) });
  const fresh = newSince(compareCatalogue(groups, ours()), base);
  assert.deepEqual(fresh.theirs, [{ id: 'sm8', numbers: ['22'] }]);
  assert.deepEqual(fresh.ours, []);
  assert.equal(fresh.groups, 1);
  assert.equal(fresh.resolved, 1);

  const none = newSince(compareCatalogue(GROUPS(), ours()), {});
  assert.deepEqual(none.theirs.map(d => d.id), ['g1', 'sm8'], 'no baseline: everything is new');
  assert.deepEqual(none.sets, ['swsh9', 'tk1', 'xy6']);
});

test('the log names set ids and numbers only, and says when nothing is new', () => {
  const res = compareCatalogue(GROUPS(), ours());
  const quiet = logLines(res, newSince(res, baselineOf(res)), { build: 'B' });
  assert.equal(quiet.length, 2);
  assert.match(quiet[0], /^\[coverage\] TCGplayer via TCGCSV \(build B\): 3 of 4 groups match our sets; 30 card numbers in both$/);
  assert.match(quiet[1], /nothing new since tools\/tcgcsv-baseline\.json \(2 numbers only TCGplayer lists and 1 only we list are known\)/);

  const loud = logLines(res, newSince(res, {}), { build: 'B' }).join('\n');
  assert.match(loud, /new: TCGplayer lists 2 number\(s\) we lack in 2 set\(s\)\n\[coverage\]     g1: RC2\n\[coverage\]     sm8: 21/);
  assert.match(loud, /new: we list 1 number\(s\) TCGplayer lacks in 1 set\(s\)\n\[coverage\]     g1: 10/);
  assert.match(loud, /our sets no TCGplayer group matches: swsh9, tk1, xy6/);
  assert.match(loud, /1 more TCGplayer group\(s\) match no set of ours/);
  assert.ok(!/TCGplayer \d|Generations|Prize|Lost Thunder/.test(loud), 'no TCGplayer product or group name');
  assert.match(logLines(res, { ...newSince(res, {}), resolved: 3 }).at(-1), /3 number\(s\) in tools\/tcgcsv-baseline\.json are now in both; node tools\/tcgcsv-probe\.mjs --update-baseline drops them/);
});

test('a long list is cut short', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `s${String(i).padStart(2, '0')}`, numbers: Array.from({ length: 45 }, (_, j) => String(j + 1)) }));
  const res = { matched: 1, groups: 1, inBoth: 0, onlyTheirs: 0, onlyOurs: 0 };
  const out = logLines(res, { theirs: many, ours: [], sets: [], groups: 0, resolved: 0 });
  assert.equal(out.filter(l => /^\[coverage\]     s\d\d: /.test(l)).length, 25);
  assert.match(out[2], / … \(\+5\)$/);
  assert.match(out.at(-1), /… and 5 more set\(s\)/);
});

test('the committed baseline is in its own format and holds ids and numbers only', () => {
  const text = readFileSync(new URL('../tools/tcgcsv-baseline.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const b = JSON.parse(text);
  assert.equal(b.schemaVersion, 1);
  assert.equal(formatBaseline(b), text);
  // `%`: TCGdex numbers exu's "?" Unown %3F.
  const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, NUM = /^[A-Za-z0-9!?.%-]{1,16}$/;
  for (const side of ['onlyTcgplayer', 'onlyOurs']) {
    for (const [id, keys] of Object.entries(b[side])) {
      assert.match(id, ID);
      assert.ok(keys.length && keys.every(k => NUM.test(k)), `${side}.${id}`);
    }
  }
  assert.ok(b.unmatchedSets.every(id => ID.test(id)));
  assert.ok(Number.isInteger(b.unmatchedGroups) && b.unmatchedGroups >= 0);
});
