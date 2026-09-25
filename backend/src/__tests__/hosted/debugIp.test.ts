/**
 * `GET /api/debug/ip` (plan 06-07, critique revision 2): the proxy-hop probe
 * for runbook step 5. It exists only when `hosted.debugProxyHops` is set
 * (`main()` sets it from `DEBUG_PROXY_HOPS=1`), echoes only the caller's own
 * `req.ip`, `req.ips` and X-Forwarded-For entry count, and logs nothing.
 * Absent otherwise: behind the session gate without the flag, and never in
 * self-host.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PASSPHRASE_REQUIRED, SIGN_IN_REQUIRED } from '@soulbound/shared';
import { buildApp, DEBUG_IP_PATH, type AppConfig } from '../../server.js';
import { PUBLIC_URL, startHostedApp, type HostedApp } from '../helpers/hostedApp.js';
import { withTestDb } from '../helpers/withTestDb.js';

const db = withTestDb();

interface Probe {
  status: number;
  headers: http.IncomingHttpHeaders;
  json: unknown;
}

function get(port: number, path: string, headers: Record<string, string> = {}): Promise<Probe> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method: 'GET', path, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (data += chunk));
      res.on('end', () => {
        clearTimeout(timer);
        let json: unknown;
        try {
          json = JSON.parse(data);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, json });
      });
    });
    const timer = setTimeout(() => req.destroy(new Error(`GET ${path} timed out`)), 2000);
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end();
  });
}

function baseConfig(trustProxy: AppConfig['TRUST_PROXY']): Omit<AppConfig, 'hosted'> {
  return {
    FRONTEND_ORIGIN: PUBLIC_URL,
    ALLOWED_HOSTS: ['127.0.0.1'],
    redact: (input) => input,
    checkPassphrase: (candidate) => candidate === 'correct horse battery staple',
    RATE_LIMIT_PER_MINUTE: 600,
    TRUST_PROXY: trustProxy,
  };
}

async function listen(config: AppConfig): Promise<{ port: number; close: () => Promise<void> }> {
  const server = buildApp(config).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return { port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const errorCode = (p: Probe): unknown => (p.json as { error?: { code?: unknown } } | undefined)?.error?.code;

describe('GET /api/debug/ip (runbook step 5)', () => {
  let h: HostedApp;

  beforeAll(async () => {
    // startHostedApp never sets debugProxyHops: the production default.
    h = await startHostedApp(db);
  });
  afterAll(async () => {
    await h.close();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is the path the runbook uses', () => {
    expect(DEBUG_IP_PATH).toBe('/api/debug/ip');
  });

  it('without the flag, it does not exist: 401 signed out, 404 signed in', async () => {
    const signedOut = await h.request({ method: 'GET', path: DEBUG_IP_PATH });
    expect(signedOut.status).toBe(401);
    expect((signedOut.json as { error: { code: string } }).error.code).toBe(SIGN_IN_REQUIRED);

    const { cookie } = await h.signIn();
    const signedIn = await h.request({ method: 'GET', path: DEBUG_IP_PATH, headers: { cookie } });
    expect(signedIn.status).toBe(404);
    expect((signedIn.json as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    expect(signedIn.body).not.toContain('xffHops');
  });

  it('with the flag and TRUST_PROXY=1: answers the client entry, the hop count, and nothing else', async () => {
    const app = await listen({ ...baseConfig(1), hosted: { ...h.deps, debugProxyHops: true } });
    try {
      const res = await get(app.port, DEBUG_IP_PATH, { 'x-forwarded-for': '203.0.113.9' });
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ ip: '203.0.113.9', ips: ['203.0.113.9'], xffHops: 1 });
      expect(res.headers['cache-control']).toBe('no-store');
      // Still a hosted response: step 3's headers apply.
      expect(res.headers['x-frame-options']).toBe('DENY');
    } finally {
      await app.close();
    }
  });

  it('with the flag, the hop count is the number of entries that arrived, and TRUST_PROXY picks the entry', async () => {
    const two = '198.51.100.7, 203.0.113.9';
    for (const [trust, ip] of [
      [1, '203.0.113.9'],
      [2, '198.51.100.7'],
    ] as const) {
      const app = await listen({ ...baseConfig(trust), hosted: { ...h.deps, debugProxyHops: true } });
      try {
        const res = await get(app.port, DEBUG_IP_PATH, { 'x-forwarded-for': two });
        expect(res.json).toMatchObject({ ip, xffHops: 2 });
      } finally {
        await app.close();
      }
    }
  });

  it('with the flag and no X-Forwarded-For: hop count 0, and TRUST_PROXY=false ignores a spoofed header', async () => {
    const app = await listen({ ...baseConfig(false), hosted: { ...h.deps, debugProxyHops: true } });
    try {
      const plain = await get(app.port, DEBUG_IP_PATH);
      expect(plain.json).toMatchObject({ ips: [], xffHops: 0 });
      const spoofed = await get(app.port, DEBUG_IP_PATH, { 'x-forwarded-for': '203.0.113.9' });
      const body = spoofed.json as { ip: string; ips: string[]; xffHops: number };
      expect(body.ip).not.toBe('203.0.113.9');
      expect(body.ip).toMatch(/127\.0\.0\.1$/);
      expect(body.xffHops).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('with the flag, a request logs nothing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const app = await listen({ ...baseConfig(1), hosted: { ...h.deps, debugProxyHops: true } });
    try {
      const res = await get(app.port, DEBUG_IP_PATH, { 'x-forwarded-for': '203.0.113.9' });
      expect(res.status).toBe(200);
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('with the flag, it is behind the per-IP limiter (step 6)', async () => {
    const app = await listen({
      ...baseConfig(false),
      RATE_LIMIT_PER_MINUTE: 2,
      hosted: { ...h.deps, debugProxyHops: true },
    });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 3; i += 1) statuses.push((await get(app.port, DEBUG_IP_PATH)).status);
      expect(statuses).toEqual([200, 200, 429]);
    } finally {
      await app.close();
    }
  });

  it('self-host never has it: 401 PASSPHRASE_REQUIRED without the passphrase, 404 with it', async () => {
    const app = await listen(baseConfig(false));
    try {
      const without = await get(app.port, DEBUG_IP_PATH);
      expect(without.status).toBe(401);
      expect(errorCode(without)).toBe(PASSPHRASE_REQUIRED);
      const withIt = await get(app.port, DEBUG_IP_PATH, { authorization: 'Bearer correct horse battery staple' });
      expect(withIt.status).toBe(404);
      expect(errorCode(withIt)).toBe('NOT_FOUND');
    } finally {
      await app.close();
    }
  });
});
