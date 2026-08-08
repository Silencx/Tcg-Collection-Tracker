# 🌰 Pokémon TCG Master Set Tracker

Track a complete **master set** for any Pokémon in the Pokémon Trading Card Game —
across every set, era, and language. No account, no install, no cost.

**🔗 Live site:** https://silencx.github.io/Tcg-Collection-Tracker/

The Seedot → Nuzleaf → Shiftry line is just the default demo list — type any
Pokémon's name in and it builds your checklist for you.

![Screenshot](docs/screenshot.png)

---

## For collectors

### Master Set vs. True Master Set
- **Master Set** — the classic checklist: one entry per Pokémon, per set, per
  language. Good for "have I got this card at all" tracking.
- **True Master Set (TMS)** — binder-level detail: pick individual *prints*
  (holo, reverse holo, 1st edition, promos, etc.) rather than just the card.

Switch between the two any time with the toggle at the top — each keeps its
own checklist and settings.

### Pick your own Pokémon
Type a name into the **Add Pokémon** box to add it to your tracked list, or
remove ones you don't want. Your list is saved locally and can include as many
Pokémon as you like.

Autocomplete draws on a built-in catalog of 357 species spanning Gens 1–9 — a
popular subset, not the full National Dex. You can still type any Pokémon not in
the catalog and it will be looked up normally; only the suggestions and the True
Master Set browser are limited to catalog entries.

### Languages, and cameo appearances
Filter by language: English, German, French, Spanish, Italian, Portuguese,
Traditional Chinese, Thai, and Indonesian all show real card images; Japanese
is sourced separately (via Bulbapedia) as its own column; Korean and
Simplified Chinese show as placeholders for now since no public card-image
database exists yet for them.

Search also catches **cameo** appearances — cards where your Pokémon shows up
alongside another (Tag Team cards, partner promos, etc.) — since matching is
name-based, not "must be the only Pokémon on the card."

### Printable checklists
Print a photo-accurate 9-up sheet of your current selection, or a compact
2-column text checklist — handy for binders, want lists, or trades. Both
print views work in Master Set and True Master Set mode.

### Backup, transfer & sharing
- **Export data** downloads everything you've checked off as one JSON file;
  **Import data** restores it on another device (old exports are migrated
  automatically).
- **Share view** copies a link capturing your current mode, filters, Pokémon
  list, sort order, and theme — anyone who opens it sees the same view.
  **Restore view** applies a shared link (or reloads your last saved one).
  Your checked-off progress itself travels via Export/Import, not the link.

---

## For developers

No build step, no framework, no API keys — plain ES modules served as static
files. Runs from any static host (GitHub Pages) or a local web server.

### Run locally

ES modules must be served over HTTP, not opened as `file://`:

```bash
npm run dev          # python3 -m http.server 8000
# or: ./dev.sh   (macOS/Linux)   |   dev.bat   (Windows)
```

Then open <http://localhost:8000>.

Syntax-check every module (portable — pure Node, no bash, no dependencies):

```bash
npm run check
```

### How it's organized

```
index.html              # markup only; boots js/main.js as a module
css/style.css           # all styles
js/
  config.js             # constants, storage keys, language tables, Pokémon catalog
  storage.js            # the only module that touches localStorage (+ quota handling)
  state.js              # the single shared `state` object + persistence helpers
  main.js               # boot + mode switching + the window handler manifest
  api/
    images.js           # pure image-URL builders (Limitless, TCGdex)
    router.js            # provider failover: snapshot → live TCGdex → legacy
    bulba-jp.js          # pure Bulbapedia JP parser/fetcher — shared by browser + build-data
    providers/
      snapshot.js        # reads pre-built data/*.json (instant, no API)
      tcgdex.js          # live TCGdex (primary card index + set metadata)
      legacy.js          # FROZEN Bulbapedia + pokemontcg.io pipeline (fallback + JA)
  ui/
    masterset.js         # Master-Set render, filters, Pokémon chips, preview
    tms.js                # True-Master-Set browser + per-Pokémon card popup
    print.js              # print views (cards 9-up + text checklist), both modes
    html.js               # HTML/URL escaping for the string-built markup (print, placeholders)
    banners.js            # storage-quota banner
    io.js                 # export / import (+ id migration) and shareable sessions
data/                    # pre-built snapshots (committed; refreshed by CI)
  cards.json, sets.json  # EN card index + set metadata (from TCGdex)
  jp.json                # Japanese card index (from Bulbapedia)
tools/
  build-data.mjs         # regenerates data/*.json from TCGdex + Bulbapedia
  check.mjs              # portable syntax + state-prefix checker used by `npm run check`
  state-prefix-scan.mjs  # flags a state property used bare instead of `state.<name>`
diagnostics/index.html   # TCGdex API diagnostics harness
reference/old-tool.html  # original single-file prototype, kept for history
```

