/**
 * The hosted middleware order (spec "Hosted middleware order", R24b, R24e,
 * R24f; plan 06-04 and its critique block), through the production
 * `buildHostedDeps()` + `buildApp()` on real Postgres. Each describe pins one
 * or more positions of the 15 steps, so moving a step turns something here
 * red; scripts/mutate-order.sh proves that for three of them.
 *
 * Every request has a 2 s timeout (helpers/hostedApp.ts): a hang fails.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  INVITE_INVALID,
  MODE_HEADER,
  ORIGIN_REJECTED,
  SIGN_IN_REQUIRED,
  TOO_MANY_REQUESTS,
} from '@soulbound/shared';
import { PENDING_MIGRATIONS_MESSAGE } from '../../db.js';
import { createInvite } from '../../invites.js';
import { buildHostedDeps } from '../../server.js';
import {
  PUBLIC_URL,
  SECRET,
  SESSION_COOKIE,
  setCookies,
  startHostedApp,
  type HostedApp,
  type Result,
} from '../helpers/hostedApp.js';
import { testDatabaseUrl, withTestDb } from '../helpers/withTestDb.js';

const db = withTestDb();
const unmigrated = withTestDb({ migrate: false });

function errorCode(res: Result): unknown {
  return (res.json as { error?: { code?: unknown } } | undefined)?.error?.code;
}

/** The four ways a state-changing request can fail the Origin check. */
const BAD_ORIGINS: [string, Record<string, string>][] = [
  ['no Origin', {}],
  ['Origin: null', { origin: 'null' }],
  ['a foreign Origin', { origin: 'https://evil.example' }],
  ['Sec-Fetch-Site: cross-site', { origin: PUBLIC_URL, 'sec-fetch-site': 'cross-site' }],
];

