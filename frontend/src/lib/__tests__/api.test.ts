/**
 * Tests for the backend API client.
 *
 * `fetch` is stubbed for every test in this file, so nothing here can reach a
 * real network — the same posture as backend/src/__tests__/routes.test.ts,
 * which spies on `globalThis.fetch` and asserts it is never called. The
 * "talks only to the backend" describe block at the bottom makes that an
 * assertion rather than a convention: a regression to a direct provider call
 * fails a test, not just a code review.
 *
 * The four requirements each test names, and the mutant that proves it:
 *   - `response.ok` before parsing (R12)  → delete the check, non-2xx tests fail
 *   - content-type is JSON                → delete the check, the text/html test fails
 *   - responses parsed through the shared Zod schema → drop the parse, the
 *     malformed-body test fails
 *   - request bodies match backend/src/routes/*.ts → rename a posted field, the
 *     body-shape assertions fail
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Character,
  GameState,
  Race,
  UniqueSkillDetermination,
  WorldVoiceResponse,
} from '@soulbound/shared';

import {
  ApiClientError,
  callWorldEngine,
  determineUniqueSkill,
  generateIntroScene,
} from '../api';
import {
  stubCallWorldEngine,
  stubDetermineUniqueSkill,
  stubGenerateIntroScene,
} from '../apiStub';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const RACE: Race = {
  id: 'ashkin',
  name: 'Ashkin',
  desc: 'Born of cooled cinder.',
  intrinsic: [
    { name: 'Ember Sense', description: 'Feels heat through stone.' },
    { name: 'Cinder Skin', description: 'Shrugs off the first burn.' },
  ],
};

const ANSWERS = {
  nature: 'I watch before I move.',
  drive: 'To be owed nothing.',
  flaw: 'I mistake patience for virtue.',
  memory: 'A door that was never opened for me.',
  bond: 'Power is a debt you pay forward.',
};

const UNIQUE_SKILL: UniqueSkillDetermination = {
  skill_name: 'Patient Ledger',
  tier: 'Unique',
  description: 'It records every unpaid debt. It collects when you stop watching.',
  soul_resonance: 'This soul counts what it is owed before it counts what it has.',
  etching_text: 'A column of tally marks burns itself down your spine. Each one is a name.',
};

const CHARACTER: Character = {
  name: 'Vel',
  race: RACE,
  uniqueSkill: {
    skill_name: UNIQUE_SKILL.skill_name,
    tier: 'Unique',
    description: UNIQUE_SKILL.description,
    soul_resonance: UNIQUE_SKILL.soul_resonance,
    etching_text: UNIQUE_SKILL.etching_text,
  },
  answers: ANSWERS,
};

const GAME_STATE: GameState = {
  character: CHARACTER,
  skills: [
    { name: 'Ember Sense', tier: 'Intrinsic', mastery: 5, description: 'Feels heat through stone.' },
    {
      name: 'Patient Ledger',
      tier: 'Unique',
      mastery: 12,
      description: UNIQUE_SKILL.description,
      sub_abilities: [],
      usage_notes: ['Counted the toll-keeper twice.'],
      soul_resonance: UNIQUE_SKILL.soul_resonance,
    },
  ],
  location: 'The Sundered Toll',
  currentScene: 'Rain on a bridge that charges for passage.',
  actionHistory: ['Looked at the toll-keeper without paying.'],
  narrativeMemory: {
    entities: { 'toll-keeper': { name: 'Toll-Keeper Ysra', description: 'Counts in a dead tongue.' } },
    notes: ['Ysra remembers the unpaid.'],
  },
};

const WORLD_VOICE_RESPONSE: WorldVoiceResponse = {
  narration: 'The bridge groans. Ysra does not look up.',
  state_updates: {
    skill_mastery_changes: [
      { skill_name: 'Patient Ledger', tier: 'Unique', old_mastery: 12, new_mastery: 14, note: null },
    ],
    new_skills_granted: [],
    skill_evolutions: [],
    unique_sub_ability_unlocked: null,
    world_events: [
      {
        type: 'scene_set',
        location: 'The Sundered Toll',
        scene_summary: 'A standoff in the rain.',
        description: null,
      },
    ],
  },
  narrative_memory_updates: { new_entities: [], note: null },
  gm_note: null,
};

// ─── Response stubbing ──────────────────────────────────────────────────────

/**
 * A minimal stand-in for `Response`, hand-rolled rather than using the global
 * so the suite does not depend on whether jsdom or Node supplies `Response` /
 * `Headers`.
 *
 * `json()` really is `JSON.parse(body)`, so an HTML body rejects here exactly
 * as it would in a browser. That is what makes the content-type mutant
 * observable: with the check deleted, this throws a SyntaxError instead of the
 * diagnosable NON_JSON_RESPONSE the test asserts.
 */
