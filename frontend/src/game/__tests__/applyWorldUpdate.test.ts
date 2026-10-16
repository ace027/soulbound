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
    condition: { hp: 100, mp: 50, sp: 100, max_hp: 100, max_mp: 50, max_sp: 100 },
    attributes: { STR: 10, AGI: 10, INT: 10, WIL: 12 },
    places: {},
    currentPlaceId: null,
    growthLog: [],
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
      condition_changes: { hp_delta: 0, mp_delta: 0, sp_delta: 0, reason: '' },
      stat_growth: [],
      setback: { kind: 'none', summary: '' },
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
      skill_mastery_changes: [{ skill_name: 'Ledger', tier: 'Unique', old_mastery: 20, new_mastery: 35, note: null }],
    }));
    expect(unique(r.state).mastery).toBe(35);
  });

  // MUTANT: remove the isUnique ternary -> every skill accrues notes.
  it('accumulates usage_notes on the Unique skill only', () => {
    const r = applyWorldUpdate(state(), 'act', response({
      skill_mastery_changes: [
        { skill_name: 'Ledger', tier: 'Unique', old_mastery: 20, new_mastery: 25, note: null },
        { skill_name: 'Grit', tier: 'Intrinsic', old_mastery: 10, new_mastery: 15, note: null },
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

  // MUTANT: `newNames.add(ev.new_name)` anywhere in the evolution loop.
  // Found by an independent mutation sweep during phase review: the rule
  // "setNewSkillIds receives only newly-GRANTED names, never evolved ones"
  // (legacy 1011, restated in three docstrings) had zero coverage at either
  // this layer or the wiring layer, so marking evolved skills as new would
  // have shipped silently. The grant-then-evolve case above is the sharp one:
  // 'Ember' IS granted this turn and IS evolved this turn, so newSkillIds must
  // carry the granted name and not the evolved one.
  it('newSkillIds carries granted names only — never evolved ones', () => {
    const r = applyWorldUpdate(state(), 'act', response({
      new_skills_granted: [{ skill_name: 'Ember', tier: 'Common', mastery: 5, description: 'd', soul_etching_text: 'e' }],
      skill_evolutions: [{ old_name: 'Ember', new_name: 'Emberwake', old_tier: 'Common', new_tier: 'Extra', description: 'd2', rewrite_narrative: null }],
    }));
    expect([...r.newSkillIds]).toEqual(['Ember']);
    expect(r.newSkillIds.has('Emberwake')).toBe(false);
  });

  // MUTANT: same, for an evolution with no grant at all — newSkillIds must stay empty.
  it('an evolution alone adds nothing to newSkillIds', () => {
    const r = applyWorldUpdate(withHistory(), 'act', response({
      skill_evolutions: [{ old_name: 'Ledger', new_name: 'Ledger Ascendant', old_tier: 'Unique', new_tier: 'Ultimate', description: 'd', rewrite_narrative: null }],
    }));
    expect(r.newSkillIds.size).toBe(0);
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
      world_events: [{ type: 'scene_set', location: 'Tidemark', scene_summary: 'docks', description: null, kingdom: null, place_id: null }],
    }));
    expect(r.state.location).toBe('Tidemark');
    expect(r.state.currentScene).toBe('docks');
  });

  // MUTANT: `||` -> `??` on the scene fallback.
  it('an empty-string location falls back to the previous one', () => {
    const r = applyWorldUpdate(state(), 'act', response({
      world_events: [{ type: 'scene_set', location: '', scene_summary: '', description: null, kingdom: null, place_id: null }],
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
      skill_mastery_changes: [{ skill_name: 'Ledger', tier: 'Unique', old_mastery: 20, new_mastery: 99, note: null }],
    }));
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

// ─── Phase 15: stats, growth, setback, places ───────────────────────────────

const ev = (over: Record<string, unknown> = {}) => ({
  type: 'scene_set', location: 'Toll Bridge', scene_summary: 'rain', description: null,
  kingdom: null, place_id: null, ...over,
}) as WorldVoiceResponse['state_updates']['world_events'][number];

const cond = (hp: number, mp = 50, sp = 100) => ({ hp, mp, sp, max_hp: 100, max_mp: 50, max_sp: 100 });
const cc = (over: Record<string, number | string | null>) =>
  ({ hp_delta: 0, mp_delta: 0, sp_delta: 0, reason: '', ...over }) as never;
const kinds = (r: ReturnType<typeof applyWorldUpdate>) => r.clampEvents.map((e) => e.kind);

describe('applyWorldUpdate — condition guard rails', () => {
  it('zero-delta condition_changes and a none setback change nothing', () => {
    const r = applyWorldUpdate(state({ condition: cond(80) }), 'a', response({ condition_changes: cc({}) }));
    expect(r.state.condition).toEqual(cond(80));
    expect(r.clampEvents).toEqual([]);
    expect(applyWorldUpdate(state({ condition: cond(80) }), 'a', response()).state.condition).toEqual(cond(80));
  });

  it('applies an in-range delta and logs it', () => {
    const r = applyWorldUpdate(state({ condition: cond(80) }), 'a', response({ condition_changes: cc({ hp_delta: -12, reason: 'a cut' }) }));
    expect(r.state.condition.hp).toBe(68);
    expect(r.systemEntries.map((e) => e.text)).toContain('-12 HP: a cut');
  });

  it('caps a delta at 40% of the pool max (delta_cap)', () => {
    const r = applyWorldUpdate(state({ condition: cond(90) }), 'a', response({ condition_changes: cc({ hp_delta: -999 }) }));
    expect(r.state.condition.hp).toBe(50);
    expect(r.clampEvents).toContainEqual({ kind: 'delta_cap', field: 'hp', raw: -999, applied: -40 });
  });

  it('clamps a pool at max with a positive delta (range)', () => {
    const r = applyWorldUpdate(state({ condition: cond(100) }), 'a', response({ condition_changes: cc({ hp_delta: 10 }) }));
    expect(r.state.condition.hp).toBe(100);
    expect(r.clampEvents).toContainEqual({ kind: 'range', field: 'hp', raw: 110, applied: 100 });
  });

  it('floors HP at 1 with no setback (hp_floor)', () => {
    const r = applyWorldUpdate(state({ condition: cond(20) }), 'a', response({ condition_changes: cc({ hp_delta: -40 }) }));
    expect(r.state.condition.hp).toBe(1);
    expect(kinds(r)).toContain('hp_floor');
  });

  it('a setback at 0 HP restores ceil(25%) of max and is logged', () => {
    const r = applyWorldUpdate(state({ condition: cond(20) }), 'a', response({
      condition_changes: cc({ hp_delta: -40 }),
      setback: { kind: 'captured', summary: 'You wake in a cell.' },
    }));
    expect(r.state.condition.hp).toBe(25);
    expect(kinds(r)).not.toContain('hp_floor');
    expect(r.systemEntries.map((e) => e.text)).toContain('You wake in a cell.');
  });

  it("a 'none' setback at 0 HP floors HP at 1 like no setback and logs nothing", () => {
    const r = applyWorldUpdate(state({ condition: cond(20) }), 'a', response({
      condition_changes: cc({ hp_delta: -40 }),
      setback: { kind: 'none', summary: '' },
    }));
    expect(r.state.condition.hp).toBe(1);
    expect(kinds(r)).toContain('hp_floor');
    expect(r.systemEntries.map((e) => e.text)).not.toContain('');
  });

  it('a setback with HP above 0 is logged and leaves HP unchanged', () => {
    const r = applyWorldUpdate(state({ condition: cond(60) }), 'a', response({
      setback: { kind: 'lost_something', summary: 'Your pack is gone.' },
    }));
    expect(r.state.condition.hp).toBe(60);
    expect(r.systemEntries.map((e) => e.text)).toContain('Your pack is gone.');
  });
});

describe('applyWorldUpdate — stat growth guard rails', () => {
  const grow = (stat: string, amount: number, milestone = 'm1') => ({ stat, amount, milestone }) as never;

  it('raises a pool max and current by the same amount and logs it', () => {
    const r = applyWorldUpdate(state({ condition: cond(70) }), 'a', response({ stat_growth: [grow('max_hp', 3)] }));
    expect(r.state.condition.max_hp).toBe(103);
    expect(r.state.condition.hp).toBe(73);
    expect(r.state.growthLog).toEqual([{ turn: 1, stat: 'max_hp', amount: 3, milestone: 'm1' }]);
    expect(r.systemEntries.map((e) => e.text)).toContain('+3 HP max: m1');
  });

  it('forces attribute growth to 1 (growth_amount)', () => {
    const r = applyWorldUpdate(state(), 'a', response({ stat_growth: [grow('WIL', 4)] }));
    expect(r.state.attributes.WIL).toBe(13);
    expect(r.clampEvents).toContainEqual({ kind: 'growth_amount', field: 'WIL', raw: 4, applied: 1 });
  });

  it('clamps pool growth to 5 (growth_amount)', () => {
    const r = applyWorldUpdate(state(), 'a', response({ stat_growth: [grow('max_sp', 50)] }));
    expect(r.state.condition.max_sp).toBe(105);
    expect(r.clampEvents).toContainEqual({ kind: 'growth_amount', field: 'max_sp', raw: 50, applied: 5 });
  });

  it('ignores amount <= 0 (growth_amount)', () => {
    const r = applyWorldUpdate(state(), 'a', response({ stat_growth: [grow('STR', 0), ] }));
    expect(r.state.attributes.STR).toBe(10);
    expect(r.state.growthLog).toEqual([]);
    expect(r.clampEvents).toContainEqual({ kind: 'growth_amount', field: 'STR', raw: 0, applied: null });
  });

  it('considers only the first entry (growth_extra)', () => {
    const r = applyWorldUpdate(state(), 'a', response({ stat_growth: [grow('STR', 1, 'a'), grow('AGI', 1, 'b')] }));
    expect(r.state.attributes).toMatchObject({ STR: 11, AGI: 10 });
    expect(r.state.growthLog).toHaveLength(1);
    expect(kinds(r)).toEqual(['growth_extra']);
  });

  it('ignores an attribute already at 20 (growth_ceiling)', () => {
    const r = applyWorldUpdate(state({ attributes: { STR: 20, AGI: 10, INT: 10, WIL: 12 } }), 'a', response({ stat_growth: [grow('STR', 1)] }));
    expect(r.state.attributes.STR).toBe(20);
    expect(kinds(r)).toEqual(['growth_ceiling']);
  });

  it('ignores a repeated milestone, trimmed and case-insensitive (growth_repeat)', () => {
    const s = state({ growthLog: [{ turn: 1, stat: 'STR', amount: 1, milestone: 'Held the Line' }] });
    const r = applyWorldUpdate(s, 'a', response({ stat_growth: [grow('AGI', 1, '  held the line ')] }));
    expect(r.state.attributes.AGI).toBe(10);
    expect(r.state.growthLog).toHaveLength(1);
    expect(kinds(r)).toEqual(['growth_repeat']);
  });

  it('stamps growthLog with the action-history length after this action', () => {
    const r = applyWorldUpdate(state({ actionHistory: ['x', 'y'] }), 'a', response({ stat_growth: [grow('INT', 1)] }));
    expect(r.state.growthLog[0].turn).toBe(3);
  });
});

describe('applyWorldUpdate — places', () => {
  it('mints a place from the location and kingdom', () => {
    const r = applyWorldUpdate(state(), 'a', response({ world_events: [ev({ kingdom: 'Kaldrath' })] }));
    expect(r.state.currentPlaceId).toBe('toll-bridge-kaldrath');
    expect(r.state.places['toll-bridge-kaldrath']).toEqual({ name: 'Toll Bridge', kingdom: 'Kaldrath', firstSeenTurn: 1 });
  });

  it('uses the unknown kingdom when none is given', () => {
    const r = applyWorldUpdate(state(), 'a', response({ world_events: [ev()] }));
    expect(r.state.currentPlaceId).toBe('toll-bridge-unknown');
  });

  it('reuses a known place_id and upgrades an unknown kingdom', () => {
    const s = state({ places: { 'toll-bridge-unknown': { name: 'Toll Bridge', kingdom: 'unknown', firstSeenTurn: 0 } } });
    const r = applyWorldUpdate(s, 'a', response({ world_events: [ev({ place_id: 'toll-bridge-unknown', kingdom: 'Tidemark' })] }));
    expect(r.state.currentPlaceId).toBe('toll-bridge-unknown');
    expect(Object.keys(r.state.places)).toHaveLength(1);
    expect(r.state.places['toll-bridge-unknown'].kingdom).toBe('Tidemark');
    expect(r.clampEvents).toEqual([]);
  });

  it('ignores an unknown place_id and mints from the location (place_unknown_id)', () => {
    const r = applyWorldUpdate(state(), 'a', response({ world_events: [ev({ place_id: 'made-up', kingdom: 'Aurelis' })] }));
    expect(r.state.currentPlaceId).toBe('toll-bridge-aurelis');
    expect(r.clampEvents).toContainEqual({ kind: 'place_unknown_id', field: 'place_id', raw: 'made-up', applied: null });
  });

  it('reuses an existing entry when the minted id already exists', () => {
    const first = applyWorldUpdate(state(), 'a', response({ world_events: [ev()] })).state;
    const r = applyWorldUpdate(first, 'b', response({ world_events: [ev()] }));
    expect(Object.keys(r.state.places)).toHaveLength(1);
    expect(r.state.places['toll-bridge-unknown'].firstSeenTurn).toBe(1);
  });

  it('truncates an over-long location to 80 chars for the place name', () => {
    const r = applyWorldUpdate(state(), 'a', response({ world_events: [ev({ location: 'L'.repeat(300) })] }));
    const names = Object.values(r.state.places).map((p) => p.name);
    expect(names).toContain('L'.repeat(80));
    expect(names.every((n) => n.length <= 80)).toBe(true);
  });

  it('truncates an over-long growth milestone to 200 chars', () => {
    const r = applyWorldUpdate(state(), 'a', response({ stat_growth: [{ stat: 'STR', amount: 1, milestone: 'M'.repeat(500) } as never] }));
    expect(r.state.growthLog.at(-1)?.milestone).toHaveLength(200);
  });

  it('refuses a 201st place (place_cap) and nulls currentPlaceId', () => {
    const places = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`p${i}`, { name: `P${i}`, kingdom: 'unknown' as const, firstSeenTurn: 0 }]));
    const r = applyWorldUpdate(state({ places, currentPlaceId: 'p0' }), 'a', response({ world_events: [ev()] }));
    expect(Object.keys(r.state.places)).toHaveLength(200);
    expect(r.state.currentPlaceId).toBeNull();
    expect(kinds(r)).toEqual(['place_cap']);
  });

  it('does not touch places without a scene_set', () => {
    const r = applyWorldUpdate(state({ currentPlaceId: null }), 'a', response());
    expect(r.state.places).toEqual({});
  });
});
