// =============================================================================
// ui/onboarding.js — first-run Pokémon picker.
//
// Shown once, before the first render, when POKESTORE has never been saved (a
// fresh browser — not a restored session/shared link, which already persists
// its own Pokémon list via applySession's savePoke() call). Lets a first-time
// visitor search POKEMON_CATALOG and pick their own tracked Pokémon instead of
// silently loading the Seedot/Nuzleaf/Shiftry demo list. "Try the demo" keeps
// DEFAULT_POKEMON. Either path saves via the normal savePoke() — identical
// persistence to any other Pokémon-list edit.
// =============================================================================

import { state, savePoke } from '../state.js';
import { DEFAULT_POKEMON, POKEMON_CATALOG } from '../config.js';

/** Show the modal; `onDone` runs once state.pokemonList is settled + saved. */
export function showFirstRunModal(onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'first-run-overlay open';
  overlay.innerHTML = `
    <div class="first-run-modal">
      <div class="first-run-head">
        <div class="first-run-title">&#127807; Track your own master set</div>
        <div class="first-run-sub">Pick any Pokémon to build a checklist across every set and language.</div>
      </div>
      <div class="first-run-body">
        <input type="text" class="first-run-search" placeholder="Search Pokémon…" autocomplete="off">
        <div class="first-run-grid"></div>
      </div>
      <div class="first-run-foot">
        <p class="first-run-hint">
          Non-default Pokémon are fetched live from TCGdex on first load, instead of the
          instant pre-built snapshot — this may take a few seconds longer.
        </p>
        <div class="first-run-actions">
          <button type="button" class="tms-act-btn first-run-demo">Try the demo (Seedot line)</button>
          <button type="button" class="tms-act-btn success first-run-start" disabled>Start tracking</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const selected = new Set();
  const grid = overlay.querySelector('.first-run-grid');
  const search = overlay.querySelector('.first-run-search');
  const startBtn = overlay.querySelector('.first-run-start');

  function renderGrid() {
    const q = search.value.trim().toLowerCase();
    const matches = q ? POKEMON_CATALOG.filter(p => p.name.toLowerCase().includes(q)) : POKEMON_CATALOG;
    grid.innerHTML = matches.length ? matches.map(p => `
      <div class="first-run-tile${selected.has(p.name) ? ' selected' : ''}" data-name="${p.name}">
        <div class="first-run-tile-name">${p.name}</div>
        <div class="first-run-tile-dex">#${p.dex}</div>
      </div>`).join('') : '<p class="first-run-empty">No matches.</p>';
  }

  function updateStartBtn() {
    startBtn.disabled = selected.size === 0;
    startBtn.textContent = selected.size ? `Start tracking (${selected.size})` : 'Start tracking';
  }

  grid.addEventListener('click', e => {
    const tile = e.target.closest('.first-run-tile');
    if (!tile) return;
    const name = tile.dataset.name;
    if (selected.has(name)) selected.delete(name); else selected.add(name);
    tile.classList.toggle('selected');
    updateStartBtn();
  });
  search.addEventListener('input', renderGrid);

  function finish(pokemonList) {
    state.pokemonList = pokemonList;
    savePoke();
    overlay.remove();
    onDone();
  }

  overlay.querySelector('.first-run-demo').addEventListener('click', () => finish([...DEFAULT_POKEMON]));
  startBtn.addEventListener('click', () => { if (selected.size) finish([...selected]); });

  renderGrid();
  search.focus();
}
