# Design language: DexTCG vs. this tracker

## Purpose / how to use this doc

This is inspiration and shared vocabulary, not a locked spec. DexTCG (app.dextcg.com) is an app we've drawn design inspiration from before — the card-grid column breakpoints in `css/style.css:413-428` were already tuned to match theirs. This doc is a fuller pass: what DexTCG's design language actually is, what this tracker's design language already is, and where the gaps are worth closing.

When starting a new page or component, skim §2 and §3, then check §4 before inventing a new visual pattern — there's a good chance either app already solved the problem.

All DexTCG findings below were observed live (desktop 1280px, tablet 768px, mobile 375px, light + dark mode, August 2026), including computed styles pulled via devtools JS, not guessed from screenshots. All tracker findings cite a real file/line in this repo — spot-check if in doubt, `style.css` gets rewritten often enough that exact values may have drifted since.

## 1. Snapshot: what each app is built with

- **DexTCG**: Expo / React Native Web, styled with Tailwind-style utility classes baked into `className` (`rounded-2xl`, `bg-primary-background`, `bg-accent/15`, `web:hover:bg-accent/15`, etc.). No visible CSS custom properties beyond one RN-router artifact — theming is done through Tailwind's token classes (`bg-primary-background`, `text-primary-content`, `bg-accent`) which the app must be recompiling/remapping per accent-color + light/dark selection.
- **Tracker**: vanilla JS + one hand-written `css/style.css` (~1,500 lines), no build step, no framework. Theming is six full palettes as `body.palette-*` blocks, each redeclaring ~25 CSS custom properties. Heavily commented with rationale (not examples) — a distinctive, disciplined convention worth preserving in any new CSS.

## 2. DexTCG design language

### Tokens (as observed, light mode / default "Blue" accent)

| Token | Value | Where |
|---|---|---|
| Page background | `#EFF3F5` (light gray) | body wrapper behind all cards |
| Card / surface background | `#FFFFFF` | `bg-primary-background` class, cards, inputs, filter drawer |
| Default accent | `#3C8DF6` (blue) | icon buttons, active tab, focus states |
| Alt accent example | `#37C5A4` teal ("Amazonite") | seen via the color-wash overlay technique, also a selectable accent |
| Font | **Poppins** | `font-poppins-bold-italic` (hero/page titles, e.g. profile name, "Bulbasaur Cards"), `font-poppins-semibold` (section headers: "Collection", "Stories", "Generation I"), `font-poppins-regular` (body/inputs) |
| Radius, small (inputs/buttons) | ~14px (`rounded-2xl`) | search bar, filter button, tab pills |
| Radius, cards | ~21px (`rounded-3xl`) | profile card, Pokédex tiles, expansion tiles |
| Radius, avatar/FAB | full round (`rounded-full`) | avatar button, floating "+" add-variant button |
| Spacing feel | generous — large section gaps (~32-48px between H2 sections), ~12-24px card padding | dashboard, all list pages |
| Card art shadow | `0 4px 6px -1px / 0 2px 4px -2px` soft dual shadow | avatar button, elevated icon buttons |

Dark mode: page/chrome go near-black, card surfaces go dark gray, but **card artwork stays full, untouched color** — only chrome and surfaces re-theme, imagery never darkens. Accent colors and the color-wash technique both work unchanged in dark mode since the overlay is alpha-based, not a separate dark token set.

### Named patterns

