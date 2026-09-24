/**
 * auth.ts through the real Better Auth handler on an ephemeral Express app,
 * mounted exactly as 06-04 will mount it (the invite wrapper, then the
 * handler, BEFORE express.json), against real Postgres (spec R24a, R24c,
 * R24f; plan 06-03 task 3 and its critique block).
 *
 * No test reaches the network: email goes to an in-memory spy, the Resend
 * sender is tested against a stub `fetch`, and the OAuth sign-up path is
 * driven at the hook level through the same internal-adapter call the
 * provider callback makes (a real callback would need Google or Discord).
 * Requests use `node:http` (routes.test.ts's header explains why not
 * `fetch`), which also lets a test send a spoofed Host header.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { INVITE_INVALID, INVITE_REQUIRED } from '@soulbound/shared';
import {
  allowedAuthPaths,
  createAuth,
  createResendSender,
  DISABLED_PATHS,
  EMAIL_REQUIRED_MESSAGE,
  INVITE_PATH_SENDS_PER_HOUR,
  INVITE_REQUIRED_MESSAGE,
  SESSION_EXPIRES_IN_SECONDS,
  type AuthDeps,
  type EmailMessage,
  type HostedAuth,
} from '../../auth.js';
import {
  createInvite,
  inviteCookieKey,
  redeemInvite,
  signInviteCookie,
  verifyInviteCookie,
  type InvitePayload,
} from '../../invites.js';
import { withTestDb } from '../helpers/withTestDb.js';

const db = withTestDb();

const PUBLIC_URL = 'https://play.example';
const SECRET = 'fake-better-auth-secret-hosted-auth-tests-Jx83kQ2v';
const EMAIL_FROM = 'Soulbound <auth@play.example>';
const FAKE_GOOGLE = { clientId: 'fake-google-client-id', clientSecret: 'fake-google-client-secret-000' };
const FAKE_DISCORD = { clientId: 'fake-discord-client-id', clientSecret: 'fake-discord-client-secret-00' };
const key = inviteCookieKey(SECRET);

interface Harness {
  a: HostedAuth;
  port: number;
  sent: EmailMessage[];
  sessionsCreatedFor: string[];
  close: () => Promise<void>;
}

async function startHarness(overrides: Partial<AuthDeps> = {}): Promise<Harness> {
  const sent: EmailMessage[] = [];
  const sessionsCreatedFor: string[] = [];
  const a = await createAuth({
    pool: db.pool,
    publicUrl: PUBLIC_URL,
    secret: SECRET,
    emailFrom: EMAIL_FROM,
    sendEmail: async (message) => {
      sent.push(message);
    },
    google: FAKE_GOOGLE,
    discord: FAKE_DISCORD,
    onSessionCreated: (userId) => {
      sessionsCreatedFor.push(userId);
    },
    // The shared harness makes far more invite-path sends than the
    // production ceiling allows; the ceiling has its own harness below.
    limits: { inviteSendsPerHour: 100_000 },
    ...overrides,
  });
  const app = express();
  app.all('/api/auth/*splat', a.withInviteContext, a.handler);
  app.use('/api', express.json({ limit: '1kb' }));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { message: 'Not found', code: 'NOT_FOUND' } });
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    a,
    port,
    sent,
    sessionsCreatedFor,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

interface Result {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function request(
  port: number,
  opts: { method: string; path: string; json?: unknown; headers?: Record<string, string> },
): Promise<Result> {
  const body = opts.json === undefined ? undefined : JSON.stringify(opts.json);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: opts.method,
        path: opts.path,
        headers: {
          ...(body !== undefined
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
            : {}),
          ...(opts.headers ?? {}),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** `name=value` for the invite cookie, as a browser would send it back. */
async function inviteCookieFor(inviteId: string, code: string): Promise<string> {
  const redeemed = await redeemInvite(db.pool, code, { key });
  expect(redeemed?.inviteId).toBe(inviteId);
  return redeemed!.setCookie.split(';')[0]!;
}

async function newInviteCookie(): Promise<{ inviteId: string; cookie: string }> {
  const { id, code } = await createInvite(db.pool);
  return { inviteId: id, cookie: await inviteCookieFor(id, code) };
}

function sendLink(h: Harness, email: string, opts: { cookie?: string; headers?: Record<string, string>; json?: Record<string, unknown> } = {}) {
  return request(h.port, {
    method: 'POST',
    path: '/api/auth/sign-in/magic-link',
    json: { email, ...(opts.json ?? {}) },
    headers: { origin: PUBLIC_URL, ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.headers ?? {}) },
  });
}

/** The verify link from the last email sent to `email`. */
function linkFor(h: Harness, email: string): URL {
  const message = [...h.sent].reverse().find((m) => m.to === email);
  expect(message, `an email to ${email}`).toBeDefined();
  const match = /https:\/\/\S+/.exec(message!.text);
  return new URL(match![0]);
}

