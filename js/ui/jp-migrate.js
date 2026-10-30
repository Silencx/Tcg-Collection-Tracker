// =============================================================================
// jp-migrate.js — move saved Japanese ticks to the stable id format (api/jp-model.js).
//
// Runs at boot, before the first render, and only does anything while an old-format id
// is still stored. It covers every place a JP id lives: the Master Set checklist, the
// TMS include list, and the persisted TMS card cache (whose entry ids feed the per-
// Pokémon tile counts).
//
// Old Master Set ids carried a render-order index, so they are resolved by replaying the
// old order from the committed Bulbapedia snapshot — and only trusted when the replayed
// row is the same Pokémon and set. An id that cannot be resolved with certainty is KEPT
// as it is: a tick is never dropped, it just stays unrendered until it can be placed.
// Not flagged as done-once for that reason: the next boot tries again (e.g. after the
// catalogue appears), and with nothing old left the check is a single pass over the ids.
// =============================================================================

import { state, saveChk, saveTms, saveTmsCache } from '../state.js';
import { snapshot } from '../api/providers/snapshot.js';
import { getJpCards } from '../api/jp-source.js';
import { isOldJpId, parseOldMasterId, replayOldMasterOrder, migrateJpId } from '../api/jp-model.js';

function oldIds() {
  const out = new Set();
  for (const id of state.checked) if (isOldJpId(id)) out.add(id);
  for (const id of state.tmsIncluded) if (isOldJpId(id)) out.add(id);
  for (const [, cards] of state.tmsPokeCache) for (const c of cards) if (c && isOldJpId(c.id)) out.add(c.id);
  return out;
}

/** @returns {Promise<{moved:number, kept:number}>} */
export async function migrateJpIdsOnBoot() {
  const old = oldIds();
  if (!old.size) return { moved: 0, kept: 0 };

  const snap = await snapshot.getJpRawPartial(state.pokemonList).catch(() => null);
  const replay = replayOldMasterOrder(snap?.data);
  // Card numbers known per (Pokémon, set name), for ids the replay cannot place:
  // the snapshot's rows plus the catalogue's (never the live network at boot).
  const names = [...new Set([...old].map(parseOldMasterId).filter(Boolean).map(p => p.pokemonName))];
  const jp = names.length ? await getJpCards(names, { live: false }).catch(() => null) : null;
  const byPair = new Map();
  const add = (p, s, n) => { const k = `${p}\u0000${s}`; (byPair.get(k) || byPair.set(k, []).get(k)).push(n); };
  for (const r of snap?.data || []) add(r.pokemonName, r.jpset, r.jpnum);
  for (const r of jp?.rows || []) add(r.pokemonName, jp.sets.get(r.setKey)?.name, r.number);
  const ctx = { replay, candidates: (p, s) => byPair.get(`${p}\u0000${s}`) || [] };

  const map = new Map();
  for (const id of old) { const n = migrateJpId(id, ctx); if (n) map.set(id, n); }
  if (!map.size) return { moved: 0, kept: old.size };

  const remap = set => { let changed = false; const out = new Set();
    for (const id of set) { const n = map.get(id); out.add(n || id); if (n) changed = true; }
    return changed ? out : null; };
  const chk = remap(state.checked);
  if (chk) { state.checked = chk; saveChk(); }
  const inc = remap(state.tmsIncluded);
  if (inc) { state.tmsIncluded = inc; saveTms(); }

  let cacheChanged = false;
  for (const [, cards] of state.tmsPokeCache) {
    for (const c of cards) { const n = c && map.get(c.id); if (n) { c.id = n; cacheChanged = true; } }
  }
  if (cacheChanged) {
    state._tmsCardPokemon.clear();
    for (const [poke, cards] of state.tmsPokeCache) for (const c of cards) state._tmsCardPokemon.set(c.id, poke);
    saveTmsCache();
  }
  console.info(`[jp-migrate] ${map.size} Japanese id(s) moved to the stable format, ${old.size - map.size} kept as they were.`);
  return { moved: map.size, kept: old.size - map.size };
}
