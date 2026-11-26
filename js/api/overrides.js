// =============================================================================
// api/overrides.js — data/overrides.json, loaded once a session for the router and
// jp-source.js. The rules for reading and merging it are in overrides-model.js.
//
// Never rejects: no file, a failed request or a malformed file all read as no
// overrides, and every card list is then exactly what its sources gave.
// =============================================================================

import { readOverrides } from './overrides-model.js';

const FILE = new URL('../../data/overrides.json', import.meta.url);

let memo = null;

/** The valid override rows, or [] when there are none. */
export function loadOverrides() {
  memo ||= fetch(FILE, { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null)
    .then(readOverrides);
  return memo;
}
