// =============================================================================
// ui/mirror-model.js — the language tiles an English card gets in Master Set and TMS,
// and the bell's note on the languages whose tiles there are placeholders. No DOM.
//
// Master Set and TMS are built from the English card list: every language gets one tile
// per English card, `{badge}_{English card id}`. For most languages the tile asks
// TCGdex's CDN for that card's scan. For the `mirror:'placeholder'` ones (Korean,
// Simplified Chinese) no such scan can exist, since none of their sets shares an id with
// English, so the tile is a placeholder and requests nothing. Their own sets and cards
// are in Set mode.
// =============================================================================

import { LANGUAGES } from '../config.js';
import { isDigitalOnly } from './setmode-model.js';

/**
 * The id of `lang`'s tile on an English card (`KR_sv04-001`). Saved ticks are keyed on
 * it, so it never changes.
 * @param {{badge:string}} lang a LANGUAGES entry
 * @param {string} enCardId the English card's TCGdex id
 */
export const mirrorTileId = (lang, enCardId) => `${lang.badge}_${enCardId}`;

/**
 * LANGUAGES split by how their tile on an English card is drawn, each in LANGUAGES
 * order: `art` builds a TCGdex scan URL, `placeholder` requests no image.
 * @param {Array<{mirror?:string}>} [languages] LANGUAGES, injectable for tests
 */
export function mirrorLangs(languages = LANGUAGES) {
  return {
    art: languages.filter(l => l.mirror !== 'placeholder'),
    placeholder: languages.filter(l => l.mirror === 'placeholder'),
  };
}

/**
 * How many of a language's physical sets TCGdex has a card list for, from
 * data/sets.json.
 * @param {object} meta data/sets.json (snapshot.getSetMeta's shape)
 * @param {string} code a LANGUAGES code
 * @returns {{sets:number, withCards:number}|null} null when the file lists no set in
 *   that language
 */
export function cardListShare(meta, code) {
  const setSeries = meta?.setSeries || {};
  const ids = Object.keys(meta?.names?.[code] || {}).filter(id => !isDigitalOnly(id, setSeries));
  if (!ids.length) return null;
  const none = new Set(meta?.lang?.[code]?.noCards || []);
  return { sets: ids.length, withCards: ids.filter(id => !none.has(id)).length };
}

/**
 * The bell's note for one placeholder language, as HTML (labels and links are ours,
 * from config.js).
 * @param {{badge:string, label:string, sources?:Array<{name:string,url:string}>}} lang
 * @param {{sets:number, withCards:number}|null} share cardListShare's answer; null
 *   without data/sets.json
 */
export function mirrorNotice(lang, share) {
  const links = (lang.sources || [])
    .map(s => `<a href="${s.url}" target="_blank" rel="noopener" style="color:inherit;font-weight:bold">${s.name}</a>`)
    .join(' · ');
  // "Simplified Chinese (CN)" is "Simplified Chinese" inside a sentence.
  const name = lang.label.replace(/\s*\([^)]*\)\s*$/, '');
  const lists = share
    ? `TCGdex has card lists for ${share.withCards} of ${share.sets} ${name} sets so far; Single set shows them.`
    : `Single set shows the ${name} sets TCGdex lists.`;
  return `<strong>${lang.label} (${lang.badge})</strong>: ${lists} ` +
    `The ${lang.badge} tiles here stay placeholders, since no ${name} card is also an English card.` +
    (links ? ` Fuller card lists: ${links}` : '');
}
