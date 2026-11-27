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

- [x] TCGCSV (free daily mirror of TCGplayer's catalogue, no key; category 3 is Pokémon,
  and Pokémon Japan has its own category). Probe script first. Filter out sealed
  products; one product per print. Owner checks the terms before anything is published.
  Probe: `tools/tcgcsv-probe.mjs`. The owner checked the terms on 2026-11-26.
- [x] PokemonTCG/pokemon-tcg-data (MIT JSON per set, English only). Note: pokemontcg.io
  is being folded into Scrydex, so treat it as a check source that may go stale.
  Probe: `tools/ptcg-data-probe.mjs`. It stays a local probe, by the owner's choice
  (2026-11-26): TCGCSV covers the same English sets and is newer.
- [x] Diff each against our catalogue; the output goes into the coverage report from
  Phase 1. TCGCSV only: every Monday `refresh-data.yml` runs the probe after the
  catalogue build (`continue-on-error`). The diff is `tools/lib/tcgcsv.mjs`. The
  differences known on 2026-11-26 (381 numbers only TCGplayer lists, 158 only we list,
  45 unmatched groups, 33 sets of ours no group matches) are in
  `tools/tcgcsv-baseline.json`. The log gets `[coverage]` lines for anything new, as
  set ids and numbers only, so no TCGplayer name or id reaches the public log. After a
  look, `--update-baseline` makes them known. Japanese (`--jp`) stays local.
- [ ] Optional: use a source match to auto-confirm a Phase 5 report (level 3). Auto-merge
  only if the owner agrees.

Probe results so far (2026-11-26):

