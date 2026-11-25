// =============================================================================
// api/species.js — fetch data/species.json (the full National Dex with native names,
// built by tools/build-species.mjs). Never throws: a missing, unbuilt or malformed file
// resolves to null and the app keeps the built-in catalogue (api/species-model.js).
// =============================================================================

import { readSpeciesFile } from './species-model.js';

// data/ sits at the site root; this module is js/api/species.js.
const FILE = new URL('../../data/species.json', import.meta.url);

/** @returns {Promise<{catalog:Array, native:object}|null>} */
export async function loadSpecies() {
  try {
    const res = await fetch(FILE, { cache: 'no-cache' });
    if (!res.ok) return null;
    return readSpeciesFile(await res.json());
  } catch {
    return null;
  }
}
