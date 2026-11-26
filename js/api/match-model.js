// =============================================================================
// api/match-model.js — which cards belong to a Pokémon. No DOM, no fetch, no state.
//
// One rule for the catalogue (catalog-model.js), the live search (providers/tcgdex.js)
// and the build (tools/build-data.mjs), in cardIsSpecies:
//
//   · a card whose name names the Pokémon (whole word, namesSpecies) is its card;
//   · so is a card whose Pokédex numbers (TCGdex's `dexId`) include the Pokémon's, which
//     is what finds "Nidoran ♀", "Farfetch’d" and "Ho Oh" whatever their spelling, and
//     cameos such as Terapagos & Friends — unless its name is plainly another Pokémon's
//     that its numbers leave out.
//
// Not "numbers first, name only without numbers", which the plan proposed: measured on
// every English card and every species (2026-11-26), the name rule had no false match
// left for numbers to remove, and the only cards numbers would have dropped were three
// that TCGdex numbers wrongly (mfb-22 "Electrode" as Gyarados, mfb-31 "Lapras" as
// Magikarp, 2021swsh-12 "Chimchar" as Monferno), which they would also have filed under
// the wrong Pokémon. 114 of 20,246 English Pokémon cards had no numbers (all in me06),
// 129 had several, and one Trainer had some (Tropical Tidal Wave).
// =============================================================================

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does `cardName` name this species, as a whole word?
 *
 * `?name=` is a CONTAINS match (see providers/tcgdex.js), so querying "Mew" also
 * returns every Mewtwo, Mewtwo-EX and Mew & Mewtwo-GX card. Requiring the query
 * to sit between non-alphanumerics keeps genuine cameos — "Seedot & Nuzleaf-GX"
 * still counts for both Seedot and Nuzleaf, which the README treats as a feature
 * — while "Mewtwo" stops answering to "Mew".
 *
 * Hand-rolled boundaries rather than `\b`: names ending in a non-word character
 * (Nidoran♀, Farfetch'd) get no `\b` there at all, so `\bNidoran♀\b` could never
 * match.
 */
export function namesSpecies(cardName, species) {
  if (typeof cardName !== 'string' || !cardName) return false;
  const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(species)}(?![A-Za-z0-9])`, 'gi');
  for (let m = re.exec(cardName); m; m = re.exec(cardName)) {
    // A hyphen straight after the match is ambiguous. It either starts a card
    // suffix — "Nuzleaf-GX", same Pokémon, keep — or continues a DIFFERENT
    // species' name: "Porygon-Z" is not Porygon, "Kommo-o" is not Kommo,
    // "Ho-Oh" is not Ho. Suffix tags are all-caps and at least two letters;
    // species continuations ("Z", "o", "Oh") are not, which separates the two
    // cases without needing a hardcoded suffix list. An unrecognised all-caps
    // tag is kept, matching the never-a-shorter-list rule.
    const hyphen = /^-([A-Za-z]+)/.exec(cardName.slice(m.index + m[0].length));
    if (hyphen && !(hyphen[1].length >= 2 && hyphen[1] === hyphen[1].toUpperCase())) continue;
    return true;
  }
  return false;
}

/** TCGdex's `dexId` → its valid numbers, ascending and once each; [] for none or junk. */
export function readDexIds(v) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
}

/**
 * Is this card one of `species`' cards? See the header for the rule.
 * @param {{name:string, dexIds?:number[]}} card  dexIds: the card's Pokédex numbers;
 *   absent or empty when it has none (or they are not known)
 * @param {string} species the tracked Pokémon's name
 * @param {Map<string, number>} [dexByName] every Pokémon's name → National Dex number
 *   (dexByNameFrom). Without it, or for a name it lacks, the name rule alone.
 */
export function cardIsSpecies(card, species, dexByName = null) {
  if (namesSpecies(card?.name, species)) return true;
  const dex = dexByName?.get(species);
  const ids = readDexIds(card?.dexIds);
  if (!Number.isInteger(dex) || !ids.includes(dex)) return false;
  // Numbered for this Pokémon, not named for it. Rare (29 cards across all species), so
  // checking the name against every other Pokémon costs nothing that matters.
  for (const [other, n] of dexByName) {
    if (!ids.includes(n) && namesSpecies(card.name, other)) return false;
  }
  return true;
}

/** [{name, dex}] (state.speciesCatalog, data/species.json, POKEMON_CATALOG) → name → dex. */
export function dexByNameFrom(catalog) {
  const map = new Map();
  for (const s of catalog || []) if (s?.name && Number.isInteger(s.dex)) map.set(s.name, s.dex);
  return map;
}