- pokemon-tcg-data (`tools/ptcg-data-probe.mjs`, 178 keyless requests to GitHub, cached):
  176 of its 177 sets match ours by id, name or date, and 20,632 cards are in both. Of
  the 110 cards only it lists, 28 are the Unseen Forces Unown, which TCGdex files as a
  set of their own (`exu`), 22 are Celebrations Classic Collection under their original
  numbers (TCGdex numbers them CC001–CC025), and 4 are Aquapolis cards TCGdex splits into
  `a`/`b`. The other 56 look like real gaps: Sun & Moon cards numbered with an `a` or
  `b` (Tapu Lele-GX 60a, Pokégear 3.0 182a/182b), in 15 sets. It is behind TCGdex on new
  sets (SVP stops at 165 of 226, SV Energy at 16 of 24) and lacks 26 of our sets (trainer
  kits, McDonald's collections, the newest sets): useful as a check for older sets.
- TCGCSV (`tools/tcgcsv-probe.mjs`) follows its published usage guidelines: a custom
  generic User-Agent, 150 ms between requests, `last-updated.txt` first, and a stop on
  403/429. Its FAQ says no permission is needed and asks for no credit. Run with the
  owner's go-ahead on 2026-11-26, English only: 225 requests in 42 s, no block. Answers
  are cached, so a rerun costs 1 request until TCGCSV's next daily build.
  - 222 groups, 33,109 products. 4,852 are sealed or have no number, and 5,235 are extra
    prints of a number already counted (stamps, Cosmos Holo).
  - 170 groups match our sets and 20,630 cards are in both. Within matched sets,
    TCGplayer has 381 numbers we lack:
    - **265 Jumbo cards**: TCGdex's `jumbo` set lists none, because TCGdex files a
      Jumbo card as a print of the normal card. See "Jumbo prints" below.
    - 28 Unown, which TCGdex files in `exu`.
    - 43 Classic Collection cards under their original numbers: numbering, not gaps.
    - About 45 promos: prerelease-, W- and set-stamped prints filed under the original
      number, Cosmos Holo reprints, and ME promos 111–117.
  - 158 numbers only we list are mostly the same cards filed differently: Radiant
    Collection RC1–RC32 as their own group, XY `a` cards, SM energies.
  - 45 groups match nothing of ours. About 15 are naming: McDonald's Collection 2015–2024
    and the trainer kits, which TCGdex splits per deck (matched by their cards since
    2026-11-27; see "Optional, after all phases"). The rest are product lines
    TCGdex does not have as sets: Prize Pack Series (203), World Championship Decks
    (208), League & Championship Cards (163), Deck/Blister Exclusives, Battle Academy,
    Trick or Trade, Professor Program, Burger King, Countdown Calendar, Kids WB,
    Pikachu World Collection, First Partner Pack, Southeast Asia Exclusives, TCG
    Classic, EX Battle Stadium, Alternate Art Promos and Miscellaneous. Most are stamped
    or reissued prints of existing cards.
  - TCGplayer does not list pokemon-tcg-data's 56 Sun & Moon `a`/`b` cards as numbers
    of their own either, so they are more likely prints than missing cards.

### Jumbo prints (2026-11-26, issue #19)

TCGdex files a Jumbo card as a print of the normal card: a `variants_detailed` entry
with `size: "jumbo"`. It has one for 210 cards, and the app already shows those as a
"Jumbo" print. Its `jumbo` set has stayed empty since 2021 and is listed for removal in
v3 (tcgdex/cards-database#104, "Jumbo is now a variant").

- [x] `tools/jumbo-prints.mjs` traces each of TCGplayer's 346 Jumbo products back to the
  card it enlarges (same number, a set of that size, same name). 297 trace to exactly
  one card. TCGdex already gives 148 of those cards a Jumbo print, and 149 it does not.
- [x] Those 149 are rows in `data/print-overrides.json`, all under issue #19 (132 holo,
  17 normal, from TCGplayer's printing). The app adds them to the card's prints
  (`js/api/print-overrides-model.js`) and skips a row once TCGdex lists a Jumbo print
  for its card.
- [ ] 48 Jumbo products don't trace to one card. They are listed in
  `tools/jumbo-prints-report.md` (local). The 16 WotC box toppers (1/12–12/12, S1–S4)
  are cards of their own, not prints. Then 21 oversized promos have no number or more
  than one (V-UNION, "Raikou, Entei & Suicune"), and 11 have typos or `a` numbers we
  lack.

**To do: send the 149 Jumbo prints to TCGdex.** Until TCGdex has them, only this app
shows them. Plan:

1. **The owner does the data by hand.** TCGdex's CONTRIBUTING.md refuses AI-assisted
   data, and the contributor confirms they wrote the content and hold the rights to it.
   The rows here only say which cards to look at. Each Jumbo print is checked against a
   source the owner can cite (the card itself, a product listing, Bulbapedia) before it
   goes in.
2. **Ask first.** Open an issue in tcgdex/cards-database, or ask on their Discord, whether
   they want Jumbo prints one PR per set, and confirm `type` is the Jumbo card's own
   finish (most are holo). That keeps the work in a shape they will merge.
3. **Start with the two promo sets**, which hold 90 of the 149: SM Black Star Promos (54)
   and XY Black Star Promos (36). In a fork, each card file
   (`data/<Serie>/<Set>/<number>.ts`) gets one more entry in its `variants` list, the
   way Base Set Pikachu has it: `{ type: "holo", size: "jumbo" }`. Their style: tab
   indent, double quotes in `data/`, commits like `feat(data): Add Jumbo variants for SM
   Black Star Promos`, and their checks must pass.
4. **After each merge and TCGdex's next deploy**, rerun
   `node tools/jumbo-prints.mjs --issue 19`. Rows for the cards TCGdex now covers leave
   `data/print-overrides.json`; the app already skips them in the meantime.

## Phase 7: Missing languages 🔑 OWNER

Korean and Simplified Chinese have no public card database today.

- [x] Simplified Chinese: Cardmarket says it now carries all Simplified Chinese sets and
  singles, and publishes its product catalogue as a download. Owner checks the terms,
  then probe: can it give set + number + name? (2026-11-27: no; its files have no card
  numbers and no Chinese names. Simplified Chinese comes from TCGdex.)
- [ ] Korean: the official `pokemoncard.co.kr/cards` search is the best source, but
  scraping it is fragile and promos are incomplete. Owner decides if it's worth it; if
  yes, a CI scraper writing `data/cat/ko/`, failing soft like the PokéWallet steps
  (`continue-on-error`). (2026-11-27: not without Pokémon Korea's written permission,
  see "Terms" below. Korean comes from TCGdex until then.)
- [x] Both: placeholder tiles keep working; credit and withdrawal notes in the README.
  (TCGdex was credited already; the withdrawal note is under "Card catalogue".)

Research (2026-11-27), reading only:

- **TCGdex now has both languages**, keyless, on the API we already use (`zh-cn`, `ko`):
  set lists with names and official counts, but cards for only a few sets so far, and no
  images (`tools/tcgdex-catalog-probe.mjs zh-cn ko`, about 7 requests each):

  | | Sets listed | Cards by set count | Sets with cards | Cards listed |
  |---|---|---|---|---|
  | Simplified Chinese (`zh-cn`) | 57 | 6,962 | 8 | 877 |
  | Korean (`ko`) | 95 | 7,931 | 3 | 239 |

  Its set ids follow the Japanese sets (`SV4M`, `SM1M`; Chinese-only sets like
  `CSM1aC`), not the English ones. So in the app these are languages with sets of their
  own, like Japanese, not more columns on the English sets.
- **Simplified Chinese, Cardmarket.** Its "What's new" for May 2026 says every Simplified
  Chinese set and single is now listed. The product catalogue is a public JSON file per
  game (`downloads.s3.cardmarket.com/productCatalog/productList/products_singles_{game}.json`;
  Pokémon is game 6 according to third-party projects, not confirmed). Those projects
  describe its fields as product id, English name, expansion id, metacard id and date
  added: no card number and no Chinese name, so it probably cannot give set + number +
  name. The download page (`cardmarket.com/en/Pokemon/Data/Product-List`) is behind
  Cloudflare's bot check, which the assistant does not get past: the owner opens it and
  reads the terms.
- **Korean, pokemoncard.co.kr** (Pokémon Korea's official site). `robots.txt` allows
  everything. The card search lists one product's cards per page, chosen from 581
  products going back to DP. Each card's page gives number (`127/103`), rarity, name and
  set name; the images are watermarked. The footer forbids unauthorised copying of the
  site's content; terms at `pokemonkorea.co.kr/terms`. Only facts (set, number, name)
  would be taken, never images.
- **Ids.** Today's KR and SC placeholder tiles mirror the English cards: `KR_sv04-001`,
  `SC_sv04-001`, and collectors may have ticked them. Real Korean and Chinese cards have
  sets of their own, so those ids cannot be mapped one to one. They stay as they are
  (kept, never dropped); real cards get ids of their own, and linking the two waits for
  Phase 8.

Owner decisions (2026-11-27):

1. Simplified Chinese: TCGdex, and try Cardmarket. The owner reads Cardmarket's terms
   for the download first; then `tools/cardmarket-probe.mjs` fetches the one file (a
   HEAD for its size, then one GET, cached) and reports its fields.
2. Korean: TCGdex, and the official site after the owner reads Pokémon Korea's terms.
   The search page loads a product's cards from a JSON endpoint it calls itself (internal
   id, image and title per card); number, rarity and set are on each card's page.
   `tools/pokemonkorea-probe.mjs` checks this with 4 requests, 2 s apart.
3. Real Korean and Chinese cards get sets and ids of their own, like Japanese. The old
   KR/SC placeholder tiles and their ticks stay as they are until Phase 8 links them.

Terms (read 2026-11-27):

- **Pokémon Korea** (`pokemonkorea.co.kr/terms`, in force since 2026-10-03; read and
  translated by the assistant, as the owner does not read Korean). They cover
  `pokemoncard.co.kr` too (art. 1). Art. 12: the copyright and other rights in the
  service's documents, images, designs, **data** and other content belong to Pokémon
  Korea, and without its prior consent users may not copy, distribute, transmit, publish,
  sell or change that content or otherwise use it for profit, except where the law
  allows. Art. 11 forbids using the service's information for profit without approval.
  Nothing mentions crawlers, and `robots.txt` allows everything. A free, non-profit app
  is not "for profit", but republishing the whole Korean card list is copying and
  distributing their data, and Korean copyright law also protects a database as a whole
  (database producers' rights). Without Pokémon Korea's written permission, the official
  site is not a source for published data. The probe stays unrun.
- **Cardmarket**: the download page is `cardmarket.com/en/Pokemon/Data/Product-List`
  (the "Product-Catalogue" address was wrong), and the general terms are at
  `cardmarket.com/en/Pokemon/Policies/GeneralTermsAndConditions`. Both are behind
  Cloudflare's bot check, which the assistant does not get past, so the owner opens them.

Cardmarket's files (2026-11-26 build, downloaded by the owner from the Product-List
page; `node tools/cardmarket-probe.mjs --file … --nonsingles …`, no request to
Cardmarket):

- 75,928 singles and 5,199 sealed products. Each has a product id, an English name with
  the attacks in brackets ("Kakuna [Bug Bite | Primal Clash]"), a category, an expansion
  id, a metacard id and a date. **No card number, no Chinese name, no set name.**
- Simplified Chinese sets are found by the set code their sealed products start with
  ("CSM1aC: Storming Emergence - Radiant Booster"): 67 sets with 9,893 singles. 36 of
  those codes are TCGdex `zh-cn` set ids. Cardmarket has more cards per set than TCGdex's
  official count (CSV2C: 163 against 128), so it lists the secret rares too. 31 sets
  TCGdex lacks, among them CSV10C, the Happy Sets, Battle Party sets and starter decks.
- TCGdex's own `zh-cn` list has quirks: `CSV1C` twice (127 and 9 cards), lowercase twins
  of the CSM sets (`csm1a`, 211 cards, next to `CSM1aC`, 151), and its 8 sets with cards
  are filed under Japanese ids (`SV7a`, `SV8`, …).
- **So Cardmarket cannot give set + number + name**, and is not a card-list source. At
  most it is a check: its set list and card count per set against TCGdex, kept local,
  like the TCGplayer check. Cardmarket's ids never leave the build machine.

Next:

- [x] Owner: download Cardmarket's catalogue; probe it (2026-11-27, above).
- [ ] Owner: read Cardmarket's general terms before its counts feed any check that runs
  in CI or is published.
- [ ] Owner: ask Pokémon Korea for permission (`webmaster@pokemonkorea.co.kr`) before
  `node tools/pokemonkorea-probe.mjs` is run or anything is built on the site; until
  then Korean comes from TCGdex only.
- [x] Build Korean and Simplified Chinese from TCGdex (2026-11-27; design and what the
  build found below).
- [ ] Owner, optional: tell TCGdex about its `zh-cn` slips (copies, twins, the repeat;
  "Built" below), so the source gets fixed.

### Design: Korean and Simplified Chinese from TCGdex (2026-11-27)

**How the app already treats Asian set lists.** Traditional Chinese, Thai and
Indonesian are ordinary `LANGUAGES` entries whose TCGdex set ids (`SV7a`, `CS4b`) share
none with English. They live in two places:

- Master Set and TMS are built from the English card list. Every language gets one
  tile per English card, `{badge}_{English card id}` (`TW_sv04-001`). Today's KR and SC
  placeholder tiles are exactly that shape: `KR_sv04-001`, `SC_sv04-001`.
- Set mode shows each language's own sets, one tile per card, ticked in its own list
  (`state.ssChecked`) as `{badge}_{that language's card id}` (`TW_SV7a-052`). A set TCGdex
  lists without cards is shown greyed out: "no card list published in this language
  yet". Set mode offers no KR or SC today.

So Korean and Simplified Chinese need no pipeline of their own like Japanese. They
become two more `LANGUAGES` entries, and the build, `data/sets.json`, the catalogue, the
coverage report and the "Missing card" overrides pick them up from that list.

**What TCGdex has** (checked 2026-11-27):

- Korean (`ko`): 95 sets with names, dates, series and official counts; cards for 3
  (SV4M, SV4K, SV5K: 239 cards with names, numbers, rarity, prints). No images. No set id
  is also an English id; 53 are shared with TW/TH/ID, which `sets.json`'s per-language
  `lang` overrides already handle.
- Simplified Chinese (`zh-cn`): 57 sets. The 7 with cards (SV7a, SV7, SV8, SV8a, SV9,
  SV9a, SV10) are copies of the Traditional Chinese sets, with the same names in
  Traditional characters. The real Simplified Chinese sets (`CS…C`, `CSM…C`, `CSV…C`) have
  names and counts but about 9 cards in all. `CSV1C` is listed twice (127 and 9), and
  eight CSM sets also appear under lowercase twins (`csm1a` next to `CSM1aC`).

**The change**

1. `js/config.js`: move KR and SC from `PLACEHOLDER_LANGS` into `LANGUAGES` as
   `{ code:'ko', apiCode:'ko', badge:'KR' }` and `{ code:'zh-Hans', apiCode:'zh-cn',
   badge:'SC' }`, after ID, with a new flag `mirror:'placeholder'`. `PLACEHOLDER_LANGS`
   stays as an export, empty.
2. Master Set and TMS: a language with `mirror:'placeholder'` gets its tile on each
   English card as today's placeholder tile, with the same id (`KR_{English card id}`)
   and no image request (an English card id never has Korean or Chinese art). **Every
   tick saved on a KR or SC tile keeps its id; nothing is migrated.** Tested.
3. Set mode: KR and SC join the language picker with their own sets. The sets with
   cards open as usual, with names and numbers from TCGdex and placeholder art where
   TCGdex has none. The rest are greyed out, as for Italian or Thai today. Ticks are
   new ids (`KR_SV4M-001`) in the set-mode list, so nothing clashes.
4. TCGdex's `zh-cn` quirks, filtered in one pure function used by the build and by the
   live refresh (`js/api/…-model.js`, with tests): leave out a set whose id and name
   are the Traditional Chinese set's (a copy); leave out a lowercase twin of a `…C` set
   (`csm1a` of `CSM1aC`); keep one entry per id (the larger count). A note goes to
   TCGdex, from the owner, so the source gets fixed.
5. The build needs no new script: `build-data` reads the two set lists and their sets
   (about 155 more keyless TCGdex requests each Monday), and `build-catalog` writes
   `data/cat/ko/` and `data/cat/zh-Hans/` (8 requests). The coverage report then lists
   Korean and Chinese gaps per set, like every other language.
6. "Missing card" form: add Korean and Simplified Chinese to its language list. The
   overrides already accept any `LANGUAGES` code, so collectors can add the cards TCGdex
   lacks, checked against the set's official count.
7. The bell notice "Korean cards exist but no public image database yet" becomes a
   count from the data ("TCGdex has card lists for 3 of 95 Korean sets so far").
   README: languages, the Set mode note, the removed "no public card database" line.
8. Tests: the language list (now eleven), unchanged KR/SC ids in Master Set and TMS,
   the `zh-cn` filter, the picker offering both, and the catalogue index order.

**Not in it:** Korean from the official site (needs Pokémon Korea's permission);
Cardmarket (no numbers; at most a local count check later); linking a Korean or Chinese
card to its English or Japanese twin (Phase 8).

**Cost and risk.** No new source, key or credit. About 160 more TCGdex requests a week.
`data/sets.json` grows by two language maps (about 150 set names). The app must work
with `data/cat/ko/` or `data/cat/zh-Hans/` missing, as it does for the other languages'
catalogue files (a test covers it); Master Set and TMS do not read them.

### Built (2026-11-27)

As designed, with these differences and findings:

- **`PLACEHOLDER_LANGS` is gone** rather than kept empty: nothing imports it any more.
  `js/ui/mirror-model.js` splits `LANGUAGES` into tiles with art and placeholder tiles,
  and builds every tile id on an English card (tested: `KR_sv04-001`, `SC_sv04-001`).
- **Data:** Korean 95 sets, 3 with card lists (SV4M, SV4K, SV5K: 239 cards, no scans).
  Simplified Chinese 41 sets after cleaning, 1 with a card list (CSMPiC, 48 cards); the
  catalogue left out 829 cards of the 7 Traditional Chinese copies. `data/sets.json`
  went from 91 to 102 KB; nothing already in it changed except the count fix below.
- **The lowercase twins** (`csm1a`, …) have no cards, and nor do the `CSM…C` sets they
  shadow, so dropping them loses nothing collectable. The codes printed on the products
  (`CSM1aC`) are kept. But the twins' names, dates and counts look like the right ones
  for six of them: `csm1a` is 风暴涌现 (Storming Emergence), 211 cards, 2022-10-22, and
  Cardmarket has 211 singles for CSM1aC, while TCGdex's `CSM1aC` is named 横空出世 赫
  (the name of CS1aC), 151 cards, 2020-10-28. For the note to TCGdex.
- **Counts per language** are now compared with the shared map's count, not only with
  English's. Thai, Indonesian and Korean showed Traditional Chinese's count for the ids
  they share with it (SV4M: 66/66 TW, 66/95 KR); 33 overrides now say otherwise
  (TH 13, ID 8, KR 12).
- **Set ids are URL-encoded** in the build's per-set requests: four Korean ids end in
  `+` (SM1+, SM3+, SM4+, SM5+), and unencoded they were 404s, so those sets had no date
  and looked like they had cards.
- **The Missing card checker** read a set name in Hangul, Han or Thai as empty, so it
  matched every set of the language ("more than one set is called…"). It now keeps
  letters of every script; this was already true of Traditional Chinese and Thai.

## Phase 8: One card id across all sources (largest piece)

Only start once Phases 3 to 6 show it's needed.

- [ ] Mapping table: our card id ↔ TCGdex id ↔ PokéWallet set/number ↔ TCGplayer product
  ↔ Cardmarket product, with set code translations per language.
- [ ] Used for: "same card in other languages" in True master set, combining sources
  without duplicates, optional prices/links later.
- [ ] Build-side only for third-party ids (gitignored); what's published uses our own ids.

## Optional, after all phases

Left open on purpose. Pick them up once Phases 7 and 8 are done, or when one is needed.

- [ ] Phase 5: the gap report opens one issue per set that has a gap (deduplicated,
  rate-limited).
- [ ] Phase 6: a source match auto-confirms a "Missing card" report (level 3). Do it in
  the weekly run, from the TCGplayer diff, rather than per issue, so nobody can trigger
  requests to TCGCSV by opening issues. Auto-merge only if the owner agrees.
- [ ] Phase 6: the 48 Jumbo products that do not trace to one card
  (`tools/jumbo-prints-report.md`): 16 WotC box toppers (cards of their own, not
  prints), 21 with no number or several, 11 with typos or `a` numbers.
- [ ] Phase 6: send the 149 Jumbo prints to TCGdex, by hand (issue #19; plan under
  "Jumbo prints").
- [ ] Phase 6: about 45 stamped promos TCGplayer lists under the original number
  (prerelease, W and set stamps), as print overrides with a `stamp`.
- [ ] Phase 6: TCGplayer's Pokémon Japan category against `data/jp-cat/`
  (`node tools/tcgcsv-probe.mjs --jp`, about 330 requests, local).
- [x] Phase 6: match TCGplayer's trainer kits and McDonald's groups to TCGdex's sets
  (about 15 groups), so the baseline shrinks. Done 2026-11-27 by matching on cards
  (`matchByCards` in `tools/lib/tcgcsv.mjs`): a set of 10 cards or more, 9 in 10 of
  which one group lists under the same number and card name, or a group that sits in
  one set the same way. A kit group feeds both half decks, each card going to the deck
  that lists it. It found 28 sets inside 18 groups (10 kits, 7 McDonald's collections,
  and `exu` in the Unseen Forces group) and 3 groups inside a set (both Radiant
  Collections and Base Set (Shadowless)). Only 9 in 10 of a set's cards need to match,
  so a few cards filed differently do not stop the set being found. On the
  2026-11-26 build: 190 of 215 groups match (was 170), 366 numbers only TCGplayer lists
  (was 381), 104 only we list (was 158), 25 unmatched groups (was 45), 5 sets of ours no
  group matches (was 33). What the kits turned up, now in the baseline:
  - `tk-sm-l`: TCGdex lists 18 of the Lycanroc half deck's 30 cards; the 12 it lacks are
    its Fighting Energy. A real gap, worth telling TCGdex or adding as overrides.
  - `tk-xy-n` 29: TCGdex has the Noivern deck's Switch at 29; TCGplayer files it under
    4, where Bunnelby is, and has Granbull at 29. Probably TCGplayer's slip.
  - `tk-sm-r` 3: TCGplayer files a Lightning Energy "#3" under 2/30. TCGplayer's slip.
  - `exu`: TCGdex numbers the "?" Unown `%3F` (URL-encoded), so it stays one number
    apart from TCGplayer's `?` in `ex10`.
  Still unmatched: 25 groups TCGdex has no set for (23 product lines, the 2026
  McDonald's promos and the Alolan Sandslash & Alolan Ninetales trainer kit), and our
  `ex5.5`, `fut2020`, `miscp`, `xya` (under 10 cards) and `mfb`.

## Out of scope for now

- Prices, buy links and accounts.
- TCG Pocket cards (already excluded via `DIGITAL_SERIES`).
- High-res image hosting beyond what `tools/build-images.mjs` already does.
