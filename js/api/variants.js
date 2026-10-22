// =============================================================================
// variants.js — print variants (holo / reverse holo / 1st edition / stamps …).
// Pure: no DOM, no fetch, no state, so the provider, the build and the tests share it.
//
// TCGdex carries two descriptions of a card's prints, both on the FULL card object
// (REST /cards/{id} or GraphQL — never the list endpoints):
//   variants          {normal, reverse, holo, firstEdition, wPromo}   five flags
//   variants_detailed [{type, subtype, stamp[], size, foil, …}]       one entry per print
// The detailed list is what tells shadowless from unlimited, a 1st Edition stamp from a
// prerelease one, a Poké Ball pattern reverse from a plain one. We keep the flags as the
// card's `variants` object (every renderer and every cached/committed card already reads
// that shape) and hang the extra prints off it as `variants.prints`.
//
// Measured 2026-10-22 over every EN set: the data is good for WotC, e-card, EX, DP, Pt,
// HGSS, SWSH, SV and ME. Black & White, XY and Sun & Moon are the exception — TCGdex
// lists almost every card there as `normal` only, though most of them were also printed
// in reverse holo. See REVERSE_GAP below, and EX_LOGO_REVERSE for one EX-era quirk.
// =============================================================================

// Labels for the TCGdex slugs that a plain "dash to space" would get wrong. Anything not
// listed falls through to humanize(), which is right for the long tail (player names on
// World Championship decks, event stamps).
const LABELS = {
  normal: 'Normal', holo: 'Holo', reverse: 'Reverse holo',
  lenticular: 'Lenticular', metal: 'Metal',
  unlimited: 'Unlimited', shadowless: 'Shadowless',
  'shadowless-red-cheek': 'Shadowless (red cheeks)',
  '1999-2000-copyright': '1999-2000 copyright', '1999-copyright': '1999 copyright',
  '1st-edition': '1st Edition', 'pre-release': 'Prerelease', 'set-logo': 'Set logo',
  'no-e-reader': 'No e-Reader strip', 'w-promo': 'W promo',
  pokeball: 'Poké Ball', masterball: 'Master Ball', duskball: 'Dusk Ball',
  loveball: 'Love Ball', friendball: 'Friend Ball', quickball: 'Quick Ball',
  'cracked-ice': 'Cracked ice', 'team-rocket': 'Team Rocket',
  'pokemon-center': 'Pokémon Center', jumbo: 'Jumbo',
};

