# 🌰 Pokémon TCG Master Set Tracker

Track a complete **master set** for any Pokémon in the Pokémon Trading Card Game —
across every set, era, and language. No account, no install, no cost.

**🔗 Live site:** https://silencx.github.io/Tcg-Collection-Tracker/

The Seedot → Nuzleaf → Shiftry line is just the default demo list — pick your own
Pokémon and it builds the checklist for you.

---

## For collectors

### Four modes
- **Home** — where the app opens: what you have collected so far, by language and by
  expansion, and the way into the other three modes.
- **Master set** — the classic checklist: every card of your Pokémon, in every set,
  once per language. Good for "have I got this card at all" tracking.
- **True master set** — a binder you curate: browse the Pokémon catalogue, open a
  Pokémon and hand-pick exactly which of its cards, in which languages, belong in it.
- **Single set** — pick one expansion (and one language) and complete it card by card.

The three checklists are kept separately, so ticking a card in one never changes another.
In Master set a **☰ Sets** sidebar jumps between sets; the 🔔 bell keeps the app's messages.

### Pick your own Pokémon
**+ Add Pokémon** opens a picker over the full National Dex: all 1,025 species, Gens 1–9.
Search by English name, by the name in another language ("Glurak", "ピカチュウ"), or by
dex number ("25"). Your list is saved locally and can hold as many Pokémon as you like.
The True master set browser uses the same catalogue.

### Languages, and cameo appearances
- **English, German, French, Spanish, Italian, Portuguese** show real card images from
  TCGdex wherever it has a scan.
- **Japanese** cards come from a catalogue of every Japanese set (see below), with scans
  from Limitless TCG where it has them.
- **Traditional Chinese, Thai and Indonesian** cards show TCGdex's scan where it has one,
  which is about a third of them. These languages have their own sets, with ids that
  English does not share, so the scans appear when you open one of their sets in
  Single set. Their tiles in Master set and True master set use English card ids and
  mostly show the placeholder.
- **Korean and Simplified Chinese** have no public card database at all.

A card with no scan shows a placeholder tile with the card's name, set and number.

Placeholder tiles show the Pokémon's name in the card's language for every species:
Japanese, Korean, both Chinese scripts, and German, French, Spanish or Italian wherever
that name differs from the English one. Thai and Indonesian tiles show the English name.

