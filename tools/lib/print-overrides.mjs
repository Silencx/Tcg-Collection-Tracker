// =============================================================================
// tools/lib/print-overrides.mjs — writing data/print-overrides.json (prints no source
// lists; the app reads it through js/api/print-overrides-model.js). Same layout as
// data/overrides.json: one row per line, sorted, so a change is a short diff. Pure.
// =============================================================================

import { LANGUAGES } from '../../js/config.js';
import { naturalCompare } from '../../js/api/catalog-model.js';
import { printKind, readPrintOverrides } from '../../js/api/print-overrides-model.js';

const KEYS = ['lang', 'card', 'type', 'size', 'stamp', 'source', 'issue'];
const LANG_ORDER = LANGUAGES.map(l => l.code);

/** One row as its line of JSON, keys in the file's order. */
export function rowJson(r) {
  const o = {};
  for (const k of KEYS) if (r[k] !== undefined && !(k === 'stamp' && !r.stamp?.length)) o[k] = r[k];
  return JSON.stringify(o);
}

// A card id's set and number, for sorting: the number is what follows the last '-'.
const split = id => { const i = id.lastIndexOf('-'); return [id.slice(0, i), id.slice(i + 1)]; };

/** Rows by language (the app's order), set, number, print kind, issue. */
export function sortPrintRows(rows) {
  const li = l => LANG_ORDER.indexOf(l);
  return [...rows].sort((a, b) => {
    const [as, an] = split(a.card), [bs, bn] = split(b.card);
    return li(a.lang) - li(b.lang)
      || (as < bs ? -1 : as > bs ? 1 : 0)
      || naturalCompare(an, bn)
      || (printKind(a) < printKind(b) ? -1 : printKind(a) > printKind(b) ? 1 : 0)
      || a.issue - b.issue;
  });
}

/** The file's text. */
export function formatPrintOverrides(rows) {
  const lines = sortPrintRows(rows).map(rowJson);
  const list = lines.length ? `\n    ${lines.join(',\n    ')}\n  ` : '';
  return `{\n  "schemaVersion": 1,\n  "prints": [${list}]\n}\n`;
}

/** `existing` with an import's rows in place of whatever its issue held before. */
export function withImport(existing, rows, issue) {
  return sortPrintRows([...(existing || []).filter(r => r.issue !== issue), ...rows]);
}

export { readPrintOverrides };
