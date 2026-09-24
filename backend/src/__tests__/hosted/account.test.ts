/**
 * Account deletion (spec R24d; plan 06-05): `DELETE /api/account` through the
 * production `buildHostedDeps()` + `buildApp()` on real Postgres, with the
 * real `requestAccountDeletion` (helper option `'real'`), and the auth body
 * cap mounted in front of step 10 (06-05 build addendum).
 */
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN_REJECTED, SIGN_IN_REQUIRED } from '@soulbound/shared';
import { requestAccountDeletion } from '../../account.js';
import { AUTH_BODY_LIMIT_BYTES } from '../../server.js';
import {
  PUBLIC_URL,
  SESSION_COOKIE,
  setCookies,
  startHostedApp,
  type HostedApp,
  type Result,
} from '../helpers/hostedApp.js';
import { withTestDb } from '../helpers/withTestDb.js';

const db = withTestDb();

function errorCode(res: Result): unknown {
  return (res.json as { error?: { code?: unknown } } | undefined)?.error?.code;
}

const CLEARED = `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;

describe('DELETE /api/account (R24d)', () => {
  let h: HostedApp;

  beforeAll(async () => {
    h = await startHostedApp(db, { requestAccountDeletion: 'real' });
  });
  afterAll(async () => {
    await h.close();
  });

  const access = (cookie?: string) =>
    h.request({ method: 'GET', path: '/api/access', headers: cookie === undefined ? {} : { cookie } });
  const del = (cookie?: string, origin: string = PUBLIC_URL) =>
    h.request({
      method: 'DELETE',
      path: '/api/account',
      headers: { origin, ...(cookie === undefined ? {} : { cookie }) },
    });
  const pendingRows = async (userId: string) =>
    (await h.deps.pool.query('SELECT requested_at FROM account_deletions WHERE user_id = $1', [userId])).rows;
  const sessionCount = async (userId: string) =>
    Number(
      (await h.deps.pool.query<{ n: string }>('SELECT count(*) AS n FROM session WHERE "userId" = $1', [userId]))
        .rows[0]!.n,
    );

  it('with the right Origin → 204, clears the session cookie, and records the deletion', async () => {
    const { cookie, userId } = await h.signIn();
    expect((await access(cookie)).status).toBe(204);

    const res = await del(cookie);
    expect(res.status).toBe(204);
    expect(setCookies(res)).toContain(CLEARED);
    expect(await pendingRows(userId)).toHaveLength(1);
  });

  it('the same old cookie gets 401 SIGN_IN_REQUIRED on the very next request', async () => {
    const { cookie } = await h.signIn();
    expect((await del(cookie)).status).toBe(204);

    const res = await access(cookie);
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe(SIGN_IN_REQUIRED);
  });

  it('every session is revoked: a second session made before the delete also gets 401, and no session row remains', async () => {
    const { cookie: first, userId, email } = await h.signIn();
    const { cookie: second } = await h.signIn(email);
    expect(second).not.toBe(first);
    expect(await sessionCount(userId)).toBe(2);

    expect((await del(second)).status).toBe(204);

    expect(await sessionCount(userId)).toBe(0);
    for (const cookie of [first, second]) {
      const res = await access(cookie);
      expect(res.status).toBe(401);
      expect(errorCode(res)).toBe(SIGN_IN_REQUIRED);
    }
  });

  it('revocation stands on its own: the old cookies stay dead even if the deletion row is removed', async () => {
    // The session gate also refuses a user with a pending row; this proves the
    // sessions themselves are gone, not merely hidden behind that check.
    const { cookie: first, userId, email } = await h.signIn();
    const { cookie: second } = await h.signIn(email);
    expect((await del(first)).status).toBe(204);

    await h.deps.pool.query('DELETE FROM account_deletions WHERE user_id = $1', [userId]);
    for (const cookie of [first, second]) {
      expect((await access(cookie)).status).toBe(401);
    }
  });

  it('signing in again (magic link, existing email, no invite) cancels the deletion, and the account works', async () => {
    const { cookie, userId, email } = await h.signIn();
    expect((await del(cookie)).status).toBe(204);
    expect(await pendingRows(userId)).toHaveLength(1);

    const again = await h.signIn(email);
    expect(again.userId).toBe(userId);
    expect(await pendingRows(userId)).toHaveLength(0);
    expect((await access(again.cookie)).status).toBe(204);
  });

  it('a repeated DELETE after signing in again is idempotent: one row, 204, sessions revoked again', async () => {
    const { cookie, userId, email } = await h.signIn();
    expect((await del(cookie)).status).toBe(204);
    const again = await h.signIn(email);
    expect(await pendingRows(userId)).toHaveLength(0);

    const res = await del(again.cookie);
    expect(res.status).toBe(204);
    expect(setCookies(res)).toContain(CLEARED);
    expect(await pendingRows(userId)).toHaveLength(1);
    expect(await sessionCount(userId)).toBe(0);
    expect((await access(again.cookie)).status).toBe(401);
  });

  it('requestAccountDeletion twice keeps one row and the ORIGINAL request time', async () => {
    const { userId } = await h.signIn();
    const revoked: string[] = [];
    const revoker = { revokeUserSessions: async (id: string) => void revoked.push(id) };
    const t1 = new Date('2026-01-01T00:00:00Z');
    const t2 = new Date('2026-01-05T00:00:00Z');
    await requestAccountDeletion(h.deps.pool, revoker, userId, t1);
    await requestAccountDeletion(h.deps.pool, revoker, userId, t2);
    const rows = await pendingRows(userId);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { requested_at: Date }).requested_at.toISOString()).toBe(t1.toISOString());
    expect(revoked).toEqual([userId, userId]);
  });

  it('without a session → 401 SIGN_IN_REQUIRED, and nothing is recorded', async () => {
    const before = Number((await h.deps.pool.query<{ n: string }>('SELECT count(*) AS n FROM account_deletions')).rows[0]!.n);
    const res = await del(undefined);
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe(SIGN_IN_REQUIRED);
    const after = Number((await h.deps.pool.query<{ n: string }>('SELECT count(*) AS n FROM account_deletions')).rows[0]!.n);
    expect(after).toBe(before);
  });

  it('with a foreign Origin → 403 ORIGIN_REJECTED, and the account is untouched', async () => {
    const { cookie, userId } = await h.signIn();
    const res = await del(cookie, 'https://evil.example');
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe(ORIGIN_REJECTED);
    expect(await pendingRows(userId)).toHaveLength(0);
    expect(await sessionCount(userId)).toBe(1);
    expect((await access(cookie)).status).toBe(204);
  });
});

/**
 * A chunked POST (no Content-Length). Resolves with the status, or with
 * `'reset'` when the server drops the connection before answering.
 */
function chunkedPost(port: number, path: string, chunks: string[]): Promise<number | 'reset'> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: 'POST',
        path,
        headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked', origin: PUBLIC_URL },
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          clearTimeout(timer);
          resolve(res.statusCode ?? 0);
        });
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`chunked POST ${path} timed out`));
    }, 2000);
    req.on('error', () => {
      clearTimeout(timer);
      resolve('reset');
    });
    let i = 0;
    const writeNext = () => {
      if (i >= chunks.length) {
        req.end();
        return;
      }
      const chunk = chunks[i++]!;
      if (req.write(chunk)) setImmediate(writeNext);
      else req.once('drain', writeNext);
    };
    writeNext();
  });
}

describe('the /api/auth body cap (06-05 build addendum)', () => {
  let h: HostedApp;

  beforeAll(async () => {
    h = await startHostedApp(db);
  });
  afterAll(async () => {
    await h.close();
  });

  it('is 16 KB', () => {
    expect(AUTH_BODY_LIMIT_BYTES).toBe(16 * 1024);
  });

  it('a 17 KB magic-link POST (Content-Length) → 413 PAYLOAD_TOO_LARGE, and nothing is sent', async () => {
    const sentBefore = h.sent.length;
    const email = 'big@example.test';
    const raw = JSON.stringify({ email, name: 'x'.repeat(17 * 1024) });
    expect(Buffer.byteLength(raw)).toBeGreaterThan(17 * 1024);
    const res = await h.request({
      method: 'POST',
      path: '/api/auth/sign-in/magic-link',
      raw,
      headers: { origin: PUBLIC_URL },
    });
    expect(res.status).toBe(413);
    expect(errorCode(res)).toBe('PAYLOAD_TOO_LARGE');
    expect(h.sent.length).toBe(sentBefore);
  });

  it('a body exactly at the limit still reaches Better Auth', async () => {
    const base = JSON.stringify({ email: 'edge@example.test', name: '' });
    const raw = JSON.stringify({ email: 'edge@example.test', name: 'y'.repeat(AUTH_BODY_LIMIT_BYTES - Buffer.byteLength(base)) });
    expect(Buffer.byteLength(raw)).toBe(AUTH_BODY_LIMIT_BYTES);
    const res = await h.request({ method: 'POST', path: '/api/auth/sign-in/magic-link', raw, headers: { origin: PUBLIC_URL } });
    expect(res.status).toBe(200);
  });

  it('a chunked body past 16 KB is cut off; a small chunked body still reaches Better Auth; the server stays up', async () => {
    const big = Array.from({ length: 20 }, () => 'z'.repeat(1024));
    expect(await chunkedPost(h.port, '/api/auth/sign-in/magic-link', ['{"email":"c@example.test","name":"', ...big, '"}'])).toBe(
      'reset',
    );

    const small = await chunkedPost(h.port, '/api/auth/sign-in/magic-link', ['{"email":', '"small@example.test"}']);
    expect(small).toBe(200);
    expect((await h.request({ method: 'GET', path: '/api/health' })).status).toBe(200);
  });

  it('a normal sign-in still works end to end', async () => {
    const { cookie } = await h.signIn();
    expect((await h.request({ method: 'GET', path: '/api/access', headers: { cookie } })).status).toBe(204);
  });
});