function openLink(h: Harness, link: URL, cookie?: string) {
  return request(h.port, {
    method: 'GET',
    path: `${link.pathname}${link.search}`,
    headers: cookie ? { cookie } : {},
  });
}

function setCookies(res: Result): string[] {
  const raw = res.headers['set-cookie'];
  return raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
}

async function usersWithEmail(email: string): Promise<string[]> {
  const { rows } = await db.pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email.toLowerCase()]);
  return rows.map((r) => r.id);
}

async function inviteRow(id: string) {
  const { rows } = await db.pool.query('SELECT * FROM invites WHERE id = $1', [id]);
  return rows[0] as Record<string, unknown>;
}

/** Full invited magic-link sign-up. */
async function signUp(h: Harness, email: string, cookie: string): Promise<Result> {
  const sent = await sendLink(h, email, { cookie });
  expect(sent.status).toBe(200);
  return openLink(h, linkFor(h, email), cookie);
}

/** An existing account, created directly (no email sent). */
async function insertAccount(email: string): Promise<string> {
  const id = randomUUID();
  await db.pool.query(`INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, '', $2, true)`, [id, email]);
  return id;
}

const uniqueEmail = (label: string) => `${label}-${randomUUID().slice(0, 8)}@example.test`;

/**
 * An ID token shaped like Google's. Unsigned: on the authorization-code path
 * Better Auth only decodes it (core `social-providers/google.mjs:119`), having
 * received it straight from Google's token endpoint.
 */
function fakeIdToken(claims: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: 'https://accounts.google.com', aud: FAKE_GOOGLE.clientId, ...claims })}.sig`;
}

/** The raw `name=value` pairs of every Set-Cookie on a response. */
function cookiePairs(res: Result): string[] {
  return setCookies(res).map((c) => c.split(';')[0]!);
}

/**
 * The real Google flow through the real routes: `POST /sign-in/social`, then
 * `GET /callback/google` with the state it issued. Only Google's token
 * endpoint is stubbed, so the ID token (and its `email_verified`) is ours.
 */
async function googleSignIn(
  h: Harness,
  claims: { sub: string; email: string; email_verified: unknown },
  inviteCookie?: string,
): Promise<Result> {
  const start = await request(h.port, {
    method: 'POST',
    path: '/api/auth/sign-in/social',
    json: { provider: 'google', callbackURL: '/' },
    headers: { origin: PUBLIC_URL, ...(inviteCookie ? { cookie: inviteCookie } : {}) },
  });
  expect(start.status, start.body).toBe(200);
  const state = new URL((JSON.parse(start.body) as { url: string }).url).searchParams.get('state');
  expect(state).toBeTruthy();
  const realFetch = globalThis.fetch;
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(
        JSON.stringify({
          access_token: 'fake-google-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid email profile',
          id_token: fakeIdToken({ name: 'G', ...claims }),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.startsWith(`http://127.0.0.1:`)) return realFetch(input, init);
    throw new Error(`unexpected fetch in test: ${url}`);
  });
  try {
    return await request(h.port, {
      method: 'GET',
      path: `/api/auth/callback/google?code=fake-code&state=${encodeURIComponent(state!)}`,
      headers: { cookie: [...cookiePairs(start), ...(inviteCookie ? [inviteCookie] : [])].join('; ') },
    });
  } finally {
    spy.mockRestore();
  }
}

async function googleAccountRows(sub: string) {
  const { rows } = await db.pool.query<{ userId: string; accessToken: string | null }>(
    `SELECT "userId", "accessToken" FROM account WHERE "providerId" = 'google' AND "accountId" = $1`,
    [sub],
  );
  return rows;
}