**Data flow:** `data/*.json` (instant, no rate limits, any number of users) →
live TCGdex as fallback / on user refresh → legacy pipeline if TCGdex is
unavailable. Japanese cards follow the same pattern: `data/jp.json` first,
live Bulbapedia as fallback/refresh.

**State:** all app state lives on one exported `state` object (ES module
bindings can't be reassigned across files). The markup keeps inline
`onclick="fn()"` handlers; `main.js` publishes those functions on `window`.

### Refresh the card data

```bash
npm run build-data     # node tools/build-data.mjs  (needs Node 18+ and network)
```

This pulls the EN card index + set metadata from TCGdex and the Japanese card
list from Bulbapedia, and writes:

```
data/prebuilt.json      # the Pokémon list to build — edit this to widen coverage
data/index.json         # exact Pokémon name → shard filename (resolves slug collisions)
data/cards/<slug>.json  # per-Pokémon EN card shard
data/jp/<slug>.json     # per-Pokémon JP shard
data/cards.json         # combined EN index  ) kept for one release cycle so a visitor
data/jp.json            # combined JP index  ) with cached JS that predates the shards
data/sets.json          # set metadata for EVERY set, in all nine languages
```

Commit the result. `data/` is the **host-served cache**: `js/api/providers/
snapshot.js` reads it and `js/api/router.js` tries it *before* any external API,
so a visitor tracking pre-built Pokémon makes zero API calls. Coverage is
per-Pokémon, so a partial match works too — ask for three Pokémon where two are
pre-built and only the third is fetched live.

Two things worth knowing if you change this:

- `data/sets.json` carries a release date for **every** set, not just the ones the
  built Pokémon appear in. `snapshot.getSetMeta` rejects a date map with any gap
  (a missing date collapses a set into the 1999 sort fallback, i.e. one giant fake
  era), so a partial map is a guaranteed miss for anyone with their own Pokémon —
  and they then pay nine `/sets` sweeps plus up to ~200 detail calls, the slowest
  thing in the boot path.
- **Its shape is deliberately lopsided.** `dates` / `symbols` / `logos` / `counts`
  are FLAT `{setId: value}` maps holding the *union* across all nine languages,
  while `lang.<code>` holds only the values that actually *differ* from them.
  That works because set ids are globally unique and release dates agree across
  every Latin-script language (measured: zero disagreements) — only the Chinese,
  Thai and Indonesian releases, which are separate products with their own ids,
  need per-language values. Duplicating all five maps nine times measured 275 KB
  against 93 KB this way, on a file fetched on every boot. `dateFor` / `countFor`
  in `js/ui/setmode-model.js` are the two-line resolution rule; use them rather
  than indexing the maps directly.
- `setSeries` maps each set to its TCGdex **series**, and it is load-bearing well
  beyond the picker's grouping: it is also the CDN path segment. Slicing digits off
  the id — which this app did for a long time — is wrong for 48 of the sets that
  carry artwork (`cel25`→`swsh`, `swshp`→`swsh`, `A1`→`tcgp`, every Trainer Kit)
  and yields the empty string for the McDonald's sets. Always go through
  `tcgdexSerieSegment` in `js/api/images.js`; `tests/images-serie.test.mjs` pins
  the known-bad list.
- Series listed in `DIGITAL_SERIES` (`js/config.js`) are filtered out of the
  single-set picker — currently `tcgp`, Pokémon TCG Pocket, which is a mobile game
  rather than something you can own. The data still ships them, so re-including
  them is a one-word change and needs no rebuild.
- Shards are fetched **independently**, not sliced out of the combined result: a
  cameo card shared by two Pokémon is deduped onto the first-listed one, so a
  slice would leave it out of the other's shard.

To build a different list ad hoc:

```bash
node tools/build-data.mjs "Pikachu,Eevee"
```

### The API TCG key (optional, build-time only)

API TCG needs an `x-api-key` on every request, so it is called **only** from `tools/`,
never from the browser — a key shipped in `js/` would be readable by anyone viewing
source. Everything still works without it; the API TCG steps just skip.

- **Locally:** put `APITCG_KEY=…` in `.env.local`. That file is gitignored, and
  `.claude/hooks/block-secrets*.mjs` blocks the assistant from reading it.
- **In CI:** add `APITCG_KEY` under **Settings → Secrets and variables → Actions**.
  `refresh-data.yml` passes it to the build step and nowhere else.

To see what the API can do (one-off, capped at 10 requests):

```bash
node tools/apitcg-probe.mjs
```

It writes `tools/apitcg-probe-report.md` — a redacted capability report. Request headers
are never recorded and the text is checked for the key before it is written.

CI does this automatically: `.github/workflows/refresh-data.yml` runs weekly and
on demand from the **Actions** tab. Its manual form takes an `add` input, which
*appends* to `data/prebuilt.json` and commits it — so widening coverage is
durable instead of being overwritten by the next scheduled run.
`.github/workflows/ci.yml` runs `npm run check` and `npm test` on every push and
pull request.

A user-triggered **Refresh** in the app bypasses the snapshot and fetches live.

> **Note:** visitors cannot contribute to this cache. GitHub Pages serves static
> files and accepts no writes, so "the host remembers cards people found" can only
> mean CI pre-building them. A genuinely crowd-sourced cache would need a backend.

### Deploy (GitHub Pages)

1. Push to `main`.
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a
   branch**, branch `main`, folder `/ (root)`.
3. The site serves at `https://<user>.github.io/<repo>/`.

Everything is static; the only "backend" is the weekly Action that refreshes
`data/`.

### Notes

- TCGdex language coverage varies (EN/DE/FR solid; ES/IT/PT partial; KR/SC are
  placeholders; JA comes from Bulbapedia). Missing-language card images
  simply don't render — the checklist is always complete.
- Native (non-Latin) Pokémon names shown on placeholder tiles come from a small
  hand-maintained table, currently covering only the three demo Pokémon
  (Seedot, Nuzleaf, Shiftry) in JP/TW/KR/SC — the Thai table is empty. Any other
  Pokémon simply shows its English name on those tiles.
- Autocomplete and the True Master Set browser are limited to the 357-species
  built-in catalog; Master Set mode accepts any name you type.
- **API TCG (apitcg.com) — works, build-time only, and it is not a JP source.**
  Verified endpoint (this took several wrong turns, so it is written down):

  ```
  GET https://api.apitcg.com/api/products?tcg=pokemon&type=card&name=charizard&limit=50&page=2
  header: x-api-key: <key>
  ```

  The host is **`api.apitcg.com`**, not `apitcg.com` — the latter is the marketing
  site and redirects to `www.`, where `/api/products` answers
  `{"error":"Please provide a TCG"}` no matter what you send it. There is no
  `/{game}/cards` path; `tcg` is a query parameter.

  What it returns that TCGdex does not: **tcgplayer prices** (low/mid/high/market),
  `attributes.Rarity`, `Artist`, HP, attacks and card text, and `set.release_date`.
  Coverage looks comparable — Seedot returns 20 records against TCGdex's 21.

  What it does **not** do:
  - **No Japanese.** `language=ja` is accepted and silently ignored — it returned an
    English card. It cannot replace the Bulbapedia scrape in `js/api/bulba-jp.js`.
  - **No variant matrix.** `Rarity` is a string like `"Holo Rare"`, not TCGdex's
    holo / reverse / firstEdition / wPromo flags that the True Master Set picker uses.
  - **Ids do not line up.** Cards are `_id: 37608` with `code: "013/132"` and
    `set._id: "pokemon-me01-mega-evolution"`. The checklist keys everything on TCGdex
    ids, so pulling cards in as gap-fill would create entries that duplicate ones the
    user has already ticked. Any use has to JOIN on set + number, not import ids.

  It is only ever called from `tools/` — see "The API TCG key" above.

---

## Credits

Card data and images come from:
- [TCGdex](https://www.tcgdex.net/) — primary card index, set metadata, and images
- [Bulbapedia](https://bulbapedia.bulbagarden.net/) — Japanese card listings
- [Limitless TCG](https://limitlesstcg.com/) — supplementary card images
- [pokemontcg.io](https://pokemontcg.io/) — legacy fallback data source

This project is [MIT-licensed](LICENSE) and is not affiliated with, endorsed
by, or sponsored by Nintendo, The Pokémon Company, or The Pokémon Company
International.
