/**
 * Tests for the pure turn logic (legacy souldbound-world.jsx 925-1021).
 *
 * Every assertion here is paired with a named mutant in the plan's task 3 that
 * it must fail against. A test that has only ever passed is not evidence —
 * Phase 2 of this project shipped a suite that stayed green with its HTTP
 * routes unregistered.
 *
 * Note what is deliberately NOT tested: the 25/60/100 thresholds. They are
 * enforced model-side in WORLD_SYSTEM_PROMPT, not here. Asserting them client-
 * side would be testing fiction.
 */

import { describe, expect, it } from 'vitest';
import type { GameState, Skill, WorldVoiceResponse } from '@soulbound/shared';
import { applyWorldUpdate } from '../applyWorldUpdate.js';

const skill = (over: Partial<Skill> & Pick<Skill, 'name' | 'tier'>): Skill => ({
  mastery: 10,
  description: 'd',
  ...over,
});

function state(over: Partial<GameState> = {}): GameState {
  return {
    character: { name: 'Ilse', race: { id: 'human', name: 'Human', desc: '', intrinsic: [] }, answers: {} },
    skills: [
      skill({ name: 'Grit', tier: 'Intrinsic' }),
      skill({ name: 'Ledger', tier: 'Unique', mastery: 20, sub_abilities: [], usage_notes: [] }),
    ],
    location: 'Verge',
    currentScene: 'scene',
    actionHistory: [],
    narrativeMemory: { entities: {}, notes: [] },
    ...over,
  } as GameState;
}

function response(updates: Partial<WorldVoiceResponse['state_updates']> = {}): WorldVoiceResponse {
  return {
    narration: 'n',
    state_updates: {
      skill_mastery_changes: [],
      new_skills_granted: [],
      skill_evolutions: [],
      unique_sub_ability_unlocked: null,
      world_events: [],
      ...updates,
    },
    narrative_memory_updates: { new_entities: [], note: null },
    gm_note: 'gm',
  } as WorldVoiceResponse;
}

const unique = (s: GameState) => s.skills.find((k) => k.tier === 'Unique')!;

describe('applyWorldUpdate — mastery and usage notes', () => {
  it('applies a mastery change', () => {
    const r = applyWorldUpdate(state(), 'act', response({
      skill_mastery_changes: [{ skill_name: 'Ledger', old_mastery: 20, new_mastery: 35, note: null }],
    }));
    expect(unique(r.state).mastery).toBe(35);
  });

  // MUTANT: remove the isUnique ternary -> every skill accrues notes.
  it('accumulates usage_notes on the Unique skill only', () => {
    const r = applyWorldUpdate(state(), 'act', response({
      skill_mastery_changes: [
        { skill_name: 'Ledger', old_mastery: 20, new_mastery: 25, note: null },
        { skill_name: 'Grit', old_mastery: 10, new_mastery: 15, note: null },
      ],
    }));
    expect(unique(r.state).usage_notes).toHaveLength(1);
    // MUTANT: `?? []` on the non-Unique branch -> this becomes [] and fails.
    expect(r.state.skills.find((s) => s.name === 'Grit')!.usage_notes).toBeUndefined();
  });
});

describe('applyWorldUpdate — new skills', () => {
  // MUTANT: `|| 5` -> `?? 5`. A skill granted at 0 must be stored as 5.
  it('stores a skill granted with mastery 0 as 5 (falsy-coalesce, not nullish)', () => {
    const r = applyWorldUpdate(state(), 'act', response({
      new_skills_granted: [{ skill_name: 'Ember', tier: 'Common', mastery: 0, description: 'd', soul_etching_text: 'e' }],
    }));
    expect(r.state.skills.find((s) => s.name === 'Ember')!.mastery).toBe(5);
  });

  it('returns granted names as a Set', () => {
    const r = applyWorldUpdate(state(), 'act', response({
      new_skills_granted: [{ skill_name: 'Ember', tier: 'Common', mastery: 12, description: 'd', soul_etching_text: 'e' }],
    }));
    expect(r.newSkillIds).toBeInstanceOf(Set);
    expect(r.newSkillIds.has('Ember')).toBe(true);
  });

  it('does not duplicate a skill that already exists', () => {
    const r = applyWorldUpdate(state(), 'act', response({
      new_skills_granted: [{ skill_name: 'Grit', tier: 'Common', mastery: 50, description: 'x', soul_etching_text: 'e' }],
    }));
    expect(r.state.skills.filter((s) => s.name === 'Grit')).toHaveLength(1);
    expect(r.state.skills.find((s) => s.name === 'Grit')!.mastery).toBe(10);
  });
});

