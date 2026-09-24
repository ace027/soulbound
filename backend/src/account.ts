/**
 * Hosted-mode account deletion (spec R24d; Key Decisions → "Deletion grace"
 * and "Purge scheduling"; Data and Control Flow → Deletion).
 *
 *  - `requestAccountDeletion` records the request in `account_deletions` and
 *    revokes every session the user has, so an old cookie is refused on the
 *    very next request (`cookieCache` is off in auth.ts). The session gate
 *    also refuses any user with a pending row, as a second layer.
 *  - Signing in again within the grace period cancels it: auth.ts's
 *    `session.create.after` hook calls `cancelAccountDeletion`.
 *  - `purgeDeletedAccounts` hard-deletes users whose request is older than
 *    the grace period. The FK cascade removes their sessions, accounts and
 *    `account_deletions` row, and sets `invites.used_by` to null. It also
 *    deletes their magic-link `verification` rows, then runs the invite
 *    reconciliation (invites.ts).
 *  - `startPurgeSchedule` runs the purge shortly after boot, then hourly.
 *
 * Better Auth's own `deleteUser` is an immediate hard delete with no grace
 * period, so it is not used (and its HTTP route is disabled in auth.ts).
 *
 * Import-safe from anywhere: `pg` appears as a type only.
 */

import type { Pool, PoolClient } from 'pg';
import { reconcileInvites, type Queryable } from './invites.js';

/** How long a deletion stays reversible: 7 days (spec R24d). */
export const DELETION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The advisory-lock key the purge takes with `pg_try_advisory_xact_lock`.
 * Advisory locks are database-wide, so this only has to differ from any other
 * key used on the same database; nothing else in this app takes one. It is the
 * ASCII bytes of "sb-purge" read as a big-endian signed 64-bit integer
 * (0x73622d7075726765), so it is recognisable in `pg_locks`.
 */
export const PURGE_LOCK_KEY = 0x73622d7075726765n;

/** How often the purge runs: hourly. */
export const PURGE_INTERVAL_MS = 3_600_000;

/** How long after boot the first purge runs. */
export const PURGE_FIRST_RUN_DELAY_MS = 30_000;

/** Revokes every session of one user (auth.ts's `revokeUserSessions`). */
export interface SessionRevoker {
  revokeUserSessions(userId: string): Promise<void>;
}

/**
 * Records a deletion request (idempotent: an existing request keeps its
 * original time) and then revokes every session of the user. The row goes in
 * first, so even if the revocation fails the session gate already refuses
 * the user.
 */
export async function requestAccountDeletion(
  pool: Queryable,
  auth: SessionRevoker,
  userId: string,
  now: Date,
): Promise<void> {
  await pool.query(
    'INSERT INTO account_deletions (user_id, requested_at) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
    [userId, now],
  );
  await auth.revokeUserSessions(userId);
}

/** Cancels a pending deletion (a new sign-in within the grace period). A no-op when none is pending. */
export async function cancelAccountDeletion(pool: Queryable, userId: string): Promise<void> {
  await pool.query('DELETE FROM account_deletions WHERE user_id = $1', [userId]);
}

export interface PurgeResult {
  /** False when another holder had the lock: nothing was read or deleted. */
  locked: boolean;
  /** Users hard-deleted because their grace period had passed. */
  purged: number;
  /** The invite reconciliation's counts (present only when `locked`). */
  reconciled?: { marked: number; deleted: number };
}

export interface PurgeOptions {
  /** Test seam: awaited right after the lock is taken, inside the transaction. */
  afterLock?: () => Promise<void>;
}

/**
 * One purge, in one transaction on a client checked out for this job alone
 * (a transaction-scoped advisory lock is released at COMMIT, so it can't
 * linger on a pooled connection):
 *
 *   1. `pg_try_advisory_xact_lock(PURGE_LOCK_KEY)`; if another holder has it,
 *      roll back and return `locked: false` (never wait: the holder is doing
 *      the same work);
 *   2. delete the magic-link `verification` rows of the affected emails. The
 *      email is inside `value` as JSON (`{"email","name"}`); `identifier` is
 *      the hashed token (06-03-SUMMARY), so `identifier` is never matched.
 *      Rows whose `value` is not a JSON object (other Better Auth flows) are
 *      skipped without being cast, so they can't abort the purge;
 *   3. hard-delete the users whose request is older than the grace period
 *      (the cascade removes sessions, accounts and `account_deletions`, and
 *      sets `invites.used_by` to null);
 *   4. run the invite reconciliation.
 *
 * Every cutoff is computed from `now` and passed as a parameter; SQL `now()`
 * is never used, so an injected clock controls the whole job.
 */
