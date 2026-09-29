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
 * 2. The 200-with-HTML trap. Any SPA fallback in front of the API (the old
 *    `serve -s` frontend image did exactly this, before Phase 5 moved static
 *    serving into the backend) answers an unmatched /api path with 200 +
 *    index.html. A 200 sails past
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
  ACCESS_CHECK_PATH,
  ACCESS_HEADER,
  ACCESS_SCHEME,
  ACCOUNT_PATH,
  INVITE_REDEEM_PATH,
  MODE_HEADER,
  PASSPHRASE_REQUIRED,
  SIGN_IN_REQUIRED,
  UniqueSkillDeterminationSchema,
  WorldVoiceResponseSchema,
  type Character,
  type GameState,
  type QuestionnaireAnswers,
  type Race,
  type UniqueSkillDetermination,
  type WorldVoiceResponse,
} from '@soulbound/shared';

import { clearPassphrase, emitPassphraseRequired, getPassphrase } from './passphrase.js';

// ─── Error type ─────────────────────────────────────────────────────────────

/**
 * Every failure out of this module. `message` is what the UI shows — legacy
 * line 1029 renders `"The World Voice fell silent. " + e.message` — so it must
 * read as a diagnosis, never as a stack trace or a Zod issue dump.
 *
 * `code` is the backend's `error.code` when the backend answered
 * (INVALID_REQUEST, AUTHENTICATION_FAILED, RATE_LIMITED, UPSTREAM_UNAVAILABLE,
 * UPSTREAM_ERROR, INVALID_RESPONSE_SHAPE, PAYLOAD_TOO_LARGE, NOT_FOUND,
 * PASSPHRASE_REQUIRED, TOO_MANY_REQUESTS, ...), or one of the client-side codes
 * below when it did not.
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
 * The auth headers this module adds to every request. When a passphrase is
 * stored, it goes in as `Authorization: Bearer <passphrase>` (Phase 5, R19) —
 * the same header name and scheme the backend gate checks
 * (`shared/src/accessGate.ts`), so no CORS change was needed. When none is
 * stored, the header is simply absent and the backend answers 401
 * `PASSPHRASE_REQUIRED` (unless the gate is unset, e.g. in tests).
 */
function authHeaders(): Record<string, string> {
  const passphrase = getPassphrase();
  return passphrase === null ? {} : { [ACCESS_HEADER]: `${ACCESS_SCHEME} ${passphrase}` };
}

/**
 * POST JSON to a backend route and return the schema-validated response.
 *
 * Order of gates matters and each one is load-bearing:
 *   1. fetch rejection          → NETWORK_ERROR
 *   2. `response.ok`            → R12. Non-2xx never reaches a parse.
 *      A 401 `PASSPHRASE_REQUIRED` here also clears the stored passphrase and
 *      notifies `AccessGate` — but a 401 `AUTHENTICATION_FAILED` (the
 *      deployer's own Anthropic key is bad) must NOT: that would wipe a
 *      correct passphrase over an unrelated upstream problem. Keyed on `code`,
 *      never on status alone (05-CONTEXT.md derived fact 1).
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
        ...authHeaders(),
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

    if (response.status === 401 && code === PASSPHRASE_REQUIRED) {
      clearPassphrase();
      emitPassphraseRequired();
    }

    // Hosted mode (Phase 6): the session expired or was revoked mid-game.
    // `ModeGate` listens and shows sign-in. Self-host never sends this code.
    if (response.status === 401 && code === SIGN_IN_REQUIRED) {
      emitSignInRequired();
    }

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

/** `POST /api/world-engine` body — `WorldEngineRequestSchema`, worldEngine.ts:145-148. */
export interface WorldEngineRequest {
  action: string;
  gameState: GameState;
}

/** `POST /api/intro-scene` body — `IntroSceneRequestSchema`, introScene.ts:75-77. */
export interface IntroSceneRequest {
  character: {
    name: string;
    race: { name: string };
    uniqueSkill: { skill_name: string; soul_resonance: string; description: string };
  };
}

/**
 * Soul-reading from the questionnaire. Backend: Opus 5.5, no system blocks
 * (CLAUDE.md #8 — deliberately system-blind).
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
 * One turn of the live world. Backend: Sonnet 5.5, WORLD_SYSTEM_PROMPT + cached
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
 * The opening scene. Backend: Sonnet 5.5, same two system blocks as the world
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
        description: character.uniqueSkill.description,
      },
    },
  };
  return postJson('/api/intro-scene', body, WorldVoiceResponseSchema);
}

// ─── Access check ───────────────────────────────────────────────────────────

/**
 * Probes `GET /api/access` so `AccessGate` can ask before the title screen,
 * never after a paid call has already started (05-CONTEXT.md derived fact 2:
 * a failed creation strands the player mid-flow with no retry).
 *
 * Never throws. Every outcome that is not a clean 204 or a clean 401
 * `PASSPHRASE_REQUIRED` — a network error, a 502 from Vite's dev proxy with no
 * backend running, a 200 with an HTML body, a 401 with no recognisable
 * envelope — reads as `'unknown'`, and `AccessGate` fails OPEN on `'unknown'`.
 * The backend enforces regardless; failing closed here would lock out every
 * dev run started before the backend is up.
 */
