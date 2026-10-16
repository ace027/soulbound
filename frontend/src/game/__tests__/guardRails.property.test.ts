/**
 * Seeded-PRNG property test: 200 turns of hostile World Voice output, with the
 * guard-rail invariants checked after every turn. Deterministic (mulberry32).
 */

import { describe, expect, it } from 'vitest';
import type { GameState, WorldVoiceResponse } from '@soulbound/shared';
import { initialStatsForRace } from '../../data/races.js';
import { applyWorldUpdate } from '../applyWorldUpdate.js';

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATS = ['max_hp', 'max_mp', 'max_sp', 'STR', 'AGI', 'INT', 'WIL'] as const;
const KINGDOM_VALUES = ['Kaldrath', 'Verdance', 'Ashenveil', 'Aurelis', 'Tidemark', 'Sundrach', 'unknown', null] as const;

describe('guard rails hold over 200 hostile turns', () => {
  it('keeps every invariant after every turn', () => {
    const rand = mulberry32(15_02);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    const hostileInt = () => pick([0, 1, -1, 5, 6, 40, -40, 999_999, -999_999, Math.floor(rand() * 200) - 100]);
    const maybe = <T,>(v: () => T): T | null => (rand() < 0.4 ? null : v());

    let s = {
      character: { name: 'F', race: { id: 'human', name: 'Human', desc: '', intrinsic: [] }, answers: {} },
      skills: [],
      location: 'Start',
      currentScene: 's',
      actionHistory: [],
      narrativeMemory: { entities: {}, notes: [] },
      ...initialStatsForRace('human'),
      places: {},
      currentPlaceId: null,
      growthLog: [],
    } as unknown as GameState;

    for (let turn = 1; turn <= 200; turn++) {
      const nGrowth = pick([0, 0, 1, 1, 3, 6]);
      const hasSetback = rand() < 0.15;
      const placeIds = [null, 'nope', ...Object.keys(s.places).slice(0, 5)];
      const events = rand() < 0.7
        ? [{
            type: 'scene_set',
            location: pick(['', 'Toll Bridge', `Place ${Math.floor(rand() * 400)}`, '  !!  ']),
            scene_summary: 'x',
            description: null,
            kingdom: pick(KINGDOM_VALUES),
            place_id: pick(placeIds),
          }]
        : [];
      const result = {
        narration: 'n',
        state_updates: {
          skill_mastery_changes: [],
          new_skills_granted: [],
          skill_evolutions: [],
          unique_sub_ability_unlocked: null,
          world_events: events,
          // Sentinels, never null: 0 = no change, '' reason when all deltas are 0.
          condition_changes: maybe(() => ({
            hp_delta: maybe(hostileInt) ?? 0, mp_delta: maybe(hostileInt) ?? 0, sp_delta: maybe(hostileInt) ?? 0, reason: 'r',
          })) ?? { hp_delta: 0, mp_delta: 0, sp_delta: 0, reason: '' },
          stat_growth: Array.from({ length: nGrowth }, () => ({
            stat: pick(STATS),
            amount: hostileInt(),
            milestone: pick(['same', 'Same ', 'other', `m${Math.floor(rand() * 30)}`]),
          })),
          setback: hasSetback ? { kind: 'captured', summary: 'caught' } : { kind: 'none', summary: '' },
        },
        narrative_memory_updates: { new_entities: [], note: null },
        gm_note: null,
      } as unknown as WorldVoiceResponse;

      const prevLog = s.growthLog.length;
      s = applyWorldUpdate(s, `act ${turn}`, result).state;
      const c = s.condition;

      for (const p of ['hp', 'mp', 'sp'] as const) {
        expect(c[p]).toBeGreaterThanOrEqual(0);
        expect(c[p]).toBeLessThanOrEqual(c[`max_${p}`]);
      }
      if (c.hp === 0) expect(hasSetback).toBe(true);
      for (const v of Object.values(s.attributes)) expect(v).toBeLessThanOrEqual(20);
      expect(s.growthLog.length - prevLog).toBeLessThanOrEqual(1);
      const keys = s.growthLog.map((e) => e.milestone.trim().toLowerCase());
      expect(new Set(keys).size).toBe(keys.length);
      expect(Object.keys(s.places).length).toBeLessThanOrEqual(200);
      expect(s.currentPlaceId === null || s.currentPlaceId in s.places).toBe(true);
    }
  });
});
