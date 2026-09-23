/**
 * End-to-end route tests for the three World Voice routes, through a real
 * Express pipeline, with the Anthropic SDK mocked at the same boundary as
 * `anthropic.test.ts` — `Anthropic.Messages.prototype.create`. Route
 * handlers and `callWorldVoice` are never mocked; only the network-facing
 * SDK method is.
 *
 * The app under test IS `server.ts`'s own `buildApp()`. It used to be a
 * hand-rebuilt copy of that pipeline — which meant `server.ts` was executed by
 * no test at all, and three separate mutations of it (unregistering all three
 * routers, replacing the error handler's client message with the raw stack,
 * deleting the startup contract guard) left this suite fully green. `main()`
 * still owns the parts a test must not run (`process.exit`, binding the real
 * port), and `server.ts` boots only when it is the process entrypoint, so
 * importing it here is inert. The startup half of `main()` is covered
 * separately in server.test.ts.
 *
 * Inside the main suite the app is driven over the loopback interface with
 * Node's built-in `node:http`, never with `fetch` — there `fetch` is reserved
 * as a network tripwire (installed in that suite's own `beforeAll`, restored
 * in its `afterAll`): the installed SDK's own shim (`internal/shims.js`,
 * `getDefaultFetch`) resolves to `globalThis.fetch` when none is passed to
 * the `Anthropic` client, so if any code path there ever bypassed the
 * `create()` mock and reached the real SDK network call, this spy would
 * throw before any actual request left the process. The trailing `buildApp
 * middleware` describe runs after that spy has been restored and does drive
 * the app with `fetch`; it mocks no SDK call, so nothing in it can reach one.
 */

import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import Anthropic, { AuthenticationError } from '@anthropic-ai/sdk';
import type { Message } from '@anthropic-ai/sdk/resources/messages';
import { createRateLimiter } from '../accessGate.js';

/** Same fixed window the real limiter uses (`accessGate.ts`'s WINDOW_MS), duplicated here only because it isn't exported — the limiter is a black box to its callers by design. */
const WINDOW_MS_FOR_TEST = 60_000;

// Fake key, set before anything in this file lazily imports config.js (both
// the routes themselves and the error handler inside buildApp). Never valid,
// never sent anywhere — every `create` call is intercepted by the spy before
// it would reach `fetch`. See anthropic.test.ts's identical note.
const FAKE_KEY = 'sk-ant-test-fake-key-never-sent-mocked-only';
process.env.ANTHROPIC_API_KEY = FAKE_KEY;
// config.ts now also requires a passphrase at module load (Phase 5's access
// gate). This file drives the real pipeline through buildApp(), so its
// requests must carry a matching Bearer header once the gate is wired in
// 05-02 — that header isn't added by this plan.
const FAKE_PASSPHRASE = 'test-passphrase-not-real';
process.env.SOULBOUND_PASSPHRASE = FAKE_PASSPHRASE;
// The server binds an ephemeral port here, so the Host header carries a port
// this file cannot know in advance. A hostname-only allow-list entry matches
// any port on that hostname — and exercising the ALLOWED_HOSTS env override is
// itself part of what this file covers. config.ts's PORT-derived default is
// asserted in server.test.ts.
process.env.ALLOWED_HOSTS = '127.0.0.1';
const config = await import('../config.js');
const { buildApp } = await import('../server.js');

/**
 * The real pipeline from server.ts — see file header. The shared harness
 * runs with a high rate limit (600/min) so the ~20+ requests this file makes
 * across its describe blocks can never exhaust the limiter based on run
 * order (plan critique #1: a low shared limit would make these tests flaky
 * and order-dependent). Tests that need to exercise the limiter itself build
 * their own app with a low limit and an injected clock — see the "rate
 * limiter" describe block below.
 */
function buildTestApp() {
  return buildApp({ ...config, RATE_LIMIT_PER_MINUTE: 600 });
}

/** The Bearer header every gated request in this file must send. */
const AUTH_HEADERS = { Authorization: `Bearer ${FAKE_PASSPHRASE}` };

function startServer(app: express.Express): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, port });
    });
  });
}

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  bodyText: string;
  bodyJson: unknown;
}

/**
 * Drives the test server over loopback with node:http — see file header for
 * why not fetch. Sends the gate's Bearer header by default (AUTH_HEADERS),
 * since almost every request in this file needs to pass the gate to test
 * what it was written to test; pass `noAuth: true` to omit it for the gate's
 * own tests, or `headers: { Authorization: '...' }` to send a different one.
 */