describe('applyWorldUpdate — evolutions and Soul Rewrite', () => {
  const withHistory = () => state({
    skills: [skill({ name: 'Ledger', tier: 'Unique', mastery: 60, sub_abilities: [{ name: 'Sight', unlock_mastery: 25, description: 'd' }], usage_notes: ['n1'] })],
  });

  it('Soul Rewrite (Unique->Unique) zeroes mastery, sub_abilities and usage_notes', () => {
    const r = applyWorldUpdate(withHistory(), 'act', response({
      skill_evolutions: [{ old_name: 'Ledger', new_name: 'Tally', old_tier: 'Unique', new_tier: 'Unique', description: 'd', rewrite_narrative: 'r' }],
    }));
    const s = r.state.skills[0];
    expect(s.name).toBe('Tally');
    expect(s.mastery).toBe(0);
    expect(s.sub_abilities).toEqual([]);
    expect(s.usage_notes).toEqual([]);
    expect(r.logEntry.soulRewrites).toHaveLength(1);
  });

  // MUTANT: drop `old_tier === 'Unique'` -> this wrongly wipes and fails.
  it('a non-rewrite evolution PRESERVES mastery, sub_abilities and usage_notes', () => {
    const r = applyWorldUpdate(withHistory(), 'act', response({
      skill_evolutions: [{ old_name: 'Ledger', new_name: 'Ledger Ascendant', old_tier: 'Unique', new_tier: 'Ultimate', description: 'd', rewrite_narrative: null }],
    }));
    const s = r.state.skills[0];
    expect(s.mastery).toBe(60);
    expect(s.sub_abilities).toHaveLength(1);
    expect(s.usage_notes).toEqual(['n1']);
    expect(r.logEntry.soulRewrites).toHaveLength(0);
  });

  // MUTANT: `isSoulRewrite = ev.new_tier === 'Unique'` (dropping the old_tier half in the
  // OTHER direction). Found by mutation sweep: the Unique->Ultimate case above does NOT catch
  // it, because new_tier is 'Ultimate' there so the mutant still evaluates false. Only an
  // evolution INTO Unique from a lower tier distinguishes the two conditions.
  it('an evolution INTO Unique from a lower tier is not a Soul Rewrite', () => {
    const s = state({
      skills: [skill({ name: 'Ember', tier: 'Extra', mastery: 80, sub_abilities: [{ name: 'Spark', unlock_mastery: 25, description: 'd' }], usage_notes: ['n1'] })],
    });
    const r = applyWorldUpdate(s, 'act', response({
      skill_evolutions: [{ old_name: 'Ember', new_name: 'Emberheart', old_tier: 'Extra', new_tier: 'Unique', description: 'd', rewrite_narrative: null }],
    }));
    const out = r.state.skills[0];
    expect(out.tier).toBe('Unique');
    expect(out.mastery).toBe(80);
    expect(out.sub_abilities).toHaveLength(1);
    expect(out.usage_notes).toEqual(['n1']);
    expect(r.logEntry.soulRewrites).toHaveLength(0);
  });

  // MUTANT: move evolutions before the new-skill merge -> the evolution finds nothing.
  it('a skill granted THIS turn can be evolved THIS turn', () => {
    const r = applyWorldUpdate(state(), 'act', response({
      new_skills_granted: [{ skill_name: 'Ember', tier: 'Common', mastery: 5, description: 'd', soul_etching_text: 'e' }],
      skill_evolutions: [{ old_name: 'Ember', new_name: 'Emberwake', old_tier: 'Common', new_tier: 'Extra', description: 'd2', rewrite_narrative: null }],
    }));
    expect(r.state.skills.some((s) => s.name === 'Emberwake')).toBe(true);
    expect(r.state.skills.some((s) => s.name === 'Ember')).toBe(false);
  });
});

