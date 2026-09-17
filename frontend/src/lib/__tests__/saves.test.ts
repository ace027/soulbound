import { SAVE_SCHEMA_VERSION, type GameState, type LogEntry, type SaveSlot } from '@soulbound/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { deleteSave, fmtDate, listSaves, loadSave, newSlotId, writeSave } from '../saves.js';

/**
 * R11: a save written by the Claude.ai artifact must still load in the migrated
 * app, and new saves must carry `schemaVersion` without breaking old ones.
 *
 * The literal key strings below are written BY HAND on purpose. The module
 * imports them from @soulbound/shared, so a test that also imported them would
 * follow the constant wherever it drifted and report green while every existing
 * playthrough became unreachable. These two lines are the byte-for-byte contract
 * with the artifact's localStorage.
 */
const ARTIFACT_SAVE_PREFIX = 'sbc-save:';
const ARTIFACT_SAVE_INDEX_KEY = 'sbc-save-index';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    character: {
      name: 'Yulen',
      race: {
        id: 'mycelium',
        name: 'Mycelium',
        desc: 'A colony that learned to want.',
        intrinsic: [
          { name: 'Spore Sense', description: 'Reads the air for kin.' },
          { name: 'Rootbound', description: 'Draws on what it stands in.' },
        ],
      },
      uniqueSkill: {
        skill_name: 'The Patient Ledger',
        tier: 'Unique',
        description: 'Remembers every debt owed to it.',
        soul_resonance: 'Patience sharpened into accounting.',
        etching_text: 'The world writes a name it did not choose.',
      },
      answers: { nature: 'watchful', drive: 'to be owed', flaw: 'never forgets' },
    },
    skills: [
      { name: 'Spore Sense', tier: 'Intrinsic', mastery: 6, description: 'Reads the air for kin.' },
      { name: 'Rootbound', tier: 'Intrinsic', mastery: 4, description: 'Draws on what it stands in.' },
      {
        name: 'The Patient Ledger',
        tier: 'Unique',
        mastery: 31,
        description: 'Remembers every debt owed to it.',
        sub_abilities: [],
        usage_notes: ['Tallied a slaver caravan.'],
        soul_resonance: 'Patience sharpened into accounting.',
      },
    ],
    location: 'The Ashenveil Verge',
    currentScene: 'Fog settles over the ledger stones.',
    actionHistory: ['Walked east.', 'Counted the dead.'],
    narrativeMemory: {
      entities: { sevreth: { name: 'Sevreth', description: 'A Sovereign that watches.' } },
      notes: ['Owed a debt by the toll-keeper.'],
    },
    ...overrides,
  };
}

function makeLog(count: number): LogEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    type: i % 2 === 0 ? ('action' as const) : ('narration' as const),
    text: `entry-${i}`,
  }));
}

function makeSaveSlot(overrides: Partial<SaveSlot> = {}): SaveSlot {
  return { gameState: makeGameState(), log: makeLog(3), savedAt: 1_700_000_000_000, ...overrides };
}

beforeEach(() => {
  localStorage.clear();
});

// ─── R11 acceptance ─────────────────────────────────────────────────────────

describe('artifact-era compatibility (R11)', () => {
  /**
   * The pre-migration payload exactly as the artifact wrote it: no
   * `schemaVersion`, no `gameState.narrativeMemory` (that system did not exist
   * yet). Built as a plain object, not through writeSave, so the fixture cannot
   * be "fixed" by a change to the writer.
   */
  function seedArtifactSave(slotId: string): void {
    const { narrativeMemory: _dropped, ...preMigrationState } = makeGameState();
    localStorage.setItem(
      ARTIFACT_SAVE_PREFIX + slotId,
      JSON.stringify({
        gameState: preMigrationState,
        log: makeLog(2),
        savedAt: 1_690_000_000_000,
      }),
    );
    localStorage.setItem(
      ARTIFACT_SAVE_INDEX_KEY,
      JSON.stringify([
        {
          id: slotId,
          name: 'Yulen',
          race: 'Mycelium',
          location: 'The Ashenveil Verge',
          skillCount: 3,
          savedAt: 1_690_000_000_000,
          uniqueSkill: 'The Patient Ledger',
        },
      ]),
    );
  }

  it('loads a save written by the artifact into usable state', () => {
    seedArtifactSave('sbc_artifact_1');

    const loaded = loadSave('sbc_artifact_1');

    expect(loaded).not.toBeNull();
    expect(loaded?.gameState.character.name).toBe('Yulen');
    expect(loaded?.gameState.character.race.name).toBe('Mycelium');
    expect(loaded?.gameState.skills).toHaveLength(3);
    expect(loaded?.gameState.skills.find((s) => s.tier === 'Unique')?.name).toBe(
      'The Patient Ledger',
    );
    expect(loaded?.gameState.location).toBe('The Ashenveil Verge');
    expect(loaded?.gameState.actionHistory).toEqual(['Walked east.', 'Counted the dead.']);
    expect(loaded?.log).toHaveLength(2);
  });

  it('treats a missing schemaVersion as 0 rather than undefined', () => {
    seedArtifactSave('sbc_artifact_2');

    expect(loadSave('sbc_artifact_2')?.schemaVersion).toBe(0);
  });

  it('backfills narrativeMemory absent from pre-migration saves', () => {
    seedArtifactSave('sbc_artifact_3');

    // GameState.narrativeMemory is non-optional; an un-backfilled load hands the
    // world engine `undefined.notes` on the first turn after restoring.
    expect(loadSave('sbc_artifact_3')?.gameState.narrativeMemory).toEqual({
      entities: {},
      notes: [],
    });
  });

  it('lists an index written by the artifact', () => {
    seedArtifactSave('sbc_artifact_4');

    const saves = listSaves();
    expect(saves).toHaveLength(1);
    expect(saves[0]?.id).toBe('sbc_artifact_4');
    expect(saves[0]?.uniqueSkill).toBe('The Patient Ledger');
  });
});

