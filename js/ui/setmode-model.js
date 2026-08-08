// =============================================================================
// ui/setmode-model.js — single-set mode's countable half, DOM-free.
//
// Same split as filter-pass.js / setnav-index.js / dashboard-model.js etc.
//
// parseCardId is IMPORTED from dashboard-model rather than re-derived: both modules
// read the same `${badge}_${setId}-${localId}` checklist ids, and a second copy of that
// rule is a second place for the JP special case to be got wrong.
// =============================================================================

import { parseCardId } from './dashboard-model.js';
import {
  LANGUAGES, PLACEHOLDER_LANGS, DIGITAL_SERIES, OTHER_SERIES_ID, OTHER_SERIES_NAME,
} from '../config.js';

/**
 * Progress within one set.
 *
 * TWO numbers, because they answer different questions and conflating them is how a
 * "165 / 165 complete" set ends up showing 400/165:
 *   • cards     — distinct CARDS you hold at least one printing of. This is the one
 *                 that means "how much of the expansion do I have", and it is what the
 *                 official card count is a denominator for.
 *   • printings — every ticked language printing. Twelve badges per card, so this runs
 *                 up to 12× higher and has no fixed denominator at all.
 *
 * @param {Iterable<string>} ids   state.ssChecked
 * @param {string} setId
 */
/**
 * Does this checklist id belong to `setId`?
 *
 * state.ssChecked holds ids for EVERY set ever ticked, not just the open one, so every
 * consumer — progress, select-all, clear, print — has to filter. One predicate rather
 * than four copies of the same slice-and-compare.
 */
export function belongsToSet(id, setId) {
  return !!setId && parseCardId(id).setId === setId;
}

export function setProgress(ids, setId, badge = null) {
  let printings = 0;
  const distinct = new Set();
  if (!setId) return { printings: 0, cards: 0 };
  for (const id of ids) {
    if (!belongsToSet(id, setId)) continue;
    // `badge` scopes progress to ONE language. Single-set mode picks the language
    // before the set, so "Temporal Forces in German" and "Temporal Forces in English"
    // are separate goals against the same 162-card denominator — without this filter a
    // set you had only started in German would report progress in the English list too.
    if (badge && parseCardId(id).badge !== badge) continue;
    printings++;
    // Everything after the badge — the TCGdex card id, which is what identifies the
    // CARD independently of which language printing was ticked.
    distinct.add(id.slice(id.indexOf('_') + 1));
  }
  return { printings, cards: distinct.size };
}

/** Completion as a whole percent, or null when the set size is unknown. */
export function percentComplete(cards, official) {
  if (!official || official <= 0) return null;
  return Math.min(100, Math.round((cards / official) * 100));
}

/**
 * The picker's rows, from data/sets.json's four maps.
 *
 * Newest first. Sets with no release date sort LAST rather than to 1970 — the same rule
 * the dashboard uses, and for the same reason: a missing date is unknown, not ancient.
 *
 * @param {object} meta data/sets.json
 * @param {object} [opts]
 * @param {string} [opts.lang] LANGUAGES `code`. Only sets that exist in this language
 *   are returned, named in it.
 * @param {boolean} [opts.includeDigital] include TCG Pocket. Off: the picker is a tool
 *   for completing a PHYSICAL set.
 */
export function buildSetList(meta = {}, { lang = 'en', includeDigital = false } = {}) {
  const names = meta.names?.[lang] || {};
  const setSeries = meta.setSeries || {};
  const rows = [];
  for (const id of Object.keys(names)) {
    if (!includeDigital && isDigitalOnly(id, setSeries)) continue;
    rows.push({
      id,
      name: names[id] || id,
      date: dateFor(meta, lang, id),
      symbol: meta.symbols?.[id] || null,
      logo: meta.logos?.[id] || null,
      count: countFor(meta, lang, id),
      serie: setSeries[id] || OTHER_SERIES_ID,
      // TCGdex lists the set but has no card list for it in this language — 80 of
      // Italian's 190, 43 of Thai's 72. The picker renders these inert; clicking one
      // would otherwise land on "no cards" with no way to have known.
      empty: (meta.lang?.[lang]?.noCards || []).includes(id),
    });
  }
  return sortSetRows(rows);
}