describe('hosted middleware order (06-04)', () => {
  let h: HostedApp;
  let staticDir: string;

  beforeAll(async () => {
    staticDir = mkdtempSync(path.join(tmpdir(), 'sb-hosted-static-'));
    writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>sb</title>');
    h = await startHostedApp(db, { staticDir });
  });
  afterAll(async () => {
    await h.close();
    rmSync(staticDir, { recursive: true, force: true });
  });

  describe('step 3: anti-framing headers on every kind of response (R24e)', () => {
    const cases: [string, () => Promise<Result>, number][] = [
      ['GET /api/health', () => h.request({ method: 'GET', path: '/api/health' }), 200],
      ['a static file (GET /)', () => h.request({ method: 'GET', path: '/' }), 200],
      ['a static 404 (GET /missing-chunk.js)', () => h.request({ method: 'GET', path: '/missing-chunk.js' }), 404],
      ['GET /api/access', () => h.request({ method: 'GET', path: '/api/access' }), 401],
      ['an auth route (GET /api/auth/get-session)', () => h.request({ method: 'GET', path: '/api/auth/get-session' }), 200],
      ['a 403 from the Origin check', () => h.request({ method: 'POST', path: '/api/world-engine', json: {} }), 403],
    ];
    for (const [name, send, status] of cases) {
      it(name, async () => {
        const res = await send();
        expect(res.status).toBe(status);
        expect(res.headers['x-frame-options']).toBe('DENY');
        expect(res.headers['content-security-policy']).toBe("frame-ancestors 'none'");
        expect(res.headers['referrer-policy']).toBe('no-referrer');
      });
    }
  });

  describe('step 8: the Origin check, per route (R24b)', () => {
    const routes: [string, string, unknown, (res: Result) => void][] = [
      [
        'POST',
        '/api/auth/sign-in/magic-link',
        { email: 'nobody@example.test' },
        (res) => expect(res.status).toBe(200), // reaches Better Auth
      ],
      [
        'POST',
        '/api/invites/redeem',
        { code: 'not-a-code' },
        (res) => {
          expect(res.status).toBe(400); // reaches redeem
          expect(errorCode(res)).toBe(INVITE_INVALID);
        },
      ],
      [
        'DELETE',
        '/api/account',
        undefined,
        (res) => {
          expect(res.status).toBe(401); // reaches the session gate (the route is not mounted yet)
          expect(errorCode(res)).toBe(SIGN_IN_REQUIRED);
        },
      ],
      [
        'POST',
        '/api/world-engine',
        {},
        (res) => {
          expect(res.status).toBe(401); // reaches the session gate
          expect(errorCode(res)).toBe(SIGN_IN_REQUIRED);
        },
      ],
    ];
    for (const [method, route, json, passes] of routes) {
      for (const [label, headers] of BAD_ORIGINS) {
        it(`${method} ${route} with ${label} → 403 ORIGIN_REJECTED`, async () => {
          const res = await h.request({ method, path: route, json, headers });
          expect(res.status).toBe(403);
          expect(errorCode(res)).toBe(ORIGIN_REJECTED);
        });
      }
      it(`${method} ${route} from the public origin passes to the next layer`, async () => {
        passes(await h.request({ method, path: route, json, headers: { origin: PUBLIC_URL } }));
      });
    }

    const variants: [string, string, Record<string, string>][] = [
      ['POST', '/API/auth/sign-in/magic-link', {}],
      ['POST', '/api//auth/sign-in/magic-link', {}],
      ['POST', '/api/auth/../invites/redeem', {}],
      ['POST', '/api/auth/sign-in/magic-link', { 'x-http-method-override': 'GET' }],
      ['PUT', '/api/access', {}],
      ['PATCH', '/api/world-engine', {}],
    ];
    for (const [method, route, headers] of variants) {
      it(`${method} ${route} ${JSON.stringify(headers)} with no Origin → 403`, async () => {
        const res = await h.request({ method, path: route, json: { email: 'x@example.test' }, headers });
        expect(res.status).toBe(403);
        expect(errorCode(res)).toBe(ORIGIN_REJECTED);
      });
    }

    it('a same-origin Sec-Fetch-Site with the public Origin passes', async () => {
      const res = await h.request({
        method: 'POST',
        path: '/api/world-engine',
        json: {},
        headers: { origin: PUBLIC_URL, 'sec-fetch-site': 'same-origin' },
      });
      expect(res.status).toBe(401);
    });

    it('an Origin that only starts with the public origin is foreign', async () => {
      for (const origin of [`${PUBLIC_URL}.evil.example`, `${PUBLIC_URL}:444`, `${PUBLIC_URL}/`, 'http://play.example']) {
        const res = await h.request({ method: 'POST', path: '/api/world-engine', json: {}, headers: { origin } });
        expect(res.status, origin).toBe(403);
      }
    });
  });

  describe('step 7: only the exact webhook slot bypasses the Origin check', () => {
    it('POST /api/billing/webhook with no Origin reaches the reserved slot (404, not 403)', async () => {
      const res = await h.request({ method: 'POST', path: '/api/billing/webhook', raw: '{"id":"evt_1"}' });
      expect(res.status).toBe(404);
      expect(errorCode(res)).toBe('NOT_FOUND');
    });

    it('a query string does not change the slot', async () => {
      const res = await h.request({ method: 'POST', path: '/api/billing/webhook?x=1', raw: '{}' });
      expect(res.status).toBe(404);
    });

    for (const route of ['/api/billing/webhookx', '/api/billing/webhook/', '/API/Billing/Webhook', '/api/billing/Webhook']) {
      it(`POST ${route} → 403 ORIGIN_REJECTED`, async () => {
        const res = await h.request({ method: 'POST', path: route, raw: '{}' });
        expect(res.status).toBe(403);
        expect(errorCode(res)).toBe(ORIGIN_REJECTED);
      });
    }

    it('PUT /api/billing/webhook → 403 (the slot is POST only)', async () => {
      const res = await h.request({ method: 'PUT', path: '/api/billing/webhook', raw: '{}' });
      expect(res.status).toBe(403);
      expect(errorCode(res)).toBe(ORIGIN_REJECTED);
    });

    it('GET /api/billing/webhook skips the Origin check and stops at the session gate (401)', async () => {
      const res = await h.request({ method: 'GET', path: '/api/billing/webhook' });
      expect(res.status).toBe(401);
      expect(errorCode(res)).toBe(SIGN_IN_REQUIRED);
    });
  });

  describe('step 10: Better Auth is mounted before express.json', () => {
    it('POST /api/auth/sign-in/magic-link with a JSON body answers within 2 s', async () => {
      const res = await h.request({
        method: 'POST',
        path: '/api/auth/sign-in/magic-link',
        json: { email: 'before-json@example.test' },
        headers: { origin: PUBLIC_URL },
      });
      expect(res.status).toBe(200);
    });

    // better-auth #3295's hang no longer reproduces: better-call 1.4.0
    // re-serialises an already-parsed `req.body` (adapters/node/request.mjs
    // :108-113). What still shows that nothing read the body before step 10
    // is WHO answers a malformed one: Better Auth's own 400, never the app's
    // body-parser envelope (`INVALID_REQUEST`), which is what express.json
    // placed above the mount produces (mutate-order.sh, mutation a).
    it('a malformed JSON body on /api/auth/* reaches Better Auth unparsed (its 400, not the app body parser)', async () => {
      for (const raw of ['{"email":', 'not json at all']) {
        const res = await h.request({
          method: 'POST',
          path: '/api/auth/sign-in/magic-link',
          raw,
          headers: { origin: PUBLIC_URL },
        });
        expect(res.status, raw).toBe(400);
        expect(res.json, raw).toEqual({ message: 'Invalid JSON in request body', code: 'BAD_REQUEST' });
      }
    });

    it('an unknown /api/auth path gets the JSON 404 without a session', async () => {
      const res = await h.request({ method: 'GET', path: '/api/auth/list-sessions' });
      expect(res.status).toBe(404);
      expect(errorCode(res)).toBe('NOT_FOUND');
    });
  });

  describe('step 11: the session gate', () => {
    it('/api/access with no cookie → 401 SIGN_IN_REQUIRED, with Soulbound-Mode: hosted', async () => {
      const res = await h.request({ method: 'GET', path: '/api/access' });
      expect(res.status).toBe(401);
      expect(errorCode(res)).toBe(SIGN_IN_REQUIRED);
      expect(res.headers[MODE_HEADER.toLowerCase()]).toBe('hosted');
    });

    it('a forged session cookie → 401', async () => {
      const res = await h.request({
        method: 'GET',
        path: '/api/access',
        headers: { cookie: `${SESSION_COOKIE}=forged.value` },
      });
      expect(res.status).toBe(401);
      expect(errorCode(res)).toBe(SIGN_IN_REQUIRED);
    });

    it('/api/access with a session → 204, with Soulbound-Mode: hosted', async () => {
      const { cookie } = await h.signIn();
      const res = await h.request({ method: 'GET', path: '/api/access', headers: { cookie } });
      expect(res.status).toBe(204);
      expect(res.headers[MODE_HEADER.toLowerCase()]).toBe('hosted');
    });

    it('a signed-in request reaches the routes (a world-engine POST gets past the gate to validation)', async () => {
      const { cookie } = await h.signIn();
      const res = await h.request({
        method: 'POST',
        path: '/api/world-engine',
        json: {},
        headers: { cookie, origin: PUBLIC_URL },
      });
      expect(res.status).toBe(400);
    });

    it('a user with an account_deletions row → 401, even with a live session', async () => {
      const { cookie, userId } = await h.signIn();
      expect((await h.request({ method: 'GET', path: '/api/access', headers: { cookie } })).status).toBe(204);
      await h.deps.pool.query('INSERT INTO account_deletions (user_id, requested_at) VALUES ($1, now())', [userId]);
      const res = await h.request({ method: 'GET', path: '/api/access', headers: { cookie } });
      expect(res.status).toBe(401);
      expect(errorCode(res)).toBe(SIGN_IN_REQUIRED);
    });

    it('a revoked session → 401 at once (no cookie cache)', async () => {
      const { cookie, userId } = await h.signIn();
      await h.deps.pool.query('DELETE FROM session WHERE "userId" = $1', [userId]);
      const res = await h.request({ method: 'GET', path: '/api/access', headers: { cookie } });
      expect(res.status).toBe(401);
    });

    it('DELETE /api/account is not mounted while requestAccountDeletion is absent (404 behind the gate)', async () => {
      const { cookie } = await h.signIn();
      const res = await h.request({ method: 'DELETE', path: '/api/account', headers: { cookie, origin: PUBLIC_URL } });
      expect(res.status).toBe(404);
    });
  });
});