export async function purgeDeletedAccounts(
  pool: Pick<Pool, 'connect'>,
  now: Date,
  options: PurgeOptions = {},
): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - DELETION_GRACE_MS);
  const client: PoolClient = await pool.connect();
  let failure: Error | undefined;
  try {
    await client.query('BEGIN');
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock($1::bigint) AS locked',
      [PURGE_LOCK_KEY.toString()],
    );
    if (lock.rows[0]?.locked !== true) {
      await client.query('ROLLBACK');
      return { locked: false, purged: 0 };
    }
    await options.afterLock?.();

    await client.query(
      `DELETE FROM verification v
        WHERE (CASE WHEN v.value IS JSON OBJECT THEN lower(btrim(v.value::jsonb ->> 'email')) END)
              IN (SELECT lower(u.email)
                    FROM "user" u
                    JOIN account_deletions d ON d.user_id = u.id
                   WHERE d.requested_at < $1)`,
      [cutoff],
    );
    const purged = await client.query(
      `DELETE FROM "user"
        WHERE id IN (SELECT user_id FROM account_deletions WHERE requested_at < $1)`,
      [cutoff],
    );
    const reconciled = await reconcileInvites(client, now);
    await client.query('COMMIT');
    return { locked: true, purged: purged.rowCount ?? 0, reconciled };
  } catch (err) {
    failure = err instanceof Error ? err : new Error(String(err));
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    // A failed client is destroyed rather than returned to the pool.
    client.release(failure);
  }
}

export interface PurgeScheduleOptions {
  intervalMs?: number;
  firstRunDelayMs?: number;
  /** The purge's clock. Default: the wall clock. */
  now?: () => Date;
  /** Receives one line per run: counts only, never an email or an id. */
  log?: (line: string) => void;
  /** Test seam: the job each tick runs. Default: `purgeDeletedAccounts(pool, now())`. */
  purge?: (pool: Pick<Pool, 'connect'>, now: Date) => Promise<PurgeResult>;
}

/**
 * Runs the purge once shortly after boot, then every `intervalMs`. Both timers
 * are `unref`'d, so they never keep the process alive. A tick is skipped while
 * the previous run is still going. A failure is logged (a fixed line plus the
 * Postgres error code, never the message, which can quote row data) and the
 * schedule carries on.
 *
 * Returns a stop function: it clears both timers and resolves once any run in
 * progress has finished, so SIGTERM can call it before `pool.end()`.
 */
export function startPurgeSchedule(
  pool: Pick<Pool, 'connect'>,
  options: PurgeScheduleOptions = {},
): () => Promise<void> {
  const intervalMs = options.intervalMs ?? PURGE_INTERVAL_MS;
  const firstRunDelayMs = options.firstRunDelayMs ?? PURGE_FIRST_RUN_DELAY_MS;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((line: string) => console.log(line));
  const purge = options.purge ?? ((p, at) => purgeDeletedAccounts(p, at));

  let running: Promise<void> | undefined;
  let stopped = false;

  const tick = (): void => {
    if (stopped || running !== undefined) return;
    running = purge(pool, now())
      .then(
        (result) => {
          if (!result.locked) {
            log('[purge] skipped: another instance holds the lock');
            return;
          }
          const r = result.reconciled;
          log(
            `[purge] purged ${result.purged} account(s)` +
              (r === undefined ? '' : `; invites reconciled: ${r.marked} marked, ${r.deleted} orphan(s) removed`),
          );
        },
        (err: unknown) => {
          const code = (err as { code?: unknown } | null)?.code;
          log(`[purge] failed${typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? ` (${code})` : ''}`);
        },
      )
      .finally(() => {
        running = undefined;
      });
  };

  const first = setTimeout(tick, firstRunDelayMs);
  first.unref();
  const interval = setInterval(tick, intervalMs);
  interval.unref();

  return async () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(interval);
    await running;
  };
}
