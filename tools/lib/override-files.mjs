// =============================================================================
// tools/lib/override-files.mjs — the files the override scripts read: the committed
// card lists a report is checked against, and data/overrides.json itself.
// =============================================================================

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { numbersBySet, readOverrides } from './overrides.mjs';

const SHARD = /^cards-[a-z0]\.json$/;

/**
 * (lang, set) → the numbers that set's committed card list has: data/cat/{lang}/ for a
 * TCGdex language, data/jp-cat/ for Japanese. Each language is read once, on first use.
 * A language with no readable list answers null for every set.
 */
export function listedNumbers(dataDir) {
  const byLang = new Map();
  const load = lang => {
    const dir = lang === 'ja' ? resolve(dataDir, 'jp-cat') : resolve(dataDir, 'cat', lang);
    if (!existsSync(dir)) return null;
    const rows = [];
    for (const f of readdirSync(dir).filter(f => SHARD.test(f))) {
      rows.push(...(JSON.parse(readFileSync(resolve(dir, f), 'utf8')).rows || []));
    }
    return rows.length ? numbersBySet(rows) : null;
  };
  return (lang, set) => {
    if (!byLang.has(lang)) byLang.set(lang, load(lang));
    const sets = byLang.get(lang);
    return sets ? sets.get(set) || [] : null;
  };
}

/** data/overrides.json: { rows, malformed } — rows the app would read, and how many it would skip. */
export function readOverridesFile(file) {
  if (!existsSync(file)) return { rows: [], malformed: 0, exists: false };
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const rows = readOverrides(json);
  const total = Array.isArray(json?.overrides) ? json.overrides.length : 0;
  return { rows, malformed: total - rows.length, exists: true };
}
