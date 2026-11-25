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

- [ ] VERIFY: does `GET /v2/en/cards` with no filter return the short list of every card
  in one answer? If yes, use it; if no, walk `/v2/{lang}/sets` then `/v2/{lang}/sets/{id}`
  (about 200 requests per language, keyless).
- [ ] `tools/build-catalog.mjs` writes `data/cat/{lang}/cards-{a-z,0}.json` (split by
  first letter, like `jp-cat`): id, set id, local number, name, category (Pokémon /
  Trainer / Energy).
- [ ] Languages: en first, then de, fr, es, it, pt, zh-Hant, th, id (their set lists
  differ).
- [ ] Router: catalogue first, then the existing per-Pokémon shards, then live TCGdex.
  Print variants still come from the existing GraphQL step.
- [ ] Single-set mode can read its card list from the catalogue instead of always going
  live.
- [ ] With the catalogue in place, the 60-Pokémon cap in `refresh-data.yml` only limits
  variant shards; update its comment and the README.
- [ ] Hook it into the weekly workflow; byte-for-byte unchanged files; size check in the
  build log.
- [ ] Tests: catalogue reader, router order, a missing catalogue falls back cleanly.

Done when: a Pokémon that isn't pre-built shows its full English list without a live
name search.

## Phase 4: Match by Pokédex number, not by name

Fixes the substring problems (Mew pulling in Mewtwo, regional forms, "Team Rocket's X",
Tag Teams, other languages).

- [ ] VERIFY: TCGdex card details carry `dexId` (an array; Tag Teams have several). Check
  how many older cards lack it.
- [ ] Add `dexId` to `GQL_QUERY` in `js/api/providers/tcgdex.js` and to the catalogue rows
  from Phase 3.
- [ ] Matching: `dexId` first; fall back to the current name match only for cards without
  one. Keep the cameo behaviour (Tag Team cards show up for every Pokémon on them).
- [ ] Measure before and after on the three demo Pokémon plus Mew, Nidoran♀, Farfetch'd
  and Pikachu; put the differences in the PR description.
- [ ] Tests for the new matcher with those edge cases.

Done when: those edge cases come out right without special-case regex.

## Phase 5: Overrides file and automated "missing card" reports

For cards no source lists (stamped promos, jumbo cards, oddities).

- [ ] `data/overrides.json` (committed): rows of
  `{ lang, set, number, name, dexId?, source, issue }`. The app merges it last; a missing
  file means no overrides.
- [ ] Issue form `.github/ISSUE_TEMPLATE/missing-card.yml` with fields: language, set,
  number, name, proof link. Label `missing-card`.
- [ ] Workflow `.github/workflows/missing-card.yml` on `issues: [opened, edited]`:
  - pass the issue body through `env`, never `${{ github.event.issue.body }}` inside
    `run:` (shell injection);
  - `tools/missing-card.mjs` parses the form, normalises to the app's id format, and
    checks that the set exists in `data/sets.json`, the number is plausible, the card
    isn't listed already, and the proof link is on an allowed site;
  - valid → open a PR that changes only `data/overrides.json`, with `Closes #N`;
    invalid → label `needs-info` and comment the reason;
  - it never pushes to `main`; minimal permissions.
- [ ] Weekly build: drop any override that an upstream source now lists (same lang + set
  + number), and comment on its issue.
- [ ] Optional, after Phase 1 is trusted: the gap report opens one issue per set that has
  a gap (deduplicated, rate-limited).
- [ ] Tests: form parsing (including hostile input), validation, pruning.

Done when: a filed report becomes a ready-to-merge PR with no manual editing, and
overrides remove themselves once upstream catches up.

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
