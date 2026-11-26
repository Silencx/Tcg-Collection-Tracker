# Card coverage plan

A work brief for this repo: make the app able to list every card that exists, not only
the cards of the few Pokémon in `data/prebuilt.json`. Written to be handed to Claude Code
(or a person) and worked through phase by phase.

## How to work through this file

- Do the phases in order. Each one is a separate branch and PR, with its own tests.
- Before starting a phase, read the files it names. The README is the source of truth for
  how data flows today; keep it updated in the same PR as the code.
- Mark a phase done by ticking its checkboxes in this file in the same PR.
- Phases marked 🔑 OWNER need a decision, a key or a terms check from the owner first.
  Prepare the probe or the plan, then stop and ask. Do not ship them on your own.
- Steps marked VERIFY depend on an API behaviour that was not tested when this was
  written. Probe it first (one or two requests, script under `tools/`, report kept
  local), and adjust the plan if it doesn't hold.

## House rules (from the existing codebase, do not break)

- No framework, no build step, no runtime dependencies. Plain ES modules in `js/`,
  Node 24 in `tools/`.
- Run `npm run check` and `npm test` before every commit. `node --check` misses ES module
  syntax errors, which is why `tools/check.mjs` exists; use it.
- New logic gets a DOM-free `*-model.js` (or `tools/lib/*.mjs`) half with `node:test`
  tests in `tests/`.
- Data files that didn't change are written back byte for byte
  (`tools/lib/built-at.mjs`), and lists are sorted by id, so a quiet week commits nothing.
- Card ids are stable forever. Never change an id format without a migration in the
  style of `js/api/id-migration.js` / `js/ui/jp-migrate.js`; an id that can't be placed
  is kept, never dropped.
- Publish facts only (set, number, name). Never commit a third party's own ids or raw
  answers; those stay in gitignored build-side folders, like `data/jp-catalog/`.
- Keys are read only by `tools/`, never shipped in `js/`, never printed or written to a
  report. The assistant cannot read `.env.local`; if a step needs a key, write the
  script and let the owner run it.
- Every source that feeds published data gets a footer credit and a "Withdrawing it"
  note in the README.
- All app state stays on the shared `state` object; the app must still work with any
  new data file missing.

## Phase 1: Gap report against set counts

Cheapest win: no new source. Shows where the holes are before anything else gets built.

- [x] Add `tools/lib/coverage.mjs`: given `data/sets.json` counts and the cards we list
  per set and language, return the sets where `listed < official` (and `listed > total`,
  which means duplicates).
- [x] Call it at the end of `tools/build-data.mjs`; print a short summary to the build
  log and write `tools/coverage-report.md` (gitignored).
- [x] Tests for the comparison logic, including sets with no count and secret rares above
  the official count.

Done when: the weekly build log names every set with a gap, per language.

Notes from building it:

- TCGdex's `cardCount.total` is the number of cards TCGdex holds for a set in that
  language, not a printed figure (Legendary Treasures: 140 English, 131 German, 113
  Spanish). So a set's total is taken as the most cards any language lists for it, and a
  language below that is reported as **short** even when its main run is complete.
- The main run is checked number by number, so a secret rare never hides a hole.
- Japanese sets are checked too, from `data/jp-cat/`: the set size is the denominator
  most of a set's cards print (`001/011` → 11). Promo and numberless sets have none and
  are listed as unchecked.

## Phase 2: Full species list (PokéAPI)

`POKEMON_CATALOG` in `js/config.js` is a hand-picked 357. Replace it with the full
National Dex.

- [x] `tools/build-species.mjs`: one-off (rerun per new generation) import from PokéAPI
  of every species: dex number, generation, and the species name in every language the
  app supports.
- [x] Write it to `data/species.json` (committed). Keep `POKEMON_CATALOG` as the fallback
  when the file is missing.
- [x] Use the localised names for placeholder tiles, so `NATIVE_NAMES` stops being
  limited to the three demo Pokémon.
- [x] Update the "357" wording in the README, the dashboard and the TMS browser.
- [x] Tests: picker search, dashboard "N of M" count, fallback when the file is missing.

Done when: any Pokémon can be picked, and placeholder tiles show its native name.

Notes from building it:

- PokéAPI's GraphQL endpoint answered 401 (2026-11-25), so the tool walks the REST API:
  one list request plus one per species, cached locally so a rerun only fetches new ones.
