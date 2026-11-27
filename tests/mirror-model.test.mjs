// Korean and Simplified Chinese became LANGUAGES (Phase 7 of docs/card-coverage-plan.md).
// Before, they were a placeholder-only list, and their tiles on English cards in Master
// Set and TMS were ticked as KR_{English card id} / SC_{English card id}. Those ticks are
// in people's saved data, so the ids must not move: ui/mirror-model.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LANGUAGES, BADGE_ORDER } from '../js/config.js';
import { mirrorTileId, mirrorLangs, cardListShare, mirrorNotice } from '../js/ui/mirror-model.js';
import { pickerLanguages, buildSetList } from '../js/ui/setmode-model.js';

test('Korean and Simplified Chinese are TCGdex languages, after Indonesian', () => {
  assert.deepEqual(LANGUAGES.map(l => l.badge), ['EN', 'DE', 'FR', 'ES', 'IT', 'PT', 'TW', 'TH', 'ID', 'KR', 'SC']);
  const kr = LANGUAGES.find(l => l.badge === 'KR'), sc = LANGUAGES.find(l => l.badge === 'SC');
  assert.deepEqual([kr.code, kr.apiCode, kr.mirror], ['ko', 'ko', 'placeholder']);
  assert.deepEqual([sc.code, sc.apiCode, sc.mirror], ['zh-Hans', 'zh-cn', 'placeholder']);
  // Every badge still has its place in the pill order.
  for (const l of LANGUAGES) assert.ok(BADGE_ORDER.includes(l.badge), l.badge);
});

test('on an English card, KR and SC tiles are placeholders and the rest get art', () => {
  const { art, placeholder } = mirrorLangs();
  assert.deepEqual(placeholder.map(l => l.badge), ['KR', 'SC']);
  assert.deepEqual(art.map(l => l.badge), ['EN', 'DE', 'FR', 'ES', 'IT', 'PT', 'TW', 'TH', 'ID']);
  assert.deepEqual([...art, ...placeholder], LANGUAGES);
});

test('every tile id on an English card is what it was before', () => {
  const ids = LANGUAGES.map(l => mirrorTileId(l, 'sv04-001'));
  assert.deepEqual(ids, [
    'EN_sv04-001', 'DE_sv04-001', 'FR_sv04-001', 'ES_sv04-001', 'IT_sv04-001', 'PT_sv04-001',
    'TW_sv04-001', 'TH_sv04-001', 'ID_sv04-001', 'KR_sv04-001', 'SC_sv04-001',
  ]);
});

const META = {
  names: {
    en: { sv05: 'Temporal Forces' },
    ko: { SV4M: '퓨처 플래시', SV4K: '와일드 포스', SV2a: '포켓몬 카드 151', A1: 'Pocket' },
    'zh-Hans': { CSV1C: '亘古开来' },
  },
  setSeries: { A1: 'tcgp', SV4M: 'SV', SV4K: 'SV', SV2a: 'SV', CSV1C: 'SV' },
  counts: { SV4M: { official: 66, total: 66 } },
  lang: { ko: { noCards: ['SV2a', 'SV4K'], counts: { SV4M: { official: 66, total: 95 } } }, 'zh-Hans': { noCards: ['CSV1C'] } },
};

test('how many sets have a card list, physical sets only', () => {
  assert.deepEqual(cardListShare(META, 'ko'), { sets: 3, withCards: 1 });
  assert.deepEqual(cardListShare(META, 'zh-Hans'), { sets: 1, withCards: 0 });
  assert.equal(cardListShare(META, 'th'), null);
  assert.equal(cardListShare(null, 'ko'), null);
});

test('the bell note says what TCGdex has, and works without data/sets.json', () => {
  const kr = LANGUAGES.find(l => l.badge === 'KR');
  const note = mirrorNotice(kr, cardListShare(META, 'ko'));
  assert.match(note, /^<strong>Korean \(KR\)<\/strong>: /);
  assert.match(note, /TCGdex has card lists for 1 of 3 Korean sets so far; Single set shows them\./);
  assert.match(note, /The KR tiles here stay placeholders/);
  assert.match(note, /href="https:\/\/krystalkollectz\.com\/pages\/card-lists" target="_blank" rel="noopener"/);
  const bare = mirrorNotice(kr, null);
  assert.match(bare, /Single set shows the Korean sets TCGdex lists\./);
  assert.doesNotMatch(bare, /undefined|null/);
  // The label's bracket stays in the heading, not in the sentence.
  const sc = mirrorNotice(LANGUAGES.find(l => l.badge === 'SC'), { sets: 41, withCards: 1 });
  assert.match(sc, /^<strong>Simplified Chinese \(CN\) \(SC\)<\/strong>: TCGdex has card lists for 1 of 41 Simplified Chinese sets/);
  assert.match(sc, /no Simplified Chinese card is also/);
});

test('Set mode offers Korean and Simplified Chinese with their own sets', () => {
  const langs = pickerLanguages(META);
  assert.deepEqual(langs.map(l => l.badge), ['EN', 'KR', 'SC']);
  assert.equal(langs.find(l => l.badge === 'KR').count, 3);   // TCG Pocket left out
  const rows = buildSetList(META, { lang: 'ko' });
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.equal(byId.SV4M.empty, false);
  assert.equal(byId.SV4K.empty, true);
  assert.deepEqual(byId.SV4M.count, { official: 66, total: 95 });
});
