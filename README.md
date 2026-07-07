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
Type a name into the **Add Pokémon** box (autocomplete covers every Pokémon
through Gen 9) to add it to your tracked list, or remove ones you don't want.
Your list is saved locally and can include as many Pokémon as you like.

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
      bulbapedia.js      # live Bulbapedia JP source used by the legacy pipeline
  ui/
    masterset.js         # Master-Set render, filters, Pokémon chips, preview
    tms.js                # True-Master-Set browser + per-Pokémon card popup
    print.js              # print views (cards 9-up + text checklist), both modes
    banners.js            # storage-quota banner
    io.js                 # export / import (+ id migration) and shareable sessions
data/                    # pre-built snapshots (committed; refreshed by CI)
  cards.json, sets.json  # EN card index + set metadata (from TCGdex)
  jp.json                # Japanese card index (from Bulbapedia)
tools/
  build-data.mjs         # regenerates data/*.json from TCGdex + Bulbapedia
  check.mjs              # portable syntax checker used by `npm run check`
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
list from Bulbapedia, and writes `data/cards.json`, `data/sets.json`, and
`data/jp.json`. Commit the result.

To build a snapshot for a different Pokémon list instead of the demo default,
pass a comma-separated list:

```bash
node tools/build-data.mjs "Pikachu,Eevee"
```

CI does this automatically: `.github/workflows/refresh-data.yml` runs weekly
(and on demand from the **Actions** tab) and commits any changes.
`.github/workflows/ci.yml` runs `npm run check` on every push and pull request.

A user-triggered **Refresh** in the app bypasses the snapshot and fetches live.

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
