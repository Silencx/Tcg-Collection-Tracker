// =============================================================================
// slug.js — one filename/id-safe slug rule.
//
// Two callers, deliberately sharing one implementation:
//   • tools/build-data.mjs names the per-Pokémon snapshot shards (data/cards/<slug>.json)
//   • ui/setnav-index.js builds DOM ids for sidebar rows
//
// Collisions are real, not theoretical: "Nidoran♀" and "Nidoran♂" both reduce to
// "nidoran", and localized set names collide constantly. uniqueSlug resolves them with
// a counter against a `taken` set — which is also why the builder writes an explicit
// name → filename map into data/index.json instead of letting the client re-derive the
// filename. A client that guessed would 404 on the second Nidoran and, worse, could
// not tell "not built" from "network down".
// =============================================================================

/** Lowercase, non-alphanumerics collapsed to '-', trimmed. Empty input → `fallback`. */
export function slugify(name, fallback = 'x') {
  const base = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || fallback;
}

/** slugify, made unique within `taken` (which it mutates). */
export function uniqueSlug(name, taken = new Set(), fallback = 'x') {
  const stem = slugify(name, fallback);
  let out = stem;
  let n = 2;
  while (taken.has(out)) out = `${stem}-${n++}`;
  taken.add(out);
  return out;
}