describe('hosted auth (06-03)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(() => {
    h.sent.length = 0;
    h.sessionsCreatedFor.length = 0;
  });

  describe('options (critique 6)', () => {
    it('every security option is set explicitly', () => {
      const o = h.a.auth.options;
      expect(o.baseURL).toBe(PUBLIC_URL);
      expect(o.trustedOrigins).toEqual([PUBLIC_URL]);
      expect(typeof o.secret === 'string' && o.secret.length >= 32).toBe(true);
      expect(o.rateLimit?.enabled).toBe(false);
      expect(o.session?.expiresIn).toBe(2_592_000);
      expect(o.session?.updateAge).toBe(86_400);
      expect(o.session?.cookieCache?.enabled).toBe(false);
      expect(o.account?.accountLinking?.trustedProviders).toEqual(['google']);
      expect(o.account?.accountLinking?.allowDifferentEmails).toBe(false);
      expect(o.account?.encryptOAuthTokens).toBe(true);
      expect(o.advanced?.ipAddress?.disableIpTracking).toBe(true);
      expect(o.advanced?.useSecureCookies).toBe(true);
      expect(o.advanced?.disableCSRFCheck).toBe(false);
      expect(o.advanced?.disableOriginCheck).toBe(false);
      expect(o.advanced?.trustedProxyHeaders).toBe(false);
      expect(o.onAPIError?.errorURL).toBe('/');
      expect(o.telemetry?.enabled).toBe(false);
      const plugin = o.plugins?.find((p) => p.id === 'magic-link') as { options?: { storeToken?: unknown } } | undefined;
      expect(plugin?.options?.storeToken).toBe('hashed');
    });

    it('the rate limiter really is off at runtime', async () => {
      const ctx = await h.a.auth.$context;
      expect(ctx.rateLimit.enabled).toBe(false);
      expect(ctx.skipOriginCheck).toBe(false);
      expect(ctx.skipCSRFCheck).toBe(false);
    });

    it('providers are configured only when both halves are given', async () => {
      const none = await createAuth({
        pool: db.pool,
        publicUrl: PUBLIC_URL,
        secret: SECRET,
        emailFrom: EMAIL_FROM,
        sendEmail: async () => undefined,
      });
      expect(Object.keys(none.auth.options.socialProviders ?? {})).toEqual([]);
      expect(Object.keys(h.a.auth.options.socialProviders ?? {}).sort()).toEqual(['discord', 'google']);
    });
  });

  describe('auth surface (critique 5)', () => {
    const allowed = allowedAuthPaths({ google: true, discord: true });

    it('every installed endpoint is either used or disabled', () => {
      const paths = Object.values(h.a.auth.api)
        .map((endpoint) => (endpoint as { path?: string }).path)
        .filter((p): p is string => typeof p === 'string');
      expect(paths.length).toBeGreaterThan(20);
      const known = new Set<string>([
        ...DISABLED_PATHS,
        ...allowed.map((p) => p.replace('/api/auth', '')),
        '/callback/:id',
        '/reset-password/:token',
      ]);
      expect(paths.filter((p) => !known.has(p))).toEqual([]);
    });

    it('over HTTP, only the allowed set is reachable; every other endpoint is 404', async () => {
      const paths = Object.values(h.a.auth.api)
        .map((endpoint) => (endpoint as { path?: string }).path)
        .filter((p): p is string => typeof p === 'string')
        .map((p) => `/api/auth${p.replace(':id', 'github').replace(':token', 'abc')}`);
      const reachable: string[] = [];
      for (const path of paths) {
        for (const method of ['GET', 'POST']) {
          const res = await request(h.port, {
            method,
            path,
            json: method === 'POST' ? {} : undefined,
            headers: { origin: PUBLIC_URL },
          });
          if (res.status !== 404) reachable.push(path);
        }
      }
      expect([...new Set(reachable)].sort()).toEqual(
        allowed.filter((p) => !p.startsWith('/api/auth/callback/')).sort(),
      );
    });

    it('case, trailing-slash, encoded and dot-segment variants of a disabled path are 404', async () => {
      const variants = [
        '/api/auth/Sign-Up/Email',
        '/api/auth/SIGN-UP/EMAIL',
        '/api/auth/sign-up/email/',
        '/api/auth/sign-up%2Femail',
        '/api/auth//sign-up/email',
        '/api/auth/sign-in/magic-link/../../sign-up/email',
        '/API/AUTH/sign-up/email',
        '/api/auth/update-user',
        '/api/auth/callback/github',
        '/api/auth/reset-password/sometoken?callbackURL=%2F',
      ];
      for (const path of variants) {
        const res = await request(h.port, {
          method: 'POST',
          path,
          json: { email: 'x@example.test', password: 'password1234', name: 'x' },
          headers: { origin: PUBLIC_URL },
        });
        expect(res.status, path).toBe(404);
      }
      const { rows } = await db.pool.query("SELECT 1 FROM \"user\" WHERE email = 'x@example.test'");
      expect(rows).toHaveLength(0);
    });

    it('disabledPaths holds on its own, behind the allow-list (Better Auth web handler)', async () => {
      for (const path of DISABLED_PATHS) {
        const res = await h.a.auth.handler(
          new Request(`${PUBLIC_URL}/api/auth${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: PUBLIC_URL },
            body: '{}',
          }),
        );
        expect(res.status, path).toBe(404);
      }
    });

    it('rejects foreign callbackURL values, and sends nothing', async () => {
      const { cookie } = await newInviteCookie();
      for (const callbackURL of ['https://evil.example', '//evil.example', '/\\evil.example', 'https://evil.example/']) {
        const email = uniqueEmail('cb');
        const res = await sendLink(h, email, { cookie, json: { callbackURL } });
        expect(res.status, callbackURL).toBe(403);
        expect(h.sent.find((m) => m.to === email), callbackURL).toBeUndefined();
      }
      // And on the verify link itself.
      for (const callbackURL of ['https://evil.example', '//evil.example', '/\\evil.example']) {
        const res = await request(h.port, {
          method: 'GET',
          path: `/api/auth/magic-link/verify?token=abc&callbackURL=${encodeURIComponent(callbackURL)}`,
        });
        expect(res.status, callbackURL).toBe(403);
      }
    });
  });

  describe('invited magic-link sign-up', () => {
    it('creates the account, sets a hardened session cookie, and clears the invite cookie', async () => {
      const { inviteId, cookie } = await newInviteCookie();
      const email = uniqueEmail('first');
      const res = await signUp(h, email, cookie);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`${PUBLIC_URL}/`);
      const cookies = setCookies(res);
      const session = cookies.find((c) => c.startsWith('__Secure-better-auth.session_token='));
      expect(session, cookies.join('\n')).toBeDefined();
      const attributes = session!.split(';').map((s) => s.trim().toLowerCase());
      expect(attributes).toContain('httponly');
      expect(attributes).toContain('secure');
      expect(attributes).toContain('samesite=lax');
      expect(attributes).toContain(`max-age=${SESSION_EXPIRES_IN_SECONDS}`);
      const cleared = cookies.find((c) => c.startsWith('__Host-sb_invite='));
      expect(cleared).toMatch(/^__Host-sb_invite=; Max-Age=0; Path=\/; HttpOnly; Secure; SameSite=Lax$/);

      const [userId] = await usersWithEmail(email);
      expect(userId).toBeDefined();
      const row = await inviteRow(inviteId);
      expect(row.used_by).toBe(userId);
      expect(row.used_at).not.toBeNull();
      expect(h.sessionsCreatedFor).toEqual([userId]);

      // The token is stored hashed: no verification row holds the raw token.
      const token = linkFor(h, email).searchParams.get('token')!;
      const { rows } = await db.pool.query('SELECT 1 FROM verification WHERE identifier = $1 OR value LIKE $2', [
        token,
        `%${token}%`,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('two concurrent sign-ups with one invite (two redeems) create exactly one user', { repeats: 20 }, async () => {
      const { id, code } = await createInvite(db.pool);
      const c1 = await inviteCookieFor(id, code);
      const c2 = await inviteCookieFor(id, code);
      const e1 = uniqueEmail('race1');
      const e2 = uniqueEmail('race2');
      expect((await sendLink(h, e1, { cookie: c1 })).status).toBe(200);
      expect((await sendLink(h, e2, { cookie: c2 })).status).toBe(200);
      const [r1, r2] = await Promise.all([openLink(h, linkFor(h, e1), c1), openLink(h, linkFor(h, e2), c2)]);

      const created = [...(await usersWithEmail(e1)), ...(await usersWithEmail(e2))];
      expect(created).toHaveLength(1);
      expect((await inviteRow(id)).used_by).toBe(created[0]);
      const loser = [r1, r2].find((r) => !String(r.headers.location).endsWith('example/'));
      expect(loser?.headers.location).toContain(`error=${INVITE_INVALID}`);
    });

    it('two concurrent sign-ups sharing one invite cookie create exactly one user', { repeats: 20 }, async () => {
      const { inviteId, cookie } = await newInviteCookie();
      const e1 = uniqueEmail('same1');
      const e2 = uniqueEmail('same2');
      expect((await sendLink(h, e1, { cookie })).status).toBe(200);
      expect((await sendLink(h, e2, { cookie })).status).toBe(200);
      await Promise.all([openLink(h, linkFor(h, e1), cookie), openLink(h, linkFor(h, e2), cookie)]);

      const created = [...(await usersWithEmail(e1)), ...(await usersWithEmail(e2))];
      expect(created).toHaveLength(1);
      expect((await inviteRow(inviteId)).used_by).toBe(created[0]);
    });

    it('a failed user insert leaves no user, and the invite is reusable after the reservation lapses', async () => {
      const { inviteId, cookie } = await newInviteCookie();
      const blocked = uniqueEmail('blocked');
      await db.pool.query(`ALTER TABLE "user" ADD CONSTRAINT t_force_insert_failure CHECK (email <> '${blocked}')`);
      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      let res: Result;
      try {
        res = await signUp(h, blocked, cookie);
      } finally {
        await db.pool.query('ALTER TABLE "user" DROP CONSTRAINT t_force_insert_failure');
        err.mockRestore();
      }
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await usersWithEmail(blocked)).toEqual([]);
      const row = await inviteRow(inviteId);
      expect(row.used_at).toBeNull();
      expect(row.reserved_until).not.toBeNull(); // still held by this nonce for now

      // Once the reservation lapses, a fresh holder completes a sign-up with it.
      await db.pool.query("UPDATE invites SET reserved_until = now() - interval '1 second' WHERE id = $1", [inviteId]);
      const payload: InvitePayload = { inviteId, nonce: randomBytes(16).toString('base64url'), exp: Date.now() + 900_000 };
      const freshCookie = `__Host-sb_invite=${signInviteCookie(key, payload)}`;
      const email = uniqueEmail('after-lapse');
      const ok = await signUp(h, email, freshCookie);
      expect(ok.headers.location).toBe(`${PUBLIC_URL}/`);
      expect(await usersWithEmail(email)).toHaveLength(1);
    });

    it('refuses a sign-up with no invite cookie, with the cross-device message', async () => {
      const { cookie } = await newInviteCookie();
      const email = uniqueEmail('crossdevice');
      expect((await sendLink(h, email, { cookie })).status).toBe(200);
      // Opened on another device: the link arrives without the cookie.
      const res = await openLink(h, linkFor(h, email));
      expect(res.status).toBe(302);
      const location = new URL(res.headers.location!, PUBLIC_URL);
      expect(location.origin).toBe(PUBLIC_URL);
      expect(location.searchParams.get('error')).toBe(INVITE_REQUIRED);
      expect(location.searchParams.get('error_description')).toBe(INVITE_REQUIRED_MESSAGE);
      expect(INVITE_REQUIRED_MESSAGE).toMatch(/browser where you entered your invite/);
      expect(await usersWithEmail(email)).toEqual([]);
    });

    it('a returning user signs in without an invite', async () => {
      const { cookie } = await newInviteCookie();
      const email = uniqueEmail('returning');
      await signUp(h, email, cookie);
      const [userId] = await usersWithEmail(email);
      h.sessionsCreatedFor.length = 0;

      expect((await sendLink(h, email)).status).toBe(200);
      const res = await openLink(h, linkFor(h, email));
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`${PUBLIC_URL}/`);
      expect(setCookies(res).some((c) => c.startsWith('__Secure-better-auth.session_token='))).toBe(true);
      expect(await usersWithEmail(email)).toEqual([userId]);
      expect(h.sessionsCreatedFor).toEqual([userId]);
    });
  });

  describe('forced after-hook failure', () => {
    let failing: Harness;
    beforeAll(async () => {
      failing = await startHarness({ consumeInvite: async () => false });
    });
    afterAll(async () => {
      await failing.close();
    });

    it('magic link: no user remains and the code is unconsumed', async () => {
      const { inviteId, cookie } = await newInviteCookie();
      const email = uniqueEmail('afterfail');
      const res = await signUp(failing, email, cookie);
      expect(res.status).toBe(302);
      expect(new URL(res.headers.location!, PUBLIC_URL).searchParams.get('error')).toBe(INVITE_INVALID);
      expect(await usersWithEmail(email)).toEqual([]);
      expect((await inviteRow(inviteId)).used_at).toBeNull();
      expect(setCookies(res).some((c) => c.startsWith('__Secure-better-auth.session_token='))).toBe(false);
    });

    it('OAuth path (inside Better Auth\'s transaction): user and account are both gone', async () => {
      const { id, code } = await createInvite(db.pool);
      const redeemed = await redeemInvite(db.pool, code, { key });
      const invite = verifyInviteCookie(
        key,
        redeemed!.setCookie.split(';')[0]!.split('=')[1]!,
      )!;
      const email = uniqueEmail('oauthfail');
      const ctx = await failing.a.auth.$context;
      const sub = `g-${randomUUID()}`;
      await expect(
        failing.a.inviteContext.run({ invite }, () =>
          ctx.internalAdapter.createOAuthUser(
            { email, emailVerified: true, name: '' },
            // Google always supplies an ID token (google.mjs:118); S3's hook reads it.
            { providerId: 'google', accountId: sub, idToken: fakeIdToken({ sub, email, email_verified: true }) },
          ),
        ),
      ).rejects.toMatchObject({ body: { code: INVITE_INVALID } });
      expect(await usersWithEmail(email)).toEqual([]);
      const orphans = await db.pool.query(
        'SELECT 1 FROM account a WHERE NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = a."userId")',
      );
      expect(orphans.rows).toHaveLength(0);
      expect((await inviteRow(id)).used_at).toBeNull();
    });
  });

  describe('OAuth sign-up hooks', () => {
    async function inviteInContext(): Promise<{ inviteId: string; invite: InvitePayload }> {
      const { id, code } = await createInvite(db.pool);
      const redeemed = await redeemInvite(db.pool, code, { key });
      return { inviteId: id, invite: verifyInviteCookie(key, redeemed!.setCookie.split(';')[0]!.split('=')[1]!)! };
    }

    it('a verified Google sign-up with an invite creates the user and consumes the invite', async () => {
      const { inviteId, invite } = await inviteInContext();
      const email = uniqueEmail('google');
      const ctx = await h.a.auth.$context;
      const sub = `g-${randomUUID()}`;
      const created = await h.a.inviteContext.run({ invite }, () =>
        ctx.internalAdapter.createOAuthUser(
          { email, emailVerified: true, name: 'G' },
          // Google always supplies an ID token (google.mjs:118); S3's hook reads it.
          { providerId: 'google', accountId: sub, idToken: fakeIdToken({ sub, email, email_verified: true }) },
        ),
      );
      expect((await inviteRow(inviteId)).used_by).toBe(created.user.id);
    });

    it('emailVerified: false is refused before any reservation (the invite row is untouched)', async () => {
      const { inviteId, invite } = await inviteInContext();
      const before = await inviteRow(inviteId);
      const email = uniqueEmail('unverified');
      const ctx = await h.a.auth.$context;
      await expect(
        h.a.inviteContext.run({ invite }, () =>
          ctx.internalAdapter.createOAuthUser(
            { email, emailVerified: false, name: '' },
            { providerId: 'discord', accountId: `d-${randomUUID()}` },
          ),
        ),
      ).rejects.toMatchObject({ body: { code: 'EMAIL_NOT_VERIFIED' } });
      expect(await inviteRow(inviteId)).toEqual(before);
      expect(await usersWithEmail(email)).toEqual([]);
    });

    it('a Discord-shaped email: null is refused with the clear message', async () => {
      const { inviteId, invite } = await inviteInContext();
      const before = await inviteRow(inviteId);
      const ctx = await h.a.auth.$context;
      await expect(
        h.a.inviteContext.run({ invite }, () =>
          ctx.internalAdapter.createOAuthUser(
            { email: null as unknown as string, emailVerified: true, name: '' },
            { providerId: 'discord', accountId: `d-${randomUUID()}` },
          ),
        ),
      ).rejects.toMatchObject({ body: { code: 'EMAIL_REQUIRED', message: EMAIL_REQUIRED_MESSAGE } });
      expect(await inviteRow(inviteId)).toEqual(before);
    });

    it('no invite in context: refused with INVITE_REQUIRED', async () => {
      const ctx = await h.a.auth.$context;
      const email = uniqueEmail('noinvite-oauth');
      await expect(
        ctx.internalAdapter.createOAuthUser(
          { email, emailVerified: true, name: '' },
          { providerId: 'google', accountId: `g-${randomUUID()}` },
        ),
      ).rejects.toMatchObject({ body: { code: INVITE_REQUIRED, message: INVITE_REQUIRED_MESSAGE } });
      expect(await usersWithEmail(email)).toEqual([]);
    });
  });

  describe('magic-link send gating (R24f, critique 2)', () => {
    it('an unknown email with no invite cookie sends nothing, and the answer matches a real send', async () => {
      const existing = uniqueEmail('exists');
      const { cookie } = await newInviteCookie();
      await signUp(h, existing, cookie);
      h.sent.length = 0;

      const unknown = await sendLink(h, uniqueEmail('unknown'));
      const known = await sendLink(h, existing);
      expect(h.sent.map((m) => m.to)).toEqual([existing]);
      expect(unknown.status).toBe(known.status);
      expect(unknown.body).toBe(known.body);
      expect(unknown.headers['set-cookie']).toEqual(known.headers['set-cookie']);
      expect(unknown.headers['content-type']).toBe(known.headers['content-type']);
    });

    it('the 4th send to one address in 15 minutes does not call the sender (case and spaces ignored)', async () => {
      const email = uniqueEmail('cap');
      await insertAccount(email);
      const variants = [email, email.toUpperCase(), email, email];
      const answers = [];
      for (const variant of variants) answers.push(await sendLink(h, variant));
      expect(h.sent).toHaveLength(3);
      expect(new Set(answers.map((r) => `${r.status} ${r.body}`)).size).toBe(1);
    });

    it('at most 3 sends per invite nonce, even to different addresses', async () => {
      const { cookie } = await newInviteCookie();
      for (let i = 0; i < 4; i += 1) await sendLink(h, uniqueEmail(`nonce${i}`), { cookie });
      expect(h.sent).toHaveLength(3);
    });

    it('a cookie for an invite that has since been used or has expired sends nothing', async () => {
      const used = await newInviteCookie();
      await db.pool.query('UPDATE invites SET used_at = now() WHERE id = $1', [used.inviteId]);
      const expired = await newInviteCookie();
      await db.pool.query("UPDATE invites SET expires_at = now() - interval '1 second' WHERE id = $1", [expired.inviteId]);
      await sendLink(h, uniqueEmail('usedinv'), { cookie: used.cookie });
      await sendLink(h, uniqueEmail('expinv'), { cookie: expired.cookie });
      expect(h.sent).toEqual([]);
    });

    it('a forged invite cookie counts as no cookie', async () => {
      const { cookie } = await newInviteCookie();
      const forged = cookie.slice(0, -2) + (cookie.endsWith('AA') ? 'BB' : 'AA');
      await sendLink(h, uniqueEmail('forged'), { cookie: forged });
      expect(h.sent).toEqual([]);
    });

    it('X-Forwarded-Host (and a spoofed Host) cannot move the emailed link off publicUrl', async () => {
      const { cookie } = await newInviteCookie();
      const email = uniqueEmail('spoof');
      const res = await sendLink(h, email, {
        cookie,
        headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' },
      });
      expect(res.status).toBe(200);
      const link = linkFor(h, email);
      expect(link.origin).toBe(PUBLIC_URL);
      expect(link.pathname).toBe('/api/auth/magic-link/verify');
    });

    it('the send is not awaited: a failing sender still answers 200 and logs no address or link', async () => {
      const lines: string[] = [];
      const err = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void lines.push(args.join(' ')));
      const broken = await startHarness({
        sendEmail: async () => {
          throw new Error('Resend responded 500 for someone@example.test https://play.example/x');
        },
      });
      try {
        const { cookie } = await newInviteCookie();
        const email = uniqueEmail('broken');
        const res = await sendLink(broken, email, { cookie });
        expect(res.status).toBe(200);
        await new Promise((r) => setTimeout(r, 20));
        expect(lines.some((l) => l.includes('magic-link email was not sent (status 500)'))).toBe(true);
        expect(lines.join('\n')).not.toContain('@example.test');
        expect(lines.join('\n')).not.toContain('https://');
      } finally {
        await broken.close();
        err.mockRestore();
      }
    });

    it('the limiter maps sweep expired keys and stay bounded', async () => {
      let clock = 1_900_000_000_000;
      const small = await startHarness({ now: () => clock });
      try {
        // An existing account, so sends are eligible without an invite.
        const email = uniqueEmail('sweep');
        await insertAccount(email);
        await sendLink(small, email);
        expect(small.a.__sendLimiterSizes().perExistingEmail).toBe(1);
        clock += 16 * 60_000;
        await sendLink(small, email);
        await sendLink(small, email);
        await sendLink(small, email);
        expect(small.sent).toHaveLength(4); // the window reset after 15 minutes
        expect(small.a.__sendLimiterSizes().perExistingEmail).toBe(1);
      } finally {
        await small.close();
      }
    });
  });

  describe('review cycle 1', () => {
    it('S2: re-redeeming an invite does not reset its send cap (3 per invite, not per cookie)', async () => {
      const { id, code } = await createInvite(db.pool);
      const c1 = await inviteCookieFor(id, code);
      const c2 = await inviteCookieFor(id, code);
      for (const cookie of [c1, c2]) {
        for (let i = 0; i < 3; i += 1) await sendLink(h, uniqueEmail('recap'), { cookie });
      }
      expect(h.sent).toHaveLength(3);
    });

    it('S2: invite-path sends have a process-wide ceiling of 30 per hour', async () => {
      const fresh = await startHarness({ limits: {} });
      try {
        expect(INVITE_PATH_SENDS_PER_HOUR).toBe(30);
        for (let i = 0; i < 11; i += 1) {
          const { cookie } = await newInviteCookie();
          for (let j = 0; j < 3; j += 1) await sendLink(fresh, uniqueEmail(`ceil${i}-${j}`), { cookie });
        }
        expect(fresh.sent).toHaveLength(30);
        // Returning players are outside the ceiling.
        const returning = uniqueEmail('ceil-returning');
        await insertAccount(returning);
        await sendLink(fresh, returning);
        expect(fresh.sent.at(-1)?.to).toBe(returning);
      } finally {
        await fresh.close();
      }
    });

    it('S2: invite-driven sends cannot fill the per-email map returning players use', async () => {
      const small = await startHarness({ limits: { maxTrackedKeys: 2, inviteSendsPerHour: 100_000 } });
      try {
        // Two invites, five new addresses: past 2 keys, new addresses share
        // the overflow bucket, which then fills.
        for (const n of [3, 2]) {
          const { cookie } = await newInviteCookie();
          for (let i = 0; i < n; i += 1) await sendLink(small, uniqueEmail('flood'), { cookie });
        }
        const returning = uniqueEmail('crowded-out');
        await insertAccount(returning);
        small.sent.length = 0;
        await sendLink(small, returning);
        expect(small.sent.map((m) => m.to)).toEqual([returning]);
      } finally {
        await small.close();
      }
    });

    it('S5: a link sent under invite A cannot create an account under invite B (login CSRF)', async () => {
      const a = await newInviteCookie();
      const victim = await newInviteCookie();
      const before = await inviteRow(victim.inviteId);
      const attackerEmail = uniqueEmail('attacker');
      expect((await sendLink(h, attackerEmail, { cookie: a.cookie })).status).toBe(200);
      // The victim's browser opens the attacker's link, carrying invite B.
      const res = await openLink(h, linkFor(h, attackerEmail), victim.cookie);
      expect(res.status).toBe(302);
      expect(new URL(res.headers.location!, PUBLIC_URL).searchParams.get('error')).toBe(INVITE_REQUIRED);
      expect(setCookies(res).some((c) => c.startsWith('__Secure-better-auth.session_token='))).toBe(false);
      expect(await usersWithEmail(attackerEmail)).toEqual([]);
      expect(await inviteRow(victim.inviteId)).toEqual(before);
    });

    it('S5: the same invite, re-redeemed on another device, cannot use a link the first cookie was sent', async () => {
      const { id, code } = await createInvite(db.pool);
      const first = await inviteCookieFor(id, code);
      const second = await inviteCookieFor(id, code);
      const email = uniqueEmail('rebind');
      await sendLink(h, email, { cookie: first });
      const res = await openLink(h, linkFor(h, email), second);
      expect(new URL(res.headers.location!, PUBLIC_URL).searchParams.get('error')).toBe(INVITE_REQUIRED);
      expect(await usersWithEmail(email)).toEqual([]);
      // The refused attempt spent that link (Better Auth consumes the token
      // before creating the user); the cookie that asked for it asks again
      // and completes the sign-up.
      await sendLink(h, email, { cookie: first });
      const ok = await openLink(h, linkFor(h, email), first);
      expect(ok.headers.location).toBe(`${PUBLIC_URL}/`);
      expect(await usersWithEmail(email)).toHaveLength(1);
    });

    it('S3: an unverified Google identity cannot link into an existing account, and no account row is written', async () => {
      const email = uniqueEmail('g-unverified-link');
      const userId = await insertAccount(email);
      const sub = `g-${randomUUID()}`;
      const res = await googleSignIn(h, { sub, email, email_verified: false });
      expect(res.status).toBe(302);
      expect(new URL(res.headers.location!, PUBLIC_URL).searchParams.get('error')).toBe('EMAIL_NOT_VERIFIED');
      expect(setCookies(res).some((c) => c.startsWith('__Secure-better-auth.session_token='))).toBe(false);
      expect(await googleAccountRows(sub)).toEqual([]);
      expect(await usersWithEmail(email)).toEqual([userId]);
    });

    it('S3: a verified Google identity still links, and its tokens are stored encrypted (S7)', async () => {
      const email = uniqueEmail('g-verified-link');
      const userId = await insertAccount(email);
      const sub = `g-${randomUUID()}`;
      const res = await googleSignIn(h, { sub, email, email_verified: true });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/'); // the callbackURL, as given to sign-in/social
      expect(setCookies(res).some((c) => c.startsWith('__Secure-better-auth.session_token='))).toBe(true);
      const rows = await googleAccountRows(sub);
      expect(rows.map((r) => r.userId)).toEqual([userId]);
      expect(rows[0]!.accessToken).not.toBe('fake-google-access-token');
      expect(rows[0]!.accessToken).not.toContain('fake-google-access-token');
    });

    it('S3: a first-time verified Google sign-up with an invite is unaffected', async () => {
      const { inviteId, cookie } = await newInviteCookie();
      const email = uniqueEmail('g-first');
      const sub = `g-${randomUUID()}`;
      const res = await googleSignIn(h, { sub, email, email_verified: true }, cookie);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/');
      const [userId] = await usersWithEmail(email);
      expect(userId).toBeDefined();
      expect((await googleAccountRows(sub)).map((r) => r.userId)).toEqual([userId]);
      expect((await inviteRow(inviteId)).used_by).toBe(userId);
    });

    it('S7: no IP address is recorded on the session row', async () => {
      const { cookie } = await newInviteCookie();
      const email = uniqueEmail('noip');
      expect((await sendLink(h, email, { cookie, headers: { 'x-forwarded-for': '203.0.113.9' } })).status).toBe(200);
      const res = await request(h.port, {
        method: 'GET',
        path: `${linkFor(h, email).pathname}${linkFor(h, email).search}`,
        headers: { cookie, 'x-forwarded-for': '203.0.113.9' },
      });
      expect(res.headers.location).toBe(`${PUBLIC_URL}/`);
      const [userId] = await usersWithEmail(email);
      const { rows } = await db.pool.query<{ ipAddress: string | null }>(
        'SELECT "ipAddress" FROM session WHERE "userId" = $1',
        [userId],
      );
      expect(rows).toHaveLength(1);
      // Better Auth writes '' (or NULL) when tracking is off; never the address.
      expect(rows[0]!.ipAddress ?? '').toBe('');
    });
  });

  describe('Resend sender', () => {
    it('posts to the Resend API with the key, and reports only the status on failure', async () => {
      const calls: { url: string; init: RequestInit }[] = [];
      const fakeFetch = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response('{}', { status: calls.length === 1 ? 200 : 422 });
      }) as unknown as typeof fetch;
      const send = createResendSender('re_fake_key_for_tests_0000', fakeFetch);
      const message = { from: EMAIL_FROM, to: 'p@example.test', subject: 's', text: 't' };
      await send(message);
      expect(calls[0]!.url).toBe('https://api.resend.com/emails');
      expect(calls[0]!.init.method).toBe('POST');
      expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer re_fake_key_for_tests_0000');
      expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ from: EMAIL_FROM, to: ['p@example.test'], subject: 's', text: 't' });
      await expect(send(message)).rejects.toThrow(/^Resend responded 422$/);
    });
  });
});
