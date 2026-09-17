/**
 * Request-construction and error-mapping tests for the shared `anthropic.ts`
 * helper (plan 02-04).
 *
 * Mocks at the SDK boundary — `Anthropic.Messages.prototype.create` — never
 * the route handlers or `callWorldVoice` itself, so the real helper builds
 * the real request object on every call here. `create()` is what
 * `client.messages.parse()` calls internally (verified against the installed
 * SDK: `parse(params, options) { return this.create(params, options).then(...) }`,
 * `node_modules/@anthropic-ai/sdk/resources/messages/messages.js`), and
 * `Anthropic.Messages` (the default export's static property, assigned from
 * the same `Messages` class in `client.js`) is the exact prototype `getClient()`
 * instantiates against — so spying there captures the literal request object
 * `callWorldVoice` builds, with no route or helper code stubbed out.
 *
 * No network call happens anywhere in this file: `create` never reaches its
 * real implementation, and `ANTHROPIC_API_KEY` is not exported into the
 * shell for this suite (see CLAUDE.md's environment note in the plan). The
 * `beforeAll` below sets a fake, obviously-non-functional key directly on
 * `process.env` *inside this test file*, after module load, purely so the
 * lazily-imported `config.js` (loaded by `callWorldVoice` itself, on first
 * real call — see anthropic.ts's own lazy-config comment) has a truthy
 * string to read. That key is never sent anywhere: every `create` call in
 * this file is intercepted by the spy before it would reach `fetch`.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Anthropic, {
  AnthropicError,
  APIError,
  AuthenticationError,
  InternalServerError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import type { Message } from '@anthropic-ai/sdk/resources/messages';
import { z } from 'zod';
import { WorldVoiceResponseSchema } from '@soulbound/shared';
import {
  buildSystemBlocks,
  callWorldVoice,
  WorldVoiceCallError,
  type WorldVoiceRoute,
} from '../anthropic.js';
// Imported from the data modules, NOT re-derived from buildSystemBlocks():
// asserting a request against the same function that built it is a tautology
// that passes even if both block texts are replaced with junk. These two
// imports are the only thing anchoring the system blocks to the real prompt
// and the real lore.
import { WORLD_LORE } from '../data/worldLore.js';
import { WORLD_SYSTEM_PROMPT } from '../data/worldSystemPrompt.js';

// Reaching this point at all — this file's own top-level
// `import { buildSystemBlocks, callWorldVoice, ... } from '../anthropic.js'`
// above already executed, synchronously, as part of loading this test file,
// and it ran before the `beforeAll` below ever sets a key. If anthropic.ts
// (or anything it imports at module scope) required `ANTHROPIC_API_KEY` to
// be present at import time, this whole file would already have failed to
// load, and every test below would report as a collection error rather than
// a normal pass/fail. See the "module import" describe block for the
// explicit assertion.
describe('anthropic.ts module import', () => {
  it('imported cleanly with ANTHROPIC_API_KEY unset (see file-level comment above)', () => {
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(typeof buildSystemBlocks).toBe('function');
    expect(typeof callWorldVoice).toBe('function');
  });
});

// A fake key, set only after the module-import assertion above has already
// run. It exists solely to satisfy config.ts's presence check for the
// lazily-imported config module `callWorldVoice` needs on every call below —
// it is never valid, and it is never sent over the network (every `create`
// call is intercepted by the spy).
const FAKE_KEY = 'sk-ant-test-fake-key-never-sent-mocked-only';

// A minimal schema, independent of the real World Voice contract, for tests
// that only care about request shape (not response content).
const TestSchema = z.strictObject({ answer: z.string() });

function makeMessage(model: string, payload: unknown, overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg_test_0001',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: JSON.stringify(payload), citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
    },
    ...overrides,
  } as Message;
}

/** True if `key` appears as an own, enumerable property anywhere in `value`'s object graph. */
function hasKeyDeep(value: unknown, key: string): boolean {
  if (value && typeof value === 'object') {
    if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, key)) {
      return true;
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
      if (hasKeyDeep(child, key)) return true;
    }
  }
  return false;
}

// ─── buildSystemBlocks ────────────────────────────────────────────────────

