// =============================================================================
// tools/lib/coverage.mjs — where the card lists we serve fall short of a set's own count.
//
// Pure: tools/build-data.mjs hands it what it already fetched (TCGdex's card list for
// every set in every language) and the committed Japanese catalogue, and prints the
// result. Nothing here is published; the full report stays local.
//
// Three kinds of gap, per set and language:
//   missing     a hole in the set's main run: number 1..official has no card
//   short       the main run is complete, but other languages list more cards for the set
//               (usually secret rares)
//   duplicate   one number listed twice, or more cards than the set holds
//
// What "total" means: TCGdex's cardCount.total is the number of cards IT holds for the set
// in that language, not a printed figure (measured 2026-11-25: Legendary Treasures is
// 140 in English, 131 in German, 113 in Spanish, official 113 in all three; a set with
// no cards at all, like Radiant Collection, reports its official size). So the set's
// total here is the most cards any language lists or counts for that set id.
// =============================================================================

/** A card number's place in a set's main run: "001" → 1, "7" → 7. Anything else
 *  ("RC5", "TG01", "SWSH001", "n-pikachu") is outside the run → null. */
export function runNumber(n) {
  const m = String(n ?? '').trim().match(/^0*(\d+)$/);
  return m ? Number(m[1]) : null;
}

// "001" and "1" are the same card; "rc5" and "RC5" too.
const cardKey = n => {
  const r = runNumber(n);
  return r != null ? `#${r}` : String(n ?? '').trim().toUpperCase();
};

/** How many different cards a list of numbers names. */
const distinctCards = numbers =>
  new Set((numbers || []).map(n => String(n ?? '').trim()).filter(Boolean).map(cardKey)).size;

const positive = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);

/**
 * Compare one set in one language with its count.
 *
 * When at least half the numbers we list are plain numbers, the main run is checked
 * number by number, so a secret rare (199/198) never fills a hole at #17. Otherwise
 * (promo sets numbered "SWSH001", "SM01") only the counts are compared.
 *
 * @param {{official?:number,total?:number}|null} count  official = printed set size;
 *   total = all cards of the set, secret rares included, when known
 * @param {Array<string|number>} numbers  one entry per card we list
 * @returns {null | {listed:number, official:number, total:number|null, missing:number,
 *   missingNumbers:number[]|null, short:number, duplicates:string[], over:number}}
 *   null when there is no count to compare with. missingNumbers is null when the run
 *   could not be checked number by number.
 */
export function compareSet(count, numbers) {
  const official = positive(count?.official);
  if (!official) return null;
  const total = positive(count?.total) >= official ? positive(count.total) : null;

  const seen = new Map();   // key → first spelling
  const dupes = new Set();
  for (const raw of numbers || []) {
    const n = String(raw ?? '').trim();
    if (!n) continue;
    const k = cardKey(n);
    if (seen.has(k)) dupes.add(seen.get(k));
    else seen.set(k, n);
  }
  const listed = seen.size;
  const runs = [...seen.keys()].filter(k => k.startsWith('#')).map(k => Number(k.slice(1)));

  let missing, missingNumbers = null;
  if (listed && runs.length * 2 >= listed) {
    const have = new Set(runs);
    missingNumbers = [];
    for (let i = 1; i <= official; i++) if (!have.has(i)) missingNumbers.push(i);
    missing = missingNumbers.length;
  } else {
    missing = Math.max(0, official - listed);
  }
  // Whatever of the total is neither listed nor already counted as a hole in the run.
  const short = total ? Math.max(0, total - listed - missing) : 0;
  const over = total ? Math.max(0, listed - total) : 0;
  return { listed, official, total, missing, missingNumbers, short, duplicates: [...dupes].sort(), over };
}

/** Does a comparison show a gap of any kind? */
export const hasGap = c => !!c && (c.missing > 0 || c.short > 0 || c.over > 0 || c.duplicates.length > 0);

/**
 * Every set with a gap.
 * @param {Array<{lang:string, set:string, name?:string, count:object|null,
 *   numbers:Array|undefined}>} entries  numbers undefined = we could not read the list
 *   (a failed request), which is not the same as an empty one
 * @returns {{langs:string[], checked:number, gaps:object[], unchecked:object[]}}
 *   gaps sorted by language (in the order the entries first name them), then set id
 */
