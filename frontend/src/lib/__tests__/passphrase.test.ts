import { ACCESS_STORAGE_KEY, SAVE_SCHEMA_VERSION, type GameState, type SaveSlot } from '@soulbound/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listSaves, loadSave, writeSave } from '../saves.js';
import {
  clearPassphrase,
  emitPassphraseRequired,
  getPassphrase,
  onPassphraseRequired,
  setPassphrase,
} from '../passphrase.js';

beforeEach(() => {
  localStorage.clear();
});

function makeGameState(): GameState {
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
      answers: { nature: 'patient', drive: 'debt', flaw: 'slow', memory: 'a ledger', bond: 'none' },
    },
    skills: [],
    location: 'The Rotting Cloister, Vaeltharion',
    currentScene: 'Spore-light drifts.',
    actionHistory: [],
    narrativeMemory: { entities: {}, notes: [] },
  };
}

function makeSlot(): SaveSlot {
  return {
    gameState: makeGameState(),
    log: [],
    savedAt: Date.now(),
    schemaVersion: SAVE_SCHEMA_VERSION,
  };
}

describe('getPassphrase / setPassphrase / clearPassphrase', () => {
  it('round-trips a value', () => {
    expect(getPassphrase()).toBeNull();
    setPassphrase('correct-horse-battery');
    expect(getPassphrase()).toBe('correct-horse-battery');
  });

  it('clears and ignores a stored value that could never be sent (non-ASCII)', () => {
    localStorage.setItem(ACCESS_STORAGE_KEY, 'caf\u00e9-passphrase-1234');
    expect(getPassphrase()).toBeNull();
    expect(localStorage.getItem(ACCESS_STORAGE_KEY)).toBeNull();
  });

  it('returns null for an unsendable stored value even when removing it throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('caf\u00e9-passphrase-1234');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    try {
      expect(getPassphrase()).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('clears a stored value', () => {
    setPassphrase('correct-horse-battery');
    clearPassphrase();
    expect(getPassphrase()).toBeNull();
  });

  it('stores under the shared ACCESS_STORAGE_KEY, not a redeclared string', () => {
    setPassphrase('correct-horse-battery');
    expect(localStorage.getItem(ACCESS_STORAGE_KEY)).toBe('correct-horse-battery');
  });

  it('getPassphrase returns null when storage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getPassphrase()).toBeNull();
    spy.mockRestore();
  });

  it('setPassphrase does nothing (does not throw) when storage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => setPassphrase('x')).not.toThrow();
    spy.mockRestore();
  });

  it('clearPassphrase does nothing (does not throw) when storage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => clearPassphrase()).not.toThrow();
    spy.mockRestore();
  });
});

describe('onPassphraseRequired', () => {
  it('subscribes, is notified on emit, and can unsubscribe', () => {
    const fn = vi.fn();
    const unsubscribe = onPassphraseRequired(fn);

    emitPassphraseRequired();
    expect(fn).toHaveBeenCalledTimes(1);

    unsubscribe();
    emitPassphraseRequired();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('notifies every subscriber', () => {
    const a = vi.fn();
    const b = vi.fn();
    onPassphraseRequired(a);
    onPassphraseRequired(b);
    emitPassphraseRequired();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe('saves are untouched by the passphrase key', () => {
  it('a save written, then a passphrase set and cleared, still loads', () => {
    const slotId = 'sbc_test_slot';
    const slot = makeSlot();
    expect(writeSave(slotId, slot)).toBe(true);

    setPassphrase('correct-horse-battery');
    clearPassphrase();

    const loaded = loadSave(slotId);
    expect(loaded).not.toBeNull();
    expect(loaded?.gameState.character.name).toBe('Yulen');
    expect(listSaves()).toHaveLength(1);
  });
});
