/**
 * Self-host responses carry none of hosted mode's headers (spec R24e, the
 * 06-CONTEXT addendum, Revision History row 21; plan 06-04): no
 * `X-Frame-Options`, no `frame-ancestors`, no `Referrer-Policy` and no
 * `Soulbound-Mode`, on the API, on a static file and on a 404. The hosted
 * side of each is asserted in hosted/hostedOrder.test.ts.
 *
 * Uses a self-host `buildApp` config (no `hosted`), exactly as config.ts
 * produces it.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MODE_HEADER } from '@soulbound/shared';

const FAKE_KEY = 'sk-ant-test-fake-key-selfhost-headers-not-real';
const FAKE_PASSPHRASE = 'test-passphrase-selfhost-headers-not-real';

function get(port: number, urlPath: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: urlPath, headers }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      })
      .on('error', reject);
  });
}

describe('self-host sends no hosted-only headers', () => {
  let server: http.Server;
  let port: number;
  let staticDir: string;

  beforeAll(async () => {
    process.env.ANTHROPIC_API_KEY = FAKE_KEY; // config.ts deletes both on read
    process.env.SOULBOUND_PASSPHRASE = FAKE_PASSPHRASE;
    process.env.ALLOWED_HOSTS = '127.0.0.1';
    staticDir = mkdtempSync(path.join(tmpdir(), 'sb-selfhost-static-'));
    writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>sb</title>');
    const config = await import('../config.js');
    expect(config.MODE).toBe('selfhost');
    const { buildApp } = await import('../server.js');
    server = buildApp({ ...config, STATIC_DIR: staticDir }).listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(staticDir, { recursive: true, force: true });
  });

  const cases: [string, string, Record<string, string>, number][] = [
    ['/api/health', '/api/health', {}, 200],
    ['/api/access without a passphrase (401)', '/api/access', {}, 401],
    ['/api/access with the passphrase (204)', '/api/access', { authorization: `Bearer ${FAKE_PASSPHRASE}` }, 204],
    ['a static file', '/', {}, 200],
    ['a static 404', '/missing-chunk.js', {}, 404],
  ];

  for (const [name, urlPath, headers, status] of cases) {
    it(name, async () => {
      const res = await get(port, urlPath, headers);
      expect(res.status).toBe(status);
      expect(res.headers['x-frame-options']).toBeUndefined();
      expect(res.headers['content-security-policy'] ?? '').not.toContain('frame-ancestors');
      expect(res.headers['referrer-policy']).toBeUndefined();
      expect(res.headers[MODE_HEADER.toLowerCase()]).toBeUndefined();
    });
  }
});