export function findGaps(entries) {
  const langs = [];
  const gaps = [], unchecked = [];
  let checked = 0;
  for (const e of entries || []) {
    if (!langs.includes(e.lang)) langs.push(e.lang);
    if (!Array.isArray(e.numbers)) { unchecked.push({ lang: e.lang, set: e.set, reason: 'no card list read' }); continue; }
    const c = compareSet(e.count, e.numbers);
    if (!c) { unchecked.push({ lang: e.lang, set: e.set, reason: 'no set count' }); continue; }
    checked++;
    if (hasGap(c)) gaps.push({ lang: e.lang, set: e.set, name: e.name ?? e.set, ...c });
  }
  const order = l => langs.indexOf(l);
  const bySet = (a, b) => order(a.lang) - order(b.lang) || (a.set < b.set ? -1 : a.set > b.set ? 1 : 0);
  return { langs, checked, gaps: gaps.sort(bySet), unchecked: unchecked.sort(bySet) };
}

/**
 * The TCGdex side, from the same object build-data writes to data/sets.json.
 * @param {object} meta  getSetMeta's result (names, counts, lang[code].counts/noCards)
 * @param {object} numbersByLang  { langCode: { setId: [localId…] } } from the set details
 *   the build already fetches; a set missing here had its request fail
 * @param {object} [opts]
 * @param {(setId:string)=>boolean} [opts.skip]  sets to leave out (TCG Pocket)
 */
export function tcgdexEntries(meta, numbersByLang = {}, { skip = () => false } = {}) {
  const names = meta?.names || {};
  const countFor = (lang, id) => meta?.lang?.[lang]?.counts?.[id] ?? meta?.counts?.[id] ?? null;
  // The set's total is the most cards any language lists for that id. Latin languages
  // share ids with English; zh-Hant, th and id share theirs with each other only.
  // The list itself counts too: data/sets.json keeps a language's own count only where it
  // differs from English's, and keeps one count for an id the Asian languages share.
  const most = new Map();
  for (const [lang, sets] of Object.entries(names)) {
    for (const id of Object.keys(sets || {})) {
      const listed = distinctCards(numbersByLang[lang]?.[id]);
      most.set(id, Math.max(most.get(id) ?? 0, positive(countFor(lang, id)?.total), listed));
    }
  }
  const out = [];
  for (const [lang, sets] of Object.entries(names)) {
    for (const [id, name] of Object.entries(sets || {})) {
      if (skip(id)) continue;
      const c = countFor(lang, id);
      out.push({
        lang, set: id, name,
        count: c ? { official: c.official, total: most.get(id) } : null,
        numbers: numbersByLang[lang]?.[id],
      });
    }
  }
  return out;
}

