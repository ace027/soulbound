/**
 * The account purge (spec R24d; Key Decisions → "Purge scheduling"; plan
 * 06-05 and its critique block) on real Postgres, with an injected clock.
 *
 * Players are made through the real hosted app (magic-link sign-in), so the
 * `verification` rows the purge must remove are the ones Better Auth itself
 * writes for a real `/api/auth/sign-in/magic-link` call (critique 1), never
 * hand-seeded ones. Each player also consumes an invite, so the invite
 * reconciliation (which deletes invite-less users past its window) leaves
 * them alone and only the grace period decides.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DELETION_GRACE_MS,
  PURGE_INTERVAL_MS,
  PURGE_LOCK_KEY,
  purgeDeletedAccounts,
  startPurgeSchedule,
  type PurgeResult,
} from '../../account.js';
import { createInvite, reserveInvite } from '../../invites.js';
import { PUBLIC_URL, startHostedApp, type HostedApp } from '../helpers/hostedApp.js';
import { withTestDb } from '../helpers/withTestDb.js';

const db = withTestDb();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let h: HostedApp;

beforeAll(async () => {
  h = await startHostedApp(db);
});
afterAll(async () => {
  await h.close();
});

const q = <R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) =>
  h.deps.pool.query<R>(text, values).then((r) => r.rows);

/** Verification rows whose JSON `value` names this email (06-03: the email lives in `value`). */
const verificationRowsFor = (email: string) =>
  q(`SELECT id FROM verification WHERE (CASE WHEN value IS JSON OBJECT THEN value::jsonb ->> 'email' END) = $1`, [email]);

interface Player {
  userId: string;
  email: string;
  inviteId: string;
}

/**
 * A signed-in player with a session, an `account` row, a consumed invite, one
 * outstanding magic-link `verification` row (from a real send), and a
 * deletion requested at `requestedAt`.
 */
async function deletedPlayer(label: string, requestedAt: Date): Promise<Player> {
  const { userId, email } = await h.signIn(`${label}-${randomUUID().slice(0, 8)}@example.test`);
  await q(
    `INSERT INTO account (id, "accountId", "providerId", "userId", "updatedAt") VALUES ($1, $2, 'google', $3, now())`,
    [randomUUID(), randomUUID(), userId],
  );
  const { id: inviteId } = await createInvite(h.deps.pool);
  await q('UPDATE invites SET used_by = $2, used_at = now() WHERE id = $1', [inviteId, userId]);
  const send = await h.request({
    method: 'POST',
    path: '/api/auth/sign-in/magic-link',
    json: { email },
    headers: { origin: PUBLIC_URL },
  });
  expect(send.status).toBe(200);
  expect((await verificationRowsFor(email)).length).toBeGreaterThanOrEqual(1);
  await q('INSERT INTO account_deletions (user_id, requested_at) VALUES ($1, $2)', [userId, requestedAt]);
  return { userId, email, inviteId };
}

const userExists = async (id: string) => (await q('SELECT 1 FROM "user" WHERE id = $1', [id])).length === 1;

