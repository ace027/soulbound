/**
 * The backend API client — the frontend's ONLY path to the World Voice.
 *
 * Replaces the artifact's three direct calls to the model provider's API
 * (legacy/souldbound-world.jsx 382-433 `determineUniqueSkill`, 445-500
 * `callWorldEngine`, 501-523 `generateIntroScene`). Almost none of those
 * functions ports: prompt assembly, `buildSystemBlocks()`, the ```json
 * fence-stripping and the model IDs all live backend-side now
 * (backend/src/routes/*.ts + the backend's provider client). What remains is a thin
 * POST + status check + content-type check + schema parse.
 *
 * TWO FAILURE MODES THIS FILE EXISTS TO CLOSE:
 *
 * 1. R12 — none of the three legacy functions checked `response.ok`. A non-2xx
 *    fell straight through to `JSON.parse` on an error body, so the player saw
 *    a JSON syntax error instead of "rate limited" or "bad API key".
 *
 * 2. The 200-with-HTML trap. docker-compose.yml records that the production
 *    `runtime` frontend image serves /api/* with `serve -s`, whose SPA fallback
 *    answers ANY unmatched path with 200 + index.html. A 200 sails past
 *    `response.ok`; the Zod parse then throws and the player sees a schema dump
 *    while the operator sees a healthy container — Phase 2's "green healthcheck
 *    masked a total outage", repeated. So the helper also asserts the
 *    content-type is JSON and names what it actually received.
 *
 * One helper, not three near-copies: this project's documented recurring
 * failure is drift between these three call sites, and the backend solved the
 * same problem the same way with `callWorldVoice`.
 *
 * Paths are RELATIVE (`/api/...`) so Vite's dev proxy (vite.config.ts) and any
 * future reverse proxy both work without a rebuild.
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

// ─── Error type ─────────────────────────────────────────────────────────────

/**
 * Every failure out of this module. `message` is what the UI shows — legacy
 * line 1029 renders `"The World Voice fell silent. " + e.message` — so it must
 * read as a diagnosis, never as a stack trace or a Zod issue dump.
 *
 * `code` is the backend's `error.code` when the backend answered
 * (INVALID_REQUEST, AUTHENTICATION_FAILED, RATE_LIMITED, UPSTREAM_UNAVAILABLE,
 * UPSTREAM_ERROR, INVALID_RESPONSE_SHAPE, PAYLOAD_TOO_LARGE, NOT_FOUND, ...),
 * or one of the client-side codes below when it did not.
 */
export type ApiClientErrorCode =
  /** A 200 (or any status) whose content-type was not JSON — the SPA-fallback trap. */
  | 'NON_JSON_RESPONSE'
  /** Content-type claimed JSON but the body did not parse. */
  | 'MALFORMED_JSON'
  /** Parsed fine, but did not match the shared Zod contract. */
  | 'INVALID_RESPONSE_SHAPE'
  /** fetch() itself rejected — offline, DNS, CORS, connection refused. */
  | 'NETWORK_ERROR'
  /** Non-2xx whose body carried no usable `error.code`. */
  | 'HTTP_ERROR';

export class ApiClientError extends Error {
  /** Backend `error.code`, or a client-side code when the backend never answered. */
  readonly code: ApiClientErrorCode | string;
  /** HTTP status, or undefined when fetch() itself rejected. */
  readonly status?: number;
  /** The route that failed, for logs. */
  readonly path: string;

  constructor(
    message: string,
    options: { code: ApiClientErrorCode | string; path: string; status?: number },
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.code = options.code;
    this.status = options.status;
    this.path = options.path;
  }
}

// ─── The shared helper ──────────────────────────────────────────────────────

/**
 * Structural stand-in for a Zod schema.
 *
 * Deliberately NOT `z.ZodType`: `zod` is a dependency of @soulbound/shared, not
 * of the frontend workspace, and importing it here would be an undeclared
 * dependency. Every Zod schema satisfies this shape.
 */