describe('applyWorldUpdate — sub-ability emergence', () => {
  const sa = { name: 'Sight', unlock_mastery: 25, description: 'd', emergence_text: 'e' };

  // MUTANT: target index 0 instead of tier==='Unique'.
  it('attaches to the Unique skill even when it is not first in the array', () => {
    const r = applyWorldUpdate(state(), 'act', response({ unique_sub_ability_unlocked: sa }));
    expect(unique(r.state).sub_abilities).toHaveLength(1);
    expect(r.state.skills[0].sub_abilities).toBeUndefined();
    expect(r.logEntry.subAbilityUnlock?.skillName).toBe('Ledger');
  });

  // MUTANT: delete the name dedupe.
  it('is idempotent — replaying the same unlock does not duplicate it', () => {
    const once = applyWorldUpdate(state(), 'a', response({ unique_sub_ability_unlocked: sa }));
    const twice = applyWorldUpdate(once.state, 'b', response({ unique_sub_ability_unlocked: sa }));
    expect(unique(twice.state).sub_abilities).toHaveLength(1);
  });

  it('stores unlock_mastery as sent, and the log entry carries emergence_text', () => {
    const r = applyWorldUpdate(state(), 'act', response({ unique_sub_ability_unlocked: { ...sa, unlock_mastery: 60 } }));
    expect(unique(r.state).sub_abilities![0].unlock_mastery).toBe(60);
    // The skill stores name/unlock_mastery/description; the log entry gets the full object.
    expect(r.logEntry.subAbilityUnlock?.emergence_text).toBe('e');
  });

  // MUTANT: attach to the pre-rewrite name.
  it('attaches to the Unique skill under its POST-rewrite name', () => {
    const r = applyWorldUpdate(state(), 'act', response({
      skill_evolutions: [{ old_name: 'Ledger', new_name: 'Tally', old_tier: 'Unique', new_tier: 'Unique', description: 'd', rewrite_narrative: 'r' }],
      unique_sub_ability_unlocked: sa,
    }));
    expect(r.logEntry.subAbilityUnlock?.skillName).toBe('Tally');
  });
});

describe('applyWorldUpdate — narrative memory and scene', () => {
  // MUTANTS: slice(0,40) fails the content assertion; slice(-41) fails the length one.
  it('caps notes at 40, keeping the NEWEST', () => {
    let s = state({ narrativeMemory: { entities: {}, notes: Array.from({ length: 40 }, (_, i) => `note-${i}`) } });
    const r = applyWorldUpdate(s, 'act', {
      ...response(),
      narrative_memory_updates: { new_entities: [], note: 'note-41' },
    } as WorldVoiceResponse);
    expect(r.state.narrativeMemory.notes).toHaveLength(40);
    expect(r.state.narrativeMemory.notes.at(-1)).toBe('note-41');
    expect(r.state.narrativeMemory.notes).not.toContain('note-0');
  });

  it('merges entities by name', () => {
    const r = applyWorldUpdate(state(), 'act', {
      ...response(),
      narrative_memory_updates: { new_entities: [{ name: 'Ossa', description: 'guard' }], note: null },
    } as WorldVoiceResponse);
    expect(r.state.narrativeMemory.entities.Ossa.description).toBe('guard');
  });

  it('a scene_set event updates location and scene', () => {
    const r = applyWorldUpdate(state(), 'act', response({
      world_events: [{ type: 'scene_set', location: 'Tidemark', scene_summary: 'docks', description: null }],
    }));
    expect(r.state.location).toBe('Tidemark');
    expect(r.state.currentScene).toBe('docks');
  });

  // MUTANT: `||` -> `??` on the scene fallback.
  it('an empty-string location falls back to the previous one', () => {
    const r = applyWorldUpdate(state(), 'act', response({
      world_events: [{ type: 'scene_set', location: '', scene_summary: '', description: null }],
    }));
    expect(r.state.location).toBe('Verge');
    expect(r.state.currentScene).toBe('scene');
  });

  it('appends the action to actionHistory', () => {
    const r = applyWorldUpdate(state(), 'I wait', response());
    expect(r.state.actionHistory).toEqual(['I wait']);
  });
});

describe('applyWorldUpdate — log entry composition', () => {
  // MUTANT: remove soulRewrites from the returned entry -> the banner silently stops rendering.
  it('carries narration, newSkills, soulRewrites, subAbilityUnlock and gmNote', () => {
    const r = applyWorldUpdate(state(), 'act', response({
      new_skills_granted: [{ skill_name: 'Ember', tier: 'Common', mastery: 5, description: 'd', soul_etching_text: 'e' }],
      skill_evolutions: [{ old_name: 'Ledger', new_name: 'Tally', old_tier: 'Unique', new_tier: 'Unique', description: 'd', rewrite_narrative: 'r' }],
      unique_sub_ability_unlocked: { name: 'Sight', unlock_mastery: 25, description: 'd', emergence_text: 'e' },
    }));
    expect(r.logEntry.type).toBe('narration');
    expect(r.logEntry.text).toBe('n');
    expect(r.logEntry.newSkills).toHaveLength(1);
    expect(r.logEntry.soulRewrites).toHaveLength(1);
    expect(r.logEntry.subAbilityUnlock).not.toBeNull();
    expect(r.logEntry.gmNote).toBe('gm');
  });

  it('does not mutate the input state', () => {
    const before = state();
    const snapshot = JSON.stringify(before);
    applyWorldUpdate(before, 'act', response({
      skill_mastery_changes: [{ skill_name: 'Ledger', old_mastery: 20, new_mastery: 99, note: null }],
    }));
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