describe('purgeDeletedAccounts: the grace period, on the injected clock', () => {
  it('6 days 23 hours after the request: not purged; 7 days 1 minute after: purged', async () => {
    const t0 = new Date();
    const p = await deletedPlayer('grace', t0);

    const early = await purgeDeletedAccounts(h.deps.pool, new Date(t0.getTime() + 6 * 24 * HOUR + 23 * HOUR));
    expect(early.locked).toBe(true);
    expect(await userExists(p.userId)).toBe(true);
    expect((await verificationRowsFor(p.email)).length).toBeGreaterThanOrEqual(1);
    expect(await q('SELECT 1 FROM account_deletions WHERE user_id = $1', [p.userId])).toHaveLength(1);

    const late = await purgeDeletedAccounts(h.deps.pool, new Date(t0.getTime() + DELETION_GRACE_MS + MINUTE));
    expect(late.locked).toBe(true);
    expect(late.purged).toBeGreaterThanOrEqual(1);
    expect(await userExists(p.userId)).toBe(false);
  });

  it('a purge removes the user, session, account, account_deletions and verification rows; invites.used_by → null, used_at kept', async () => {
    const t0 = new Date();
    const p = await deletedPlayer('cascade', t0);
    // A bystander: signed in, same kind of verification row, no deletion.
    const { userId: keptId, email: keptEmail } = await h.signIn();
    await q('INSERT INTO invites (code_hash, used_by, used_at) VALUES ($1, $2, now())', [randomBytes(32), keptId]);
    await h.request({ method: 'POST', path: '/api/auth/sign-in/magic-link', json: { email: keptEmail }, headers: { origin: PUBLIC_URL } });
    const keptVerifications = (await verificationRowsFor(keptEmail)).length;
    expect(keptVerifications).toBeGreaterThanOrEqual(1);

    const [before] = await q<{ used_at: Date }>('SELECT used_at FROM invites WHERE id = $1', [p.inviteId]);
    expect(await q('SELECT 1 FROM session WHERE "userId" = $1', [p.userId])).not.toHaveLength(0);

    const result = await purgeDeletedAccounts(h.deps.pool, new Date(t0.getTime() + DELETION_GRACE_MS + MINUTE));
    expect(result.locked).toBe(true);

    expect(await userExists(p.userId)).toBe(false);
    expect(await q('SELECT 1 FROM session WHERE "userId" = $1', [p.userId])).toHaveLength(0);
    expect(await q('SELECT 1 FROM account WHERE "userId" = $1', [p.userId])).toHaveLength(0);
    expect(await q('SELECT 1 FROM account_deletions WHERE user_id = $1', [p.userId])).toHaveLength(0);
    expect(await verificationRowsFor(p.email)).toHaveLength(0);
    const [after] = await q<{ used_by: string | null; used_at: Date | null }>(
      'SELECT used_by, used_at FROM invites WHERE id = $1',
      [p.inviteId],
    );
    expect(after!.used_by).toBeNull();
    expect(after!.used_at?.toISOString()).toBe(before!.used_at.toISOString());

    // Nobody else's rows were touched.
    expect(await userExists(keptId)).toBe(true);
    expect((await verificationRowsFor(keptEmail)).length).toBe(keptVerifications);
  });

  it('a verification row whose value is not JSON neither aborts the purge nor is deleted', async () => {
    const t0 = new Date();
    const p = await deletedPlayer('nonjson', t0);
    const oddId = randomUUID();
    await q(
      `INSERT INTO verification (id, identifier, value, "expiresAt") VALUES ($1, $2, 'not json {', now() + interval '5 min')`,
      [oddId, randomUUID()],
    );
    const result = await purgeDeletedAccounts(h.deps.pool, new Date(t0.getTime() + DELETION_GRACE_MS + MINUTE));
    expect(result.locked).toBe(true);
    expect(await userExists(p.userId)).toBe(false);
    expect(await q('SELECT 1 FROM verification WHERE id = $1', [oddId])).toHaveLength(1);
  });

  it('runs the invite reconciliation: the orphan (reserved, never consumed) gets marked', async () => {
    const email = `orphan-${randomUUID()}@example.test`;
    const { id: inviteId } = await createInvite(h.deps.pool);
    // As in invites.test.ts: Better Auth stamps createdAt (app clock) before
    // the hook reserves (DB clock), so a real orphan's createdAt comes first.
    const userId = randomUUID();
    const createdAt = new Date(Date.now() - 1000);
    await q(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, '', $2, true, $3, $3)`,
      [userId, email, createdAt],
    );
    expect(await reserveInvite(h.deps.pool, { inviteId, nonce: randomBytes(16).toString('base64url'), email })).toBe(true);

    const result = await purgeDeletedAccounts(h.deps.pool, new Date(Date.now() + 13 * MINUTE));
    expect(result.locked).toBe(true);
    expect(result.reconciled?.marked).toBeGreaterThanOrEqual(1);
    const [row] = await q<{ used_by: string | null }>('SELECT used_by FROM invites WHERE id = $1', [inviteId]);
    expect(row!.used_by).toBe(userId);
    expect(await userExists(userId)).toBe(true);
  });
});

describe('purgeDeletedAccounts: at most one holder of the lock', () => {
  it('(a) while a third client holds the lock, both purges return locked: false and delete nothing', async () => {
    const t0 = new Date();
    const p = await deletedPlayer('locked', t0);
    const holder = await h.deps.pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock($1::bigint)', [PURGE_LOCK_KEY.toString()]);

      const at = new Date(t0.getTime() + DELETION_GRACE_MS + MINUTE);
      const results = await Promise.all([purgeDeletedAccounts(h.deps.pool, at), purgeDeletedAccounts(h.deps.pool, at)]);
      expect(results).toEqual([
        { locked: false, purged: 0 },
        { locked: false, purged: 0 },
      ]);
      expect(await userExists(p.userId)).toBe(true);
      expect((await verificationRowsFor(p.email)).length).toBeGreaterThanOrEqual(1);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
  });

  it('(b) two concurrent purges, paused inside the transaction after the lock: exactly one locked: true', { repeats: 10 }, async () => {
    const at = new Date(Date.now() + DELETION_GRACE_MS + MINUTE);
    const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 150));
    const results: PurgeResult[] = await Promise.all([
      purgeDeletedAccounts(h.deps.pool, at, { afterLock: pause }),
      purgeDeletedAccounts(h.deps.pool, at, { afterLock: pause }),
    ]);
    expect(results.filter((r) => r.locked)).toHaveLength(1);
    expect(results.filter((r) => !r.locked)).toEqual([{ locked: false, purged: 0 }]);
  });

  it('the lock is transaction-scoped: after a purge commits, nothing still holds it', async () => {
    await purgeDeletedAccounts(h.deps.pool, new Date());
    const held = await q(
      `SELECT 1 FROM pg_locks WHERE locktype = 'advisory'
          AND ((classid::bigint << 32) | objid::bigint) = $1::bigint`,
      [PURGE_LOCK_KEY.toString()],
    );
    expect(held).toHaveLength(0);
  });
});

describe('startPurgeSchedule', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const fakePool = { connect: () => Promise.reject(new Error('not used')) } as never;

  it('runs shortly after boot, then every interval, logging counts only; stop clears its timers', async () => {
    vi.useFakeTimers();
    const at = new Date('2026-09-24T12:00:00Z');
    const calls: Date[] = [];
    const lines: string[] = [];
    const stop = startPurgeSchedule(fakePool, {
      now: () => at,
      log: (line) => lines.push(line),
      purge: async (_pool, when) => {
        calls.push(when);
        return { locked: true, purged: 2, reconciled: { marked: 1, deleted: 0 } };
      },
    });
    expect(vi.getTimerCount()).toBe(2);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([at]);
    await vi.advanceTimersByTimeAsync(PURGE_INTERVAL_MS);
    expect(calls).toHaveLength(2);
    expect(PURGE_INTERVAL_MS).toBe(3_600_000);
    expect(lines).toEqual([
      '[purge] purged 2 account(s); invites reconciled: 1 marked, 0 orphan(s) removed',
      '[purge] purged 2 account(s); invites reconciled: 1 marked, 0 orphan(s) removed',
    ]);

    await stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3 * PURGE_INTERVAL_MS);
    expect(calls).toHaveLength(2);
  });

  it('logs a skipped run and a failure without the error message; stop waits for a run in progress', async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    let finish: (() => void) | undefined;
    let n = 0;
    const stop = startPurgeSchedule(fakePool, {
      intervalMs: 1000,
      firstRunDelayMs: 10,
      log: (line) => lines.push(line),
      purge: async () => {
        n += 1;
        if (n === 1) return { locked: false, purged: 0 };
        if (n === 2) throw Object.assign(new Error('duplicate key: player@example.test'), { code: '23505' });
        await new Promise<void>((resolve) => (finish = resolve));
        return { locked: true, purged: 0 };
      },
    });
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(n).toBe(3);
    // A tick while the third run is still going is skipped.
    await vi.advanceTimersByTimeAsync(1000);
    expect(n).toBe(3);
    expect(lines).toEqual(['[purge] skipped: another instance holds the lock', '[purge] failed (23505)']);
    expect(lines.join('\n')).not.toContain('@');

    let stopped = false;
    const stopping = stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    finish!();
    await stopping;
    expect(stopped).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('on real timers: both timers are unref’d, and the default job is the real purge', async () => {
    const t0 = new Date();
    const p = await deletedPlayer('scheduled', t0);

    const handles: { hasRef(): boolean }[] = [];
    const realTimeout = globalThis.setTimeout;
    const realInterval = globalThis.setInterval;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((...args: Parameters<typeof setTimeout>) => {
      const t = realTimeout(...args);
      handles.push(t);
      return t;
    }) as typeof setTimeout);
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((...args: Parameters<typeof setInterval>) => {
      const t = realInterval(...args);
      handles.push(t);
      return t;
    }) as typeof setInterval);

    const lines: string[] = [];
    const stop = startPurgeSchedule(h.deps.pool, {
      firstRunDelayMs: 0,
      now: () => new Date(t0.getTime() + DELETION_GRACE_MS + MINUTE),
      log: (line) => lines.push(line),
    });
    vi.restoreAllMocks();
    expect(handles).toHaveLength(2);
    expect(handles.map((t) => t.hasRef())).toEqual([false, false]);

    for (let i = 0; i < 100 && lines.length === 0; i += 1) await new Promise((r) => setTimeout(r, 20));
    await stop();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[purge\] purged \d+ account\(s\)/);
    expect(lines[0]).not.toContain('@');
    expect(await userExists(p.userId)).toBe(false);
  });
});