export async function checkAccess(): Promise<'ok' | 'required' | 'unknown'> {
  let response: Response;
  try {
    response = await fetch(ACCESS_CHECK_PATH, {
      method: 'GET',
      headers: { Accept: 'application/json', ...authHeaders() },
    });
  } catch {
    return 'unknown';
  }

  if (response.status === 204) return 'ok';

  if (response.status === 401) {
    const contentType = response.headers.get('content-type');
    const envelope = isJsonContentType(contentType)
      ? await readErrorEnvelope(response)
      : { message: null, code: null };
    return envelope.code === PASSPHRASE_REQUIRED ? 'required' : 'unknown';
  }

  return 'unknown';
}

// ─── Hosted mode (Phase 6) ──────────────────────────────────────────────────
// Everything above this line is the self-host client and is unchanged, except
// the one `SIGN_IN_REQUIRED` branch in `postJson`. `checkAccess` keeps its
// three results because `AccessGate.tsx` stores them in a state typed to
// exactly those values (06-CONTEXT addendum). Only `ModeGate` uses what follows.

/** What `ModeGate` needs to know before anything else mounts. */
export interface AccessState {
  /** `'signin'` is hosted mode's 401 `SIGN_IN_REQUIRED`; the rest mean what `checkAccess` means. */
  access: 'ok' | 'required' | 'signin' | 'unknown';
  /** True only when the response carried `Soulbound-Mode: hosted`. Self-host never sends it. */
  hosted: boolean;
}

/**
 * The same probe as `checkAccess` (same request, same envelope parsing, same
 * fail-open `'unknown'`), plus the one extra result and the mode header.
 * Never throws.
 */
export async function getAccessState(): Promise<AccessState> {
  let response: Response;
  try {
    response = await fetch(ACCESS_CHECK_PATH, {
      method: 'GET',
      headers: { Accept: 'application/json', ...authHeaders() },
    });
  } catch {
    return { access: 'unknown', hosted: false };
  }

  const hosted = response.headers.get(MODE_HEADER) === 'hosted';

  if (response.status === 204) return { access: 'ok', hosted };

  if (response.status === 401) {
    const contentType = response.headers.get('content-type');
    const envelope = isJsonContentType(contentType)
      ? await readErrorEnvelope(response)
      : { message: null, code: null };
    if (envelope.code === PASSPHRASE_REQUIRED) return { access: 'required', hosted };
    if (envelope.code === SIGN_IN_REQUIRED) return { access: 'signin', hosted };
  }

  return { access: 'unknown', hosted };
}

/**
 * `POST /api/invites/redeem`. A valid code sets the short-lived invite cookie
 * that sign-up needs. `'invalid'` is the server's single 400 for a bad, used or
 * expired code; anything else (network, 429, 5xx) is `'error'`. The passphrase
 * header is never sent: hosted mode has no passphrase.
 */
export async function redeemInvite(code: string): Promise<'ok' | 'invalid' | 'error'> {
  try {
    const response = await fetch(INVITE_REDEEM_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (response.status === 204) return 'ok';
    if (response.status === 400) return 'invalid';
    return 'error';
  } catch {
    return 'error';
  }
}

/**
 * `DELETE /api/account`. 204 means every session is already revoked and the
 * cookie cleared, so the caller goes straight to sign-in. A 401
 * `SIGN_IN_REQUIRED` (the session had already gone) also tells `ModeGate`, as
 * `postJson` does. No passphrase header.
 */
export async function deleteAccount(): Promise<'ok' | 'error'> {
  let response: Response;
  try {
    response = await fetch(ACCOUNT_PATH, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  } catch {
    return 'error';
  }
  if (response.status === 204) return 'ok';
  if (response.status === 401 && isJsonContentType(response.headers.get('content-type'))) {
    const envelope = await readErrorEnvelope(response);
    if (envelope.code === SIGN_IN_REQUIRED) emitSignInRequired();
  }
  return 'error';
}

// ─── "the session has gone" event ───────────────────────────────────────────
// The same in-module listener Set as `passphrase.ts`'s `onPassphraseRequired`.

const signInListeners = new Set<() => void>();

/** Subscribe to "the server just said this player is not signed in". Returns an unsubscribe function. */
export function onSignInRequired(fn: () => void): () => void {
  signInListeners.add(fn);
  return () => {
    signInListeners.delete(fn);
  };
}

/** Notify every subscriber. Called from this module's error paths. */
export function emitSignInRequired(): void {
  for (const fn of signInListeners) fn();
}