describe('step 9: invite redeem', () => {
  let h: HostedApp;
  let clock = 0;

  beforeAll(async () => {
    h = await startHostedApp(db, { now: () => clock });
  });
  afterAll(async () => {
    await h.close();
  });
  afterEach(() => {
    clock += 61_000; // a fresh limiter window for the next test
  });

  const redeem = (json: unknown, raw?: string) =>
    h.request({
      method: 'POST',
      path: '/api/invites/redeem',
      ...(raw === undefined ? { json } : { raw }),
      headers: { origin: PUBLIC_URL },
    });

  it('a malformed code → 400 INVITE_INVALID', async () => {
    for (const body of [{ code: 'short' }, { code: 42 }, {}, []]) {
      clock += 61_000;
      const res = await redeem(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(errorCode(res)).toBe(INVITE_INVALID);
    }
  });

  it('a 2 KB body → 413', async () => {
    const res = await redeem(undefined, JSON.stringify({ code: 'x'.repeat(2048) }));
    expect(res.status).toBe(413);
  });

  it('the 6th request in a minute → 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await redeem({ code: 'AAAAAAAAAAAAAAAAAAAAAA' })).status);
    expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
  });

  it('a valid code → 204 with the __Host-sb_invite cookie', async () => {
    const { code } = await createInvite(h.deps.pool);
    const res = await redeem({ code });
    expect(res.status).toBe(204);
    const cookie = setCookies(res).find((c) => c.startsWith('__Host-sb_invite='));
    expect(cookie).toMatch(/; Secure; HttpOnly; SameSite=Lax; Path=\/; Max-Age=900$/);
    expect(cookie).not.toContain(code);
  });
});