interface ResponseSchema<T> {
  parse(data: unknown): T;
}

/**
 * Matches `application/json` and the `+json` suffix family
 * (`application/problem+json`), with or without parameters
 * (`application/json; charset=utf-8`). Does NOT match `text/html`.
 */
const JSON_CONTENT_TYPE = /^application\/([\w.-]+\+)?json\s*(;|$)/i;

function isJsonContentType(contentType: string | null): boolean {
  return contentType !== null && JSON_CONTENT_TYPE.test(contentType.trim());
}

/** Renders a missing/odd content-type readably inside an error message. */
function describeContentType(contentType: string | null): string {
  return contentType === null || contentType.trim() === ''
    ? '(none)'
    : `"${contentType}"`;
}

/**
 * Reads the backend's `{ error: { message, code } }` envelope off a non-2xx
 * response. Returns nulls rather than throwing: a failing request must surface
 * its HTTP status, not a secondary parse error.
 */
async function readErrorEnvelope(
  response: Response,
): Promise<{ message: string | null; code: string | null }> {
  try {
    const body: unknown = await response.json();
    const error = (body as { error?: unknown } | null)?.error;
    if (error !== null && typeof error === 'object') {
      const { message, code } = error as { message?: unknown; code?: unknown };
      return {
        message: typeof message === 'string' && message !== '' ? message : null,
        code: typeof code === 'string' && code !== '' ? code : null,
      };
    }
  } catch {
    // Body was not JSON after all, or was empty. Fall through to nulls.
  }
  return { message: null, code: null };
}

/**
 * POST JSON to a backend route and return the schema-validated response.
 *
 * Order of gates matters and each one is load-bearing:
 *   1. fetch rejection          → NETWORK_ERROR
 *   2. `response.ok`            → R12. Non-2xx never reaches a parse.
 *   3. content-type is JSON     → the SPA-fallback trap, which (2) cannot see.
 *   4. body parses as JSON      → MALFORMED_JSON
 *   5. body matches the schema  → INVALID_RESPONSE_SHAPE
 */
