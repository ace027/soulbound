/**
 * Regression pin for the assumption the invite design rests on (spec Key
 * Decisions → "Invite carrier"; Open Question 1; plan 06-03 task 1):
 * an AsyncLocalStorage store entered AROUND Better Auth's Node handler is
 * still visible inside `sendMagicLink`, `databaseHooks.user.create.before` /
 * `.after` and `databaseHooks.session.create.after`.
 *
 * It uses a bare Better Auth instance (not `createAuth`), so it keeps
 * testing the library's behaviour even if our own wiring changes. If a
 * better-auth upgrade breaks propagation, this file fails first, and the
 * spec's fallback (a short-lived map keyed by the magic-link token or OAuth
 * `state`) is what replaces the ALS wrapper.
 *
 * Driven over `node:http` against an ephemeral `app.listen(0)`, never `fetch`
 * (see routes.test.ts's header for why), and no request leaves loopback: the
 * magic-link sender is a local spy.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { betterAuth } from 'better-auth';
import { toNodeHandler } from 'better-auth/node';
import { magicLink } from 'better-auth/plugins/magic-link';
import { describe, expect, it } from 'vitest';
import { withTestDb } from '../helpers/withTestDb.js';

const db = withTestDb();

const PUBLIC_URL = 'https://play.example';
const FAKE_SECRET = 'fake-better-auth-secret-als-test-not-real-0000';

interface Store {
  tag: string;
}

function request(
  port: number,
  opts: { method: string; path: string; body?: string; headers?: Record<string, string> },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: opts.method,
        path: opts.path,
        headers: {
          ...(opts.body !== undefined
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(opts.body) }
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
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

describe('AsyncLocalStorage survives into Better Auth callbacks (task 1)', () => {
  it('the store entered around toNodeHandler is visible in sendMagicLink and every hook', async () => {
    const als = new AsyncLocalStorage<Store>();
    const seen: Record<string, string | undefined> = {};
    let sentToken: string | undefined;

    const auth = betterAuth({
      database: db.pool,
      baseURL: PUBLIC_URL,
      secret: FAKE_SECRET,
      trustedOrigins: [PUBLIC_URL],
      telemetry: { enabled: false },
      rateLimit: { enabled: false },
      plugins: [
        magicLink({
          storeToken: 'hashed',
          sendMagicLink: async ({ token }) => {
            // An await before reading, so the read is not in the same tick.
            await new Promise((r) => setTimeout(r, 1));
            seen.sendMagicLink = als.getStore()?.tag;
            sentToken = token;
          },
        }),
      ],
      databaseHooks: {
        user: {
          create: {
            before: async () => {
              seen.userCreateBefore = als.getStore()?.tag;
            },
            after: async () => {
              seen.userCreateAfter = als.getStore()?.tag;
            },
          },
        },
        session: {
          create: {
            after: async () => {
              seen.sessionCreateAfter = als.getStore()?.tag;
            },
          },
        },
      },
    });

    const handler = toNodeHandler(auth);
    const app = express();
    let counter = 0;
    app.all('/api/auth/*splat', (req, res) => {
      counter += 1;
      void als.run({ tag: `request-${counter}` }, () => handler(req, res));
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    try {
      const { port } = server.address() as AddressInfo;

      const send = await request(port, {
        method: 'POST',
        path: '/api/auth/sign-in/magic-link',
        body: JSON.stringify({ email: 'als.probe@example.test' }),
        headers: { origin: PUBLIC_URL },
      });
      expect(send.status).toBe(200);
      expect(sentToken).toBeTypeOf('string');
      expect(seen.sendMagicLink).toBe('request-1');

      const verify = await request(port, {
        method: 'GET',
        path: `/api/auth/magic-link/verify?token=${encodeURIComponent(sentToken!)}&callbackURL=%2F`,
      });
      expect(verify.status).toBe(302);
      expect(seen).toEqual({
        sendMagicLink: 'request-1',
        userCreateBefore: 'request-2',
        userCreateAfter: 'request-2',
        sessionCreateAfter: 'request-2',
      });

      // The OAuth sign-up path creates the user inside runWithTransaction,
      // where the `after` hooks are queued until the transaction commits
      // (@better-auth/core context/transaction.mjs). Same library call the
      // callback uses for the user+account pair (link-account.mjs:274-285
      // wraps createUser + createAccount in runWithTransaction; the internal
      // adapter's createOAuthUser does exactly that).
      const ctx = await auth.$context;
      for (const key of Object.keys(seen)) delete seen[key];
      await als.run({ tag: 'oauth-path' }, () =>
        ctx.internalAdapter.createOAuthUser(
          { email: 'als.oauth@example.test', emailVerified: true, name: 'probe' },
          { providerId: 'google', accountId: 'als-oauth-1' },
        ),
      );
      expect(seen.userCreateBefore).toBe('oauth-path');
      expect(seen.userCreateAfter).toBe('oauth-path');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