describe('step 12: the per-user limiter', () => {
  let h: HostedApp;
  beforeAll(async () => {
    h = await startHostedApp(db, { userRatePerMinute: 3, now: () => 0 });
  });
  afterAll(async () => {
    await h.close();
  });

  it('N+1 requests with one session → 429; another user is unaffected', async () => {
    const a = await h.signIn();
    const b = await h.signIn();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await h.request({ method: 'GET', path: '/api/access', headers: { cookie: a.cookie } })).status);
    }
    expect(statuses).toEqual([204, 204, 204, 429]);
    const other = await h.request({ method: 'GET', path: '/api/access', headers: { cookie: b.cookie } });
    expect(other.status).toBe(204);
  });

  it('the 429 carries TOO_MANY_REQUESTS', async () => {
    const a = await h.signIn();
    let last: Result | undefined;
    for (let i = 0; i < 4; i += 1) last = await h.request({ method: 'GET', path: '/api/access', headers: { cookie: a.cookie } });
    expect(last?.status).toBe(429);
    expect(errorCode(last!)).toBe(TOO_MANY_REQUESTS);
  });
});

describe('step 6: the per-IP limiter keys IPv6 by /64', () => {
  let h: HostedApp;
  beforeAll(async () => {
    h = await startHostedApp(db, { ratePerMinute: 2, trustProxy: 1, now: () => 0 });
  });
  afterAll(async () => {
    await h.close();
  });

  const from = (ip: string) =>
    h.request({ method: 'GET', path: '/api/access', headers: { 'x-forwarded-for': ip } });

  it('addresses in one /64 share a bucket; another /64 does not', async () => {
    expect((await from('2001:db8::1')).status).toBe(401);
    expect((await from('2001:db8:0:0::2')).status).toBe(401);
    const third = await from('2001:0db8:0000:0000:ffff:0000:0000:0003');
    expect(third.status).toBe(429);
    expect(errorCode(third)).toBe(TOO_MANY_REQUESTS);
    expect(third.headers[MODE_HEADER.toLowerCase()]).toBe('hosted');
    expect((await from('2001:db8:0:1::1')).status).toBe(401);
  });

  it('health is never limited', async () => {
    for (let i = 0; i < 4; i += 1) {
      expect((await h.request({ method: 'GET', path: '/api/health', headers: { 'x-forwarded-for': '2001:db8::9' } })).status).toBe(200);
    }
  });
});

