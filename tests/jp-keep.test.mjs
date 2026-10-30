// The JP guard exists for the case where the network is what is broken, so none of this
// touches it: fetchJpRawByName gets a stub fetch, and the keep-previous policy is pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideJpShard, planJpSnapshot } from '../tools/lib/jp-keep.mjs';
import { fetchJpRaw, fetchJpRawByName } from '../js/api/bulba-jp.js';

const e = (pokemonName, jpnum) => ({ jpset: 'Cyber Judge', jpnum, pokemonName });
const ok = (name, entries) => ({ name, ok: true, entries });
const failed = (name, error = 'HTTP 403') => ({ name, ok: false, entries: [], error });

test('a failed fetch keeps the committed shard', () => {
  const prev = [e('Seedot', '001/101'), e('Seedot', '002/101')];
  const d = decideJpShard(failed('Seedot'), prev);
  assert.equal(d.write, false);
  assert.equal(d.entries, prev);
  assert.match(d.warning, /HTTP 403/);
});

test('a failed fetch with nothing committed writes no shard at all', () => {
  // An empty shard would tell visitors "no JP cards"; a missing one sends them live.
  const d = decideJpShard(failed('Seedot'), null);
  assert.equal(d.write, false);
  assert.equal(d.entries, null);
  assert.ok(d.warning);
});

test('an answer with fewer entries than committed keeps the committed shard', () => {
  const prev = [e('Seedot', '001/101'), e('Seedot', '002/101')];
  for (const got of [[], [e('Seedot', '001/101')]]) {
    const d = decideJpShard(ok('Seedot', got), prev);
    assert.equal(d.write, false);
    assert.equal(d.entries, prev);
    assert.match(d.warning, /committed shard has 2/);
  }
});

test('an answer with as many or more entries is written', () => {
  const prev = [e('Seedot', '001/101')];
  const same = [e('Seedot', '009/101')];
  const more = [e('Seedot', '001/101'), e('Seedot', '002/101')];
  assert.deepEqual(decideJpShard(ok('Seedot', same), prev), { write: true, entries: same, warning: null });
  assert.deepEqual(decideJpShard(ok('Seedot', more), prev), { write: true, entries: more, warning: null });
});

test('a real "no JP cards" answer is written when nothing was committed', () => {
  assert.deepEqual(decideJpShard(ok('Seedot', []), null), { write: true, entries: [], warning: null });
});

test('an all-failed build leaves every shard untouched', () => {
  const names = ['Seedot', 'Nuzleaf'];
  const plan = planJpSnapshot(
    names,
    names.map(n => failed(n)),
    { Seedot: [e('Seedot', '001/101')], Nuzleaf: [e('Nuzleaf', '002/101')] },
  );
  assert.ok(names.every(n => plan.shards[n].write === false));
});

test('results are matched by name, not by position', () => {
  const plan = planJpSnapshot(
    ['Seedot', 'Nuzleaf'],
    [ok('Nuzleaf', [e('Nuzleaf', '002/101')]), failed('Seedot')],
    { Seedot: [e('Seedot', '001/101')], Nuzleaf: null },
  );
  assert.equal(plan.shards.Seedot.write, false);
  assert.deepEqual(plan.shards.Nuzleaf.entries.map(x => x.jpnum), ['002/101']);
});

// ── fetchJpRawByName: failure must be distinguishable from "no JP cards" ──

const stubFetch = (byPage) => async (url) => {
  const page = decodeURIComponent(new URL(url).searchParams.get('page'));
  const r = byPage[page];
  if (r instanceof Error) throw r;
  return {
    ok: r.status === 200,
    status: r.status,
    json: async () => (typeof r.body === 'string' ? JSON.parse(r.body) : r.body),
  };
};

test('fetchJpRawByName reports blocks, network errors and API errors as failures', async () => {
  const fetchImpl = stubFetch({
    'Seedot_(TCG)': { status: 403, body: '<html>blocked</html>' },
    'Nuzleaf_(TCG)': new TypeError('fetch failed'),
    'Shiftry_(TCG)': { status: 200, body: { error: { code: 'ratelimited' } } },
  });
  const rows = await fetchJpRawByName(['Seedot', 'Nuzleaf', 'Shiftry'], fetchImpl);
  assert.deepEqual(rows.map(r => r.ok), [false, false, false]);
  assert.match(rows[0].error, /HTTP 403/);
  assert.match(rows[1].error, /fetch failed/);
  assert.match(rows[2].error, /ratelimited/);
  // The browser-facing wrapper keeps its old contract: failures just contribute nothing.
  assert.deepEqual(await fetchJpRaw(['Seedot', 'Nuzleaf', 'Shiftry'], fetchImpl), []);
});

test('fetchJpRawByName treats a missing page or a page without JP cards as a real answer', async () => {
  const wikitext = '{{card list/release|jpset=Cyber Judge|jpnum=001/101}}';
  const fetchImpl = stubFetch({
    'Seedot_(TCG)': { status: 200, body: { parse: { wikitext: { '*': wikitext } } } },
    'Nuzleaf_(TCG)': { status: 200, body: { parse: { wikitext: { '*': 'no card lists here' } } } },
    'Shiftry_(TCG)': { status: 200, body: { error: { code: 'missingtitle' } } },
  });
  const rows = await fetchJpRawByName(['Seedot', 'Nuzleaf', 'Shiftry'], fetchImpl);
  assert.deepEqual(rows.map(r => [r.name, r.ok, r.entries.length]),
    [['Seedot', true, 1], ['Nuzleaf', true, 0], ['Shiftry', true, 0]]);
  assert.deepEqual(rows[0].entries[0], { jpset: 'Cyber Judge', jpnum: '001/101', pokemonName: 'Seedot' });
});