/**
 * Sort rows by release date. Undated sorts LAST in BOTH directions — a missing date is
 * unknown, not ancient, so flipping the order must not promote it to the top.
 */
export function sortSetRows(rows, { asc = false } = {}) {
  const dir = asc ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (!a.date && !b.date) return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return (b.date < a.date ? -1 : b.date > a.date ? 1 : 0) * dir;
  });
}

/** Is this set a digital-only product (Pokémon TCG Pocket)? */
export function isDigitalOnly(setId, setSeries = {}) {
  return DIGITAL_SERIES.has(setSeries[setId]);
}

// data/sets.json keeps dates/counts as FLAT maps holding the union across languages,
// with per-language values recorded in `lang` ONLY where they differ. These two resolve
// that: override, then flat, then null. Never 0 or '' — an absent count and a count of
// zero render differently and mean different things.
export const dateFor = (meta, lang, id) =>
  meta?.lang?.[lang]?.dates?.[id] ?? meta?.dates?.[id] ?? null;
export const countFor = (meta, lang, id) =>
  meta?.lang?.[lang]?.counts?.[id] ?? meta?.counts?.[id] ?? null;

/**
 * Which languages the picker's selector should offer, with each one's set count.
 *
 * Derived from what the snapshot actually holds rather than from LANGUAGES, because
 * coverage is wildly uneven — 218 English sets against 70 Indonesian — and offering a
 * language with nothing behind it is a dead option.
 */
export function pickerLanguages(meta = {}, { includeDigital = false } = {}) {
  const setSeries = meta.setSeries || {};
  const out = [];
  for (const l of [...LANGUAGES, ...PLACEHOLDER_LANGS]) {
    const map = meta.names?.[l.code];
    if (!map) continue;
    const count = Object.keys(map)
      .filter(id => includeDigital || !isDigitalOnly(id, setSeries)).length;
    if (!count) continue;
    out.push({ code: l.code, label: l.label, badge: l.badge, count });
  }
  return out;
}

/**
 * Group rows by TCGdex series, newest series first.
 *
 * `asc` flips BOTH levels — the group order and the rows inside each group — because a
 * half-reversed list reads as a bug. Series absent from `seriesList` (and the 'other'
 * bucket) sort last: they are the ones with no release date to place them by.
 *
 * @param {Array} rows        buildSetList output
 * @param {Array} seriesList  meta.series[lang] — [{id,name,date}], already newest-first
 */
export function groupSetsBySeries(rows, seriesList = [], { asc = false } = {}) {
  const meta = new Map(seriesList.map((s, i) => [s.id, { ...s, order: i }]));
  const groups = new Map();
  for (const row of rows) {
    const id = row.serie || OTHER_SERIES_ID;
    if (!groups.has(id)) {
      const m = meta.get(id);
      groups.set(id, {
        id,
        name: m?.name || (id === OTHER_SERIES_ID ? OTHER_SERIES_NAME : id),
        date: m?.date || null,
        order: m?.order ?? Number.MAX_SAFE_INTEGER,
        rows: [],
      });
    }
    groups.get(id).rows.push(row);
  }
  const out = [...groups.values()];
  out.sort((a, b) => {
    if (a.date && b.date) {
      const cmp = b.date < a.date ? -1 : b.date > a.date ? 1 : 0;
      return asc ? -cmp : cmp;
    }
    // Undated last in both directions, for the same reason sortSetRows does it.
    if (a.date) return -1;
    if (b.date) return 1;
    return a.order - b.order;
  });
  for (const g of out) g.rows = sortSetRows(g.rows, { asc });
  return out;
}

/**
 * Does a picker row match the search box?
 *
 * Matches on NAME and on SET ID. The id matters more than it looks: people who know the
 * hobby search "sv05" or "base1" far more precisely than they can spell "Temporal
 * Forces", and it is what the app shows in the URL-ish places anyway.
 */
export function matchesSetQuery(row, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return String(row.name || '').toLowerCase().includes(q)
      || String(row.id || '').toLowerCase().includes(q);
}

// (groupSetsByYear removed: series groups are themselves date-ordered, so a year
// grouping on top of them was a second axis saying the same thing. groupSetsBySeries
// replaces it.)