describe('step 14: DELETE /api/account, when requestAccountDeletion is supplied (06-05)', () => {
  let h: HostedApp;
  const requested: string[] = [];
  beforeAll(async () => {
    h = await startHostedApp(db, {
      requestAccountDeletion: async (userId) => {
        requested.push(userId);
      },
    });
  });
  afterAll(async () => {
    await h.close();
  });

  it('204, clears the session cookie, and passes the signed-in user id', async () => {
    const { cookie, userId } = await h.signIn();
    const res = await h.request({ method: 'DELETE', path: '/api/account', headers: { cookie, origin: PUBLIC_URL } });
    expect(res.status).toBe(204);
    expect(requested).toEqual([userId]);
    expect(setCookies(res)).toContain(
      `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
    );
  });

  it('without a session → 401, and nothing is requested', async () => {
    const before = requested.length;
    const res = await h.request({ method: 'DELETE', path: '/api/account', headers: { origin: PUBLIC_URL } });
    expect(res.status).toBe(401);
    expect(requested.length).toBe(before);
  });
});

describe('hosted boot refuses an unmigrated schema', () => {
  it('buildHostedDeps rejects with the pending-migrations message', async () => {
    await expect(
      buildHostedDeps({
        databaseUrl: unmigrated.url,
        schema: unmigrated.schema,
        betterAuthSecret: SECRET,
        resendApiKey: 're_fake_resend_key_never_used_0000',
        publicOrigin: PUBLIC_URL,
        emailFrom: 'Soulbound <auth@play.example>',
        userRateLimitPerMinute: 60,
        redact: (input) => input,
      }),
    ).rejects.toThrow(PENDING_MIGRATIONS_MESSAGE);
  });

  it('buildHostedDeps rejects an unsafe schema name before connecting', async () => {
    await expect(
      buildHostedDeps({
        databaseUrl: unmigrated.url,
        schema: 'x; DROP TABLE y',
        betterAuthSecret: SECRET,
        resendApiKey: 're_fake_resend_key_never_used_0000',
        publicOrigin: PUBLIC_URL,
        emailFrom: 'Soulbound <auth@play.example>',
        userRateLimitPerMinute: 60,
        redact: (input) => input,
      }),
    ).rejects.toThrow('invalid schema name');
  });

  describe('main() on a fresh database', () => {
    const dbName = `sb_boot_${randomBytes(6).toString('hex')}`;
    const HOSTED_ENV = [
      'SOULBOUND_MODE',
      'ANTHROPIC_API_KEY',
      'DATABASE_URL',
      'BETTER_AUTH_SECRET',
      'BETTER_AUTH_URL',
      'RESEND_API_KEY',
      'EMAIL_FROM',
      'ALLOWED_HOSTS',
    ];
    afterEach(async () => {
      vi.restoreAllMocks();
      for (const name of HOSTED_ENV) delete process.env[name];
      await db.pool.query(`DROP DATABASE IF EXISTS ${dbName}`);
    });

    it('exits 1 with "run `npm run migrate`", and prints no database URL', async () => {
      await db.pool.query(`CREATE DATABASE ${dbName}`);
      const url = new URL(testDatabaseUrl());
      url.pathname = `/${dbName}`;
      Object.assign(process.env, {
        SOULBOUND_MODE: 'hosted',
        ANTHROPIC_API_KEY: 'sk-ant-test-fake-key-hosted-boot-not-real',
        DATABASE_URL: url.href,
        BETTER_AUTH_SECRET: SECRET,
        BETTER_AUTH_URL: PUBLIC_URL,
        RESEND_API_KEY: 're_fake_resend_key_never_used_0000',
        EMAIL_FROM: 'Soulbound <auth@play.example>',
        ALLOWED_HOSTS: '127.0.0.1',
      });
      const printed: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void printed.push(args.map(String).join(' ')));
      vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code})`);
      }) as typeof process.exit);

      vi.resetModules();
      const { main } = await import('../../server.js');
      await expect(main()).rejects.toThrow('process.exit(1)');
      expect(printed.join('\n')).toContain(PENDING_MIGRATIONS_MESSAGE);
      expect(printed.join('\n')).not.toContain(url.href);
      expect(process.env.DATABASE_URL).toBeUndefined();
    });
  });
});
