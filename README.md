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
**+ Add Pokémon** opens a picker over a built-in catalogue of 357 species spanning
Gens 1–9 — a popular subset, not the full National Dex. Your list is saved locally and
can hold as many Pokémon as you like. The True master set browser uses the same
catalogue.

### Languages, and cameo appearances
- **English, German, French, Spanish, Italian, Portuguese** show real card images from
  TCGdex wherever it has a scan.
- **Japanese** cards come from a catalogue of every Japanese set (see below), with scans
  from Limitless TCG where it has them.
- **Traditional Chinese, Thai and Indonesian** cards are listed, but TCGdex has no images
  for them yet; **Korean and Simplified Chinese** have no public card database at all.
  All five show a placeholder tile with the card's name, set and number.

Native Pokémon names on placeholder tiles cover only the three demo Pokémon so far;
anything else shows its English name.

Search also catches **cameo** appearances — cards where your Pokémon shows up
alongside another (Tag Team cards, partner promos, etc.) — since matching is
name-based, not "must be the only Pokémon on the card."

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
                      Japanese cards (jp-source, jp-model, bulba-jp), image URLs, variants
  ui/                 one module per mode and feature, plus DOM-free *-model.js halves
data/                 the pre-built snapshot (committed, refreshed weekly by CI)
tools/                build scripts, the checker, research probes; tools/lib/ helpers
tests/                node:test suites — pure logic, plus source scans for invariants
docs/                 design notes
.github/workflows/    ci.yml (check + test), refresh-data.yml (weekly data build)
```

Start with `js/main.js` (boot, mode switching, the window handler manifest),
`js/api/router.js` (where data comes from) and `js/ui/masterset.js` (the main grid).

**Data flow:**
- EN cards: `data/cards/<slug>.json` shards → live TCGdex for any Pokémon they lack.
- Set names, dates, symbols: `data/sets.json` → live TCGdex.
- Japanese cards: `data/jp-cat/` catalogue → Bulbapedia (`data/jp/` shards → live).
- A user-triggered **Refresh** skips the snapshot and fetches EN cards and set data live.

**State:** all app state lives on one exported `state` object (ES module bindings
can't be reassigned across files). The markup uses inline `onclick="fn()"` handlers;
`main.js` publishes those functions on `window`.

### Data and the weekly build

| Script | Reads | Writes | Key |
|---|---|---|---|
| `tools/build-data.mjs` (`npm run build-data`) | TCGdex, Bulbapedia, `data/prebuilt.json` | `data/sets.json`, `data/index.json`, `data/cards/`, `data/jp/` | none |
| `tools/build-jp-catalog.mjs` | PokéWallet | `data/jp-cat/` (committed), `data/jp-catalog/` + report (local) | `POKEWALLET_IO_PROD_KEY` |
| `tools/build-images.mjs` | `data/jp-catalog/`, PokéWallet | `img/`, `data/img-index.json` (local only) | `POKEWALLET_IO_PROD_KEY` |
| `tools/check.mjs` | `js/`, `tools/` | — | none |
| `tools/apitcg-probe.mjs`, `tools/pokewallet-probe.mjs`, `tools/jp-gap-size.mjs` | research probes; reports stay local | — | their own |

`.github/workflows/refresh-data.yml` runs build-data and build-jp-catalog every Monday
and commits `data/`. Run it by hand from the **Actions** tab to widen coverage: its
`add` input appends Pokémon to `data/prebuilt.json`, so the next scheduled run keeps
them. A visitor tracking pre-built Pokémon makes zero API calls; coverage is
per-Pokémon, so for three Pokémon where two are pre-built only the third is fetched live.

- `data/sets.json` carries a date for every set, because a snapshot with any gap is a
  miss. Its maps are flat unions across languages, with per-language overrides under
  `lang`; read them through `dateFor` / `countFor` in `js/ui/setmode-model.js`.
- A set's CDN path segment is its TCGdex **series** (`setSeries`), never a slice of its
  id: always go through `tcgdexSerieSegment` in `js/api/images.js`.
- Sets in `DIGITAL_SERIES` (`js/config.js`; TCG Pocket) are left out of the single-set
  picker.

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

**Weekly refresh.** The workflow step needs the `POKEWALLET_IO_PROD_KEY` repository
secret; without it the step does nothing. A full walk is ~490 requests in one run, and
CI starts with no cache, so the key's hourly limit has to cover that (the free tier's
100/hour and 1,000/day do not). Only a **complete** walk replaces the committed files —
a run stopped by the quota or an outage leaves them as they were — and a file whose
rows did not change keeps its timestamp, so an unchanged catalogue adds nothing to the
weekly commit.

**Withdrawing it.** If PokéWallet asks, revert the commit that added `data/jp-cat/` and
drop the workflow step. The app needs no change: with the files gone it falls back to
Bulbapedia on its own.

```bash
node tools/build-jp-catalog.mjs              # fetch (needs the key)
node tools/build-jp-catalog.mjs --emit-only  # rebuild data/jp-cat/ from the local copy, no requests
```

### Hosted card images (build-time only, not live yet)

About 10,700 Japanese cards are in sets the Limitless CDN has no scans for, so they show
a placeholder. `tools/build-images.mjs` fills exactly that gap from PokéWallet into
`img/jp/<set>/<number>-{low,high}.<ext>` plus a manifest, `data/img-index.json`. It
works from the local catalogue, so run build-jp-catalog first.

- **Gaps only, write once.** A card that already has art elsewhere is never fetched, and
  a file that exists is never fetched again, so a normal run costs 0 requests.
- **Our ids, not theirs.** Paths come from our set names and card numbers, and every
  manifest entry names its `source`, so one source's images can be removed in one pass.
- By default it covers the pre-built Pokémon; `--pokemon "A,B"` picks others, `--all`
  takes every gap card. `--dry-run` shows the plan; `--max N` caps the requests
  (default 400). It stops at the live quota reserve; run it again to continue.

**Not published yet.** `img/` and `data/img-index.json` are gitignored until PokéWallet
agrees to us republishing their images; until then the files only show up in your local
dev server (a missing manifest is treated as empty). To go live: delete those two lines
from `.gitignore`, and run `node tools/build-images.mjs` in `refresh-data.yml` after the
catalogue step.

### Build keys

Keys are only ever read by `tools/`, never shipped in `js/`. Locally they go in
`.env.local` (gitignored); in CI they are repository secrets.
`POKEWALLET_IO_PROD_KEY` serves the catalogue, image and PokéWallet probe tools;
`APITCG_KEY` is read only by `tools/apitcg-probe.mjs`. Without a key, the build
scripts skip their API steps and exit cleanly, so a fork's weekly job still succeeds.

### Deploy (GitHub Pages)

1. Push to `main`.
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a
   branch**, branch `main`, folder `/ (root)`.
3. The site serves at `https://<user>.github.io/<repo>/`.

Everything is static; the only "backend" is the weekly Action that refreshes
`data/`. Visitors cannot add to that cache — Pages accepts no writes, so wider
coverage means adding Pokémon to the pre-built list.

### Docs

- [`docs/design-language.md`](docs/design-language.md) — this app's visual language,
  compared with DexTCG's, and where the gaps are worth closing.

---

## Credits

Card data and images come from:
- [TCGdex](https://www.tcgdex.net/) — primary card index, set metadata, print variants, and images
- [PokéWallet](https://pokewallet.io/) — the Japanese card list (every Japanese set; `data/jp-cat/`)
- [Bulbapedia](https://bulbapedia.bulbagarden.net/) — Japanese card listings (fallback)
- [Limitless TCG](https://limitlesstcg.com/) — Japanese card scans

This project is [MIT-licensed](LICENSE) and is not affiliated with, endorsed
by, or sponsored by Nintendo, The Pokémon Company, or The Pokémon Company
International.
