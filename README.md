# Pokémon TCG Master Set Tool

A client-side tracker for building a **Master Set** of the Seedot / Nuzleaf / Shiftry
evolutionary line across every set and language — plus a **True Master Set (TMS)** mode
for hand-picking individual prints, and printable checklists/proxies.

No build step, no framework, no API keys. It's plain ES modules served as static files,
so it runs from any static host (GitHub Pages) or a local web server.

---

## Run locally

ES modules must be served over HTTP (not opened as `file://`). From the project root:

```bash
npm run dev          # python3 -m http.server 8000
# or: ./dev.sh   (macOS/Linux)   |   dev.bat   (Windows)
```

Then open <http://localhost:8000>.

Syntax-check every module:

```bash
npm run check
```

---

## How it's organized

```
index.html              # markup only; boots js/main.js as a module
css/style.css           # all styles
js/
  config.js             # constants, storage keys, language tables, default Pokémon
  storage.js            # the only module that touches localStorage (+ quota handling)
  state.js              # the single shared `state` object + persistence helpers
  main.js               # boot + mode switching + the window handler manifest
  api/
    images.js           # pure image-URL builders (Limitless, TCGdex)
    router.js           # provider failover: snapshot → live TCGdex → legacy
    providers/
      snapshot.js       # reads pre-built data/*.json (instant, no API)
      tcgdex.js         # live TCGdex (primary card index + set metadata)
      legacy.js         # FROZEN Bulbapedia + pokemontcg.io pipeline (fallback + JA)
  ui/
    masterset.js        # Master-Set render, filters, Pokémon chips, preview
    tms.js              # True-Master-Set browser + per-Pokémon card popup
    print.js            # print views (cards 9-up + text checklist), both modes
    banners.js          # storage-quota banner
    io.js               # export / import (+ id migration) and shareable sessions
data/                   # pre-built snapshots (committed; refreshed by CI)
tools/build-data.mjs    # regenerates data/*.json from TCGdex
diagnostics/index.html  # TCGdex API diagnostics harness
```

**Data flow:** `data/*.json` (instant, no rate limits, any number of users) → live
TCGdex as fallback / on user refresh → legacy pipeline if TCGdex is unavailable. Japanese
cards are injected separately from Bulbapedia.

**State:** all app state lives on one exported `state` object (ES module bindings can't be
reassigned across files). The markup keeps inline `onclick="fn()"` handlers; `main.js`
publishes those functions on `window`.

---

## Refresh the card data

The app ships with placeholder `data/*.json` (so it falls back to the live API until a
real build exists). To populate/refresh them:

```bash
npm run build-data     # node tools/build-data.mjs  (needs Node 18+ and network)
```

This pulls the card index + set metadata for the default Pokémon from TCGdex and writes
`data/cards.json` + `data/sets.json`. Commit the result.

CI does this automatically: `.github/workflows/refresh-data.yml` runs weekly (and on
demand from the **Actions** tab) and commits any changes.

A user-triggered **Refresh** in the app bypasses the snapshot and fetches live.

---

## Deploy (GitHub Pages)

1. Push to `main`.
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch `main`, folder `/ (root)`.
3. The site serves at `https://<user>.github.io/<repo>/`.

Everything is static; the only "backend" is the weekly Action that refreshes `data/`.

---

## Backup, transfer & sharing

- **Export data** downloads every saved key as one JSON file.
- **Import data** restores it. Importing an old backup migrates the Master-Set checklist
  ids to the current TCGdex format and reports any that can't be matched.
- **Share view** copies a link (`#s=…`) encoding your current view (mode, filters, Pokémon
  list, sort, theme); opening it elsewhere restores that view. Your checklist/TMS data is
  not in the link — use Export/Import for that.

---

## Notes

- TCGdex language coverage varies (EN/DE/FR solid; ES/IT/PT partial; KR/SC are placeholders;
  JA comes from Bulbapedia). Missing-language card images simply don't render — the checklist
  is always complete.
- A future server (FastAPI + PostgreSQL + Docker) is intentionally **out of scope**; this is
  a static, client-side tool.
