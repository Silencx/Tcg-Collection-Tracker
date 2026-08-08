// =============================================================================
// ui/pickers.js — the two sticky-bar dropdowns that outgrew the sticky bar.
//
// Both bars in Master Set used to hold their whole option set inline: a text
// field with an eight-item autocomplete for Pokémon, and twelve language pills.
// Neither fits a 34px row — the pills clipped mid-badge, and the autocomplete
// asked you to already know the name you were looking for. They are modals now,
// with room for a real list.
//
// ONE modal shell, two callers. The shell (open/close, Escape, backdrop click,
// focus into the search field) is identical for both, and it is the same shape
// as onboarding.js's first-run picker — that one keeps its own copy because it
// is a one-shot with completely different footer semantics, and merging them
// would mean a shell with two mutually exclusive modes.
//
// No inline onclick= for anything INSIDE a modal: these elements are created
// here and never appear in index.html, so main.js's window manifest only needs
// the two open* functions.
// =============================================================================

import { state, savePoke } from '../state.js';
import { POKEMON_CATALOG, LANGUAGES, PLACEHOLDER_LANGS, BADGE_ORDER } from '../config.js';
import { flagSvg } from './flags.js';
import { escapeHtml } from './html.js';

// At most one modal at a time. Opening a second while the first is up would leave the
// first's Escape handler bound to a detached tree.
let openModal = null;

/**
 * Build and show the shell.
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.sub          one line under the title
 * @param {string} [opts.search]     placeholder; omitted means no search field
 * @param {(q:string, body:HTMLElement)=>void} opts.paint  fills the body for a query
 * @param {(foot:HTMLElement)=>void} [opts.foot]           optional footer controls
 * @returns {{close:()=>void, repaint:()=>void}}
 */
function showModal({ title, sub, search, paint, foot }) {
  openModal?.close();

  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay open';
  overlay.innerHTML = `
    <div class="picker-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="picker-head">
        <button type="button" class="picker-close" aria-label="Close">&times;</button>
        <div class="picker-title">${escapeHtml(title)}</div>
        <div class="picker-sub">${escapeHtml(sub)}</div>
      </div>
      <div class="picker-body">
        ${search ? `<input type="text" class="picker-search" placeholder="${escapeHtml(search)}" autocomplete="off">` : ''}
        <div class="picker-list"></div>
      </div>
      <div class="picker-foot"></div>
    </div>`;
  document.body.appendChild(overlay);

  const list = overlay.querySelector('.picker-list');
  const searchEl = overlay.querySelector('.picker-search');
  const footEl = overlay.querySelector('.picker-foot');

  const repaint = () => paint(searchEl ? searchEl.value.trim() : '', list);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (openModal?.close === close) openModal = null;
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  overlay.querySelector('.picker-close').addEventListener('click', close);
  // Backdrop only — a click that started inside the modal must not close it.
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  searchEl?.addEventListener('input', repaint);

  if (foot) foot(footEl); else footEl.remove();
  repaint();
  searchEl?.focus();

  openModal = { close, repaint };
  return openModal;
}

// ── POKÉMON ──────────────────────────────────────────────────────────────────

/**
 * Add / remove tracked Pokémon.
 *
 * EMPTY UNTIL YOU TYPE, deliberately. The catalogue is 357 entries; rendering all of
 * them on open buys a wall of names nobody scrolls and a visibly slow first paint, and
 * the thing you came here to do is name one Pokémon. The already-tracked ones ARE shown
 * straight away, because removing one is the other half of what this modal is for.
 *
 * `onChange` is what refetches and re-renders — masterset.js owns that, and passing it
 * in keeps this module free of a dependency on the render pipeline.
 */
export function openPokemonPicker(onChange) {
  showModal({
    title: 'Tracked Pokémon',
    sub: 'Search the National Dex and pick the Pokémon you are collecting.',
    search: 'Search Pokémon…',
    paint(q, list) {
      list.textContent = '';
      const tracked = state.pokemonList;

      if (tracked.length) {
        list.appendChild(sectionLabel(`Tracking (${tracked.length})`));
        const grid = document.createElement('div');
        grid.className = 'picker-grid';
        for (const name of tracked) {
          grid.appendChild(pokeTile(name, true, () => {
            // Same floor as the old chip's × — every render path downstream assumes at
            // least one Pokémon, and an empty Master Set is a blank page with no way back.
            if (tracked.length <= 1) return;
            state.pokemonList = tracked.filter(p => p !== name);
            savePoke();
            onChange();
            openModal?.repaint();
          }, tracked.length <= 1));
        }
        list.append(grid);
      }

      if (!q) {
        list.appendChild(hint('Type a name to add a Pokémon.'));
        return;
      }
      const needle = q.toLowerCase();
      const matches = POKEMON_CATALOG
        .filter(p => p.name.toLowerCase().includes(needle) && !tracked.includes(p.name))
        .slice(0, 60);
      list.appendChild(sectionLabel(matches.length ? 'Add' : 'No matches'));
      if (!matches.length) return;
      const grid = document.createElement('div');
      grid.className = 'picker-grid';
      for (const p of matches) {
        grid.appendChild(pokeTile(p.name, false, () => {
          state.pokemonList = [...state.pokemonList, p.name];
          savePoke();
          onChange();
          openModal?.repaint();
        }, false, p.dex));
      }
      list.appendChild(grid);
    },
  });
}

