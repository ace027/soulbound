/**
 * End-to-end route tests for the three World Voice routes, through a real
 * Express pipeline, with the Anthropic SDK mocked at the same boundary as
 * `anthropic.test.ts` — `Anthropic.Messages.prototype.create`. Route
 * handlers and `callWorldVoice` are never mocked; only the network-facing
 * SDK method is.
 *
 * The test app below is NOT `server.ts` imported directly: `server.ts`'s
 * `main()` runs at module load (`main();` at the file's end) and calls
 * `process.exit(1)` on a startup failure, which would kill the test worker
 * rather than fail a test. Instead this file builds the same pipeline
 * `main()` builds — `express.json()`, the three real route routers, the
 * JSON 404 handler, and the same sanitizing error handler shape — directly
 * from the real router modules, so the routes under test are exactly the
 * ones `server.ts` mounts.
 *
 * The app is driven over the loopback interface with Node's built-in
 * `node:http`, never with `fetch` — `fetch` is reserved in this file as a
 * network tripwire (see the `beforeAll`/`afterAll` at the bottom of the
 * imports): the installed SDK's own shim (`internal/shims.js`,
 * `getDefaultFetch`) resolves to `globalThis.fetch` when none is passed to
 * the `Anthropic` client, so if any code path here ever bypassed the
 * `create()` mock and reached the real SDK network call, this spy would
 * throw before any actual request left the process.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from 'express';
import Anthropic, { AuthenticationError } from '@anthropic-ai/sdk';
import type { Message } from '@anthropic-ai/sdk/resources/messages';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import introSceneRouter from '../routes/introScene.js';
import uniqueSkillRouter from '../routes/uniqueSkill.js';
import worldEngineRouter from '../routes/worldEngine.js';

// Fake key, set before anything in this file lazily imports config.js (both
// the routes themselves and, below, this file's own error handler). Never
// valid, never sent anywhere — every `create` call is intercepted by the
// spy before it would reach `fetch`. See anthropic.test.ts's identical note.
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-fake-key-never-sent-mocked-only';
const { redact } = await import('../config.js');

interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

/**
 * Mirrors server.ts's pipeline (json body parsing, the three real routers,
 * JSON 404, sanitizing error handler) — see file header for why this can't
 * just be `import` of server.ts itself.
 */
function buildTestApp() {
  const app = express();
  app.use(express.json());

  app.use(uniqueSkillRouter);
  app.use(worldEngineRouter);
  app.use(introSceneRouter);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { message: 'Not found', code: 'NOT_FOUND' } });
  });

  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    const apiErr = err as ApiError;
    const statusCode = apiErr.statusCode ?? 500;
    const code = apiErr.code ?? (statusCode === 500 ? 'INTERNAL_ERROR' : 'ERROR');
    const rawMessage = err instanceof Error ? err.message : String(err);
    const clientMessage = statusCode === 500 ? 'Internal server error' : redact(rawMessage);
    res.status(statusCode).json({ error: { message: clientMessage, code } });
  };
  app.use(errorHandler);

  return app;
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
  options: { method: string; path: string; body?: string },
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

const worldEngineRequestBody = {
  action: 'look around the square',
  gameState: {
    character: { name: 'Test Character', race: { name: 'Human' } },
    skills: [],
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
    it('calls claude-sonnet-5 with the unique-skill schema and no system key', async () => {
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
      expect(request.model).toBe('claude-sonnet-5');
      expect('system' in request).toBe(false);

      const schema = (request.output_config as Record<string, unknown>).format as Record<string, unknown>;
      const properties = Object.keys((schema.schema as Record<string, unknown>).properties as object);
      expect(properties.sort()).toEqual(
        ['skill_name', 'tier', 'description', 'soul_resonance', 'etching_text'].sort(),
      );
    });
  });

  describe('POST /api/world-engine', () => {
    it('calls claude-opus-5 with the World Voice schema and system blocks present', async () => {
      createSpy.mockResolvedValueOnce(makeMessage('claude-opus-5', validWorldVoicePayload));
      const res = await httpRequest(port, {
        method: 'POST',
        path: '/api/world-engine',
        body: JSON.stringify(worldEngineRequestBody),
      });

      expect(res.status).toBe(200);
      expect(res.bodyJson).toEqual(validWorldVoicePayload);

      const request = createSpy.mock.calls[0]![0] as Record<string, unknown>;
      expect(request.model).toBe('claude-opus-5');
      expect('system' in request).toBe(true);
      expect(Array.isArray(request.system)).toBe(true);
      expect((request.system as unknown[]).length).toBe(2);

      const schema = (request.output_config as Record<string, unknown>).format as Record<string, unknown>;
      const properties = Object.keys((schema.schema as Record<string, unknown>).properties as object);
      expect(properties.sort()).toEqual(
        ['narration', 'state_updates', 'narrative_memory_updates', 'gm_note'].sort(),
      );
    });
  });

  describe('POST /api/intro-scene', () => {
    it('calls claude-opus-5 with the World Voice schema and system blocks present', async () => {
      createSpy.mockResolvedValueOnce(makeMessage('claude-opus-5', validWorldVoicePayload));
      const res = await httpRequest(port, {
        method: 'POST',
        path: '/api/intro-scene',
        body: JSON.stringify(introSceneRequestBody),
      });

      expect(res.status).toBe(200);
      expect(res.bodyJson).toEqual(validWorldVoicePayload);

      const request = createSpy.mock.calls[0]![0] as Record<string, unknown>;
      expect(request.model).toBe('claude-opus-5');
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
      expect((res.bodyJson as { error: { code: string } }).error.code).toBeTruthy();
      expect(createSpy).not.toHaveBeenCalled();
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