- **Translucent color-wash overlay** — the signature technique. A plain white (or dark) card gets an `absolute inset-0` div in the accent color at **~15% opacity** layered on top (`opacity-15`), rather than a hardcoded tinted background token. This is why the profile banner reads as "soft mint" in light *and* dark mode with zero extra color tokens — it's just accent-at-15%-over-surface, so it's automatically theme-proof and works for any of the 8 selectable accents.
- **Accent-color + light/dark composable theming** — Preferences lets the user pick Mode (Light/Dark) independently from Accent (Blue/Purple/Pink/Red/Orange/Yellow/Green/Amazonite/Black&White), an 8-color swatch grid with a black ring on the selected swatch. This is a 2-axis system (mode × accent = 16 combinations) rather than a fixed list of complete named palettes.
- **Ambient card-glow on detail pages** — the card detail/route page shows the full card art on the left with a soft blurred gradient glow behind it in the card's own dominant hue (e.g. grass-green glow behind a Bulbasaur card), giving a premium "spotlight" feel.
- **Tabbed detail content** — card detail page has a tab strip (Card / Price / Friends / Folders / Notes) under the title.
- **Variant rows with inline pricing** — each printing/variant (Normal, Reverse Holo, Pokémon Day promo, etc.) is a full-width row: icon, name, marketplace logo, price, circular blue "+" button to add.
- **Attribute rows as pill-rows** — Illustrator, Release Date, Rarity, National Number, Energy Type, Regulation Mark each get their own white rounded row (icon + label + value + chevron), stacked, rather than a table or a two-column key/value grid.
- **"Other Printings" thumbnail rail** — small thumbnail strip at the bottom of the detail page linking to alternate art/prints of the same card.
- **Filter drawer** — a right-side slide-in panel (not inline, not a modal-center popup). Pill-shaped toggle chips grouped under collapsible section headers (Sort By, Card State, Notes, Card Type, Energy Type, Trainer Type, Rarity…). Energy types are shown as small colored circular swatches next to their label. Sticky bottom bar: filled primary "Show Results" button + outline secondary "Clear Filters" button.
- **Mascot empty states** — one consistent illustrated character (a donut-hole mascot, shown holding/using a magnifying glass for "no results") reused verbatim across Folders (empty), Search results (no matches), and any filtered-to-nothing card grid. Always paired with one line of copy + a single action button ("Learn More").
- **Command palette** — `Ctrl K` "Spotlight" is listed in the account dropdown menu as a global search/nav shortcut.
- **Account/settings menu** — dropdown from the avatar: a dark-gradient upsell banner ("Subscribe to Dex+") pinned at the top, then icon + label menu rows, destructive "Sign Out" separated at the bottom in red.
- **Toolbar row pattern** — search input + region-flag dropdown + sort-direction toggle + Grid/Stack-Variants view toggles + Filters button, all on one row, horizontally scrollable rather than wrapping.
- **Stat card row** — 2-3 stat cards side by side (e.g. "Complete Set" / "Master Set" / "Most Expensive"), each with label/value pairs and a circular percentage-ring chart on the right.

### Responsive behavior

- **Header**: full nav labels at ≥768px (tablet width already restores desktop nav); at 375px it collapses to just the avatar pill — nav links move behind a hamburger-style menu button (though note: in this pass the mobile hamburger icon appeared visually blank/invisible when tapped — worth a closer look if ever reverse-engineering this exact interaction, may be a DexTCG bug rather than a pattern to copy).
- **Grids**: Pokédex/Search card grid drops from 6 columns (desktop) → 3 columns (mobile), still a grid, never a single column. Expansion list drops from a 3-column card grid (desktop) → a single-column row list (mobile), a genuine layout change (grid→list), not just fewer columns.
- **Toolbar & stat rows**: on mobile these become horizontally-scrollable strips that clip off-screen (you scroll to see "Master Variants" stat card, or the "Stack Variants"/"Filters" buttons) rather than wrapping to a second line or stacking vertically.
- **Profile card**: desktop is horizontal (avatar left, info right); mobile stacks vertically and centers everything.

## 3. This tracker's design language (condensed reference)

Full source of truth: `css/style.css` (tokens mostly in `:root` at lines 11-65 and 407-469), `index.html` (structure), `js/ui/*.js` (component logic).

