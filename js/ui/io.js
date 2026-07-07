// =============================================================================
// ui/io.js — backup/transfer + shareable view sessions.
//   • exportData()  : download every tcg* key as one JSON envelope.
//   • importData()  : restore an envelope, with a one-time pokemontcg.io→TCGdex
//                     id migration for the Master-Set checklist, then reload.
//   • sessions      : settings-only base64url hash (mode, filters, pokémon list,
//                     sort, palette) — auto-saved, auto-restored, URL-shareable.
//
// Why migrate only the MS checklist: the Master-Set render now uses TCGdex ids
// ("sv05-163"), but the TMS popup still uses the legacy pipeline (pokemontcg.io
// ids "sv5-163"). So TMS includes (tcgTMS_v1) are left as-is; only tcgChk_v1 is
// remapped, and only when the remapped id matches a card in the live index.
// =============================================================================

import {
  state, saveChk, saveTms, saveTmsCache, saveMode, saveFilter, saveTmsFilter, savePoke, saveSort, clearCardCache,
} from '../state.js';
import * as storage from '../storage.js';
import { SCHEMA_VERSION, CHKSTORE, CACHESTORE, TMSSTORE, TMSCACHESTORE, PALETTE_KEY, SESSIONSTORE } from '../config.js';
import { looksPtcgio, migrateCardId, migrateIdToken } from '../api/id-migration.js';
import { encodeSessionPayload, decodeSession } from './session-codec.js';

const EXPORT_TOOL = 'pokemon-master-set-tool';