function httpRequest(
  port: number,
  options: {
    method: string;
    path: string;
    body?: string;
    headers?: Record<string, string>;
    noAuth?: boolean;
  },
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: options.method,
        path: options.path,
        headers: {
          'content-type': 'application/json',
          ...(options.body !== undefined ? { 'content-length': Buffer.byteLength(options.body) } : {}),
          ...(options.noAuth === true ? {} : AUTH_HEADERS),
          ...(options.headers ?? {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString('utf8');
        });
        res.on('end', () => {
          let bodyJson: unknown;
          try {
            bodyJson = JSON.parse(data);
          } catch {
            bodyJson = undefined;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, bodyText: data, bodyJson });
        });
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

function makeMessage(model: string, payload: unknown): Message {
  return {
    id: 'msg_test_0002',
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
  } as Message;
}

/**
 * The property names of a captured request's `output_config.format` JSON
 * Schema — i.e. which fields this route told the model to return.
 */
function schemaPropertyNames(request: Record<string, unknown>): string[] {
  const outputConfig = request.output_config as Record<string, unknown>;
  const format = outputConfig.format as Record<string, unknown>;
  const schema = format.schema as Record<string, unknown>;
  return Object.keys(schema.properties as object);
}

// ─── Fixture request bodies (each satisfies its route's Zod request schema) ─

const uniqueSkillRequestBody = {
  name: 'Test Character',
  race: { name: 'Human' },
  answers: {
    nature: 'They investigate carefully before acting.',
    drive: 'To understand this world.',
    flaw: 'Overly cautious to a fault.',
    memory: 'The day everything changed.',
    bond: 'Power is a responsibility, not a prize.',
  },
};

// `gameState.skills` must contain the soul-bound Unique slot: one Unique-tier
// skill is a law of this world, and the render function's whole soul-profile
// block is skipped without one (see worldEngine.ts's refine()).
const worldEngineRequestBody = {
  action: 'look around the square',
  gameState: {
    character: { name: 'Test Character', race: { name: 'Human' } },
    skills: [{ name: 'Testing Resolve', tier: 'Unique', mastery: 0 }],
    location: 'Test Town Square',
    currentScene: 'A quiet cobblestone square at dusk.',
    actionHistory: [],
  },
};

const introSceneRequestBody = {
  character: {
    name: 'Test Character',
    race: { name: 'Human' },
    uniqueSkill: { skill_name: 'Testing Resolve', soul_resonance: 'because it must be proven' },
  },
};

const validUniqueSkillPayload = {
  skill_name: 'Testing Resolve',
  tier: 'Unique',
  description: 'A skill that manifests as unwavering diagnostic clarity.',
  soul_resonance: 'This soul carries it because it never stops verifying.',
  etching_text: 'The sensation of certainty crystallizing onto the soul.',
};

const validWorldVoicePayload = {
  narration: 'The square is quiet.',
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

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('World Voice routes (mocked SDK boundary)', () => {
  let app: express.Express;
  let server: http.Server;
  let port: number;
  let createSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    app = buildTestApp();
    ({ server, port } = await startServer(app));

    // Network tripwire for the whole file: the Anthropic SDK falls back to
    // `globalThis.fetch` when no fetch override is passed to the client
    // (verified against `internal/shims.js`'s `getDefaultFetch`). Every
    // route call below only ever completes because `create()` is mocked
    // below it in the stack — if any test path reached past that mock, this
    // throws before a single byte would leave the process.
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error(
        'Network call attempted via fetch — Anthropic.Messages.prototype.create was not mocked for this call.',
      );
    });
  });

  afterAll(async () => {
    fetchSpy.mockRestore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    createSpy = vi.spyOn(Anthropic.Messages.prototype, 'create');
  });

  afterEach(() => {
    createSpy.mockRestore();
  });

  it('never touches the network: fetch is untouched by the mocked happy-path calls below', async () => {
    createSpy.mockResolvedValueOnce(makeMessage('claude-sonnet-5', validUniqueSkillPayload));
    const res = await httpRequest(port, {
      method: 'POST',
      path: '/api/unique-skill',
      body: JSON.stringify(uniqueSkillRequestBody),
    });
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe('POST /api/unique-skill', () => {
    it('calls claude-opus-5 with the unique-skill schema and no system key', async () => {
      createSpy.mockResolvedValueOnce(makeMessage('claude-sonnet-5', validUniqueSkillPayload));
      const res = await httpRequest(port, {
        method: 'POST',
        path: '/api/unique-skill',
        body: JSON.stringify(uniqueSkillRequestBody),
      });

      expect(res.status).toBe(200);
      expect(res.bodyJson).toEqual(validUniqueSkillPayload);
      expect(createSpy).toHaveBeenCalledTimes(1);

      const request = createSpy.mock.calls[0]![0] as Record<string, unknown>;
      // Pins the WIRING: this route calls ITS configured model. The literal
      // values live in config.test.ts, so a deliberate model change updates
      // one place, not five.
      expect(request.model).toBe(config.MODELS.uniqueSkill);
      expect('system' in request).toBe(false);

      expect(schemaPropertyNames(request).sort()).toEqual(
        ['skill_name', 'tier', 'description', 'soul_resonance', 'etching_text'].sort(),
      );
    });
  });

  describe('POST /api/world-engine', () => {
    it('calls claude-sonnet-5 with the World Voice schema and system blocks present', async () => {
      createSpy.mockResolvedValueOnce(makeMessage('claude-opus-5', validWorldVoicePayload));
      const res = await httpRequest(port, {
        method: 'POST',
        path: '/api/world-engine',
        body: JSON.stringify(worldEngineRequestBody),
      });

      expect(res.status).toBe(200);
      expect(res.bodyJson).toEqual(validWorldVoicePayload);

      const request = createSpy.mock.calls[0]![0] as Record<string, unknown>;
      expect(request.model).toBe(config.MODELS.worldEngine);
      expect('system' in request).toBe(true);
      expect(Array.isArray(request.system)).toBe(true);
      expect((request.system as unknown[]).length).toBe(2);

      expect(schemaPropertyNames(request).sort()).toEqual(
        ['narration', 'state_updates', 'narrative_memory_updates', 'gm_note'].sort(),
      );
    });
  });

  describe('POST /api/intro-scene', () => {
    it('calls claude-sonnet-5 with the World Voice schema and system blocks present', async () => {
      createSpy.mockResolvedValueOnce(makeMessage('claude-opus-5', validWorldVoicePayload));
      const res = await httpRequest(port, {
        method: 'POST',
        path: '/api/intro-scene',
        body: JSON.stringify(introSceneRequestBody),
      });

      expect(res.status).toBe(200);
      expect(res.bodyJson).toEqual(validWorldVoicePayload);

      const request = createSpy.mock.calls[0]![0] as Record<string, unknown>;
      expect(request.model).toBe(config.MODELS.introScene);
      expect('system' in request).toBe(true);
    });
  });

  it('the two Opus routes (world-engine, intro-scene) send byte-identical system blocks AND byte-identical output_config', async () => {
    createSpy.mockResolvedValueOnce(makeMessage('claude-opus-5', validWorldVoicePayload));
    await httpRequest(port, {
      method: 'POST',
      path: '/api/world-engine',
      body: JSON.stringify(worldEngineRequestBody),
    });
    const worldEngineRequest = createSpy.mock.calls[0]![0] as Record<string, unknown>;

    createSpy.mockResolvedValueOnce(makeMessage('claude-opus-5', validWorldVoicePayload));
    await httpRequest(port, {
      method: 'POST',
      path: '/api/intro-scene',
      body: JSON.stringify(introSceneRequestBody),
    });
    const introSceneRequest = createSpy.mock.calls[1]![0] as Record<string, unknown>;

    // Cache namespace depends on both — a future change to one route's
    // schema or effort silently strands the other's cache warmth (see
    // anthropic.ts's cache-namespace note). JSON.stringify naturally drops
    // the non-serializable `format.parse` function, comparing exactly the
    // wire-relevant shape.
    expect(JSON.stringify(worldEngineRequest.system)).toBe(JSON.stringify(introSceneRequest.system));
    expect(JSON.stringify(worldEngineRequest.output_config)).toBe(
      JSON.stringify(introSceneRequest.output_config),
    );

    // Sanity: this isn't trivially true of two empty/undefined values.
    expect(worldEngineRequest.system).toBeDefined();
    expect(worldEngineRequest.output_config).toBeDefined();
  });

  describe('malformed requests', () => {
    it('a request body missing required fields returns structured JSON 4xx, not HTML, not a stack trace', async () => {
      const res = await httpRequest(port, {
        method: 'POST',
        path: '/api/unique-skill',
        body: JSON.stringify({ name: 'Test Character' }), // missing race, answers
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.bodyText.startsWith('<')).toBe(false); // not an HTML error page
      expect(res.bodyJson).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
      expect(res.bodyText).not.toMatch(/\n\s+at /); // no stack-trace frame lines
      expect(createSpy).not.toHaveBeenCalled(); // never reached the SDK
    });

    it('syntactically invalid JSON in the request body returns structured JSON 4xx, not HTML', async () => {
      const res = await httpRequest(port, {
        method: 'POST',
        path: '/api/unique-skill',
        body: '{ this is not valid json',
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.bodyText.startsWith('<')).toBe(false);
      expect(res.bodyJson).toBeDefined();
      // Specifically INVALID_REQUEST, not the generic `code: "ERROR"` a
      // body-parser failure produced before server.ts mapped `err.type`.
      // A frontend cannot branch on "ERROR".
      expect(res.bodyJson).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
      expect(res.status).toBe(400);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('a body over the configured JSON limit returns 413 PAYLOAD_TOO_LARGE, never reaching the SDK', async () => {
      // Comfortably past server.ts's JSON_BODY_LIMIT (512kb). The point is
      // that the limit is explicit and enforced before any route handler
      // runs — not that this particular size is special.
      const oversized = JSON.stringify({
        ...uniqueSkillRequestBody,
        padding: 'x'.repeat(700_000),
      });
      const res = await httpRequest(port, {
        method: 'POST',
        path: '/api/unique-skill',
        body: oversized,
      });

      expect(res.status).toBe(413);
      expect(res.bodyJson).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('an over-long field inside an otherwise valid body is rejected by the route schema, never reaching the SDK', async () => {
      const res = await httpRequest(port, {
        method: 'POST',
        path: '/api/unique-skill',
        body: JSON.stringify({
          ...uniqueSkillRequestBody,
          answers: { ...uniqueSkillRequestBody.answers, nature: 'y'.repeat(50_000) },
        }),
      });

      expect(res.status).toBe(400);
      expect(res.bodyJson).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('a world-engine request with no Unique-tier skill is rejected, never reaching the SDK', async () => {
      const res = await httpRequest(port, {
        method: 'POST',
        path: '/api/world-engine',
        body: JSON.stringify({
          ...worldEngineRequestBody,
          gameState: { ...worldEngineRequestBody.gameState, skills: [] },
        }),
      });

      expect(res.status).toBe(400);
      expect(res.bodyJson).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe('access gate', () => {
    it('no header returns 401 PASSPHRASE_REQUIRED and never reaches the SDK', async () => {
      const res = await httpRequest(port, {
        method: 'POST',
        path: '/api/unique-skill',
        body: JSON.stringify(uniqueSkillRequestBody),
        noAuth: true,
      });

      expect(res.status).toBe(401);
      expect(res.bodyJson).toEqual({
        error: { message: 'Passphrase required', code: 'PASSPHRASE_REQUIRED' },
      });
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('the wrong passphrase returns 401 and never reaches the SDK', async () => {
      const res = await httpRequest(port, {
        method: 'POST',
        path: '/api/unique-skill',
        body: JSON.stringify(uniqueSkillRequestBody),
        headers: { Authorization: 'Bearer definitely-not-it' },
      });

      expect(res.status).toBe(401);
      expect(res.bodyJson).toMatchObject({ error: { code: 'PASSPHRASE_REQUIRED' } });
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('GET /api/health works with no header at all', async () => {
      const res = await httpRequest(port, { method: 'GET', path: '/api/health', noAuth: true });
      expect(res.status).toBe(200);
      expect(res.bodyJson).toEqual({ status: 'ok' });
    });

    it('GET /api/access returns 204 with the correct header, 401 without one', async () => {
      const authorized = await httpRequest(port, { method: 'GET', path: '/api/access' });
      expect(authorized.status).toBe(204);

      const unauthorized = await httpRequest(port, {
        method: 'GET',
        path: '/api/access',
        noAuth: true,
      });
      expect(unauthorized.status).toBe(401);
      expect(unauthorized.bodyJson).toMatchObject({ error: { code: 'PASSPHRASE_REQUIRED' } });
    });

    it('a mixed-case /API path with no header still gets 401, not the SPA/route behind it', async () => {
      const res = await httpRequest(port, {
        method: 'POST',
        path: '/API/unique-skill',
        body: JSON.stringify(uniqueSkillRequestBody),
        noAuth: true,
      });
      expect(res.status).toBe(401);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('a 1 MB unauthenticated body gets 401, not 413 — the gate runs before express.json', async () => {
      const oversized = JSON.stringify({
        ...uniqueSkillRequestBody,
        padding: 'x'.repeat(1_000_000),
      });
      const res = await httpRequest(port, {
        method: 'POST',
        path: '/api/unique-skill',
        body: oversized,
        noAuth: true,
      });
      expect(res.status).toBe(401);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('a 1 MB body to a non-/api path with no header gets a plain 404, and never has its body parsed', async () => {
      // Independent security review finding: express.json used to be
      // mounted globally, so a non-/api path had its body parsed (up to
      // JSON_BODY_LIMIT) with no passphrase required at all, before falling
      // through to the 404. Scoping express.json to /api means a path
      // outside it never even reaches the parser — proven here the same way
      // the /api oversized-body case above proves the gate runs before
      // express.json: an oversized, unauthenticated body still gets a clean,
      // fast 404 rather than a 413 (which would mean the parser ran) or a
      // hang.
      const oversized = 'x'.repeat(1_000_000);
      const res = await httpRequest(port, {
        method: 'POST',
        path: '/x',
        body: oversized,
        noAuth: true,
      });
      expect(res.status).toBe(404);
      expect(res.bodyJson).toEqual({ error: { message: 'Not found', code: 'NOT_FOUND' } });
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('a whitespace-only Bearer token returns 401', async () => {
      const res = await httpRequest(port, {
        method: 'GET',
        path: '/api/access',
        headers: { Authorization: 'Bearer    ' },
      });
      expect(res.status).toBe(401);
    });

    it('a tab between the scheme and the token returns 401 (only a single space separates them)', async () => {
      const res = await httpRequest(port, {
        method: 'GET',
        path: '/api/access',
        headers: { Authorization: `Bearer\t${FAKE_PASSPHRASE}` },
      });
      expect(res.status).toBe(401);
    });

    it('HEAD on a gated route with no header returns 401', async () => {
      const res = await httpRequest(port, { method: 'HEAD', path: '/api/health', noAuth: true });
      // HEAD /api/health itself is exempt (ends the response before the
      // gate), so this proves the point on a route that IS gated.
      const gated = await httpRequest(port, {
        method: 'HEAD',
        path: '/api/unique-skill',
        noAuth: true,
      });
      expect(res.status).toBe(200); // sanity: health is unaffected either way
      expect(gated.status).toBe(401);
    });

    it('a trailing slash on a gated route with no header still returns 401, not a fallthrough', async () => {
      const res = await httpRequest(port, {
        method: 'POST',
        path: '/api/unique-skill/',
        body: JSON.stringify(uniqueSkillRequestBody),
        noAuth: true,
      });
      expect(res.status).toBe(401);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('Retry-After is exactly 60 at the start of a window and 1 at 59.5s in', async () => {
      let t = 10_000_000;
      const limitedApp = buildApp({ ...config, RATE_LIMIT_PER_MINUTE: 1, now: () => t });
      const { server: limitedServer, port: limitedPort } = await startServer(limitedApp);
      try {
        const first = await httpRequest(limitedPort, { method: 'GET', path: '/api/access' });
        expect(first.status).toBe(204);

        // Still within the same window, right at its start: 60s remain.
        const startOfWindow = await httpRequest(limitedPort, { method: 'GET', path: '/api/access' });
        expect(startOfWindow.status).toBe(429);
        expect(Number(startOfWindow.headers['retry-after'])).toBe(60);

        t += 59_500; // 59.5s into the 60s window: 0.5s remain, rounded up to 1.
        const nearEnd = await httpRequest(limitedPort, { method: 'GET', path: '/api/access' });
        expect(nearEnd.status).toBe(429);
        expect(Number(nearEnd.headers['retry-after'])).toBe(1);
      } finally {
        await new Promise<void>((resolve) => limitedServer.close(() => resolve()));
      }
    });

    describe('TRUST_PROXY changes the rate-limit key (spec Failure Modes: "unit test that TRUST_PROXY changes the key")', () => {
      it('with TRUST_PROXY=1, different X-Forwarded-For values get separate buckets', async () => {
        let t = 20_000_000;
        const trustingApp = buildApp({
          ...config,
          RATE_LIMIT_PER_MINUTE: 1,
          TRUST_PROXY: 1,
          now: () => t,
        });
        const { server: trustingServer, port: trustingPort } = await startServer(trustingApp);
        try {
          const a1 = await httpRequest(trustingPort, {
            method: 'GET',
            path: '/api/access',
            headers: { 'x-forwarded-for': '9.9.9.1' },
          });
          expect(a1.status).toBe(204);
          const b1 = await httpRequest(trustingPort, {
            method: 'GET',
            path: '/api/access',
            headers: { 'x-forwarded-for': '9.9.9.2' },
          });
          expect(b1.status).toBe(204); // separate bucket — not blocked by a1's request
          const a2 = await httpRequest(trustingPort, {
            method: 'GET',
            path: '/api/access',
            headers: { 'x-forwarded-for': '9.9.9.1' },
          });
          expect(a2.status).toBe(429); // a1's own bucket is now over its limit of 1
        } finally {
          await new Promise<void>((resolve) => trustingServer.close(() => resolve()));
        }
      });

      it('with TRUST_PROXY unset, different X-Forwarded-For values share one bucket (the loopback socket peer)', async () => {
        let t = 30_000_000;
        const untrustingApp = buildApp({ ...config, RATE_LIMIT_PER_MINUTE: 1, now: () => t });
        const { server: untrustingServer, port: untrustingPort } = await startServer(untrustingApp);
        try {
          const a1 = await httpRequest(untrustingPort, {
            method: 'GET',
            path: '/api/access',
            headers: { 'x-forwarded-for': '9.9.9.1' },
          });
          expect(a1.status).toBe(204);
          const b1 = await httpRequest(untrustingPort, {
            method: 'GET',
            path: '/api/access',
            headers: { 'x-forwarded-for': '9.9.9.2' },
          });
          // Same bucket as a1 (both arrive from 127.0.0.1, the real socket
          // peer, since X-Forwarded-For is untrusted) — already over the
          // limit of 1.
          expect(b1.status).toBe(429);
        } finally {
          await new Promise<void>((resolve) => untrustingServer.close(() => resolve()));
        }
      });
    });

    describe('rate-limiter map growth (independent security review)', () => {
      it('sweeps expired entries at most once per window, shrinking the tracked-key count', async () => {
        let t = 40_000_000;
        const limiter = createRateLimiter({ perMinute: 1000, now: () => t });
        const sweepApp = express();
        // Force req.ip from a test-only header rather than relying on
        // trust-proxy semantics — matches accessGate.test.ts's own approach
        // for the same reason (simplest way to get many distinct req.ip
        // values without opening 1,000 real sockets).
        sweepApp.use((req, _res, next) => {
          const forced = req.headers['x-test-ip'];
          if (typeof forced === 'string') {
            Object.defineProperty(req, 'ip', { value: forced, configurable: true });
          }
          next();
        });
        sweepApp.use(limiter);
        sweepApp.get('/probe', (_req, res) => res.status(200).json({ ok: true }));
        const { server: sweepServer, port: sweepPort } = await startServer(sweepApp);
        try {
          // 1,000 distinct IPs, each making one request.
          for (let i = 0; i < 1000; i += 1) {
            const res = await httpRequest(sweepPort, {
              method: 'GET',
              path: '/probe',
              headers: { 'x-test-ip': `10.0.${Math.floor(i / 256)}.${i % 256}` },
              noAuth: true,
            });
            expect(res.status).toBe(200);
          }
          expect(limiter.__trackedKeyCount()).toBe(1000);

          // Advance past the window and send one more request. The sweep
          // that runs at the top of that request must clear every one of
          // the 1,000 now-expired entries before adding its own.
          t += WINDOW_MS_FOR_TEST;
          const after = await httpRequest(sweepPort, {
            method: 'GET',
            path: '/probe',
            headers: { 'x-test-ip': '10.0.0.1' },
            noAuth: true,
          });
          expect(after.status).toBe(200);
          expect(limiter.__trackedKeyCount()).toBe(1); // only the one fresh entry survives
        } finally {
          await new Promise<void>((resolve) => sweepServer.close(() => resolve()));
        }
      }, 20_000);

      it('folds new keys into a shared overflow bucket once the cap is reached, rather than growing unboundedly', async () => {
        const t = 50_000_000;
        // A tiny cap (2) so this test doesn't need thousands of requests to
        // reach it. Behaviour at the real 10,000 cap is identical — only the
        // threshold differs.
        const limiter = createRateLimiter({ perMinute: 1000, now: () => t, maxTrackedKeys: 2 });
        const overflowApp = express();
        overflowApp.use((req, _res, next) => {
          const forced = req.headers['x-test-ip'];
          if (typeof forced === 'string') {
            Object.defineProperty(req, 'ip', { value: forced, configurable: true });
          }
          next();
        });
        overflowApp.use(limiter);
        overflowApp.get('/probe', (_req, res) => res.status(200).json({ ok: true }));
        const { server: overflowServer, port: overflowPort } = await startServer(overflowApp);
        try {
          await httpRequest(overflowPort, {
            method: 'GET',
            path: '/probe',
            headers: { 'x-test-ip': '1.1.1.1' },
            noAuth: true,
          });
          await httpRequest(overflowPort, {
            method: 'GET',
            path: '/probe',
            headers: { 'x-test-ip': '2.2.2.2' },
            noAuth: true,
          });
          expect(limiter.__trackedKeyCount()).toBe(2); // cap reached

          // A third, never-seen key must NOT grow the map past the cap —
          // it shares the overflow bucket instead.
          const third = await httpRequest(overflowPort, {
            method: 'GET',
            path: '/probe',
            headers: { 'x-test-ip': '3.3.3.3' },
            noAuth: true,
          });
          expect(third.status).toBe(200); // first hit on the overflow bucket, still under perMinute
          expect(limiter.__trackedKeyCount()).toBe(3); // 1.1.1.1, 2.2.2.2, and the overflow bucket itself

          // A fourth, also never-seen key shares that SAME overflow bucket
          // (not a fresh one), so the tracked-key count does not grow again —
          // this is what "shares one bucket" and "never toward bypass" mean.
          const fourth = await httpRequest(overflowPort, {
            method: 'GET',
            path: '/probe',
            headers: { 'x-test-ip': '4.4.4.4' },
            noAuth: true,
          });
          expect(fourth.status).toBe(200);
          expect(limiter.__trackedKeyCount()).toBe(3); // unchanged — no new entry
        } finally {
          await new Promise<void>((resolve) => overflowServer.close(() => resolve()));
        }
      });
    });
  });

  it('OPTIONS /api/world-engine returns 204 with no header — CORS answers preflights before the gate', async () => {
    const res = await httpRequest(port, {
      method: 'OPTIONS',
      path: '/api/world-engine',
      noAuth: true,
    });
    expect(res.status).toBe(204);
  });

  describe('rate limiter (own app, own clock, low limit — never shares the 600/min harness bucket)', () => {
    it('a burst past the limit gets 429 before the gate, and wrong-passphrase attempts count too', async () => {
      let t = 5_000_000;
      const limitedApp = buildApp({ ...config, RATE_LIMIT_PER_MINUTE: 3, now: () => t });
      const { server: limitedServer, port: limitedPort } = await startServer(limitedApp);
      try {
        // Two wrong-passphrase attempts and one correct one all count.
        const first = await httpRequest(limitedPort, {
          method: 'GET',
          path: '/api/access',
          headers: { Authorization: 'Bearer wrong-one' },
        });
        expect(first.status).toBe(401);

        const second = await httpRequest(limitedPort, {
          method: 'GET',
          path: '/api/access',
          headers: { Authorization: 'Bearer wrong-two' },
        });
        expect(second.status).toBe(401);

        const third = await httpRequest(limitedPort, { method: 'GET', path: '/api/access' });
        expect(third.status).toBe(204);

        // Fourth request in the same window, regardless of credentials —
        // the limiter runs BEFORE the gate.
        const fourth = await httpRequest(limitedPort, { method: 'GET', path: '/api/access' });
        expect(fourth.status).toBe(429);
        expect(fourth.bodyJson).toMatchObject({ error: { code: 'TOO_MANY_REQUESTS' } });
        expect(fourth.headers['retry-after']).toBeDefined();
      } finally {
        await new Promise<void>((resolve) => limitedServer.close(() => resolve()));
      }
    });
  });

  describe('Host allow-list (DNS rebinding)', () => {
    // Binding to loopback is not a boundary on its own: a page on the public
    // internet can resolve a hostname it controls to 127.0.0.1 and have the
    // victim's own browser POST here, spending the configured API key. The
    // browser sends its own hostname in `Host`, which is the only part of
    // such a request this server can reject BEFORE the money is spent — CORS
    // headers are read only after the response.
    it('rejects a rebound Host with 403 FORBIDDEN before the route (and before the SDK) runs', async () => {
      const res = await httpRequest(port, {
        method: 'POST',
        path: '/api/unique-skill',
        body: JSON.stringify(uniqueSkillRequestBody),
        headers: { host: 'evil.example' },
      });

      expect(res.status).toBe(403);
      expect(res.bodyJson).toEqual({ error: { message: 'Forbidden', code: 'FORBIDDEN' } });
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('rejects a rebound Host that merely carries the right port', async () => {
      const res = await httpRequest(port, {
        method: 'POST',
        path: '/api/unique-skill',
        body: JSON.stringify(uniqueSkillRequestBody),
        headers: { host: `evil.example:${port}` },
      });

      expect(res.status).toBe(403);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('rejects a rebound Host on a GET to the health check too (the guard is not route-specific)', async () => {
      const blocked = await httpRequest(port, {
        method: 'GET',
        path: '/api/health',
        headers: { host: 'evil.example' },
      });
      expect(blocked.status).toBe(403);

      const allowed = await httpRequest(port, { method: 'GET', path: '/api/health' });
      expect(allowed.status).toBe(200);
      expect(allowed.bodyJson).toEqual({ status: 'ok' });
    });

    it('runs BEFORE the CORS middleware — a rejected Host gets no Access-Control-Allow-Origin header', async () => {
      const res = await httpRequest(port, {
        method: 'GET',
        path: '/api/health',
        headers: { host: 'evil.example' },
      });

      expect(res.status).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('TRUST_PROXY does not change Host handling — a rebound Host still gets 403 with TRUST_PROXY=1', async () => {
      const trustingApp = buildApp({ ...config, RATE_LIMIT_PER_MINUTE: 600, TRUST_PROXY: 1 });
      const { server: trustingServer, port: trustingPort } = await startServer(trustingApp);
      try {
        const res = await httpRequest(trustingPort, {
          method: 'GET',
          path: '/api/health',
          headers: { host: 'evil.example', 'x-forwarded-for': '1.2.3.4' },
          noAuth: true,
        });
        expect(res.status).toBe(403);
      } finally {
        await new Promise<void>((resolve) => trustingServer.close(() => resolve()));
      }
    });
  });

  describe('error handler', () => {
    it('a 500 returns a fixed generic message — never the stack, never the underlying detail', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        // A plain Error maps to UPSTREAM_ERROR/500 in anthropic.ts, which is
        // the branch where the handler must substitute a generic message.
        createSpy.mockRejectedValueOnce(new Error('BOOM-SECRET-UPSTREAM-DETAIL'));
        const res = await httpRequest(port, {
          method: 'POST',
          path: '/api/unique-skill',
          body: JSON.stringify(uniqueSkillRequestBody),
        });

        expect(res.status).toBe(500);
        expect(res.bodyJson).toEqual({
          error: { message: 'Internal server error', code: 'UPSTREAM_ERROR' },
        });
        expect(res.bodyText).not.toMatch(/\n\s+at /); // no V8 stack frames
        expect(res.bodyText).not.toContain('BOOM-SECRET-UPSTREAM-DETAIL');
        expect(res.bodyText).not.toContain('server.ts');
        expect(res.bodyText).not.toContain(FAKE_KEY);
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it('logs the failure server-side (redacted) even though the client sees none of it', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        createSpy.mockRejectedValueOnce(new Error(`upstream echoed the key: ${FAKE_KEY}`));
        await httpRequest(port, {
          method: 'POST',
          path: '/api/unique-skill',
          body: JSON.stringify(uniqueSkillRequestBody),
        });

        const logged = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
        expect(logged).toContain('[error] POST /api/unique-skill');
        expect(logged).not.toContain(FAKE_KEY);
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it('a thrown error echoing the passphrase is redacted from both the log and the response body', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        createSpy.mockRejectedValueOnce(
          new Error(`upstream echoed something: ${FAKE_PASSPHRASE}`),
        );
        const res = await httpRequest(port, {
          method: 'POST',
          path: '/api/unique-skill',
          body: JSON.stringify(uniqueSkillRequestBody),
        });

        const logged = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
        expect(logged).not.toContain(FAKE_PASSPHRASE);
        expect(res.bodyText).not.toContain(FAKE_PASSPHRASE);
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });
  });

  it('a mocked SDK error returns the mapped structured code, not a 500 dump', async () => {
    createSpy.mockRejectedValueOnce(
      new AuthenticationError(
        401,
        { type: 'authentication_error', message: 'invalid x-api-key' },
        'invalid x-api-key',
        undefined,
        'authentication_error',
      ),
    );
    const res = await httpRequest(port, {
      method: 'POST',
      path: '/api/unique-skill',
      body: JSON.stringify(uniqueSkillRequestBody),
    });

    expect(res.status).toBe(401);
    expect(res.bodyJson).toMatchObject({ error: { code: 'AUTHENTICATION_FAILED' } });
    expect(res.bodyText.startsWith('<')).toBe(false);
    expect(res.bodyText).not.toMatch(/\n\s+at /);
  });

  it('a mocked response that violates the schema fails loudly (502, INVALID_RESPONSE_SHAPE), never passed through', async () => {
    createSpy.mockResolvedValueOnce(makeMessage('claude-sonnet-5', { totally_wrong_shape: true }));
    const res = await httpRequest(port, {
      method: 'POST',
      path: '/api/unique-skill',
      body: JSON.stringify(uniqueSkillRequestBody),
    });

    expect(res.status).toBe(502);
    expect(res.bodyJson).toMatchObject({ error: { code: 'INVALID_RESPONSE_SHAPE' } });
    // Specifically NOT the malformed payload passed through as if valid.
    expect(res.bodyJson).not.toMatchObject({ totally_wrong_shape: true });
  });

  describe('model-string guard', () => {
    // No route file may hardcode a model ID literal — every call must read
    // from `MODELS` (config.ts), which is R6's single source of truth
    // (already delivered in Phase 1; this only guards routes consuming it).
    const routesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'routes');
    const routeFiles = ['uniqueSkill.ts', 'worldEngine.ts', 'introScene.ts'];

    it.each(routeFiles)('%s reads its model from MODELS, never a hardcoded literal', (file) => {
      const source = readFileSync(path.join(routesDir, file), 'utf8');
      expect(source).not.toContain("'claude-sonnet-5'");
      expect(source).not.toContain("'claude-opus-5'");
      expect(source).not.toContain('"claude-sonnet-5"');
      expect(source).not.toContain('"claude-opus-5"');
      expect(source).toMatch(/MODELS\.\w+/);
    });
  });
});

// ─── buildApp middleware that no test previously executed ────────────────────
// Both cases below survived a cycle-3 mutation sweep: hardcoding the CORS
// origin to '*' (or adding Allow-Credentials alongside it), and deleting the
// JSON 404 handler outright, each left the suite fully green. config.test.ts
// proves FRONTEND_ORIGIN='*' is rejected at config load, but that guards the
// INPUT — nothing asserted what the middleware actually emits, which is the
// same shape of gap as this phase's original blocker, narrowed to one header.

describe('buildApp middleware', () => {
  it('echoes the configured FRONTEND_ORIGIN and never a wildcard or credentials', async () => {
    const app = buildApp({ ...config, FRONTEND_ORIGIN: 'http://example.test' });
    const { server, port } = await startServer(app);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://example.test');
      // A wildcard here would make the unauthenticated, paid backend callable
      // AND readable by any website that the operator happens to visit.
      expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
      // Wildcard + credentials is the classic credentialed-CORS hole.
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    } finally {
      server.close();
    }
  });

  it('answers an unmatched route with JSON, not Express\'s default HTML error page', async () => {
    const app = buildTestApp();
    const { server, port } = await startServer(app);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/nope`, {
        method: 'POST',
        headers: AUTH_HEADERS,
      });
      expect(res.status).toBe(404);
      // The point of the handler: a JSON client must be able to parse the body.
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
      await expect(res.json()).resolves.toEqual({
        error: { message: 'Not found', code: 'NOT_FOUND' },
      });
    } finally {
      server.close();
    }
  });
});