function humanize(slug) {
  const s = String(slug).replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const label = slug => LABELS[slug] || humanize(slug);

// Prints that the five flags already say everything about. A card whose detailed list
// holds only these needs no `prints` array — that is most modern cards, and leaving it
// off keeps the committed snapshot and the localStorage cache small.
const PLAIN_TYPES = new Set(['normal', 'holo', 'reverse']);
const isPlain = p => PLAIN_TYPES.has(p.type) && !p.subtype && !p.stamp && !p.foil && !p.size;

/**
 * One TCGdex `variants_detailed` entry → the fields we keep. Drops prices, marketplace
 * ids and TCGdex's internal variantId; drops `size: 'standard'` (the default) and empty
 * stamp lists, so an absent key always means "nothing special".
 */
export function compactPrint(v) {
  if (!v || typeof v.type !== 'string') return null;
  const p = { type: v.type };
  if (v.subtype) p.subtype = String(v.subtype);
  if (Array.isArray(v.stamp) && v.stamp.length) p.stamp = v.stamp.map(String);
  if (v.foil) p.foil = String(v.foil);
  if (v.size && v.size !== 'standard') p.size = String(v.size);
  return p;
}

// ── THE BW / XY / SM REVERSE-HOLO GAP ─────────────────────────────────────────────
// TCGdex lists almost every card in these sets as `normal` only, but the main
// expansions all printed reverse holos, on one rule that held for the whole era:
//   · Common / Uncommon / Rare (TCGdex has no separate "Rare Holo" here) → reverse holo
//   · special Energy (Uncommon) → reverse holo; basic Energy → none, except in
//     Generations and Evolutions
//   · never: EX / GX / TAG TEAM (TCGdex `suffix`), Prism Star ◇, ACE SPEC and Team Flare
//     Hyper Gear (the BW/XY Rare Item/Tool trainers), the Radiant Collection subsets
//     (RC1 …) and lettered alternates (88a …) — anything whose number is not plain digits
//   · never: promo and special products — Black Star promos, Dragon Vault, Kalos
//     Starter Set, Shiny Vault, Detective Pikachu — which is why they are not listed.
// Scored against TCGplayer's own printing list (via pokemontcg.io) for every card in
// these sets on 2026-10-22; the numbers are pinned in tests/variants.test.mjs.
//
// Only applied when TCGdex itself says reverse:false, and marked `inferred` so the UI
// can say "very likely". If TCGdex fills a set in, its cards arrive with reverse:true
// and the rule simply stops being consulted for them.
export const REVERSE_GAP = new Set([
  'bw1', 'bw2', 'bw3', 'bw4', 'bw5', 'bw6', 'bw7', 'bw8', 'bw9', 'bw10', 'bw11',
  'xy1', 'xy2', 'xy3', 'xy4', 'xy5', 'xy6', 'xy7', 'xy8', 'xy9', 'xy10', 'xy11', 'xy12',
  'dc1', 'g1',
  'sm1', 'sm2', 'sm3', 'sm3.5', 'sm4', 'sm5', 'sm6', 'sm7', 'sm7.5', 'sm8', 'sm9',
  'sm10', 'sm11', 'sm115', 'sm12',
]);
const REVERSE_RARITIES = new Set(['Common', 'Uncommon', 'Rare']);
// The two sets whose numbered basic Energy had reverse holos too (Generations, Evolutions).
const BASIC_ENERGY_REVERSE = new Set(['g1', 'xy12']);

/** Would this card have had a reverse-holo print under the BW/XY/SM rule? */
export function inferReverse(d) {
  const setId = d?.set?.id;
  if (!setId || !REVERSE_GAP.has(setId)) return false;
  const localId = String(d.localId ?? String(d.id || '').slice(setId.length + 1));
  if (!/^\d+$/.test(localId)) return false;
  if (!REVERSE_RARITIES.has(d.rarity)) return false;
  if (d.suffix || /◇/.test(d.name || '')) return false;
  if (d.category === 'Energy') return d.rarity === 'Uncommon' || BASIC_ENERGY_REVERSE.has(setId);
  // ACE SPEC (BW) and Team Flare Hyper Gear (XY) are the Rare Items/Tools of those eras;
  // Sun & Moon's Rare Items (Enhanced Hammer, Beast Ring) did get reverses.
  if (d.category === 'Trainer' && d.rarity === 'Rare' && /^(Item|Tool)$/.test(d.trainerType || '')
      && !setId.startsWith('sm')) return false;
  return true;
}

// ── THE EX-ERA STAMPED REVERSE ────────────────────────────────────────────────────
// From Team Rocket Returns on, an EX-era reverse holo carries the set logo stamped on its
// art; it is THE reverse of those sets, not a special print. TCGdex types it `reverse` +
// set-logo stamp in ex7–ex10, but `normal` (or, on holo rares, `holo`) + set-logo stamp
// and reverse:false in ex11–ex16 — measured 2026-10-22: 469 such cards, 0 with the
// reverse flag, while TCGplayer lists reverse holos for those sets. Every spelling
// becomes a plain reverse.
const EX_LOGO_REVERSE = new Set(['ex7', 'ex8', 'ex9', 'ex10', 'ex11', 'ex12', 'ex13', 'ex14', 'ex15', 'ex16']);
function exLogoReverse(p) {
  if (!p.stamp || p.stamp.length !== 1 || p.stamp[0] !== 'set-logo') return p;
  if (!PLAIN_TYPES.has(p.type)) return p;
  const { stamp, ...rest } = p;
  return { ...rest, type: 'reverse' };
}

/**
 * A TCGdex full card (REST detail or GraphQL) → the `variants` object we store, or null
 * when the card carries no variant data at all.
 * @returns {null | {normal,reverse,holo,firstEdition,wPromo, prints?:Array, inferred?:string[]}}
 */
export function normalizeVariants(d) {
  const f = d?.variants;
  if (!f || typeof f !== 'object') return null;
  const v = {
    normal: !!f.normal, reverse: !!f.reverse, holo: !!f.holo,
    firstEdition: !!f.firstEdition, wPromo: !!f.wPromo,
  };
  let prints = (Array.isArray(d.variants_detailed) ? d.variants_detailed : [])
    .map(compactPrint).filter(Boolean);
  if (EX_LOGO_REVERSE.has(d.set?.id)) {
    prints = prints.map(exLogoReverse);
    if (prints.some(p => p.type === 'reverse')) v.reverse = true;
  }
  if (prints.some(p => !isPlain(p))) v.prints = prints;
  if (!v.reverse && inferReverse(d)) {
    v.reverse = true;
    v.inferred = ['reverse'];
  }
  return v;
}

/** "Holo · Shadowless · 1st Edition stamp" — one print, for tooltips. */
export function printLabel(p) {
  const parts = [label(p.type)];
  if (p.subtype) parts.push(label(p.subtype));
  if (p.foil) parts.push(`${label(p.foil)} pattern`);
  if (p.size) parts.push(label(p.size));
  for (const s of p.stamp || []) parts.push(`${label(s)} stamp`);
  return parts.join(' · ');
}

// Prints the short badges below already account for. Everything else — stamps other
// than 1st Edition, foil patterns, jumbo, error prints, lenticular/metal — is counted
// into the "+N" badge so a busy WotC card cannot overflow its footer.
function coveredByBadges(p) {
  if (!PLAIN_TYPES.has(p.type) || p.foil || p.size) return false;
  const subOk = !p.subtype || p.subtype === 'unlimited' || p.subtype.startsWith('shadowless');
  const stampOk = !p.stamp || (p.stamp.length === 1 && p.stamp[0] === '1st-edition');
  return subOk && stampOk;
}

/**
 * The footer badges for a card's `variants`, as data: [{text, title, inferred?}].
 * Normal prints get no badge. `extra.title` lists every print, for the hover text.
 */
export function variantBadges(v) {
  if (!v) return [];
  const prints = Array.isArray(v.prints) ? v.prints : [];
  const inferred = new Set(v.inferred || []);
  const b = [];
  if (v.holo) b.push({ text: 'H', title: 'Holofoil variant exists' });
  if (v.reverse) {
    b.push(inferred.has('reverse')
      ? { text: 'RH', title: 'Reverse holo variant very likely exists (TCGdex has no reverse-holo data for this era; inferred from rarity)', inferred: true }
      : { text: 'RH', title: 'Reverse holo variant exists' });
  }
  if (v.firstEdition) b.push({ text: '1ED', title: 'First edition variant exists' });
  if (prints.some(p => p.subtype && p.subtype.startsWith('shadowless'))) {
    b.push({ text: 'SL', title: 'Shadowless variant exists' });
  }
  if (v.wPromo) b.push({ text: 'P', title: 'Promo variant exists' });
  const extra = prints.filter(p => !coveredByBadges(p));
  if (extra.length) {
    b.push({ text: `+${extra.length}`, title: 'Other prints:\n' + extra.map(printLabel).join('\n') });
  }
  return b;
}

/** Every print as one line each — the hover text for the whole badge group. */
export function printsSummary(v) {
  if (!v || !Array.isArray(v.prints) || !v.prints.length) return '';
  return 'Known prints:\n' + v.prints.map(printLabel).join('\n');
}
