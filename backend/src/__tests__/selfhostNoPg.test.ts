/**
 * Self-host never loads a hosted dependency (spec: Compatibility Constraints →
 * "Selfhost never opens a DB connection"; 06-CONTEXT guard table).
 *
 * Every hosted package is `vi.doMock`ed to THROW on import. Then the real
 * self-host path runs: config.ts, server.ts, `buildApp`, `/api/health`, and
 * the error tracker's self-host init. Had anything on that path imported a
 * hosted package — statically or dynamically — it would have hit the throwing
 * factory and failed here.
 *
 * `vi.doMock('better-auth')` does NOT intercept `better-auth/node` and the
 * other subpaths: each one needs its own entry. The last test below scans
 * src/ for every hosted-package specifier the code imports and fails if one
 * is missing from HOSTED_MODULES, so a new subpath can't slip past this file.
 */
import { readFileSync, readdirSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const HOSTED_PACKAGES = ['pg', 'pg-pool', 'better-auth', 'node-pg-migrate', '@sentry/node', '@sentry/core'];

/** Every specifier mocked to throw. Extend when the code imports a new subpath. */
const HOSTED_MODULES = [
  'pg',
  'pg-pool',
  'better-auth',
  'better-auth/api',
  'better-auth/node',
  'better-auth/plugins',
  'better-auth/plugins/magic-link',
  'better-auth/social-providers',
  'better-auth/crypto',
  'better-auth/cookies',
  'better-auth/db',
  'better-auth/adapters',
  'node-pg-migrate',
  'node-pg-migrate/migration',
  '@sentry/node',
  '@sentry/core',
];

const FAKE_KEY = 'sk-ant-test-fake-key-selfhost-no-pg-not-real';
const FAKE_PASSPHRASE = 'test-passphrase-selfhost-no-pg-not-real';

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

function get(port: number, urlPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      })
      .on('error', reject);
  });
}

describe('self-host loads no hosted dependency', () => {
  beforeAll(() => {
    vi.resetModules();
    for (const specifier of HOSTED_MODULES) {
      vi.doMock(specifier, () => {
        throw new Error(`${specifier} imported in selfhost`);
      });
    }
    process.env.ANTHROPIC_API_KEY = FAKE_KEY; // config.ts deletes it on read
    process.env.SOULBOUND_PASSPHRASE = FAKE_PASSPHRASE; // likewise
    process.env.ALLOWED_HOSTS = '127.0.0.1';
  });

  it('the mocks are live: importing any hosted module throws', async () => {
    for (const specifier of HOSTED_MODULES) {
      const err = await import(/* @vite-ignore */ specifier).then(
        () => undefined,
        (e: unknown) => e as Error & { cause?: Error },
      );
      // Vitest wraps a throwing factory; our own message is the cause.
      expect(err?.cause?.message, specifier).toBe(`${specifier} imported in selfhost`);
    }
  });

  it('config.ts + server.ts: buildApp(selfhost) serves /api/health 200', async () => {
    const config = await import('../config.js');
    expect(config.MODE).toBe('selfhost');
    const { buildApp } = await import('../server.js');
    const app = buildApp(config);
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    try {
      const { port } = server.address() as AddressInfo;
      expect(await get(port, '/api/health')).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('server.ts with its hosted branch present: the selfhost gate and routes still answer, loading nothing hosted', async () => {
    const config = await import('../config.js');
    const { buildApp, buildHostedDeps } = await import('../server.js');
    // The hosted builder is there (06-04), but self-host never calls it.
    expect(typeof buildHostedDeps).toBe('function');
    const app = buildApp(config);
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const send = (method: string, urlPath: string, headers: Record<string, string> = {}) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, method, path: urlPath, headers }, (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on('error', reject);
        req.end();
      });
    try {
      // The passphrase gate, not the session gate.
      const noPass = await send('GET', '/api/access');
      expect(noPass.status).toBe(401);
      expect(noPass.body).toContain('PASSPHRASE_REQUIRED');
      expect((await send('GET', '/api/access', { authorization: `Bearer ${FAKE_PASSPHRASE}` })).status).toBe(204);
      // Hosted-only paths are ordinary gated /api paths here: no webhook slot,
      // no redeem, no auth mount, and no Origin check (a POST without Origin
      // gets the passphrase 401, not 403).
      for (const urlPath of ['/api/billing/webhook', '/api/invites/redeem', '/api/auth/sign-in/magic-link']) {
        const res = await send('POST', urlPath);
        expect(res.status, urlPath).toBe(401);
        expect(res.body, urlPath).toContain('PASSPHRASE_REQUIRED');
      }
      const authed = { authorization: `Bearer ${FAKE_PASSPHRASE}` };
      for (const urlPath of ['/api/billing/webhook', '/api/invites/redeem', '/api/auth/sign-in/magic-link']) {
        expect((await send('POST', urlPath, authed)).status, urlPath).toBe(404);
      }
      expect((await send('DELETE', '/api/account', authed)).status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('the error tracker stays off in selfhost without loading its SDK', async () => {
    const { initErrorTracker } = await import('../errorTracker.js');
    await expect(initErrorTracker({ dsn: undefined, mode: 'selfhost' })).resolves.toBeUndefined();
  });

  it('db.ts and migrate.ts load without their drivers (imports are lazy)', async () => {
    const db = await import('../db.js');
    const migrate = await import('../migrate.js');
    expect(typeof db.createPool).toBe('function');
    expect(typeof migrate.runMigrations).toBe('function');
    // ...and the driver is only reached when a hosted path actually calls in.
    // (Vitest's "error when mocking a module" wrapper: the throwing pg mock fired.)
    await expect(db.createPool('postgres://fake@127.0.0.1:1/none')).rejects.toThrow(
      /error when mocking a module/,
    );
  });

  it('every hosted-package specifier imported under src/ is mocked above', () => {
    const specifiers = new Set<string>();
    const pattern = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;
    for (const file of sourceFiles(SRC_DIR)) {
      for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
        const spec = match[1]!;
        if (HOSTED_PACKAGES.some((pkg) => spec === pkg || spec.startsWith(`${pkg}/`))) {
          specifiers.add(spec);
        }
      }
    }
    // The scan must be finding something, or it proves nothing.
    expect(specifiers.has('pg')).toBe(true);
    expect(specifiers.has('@sentry/node')).toBe(true);
    const unmocked = [...specifiers].filter((spec) => !HOSTED_MODULES.includes(spec));
    expect(unmocked).toEqual([]);
  });
});
