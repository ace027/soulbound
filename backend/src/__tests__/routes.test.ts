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
import type express from 'express';
import Anthropic, { AuthenticationError } from '@anthropic-ai/sdk';
import type { Message } from '@anthropic-ai/sdk/resources/messages';

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

/** The real pipeline from server.ts — see file header. */
function buildTestApp() {
  return buildApp(config);
}

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

/** Drives the test server over loopback with node:http — see file header for why not fetch. */
function httpRequest(
  port: number,
  options: { method: string; path: string; body?: string; headers?: Record<string, string> },
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
      const res = await fetch(`http://127.0.0.1:${port}/api/nope`, { method: 'POST' });
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