// ─────────────────────────── EXPORT ───────────────────────────
export function exportData() {
  const keys = {};
  storage.keys('tcg').forEach(k => { const v = storage.get(k); if (v != null) keys[k] = v; });
  const payload = {
    tool: EXPORT_TOOL,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    keys,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tcg-export-${payload.exportedAt.slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ──────────────────── ID MIGRATION (MS checklist) ────────────────────
// looksPtcgio / migrateCardId / migrateIdToken now live in ../api/id-migration.js
// (pure logic — importable without pulling in state.js/localStorage).

// Returns { migrated:[unique ids], unmatched:[original ids that don't resolve] }.
// `validIds` = ids present in the live MS index (state._meta keys).
function migrateChecklist(oldIds, validIds) {
  const migrated = [], unmatched = [];
  for (const id of oldIds) {
    if (validIds.has(id)) { migrated.push(id); continue; }   // already valid (incl. JP_/KR_/SC_)
    const u = id.indexOf('_');
    const badge = u < 0 ? '' : id.slice(0, u);
    const cardId = u < 0 ? id : id.slice(u + 1);
    if (badge && looksPtcgio(cardId)) {
      const cand = `${badge}_${migrateCardId(cardId)}`;
      if (validIds.has(cand)) { migrated.push(cand); continue; }
      unmatched.push(id);                                    // pokemontcg.io id with no live match
      continue;
    }
    migrated.push(id);   // JP/placeholder/unknown — keep (may simply not be rendered yet)
  }
  return { migrated: [...new Set(migrated)], unmatched };
}

// ─────────────────── BOOT MIGRATION (one-time) ───────────────────
// On the same origin as old data, stored ids may be pokemontcg.io format. The render
// now always uses TCGdex-format ids (both MS and the routed TMS popup), so transform
// any old ids deterministically BEFORE the first render. Runs once, guarded by a flag
// (bump the flag if the id scheme ever changes again).
const MIGRATED_FLAG = 'tcgMigrated_v1';

export function migrateCheckedOnBoot() {
  if (storage.get(MIGRATED_FLAG)) return;

  // MS checklist
  let chk = new Set(), chChanged = false;
  for (const id of state.checked) { const m = migrateIdToken(id); chk.add(m); if (m !== id) chChanged = true; }
  if (chChanged) { state.checked = chk; saveChk(); }

  // TMS includes
  let inc = new Set(), incChanged = false;
  for (const id of state.tmsIncluded) { const m = migrateIdToken(id); inc.add(m); if (m !== id) incChanged = true; }
  if (incChanged) { state.tmsIncluded = inc; saveTms(); }

  // TMS per-Pokémon cache (entry ids) → then rebuild the id→Pokémon index so tile
  // counts stay correct without reopening every popup.
  let cacheChanged = false;
  for (const [, cards] of state.tmsPokeCache) {
    for (const c of cards) { const m = migrateIdToken(c.id); if (m !== c.id) { c.id = m; cacheChanged = true; } }
  }
  if (cacheChanged) {
    state._tmsCardPokemon.clear();
    for (const [poke, cards] of state.tmsPokeCache) for (const c of cards) state._tmsCardPokemon.set(c.id, poke);
    saveTmsCache();
  }

  storage.set(MIGRATED_FLAG, '1');
}

// ─────────────────────────── IMPORT ───────────────────────────
// `input` is the <input type="file">. Restores every tcg* key except the MS card
// cache (dropped so it refetches as TCGdex), migrates the checklist, reports any
// unmatched ids, then reloads so the restored state takes effect.
export function importData(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let payload;
    try { payload = JSON.parse(reader.result); }
    catch { alert('Import failed: that file is not valid JSON.'); input.value = ''; return; }
    if (!payload || payload.tool !== EXPORT_TOOL || !payload.keys || typeof payload.keys !== 'object') {
      alert('Import failed: this is not a Master Set export file.'); input.value = ''; return;
    }
    if (!confirm('Import will REPLACE your current data with this backup. Continue?')) { input.value = ''; return; }

    const validIds = new Set(state._meta.keys());   // ids in the current MS render
    let report = '';
    for (const [k, v] of Object.entries(payload.keys)) {
      if (k === CACHESTORE) continue;                // skip MS cache → forces a TCGdex refetch
      if (k === CHKSTORE) {
        let ids = null;
        try { ids = JSON.parse(v); } catch { ids = null; }
        if (Array.isArray(ids)) {
          const { migrated, unmatched } = migrateChecklist(ids, validIds);
          storage.set(CHKSTORE, JSON.stringify(migrated));
          if (unmatched.length) {
            report = `${unmatched.length} checklist card id(s) couldn't be matched to the current `
                   + `index and were dropped:\n${unmatched.join(', ')}`;
          }
          continue;
        }
      }
      if (k === TMSSTORE) {
        // TMS includes can reference any Pokémon (not just the MS render), so transform
        // ids unconditionally rather than validating against the current index.
        let ids = null;
        try { ids = JSON.parse(v); } catch { ids = null; }
        if (Array.isArray(ids)) {
          storage.set(TMSSTORE, JSON.stringify(ids.map(migrateIdToken)));
          continue;
        }
      }
      if (k === TMSCACHESTORE) {
        // tcgTMSPokes_v1 = [[pokeName, cards[]], …] — migrate each entry's id.
        let arr = null;
        try { arr = JSON.parse(v); } catch { arr = null; }
        if (Array.isArray(arr)) {
          for (const pair of arr) {
            const cards = pair && pair[1];
            if (Array.isArray(cards)) for (const c of cards) if (c && typeof c.id === 'string') c.id = migrateIdToken(c.id);
          }
          storage.set(TMSCACHESTORE, JSON.stringify(arr));
          continue;
        }
      }
      storage.set(k, v);   // restore verbatim
    }
    storage.remove(CACHESTORE);
    alert('Import complete.' + (report ? `\n\n${report}` : '') + '\n\nThe page will now reload.');
    location.reload();
  };
  reader.onerror = () => { alert('Import failed: could not read the file.'); input.value = ''; };
  reader.readAsText(file);
}

// ──────────────────── SESSIONS (settings-only hash) ────────────────────
// b64urlEncode/b64urlDecode/encodeSessionPayload/decodeSession now live in
// ./session-codec.js (pure logic — importable without pulling in state.js/DOM).
function currentPalette() {
  const m = document.body.className.match(/palette-[\w-]+/);
  return m ? m[0] : '';
}

export function encodeSession() {
  return encodeSessionPayload({
    v: SCHEMA_VERSION,
    mode: state.appMode,
    msf: [...state.activeLangs],
    tmsf: [...state.tmsActiveLangs],
    pokes: state.pokemonList,
    sort: state.sortDesc ? 'd' : 'a',
    pal: currentPalette(),
  });
}

export { decodeSession };

// Apply a decoded settings payload to state + persistence. Does NOT re-render —
// callers either run during boot (before first render) or reload afterwards.
export function applySession(p) {
  if (!p || typeof p !== 'object') return false;
  if (p.mode === 'master' || p.mode === 'tms') state.appMode = p.mode;
  if (Array.isArray(p.msf)) state.activeLangs = new Set(p.msf);
  if (Array.isArray(p.tmsf)) state.tmsActiveLangs = new Set(p.tmsf);
  if (Array.isArray(p.pokes) && p.pokes.length) {
    const changed = p.pokes.join('|') !== state.pokemonList.join('|');
    state.pokemonList = p.pokes.slice();
    if (changed) clearCardCache();   // different Pokémon → stale MS cache, force refetch
  }
  if (p.sort) state.sortDesc = (p.sort === 'd');
  if (typeof p.pal === 'string') {
    document.body.className = document.body.className.replace(/palette-[\w-]+/g, '').replace(/\s+/g, ' ').trim();
    if (p.pal) document.body.classList.add(p.pal);
    storage.set(PALETTE_KEY, p.pal);
  }
  // Persist to the individual keys so the restored view sticks across reloads.
  saveMode(); saveFilter(); saveTmsFilter(); savePoke(); saveSort();
  return true;
}

export function saveSession() {
  try { storage.set(SESSIONSTORE, encodeSession()); } catch (e) { /* quota handled in storage.js */ }
}

/** Read a session from the URL fragment (#s=…). URL beats the stored session. */
export function sessionFromUrl() {
  const m = (location.hash || '').match(/[#&]s=([^&]+)/);
  return m ? decodeSession(m[1]) : null;
}

/** Manual restore: apply a pasted #s= link/code, or (blank) the last saved session. */
export function restoreSession() {
  const pasted = prompt('Paste a shared view link or code to apply it,\nor leave blank to restore your last saved view:', '');
  if (pasted === null) return;                 // cancelled
  let p;
  if (pasted.trim()) {
    const m = pasted.match(/[#&?]s=([^&\s]+)/);  // accept a full link or a bare code
    p = decodeSession(m ? m[1] : pasted.trim());
    if (!p) { alert('That doesn\u2019t look like a valid view link or code.'); return; }
  } else {
    p = decodeSession(storage.get(SESSIONSTORE));
    if (!p) { alert('No saved session to restore yet.'); return; }
  }
  if (applySession(p)) location.reload();
}

/** Copy a shareable link (current view settings in #s=) to the clipboard. */
export function shareSession() {
  const link = `${location.origin}${location.pathname}#s=${encodeSession()}`;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(link).then(
      () => alert(`Shareable link copied to clipboard:\n\n${link}`),
      () => prompt('Copy this shareable link:', link),
    );
  } else {
    prompt('Copy this shareable link:', link);
  }
}