- **Theming**: six complete palettes as `body.palette-*` classes — Forest (default), Ocean, Dusk, Fire, Mono, Dark (`css/style.css:11-161`) — picked from a `.theme-grid` of swatch buttons in the settings `<details>` menu (`index.html:57-64`). This is a **fixed palette list**, not an accent+mode composable system.
- **Tokens**: ~25 custom properties per palette — accent triad (`--c-accent1/2/3`), a derived "ink" pair for using accent as foreground text (`--c-accent-ink`, documented at length at `css/style.css:18-26` and `66-78` — a real bug fix, not decoration), 11 neutral tokens (`--c-text`, `--c-surface`, `--c-border`, etc., `css/style.css:39-55`), 2 banner-state triples (purple loading / red failure, `css/style.css:57-62`).
- **Typography**: system stack, `Arial, Helvetica, sans-serif` (`css/style.css:8`) — no custom/web font. A genuinely rigorous fluid type scale: 9 `clamp()` steps in `rem` (`--fs-3xs` … `--fs-2xl`, `css/style.css:433-453`), enforced by `tests/type-scale.test.mjs`, plus a second tighter "chrome" ramp scoped to `.sticky-top` so header text doesn't keep growing on huge monitors. Card-internal text uses container-query units (`cqw`) so it scales with tile size, not viewport — DexTCG has nothing equivalent to this.
- **Spacing/grid**: no formal spacing scale (ad hoc px), but the card grid is fluid and **already DexTCG-density-matched**: `--tile-min`, `--grid-gap`, `--grid-pad` (`css/style.css:413-431`) were deliberately tuned to reproduce DexTCG's column-count breakpoints.
- **Radius**: no token scale, literal values ranging 3px (small chips) → 20px (full pill buttons) → fluid `clamp(5px,4cqw,9px)` on card tiles (`css/style.css:1100`) — generally smaller/tighter than DexTCG's 14-21px.
- **Ownership affordance**: unowned card art is desaturated (`grayscale(.82) opacity(.72)`), owned art is full color — the whole tile is the toggle. This is a stronger, more visual affordance than DexTCG has (DexTCG's cards don't desaturate for "not owned").
- **Components that already exist**: gradient header with segmented mode-toggle, sticky filter/context bars with horizontal-scroll chip rows (`hscroll.js`), an overlay set-nav sidebar (drawer on mobile, docked panel ≥1000px), dashboard stat/chart/expansion-tile cards, set-block + card-grid, per-print tracking (toggle chips on each tile, `.pchip`, or one tile per print, switched by the gear panel's Print variants setting, `index.html:68-75`), four modal "shells" (preview/TMS/onboarding/picker) sharing one gradient-header treatment, a two-tier banner+notification-bell system, progress bars (gradient fill), print views.
- **What's missing relative to DexTCG**: no translucent color-wash overlay pattern (tinted panels use flat pastel tokens instead, e.g. `--c-bn-load-bg`), no illustrated mascot for empty states (currently plain text, e.g. "Nothing collected yet"), no command palette, no accent+mode composable theming, no ambient glow on the card preview modal, no dedicated "attribute pill rows" layout (attributes are folded into card footers instead).

## 4. Comparison / gap table

| Pattern | DexTCG | Tracker | Verdict |
|---|---|---|---|
| Palette/theme system | Accent (8) × Mode (2) composable | 6 fixed named palettes | **Adopt the composable idea, keep the palette breadth** — bigger refactor, see Phase B below |
| Type scale | Fixed Tailwind sizes | Fluid 9-step `clamp()` + separate chrome ramp + `cqw` card text, test-enforced | **Keep ours — already more sophisticated, skip** |
| Card-grid density/breakpoints | Reference | Already tuned to match (`css/style.css:413-428`) | **Already equivalent — no action** |
| Translucent color-wash overlay | Core signature technique | Not present (flat pastel tokens instead) | **Adopt** — cheap, automatically theme-proof, good fit for dashboard stat/profile panels |
| Mascot empty states | Consistent illustrated character everywhere | Plain text only | **Adopt** — currently a real gap (e.g. "Nothing collected yet") |
| Ambient card-glow on detail view | Yes, samples card's dominant color | No | **Adopt** — natural fit for `.preview-overlay` |
| Ownership affordance | None (no desaturation) | Desaturate unowned card art | **Keep ours — stronger than DexTCG, skip** |
| Filter UI | Right slide-in drawer, pill chips, collapsible groups | Inline chip bars + modal pickers | **Partial adopt** — the slide-in-drawer-with-collapsible-groups shape could suit a future dedicated filters feature, if/when the tracker grows one |
| Command palette (Ctrl K) | Yes | No | **Maybe later** — backlog idea, not urgent |
| Font | Poppins (bold-italic hero, semibold headers) | System stack (Arial) | **Consider for headers only** — evaluate a humanist bold/italic display face for page titles, keep body text system-font for perf/simplicity |
| Radius scale | Larger (14-21px) | Smaller/tighter (3-20px, mostly ≤12px) | **Consider softening** panel/card radius toward DexTCG's range where it doesn't fight the existing fluid card-tile radius |
| Mobile grid→list layout swap | Yes (expansions: grid→list) | Grids stay grids, just fewer columns | **Worth evaluating** for any future list-heavy page |

## 5. Open questions / not yet explored

- DexTCG's Trade, Badges, and Friends pages were not visited this pass — may hold more patterns (esp. Trade, which likely has its own list/comparison UI).
- The mobile hamburger nav button appeared to render invisibly when tapped (a possible DexTCG bug) — not something to replicate, flagged only so nobody mistakes it for an intentional pattern if revisited.
- DexTCG's exact Tailwind/RN theming mechanism (how `bg-primary-background` remaps per accent+mode) wasn't reverse-engineered — only the resulting visual behavior was observed. Not needed to adopt the *idea* (accent+mode composability), only relevant if literally porting their implementation.

## 6. Next steps (future sessions — not yet started)

Each phase should get its own plan/approval when picked up; this just sequences and scopes them so a future chat doesn't have to redo the research above.

- **Phase A (low-risk, high-payoff)**: adopt the translucent color-wash overlay for dashboard stat/profile panels; add a mascot-style illustration for empty states (masterset/single-set with 0 cards, filtered-to-nothing grids); soften border-radius on cards/panels toward DexTCG's larger values where it doesn't conflict with the existing fluid card-radius system.
- **Phase B (moderate)**: rework the palette picker into an accent-color + light/dark composable system — the six `body.palette-*` blocks would need to become accent-token + mode-token composition. Touches most of `style.css`'s color section; needs its own dedicated planning pass.
- **Phase C (optional/exploratory)**: ambient glow behind card art in `.preview-overlay`; evaluate a lightweight command palette; evaluate a Poppins-like bold/italic display face for headers only.