function pokeTile(name, tracked, onClick, disabled = false, dex = null) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'picker-tile' + (tracked ? ' selected' : '');
  b.disabled = disabled;
  b.title = disabled
    ? 'You need at least one Pokémon'
    : tracked ? `Stop tracking ${name}` : `Track ${name}`;
  const label = document.createElement('span');
  label.className = 'picker-tile-name';
  label.textContent = name;          // textContent: names can arrive from a shared #s= link
  b.appendChild(label);
  const meta = document.createElement('span');
  meta.className = 'picker-tile-meta';
  meta.textContent = tracked ? '✓' : (dex ? `#${String(dex).padStart(3, '0')}` : '');
  b.appendChild(meta);
  b.addEventListener('click', onClick);
  return b;
}

// ── LANGUAGES ────────────────────────────────────────────────────────────────

/** Display name for a badge, including the two JP/placeholder cases pills also handle. */
export function languageLabel(badge) {
  const l = LANGUAGES.find(x => x.badge === badge) || PLACEHOLDER_LANGS.find(x => x.badge === badge);
  if (l) return l.label;
  if (badge === 'JP') return 'Japanese';
  return badge;
}

/**
 * Toggle which languages are shown.
 *
 * `available` is the badges actually PRESENT in the current render — the same set the
 * pills were built from. Offering a language the fetch returned nothing for is offering
 * a filter that can only ever empty the grid.
 *
 * @param {object} opts
 * @param {string[]} opts.available
 * @param {Set<string>} opts.active   mutated in place, like the pills did
 * @param {()=>void} opts.onChange    persist + re-filter
 */
export function openLanguagePicker({ available, active, onChange }) {
  const ordered = BADGE_ORDER.filter(b => available.includes(b));
  showModal({
    title: 'Languages',
    sub: 'Pick which printings appear in the grid. Off languages are greyed out.',
    paint(_q, list) {
      list.textContent = '';
      const grid = document.createElement('div');
      grid.className = 'picker-grid lang-grid';
      for (const badge of ordered) {
        grid.appendChild(langTile(badge, active, () => {
          if (active.has(badge)) active.delete(badge); else active.add(badge);
          onChange();
          openModal?.repaint();
        }));
      }
      list.appendChild(grid);
      if (!ordered.length) list.appendChild(hint('No languages in this view yet.'));
    },
    foot(f) {
      const all = document.createElement('button');
      all.type = 'button';
      all.className = 'picker-act';
      all.textContent = 'Select all';
      all.addEventListener('click', () => {
        for (const b of ordered) active.add(b);
        onChange();
        openModal?.repaint();
      });
      const none = document.createElement('button');
      none.type = 'button';
      none.className = 'picker-act';
      none.textContent = 'Select none';
      none.addEventListener('click', () => {
        active.clear();
        onChange();
        openModal?.repaint();
      });
      f.append(all, none);
    },
  });
}

function langTile(badge, active, onClick) {
  const on = active.has(badge);
  const b = document.createElement('button');
  b.type = 'button';
  // .selected drives the border and background; .off drives the greyscale filter on the
  // flag, which is the same treatment the card grid uses for a card you do not own.
  b.className = 'picker-tile lang-tile' + (on ? ' selected' : ' off');
  b.setAttribute('aria-pressed', String(on));
  b.title = on ? `Hide ${languageLabel(badge)}` : `Show ${languageLabel(badge)}`;
  const flag = flagSvg(badge);
  if (flag) {
    const wrap = document.createElement('span');
    wrap.className = 'lang-flag-wrap';
    wrap.innerHTML = flag;           // flags.js markup is ours, not user data
    b.appendChild(wrap);
  }
  const name = document.createElement('span');
  name.className = 'picker-tile-name';
  name.textContent = languageLabel(badge);
  b.appendChild(name);
  const code = document.createElement('span');
  code.className = 'picker-tile-meta';
  code.textContent = badge;
  b.appendChild(code);
  b.addEventListener('click', onClick);
  return b;
}

/**
 * The sticky bar's stand-in for the pill row: which languages are on, and a click target.
 * Shared by Master Set and True Master Set, which is why the state it reads is passed in
 * rather than imported.
 *
 * BADGES ONLY, NO FLAGS. This row first showed the flags AND then the badge letters, which
 * said the same thing twice in a 34px strip — and flag-then-letters is the arrangement that
 * looked worst, because the eye reads the flag, then has to read the code anyway. The flags
 * earn their place in the MODAL, where each one sits beside a full language name and is the
 * fastest way to find the row you want. Here, 'EN · DE' is shorter and already unambiguous.
 */
export function renderLangSummary(container, { available, active, onOpen }) {
  container.textContent = '';
  const ordered = BADGE_ORDER.filter(b => available.includes(b));
  const on = ordered.filter(b => active.has(b));

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lang-summary';
  btn.setAttribute('aria-haspopup', 'dialog');

  // Up to four badges, then "+N" — four two-letter codes plus the label is what fits in
  // the bar on a 375px phone without the button becoming the thing that overflows it.
  const SHOWN = 4;
  const text = document.createElement('span');
  text.className = 'lang-summary-text';
  if (!on.length) text.textContent = 'None — nothing will show';
  else if (on.length <= SHOWN) text.textContent = on.join(' · ');
  else text.textContent = `${on.slice(0, SHOWN).join(' · ')} +${on.length - SHOWN}`;
  btn.appendChild(text);

  const caret = document.createElement('span');
  caret.className = 'lang-summary-caret';
  caret.textContent = '▾';
  btn.appendChild(caret);

  btn.title = `${on.length} of ${ordered.length} languages shown — click to change`;
  btn.addEventListener('click', onOpen);
  container.appendChild(btn);
}

// ── SHARED BITS ──────────────────────────────────────────────────────────────

function sectionLabel(text) {
  const d = document.createElement('div');
  d.className = 'picker-section';
  d.textContent = text;
  return d;
}

function hint(text) {
  const d = document.createElement('p');
  d.className = 'picker-hint';
  d.textContent = text;
  return d;
}