A card is your Pokémon's when its name names it as a whole word ("Mewtwo" is not Mew's)
or when TCGdex's Pokédex numbers for the card include it. The numbers find cards whose
printed name the name rule cannot read ("Nidoran ♀", "Farfetch’d", "Ho Oh") and
**cameo** appearances whose name leaves your Pokémon out ("Terapagos & Friends" is
Pikachu's too). Tag Team cards show up for every Pokémon on them. A card whose name is
plainly another Pokémon's is not moved by a wrong number: TCGdex numbers one "Electrode"
as Gyarados, and it stays Electrode's (`js/api/match-model.js`).

### Missing a card?
Some cards no source lists: stamped promos, jumbo cards, oddities. Report one with the
**Missing card** form (the "report a missing card" link in the site footer, or
[open it here](https://github.com/Silencx/Tcg-Collection-Tracker/issues/new?template=missing-card.yml)):
language, set, number, name and a link that shows the card. A bot checks the report
within minutes. If it holds up, it opens a pull request that adds the card; if not, it
comments with what to fix, and editing the issue checks it again. Once merged, the card
shows in Master set and the True master set (English and Japanese cards) and in Single
set (any language), with a placeholder tile. When a source later lists the card itself,
the hand-added entry is removed and the report gets a comment.

### Print variant badges
Each card's footer shows which prints exist: **H** holo, **RH** reverse holo,
**1ED** 1st Edition, **SL** shadowless, **P** promo, and **+N** for anything
rarer (stamps, Poké Ball / Master Ball patterns, jumbo, error prints). Hover
the badges for the full list of prints. All of it comes from TCGdex. One
exception: TCGdex has no reverse-holo data for the Black & White, XY and Sun &
Moon eras, so those RH badges are worked out from rarity and drawn with a
dashed outline. That rule matched TCGplayer on 99.9% of the era's cards.

### Tracking individual prints (optional)
Off by default — the plain checklist only asks "do I have this card?". Turn it on
under ⚙ → **Print variants** to tick the exact prints you own, in Master Set,
Single set and the True Master Set popup:
- **Chips** keeps one tile per card and adds a toggle for each print (N, RH, H,
  1ED, SL…). Tap the art for the card, a chip for that print.
- **Tiles** gives every print its own tile, like binder slots.

The **Prints as tiles / chips** button next to **Sets** switches between the two.
Ticking a print ticks the card; unticking its last print unticks the card. Cards you
ticked before turning this on stay ticked, outlined in dashed gold until you pick the
print. The header adds a "P / Q prints" count, and Print selected / Print checklist
print one entry per ticked print. Turning it off hides the prints but keeps them, and
they are included in Export / Import.

### Printable checklists
Print a photo-accurate 9-up sheet of your current selection, or a compact
2-column text checklist — handy for binders, want lists, or trades. Both work in
all three checklist modes.

### Backup, transfer, sharing and themes
- **Export** downloads everything you have ticked as one JSON file; **Import**
  restores it on another device (old exports are migrated automatically).
- **Share view** copies a link capturing your current mode, filters, Pokémon list,
  sort order, theme, chosen set and print view — anyone who opens it sees the same
  view. **Restore view** applies a shared link (or reloads your last saved one). Your
  ticks themselves travel via Export/Import, not the link.
- Six themes under ⚙ (Forest, Ocean, Dusk, Fire, Mono, Dark); until you pick one, the
  app follows your system's light/dark setting.

---

## For developers

No build step, no framework, no dependencies — plain ES modules served as static
files. Runs from any static host (GitHub Pages) or a local web server.

### Run locally

ES modules must be served over HTTP, not opened as `file://`:

```bash
npm run dev          # python3 -m http.server 8000
# or: ./dev.sh   (macOS/Linux)   |   dev.bat   (Windows)
```

Then open <http://localhost:8000>. The checks and tests need only Node (CI runs 24):

```bash
npm run check        # syntax check + the `state.` prefix scan
npm test             # node --test, tests/*.test.mjs
```

### How it fits together

```
index.html            markup; boots js/main.js as a module
css/style.css         all styles (six palettes, fluid type scale)
js/                   config, state (one shared `state` object), storage, main (boot + modes)
  api/                data: router, the TCGdex provider + data/ snapshot reader,
                      the TCGdex card catalogue (catalog, catalog-model),
                      Japanese cards (jp-source, jp-model, bulba-jp), image URLs, variants,
                      the Pokémon catalogue (species, species-model)
  ui/                 one module per mode and feature, plus DOM-free *-model.js halves
data/                 the pre-built snapshot and catalogues (committed, refreshed by CI)
tools/                build scripts, the checker, research probes; tools/lib/ helpers
tests/                node:test suites — pure logic, plus source scans for invariants
docs/                 design notes
.github/workflows/    ci.yml (check + test), refresh-data.yml (data build: weekly, Japanese daily),
                      missing-card.yml (a "Missing card" report → a pull request)
.github/ISSUE_TEMPLATE/  the "Missing card" form
```

Start with `js/main.js` (boot, mode switching, the window handler manifest),
`js/api/router.js` (where data comes from) and `js/ui/masterset.js` (the main grid).

**Data flow:**
- EN cards: `data/cat/en/` catalogue → `data/cards/<slug>.json` shards → live TCGdex
  (a name search and an exact Pokédex-number search). Each source matches cards to
  Pokémon by name or number, by the one rule in `js/api/match-model.js`, with the
  numbers from `data/species.json`. Print variants: the Pokémon's shard, else live TCGdex
  GraphQL (by name and by number).
- Single set: live TCGdex → `data/cat/{lang}/` catalogue when TCGdex is down.
- Set names, dates, symbols: `data/sets.json` → live TCGdex.
- Pokémon catalogue and native names: `data/species.json` → the built-in 357 in
  `js/config.js` (see "Pokémon catalogue" below).
- Japanese cards: `data/jp-cat/` catalogue → Bulbapedia (`data/jp/` shards → live).
- Cards no source lists: `data/overrides.json`, merged into each of the lists above last
  (see "Missing cards" below).
- A user-triggered **Refresh** skips the catalogue and snapshot and fetches EN cards and
  set data live.

**State:** all app state lives on one exported `state` object (ES module bindings
can't be reassigned across files). The markup uses inline `onclick="fn()"` handlers;
`main.js` publishes those functions on `window`.

### Data and the weekly build

| Script | Reads | Writes | Key |
|---|---|---|---|
| `tools/build-data.mjs` (`npm run build-data`) | TCGdex, Bulbapedia, `data/prebuilt.json`, `data/jp-cat/` | `data/sets.json`, `data/index.json`, `data/cards/`, `data/jp/`, `tools/coverage-report.md` (local) | none |
| `tools/build-jp-catalog.mjs` (`npm run build-jp-catalog`) | PokéWallet | `data/jp-cat/` (committed), `data/jp-catalog/` + report (local) | `POKEWALLET_IO_PROD_KEY` |
| `tools/build-images.mjs` (`npm run build-images`) | `data/jp-catalog/`, PokéWallet | `img/`, `data/img-index.json` (committed) | `POKEWALLET_IO_PROD_KEY` |
| `tools/build-catalog.mjs` (`npm run build-catalog`) | TCGdex | `data/cat/` | none |
| `tools/build-species.mjs` (`npm run build-species`; one-off, per new generation) | PokéAPI | `data/species.json` | none |
| `tools/missing-card.mjs` (run by `missing-card.yml`) | an issue body, `data/` | `data/overrides.json` | none |
| `tools/prune-overrides.mjs` | `data/overrides.json`, `data/cat/`, `data/jp-cat/` | `data/overrides.json` | none |
| `tools/check.mjs` | `js/`, `tools/` | — | none |
| `tools/apitcg-probe.mjs`, `tools/pokewallet-probe.mjs`, `tools/tcgdex-catalog-probe.mjs`, `tools/tcgdex-dexid-probe.mjs`, `tools/jp-gap-size.mjs` | research probes; reports stay local | — | their own |

`.github/workflows/refresh-data.yml` runs build-data, build-catalog, build-jp-catalog and
build-images every Monday, and the two PokéWallet steps alone on the other days (see
"Daily refresh" below); every day it ends with prune-overrides (see "Missing cards"
below) and commits `data/` and `img/` when they changed. Every
Pokémon's card list comes from the catalogue (see "Card catalogue" below). A pre-built
Pokémon (`data/prebuilt.json`, at most 60) also has its print variants and its
Bulbapedia Japanese rows baked in, so a visitor tracking only pre-built Pokémon makes zero
API calls, and any other Pokémon costs two GraphQL requests (by name and by Pokédex
number) for its print badges. Run the
workflow by hand from the **Actions** tab to pre-build more: its `add` input appends
Pokémon to `data/prebuilt.json`, so the next scheduled run keeps them.

- A data file whose contents did not change is written back byte for byte, `builtAt`
  included (`tools/lib/built-at.mjs`), and card lists are sorted by id, so a week with
  nothing new commits nothing.
- `data/sets.json` carries a date for every set, because a snapshot with any gap is a
  miss. Its maps are flat unions across languages, with per-language overrides under
  `lang`; read them through `dateFor` / `countFor` in `js/ui/setmode-model.js`.
- A set's CDN path segment is its TCGdex **series** (`setSeries`), never a slice of its
  id: always go through `tcgdexSerieSegment` in `js/api/images.js`.
- Sets in `DIGITAL_SERIES` (`js/config.js`; TCG Pocket) are left out of the single-set
  picker.

### Coverage report

`build-data` ends by naming every set, per language, where the card list we serve is
shorter than the set (`tools/lib/coverage.mjs`). It costs no requests: it reuses the card
list of every set in every language that the set sweep already reads, plus the committed
Japanese catalogue. The summary goes to the build log (the Monday run in **Actions**), one
line per language, `-N` for cards missing and `+N` for duplicates:

```
[coverage]   de: 13 set(s), 491 card(s) missing — basep -29, bw11 -9, …
```

The full table, with the missing numbers, is written to `tools/coverage-report.md`, which
stays local. Three kinds of gap:

- **Missing**: a number from 1 to the set's official size has no card. The run is
  checked number by number, so a secret rare above the official size never hides a hole.
  A set TCGdex lists with no cards at all misses every number.
- **Short**: the official run is complete, but another language lists more cards for the
  same set (usually secret rares). TCGdex's own "total" is the number of cards it holds
  in that language, not a printed figure, so a set's total is the most cards any
  language lists for it.
- **Duplicate**: one number listed twice (`001` and `1`), or more cards than the total.

Japanese sets have no official size from PokéWallet, so it is read off the cards: the
denominator most of a set's cards print (`001/011` → 11). Promo sets (`001/SV-P`) and the
numberless early sets have none and are counted as unchecked, as is any set whose card
list request failed. TCG Pocket sets are left out. The report never changes `data/` and
never fails the build.

### Card catalogue

Every card TCGdex lists, in all nine languages it covers, is committed as a catalogue
built by `tools/build-catalog.mjs`:

```
data/cat/index.json                  # which languages, how many cards, which shards
data/cat/{lang}/cards-{a-z,0}.json   # [set, number, name, category, [dex…]?, 0?], split by name letter
```

About 126,000 cards and 5 MB in all; English is 23,900 cards in 993 KB, and no shard is
over 115 KB before gzip except the one `cards-0.json` of Traditional Chinese (247 KB) and
of Thai (146 KB). A card is filed under the first letter of every word in its name, as in
`data/jp-cat/`, so the master set loads one shard per Pokémon; a name with no Latin letter
goes in `cards-0.json`. The card id is always `{set}-{number}` and the image address is
rebuilt from `data/sets.json`, so neither is stored. Category is `P`, `T` or `E`
(Pokémon, Trainer, Energy). English rows then carry the card's Pokédex numbers, when it
has any: every Pokémon card except the newest set's, before TCGdex fills them in. A card
is also filed under the shard of each Pokémon its numbers name, so "Terapagos & Friends"
is in Pikachu's shard. A trailing `0` marks a card TCGdex lists without a scan, which is
about two thirds of the Traditional Chinese, Thai and Indonesian cards.

- **Master set and the True master set popup** read the English catalogue first
  (`js/api/catalog.js`), so any Pokémon gets its full list without a live name search,
  matched by name or Pokédex number like the live search. Print badges come from the
  Pokémon's pre-built shard if it has one, else from TCGdex GraphQL; if that fails, the
  cards still show, without badges.
- **Single set** still asks TCGdex first: that is one request and brings print badges,
  where the catalogue would load every shard of the language. When TCGdex is down, the set
  is listed from the catalogue, with its name, date and count from `data/sets.json`, and
  scans are requested for the same cards as when TCGdex answers.
- **Refresh** skips the catalogue and searches TCGdex live, which is how a card added
  since Monday shows up.

The build needs no key: per language, `/{lang}/cards` (the whole list in one answer),
`/{lang}/categories`, and the list once per category, because list items carry none.
English adds its Pokédex numbers from GraphQL, the only bulk source, one query per
category. That is about 52 requests and 6 seconds every Monday. A language is replaced
only by a complete answer: one that fails, or lost more than a tenth of its cards, keeps
its committed files, and so does English when under 90% of its Pokémon cards come back
with numbers (`--force` accepts either). The log prints each language's cards, sets, size
and largest shard, and for English how many cards have numbers and which sets lack them.

```bash
npm run build-catalog                 # every language
node tools/build-catalog.mjs en de    # just these
```

**Withdrawing it.** Delete `data/cat/` and the "Build card catalogue" workflow step.
TCGdex stays credited in the footer for its other data. The app needs no change: without
`data/cat/index.json` the router goes back to the per-Pokémon shards and live TCGdex, and
single-set mode simply has no fallback.

### Missing cards

Cards no source lists are added by hand to `data/overrides.json`, one row per card:

```
{ "lang": "en", "set": "swshp", "number": "SWSH020", "name": "Pikachu", "dexId": [25], "source": "<proof link>", "issue": 12 }
```

`set` is the TCGdex set id, or for Japanese the catalogue's set key
(`data/jp-cat/sets.json`); `number` is spelled the way that set spells its numbers. The
app reads the file once a session (`js/api/overrides.js`) and merges it last, never in
place of a card a source lists (`js/api/overrides-model.js`):

- **English** rows join Master set and the True master set popup, matched to Pokémon by
  the same name-or-number rule as every other card.
- **Any TCGdex language**: Single set for that set and language, in number order.
- **Japanese** rows join the Japanese cards, for sets the Japanese catalogue has.

Override tiles are placeholders: no source has a scan of the card either. A missing or
malformed file means no overrides.

**Reports.** Rows come from the "Missing card" issue form
(`.github/ISSUE_TEMPLATE/missing-card.yml`). `.github/workflows/missing-card.yml` runs
`tools/missing-card.mjs` on every opened or edited report. The script checks that the set
exists in that language (`data/sets.json`, `data/jp-cat/sets.json`), that the number is
plausible and takes the set's own style ("20" in SWSH Black Star Promos is `SWSH020`),
that the committed card list does not already have it, and that the proof link is an
https page on an allowed site (`PROOF_HOSTS` in `tools/lib/overrides.mjs`).

- A valid report becomes a pull request from the branch `missing-card/issue-N` that
  changes only `data/overrides.json`, with `Closes #N`. A person merges it.
- An invalid one is labelled `needs-info` and gets a comment that says what to fix.
- The issue body is untrusted input. It reaches the script only through an environment
  variable, the job starts with no permissions and is given only what it needs, and it
  never pushes to `main`; `tests/missing-card.test.mjs` scans the workflows for this.
- Pull requests opened with the workflow's token start no other workflow, so CI runs
  when the pull request is merged; `tests/overrides-model.test.mjs` checks the committed
  file then.
- One-time setting, for the pull requests: **Settings → Actions → General → Workflow
  permissions → Allow GitHub Actions to create and approve pull requests**. Without it
  the check and its comments still work, and opening the pull request fails in the
  workflow log. The two labels are created by the workflow itself.

**Pruning.** Every day the data refresh runs `tools/prune-overrides.mjs` after the card
lists are rebuilt. A row whose card the committed list now has (same language, set and
number, ignoring case and zero padding) is removed, and its report gets a comment after
the push. A language whose list cannot be read keeps its rows.

```bash
node tools/missing-card.mjs --issue 12 --body-file body.md --out tmp/mc --dry-run   # check a report locally
node tools/prune-overrides.mjs                                                     # drop rows a source now lists
```

**Withdrawing it.** Delete `data/overrides.json`, the issue form, the
`missing-card.yml` workflow and the prune steps in `refresh-data.yml`. The app needs no
change: without the file every list is exactly what its sources give.

### Pokémon catalogue

The add-Pokémon picker, the first-run modal, the True master set browser, the dashboard's
"N of M" and the native names on placeholder tiles all read one list: every species from
[PokéAPI](https://pokeapi.co/), built by `tools/build-species.mjs` into
`data/species.json` (dex number, generation, English name, and the name in each language
that differs from English; about 40 KB gzipped). Boot loads it onto `state`
(`js/api/species.js`); if it takes over 1.5 s, the first screen uses the built-in list and
the full one takes over when it arrives.

It is a one-off, not part of the weekly job: rerun it when a new generation comes out.
It needs no key. Each species' answer is kept in `tools/.cache/pokeapi/species/`
(gitignored), so the first run costs ~1,026 requests and a rerun only fetches what is new;
`--refresh` fetches everything again. If any species fails, nothing is written. English
names are stored with a straight apostrophe ("Farfetch'd"), the way TCGdex spells them.

```bash
node tools/build-species.mjs              # fetch what the cache lacks, write data/species.json
node tools/build-species.mjs --refresh    # fetch every species again
```

**Withdrawing it.** Delete `data/species.json` and drop PokéAPI from the footer. The app
needs no change: without the file it falls back to the hand-picked 357 species in
`POKEMON_CATALOG` and the demo Pokémon's names in `NATIVE_NAMES` (`js/config.js`). A
Pokémon someone already tracks stays on their list either way.

### Japanese card catalogue

Japanese cards come from a catalogue of every Japanese set, built from
[PokéWallet](https://pokewallet.io/) by `tools/build-jp-catalog.mjs` and committed as:

```
data/jp-cat/sets.json            # 457 sets: name, code, date, era, Limitless code
data/jp-cat/cards-{a-z,0}.json   # ~30,000 cards, split by name letter
```

`js/api/jp-source.js` reads it for **any** Pokémon, and still adds what Bulbapedia's
snapshot has that it lacks (World Champions Pack). Only facts are published — set names,
card numbers, card names — never PokéWallet's own ids, which stay in the gitignored
build-side copy (`data/jp-catalog/`). The site footer credits PokéWallet as the source;
keep that line for as long as the list is published. Japanese checklist ids are
`JP_{set}_{number}` (`js/api/jp-model.js`), the same in Master Set and TMS; older ids
are moved over once at boot (`js/ui/jp-migrate.js`), and an id it cannot place with
certainty is kept, never dropped.

Two rules keep those ids stable as PokéWallet's list changes. Each rebuild reads the
published `data/jp-cat/sets.json` first:

- **A published set keeps its key**, matched by name + code, even when a second set with
  the same name appears.
- **A new set that mostly repeats another set is left out.** PokéWallet lists some sets
  twice under other names, for example `xsv2a` for Pokémon Card 151, or "Evolutions
  Collection 1" for the Japanese Base Set. A set is left out when at least 70% of its
  cards repeat one set that stays. A published set is never left out.

The build log names every set it leaves out (`left out N set(s) that repeat another`).
`build-images` applies the same rules, so a left-out set gets no images.

**Daily refresh.** The workflow step needs the `POKEWALLET_IO_PROD_KEY` repository
secret; without it the step does nothing. Reading every set is ~560 requests, more than
PokéWallet's free tier allows in an hour (100), so the script keeps each set's raw
answer in `tools/.cache/pokewallet/jp-sets/` and CI keeps that folder between runs
(`actions/cache`). Each daily run then reads only new sets, sets whose card count
changed, and the 40 read longest ago (`--rotate 40`): about 45 requests, with every set
re-read within ~14 days.

- Only a **complete** walk replaces the committed files. If the cache is lost (GitHub
  evicts one unused for 7 days; the daily run prevents that), the walk starts over and
  takes about six days on the free tier, and the committed list stays as it was until
  it is done.
- A file whose rows did not change keeps its timestamp, so a quiet day commits nothing.
- The cache holds PokéWallet's own card ids. It is never committed, but any workflow in
  this repository, a pull request's included, could restore it.
- `--refresh` re-reads every set in one go (a paid plan's quota, or several runs).

**Withdrawing it.** If PokéWallet asks, revert the commit that added `data/jp-cat/` and
drop the workflow step. The app needs no change: with the files gone it falls back to
Bulbapedia on its own.

```bash
npm run build-jp-catalog                       # fetch what is new or changed (needs the key)
node tools/build-jp-catalog.mjs --rotate 40    # ... plus the 40 sets read longest ago, as CI does
node tools/build-jp-catalog.mjs --emit-only    # rebuild data/jp-cat/ from the local copy, no requests
```

### Hosted card images

About 10,000 Japanese cards are in sets the Limitless CDN has no scans for.
`tools/build-images.mjs` fills exactly that gap from PokéWallet into
`img/jp/<set>/<number>-low.<ext>` (low-res: 200×280 for most, about 255×361 for some;
~20 KB each, ~190 MB in all) plus a manifest, `data/img-index.json`, both committed and
served by Pages. It works from the build-side catalogue, so run build-jp-catalog first.
The daily job fetches only cards that are new.

- **Gaps only, write once.** A card that already has art elsewhere is never fetched, and
  a file that exists is never fetched again, so a normal run costs 0 requests.
- **Low only.** The preview reuses the grid image. `--sizes low,high` adds the 500×699
  scan, but all of them would pass a gigabyte, more than a Pages repo should carry.
- **Not every card gets one.** About 560 cards answer 404 (PokéWallet lists the card but
  has no scan), and a few come back far larger than low-res (748×536, 1024×734). Both are
  recorded in the manifest as `unavailable`, keep their placeholder, and are not asked
  for again. Delete a card's manifest entry to retry it.
- **Our ids, not theirs.** Paths come from our set names and card numbers; the manifest
  carries no PokéWallet card ids, and every entry names its `source`.
- By default it covers the pre-built Pokémon; `--pokemon "A,B"` picks others, `--all`
  takes every gap card. `--dry-run` shows the plan; `--max N` caps the requests
  (default 400). It stops at the live quota reserve; run it again to continue.

```bash
node tools/build-images.mjs --all --dry-run    # how many cards still need a file
node tools/build-images.mjs --all --max 1200   # one hour's worth of the gap
```

Pass flags to the scripts with `node`, not through `npm run x -- …`: PowerShell drops the
`--`, and npm then takes `--all` and `--max` as its own options.

**Withdrawing them.** If PokéWallet asks, delete every `img/` file whose manifest entry
says `"source":"pokewallet"` (today that is all of them, so `git rm -r img
data/img-index.json`), remove the "Fetch new Japanese card images" workflow step, and
drop PokéWallet from the footer's scan credit. The app needs no change: a missing
manifest is read as empty, and those tiles go back to placeholders. Removed files stay in
git history unless the history is rewritten.

### Build keys

Keys are only ever read by `tools/`, never shipped in `js/`. Locally they go in
`.env.local` (gitignored); in CI they are repository secrets.
`POKEWALLET_IO_PROD_KEY` serves the catalogue, image and PokéWallet probe tools (use a
separate development key locally; the production key lives only in the repository
secret). `APITCG_KEY` is read only by the retired `tools/apitcg-probe.mjs`. Without a key, the build
scripts skip their API steps and exit cleanly, so a fork's refresh job still succeeds.

### Deploy (GitHub Pages)

1. Push to `main`.
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a
   branch**, branch `main`, folder `/ (root)`.
3. The site serves at `https://<user>.github.io/<repo>/`.

Everything is static; the only "backend" is the scheduled Action that refreshes
`data/` and `img/`. Visitors cannot add to that cache — Pages accepts no writes. The card
catalogue already lists every Pokémon; adding one to the pre-built list only bakes in its
print badges and Bulbapedia Japanese rows.

### Docs

- [`docs/design-language.md`](docs/design-language.md) — this app's visual language,
  compared with DexTCG's, and where the gaps are worth closing.
- [`docs/card-coverage-plan.md`](docs/card-coverage-plan.md) — the phased plan for
  listing every card that exists; each phase is ticked off in the PR that does it.

---

## Credits

Card data and images come from:
- [TCGdex](https://www.tcgdex.net/) — primary card index and the card catalogue (`data/cat/`), set metadata, print variants, and images
- [PokéWallet](https://pokewallet.io/) — the Japanese card list (every Japanese set; `data/jp-cat/`)
- [Bulbapedia](https://bulbapedia.bulbagarden.net/) — Japanese card listings (fallback)
- [Limitless TCG](https://limitlesstcg.com/) — Japanese card scans
- [PokéAPI](https://pokeapi.co/) — the Pokémon catalogue and its names in other languages (`data/species.json`)
- Collectors' "Missing card" reports — cards no source lists (`data/overrides.json`)

This project is [MIT-licensed](LICENSE) and is not affiliated with, endorsed
by, or sponsored by Nintendo, The Pokémon Company, or The Pokémon Company
International.
