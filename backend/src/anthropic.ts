/**
 * The single module every World Voice call passes through.
 *
 * Why this module exists: PROJECT.md records this codebase's recurring failure
 * mode as drift between the three call sites (unique-skill determination, the
 * world engine loop, intro scene generation) — not any one of them being wrong
 * on its own. `generateIntroScene` once concatenated the system prompt into the
 * user message and silently lost prompt caching for months. Routing all three
 * calls through one `callWorldVoice()` helper, and building the system blocks
 * with one `buildSystemBlocks()` function, makes that drift structurally
 * impossible instead of relying on discipline.
 *
 * No HTTP routes live here (see plan 02-03) — this module only builds and
 * issues Anthropic API requests and maps their outcomes.
 */

import Anthropic, {
  AnthropicError,
  APIError,
  AuthenticationError,
  InternalServerError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type {
  ContentBlockParam,
  Message,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import type { z } from 'zod';
import { WORLD_LORE } from './data/worldLore.js';
import { WORLD_SYSTEM_PROMPT } from './data/worldSystemPrompt.js';

// ─── Lazy client, and lazy config import ────────────────────────────────────
//
// `config.ts`'s `getAnthropicApiKey()` reads the key from a module-scoped
// `Secret` that was itself populated by `readApiKey()` — but `readApiKey()`
// runs at config.ts's OWN module top level (`const anthropicApiKey =
// readApiKey();`) and throws synchronously if the env var is absent. That
// means the hazard isn't just "don't construct the client at this module's
// load time" — a plain `import { getAnthropicApiKey } from './config.js'` at
// the top of *this* file throws transitively the moment this module is
// imported, with no key present, regardless of whether the client itself is
// built lazily. (Caught by this module's own no-key-import verification: a
// static top-level import of config.js reproduced exactly this throw.)
//
// `server.ts`'s `main()` already works around the same hazard for itself with
// `await import('./config.js')` inside a try/catch, with a comment explaining
// why. This module does the same thing, cached after the first successful
// load, so config.js is only ever imported once real work happens (inside
// `callWorldVoice`), never merely by importing `anthropic.ts`.
interface ConfigExports {
  getAnthropicApiKey: () => string;
  redact: (input: string) => string;
}

let configExports: ConfigExports | undefined;

async function loadConfig(): Promise<ConfigExports> {
  if (!configExports) {
    const mod = await import('./config.js');
    configExports = { getAnthropicApiKey: mod.getAnthropicApiKey, redact: mod.redact };
  }
  return configExports;
}

// The Anthropic client is likewise a module-scoped singleton, constructed on
// first use — not at this module's import time, and not until the (also
// lazy) config import above has resolved the key.
let client: Anthropic | undefined;

function getClient(apiKey: string): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

// ─── System blocks ───────────────────────────────────────────────────────────

/**
 * The two static system blocks shared by the world-engine and intro-scene
 * calls (`determineUniqueSkill` sends no system blocks at all — see
 * CLAUDE.md constraint #8 and the `useSystem` flag on `callWorldVoice`).
 *
 * Order matters: WORLD_SYSTEM_PROMPT first, then WORLD_LORE with the
 * `cache_control` breakpoint. A cache breakpoint caches everything up to and
 * including the block it's on, so putting it on the second block caches both
 * blocks as one prefix — matching `legacy/souldbound-world.jsx` lines 438-443.
 *
 * Byte-stability is the entire point: prompt caching matches on an exact
 * prefix, so any per-request variation here (a timestamp, a request id, a
 * reordering, a conditional block) silently destroys the cache. The only
 * symptom of that is a bill, not an error — so this function takes no
 * arguments and reads nothing but the two static constants. Two calls must
 * produce `JSON.stringify`-identical output.
 */
export function buildSystemBlocks(): TextBlockParam[] {
  return [
    { type: 'text', text: WORLD_SYSTEM_PROMPT },
    { type: 'text', text: WORLD_LORE, cache_control: { type: 'ephemeral' } },
  ];
}

// ─── Request constants ───────────────────────────────────────────────────────

/**
 * CLAUDE.md constraint #5 sets a floor of 2000, raised in production after
 * real JSON truncation errors. 16000 is that raised value — a floor, not a
 * target, and not to be lowered.
 */
const MAX_TOKENS = 16000;

/**
 * `output_config.effort` — deliberately set per route, not left to the model
 * default.
 *
 * Adaptive thinking draws from the same `max_tokens` budget raised to 16000 to
 * prevent truncation: a higher effort value means more of that budget goes to
 * thinking rather than to the narration + JSON the frontend actually needs.
 *
 * All three calls need reliable adherence to two hard, balance-load-bearing
 * constraints at once: the "MUST NOT" rule list (CLAUDE.md #6) and a strict
 * JSON schema via `output_config.format`. That argues for more than the unset
 * default. 'xhigh' and 'max' spend materially more of the turn budget on
 * reasoning depth this task does not need.
 *
 * ── Why this is per-route, and what the real constraint is ─────────────────
 * The uniformity requirement is narrower than an earlier version of this
 * comment claimed. `worldEngine` and `introScene` share a cache namespace, so
 * they must send byte-identical `output_config` — same `format` shape AND the
 * same `effort` — or the shared prefix stops matching. They are both 'high'.
 *
 * `uniqueSkill` is NOT part of that pair: it sends no `system` parameter at
 * all, so it has no cached prefix to match and its effort is free to differ.
 * It runs 'medium' — it is one short soul-read from five questionnaire
 * answers, not rule-adherence over a 15k-token prompt.
 *
 * So: the two entries below that share a cache MUST stay equal to each other;
 * `uniqueSkill` may vary independently.
 */
const EFFORT: Record<WorldVoiceRoute, 'low' | 'medium' | 'high' | 'xhigh' | 'max'> = {
  // These two share a cache namespace — keep them equal to each other.
  worldEngine: 'high',
  introScene: 'high',
  // Independent: no system blocks, no cached prefix, no coupling.
  uniqueSkill: 'medium',
};

// ─── Error mapping ───────────────────────────────────────────────────────────

export type WorldVoiceErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'INVALID_RESPONSE_SHAPE'
  | 'UPSTREAM_ERROR';

/**
 * Thrown by `callWorldVoice()` for every failure. Shaped to match the
 * `ApiError` interface `server.ts`'s central error handler already expects
 * (`statusCode`, `code`), so a route can simply `throw` or `next()` this and
 * the existing handler in server.ts does the right, already-sanitizing thing.
 *
 * `message` here is always a short, generic, redacted description — never the
 * raw SDK error's `.message` (which can embed the provider's raw JSON error
 * body) and never a stack trace. The raw detail is logged server-side,
 * redacted, by `describeAndLog` below; it never reaches this error's message.
 */
export class WorldVoiceCallError extends Error {
  readonly code: WorldVoiceErrorCode;
  readonly statusCode: number;

  constructor(code: WorldVoiceErrorCode, statusCode: number, message: string) {
    super(message);
    this.name = 'WorldVoiceCallError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Logs the raw (redacted) error detail server-side, tagged with the route,
 * and returns a clean public message with none of that detail in it. Kept
 * separate from the public message so a stack trace or a provider error body
 * can never end up in a `WorldVoiceCallError.message` that a non-500 response
 * forwards to the client.
 *
 * Takes `redact` as a parameter (from the lazily-loaded config module) rather
 * than importing it at this module's top level — see the lazy-config note
 * above.
 */
function describeAndLog(
  route: WorldVoiceRoute,
  err: unknown,
  publicMessage: string,
  redact: (input: string) => string,
  /** Operator-only context (e.g. the upstream HTTP status). Logged, never returned. */
  context?: string,
): string {
  const rawDetail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  const suffix = context === undefined ? '' : ` (${context})`;
  console.error(`[anthropic] ${route} call failed${suffix}:`, redact(rawDetail));
  return publicMessage;
}

/**
 * The message prefix the SDK uses for every structured-output failure — a
 * JSON-parse failure or a Zod validation failure inside
 * `zodOutputFormat(schema).parse()`. Matched as a prefix rather than an exact
 * string because the SDK appends the underlying parse/validation detail.
 */
const STRUCTURED_OUTPUT_FAILURE_PREFIX = 'Failed to parse structured output';

function isStructuredOutputFailure(err: AnthropicError): boolean {
  return typeof err.message === 'string' && err.message.startsWith(STRUCTURED_OUTPUT_FAILURE_PREFIX);
}

/**
 * Maps the Anthropic SDK's typed error classes to a `WorldVoiceCallError`
 * with a distinct code per failure class:
 *   - authentication failure  -> AUTHENTICATION_FAILED
 *   - rate limit              -> RATE_LIMITED
 *   - overloaded / 5xx        -> UPSTREAM_UNAVAILABLE
 *   - structured-output failure -> INVALID_RESPONSE_SHAPE
 * Anything else the SDK can throw (a 400, a 404, a connection failure, another
 * `AnthropicError` such as "Streaming is required for this operation", a
 * genuinely unexpected error) falls through to UPSTREAM_ERROR rather than being
 * silently miscategorized as one of the four above.
 */
function mapAnthropicError(
  err: unknown,
  route: WorldVoiceRoute,
  redact: (input: string) => string,
): WorldVoiceCallError {
  if (err instanceof AuthenticationError) {
    return new WorldVoiceCallError(
      'AUTHENTICATION_FAILED',
      401,
      describeAndLog(route, err, 'World Voice call failed: Anthropic API authentication failed.', redact),
    );
  }

  if (err instanceof RateLimitError) {
    return new WorldVoiceCallError(
      'RATE_LIMITED',
      429,
      describeAndLog(route, err, 'World Voice call failed: Anthropic API rate limit exceeded.', redact),
    );
  }

  if (err instanceof InternalServerError) {
    // 5xx, including 529 (overloaded_error) — the SDK does not give overloaded
    // its own class, so it's distinguished here by status/type for the log
    // line only. The public code and message stay the same for any 5xx: from
    // the caller's side, both mean "try again shortly."
    const overloaded = err.status === 529 || err.type === 'overloaded_error';
    return new WorldVoiceCallError(
      'UPSTREAM_UNAVAILABLE',
      503,
      describeAndLog(
        route,
        err,
        `World Voice call failed: Anthropic API ${overloaded ? 'overloaded' : 'unavailable'}. Try again shortly.`,
        redact,
      ),
    );
  }

  if (err instanceof APIError) {
    // Any other APIError (400 bad request, 403, 404, a raw connection
    // failure with no status, etc.). Not one of the four named classes, so it
    // gets its own code rather than being folded into one of them.
    //
    // Fixed 502, NOT the upstream status passed through. An upstream status is
    // a statement about Anthropic's API, and re-emitting it as this app's own
    // status makes the two indistinguishable to the frontend: a typo'd model
    // ID returns an Anthropic 404, which would arrive at the client as a 404 —
    // the same status this app's own JSON 404 handler returns for an unknown
    // route, and the frontend would reasonably read it as "that endpoint does
    // not exist". 502 ("bad response from an upstream") is the honest status
    // for every one of these: the request reached us fine, the upstream call
    // is what failed. The real upstream status stays in the server-side log
    // line, where an operator needs it.
    const status = typeof err.status === 'number' ? err.status : 'none';
    return new WorldVoiceCallError(
      'UPSTREAM_ERROR',
      502,
      describeAndLog(
        route,
        err,
        'World Voice call failed: Anthropic API request error.',
        redact,
        `upstream status ${status}`,
      ),
    );
  }

  if (err instanceof AnthropicError) {
    // Not an APIError, but still an SDK-recognized failure. `AnthropicError`
    // is the SDK's BASE error class, so this branch is a catch-all: it is
    // thrown for schema-validation failures, but also for "Streaming is
    // required for this operation", client misconfiguration, aborted
    // requests, and anything else the SDK raises without a status. Only the
    // first of those is an INVALID_RESPONSE_SHAPE; reporting the rest that way
    // would send an operator hunting a model-output bug that isn't there.
    //
    // Discriminated on the SDK's own message prefix, which is the only signal
    // it gives: `zodOutputFormat(...).parse()` throws
    // `Failed to parse structured output...` on both a JSON-parse failure and
    // a Zod validation failure (verified against
    // node_modules/@anthropic-ai/sdk/helpers/zod.js), and this module's own
    // defensive null-`parsed_output` throw in `callWorldVoice` deliberately
    // uses the same prefix so it lands here too.
    if (isStructuredOutputFailure(err)) {
      return new WorldVoiceCallError(
        'INVALID_RESPONSE_SHAPE',
        502,
        describeAndLog(
          route,
          err,
          'World Voice call failed: response did not match the expected schema.',
          redact,
        ),
      );
    }

    return new WorldVoiceCallError(
      'UPSTREAM_ERROR',
      502,
      describeAndLog(route, err, 'World Voice call failed: Anthropic SDK error.', redact),
    );
  }

  return new WorldVoiceCallError(
    'UPSTREAM_ERROR',
    500,
    describeAndLog(route, err, 'World Voice call failed: unexpected error.', redact),
  );
}

// ─── Usage logging ───────────────────────────────────────────────────────────

/**
 * Logs per-call usage, including both prompt-cache fields and `stop_reason`,
 * tagged with the calling route. Kept to one greppable line format
 * (`[anthropic:usage]`) — plan 02-05 reads these lines as its evidence that
 * caching is actually engaging (`cache_read_input_tokens > 0` on a second
 * call), which was never verifiable from inside the artifact.
 *
 * `stop_reason === 'max_tokens'` means the response was truncated. That is
 * surfaced with its own `[anthropic:usage:truncated]` tag rather than left to
 * be noticed only by scanning a JSON blob, since a silent truncation is
 * exactly the failure mode CLAUDE.md #5 raised `max_tokens` to 16000 to
 * avoid, and a recurrence should be visible immediately.
 */
function logUsage(route: WorldVoiceRoute, message: Message): void {
  const { usage, stop_reason: stopReason } = message;
  const line = {
    route,
    model: message.model,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens,
    stop_reason: stopReason,
  };

  if (stopReason === 'max_tokens') {
    console.warn('[anthropic:usage:truncated]', JSON.stringify(line));
  } else {
    console.log('[anthropic:usage]', JSON.stringify(line));
  }
}

// ─── The shared call helper ──────────────────────────────────────────────────

export type WorldVoiceRoute = 'uniqueSkill' | 'worldEngine' | 'introScene';

export interface CallWorldVoiceArgs<Schema extends z.ZodType> {
  /** Tags log lines and errors; not sent to the API. */
  route: WorldVoiceRoute;
  /** A model ID from `MODELS` in config.ts — never a literal here. */
  model: string;
  /** The user message content for this call. */
  content: string | ContentBlockParam[];
  /**
   * `determineUniqueSkill` sends no system parameter at all (CLAUDE.md #8 —
   * lore-blind AND system-blind, deliberately, not merely lore-blind). Set
   * `false` for that call and `true` for world-engine / intro-scene.
   */
  useSystem: boolean;
  /** The Zod schema this response must validate against. */
  schema: Schema;
}

/**
 * The one place a World Voice request is built and issued. Every request it
 * builds:
 *   - sets `max_tokens: 16000` (CLAUDE.md #5 — a floor, not a target)
 *   - builds `output_config.format` via the SDK's own `zodOutputFormat`, never
 *     from a pre-derived JSON Schema (see note below)
 *   - sets `output_config.effort` to the single, deliberate value above
 *   - carries no assistant-role message (prefill) and no `budget_tokens` —
 *     both return 400 on these models
 *   - passes `model` through verbatim, exactly as given by the caller
 *
 * Why `zodOutputFormat`, not `shared/`'s `WORLD_VOICE_JSON_SCHEMA`: that
 * export comes from bare `z.toJSONSchema()`, which still carries a top-level
 * `$schema` key and renders enums as JSON Schema `enum` arrays. Measured
 * against the installed SDK's own `transformJSONSchema` (what `zodOutputFormat`
 * calls internally): the raw export keeps `$schema` and 4 `enum` occurrences;
 * the SDK's normalizer removes both as JSON Schema *keywords*, folding their
 * values into prose `description` text instead (a schema-root
 * `"description": "{$schema: ...}"`, and `"description": "{enum: [...]}"` on
 * each enum field). So the literal `"$schema":` and `"enum":` keys are gone
 * while the information survives as annotation — check for the key, not the
 * substring. It preserves the `additionalProperties:
 * false` / full `required` list that `z.strictObject` already produces. The
 * SDK ships that normalizer because raw Zod output is not safe to send as
 * `output_config.format` — so this helper builds the format from the **Zod
 * schema** via `zodOutputFormat`, and `WORLD_VOICE_JSON_SCHEMA` stays reserved
 * for the startup drift guard (`assertWorldVoiceContract`), which only reads
 * property names and is unaffected either way.
 *
 * The installed SDK's `zodOutputFormat(zodObject)` takes a single argument —
 * there is no second "name" parameter in this SDK version (verified against
 * `node_modules/@anthropic-ai/sdk/helpers/zod.js`); `route` above is this
 * module's own tag for logging and error messages, not something passed to
 * the SDK call.
 *
 * The no-system path (`useSystem: false`) omits the `system` key from the
 * request object entirely via a conditional spread, rather than assigning it
 * a value that evaluates to `undefined` — `{ system: cond ? x : undefined }`
 * still leaves `'system' in request === true`, which is a different request
 * shape than the API never receiving the key at all.
 *
 * The response is parsed and validated against `schema` via
 * `client.messages.parse()` before this function returns, so a malformed
 * response fails here — mapped to `INVALID_RESPONSE_SHAPE` below — instead of
 * surfacing as an unexplained parse failure in the frontend.
 *
 * Cache-namespace note (ties to CLAUDE.md #7 / #8 and the original
 * `generateIntroScene` bug this module exists to prevent): prompt caches are
 * model-scoped, and world-engine and intro-scene share one cache namespace
 * only because they are on the SAME model as each other *and* send
 * byte-identical system blocks *and* byte-identical `output_config` (same
 * `format` shape, same `effort`). All three of those come from this one shared
 * helper today. If a future change gives one of those two its own schema, its
 * own effort value, its own model, or bypasses this helper, it silently
 * strands the other's cache warmth — the same shape of bug as the original
 * drift this module was built to prevent, just moved from the system-prompt
 * layer to the `output_config` layer.
 *
 * The pair is currently Sonnet 5; it has also been Opus 5. WHICH model they
 * share is a cost/quality choice. THAT they share one is the invariant.
 * `uniqueSkill` sits outside this entirely — no system blocks, no cache.
 */
export async function callWorldVoice<Schema extends z.ZodType>({
  route,
  model,
  content,
  useSystem,
  schema,
}: CallWorldVoiceArgs<Schema>): Promise<z.infer<Schema>> {
  // Lazy config load happens here, on first real call — never at this
  // module's import time. See the lazy-config note above `loadConfig`.
  const { getAnthropicApiKey, redact } = await loadConfig();

  const format = zodOutputFormat(schema);

  const request = {
    model,
    max_tokens: MAX_TOKENS,
    // No assistant-role message here: assistant prefill returns 400 on
    // Sonnet 5 and Opus 5. Every call is a single user turn.
    messages: [{ role: 'user' as const, content }],
    output_config: {
      format,
      effort: EFFORT[route],
      // No `budget_tokens` here either — also a 400 on both models.
    },
    // The no-system path must omit the key entirely, not send `system:
    // undefined` — see the doc comment above.
    ...(useSystem ? { system: buildSystemBlocks() } : {}),
  };

  try {
    const parsed = await getClient(getAnthropicApiKey()).messages.parse(request);
    logUsage(route, parsed);

    if (parsed.parsed_output === null) {
      // Defensive: zodOutputFormat's own `.parse` throws AnthropicError on a
      // JSON-parse or schema-validation failure, so this branch should be
      // unreachable in practice. It exists so a null `parsed_output` is
      // still mapped to INVALID_RESPONSE_SHAPE rather than returned as if it
      // were a valid response.
      // Prefixed with the SDK's own structured-output failure wording on
      // purpose: `mapAnthropicError` discriminates `AnthropicError` on that
      // prefix, and this genuinely is a structured-output failure.
      throw new AnthropicError(
        'Failed to parse structured output: World Voice response produced no parsed_output.',
      );
    }

    return parsed.parsed_output;
  } catch (err) {
    throw mapAnthropicError(err, route, redact);
  }
}