- Native names come from PokéAPI's ja-hrkt (katakana, as printed), ko, zh-hant, zh-hans,
  de, fr, es and it; a name equal to the English one is not stored. It has no Thai names,
  and its pt-br list is empty.
- All 357 built-in names are in the file with the same spelling, so nobody's tracked list
  changes. The built-in list had Garganacl as #962; it is #934 (fixed in the fallback).
- Search also matches native names and dex numbers.

## Phase 3: Full English (and other language) card list from TCGdex

Same pattern as `data/jp-cat/`, so the app stops depending on one name search per
Pokémon.

- [x] VERIFY: does `GET /v2/en/cards` with no filter return the short list of every card
  in one answer? If yes, use it; if no, walk `/v2/{lang}/sets` then `/v2/{lang}/sets/{id}`
  (about 200 requests per language, keyless).
- [x] `tools/build-catalog.mjs` writes `data/cat/{lang}/cards-{a-z,0}.json` (split by
  first letter, like `jp-cat`): id, set id, local number, name, category (Pokémon /
  Trainer / Energy).
- [x] Languages: en first, then de, fr, es, it, pt, zh-Hant, th, id (their set lists
  differ).
- [x] Router: catalogue first, then the existing per-Pokémon shards, then live TCGdex.
  Print variants still come from the existing GraphQL step.
- [x] Single-set mode can read its card list from the catalogue instead of always going
  live.
- [x] With the catalogue in place, the 60-Pokémon cap in `refresh-data.yml` only limits
  variant shards; update its comment and the README.
- [x] Hook it into the weekly workflow; byte-for-byte unchanged files; size check in the
  build log.
- [x] Tests: catalogue reader, router order, a missing catalogue falls back cleanly.

Done when: a Pokémon that isn't pre-built shows its full English list without a live
name search.

Notes from building it:

