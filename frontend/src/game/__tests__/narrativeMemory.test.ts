/**
 * Guards the entity-ledger merge, and in particular the SEEDING case that was
 * broken: character creation dropped the intro scene's entities, so the first
 * world-engine turn was told "KNOWN ENTITIES: (none yet)" about a scene that
 * had just introduced named NPCs.
 */

import { describe, expect, it } from 'vitest';
import { MAX_NARRATIVE_NOTES } from '@soulbound/shared';
import { EMPTY_NARRATIVE_MEMORY, mergeNarrativeMemory } from '../narrativeMemory';

describe('mergeNarrativeMemory — seeding from nothing (the creation path)', () => {
  // MUTANT: `prev ?? EMPTY` -> `prev!` — seeding from undefined throws.
  it('seeds a ledger from undefined previous memory', () => {
    const m = mergeNarrativeMemory(undefined, {
      new_entities: [{ name: 'the Ledger-Warden', description: 'masked, brass tally-chain' }],
      note: 'The bundle of letters refuses the burn-pit.',
    });
    expect(m.entities['the Ledger-Warden']).toEqual({
      name: 'the Ledger-Warden',
      description: 'masked, brass tally-chain',
    });
    expect(m.notes).toEqual(['The bundle of letters refuses the burn-pit.']);
  });

  // This is the regression itself, stated as an assertion: an intro response
  // carrying entities must NOT produce an empty ledger.
  it('does not produce an empty ledger when the intro scene names entities', () => {
    const m = mergeNarrativeMemory(undefined, {
      new_entities: [{ name: 'the Ledger-Warden', description: 'x' }],
      note: null,
    });
    expect(Object.keys(m.entities)).toHaveLength(1);
    expect(m).not.toEqual(EMPTY_NARRATIVE_MEMORY);
  });

  it('returns an empty ledger when there is nothing to seed from', () => {
    expect(mergeNarrativeMemory(undefined, undefined)).toEqual(EMPTY_NARRATIVE_MEMORY);
    expect(mergeNarrativeMemory(undefined, { new_entities: [], note: null })).toEqual(
      EMPTY_NARRATIVE_MEMORY,
    );
  });

  // MUTANT: return EMPTY_NARRATIVE_MEMORY directly instead of a fresh object —
  // a later merge would mutate the shared constant.
  it('never hands back the shared empty constant by reference', () => {
    const m = mergeNarrativeMemory(undefined, undefined);
    m.entities.X = { name: 'X', description: 'y' };
    m.notes.push('leak');
    expect(EMPTY_NARRATIVE_MEMORY.entities).toEqual({});
    expect(EMPTY_NARRATIVE_MEMORY.notes).toEqual([]);
  });
});

describe('mergeNarrativeMemory — merge rules', () => {
  const prev = {
    entities: { Ossa: { name: 'Ossa', description: 'guard' } },
    notes: ['n1'],
  };

  it('does not mutate the previous memory', () => {
    mergeNarrativeMemory(prev, { new_entities: [{ name: 'Brenn', description: 'smith' }], note: 'n2' });
    expect(Object.keys(prev.entities)).toEqual(['Ossa']);
    expect(prev.notes).toEqual(['n1']);
  });

  // MUTANT: push instead of key-assign -> duplicate entries for one NPC.
  it('overwrites a known entity by name rather than duplicating it', () => {
    const m = mergeNarrativeMemory(prev, {
      new_entities: [{ name: 'Ossa', description: 'guard, owes the player a favour' }],
      note: null,
    });
    expect(Object.keys(m.entities)).toEqual(['Ossa']);
    expect(m.entities.Ossa.description).toBe('guard, owes the player a favour');
  });

  // MUTANT: drop the `if (e?.name)` guard -> a "- : ..." line in the prompt.
  it('skips an entity with no name', () => {
    const m = mergeNarrativeMemory(prev, {
      new_entities: [{ name: '', description: 'nameless' }],
      note: null,
    });
    expect(Object.keys(m.entities)).toEqual(['Ossa']);
  });

  // MUTANT: `e.description || ''` -> `e.description` — undefined reaches the prompt.
  it('falls back to an empty description, never undefined', () => {
    const m = mergeNarrativeMemory(undefined, {
      new_entities: [{ name: 'Mote' } as { name: string; description: string }],
      note: null,
    });
    expect(m.entities.Mote.description).toBe('');
  });

  // MUTANT: append the note unconditionally -> an empty string per ordinary turn.
  it('leaves notes untouched on a null note', () => {
    const m = mergeNarrativeMemory(prev, { new_entities: [], note: null });
    expect(m.notes).toEqual(['n1']);
  });

  // MUTANT: slice(0, MAX) -> keeps the OLDEST, so the ledger freezes early.
  it(`caps notes at ${MAX_NARRATIVE_NOTES}, dropping the oldest`, () => {
    const full = {
      entities: {},
      notes: Array.from({ length: MAX_NARRATIVE_NOTES }, (_, i) => `note-${i}`),
    };
    const m = mergeNarrativeMemory(full, { new_entities: [], note: 'newest' });
    expect(m.notes).toHaveLength(MAX_NARRATIVE_NOTES);
    expect(m.notes.at(-1)).toBe('newest');
    expect(m.notes).not.toContain('note-0');
  });
});