function makeResponse(init: {
  status: number;
  body: string;
  contentType?: string | null;
  statusText?: string;
}): Response {
  const contentType = init.contentType === undefined ? 'application/json' : init.contentType;
  return {
    ok: init.status >= 200 && init.status < 300,
    status: init.status,
    statusText: init.statusText ?? '',
    headers: {
      get: (name: string): string | null =>
        name.toLowerCase() === 'content-type' ? contentType : null,
    },
    json: async (): Promise<unknown> => JSON.parse(init.body) as unknown,
    text: async (): Promise<string> => init.body,
  } as unknown as Response;
}

function jsonResponse(status: number, body: unknown): Response {
  return makeResponse({ status, body: JSON.stringify(body) });
}

let fetchMock: ReturnType<typeof vi.fn>;

/** Queues one response for the next fetch call. */
function respondWith(response: Response): void {
  fetchMock.mockResolvedValueOnce(response);
}

/** The parsed body of the Nth (default: first) fetch call. */
function postedBody(call = 0): unknown {
  const args = fetchMock.mock.calls[call];
  const init = args?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body));
}

function postedPath(call = 0): string {
  return String(fetchMock.mock.calls[call]?.[0]);
}

beforeEach(() => {
  fetchMock = vi.fn(() => {
    throw new Error('Unqueued fetch call — no test may reach the network.');
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * The shared assertions every route owes, run three times.
 *
 * `call` performs the request; `path` is the route it must POST to. Keeping
 * these in one place mirrors the client itself, which is one helper rather
 * than three near-copies.
 */
function describeSharedContract(
  name: string,
  path: string,
  call: () => Promise<unknown>,
  validBody: unknown,
): void {
  describe(`${name} — shared contract`, () => {
    it('POSTs JSON to the relative backend path', async () => {
      respondWith(jsonResponse(200, validBody));
      await call();

      expect(postedPath()).toBe(path);
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    });

    it('throws with the backend error code on a 400 INVALID_REQUEST (R12)', async () => {
      // Legacy checked response.ok on NONE of the three calls, so this body
      // fell through to JSON.parse and the player saw a parse error.
      respondWith(
        jsonResponse(400, {
          error: { message: 'Invalid world-engine request body: action is required', code: 'INVALID_REQUEST' },
        }),
      );

      const error = await call().then(
        () => null,
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(ApiClientError);
      // The code assertion — not merely "it threw" — is what kills the
      // deleted-response.ok mutant: without the check, a JSON error body
      // still throws, but from the Zod parse, as INVALID_RESPONSE_SHAPE.
      expect((error as ApiClientError).code).toBe('INVALID_REQUEST');
      expect((error as ApiClientError).status).toBe(400);
      expect((error as ApiClientError).message).toContain('action is required');
    });

    it('throws with the backend error code on a 401 AUTHENTICATION_FAILED (R12)', async () => {
      respondWith(
        jsonResponse(401, {
          error: { message: 'The world engine rejected our credentials.', code: 'AUTHENTICATION_FAILED' },
        }),
      );

      const error = (await call().catch((e: unknown) => e)) as ApiClientError;

      expect(error).toBeInstanceOf(ApiClientError);
      expect(error.code).toBe('AUTHENTICATION_FAILED');
      expect(error.status).toBe(401);
      expect(error.message).toContain('rejected our credentials');
    });

    it('throws a diagnosable error on a 200 + text/html (the SPA-fallback trap)', async () => {
      // The production `runtime` image serves /api/* with `serve -s`, whose SPA
      // fallback answers any unmatched path with 200 + index.html. response.ok
      // is true, so only the content-type check catches this.
      respondWith(
        makeResponse({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: '<!doctype html><html><head><title>Soulbound</title></head><body><div id="root"></div></body></html>',
        }),
      );

      const error = (await call().catch((e: unknown) => e)) as ApiClientError;

      expect(error).toBeInstanceOf(ApiClientError);
      expect(error.code).toBe('NON_JSON_RESPONSE');
      expect(error.status).toBe(200);
      // Names what was actually received — an operator reading this in a bug
      // report must be able to tell "static server answered" from "bad schema".
      expect(error.message).toContain('text/html');
      expect(error.message).toContain(path);
      // And never a Zod issue dump.
      expect(error.message).not.toContain('invalid_type');
    });

    it('throws rather than returning data when a 200 body violates the shared schema', async () => {
      respondWith(jsonResponse(200, { narration: 42, unexpected: true }));

      const error = (await call().catch((e: unknown) => e)) as ApiClientError;

      expect(error).toBeInstanceOf(ApiClientError);
      expect(error.code).toBe('INVALID_RESPONSE_SHAPE');
    });

    it('surfaces the status when a non-2xx answers with HTML instead of the error envelope', async () => {
      respondWith(
        makeResponse({
          status: 502,
          statusText: 'Bad Gateway',
          contentType: 'text/html',
          body: '<html><body>502 Bad Gateway</body></html>',
        }),
      );

      const error = (await call().catch((e: unknown) => e)) as ApiClientError;

      expect(error.code).toBe('HTTP_ERROR');
      expect(error.status).toBe(502);
      expect(error.message).toContain('502');
      expect(error.message).toContain('text/html');
    });

    it('reports a fetch rejection as an unreachable server, not a parse failure', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      const error = (await call().catch((e: unknown) => e)) as ApiClientError;

      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.message).toContain('Could not reach the game server');
    });
  });
}

// ─── POST /api/unique-skill ─────────────────────────────────────────────────
// Contract: backend/src/routes/uniqueSkill.ts UniqueSkillRequestSchema (74-78)
//   { name, race: { name }, answers: { nature, drive, flaw, memory, bond } }

describe('determineUniqueSkill', () => {
  it('returns the parsed, typed determination on the happy path', async () => {
    respondWith(jsonResponse(200, UNIQUE_SKILL));

    const result = await determineUniqueSkill({ name: 'Vel', race: RACE, answers: ANSWERS });

    expect(result).toEqual(UNIQUE_SKILL);
    expect(result.tier).toBe('Unique');
  });

  it('posts exactly the body UniqueSkillRequestSchema requires', async () => {
    respondWith(jsonResponse(200, UNIQUE_SKILL));
    await determineUniqueSkill({ name: 'Vel', race: RACE, answers: ANSWERS });

    expect(postedBody()).toEqual({
      name: 'Vel',
      race: { name: 'Ashkin' },
      answers: {
        nature: ANSWERS.nature,
        drive: ANSWERS.drive,
        flaw: ANSWERS.flaw,
        memory: ANSWERS.memory,
        bond: ANSWERS.bond,
      },
    });
  });
});

describeSharedContract(
  'determineUniqueSkill',
  '/api/unique-skill',
  () => determineUniqueSkill({ name: 'Vel', race: RACE, answers: ANSWERS }),
  UNIQUE_SKILL,
);

// ─── POST /api/world-engine ─────────────────────────────────────────────────
// Contract: backend/src/routes/worldEngine.ts WorldEngineRequestSchema (143-146)
//   { action, gameState }

describe('callWorldEngine', () => {
  it('returns the parsed, typed World Voice response on the happy path', async () => {
    respondWith(jsonResponse(200, WORLD_VOICE_RESPONSE));

    const result = await callWorldEngine('Refuse the toll.', GAME_STATE);

    expect(result).toEqual(WORLD_VOICE_RESPONSE);
    expect(result.state_updates.skill_mastery_changes[0]?.skill_name).toBe('Patient Ledger');
  });

  it('posts exactly the body WorldEngineRequestSchema requires', async () => {
    respondWith(jsonResponse(200, WORLD_VOICE_RESPONSE));
    await callWorldEngine('Refuse the toll.', GAME_STATE);

    // toEqual on the whole body, not a key spot-check: renaming `gameState` to
    // `state` must fail here.
    expect(postedBody()).toEqual({ action: 'Refuse the toll.', gameState: GAME_STATE });
  });

  it('ships the full game state, including narrative memory and skills', async () => {
    respondWith(jsonResponse(200, WORLD_VOICE_RESPONSE));
    await callWorldEngine('Refuse the toll.', GAME_STATE);

    const body = postedBody() as { gameState: GameState };
    expect(body.gameState.skills.some((s) => s.tier === 'Unique')).toBe(true);
    expect(body.gameState.narrativeMemory.entities['toll-keeper']?.name).toBe('Toll-Keeper Ysra');
    expect(body.gameState.actionHistory).toEqual(GAME_STATE.actionHistory);
  });
});

describeSharedContract(
  'callWorldEngine',
  '/api/world-engine',
  () => callWorldEngine('Refuse the toll.', GAME_STATE),
  WORLD_VOICE_RESPONSE,
);

// ─── POST /api/intro-scene ──────────────────────────────────────────────────
// Contract: backend/src/routes/introScene.ts IntroSceneRequestSchema (68-70)
//   { character: { name, race: { name }, uniqueSkill: { skill_name, soul_resonance } } }

describe('generateIntroScene', () => {
  it('returns the parsed, typed World Voice response on the happy path', async () => {
    respondWith(jsonResponse(200, WORLD_VOICE_RESPONSE));

    const result = await generateIntroScene(CHARACTER);

    expect(result).toEqual(WORLD_VOICE_RESPONSE);
    expect(result.state_updates.world_events[0]?.type).toBe('scene_set');
  });

  it('posts exactly the body IntroSceneRequestSchema requires', async () => {
    respondWith(jsonResponse(200, WORLD_VOICE_RESPONSE));
    await generateIntroScene(CHARACTER);

    expect(postedBody()).toEqual({
      character: {
        name: 'Vel',
        race: { name: 'Ashkin' },
        uniqueSkill: {
          skill_name: 'Patient Ledger',
          soul_resonance: UNIQUE_SKILL.soul_resonance,
        },
      },
    });
  });
});

describeSharedContract(
  'generateIntroScene',
  '/api/intro-scene',
  () => generateIntroScene(CHARACTER),
  WORLD_VOICE_RESPONSE,
);

// ─── The frontend talks only to the backend ─────────────────────────────────

describe('the client never leaves the backend', () => {
  it('sends every request to a relative /api/... path and no absolute provider URL', async () => {
    respondWith(jsonResponse(200, UNIQUE_SKILL));
    respondWith(jsonResponse(200, WORLD_VOICE_RESPONSE));
    respondWith(jsonResponse(200, WORLD_VOICE_RESPONSE));

    await determineUniqueSkill({ name: 'Vel', race: RACE, answers: ANSWERS });
    await callWorldEngine('Refuse the toll.', GAME_STATE);
    await generateIntroScene(CHARACTER);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const urls = fetchMock.mock.calls.map((args) => String(args[0]));
    expect(urls).toEqual(['/api/unique-skill', '/api/world-engine', '/api/intro-scene']);

    for (const url of urls) {
      expect(url.startsWith('/api/')).toBe(true);
      // Relative only: no scheme, no host. A regression to a direct provider
      // call fails here rather than in code review.
      expect(url).not.toMatch(/^https?:\/\//i);
      expect(url.toLowerCase()).not.toContain('api.anthropic.com');
      expect(url.toLowerCase()).not.toContain('/v1/messages');
    }
  });

  it('never sends an API key or auth header from the browser', async () => {
    respondWith(jsonResponse(200, UNIQUE_SKILL));
    await determineUniqueSkill({ name: 'Vel', race: RACE, answers: ANSWERS });

    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    const headerNames = Object.keys(headers).map((h) => h.toLowerCase());
    expect(headerNames).not.toContain('x-api-key');
    expect(headerNames).not.toContain('authorization');
    expect(headerNames).not.toContain('anthropic-version');
  });
});

// ─── The zero-cost stub (plan 03-09's sanctioned route to simulation) ───────

describe('apiStub', () => {
  it('returns contract-valid fixtures without touching fetch at all', async () => {
    const skill = await stubDetermineUniqueSkill({ name: 'Vel', race: RACE, answers: ANSWERS });
    const intro = await stubGenerateIntroScene(CHARACTER);
    const turn = await stubCallWorldEngine('Refuse the toll.', GAME_STATE);

    expect(skill.tier).toBe('Unique');
    expect(intro.state_updates.world_events[0]?.type).toBe('scene_set');
    expect(typeof turn.narration).toBe('string');

    // The whole point: plan 03-09 reaches the simulation screen for free.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('echoes the character so a stubbed run is still recognisably the player', async () => {
    const skill = await stubDetermineUniqueSkill({ name: 'Vel', race: RACE, answers: ANSWERS });
    const intro = await stubGenerateIntroScene(CHARACTER);

    expect(skill.description).toContain('STUB');
    expect(intro.narration).toContain('Vel');
    expect(intro.narration).toContain('Ashkin');
  });
});
