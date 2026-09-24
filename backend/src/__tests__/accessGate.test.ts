/**
 * Unit tests for the two access-gate middlewares in isolation — a fresh
 * Express app per test, an injected clock for the limiter, and no real
 * network I/O. The real-pipeline wiring (mount order, `express.json`
 * position, the `/api/access` route) is covered separately in
 * `routes.test.ts`, which drives `buildApp()` itself.
 */

import express from 'express';
import type { Express } from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccessGate, createRateLimiter } from '../accessGate.js';

function startServer(app: Express): Promise<{ server: http.Server; port: number }> {
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
  bodyJson: unknown;
}

function httpRequest(
  port: number,
  options: { method?: string; path: string; headers?: Record<string, string> },
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: options.method ?? 'GET',
        path: options.path,
        headers: options.headers ?? {},
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
          resolve({ status: res.statusCode ?? 0, headers: res.headers, bodyJson });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('createRateLimiter', () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  function buildLimiterApp(perMinute: number, now: () => number): Express {
    const app = express();
    app.use(createRateLimiter({ perMinute, now }));
    app.get('/probe', (_req, res) => res.status(200).json({ ok: true }));
    return app;
  }

  it('allows exactly perMinute requests, then returns 429 with an integer Retry-After on the next one', async () => {
    let t = 1_000_000;
    const app = buildLimiterApp(3, () => t);
    ({ server } = await startServer(app));
    const port = (server!.address() as AddressInfo).port;

    for (let i = 0; i < 3; i += 1) {
      const res = await httpRequest(port, { path: '/probe' });
      expect(res.status).toBe(200);
    }

    const blocked = await httpRequest(port, { path: '/probe' });
    expect(blocked.status).toBe(429);
    expect(blocked.bodyJson).toEqual({
      error: { message: 'Too many requests — try again shortly', code: 'TOO_MANY_REQUESTS' },
    });
    const retryAfter = blocked.headers['retry-after'];
    expect(retryAfter).toBeDefined();
    expect(Number.isInteger(Number(retryAfter))).toBe(true);
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
  });

  it('resets the window after 60 seconds', async () => {
    let t = 1_000_000;
    const app = buildLimiterApp(1, () => t);
    ({ server } = await startServer(app));
    const port = (server!.address() as AddressInfo).port;

    const first = await httpRequest(port, { path: '/probe' });
    expect(first.status).toBe(200);

    const stillBlocked = await httpRequest(port, { path: '/probe' });
    expect(stillBlocked.status).toBe(429);

    t += 60_000; // exactly one window later
    const afterReset = await httpRequest(port, { path: '/probe' });
    expect(afterReset.status).toBe(200);
  });

  it('gives separate IPs separate buckets', async () => {
    const t = 1_000_000;
    // Fake distinct client IPs without needing two real sockets: override
    // req.ip from a header before the limiter runs.
    const app = express();
    app.use((req, _res, next) => {
      const forced = req.headers['x-test-ip'];
      if (typeof forced === 'string') {
        Object.defineProperty(req, 'ip', { value: forced, configurable: true });
      }
      next();
    });
    app.use(createRateLimiter({ perMinute: 1, now: () => t }));
    app.get('/probe', (_req, res) => res.status(200).json({ ok: true }));

    ({ server } = await startServer(app));
    const port = (server!.address() as AddressInfo).port;

    const a1 = await httpRequest(port, { path: '/probe', headers: { 'x-test-ip': '1.1.1.1' } });
    expect(a1.status).toBe(200);
    const b1 = await httpRequest(port, { path: '/probe', headers: { 'x-test-ip': '2.2.2.2' } });
    expect(b1.status).toBe(200);
    const a2 = await httpRequest(port, { path: '/probe', headers: { 'x-test-ip': '1.1.1.1' } });
    expect(a2.status).toBe(429);
  });

  it('an undefined req.ip goes to the "unknown" shared bucket', async () => {
    const t = 1_000_000;
    const app = express();
    app.set('trust proxy', false);
    app.use((req, _res, next) => {
      Object.defineProperty(req, 'ip', { value: undefined, configurable: true });
      next();
    });
    app.use(createRateLimiter({ perMinute: 1, now: () => t }));
    app.get('/probe', (_req, res) => res.status(200).json({ ok: true }));

    ({ server } = await startServer(app));
    const port = (server!.address() as AddressInfo).port;

    const first = await httpRequest(port, { path: '/probe' });
    expect(first.status).toBe(200);
    const second = await httpRequest(port, { path: '/probe' });
    expect(second.status).toBe(429);
  });
});

describe('createAccessGate', () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  const REAL_PASSPHRASE = 'the-real-passphrase';

  function buildGateApp(): Express {
    const app = express();
    app.use(createAccessGate((candidate) => candidate === REAL_PASSPHRASE));
    app.get('/protected', (_req, res) => res.status(200).json({ ok: true }));
    return app;
  }

  async function request(headers?: Record<string, string>) {
    ({ server } = await startServer(buildGateApp()));
    const port = (server!.address() as AddressInfo).port;
    return httpRequest(port, { path: '/protected', headers });
  }

  it('missing header returns 401 with the correct code and WWW-Authenticate', async () => {
    const res = await request();
    expect(res.status).toBe(401);
    expect(res.bodyJson).toEqual({
      error: { message: 'Passphrase required', code: 'PASSPHRASE_REQUIRED' },
    });
    expect(res.headers['www-authenticate']).toBe('Bearer realm="soulbound"');
  });

  it('wrong scheme returns 401', async () => {
    const res = await request({ Authorization: `Basic ${REAL_PASSPHRASE}` });
    expect(res.status).toBe(401);
  });

  it('wrong token returns 401', async () => {
    const res = await request({ Authorization: 'Bearer nope' });
    expect(res.status).toBe(401);
  });

  it('empty token returns 401', async () => {
    const res = await request({ Authorization: 'Bearer ' });
    expect(res.status).toBe(401);
  });

  it('the correct token calls next() and reaches the route', async () => {
    const res = await request({ Authorization: `Bearer ${REAL_PASSPHRASE}` });
    expect(res.status).toBe(200);
    expect(res.bodyJson).toEqual({ ok: true });
  });

  it('the scheme comparison is case-insensitive', async () => {
    const res = await request({ Authorization: `bearer ${REAL_PASSPHRASE}` });
    expect(res.status).toBe(200);
  });
});