describe('buildSystemBlocks', () => {
  it('returns two blocks, cache_control on index 1 only, byte-stable across calls', () => {
    const first = buildSystemBlocks();
    const second = buildSystemBlocks();

    expect(first).toHaveLength(2);
    expect(first[0]).not.toHaveProperty('cache_control');
    expect(first[1]).toMatchObject({ cache_control: { type: 'ephemeral' } });

    // Byte-stable: two independent calls must produce JSON.stringify-identical
    // output. Any per-request variation here (timestamp, request id,
    // reordering) silently destroys prompt caching — see anthropic.ts's own
    // doc comment on this function.
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('carries the real WORLD_SYSTEM_PROMPT and WORLD_LORE, in that order', () => {
    const blocks = buildSystemBlocks();

    // Anchored to the imported constants. Without this, replacing both block
    // texts with junk strings still passes every other assertion in this file.
    expect(blocks[0]).toEqual({ type: 'text', text: WORLD_SYSTEM_PROMPT });
    expect(blocks[1]).toEqual({
      type: 'text',
      text: WORLD_LORE,
      cache_control: { type: 'ephemeral' },
    });

    // ORDER, explicitly: a swap keeps both texts present and every
    // "contains the prompt" style assertion green, while changing the cached
    // prefix and stranding the existing cache. The cache breakpoint covers
    // everything up to and including its own block, so it belongs on the
    // SECOND one.
    expect(blocks[0]!.text).not.toBe(WORLD_LORE);
    expect(blocks[1]!.text).not.toBe(WORLD_SYSTEM_PROMPT);
    expect(blocks[0]).not.toHaveProperty('cache_control');
  });

  it('the two texts are actually distinct, non-trivial strings', () => {
    // Sanity, so the order assertions above cannot be satisfied by two empty
    // or identical constants.
    expect(WORLD_SYSTEM_PROMPT).not.toBe(WORLD_LORE);
    expect(WORLD_SYSTEM_PROMPT.length).toBeGreaterThan(1000);
    expect(WORLD_LORE.length).toBeGreaterThan(1000);
  });
});

// ─── callWorldVoice: request construction ─────────────────────────────────

describe('callWorldVoice request construction', () => {
  let createSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = FAKE_KEY;
  });

  beforeEach(() => {
    createSpy = vi.spyOn(Anthropic.Messages.prototype, 'create');
  });

  afterEach(() => {
    createSpy.mockRestore();
  });

  async function callAndCapture(useSystem: boolean, schema: z.ZodType, payload: unknown) {
    createSpy.mockResolvedValueOnce(makeMessage('claude-sonnet-5', payload));
    await callWorldVoice({
      route: 'uniqueSkill' as WorldVoiceRoute,
      model: 'claude-sonnet-5',
      content: 'test content',
      useSystem,
      schema,
    });
    expect(createSpy).toHaveBeenCalledTimes(1);
    // `create(params, options)` — `params` is the exact object callWorldVoice
    // built (see messages.js: `create(params, options) { const {
    // user_profile_id, workspace_id, ...body } = params; ... }`), so this is
    // the real request, not a reconstruction.
    return createSpy.mock.calls[0]![0] as Record<string, unknown>;
  }

  it('sets max_tokens: 16000', async () => {
    const request = await callAndCapture(false, TestSchema, { answer: 'x' });
    expect(request.max_tokens).toBe(16000);
  });

  it('sets output_config.effort to the chosen named value', async () => {
    const request = await callAndCapture(false, TestSchema, { answer: 'x' });
    const outputConfig = request.output_config as Record<string, unknown>;
    expect(outputConfig.effort).toBe('high');
    expect(['low', 'medium', 'high', 'xhigh', 'max']).toContain(outputConfig.effort);
  });

  it('never emits budget_tokens', async () => {
    const request = await callAndCapture(false, TestSchema, { answer: 'x' });
    const outputConfig = request.output_config as Record<string, unknown>;
    expect('budget_tokens' in outputConfig).toBe(false);
  });

  it('never emits an assistant-role message — a single user turn only', async () => {
    const request = await callAndCapture(false, TestSchema, { answer: 'x' });
    const messages = request.messages as Array<{ role: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('user');
    expect(messages.some((m) => m.role === 'assistant')).toBe(false);
  });

  it('passes output_config.format built from the given schema (zodOutputFormat, not raw z.toJSONSchema)', async () => {
    const request = await callAndCapture(false, TestSchema, { answer: 'x' });
    const outputConfig = request.output_config as Record<string, unknown>;
    const format = outputConfig.format as Record<string, unknown>;

    expect(format.type).toBe('json_schema');
    const schema = format.schema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    expect(properties).toHaveProperty('answer');
    expect((properties.answer as Record<string, unknown>).type).toBe('string');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['answer']);

    // The literal JSON Schema *keys* must be absent — zodOutputFormat's
    // normalizer (transformJSONSchema) strips them, folding their values
    // into prose `description` text instead. A substring check alone would
    // false-pass here (see next test), so this checks the key.
    expect(hasKeyDeep(format, '$schema')).toBe(false);
    expect(hasKeyDeep(format, 'enum')).toBe(false);
  });

  it('output_config.format contains no literal "$schema": or "enum": key, on the real World Voice schema with real enums', async () => {
    // WorldVoiceResponseSchema has four SkillTierSchema (z.enum) fields, so
    // this is a genuine test of enum-key removal, not an artifact of a
    // schema with no enums to strip. Verified directly against the installed
    // SDK before writing this test: zodOutputFormat(WorldVoiceResponseSchema)
    // produces no literal `$schema` or `enum` key anywhere in the object
    // graph, while the substring `$schema` still appears (folded into the
    // schema root's `description` as `{$schema: "..."}`) and the substring
    // `enum` still appears (folded into the deduped tier $def's description
    // as `{enum: [...]}`) — proving the key is genuinely gone rather than
    // the whole annotation being dropped.
    const validPayload = {
      narration: 'test',
      state_updates: {
        skill_mastery_changes: [],
        new_skills_granted: [],
        skill_evolutions: [],
        unique_sub_ability_unlocked: null,
        world_events: [],
      },
      narrative_memory_updates: { new_entities: [], note: null },
      gm_note: null,
    };
    const request = await callAndCapture(true, WorldVoiceResponseSchema, validPayload);
    const format = (request.output_config as Record<string, unknown>).format;

    expect(hasKeyDeep(format, '$schema')).toBe(false);
    expect(hasKeyDeep(format, 'enum')).toBe(false);

    // Sanity: the substrings genuinely do still occur somewhere in the
    // serialized format — proving the key-absence assertions above are
    // discriminating (real removal), not trivially true of an empty schema.
    const serialized = JSON.stringify(format);
    expect(serialized).toContain('$schema');
    expect(serialized).toContain('enum');
  });

  it('the no-system path omits the system key from the request entirely ("system" in request === false)', async () => {
    const request = await callAndCapture(false, TestSchema, { answer: 'x' });
    // Not `expect(request.system).toBeUndefined()` — that also passes for a
    // conditional-ternary bug (`system: cond ? x : undefined`) that leaves
    // the key present with an undefined value, a materially different
    // request shape than the key never being sent at all. `'system' in
    // request` is the only check that distinguishes the two.
    expect('system' in request).toBe(false);
  });

  it('the useSystem: true path sends system as buildSystemBlocks() output, present and correct', async () => {
    const validPayload = {
      narration: 'test',
      state_updates: {
        skill_mastery_changes: [],
        new_skills_granted: [],
        skill_evolutions: [],
        unique_sub_ability_unlocked: null,
        world_events: [],
      },
      narrative_memory_updates: { new_entities: [], note: null },
      gm_note: null,
    };
    const request = await callAndCapture(true, WorldVoiceResponseSchema, validPayload);
    expect('system' in request).toBe(true);

    // Anchored to the real constants rather than to buildSystemBlocks() —
    // comparing the request to the same function that built it is a tautology
    // that survives both block texts being replaced with junk.
    const system = request.system as Array<{ text: string; cache_control?: unknown }>;
    expect(system).toHaveLength(2);
    expect(system[0]!.text).toBe(WORLD_SYSTEM_PROMPT);
    expect(system[1]!.text).toBe(WORLD_LORE);
    expect(system[0]).not.toHaveProperty('cache_control');
    expect(system[1]!.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('passes model through verbatim', async () => {
    createSpy.mockResolvedValueOnce(makeMessage('claude-opus-5', { answer: 'x' }));
    await callWorldVoice({
      route: 'worldEngine',
      model: 'claude-opus-5',
      content: 'hi',
      useSystem: false,
      schema: TestSchema,
    });
    const request = createSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(request.model).toBe('claude-opus-5');
  });
});

// ─── callWorldVoice: usage logging ────────────────────────────────────────

describe('callWorldVoice usage logging', () => {
  let createSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = FAKE_KEY;
  });

  beforeEach(() => {
    createSpy = vi.spyOn(Anthropic.Messages.prototype, 'create');
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    createSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  async function callWith(overrides: Partial<Message>): Promise<void> {
    createSpy.mockResolvedValueOnce(makeMessage('claude-opus-5', { answer: 'x' }, overrides));
    await callWorldVoice({
      route: 'worldEngine',
      model: 'claude-opus-5',
      content: 'hi',
      useSystem: false,
      schema: TestSchema,
    });
  }

  /** The single `[anthropic:usage...]` line, parsed back out of the spy. */
  function loggedLine(spy: ReturnType<typeof vi.spyOn>): { tag: string; body: Record<string, unknown> } {
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0]! as unknown as [string, string];
    return { tag: call[0], body: JSON.parse(call[1]) as Record<string, unknown> };
  }

  it('emits one [anthropic:usage] line carrying BOTH prompt-cache fields', async () => {
    // These two fields are the entire point of the line: plan 02-05 reads them
    // as the evidence that caching is engaging at all (cache_read > 0 on a
    // second call), which was never verifiable from inside the artifact.
    await callWith({
      usage: {
        input_tokens: 812,
        output_tokens: 431,
        cache_creation_input_tokens: 15_132,
        cache_read_input_tokens: 0,
        cache_creation: null,
        server_tool_use: null,
        service_tier: null,
      } as Message['usage'],
    });

    const { tag, body } = loggedLine(consoleLogSpy);
    expect(tag).toBe('[anthropic:usage]');
    expect(body.route).toBe('worldEngine');
    expect(body.model).toBe('claude-opus-5');
    expect(body.input_tokens).toBe(812);
    expect(body.output_tokens).toBe(431);
    expect(body.cache_creation_input_tokens).toBe(15_132);
    expect(body.cache_read_input_tokens).toBe(0);
    expect(body.stop_reason).toBe('end_turn');
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('reports a cache READ on a warm call', async () => {
    await callWith({
      usage: {
        input_tokens: 798,
        output_tokens: 402,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 15_132,
        cache_creation: null,
        server_tool_use: null,
        service_tier: null,
      } as Message['usage'],
    });

    const { body } = loggedLine(consoleLogSpy);
    expect(body.cache_read_input_tokens).toBe(15_132);
    expect(body.cache_creation_input_tokens).toBe(0);
  });

  it('a truncated response is tagged [anthropic:usage:truncated] on console.warn, not buried in the normal line', async () => {
    // stop_reason 'max_tokens' is the silent failure CLAUDE.md #5 raised
    // max_tokens to 16000 to prevent. A recurrence has to be visible
    // immediately, with its own greppable tag — not left to be noticed by
    // reading a JSON blob.
    await callWith({ stop_reason: 'max_tokens' } as Partial<Message>);

    expect(consoleLogSpy).not.toHaveBeenCalled();
    const { tag, body } = loggedLine(consoleWarnSpy);
    expect(tag).toBe('[anthropic:usage:truncated]');
    expect(body.stop_reason).toBe('max_tokens');
    expect(body.route).toBe('worldEngine');
  });
});

// ─── callWorldVoice: error mapping ─────────────────────────────────────────

describe('callWorldVoice error mapping', () => {
  let createSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = FAKE_KEY;
  });

  beforeEach(() => {
    createSpy = vi.spyOn(Anthropic.Messages.prototype, 'create');
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    createSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  async function captureThrown(): Promise<WorldVoiceCallError> {
    let thrown: unknown;
    try {
      await callWorldVoice({
        route: 'uniqueSkill',
        model: 'claude-sonnet-5',
        content: 'hi',
        useSystem: false,
        schema: TestSchema,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(WorldVoiceCallError);
    return thrown as WorldVoiceCallError;
  }

  it('AuthenticationError -> AUTHENTICATION_FAILED, 401', async () => {
    createSpy.mockRejectedValueOnce(
      new AuthenticationError(
        401,
        { type: 'authentication_error', message: `invalid x-api-key: ${FAKE_KEY}` },
        `invalid x-api-key: ${FAKE_KEY}`,
        undefined,
        'authentication_error',
      ),
    );
    const err = await captureThrown();
    expect(err.code).toBe('AUTHENTICATION_FAILED');
    expect(err.statusCode).toBe(401);
  });

  it('RateLimitError -> RATE_LIMITED, 429', async () => {
    createSpy.mockRejectedValueOnce(
      new RateLimitError(429, { type: 'rate_limit_error', message: 'rate limited' }, 'rate limited', undefined, 'rate_limit_error'),
    );
    const err = await captureThrown();
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.statusCode).toBe(429);
  });

  it('InternalServerError (plain 500) -> UPSTREAM_UNAVAILABLE, 503, "unavailable"', async () => {
    createSpy.mockRejectedValueOnce(
      new InternalServerError(500, { type: 'api_error', message: 'internal error' }, 'internal error', undefined, 'api_error'),
    );
    const err = await captureThrown();
    expect(err.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(err.statusCode).toBe(503);
    expect(err.message).toContain('unavailable');
  });

  it('InternalServerError (529 overloaded) -> UPSTREAM_UNAVAILABLE, 503, "overloaded"', async () => {
    createSpy.mockRejectedValueOnce(
      new InternalServerError(
        529,
        { type: 'overloaded_error', message: 'overloaded' },
        'overloaded',
        undefined,
        'overloaded_error',
      ),
    );
    const err = await captureThrown();
    expect(err.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(err.statusCode).toBe(503);
    expect(err.message).toContain('overloaded');
  });

  it('a generic APIError (400) -> UPSTREAM_ERROR, fixed 502 — the upstream status is NOT passed through', async () => {
    createSpy.mockRejectedValueOnce(
      new APIError(400, { type: 'invalid_request_error', message: 'bad request' }, 'bad request', undefined, 'invalid_request_error'),
    );
    const err = await captureThrown();
    expect(err.code).toBe('UPSTREAM_ERROR');
    expect(err.statusCode).toBe(502);
    // The operator still gets the real upstream status, in the log line.
    // The operator still gets the real upstream status — in the LOG LINE, not
    // in the message the client is handed.
    const logged = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toContain('[anthropic] uniqueSkill call failed (upstream status 400)');
    expect(err.message).not.toContain('400');
  });

  it('an upstream 404 (e.g. a typo\'d model ID) does NOT surface as an app-level 404', async () => {
    // This is the collision the fixed 502 exists to prevent: the app's own
    // JSON 404 handler returns 404 for an unknown ROUTE. If an upstream 404
    // were passed through, the frontend would see the two as the same thing
    // and could reasonably conclude the endpoint does not exist.
    createSpy.mockRejectedValueOnce(
      new APIError(404, { type: 'not_found_error', message: 'model not found' }, 'model not found', undefined, 'not_found_error'),
    );
    const err = await captureThrown();
    expect(err.statusCode).not.toBe(404);
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe('UPSTREAM_ERROR');
    expect(err.code).not.toBe('NOT_FOUND');
    const logged = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toContain('(upstream status 404)');
    expect(err.message).not.toContain('404');
  });

  it('a schema-violating mocked response -> INVALID_RESPONSE_SHAPE, 502 (via the real zodOutputFormat.parse path, not a hand-thrown error)', async () => {
    // Deliberately NOT hand-constructing an AnthropicError here: returning
    // content that fails schema validation exercises the SDK's own
    // `zodOutputFormat(...).parse()` throwing an AnthropicError, mapped by
    // callWorldVoice's real catch path — a genuine end-to-end proof, not a
    // synthetic case that only tests the switch statement.
    createSpy.mockResolvedValueOnce(makeMessage('claude-sonnet-5', { wrong_field: true }));
    const err = await captureThrown();
    expect(err.code).toBe('INVALID_RESPONSE_SHAPE');
    expect(err.statusCode).toBe(502);
  });

  it('a non-schema AnthropicError ("Streaming is required...") -> UPSTREAM_ERROR, NOT INVALID_RESPONSE_SHAPE', async () => {
    // `AnthropicError` is the SDK's BASE class, so this branch is a catch-all:
    // streaming requirements, client misconfiguration and aborted requests all
    // arrive as bare AnthropicErrors. Reporting those as INVALID_RESPONSE_SHAPE
    // sends an operator hunting a model-output bug that does not exist.
    createSpy.mockRejectedValueOnce(
      new AnthropicError('Streaming is required for this operation'),
    );
    const err = await captureThrown();
    expect(err.code).not.toBe('INVALID_RESPONSE_SHAPE');
    expect(err.code).toBe('UPSTREAM_ERROR');
    expect(err.statusCode).toBe(502);
  });

  it('an AnthropicError carrying the SDK\'s structured-output wording DOES map to INVALID_RESPONSE_SHAPE', async () => {
    // The exact prefix zodOutputFormat(...).parse() throws with (verified
    // against node_modules/@anthropic-ai/sdk/helpers/zod.js) — the other half
    // of the discrimination above.
    createSpy.mockRejectedValueOnce(
      new AnthropicError('Failed to parse structured output: invalid_type at narration'),
    );
    const err = await captureThrown();
    expect(err.code).toBe('INVALID_RESPONSE_SHAPE');
    expect(err.statusCode).toBe(502);
  });

  it('an unexpected plain Error -> UPSTREAM_ERROR, 500', async () => {
    createSpy.mockRejectedValueOnce(new Error('completely unexpected failure'));
    const err = await captureThrown();
    expect(err.code).toBe('UPSTREAM_ERROR');
    expect(err.statusCode).toBe(500);
  });

  it('every mapped error code is distinct across the five failure classes', async () => {
    createSpy.mockRejectedValueOnce(
      new AuthenticationError(401, { type: 'authentication_error' }, 'x', undefined, 'authentication_error'),
    );
    const authErr = await captureThrown();

    createSpy.mockRejectedValueOnce(new RateLimitError(429, { type: 'rate_limit_error' }, 'x', undefined, 'rate_limit_error'));
    const rateErr = await captureThrown();

    createSpy.mockRejectedValueOnce(new InternalServerError(500, { type: 'api_error' }, 'x', undefined, 'api_error'));
    const upstreamErr = await captureThrown();

    createSpy.mockResolvedValueOnce(makeMessage('claude-sonnet-5', { nope: true }));
    const shapeErr = await captureThrown();

    createSpy.mockRejectedValueOnce(new Error('unexpected'));
    const genericErr = await captureThrown();

    const codes = [authErr.code, rateErr.code, upstreamErr.code, shapeErr.code, genericErr.code];
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('no resulting WorldVoiceCallError.message contains the API key or a stack trace, and the server-side log line has the key redacted', async () => {
    const rawMessageWithKey = `upstream error echoing key: ${FAKE_KEY}`;
    createSpy.mockRejectedValueOnce(
      new AuthenticationError(
        401,
        { type: 'authentication_error', message: rawMessageWithKey },
        rawMessageWithKey,
        undefined,
        'authentication_error',
      ),
    );
    const err = await captureThrown();

    // The public error message is a fixed, generic, redacted description —
    // never the raw SDK error's message or a stack trace.
    expect(err.message).not.toContain(FAKE_KEY);
    expect(err.message).not.toMatch(/\n\s+at /); // no V8 stack-trace frame lines
    expect(err.message).toBe('World Voice call failed: Anthropic API authentication failed.');

    // The raw detail IS logged server-side (for operators), but redact()
    // must have stripped the key from it before it reached console.error.
    const logged = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged.length).toBeGreaterThan(0);
    expect(logged).not.toContain(FAKE_KEY);
  });
});
