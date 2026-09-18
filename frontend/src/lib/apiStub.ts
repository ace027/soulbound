/**
 * ZERO-COST FIXTURE STUB — NOT THE API CLIENT. NOT FOR PRODUCTION.
 *
 * Fixture-returning stand-ins for the three functions in `./api.ts`. They make
 * no network call of any kind and return the same fixed, contract-valid
 * responses every time.
 *
 * Why this exists: plan 03-09 has to reach the simulation screen to verify the
 * ported screens render, and the creation flow (race → questionnaire → loading
 * → intro) runs through three paid model calls to get there. A seeded
 * localStorage save covers the Load path; this covers the creation path. It is
 * the sanctioned way to exercise the flow without spending, and the only one.
 *
 * Wiring rules:
 *   - Nothing in `src/` may import this at module scope in shipped code. It is
 *     for tests and for a deliberate, temporary swap during a manual run.
 *   - The names are `stub*` precisely so a leftover import reads as a defect at
 *     a glance and greps out in one line:
 *       grep -rn "apiStub" frontend/src --include=*.tsx
 *
 * The fixtures are parsed through the shared Zod schemas at module load, so a
 * change to the World Voice contract breaks this file too rather than leaving
 * 03-09 exercising the screens with a shape the real client could never
 * return.
 */

import {
  UniqueSkillDeterminationSchema,
  WorldVoiceResponseSchema,
  type Character,
  type GameState,
  type QuestionnaireAnswers,
  type Race,
  type UniqueSkillDetermination,
  type WorldVoiceResponse,
} from '@soulbound/shared';

/** Marker carried in the user-visible text, so a stubbed run is never mistaken for a real one. */
const STUB_MARK = '[STUB]';

const STUB_UNIQUE_SKILL: UniqueSkillDetermination = UniqueSkillDeterminationSchema.parse({
  skill_name: 'Placeholder Resonance',
  tier: 'Unique',
  description:
    `${STUB_MARK} A fixed fixture returned by apiStub.ts. No model produced this, ` +
    'and it says nothing about the soul that answered the questionnaire.',
  soul_resonance: `${STUB_MARK} Fixture soul resonance — the real determination is a backend call.`,
  etching_text: `${STUB_MARK} Nothing is etched. This is a development fixture.`,
});

const STUB_WORLD_TURN: WorldVoiceResponse = WorldVoiceResponseSchema.parse({
  narration: `${STUB_MARK} The world does not answer — apiStub.ts is wired in place of the World Voice.`,
  state_updates: {
    skill_mastery_changes: [],
    new_skills_granted: [],
    skill_evolutions: [],
    unique_sub_ability_unlocked: null,
    world_events: [],
  },
  narrative_memory_updates: { new_entities: [], note: null },
  gm_note: `${STUB_MARK} Stubbed turn. No tokens were spent.`,
});

/**
 * Soul-reading, stubbed. Ignores the answers by design — reading them would
 * imply a determination this file is not making.
 */
export async function stubDetermineUniqueSkill(_characterData: {
  name: string;
  race: Race;
  answers: QuestionnaireAnswers;
}): Promise<UniqueSkillDetermination> {
  return STUB_UNIQUE_SKILL;
}

/**
 * One turn, stubbed. Echoes the action so the world log visibly responds to
 * input while proving nothing was sent anywhere.
 */
export async function stubCallWorldEngine(
  action: string,
  _gameState: GameState,
): Promise<WorldVoiceResponse> {
  return WorldVoiceResponseSchema.parse({
    ...STUB_WORLD_TURN,
    narration: `${STUB_MARK} You tried: "${action}". The World Voice is stubbed, so nothing happens.`,
  });
}

/**
 * The opening scene, stubbed. Names the character and race, and emits the
 * `scene_set` event the simulation screen needs for its location header —
 * without which 03-09 would reach simulation with an empty world bar and
 * report a false regression.
 */
export async function stubGenerateIntroScene(
  character: Character,
): Promise<WorldVoiceResponse> {
  return WorldVoiceResponseSchema.parse({
    ...STUB_WORLD_TURN,
    narration:
      `${STUB_MARK} ${character.name} the ${character.race.name} arrives in a fixture, ` +
      'not in Vaeltharion. Every screen past this point is rendering stubbed data.',
    state_updates: {
      ...STUB_WORLD_TURN.state_updates,
      world_events: [
        {
          type: 'scene_set',
          location: 'The Stubbed Threshold',
          scene_summary: `${STUB_MARK} A placeholder scene, so the simulation screen has one.`,
          description: null,
        },
      ],
    },
  });
}