- VERIFY held (2026-11-25, `tools/tcgdex-catalog-probe.mjs`): `/{lang}/cards` answers with
  every card in one request in all nine languages (English: 23,912 cards, 2.3 MB, 0.6 s).
  In English and Traditional Chinese it matched a full set walk card for card; in German
  it has 262 cards more than the walk, from sets missing from `/de/sets` (POP Series,
  McDonald's Collections, EX trainer kits), which are kept. List items carry no category, and the
  `?category=` filter takes the language's own word (`Dresseur`, `Energía`), so the build
  reads `/{lang}/categories` first: five requests a language. GraphQL refuses a `cards`
  query with no filter.
- Rows are `[set, number, name, category]`, plus a trailing `0` for a card TCGdex lists
  without a scan (`/{lang}/cards` gives an `image` exactly where a set listing does:
  2,146 of 7,436 zh-tw cards, 1,224 of 2,921 th, 1,152 of 2,788 id, 1,781 of 23,912 en),
  so single-set mode's catalogue fallback requests the same scans as its live path. The
  id is always `{set}-{number}` and the image address is always rebuilt from
  `data/sets.json`'s series map (both checked on every card in every language), so
  neither is stored. Category is one letter.
- Matching uses the live search's own whole-word rule, and the shard a Pokémon is looked
  up in always holds its cards (tested on every species). Against the live name search
  for 20 awkward names (Mew, Nidoran♀, Farfetch'd, Ho-Oh, Porygon-Z, Type: Null, …) the
  catalogue gave the same cards, names and image addresses; across all 1,025 species it
  agreed with a scan of every card.
- Single-set mode asks TCGdex first and uses the catalogue only when that fails: TCGdex
  answers a set in one request with print badges, where the catalogue means loading all
  of a language's shards.
- Images for Traditional Chinese live under TCGdex's `zh-tw` folder, not `zh-Hant`
  (`/zh-tw/SV/SV1S/001` is a 200, `/zh-Hant/…` a 404), so the catalogue builds them with
  the API code, through `js/api/card-image-model.js` (added by the TW/TH/ID image fix,
  #15, which moved the app's other TW image paths to `zh-tw`).

## Phase 4: Match by Pokédex number, not by name

Fixes the substring problems (Mew pulling in Mewtwo, regional forms, "Team Rocket's X",
Tag Teams, other languages).

- [x] VERIFY: TCGdex card details carry `dexId` (an array; Tag Teams have several). Check
  how many older cards lack it.
- [x] Add `dexId` to `GQL_QUERY` in `js/api/providers/tcgdex.js` and to the catalogue rows
  from Phase 3.
- [x] Matching: `dexId` first; fall back to the current name match only for cards without
  one. Keep the cameo behaviour (Tag Team cards show up for every Pokémon on them).
  (Built as "name or number", see the notes.)
- [x] Measure before and after on the three demo Pokémon plus Mew, Nidoran♀, Farfetch'd
  and Pikachu; put the differences in the PR description.
- [x] Tests for the new matcher with those edge cases.

Done when: those edge cases come out right without special-case regex.

Notes from building it:

- VERIFY held, and older cards are not the gap (2026-11-26,
  `tools/tcgdex-dexid-probe.mjs`): 114 of 20,246 English Pokémon cards lack `dexId`, all
  in the newest set (me06); 129 have several. One Trainer has some (Tropical Tidal Wave),
  no Energy does. GraphQL gives every card's numbers in bulk when filtered by category
  (5 pages of 5,000 for Pokémon, 0.7 s); REST lists carry none. For the live path,
  `/cards?dexId=eq:N` and GraphQL `filters:{dexId:N}` are exact, but a bare `?dexId=29`
  is a contains-match on the digits (Magikarp, #129, answers it).
- The rule is "name or number", not "number first": a card is the Pokémon's when its
  name names it (the whole-word rule) or when its numbers include it, unless its name is
  plainly another Pokémon's that the numbers leave out. Measured over every English card
  and all 1,025 species, number-first would have changed 20 species: 29 cards added, and
  3 dropped that TCGdex numbers wrongly (mfb-22 "Electrode" as Gyarados, mfb-31 "Lapras"
  as Magikarp, 2021swsh-12 "Chimchar" as Monferno), which it would also have filed under
  the wrong Pokémon. The name rule had no false match left for numbers to fix. Name or
  number changes 14 species: 26 cards added, none dropped.
- Before → after on the committed catalogue: Seedot 21, Nuzleaf 20, Shiftry 24 and Mew 70
  unchanged; Nidoran♀ 14 → 20 ("Nidoran ♀", "Giovanni's Nidoran ♀"), Farfetch'd 21 → 24
  ("Farfetch’d"), Pikachu 246 → 248 ("Terapagos & Friends", "Tropical Tidal Wave"). Also
  Nidoran♂ +5, Ho-Oh +1 ("Ho Oh"), and cameos for Psyduck, Marill, Hoppip, Omanyte,
  Kabuto, Aerodactyl, Sprigatito, Fuecoco and Quaxly. Live TCGdex gives the same cards
  as the catalogue for all of them.
- Numbers are in the English catalogue only: GraphQL answers in English, and only the
  master set (English) matches cards to Pokémon. A card is also filed under the shard of
  every Pokémon its numbers name (6 cards needed it), so one shard per Pokémon still
  holds all of its cards; tested on every card. English grew from 869 KB to 993 KB.
- Japanese matching (`data/jp-cat/`, Bulbapedia) still uses names: those sources carry
  no Pokédex numbers.

## Phase 5: Overrides file and automated "missing card" reports

For cards no source lists (stamped promos, jumbo cards, oddities).

- [x] `data/overrides.json` (committed): rows of
  `{ lang, set, number, name, dexId?, source, issue }`. The app merges it last; a missing
  file means no overrides.
- [x] Issue form `.github/ISSUE_TEMPLATE/missing-card.yml` with fields: language, set,
  number, name, proof link. Label `missing-card`.
- [x] Workflow `.github/workflows/missing-card.yml` on `issues: [opened, edited]`:
  - pass the issue body through `env`, never `${{ github.event.issue.body }}` inside
    `run:` (shell injection);
  - `tools/missing-card.mjs` parses the form, normalises to the app's id format, and
    checks that the set exists in `data/sets.json`, the number is plausible, the card
    isn't listed already, and the proof link is on an allowed site;
  - valid → open a PR that changes only `data/overrides.json`, with `Closes #N`;
    invalid → label `needs-info` and comment the reason;
  - it never pushes to `main`; minimal permissions.
- [x] Weekly build: drop any override that an upstream source now lists (same lang + set
  + number), and comment on its issue.
- [ ] Optional, after Phase 1 is trusted: the gap report opens one issue per set that has
  a gap (deduplicated, rate-limited). (Not built, see the notes.)
- [x] Tests: form parsing (including hostile input), validation, pruning.

Done when: a filed report becomes a ready-to-merge PR with no manual editing, and
overrides remove themselves once upstream catches up.

Notes from building it:

- Where an override shows: English rows in master set and the TMS popup
  (`router.getCards`, matched by the Phase 4 name-or-number rule), any TCGdex language in
  single set (`router.getSetCards`, in number order), Japanese rows in the Japanese cards
  (`jp-source.js`) for sets `data/jp-cat/` has. Master set's card list is English, shown
  in every language, so a German-only card shows in single set but not in master set.
- "Normalises to the app's id format" means the set's own spelling: the number takes the
  prefix and zero padding the set's listed numbers use ("20" in `swshp` → `SWSH020`, "7"
  in `svp` → `007`, "007" in `base1` → `7`). A card counts as listed when its number
  matches ignoring case and padding. "Plausible" is up to twice the set's size, or the
  size plus 50 for a small set, per prefix.
- The set may be given by id, by name in its language, or by English name; Japanese by
  key, code or name. An ambiguous name ("Battle Academy" is two Japanese sets) asks for
  the code. TCG Pocket sets are refused.
- Proof links must be https pages on an allow-list (`PROOF_HOSTS`): Bulbapedia,
  pkmncards, Limitless, Serebii, TCGplayer, Cardmarket, PriceCharting, TCG Collector,
  Pokellector, pokemon.com, pokemon-card.com, pokemon.co.jp.
- The workflow also triggers on a title starting `[Missing card]`, so a report still gets
  checked while the `missing-card` label does not exist yet; the job creates both labels.
  An edit that breaks a valid report closes its pull request.
- Pull requests need the repository setting "Allow GitHub Actions to create and approve
  pull requests" (owner, once). Pull requests made with the workflow token run no CI, so
  the committed file is checked by `tests/overrides-model.test.mjs` once merged.
- Pruning runs daily, not weekly: the Japanese list changes daily, and it costs no
  requests. Comments go out only after the push.
- The optional per-set issues are not built. The Phase 1 report lists hundreds of gaps
  (German alone, 13 sets and 491 cards), so one issue per set would flood the tracker.
  Worth an owner decision, maybe for sets with a handful of missing numbers only.

## Phase 6: Second sources for checking 🔑 OWNER

Used for finding gaps and confirming reports, not as the main data, until there's a
shared card id (Phase 8).

- [ ] TCGCSV (free daily mirror of TCGplayer's catalogue, no key; category 3 is Pokémon,
  and Pokémon Japan has its own category). Probe script first. Filter out sealed
  products; one product per print. Owner checks the terms before anything is published.
- [ ] PokemonTCG/pokemon-tcg-data (MIT JSON per set, English only). Note: pokemontcg.io
  is being folded into Scrydex, so treat it as a check source that may go stale.
- [ ] Diff each against our catalogue; the output goes into the coverage report from
  Phase 1.
- [ ] Optional: use a source match to auto-confirm a Phase 5 report (level 3). Auto-merge
  only if the owner agrees.

## Phase 7: Missing languages 🔑 OWNER

Korean and Simplified Chinese have no public card database today.

- [ ] Simplified Chinese: Cardmarket says it now carries all Simplified Chinese sets and
  singles, and publishes its product catalogue as a download. Owner checks the terms,
  then probe: can it give set + number + name?
- [ ] Korean: the official `pokemoncard.co.kr/cards` search is the best source, but
  scraping it is fragile and promos are incomplete. Owner decides if it's worth it; if
  yes, a CI scraper writing `data/cat/ko/`, failing soft like the PokéWallet steps
  (`continue-on-error`).
- [ ] Both: placeholder tiles keep working; credit and withdrawal notes in the README.

## Phase 8: One card id across all sources (largest piece)

Only start once Phases 3 to 6 show it's needed.

- [ ] Mapping table: our card id ↔ TCGdex id ↔ PokéWallet set/number ↔ TCGplayer product
  ↔ Cardmarket product, with set code translations per language.
- [ ] Used for: "same card in other languages" in True master set, combining sources
  without duplicates, optional prices/links later.
- [ ] Build-side only for third-party ids (gitignored); what's published uses our own ids.

## Out of scope for now

- Prices, buy links and accounts.
- TCG Pocket cards (already excluded via `DIGITAL_SERIES`).
- High-res image hosting beyond what `tools/build-images.mjs` already does.
