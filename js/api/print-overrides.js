// =============================================================================
// api/print-overrides.js — data/print-overrides.json, loaded once a session for the
// router. The rules for reading and merging it are in print-overrides-model.js.
//
// Never rejects: no file, a failed request or a malformed file all read as no print
// overrides, and every card keeps exactly the prints its sources gave.
// =============================================================================

import { readPrintOverrides } from './print-overrides-model.js';

const FILE = new URL('../../data/print-overrides.json', import.meta.url);

let memo = null;

/** The valid print-override rows, or [] when there are none. */
export function loadPrintOverrides() {
  memo ||= fetch(FILE, { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null)
    .then(readPrintOverrides);
  return memo;
}