// ─── Round trip ─────────────────────────────────────────────────────────────

describe('writeSave / loadSave round trip', () => {
  it('returns equivalent state and stamps the current schemaVersion', () => {
    const slot = makeSaveSlot();

    expect(writeSave('sbc_round_1', slot)).toBe(true);
    const loaded = loadSave('sbc_round_1');

    expect(loaded?.gameState).toEqual(slot.gameState);
    expect(loaded?.log).toEqual(slot.log);
    expect(loaded?.savedAt).toBe(slot.savedAt);
    expect(loaded?.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(loaded?.schemaVersion).toBe(1);
  });

  it('writes under the artifact key so migrated saves stay artifact-shaped', () => {
    writeSave('sbc_round_2', makeSaveSlot());

    const raw = localStorage.getItem(ARTIFACT_SAVE_PREFIX + 'sbc_round_2');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).gameState.character.name).toBe('Yulen');
  });

  it('returns null for a missing slot', () => {
    expect(loadSave('sbc_does_not_exist')).toBeNull();
  });

  it('returns null for a corrupt slot instead of throwing at the UI', () => {
    localStorage.setItem(ARTIFACT_SAVE_PREFIX + 'sbc_corrupt', '{ not json');

    expect(() => loadSave('sbc_corrupt')).not.toThrow();
    expect(loadSave('sbc_corrupt')).toBeNull();
  });
});

// ─── The log is stored uncapped ─────────────────────────────────────────────

describe('writeSave stores the log it is given', () => {
  it('round-trips 85 entries unchanged — the 80 cap belongs to autoSave', () => {
    // Legacy caps at line 820 inside autoSave (App.tsx, plan 03-09), NOT in
    // writeSave (lines 23-42, zero slices). A cap here would double-slice once
    // autoSave is ported verbatim.
    const log = makeLog(85);

    writeSave('sbc_uncapped', makeSaveSlot({ log }));
    const loaded = loadSave('sbc_uncapped');

    expect(loaded?.log).toHaveLength(85);
    expect(loaded?.log[0]?.text).toBe('entry-0');
    expect(loaded?.log[84]?.text).toBe('entry-84');
  });
});

// ─── Index behaviour ────────────────────────────────────────────────────────

describe('listSaves', () => {
  it('is empty before anything is written', () => {
    expect(listSaves()).toEqual([]);
  });

  it('keeps insertion order and updates an existing slot in place', () => {
    writeSave('slot-a', makeSaveSlot());
    writeSave('slot-b', makeSaveSlot({ gameState: makeGameState({ location: 'Kaldrath Gate' }) }));
    writeSave('slot-a', makeSaveSlot({ gameState: makeGameState({ location: 'Tidemark Docks' }) }));

    const saves = listSaves();
    expect(saves.map((s) => s.id)).toEqual(['slot-a', 'slot-b']);
    expect(saves[0]?.location).toBe('Tidemark Docks');
    expect(saves[1]?.location).toBe('Kaldrath Gate');
  });

  it('derives metadata from the saved state', () => {
    writeSave('slot-meta', makeSaveSlot());

    const meta = listSaves()[0];
    expect(meta?.name).toBe('Yulen');
    expect(meta?.race).toBe('Mycelium');
    expect(meta?.skillCount).toBe(3);
    expect(meta?.uniqueSkill).toBe('The Patient Ledger');
  });

  it('returns [] for a corrupt index instead of throwing', () => {
    localStorage.setItem(ARTIFACT_SAVE_INDEX_KEY, '[[[');

    expect(() => listSaves()).not.toThrow();
    expect(listSaves()).toEqual([]);
  });
});

describe('deleteSave', () => {
  it('removes both the slot payload and its index entry', () => {
    writeSave('slot-doomed', makeSaveSlot());
    writeSave('slot-kept', makeSaveSlot());

    deleteSave('slot-doomed');

    // Both halves matter: an orphaned index entry renders a save the player can
    // tap but never load.
    expect(localStorage.getItem(ARTIFACT_SAVE_PREFIX + 'slot-doomed')).toBeNull();
    expect(loadSave('slot-doomed')).toBeNull();
    expect(listSaves().map((s) => s.id)).toEqual(['slot-kept']);
  });

  it('is a no-op for an unknown slot', () => {
    writeSave('slot-kept', makeSaveSlot());

    expect(() => deleteSave('slot-never-existed')).not.toThrow();
    expect(listSaves().map((s) => s.id)).toEqual(['slot-kept']);
  });
});

// ─── Small helpers ──────────────────────────────────────────────────────────

describe('newSlotId', () => {
  it('produces distinct sbc_-prefixed ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newSlotId()));

    expect(ids.size).toBe(50);
    for (const id of ids) expect(id.startsWith('sbc_')).toBe(true);
  });
});

describe('fmtDate', () => {
  it('returns an empty string for a missing timestamp', () => {
    expect(fmtDate(0)).toBe('');
    expect(fmtDate(null)).toBe('');
    expect(fmtDate(undefined)).toBe('');
  });

  it('formats a timestamp as date · time', () => {
    const formatted = fmtDate(1_700_000_000_000);

    expect(formatted).toContain(' · ');
    expect(formatted.length).toBeGreaterThan(5);
  });
});
