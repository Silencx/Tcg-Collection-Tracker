// =============================================================================
// tools/lib/built-at.mjs — keep a committed data file untouched when a build found
// nothing new in it.
//
// The weekly job commits any diff under data/. Every file carries a `builtAt` stamp the
// app only checks for presence (snapshot.js), so a fresh stamp alone — or the same data
// arriving in a different order — used to make a "chore: refresh card data" commit every
// week that changed nothing a visitor could see.
// =============================================================================

/** `v` with every object's keys sorted, so key order never counts as a change. */
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  }
  return v;
}

/**
 * A data file's body, stamped with this run's `builtAt` — unless the committed copy `prev`
 * says the same thing, in which case `prev` itself comes back, so the file is rewritten
 * byte for byte. Object key order is ignored; ARRAY order is not, so a caller whose source
 * returns lists in no fixed order sorts them first (tools/build-data.mjs does).
 * @param {object} body  the file's object, with a `builtAt` key in its place
 * @param {object|null} prev  the committed file's parsed contents, if any
 * @param {string} builtAt
 */
export function stampBuiltAt(body, prev, builtAt) {
  const strip = o => JSON.stringify(canonical({ ...o, builtAt: null }));
  if (prev?.builtAt && strip(prev) === strip(body)) return prev;
  return { ...body, builtAt };
}
