// =============================================================================
// api/id-migration.js — pure pokemontcg.io → TCGdex card-id migration.
// No DOM, no state, no fetch — safe to import in Node (tests) or the browser.
// Extracted from ui/io.js so it can be unit-tested without pulling in state.js,
// which touches localStorage at module load.
// =============================================================================

import { ptcgioToTcgdexSetId, ptcgioToTcgdexLocalId } from './images.js';

// "sv5-163" → "sv05-163": split at the last '-', remap set id + local id.
export function migrateCardId(cardId) {
  const i = cardId.lastIndexOf('-');
  if (i < 0) return cardId;
  const setId = cardId.slice(0, i), num = cardId.slice(i + 1);
  const series = setId.replace(/\d.*$/, '');
  return `${ptcgioToTcgdexSetId(setId)}-${ptcgioToTcgdexLocalId(num, series)}`;
}

// A pokemontcg.io card id has a set id containing a digit, then "-localId".
export function looksPtcgio(cardId) { return /^[a-z]+\d[\w]*-[A-Za-z0-9]+$/.test(cardId); }

/** Transform one "{BADGE}_{cardId}" id → TCGdex format; JP/placeholder/unknown unchanged. */
export function migrateIdToken(id) {
  const u = id.indexOf('_');
  if (u < 0) return id;
  const badge = id.slice(0, u), cardId = id.slice(u + 1);
  return looksPtcgio(cardId) ? `${badge}_${migrateCardId(cardId)}` : id;
}
