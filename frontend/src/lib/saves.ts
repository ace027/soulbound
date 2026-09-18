/**
 * localStorage save/load layer — ported from legacy/souldbound-world.jsx
 * lines 5-61 (listSaves 9-15, loadSave 16-22, writeSave 23-42, deleteSave
 * 44-51, newSlotId 52-55, fmtDate 56-61).
 *
 * Key names come from @soulbound/shared and are NEVER redeclared here: every
 * save written by the Claude.ai artifact lives under those exact strings, so a
 * second copy that drifts by one character loses every existing playthrough
 * (CLAUDE.md constraint #2, 03-CONTEXT "import, never redeclare").
 *
 * Deliberately NOT in this module:
 *  - The 80-entry log cap. Legacy applies `.slice(-MAX_LOG_SAVED)` at line 820
 *    inside `autoSave`, not in `writeSave` (lines 23-42 contain zero slices).
 *    `autoSave` is App.tsx territory (plan 03-09). Capping here would create a
 *    second enforcement point and double-slice once 03-09 ports autoSave
 *    verbatim. `writeSave` stores exactly what it is given.
 *  - Anything React. These are pure functions over localStorage.
 *
 * Three deliberate hardenings over the legacy JS, each forced by `strict: true`
 * rather than by taste — a JS function could hand back `undefined` where the
 * type now promises a value, and every one of these is idempotent with the
 * legacy call-site code plan 03-09 ports:
 *  1. `loadSave` backfills `gameState.narrativeMemory` (see note on loadSave).
 *  2. `loadSave` normalises a missing `schemaVersion` to 0 and a missing `log`
 *     to `[]` — legacy's call site already does `data.log || []` (line 845).
 *  3. `listSaves` returns `[]` for a non-array index rather than handing the UI
 *     a value typed `SaveIndexEntry[]` that is not an array.
 */

import {
  SAVE_INDEX_KEY,
  SAVE_PREFIX,
  SAVE_SCHEMA_VERSION,
  type GameState,
  type LogEntry,
  type SaveIndexEntry,
  type SaveSlot,
} from '@soulbound/shared';

/** The shape JSON.parse actually hands back: everything optional, nothing trusted. */
interface RawSaveSlot {
  gameState?: Partial<GameState>;
  log?: LogEntry[];
  savedAt?: number;
  schemaVersion?: number;
}

/**
 * Every save slot listed in the index, in the order the index stores them —
 * insertion order, not sorted by `savedAt`. Legacy renders them in this order
 * and re-saving an existing slot updates it in place (see `writeSave`), so the
 * list does not reshuffle under the player mid-session.
 */
export function listSaves(): SaveIndexEntry[] {
  try {
    const raw = localStorage.getItem(SAVE_INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SaveIndexEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Read one slot. Returns null for a missing or corrupt slot — a corrupt slot
 * must never throw its way to the UI (legacy wraps the parse in try/catch for
 * exactly this reason).
 *
 * Artifact-era saves (R11) predate two fields, and both are backfilled here
 * rather than at the call site:
 *  - `schemaVersion` — absent means version 0.
 *  - `gameState.narrativeMemory` — absent on saves written before the
 *    narrative-memory system existed.
 *
 * The backfill lives here because `GameState.narrativeMemory` is non-optional:
 * without it this function's return type would claim a field that is `undefined`
 * at runtime, and every future caller would inherit that lie. Legacy's
 * `handleLoadSave` (line 843-848) does the same `|| { entities: {}, notes: [] }`
 * at the call site; plan 03-09 ports that line verbatim and it stays correct —
 * backfilling an already-backfilled value is a no-op, unlike a duplicated cap.
 */
export function loadSave(slotId: string): SaveSlot | null {
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + slotId);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const save = parsed as RawSaveSlot;
    if (!save.gameState) return null;

    return {
      gameState: {
        ...(save.gameState as GameState),
        narrativeMemory: save.gameState.narrativeMemory ?? { entities: {}, notes: [] },
      },
      log: Array.isArray(save.log) ? save.log : [],
      savedAt: save.savedAt ?? 0,
      schemaVersion: save.schemaVersion ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Write one slot and update its index entry, stamping the current schema
 * version. Returns false rather than throwing if localStorage rejects the
 * write (quota, private mode).
 *
 * The log is stored exactly as given — see the module note on the cap.
 */
export function writeSave(slotId: string, saveData: SaveSlot): boolean {
  try {
    const stamped: SaveSlot = { ...saveData, schemaVersion: SAVE_SCHEMA_VERSION };
    localStorage.setItem(SAVE_PREFIX + slotId, JSON.stringify(stamped));

    const index = listSaves();
    const existing = index.findIndex((s) => s.id === slotId);
    const meta: SaveIndexEntry = {
      id: slotId,
      name: saveData.gameState.character.name,
      race: saveData.gameState.character.race.name,
      location: saveData.gameState.location,
      skillCount: saveData.gameState.skills.length,
      savedAt: Date.now(),
      uniqueSkill: saveData.gameState.skills.find((s) => s.tier === 'Unique')?.name || '',
    };
    if (existing !== -1) index[existing] = meta;
    else index.push(meta);

    localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(index));
    return true;
  } catch (e) {
    console.error('Save failed:', e);
    return false;
  }
}

/** Remove a slot and its index entry. Both, or the index shows a phantom save. */
export function deleteSave(slotId: string): void {
  try {
    localStorage.removeItem(SAVE_PREFIX + slotId);
    const index = listSaves();
    localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(index.filter((s) => s.id !== slotId)));
  } catch (e) {
    console.error('Delete failed:', e);
  }
}

/** Slot ids are timestamp + random suffix; never reused, never reordered. */
export function newSlotId(): string {
  return 'sbc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

/** "Mar 4 · 09:31" in the viewer's locale. Empty string for a missing timestamp. */
export function fmtDate(ts: number | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  );
}