async function postJson<T>(
  path: string,
  body: unknown,
  schema: ResponseSchema<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new ApiClientError(
      `Could not reach the game server at ${path}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { code: 'NETWORK_ERROR', path },
    );
  }

  const contentType = response.headers.get('content-type');

  // (2) R12. The legacy client skipped this entirely.
  if (!response.ok) {
    // Only read the envelope if the body actually claims to be JSON — a proxy
    // or gateway error page is HTML, and parsing it would replace a clean
    // "502" with a JSON syntax error.
    const envelope = isJsonContentType(contentType)
      ? await readErrorEnvelope(response)
      : { message: null, code: null };

    const code = envelope.code ?? 'HTTP_ERROR';
    const detail =
      envelope.message ??
      `The server returned ${response.status} ${response.statusText || 'error'} ` +
        `with content-type ${describeContentType(contentType)}.`;

    throw new ApiClientError(`${detail} (${code}, HTTP ${response.status})`, {
      code,
      path,
      status: response.status,
    });
  }

  // (3) The 200-with-HTML trap. A `serve -s` SPA fallback answers an unmatched
  // /api/* path with 200 + index.html, which (2) waves straight through.
  if (!isJsonContentType(contentType)) {
    throw new ApiClientError(
      `Expected JSON from ${path} but the server sent content-type ` +
        `${describeContentType(contentType)} with HTTP ${response.status}. ` +
        'The request probably never reached the API backend — ' +
        'a static-file server answering /api/* with the app shell does exactly this.',
      { code: 'NON_JSON_RESPONSE', path, status: response.status },
    );
  }

  // (4)
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (cause) {
    throw new ApiClientError(
      `The server's reply from ${path} claimed to be JSON but could not be parsed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { code: 'MALFORMED_JSON', path, status: response.status },
    );
  }

  // (5) The backend already validates. Re-parsing here is what turns contract
  // drift into a test failure rather than a runtime surprise mid-playthrough.
  try {
    return schema.parse(parsed);
  } catch (cause) {
    throw new ApiClientError(
      `The server's reply from ${path} did not match the expected shape: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { code: 'INVALID_RESPONSE_SHAPE', path, status: response.status },
    );
  }
}

// ─── The three fetchers ─────────────────────────────────────────────────────
// Request shapes derived from the Zod schemas in backend/src/routes/, which are
// the contract. Every nested object there is `.passthrough()`, so the full
// frontend `Race` / `GameState` / `Character` objects are accepted as-is and
// this client never has to mirror their shapes field by field.

/** `POST /api/unique-skill` body — `UniqueSkillRequestSchema`, uniqueSkill.ts:74-78. */
export interface UniqueSkillRequest {
  name: string;
  /** `.passthrough()` — the full Race (id, desc, intrinsic) is accepted; only `name` is read. */
  race: { name: string };
  /** `AnswersSchema` is a plain z.object: all five keys required, extras stripped. */
  answers: {
    nature: string;
    drive: string;
    flaw: string;
    memory: string;
    bond: string;
  };
}

/** `POST /api/world-engine` body — `WorldEngineRequestSchema`, worldEngine.ts:143-146. */
export interface WorldEngineRequest {
  action: string;
  gameState: GameState;
}

/** `POST /api/intro-scene` body — `IntroSceneRequestSchema`, introScene.ts:68-70. */
export interface IntroSceneRequest {
  character: {
    name: string;
    race: { name: string };
    uniqueSkill: { skill_name: string; soul_resonance: string };
  };
}

/**
 * Soul-reading from the questionnaire. Backend: Sonnet 5, no system blocks
 * (CLAUDE.md #8 — deliberately lore-blind).
 *
 * `answers` arrives as the questionnaire's `Record<string, string>`; the five
 * contract keys are named explicitly here rather than spread, so a missing one
 * comes back from the backend as a pointed `answers.flaw is required` instead
 * of being silently papered over with an empty string.
 */
export async function determineUniqueSkill(characterData: {
  name: string;
  race: Race;
  answers: QuestionnaireAnswers;
}): Promise<UniqueSkillDetermination> {
  const { name, race, answers } = characterData;
  const body: UniqueSkillRequest = {
    name,
    race: { name: race.name },
    answers: {
      nature: answers.nature,
      drive: answers.drive,
      flaw: answers.flaw,
      memory: answers.memory,
      bond: answers.bond,
    },
  };
  return postJson('/api/unique-skill', body, UniqueSkillDeterminationSchema);
}

/**
 * One turn of the live world. Backend: Opus 5, WORLD_SYSTEM_PROMPT + cached
 * WORLD_LORE.
 *
 * `gameState` ships whole (including `actionHistory`, which grows unbounded
 * client-side — see 03-CONTEXT.md's "Client bound the backend enforces": the
 * backend caps it at 2000 entries / 512kb and a very long playthrough will
 * eventually surface that as INVALID_REQUEST / PAYLOAD_TOO_LARGE here).
 */
export async function callWorldEngine(
  action: string,
  gameState: GameState,
): Promise<WorldVoiceResponse> {
  const body: WorldEngineRequest = { action, gameState };
  return postJson('/api/world-engine', body, WorldVoiceResponseSchema);
}

/**
 * The opening scene. Backend: Opus 5, same two system blocks as the world
 * engine — this call is what warms the shared prompt cache.
 */
export async function generateIntroScene(
  character: Character,
): Promise<WorldVoiceResponse> {
  const body: IntroSceneRequest = {
    character: {
      name: character.name,
      race: { name: character.race.name },
      uniqueSkill: {
        skill_name: character.uniqueSkill.skill_name,
        soul_resonance: character.uniqueSkill.soul_resonance,
      },
    },
  };
  return postJson('/api/intro-scene', body, WorldVoiceResponseSchema);
}
