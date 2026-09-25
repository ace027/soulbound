/**
 * Phase 6 review cycle 1, server-side findings that need the real hosted app:
 *
 *  - S1: the session gate must not refresh the session row. If it does, the
 *    browser's own `GET /api/auth/get-session` finds nothing to refresh and
 *    never receives a renewed cookie, so a 30-day "rolling" session expires
 *    30 days after sign-in regardless of use.
 *  - S4: the purge also deletes expired magic-link `verification` rows, which
 *    hold whatever email was typed (even one with no account), inside the
 *    same transaction.
 *  - I1: SIGTERM waits long enough for a world-engine turn still in flight
 *    (Render's `maxShutdownDelaySeconds: 120`), and logs start and end.
 */
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { purgeDeletedAccounts } from '../../account.js';
import { SESSION_EXPIRES_IN_SECONDS, SESSION_UPDATE_AGE_SECONDS } from '../../auth.js';
import { closePoolOnSigterm, SHUTDOWN_TIMEOUT_MS } from '../../server.js';
import {
  PUBLIC_URL,
  SESSION_COOKIE,
  setCookies,
  startHostedApp,
  uniqueEmail,
  type HostedApp,
} from '../helpers/hostedApp.js';
import { withTestDb } from '../helpers/withTestDb.js';

const db = withTestDb();

let h: HostedApp;

beforeAll(async () => {
  h = await startHostedApp(db);
});
afterAll(async () => {
  await h.close();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The session row's token: the cookie value is `<token>.<signature>`, URL-encoded. */
function tokenOf(cookie: string): string {
  return decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)).split('.')[0]!;
}

async function sessionExpiry(cookie: string): Promise<number> {
  const { rows } = await h.deps.pool.query<{ expiresAt: Date }>('SELECT "expiresAt" FROM session WHERE token = $1', [
    tokenOf(cookie),
  ]);
  expect(rows).toHaveLength(1);
  return rows[0]!.expiresAt.getTime();
}

describe('S1: the session rolls through the browser, not the gate', () => {
  it('past updateAge, /api/access leaves the row alone, and get-session renews the cookie', async () => {
    const { cookie } = await h.signIn();
    const signedInExpiry = await sessionExpiry(cookie);

    // Only Date is faked: timers, sockets and the pg driver run normally.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + (SESSION_UPDATE_AGE_SECONDS + 60) * 1000);

    const access = await h.request({ method: 'GET', path: '/api/access', headers: { cookie } });
    expect(access.status).toBe(204);
    expect(setCookies(access).some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
    expect(await sessionExpiry(cookie)).toBe(signedInExpiry);

    const got = await h.request({ method: 'GET', path: '/api/auth/get-session', headers: { cookie } });
    expect(got.status).toBe(200);
    const renewed = setCookies(got).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(renewed, 'get-session must send back a renewed session cookie').toBeDefined();
    expect(renewed!.toLowerCase()).toContain(`max-age=${SESSION_EXPIRES_IN_SECONDS}`);
    const rolledExpiry = await sessionExpiry(cookie);
    expect(rolledExpiry).toBeGreaterThan(signedInExpiry);
    expect(rolledExpiry).toBe(Date.now() + SESSION_EXPIRES_IN_SECONDS * 1000);

    // The renewed cookie still opens the gate.
    const again = await h.request({ method: 'GET', path: '/api/access', headers: { cookie: renewed!.split(';')[0]! } });
    expect(again.status).toBe(204);
  });
});

describe('S4: the purge removes expired verification rows', () => {
  const rowsFor = async (email: string) =>
    (
      await h.deps.pool.query(
        `SELECT 1 FROM verification WHERE (CASE WHEN value IS JSON OBJECT THEN value::jsonb ->> 'email' END) = $1`,
        [email],
      )
    ).rows.length;

  const send = (email: string) =>
    h.request({ method: 'POST', path: '/api/auth/sign-in/magic-link', json: { email }, headers: { origin: PUBLIC_URL } });

  it('a stale row for an unknown email (no invite) is gone after a purge; a fresh one stays', async () => {
    // An address with no account and no invite: nothing is emailed, but
    // Better Auth still writes the row (with the typed address in `value`).
    const stale = uniqueEmail('stale-typed');
    expect((await send(stale)).status).toBe(200);
    expect(await rowsFor(stale)).toBe(1);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 400_000); // past the stale row's 300 s expiry
    const fresh = uniqueEmail('fresh-typed');
    expect((await send(fresh)).status).toBe(200);
    expect(await rowsFor(fresh)).toBe(1);

    const result = await purgeDeletedAccounts(h.deps.pool, new Date());
    expect(result.locked).toBe(true);
    expect(await rowsFor(stale)).toBe(0);
    expect(await rowsFor(fresh)).toBe(1);
  });

  it('the TTL delete is inside the purge transaction: a later failure leaves the row in place', async () => {
    const email = uniqueEmail('rollback-typed');
    expect((await send(email)).status).toBe(200);
    const failing = {
      connect: async () => {
        const client = await h.deps.pool.connect();
        const query = client.query.bind(client) as (text: string, values?: unknown[]) => Promise<unknown>;
        (client as unknown as { query: typeof query }).query = async (text: string, values?: unknown[]) => {
          if (/DELETE FROM "user"/.test(text)) throw Object.assign(new Error('forced'), { code: 'XX000' });
          return query(text, values);
        };
        return client;
      },
    } as unknown as Pool;
    await expect(purgeDeletedAccounts(failing, new Date(Date.now() + 400_000))).rejects.toThrow('forced');
    expect(await rowsFor(email)).toBe(1);
    // And the same purge, not forced to fail, removes it.
    await purgeDeletedAccounts(h.deps.pool, new Date(Date.now() + 400_000));
    expect(await rowsFor(email)).toBe(0);
  });
});

describe('I1: SIGTERM drains in-flight turns', () => {
  function fakes() {
    let onClosed: (() => void) | undefined;
    const server = { close: (cb: () => void) => void (onClosed = cb) } as unknown as Server;
    const pool = { end: vi.fn(async () => undefined) } as unknown as Pool;
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void lines.push(args.join(' ')));
    return { server, pool, exit, lines, closed: () => onClosed?.() };
  }

  it('the backstop is 110 s: nothing exits before it, exit(1) after, and both ends are logged', async () => {
    expect(SHUTDOWN_TIMEOUT_MS).toBe(110_000);
    vi.useFakeTimers();
    const f = fakes();
    closePoolOnSigterm(f.server, f.pool, async () => undefined);
    process.emit('SIGTERM');
    expect(f.lines.some((l) => l.startsWith('[shutdown] SIGTERM received'))).toBe(true);
    await vi.advanceTimersByTimeAsync(109_000);
    expect(f.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_001);
    expect(f.exit).toHaveBeenCalledWith(1);
    expect(f.lines.some((l) => l.startsWith('[shutdown] timed out'))).toBe(true);
  });

  it('a clean drain closes the pool, logs the end, and exits 0; no line carries request data', async () => {
    const f = fakes();
    closePoolOnSigterm(f.server, f.pool, async () => undefined);
    process.emit('SIGTERM');
    f.closed();
    await vi.waitFor(() => expect(f.exit).toHaveBeenCalledWith(0));
    expect(f.pool.end).toHaveBeenCalledTimes(1);
    expect(f.lines.some((l) => l.startsWith('[shutdown] drained'))).toBe(true);
    expect(f.lines.join('\n')).not.toMatch(/@|https?:\/\//);
  });
});
