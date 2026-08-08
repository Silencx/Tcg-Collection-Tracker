// =============================================================================
// ui/setnav-index.js — the set-navigation sidebar's DATA rules, as pure functions.
//
// DOM-FREE on purpose (like ui/html.js, ui/session-codec.js and ui/filter-pass.js)
// so `node --test` can cover the grouping, id and matching rules without a jsdom
// dependency. setnav.js reads the live DOM, hands the results here as plain
// descriptors, and renders whatever comes back.
// =============================================================================

import { slugify } from '../slug.js';

/**
 * Group a flat, document-ordered list of descriptors into era sections.
 *
 * The input mirrors #dyn's own child order: era labels and set blocks interleaved,
 * every set belonging to the era label that precedes it. Sets that appear before
 * any label (or with none at all) land in a leading section with `era:null` —
 * that happens in the sort-toggle path, where a keyed banner is re-appended
 * before renderBySet has written the first label.
 *
 * @param {Array<{kind:'era',label:string,series?:string}|{kind:'set',name:string,isJp?:boolean}>} descriptors
 * @returns {Array<{era:{label:string,series:string|null}|null, sets:Array<{name:string,isJp:boolean,navId:string,index:number}>}>}
 *   `index` is the descriptor's position among SETS only, so setnav.js can pair
 *   each row with the matching element in its own set-block array.
 */
export function buildSetNavIndex(descriptors) {
  const sections = [];
  const taken = new Set();
  let current = null;
  let setIndex = 0;

  for (const d of descriptors || []) {
    if (!d) continue;
    if (d.kind === 'era') {
      current = { era: { label: d.label || '', series: d.series || null }, sets: [] };
      sections.push(current);
      continue;
    }
    if (d.kind !== 'set') continue;
    if (!current) { current = { era: null, sets: [] }; sections.push(current); }
    const name = d.name || '';
    current.sets.push({ name, isJp: !!d.isJp, navId: navIdFor(name, taken), index: setIndex++ });
  }

  return sections;
}

/**
 * A DOM-id-safe token for a set name, unique within `taken` (which it mutates).
 *
 * Set names are remote data: localized joins, JP names in kana, accented French
 * ("Éclat des Ténèbres"), punctuation. Anything outside [A-Za-z0-9] collapses to
 * '-', so two different names can slugify identically — hence the counter suffix.
 * A name that leaves nothing behind (all-kana JP sets) still gets a usable id.
 */
export function navIdFor(name, taken = new Set()) {
  const stem = slugify(name, 'set');
  let id = `set-${stem}`;
  let n = 2;
  while (taken.has(id)) id = `set-${stem}-${n++}`;
  taken.add(id);
  return id;
}

/**
 * Does a sidebar row survive the "Filter sets…" box?
 *
 * Matches the set name OR its era label, so typing "sword" finds every set in the
 * Sword & Shield era even though none of them is called that. An empty or
 * whitespace-only query matches everything.
 */
export function matchesNavQuery(setName, eraLabel, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return true;
  return String(setName || '').toLowerCase().includes(needle)
      || String(eraLabel || '').toLowerCase().includes(needle);
}