/** "001/165" → 165; "058/DP-P", "13", "" → null. */
export function printedSetSize(number) {
  const m = String(number ?? '').match(/^\s*[^/\s]+\s*\/\s*0*(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

/**
 * The Japanese side, from the committed catalogue (data/jp-cat/). PokéWallet gives no set
 * size, so it is read off the cards themselves: the denominator most of the set's
 * numbers print ("001/011" → 11). A set with no such denominator (promos "001/SV-P",
 * every numberless WotC set) has no count and is left unchecked. A print of a card
 * ("1--mirror-holofoil") counts as that card.
 * @param {Array<{key:string,name:string}>} sets  data/jp-cat/sets.json `sets`
 * @param {Array<Array>} rows  [setKey, number, name, print, numKey] from cards-*.json
 * @param {string} [lang]
 */
export function jpEntries(sets, rows, lang = 'ja') {
  const bySet = new Map((sets || []).map(s => [s.key, { name: s.name, nums: new Set(), sizes: new Map() }]));
  for (const r of rows || []) {
    const s = bySet.get(r?.[0]);
    if (!s) continue;
    // "5--ash-vs-team-rocket-deck-kit" is card 5, whether or not a plain "5" row exists:
    // PokéWallet files some cards ONLY under a print name ("Delta Species").
    const base = String(r[4] ?? '').split('--')[0];
    if (base) s.nums.add(base);
    const size = printedSetSize(r[1]);
    if (size) s.sizes.set(size, (s.sizes.get(size) || 0) + 1);
  }
  const out = [];
  for (const [key, s] of bySet) {
    // The most common denominator, and only when most numbered cards agree on it.
    const sized = [...s.sizes.values()].reduce((a, b) => a + b, 0);
    const [size, hits] = [...s.sizes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] || [];
    const official = size && hits * 2 > sized ? size : null;
    out.push({ lang, set: key, name: s.name, count: official ? { official } : null, numbers: [...s.nums] });
  }
  return out;
}

/** [1,2,3,7,9,10] → "1-3, 7, 9-10" */
export function numberRanges(nums) {
  const parts = [];
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
    i = j;
  }
  return parts.join(', ');
}

/** "-9" for nine cards missing, "+2" for two duplicates, "-1 +1" for both. */
const gapToken = g => {
  const lack = g.missing + g.short;
  const extra = Math.max(g.over, g.duplicates.length);
  return [lack ? `-${lack}` : '', extra ? `+${extra}` : ''].filter(Boolean).join(' ');
};

/** Build-log lines: a headline, then one line per language naming every set with a gap. */
export function summaryLines({ langs, checked, gaps, unchecked }, { prefix = '[coverage]' } = {}) {
  const lines = [`${prefix} ${checked} set lists checked, ${gaps.length} with a gap, ` +
    `${unchecked.length} unchecked (-N missing, +N duplicate)`];
  for (const lang of langs) {
    const mine = gaps.filter(g => g.lang === lang);
    const skipped = unchecked.filter(u => u.lang === lang).length;
    if (!mine.length) {
      lines.push(`${prefix}   ${lang}: no gaps` + (skipped ? ` (${skipped} unchecked)` : ''));
      continue;
    }
    const cards = mine.reduce((n, g) => n + g.missing + g.short, 0);
    lines.push(`${prefix}   ${lang}: ${mine.length} set(s), ${cards} card(s) missing` +
      (skipped ? `, ${skipped} unchecked` : '') + ' — ' +
      mine.map(g => `${g.set} ${gapToken(g)}`).join(', '));
  }
  return lines;
}

const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ');

/** The local Markdown report (tools/coverage-report.md). */
export function reportMarkdown({ langs, checked, gaps, unchecked }, { builtAt = '' } = {}) {
  const out = ['# Card coverage report', ''];
  if (builtAt) out.push(`Built ${builtAt} by \`tools/build-data.mjs\`. Local only, never committed.`, '');
  out.push(`${checked} set lists checked, ${gaps.length} with a gap, ${unchecked.length} unchecked.`, '',
    '- **Missing**: numbers 1..official with no card. **Short**: cards beyond the main run that',
    '  another language lists. **Total**: the most cards any language lists for the set.',
    '- A set with no card list at all shows every official number as missing.', '');
  for (const lang of langs) {
    const mine = gaps.filter(g => g.lang === lang);
    const skipped = unchecked.filter(u => u.lang === lang);
    out.push(`## ${lang}`, '');
    if (mine.length) {
      out.push('| Set | Name | Listed | Official | Total | Missing | Short | Duplicates | Missing numbers |',
        '|---|---|---:|---:|---:|---:|---:|---|---|');
      for (const g of mine) {
        const which = g.listed === 0 ? 'no card list'
          : g.missingNumbers ? numberRanges(g.missingNumbers) : '(not numbered)';
        out.push(`| ${cell(g.set)} | ${cell(g.name)} | ${g.listed} | ${g.official} | ${g.total ?? ''} | ` +
          `${g.missing} | ${g.short} | ${cell([...g.duplicates, ...(g.over ? [`${g.over} over total`] : [])].join(', '))} | ` +
          `${cell(g.missing ? which : '')} |`);
      }
    } else {
      out.push('No gaps.');
    }
    if (skipped.length) {
      out.push('', `Unchecked (${skipped.length}): ` +
        skipped.map(u => `${u.set} (${u.reason})`).join(', '));
    }
    out.push('');
  }
  return out.join('\n');
}
