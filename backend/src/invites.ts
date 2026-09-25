/**
 * Invite codes for hosted-mode sign-up (spec R24c; Key Decisions → "Invite
 * carrier" and "Invite atomicity").
 *
 * The life of an invite:
 *  1. `createInvite` stores the SHA-256 of a fresh 128-bit code and returns
 *     the code ONCE (the `invite:create` script prints it). The code itself is
 *     never stored, logged or put in a cookie.
 *  2. `redeemInvite` checks a presented code and returns a signed
 *     `__Host-sb_invite` Set-Cookie value carrying `{inviteId, nonce, exp}`.
 *     A fresh random nonce is minted on every redeem.
 *  3. auth.ts's `user.create.before` hook calls `reserveInvite` (a
 *     nonce-scoped, retryable, expiring reservation); `user.create.after`
 *     calls `consumeInvite`. Both are the spec's SQL, plus `reserved_email`
 *     (spec Revision History row 21), which `reconcileInvites` joins on.
 *  4. `reconcileInvites` (run by 06-05's hourly purge) repairs the one gap a
 *     crash could leave: a user row whose invite was reserved but never
 *     consumed. It only touches EXPIRED reservations and fails closed.
 *
 * Import-safe from anywhere: only `node:crypto` and `@soulbound/shared` are
 * loaded; `pg` appears as a type only (erased at build). Nothing here reads
 * the environment: the HMAC key is derived from the secret the caller passes.
 */

import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { QueryResult, QueryResultRow } from 'pg';
import { INVITE_CODE_PATTERN } from '@soulbound/shared';

/** Anything that runs a parameterised query: a `pg` Pool, or one checked-out client. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

/** The invite cookie. `__Host-` pins it to this exact origin: Secure, Path=/, no Domain. */
export const COOKIE_NAME = '__Host-sb_invite';

/** How long a redeemed invite stays usable in the browser (seconds): 15 minutes. */
export const COOKIE_MAX_AGE_SECONDS = 900;

/** The exact attribute list on the invite cookie (5 attributes, spec "Invite carrier"). */
const COOKIE_ATTRIBUTES = `Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}`;

/** How long a `user.create.before` reservation holds an invite (minutes). The spec's `'10 min'`. */
export const RESERVATION_MINUTES = 10;

/**
 * Clock slack for reconciliation (minutes). A user's `createdAt` comes from the
 * APP's clock and is set before the `before` hook reserves (Better Auth builds
 * the row, then runs the hook: db/internal-adapter.mjs createUser), while
 * `reserved_until` comes from the DATABASE's clock. So a real orphan's
 * `createdAt` sits slightly BEFORE its reservation started, and two hosts'
 * clocks can disagree. The window is widened by this much on both sides.
 */
export const RECONCILE_SLACK_MINUTES = 2;

/** HKDF `info` string for the invite cookie's HMAC key (spec "Invite carrier"). */
const COOKIE_KEY_INFO = 'soulbound/sb_invite';

/** HMAC-SHA256 output length in bytes. */
const MAC_BYTES = 32;

/** Nonce length in bytes (128 bits); base64url-encoded that is 22 characters. */
const NONCE_BYTES = 16;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** What the invite cookie carries. Never the raw code. `exp` is epoch milliseconds. */
export interface InvitePayload {
  inviteId: string;
  nonce: string;
  exp: number;
}

// ─── Codes ──────────────────────────────────────────────────────────────────

/** A fresh invite code: 128 random bits as base64url (22 characters). */
export function generateInviteCode(): string {
  return randomBytes(16).toString('base64url');
}

/** SHA-256 of a code, as stored in `invites.code_hash`. */
export function hashCode(code: string): Buffer {
  return createHash('sha256').update(code, 'utf8').digest();
}

/**
 * Stores a new invite and returns its code. This is the only time the code
 * exists outside the player's hands: only its hash is written.
 */
export async function createInvite(
  db: Queryable,
  options: { expiresInDays?: number } = {},
): Promise<{ id: string; code: string; expiresAt: Date }> {
  const code = generateInviteCode();
  const days = options.expiresInDays;
  if (days !== undefined && !(Number.isInteger(days) && days > 0 && days <= 365)) {
    throw new Error('expiresInDays must be a whole number of days from 1 to 365');
  }
  const result =
    days === undefined
      ? await db.query<{ id: string; expires_at: Date }>(
          'INSERT INTO invites (code_hash) VALUES ($1) RETURNING id, expires_at',
          [hashCode(code)],
        )
      : await db.query<{ id: string; expires_at: Date }>(
          "INSERT INTO invites (code_hash, expires_at) VALUES ($1, now() + make_interval(days => $2)) RETURNING id, expires_at",
          [hashCode(code), days],
        );
  const row = result.rows[0]!;
  return { id: row.id, code, expiresAt: row.expires_at };
}

// ─── Cookie ─────────────────────────────────────────────────────────────────

/** The invite cookie's HMAC key, derived from BETTER_AUTH_SECRET by HKDF-SHA256. */
export function inviteCookieKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, '', COOKIE_KEY_INFO, MAC_BYTES));
}

function mac(key: Buffer, encodedPayload: string): Buffer {
  return createHmac('sha256', key).update(encodedPayload, 'utf8').digest();
}

/** `base64url(JSON payload).base64url(HMAC-SHA256(key, first part))`. */
export function signInviteCookie(key: Buffer, payload: InvitePayload): string {
  const encoded = Buffer.from(
    JSON.stringify({ inviteId: payload.inviteId, nonce: payload.nonce, exp: payload.exp }),
    'utf8',
  ).toString('base64url');
  return `${encoded}.${mac(key, encoded).toString('base64url')}`;
}

/**
 * Returns the payload if `value` carries a valid MAC under `key` and has not
 * expired at `now` (epoch ms); otherwise `null`. The MAC is checked first —
 * its length, then a constant-time compare — and the payload is parsed only
 * after it verifies, so unauthenticated bytes never reach `JSON.parse`.
 */
export function verifyInviteCookie(key: Buffer, value: string, now: number = Date.now()): InvitePayload | null {
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [encoded, macPart] = parts as [string, string];
  if (encoded.length === 0 || !/^[A-Za-z0-9_-]+$/.test(macPart)) return null;
  const presented = Buffer.from(macPart, 'base64url');
  if (presented.length !== MAC_BYTES) return null;
  if (!timingSafeEqual(presented, mac(key, encoded))) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { inviteId, nonce, exp } = parsed as Record<string, unknown>;
  if (typeof inviteId !== 'string' || !UUID_PATTERN.test(inviteId)) return null;
  if (typeof nonce !== 'string' || !NONCE_PATTERN.test(nonce)) return null;
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= now) return null;
  return { inviteId, nonce, exp };
}

/** The full `Set-Cookie` header value for a signed invite cookie. */
export function serializeInviteCookie(signed: string): string {
  return `${COOKIE_NAME}=${signed}; ${COOKIE_ATTRIBUTES}`;
}

/** The `Set-Cookie` header value that clears the invite cookie. */
export function clearInviteCookie(): string {
  return `${COOKIE_NAME}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

/**
 * Finds the invite cookie in a raw `Cookie` request header (no cookie-parser
 * dependency). Returns the first value for `COOKIE_NAME`, or `undefined`.
 */
export function readInviteCookie(cookieHeader: string | string[] | undefined): string | undefined {
  const header = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;
  if (header === undefined) return undefined;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === COOKIE_NAME) return pair.slice(eq + 1).trim();
  }
  return undefined;
}

// ─── Redeem ─────────────────────────────────────────────────────────────────

/** SQL predicate for "this invite can still be taken by `nonce`" (shared by redeem, send gating, reserve). */
const INVITE_AVAILABLE = `used_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())`;

/**
 * Checks a presented code. On success returns the invite id and the
 * `Set-Cookie` value for a fresh, signed `__Host-sb_invite` (new nonce every
 * time). Every failure — malformed, unknown, used, expired, held by someone
 * else's live reservation — returns `null` down one path, so the HTTP layer
 * can answer all of them identically (400 INVITE_INVALID).
 */
export async function redeemInvite(
  db: Queryable,
  code: unknown,
  options: { key: Buffer; now?: () => number },
): Promise<{ inviteId: string; setCookie: string } | null> {
  if (typeof code !== 'string' || !INVITE_CODE_PATTERN.test(code)) return null;
  const result = await db.query<{ id: string }>(
    `SELECT id FROM invites
      WHERE code_hash = $1
        AND ${INVITE_AVAILABLE}
        AND (reserved_until IS NULL OR reserved_until < now())`,
    [hashCode(code)],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  const now = (options.now ?? Date.now)();
  const payload: InvitePayload = {
    inviteId: row.id,
    nonce: randomBytes(NONCE_BYTES).toString('base64url'),
    exp: now + COOKIE_MAX_AGE_SECONDS * 1000,
  };
  return { inviteId: row.id, setCookie: serializeInviteCookie(signInviteCookie(options.key, payload)) };
}

/**
 * Whether the invite a cookie names can still be used by that cookie's holder:
 * unused, unexpired, and not reserved by a different nonce. The magic-link
 * send gate uses it (plan critique 2), so a cookie for an invite that has
 * since been consumed or has expired sends nothing.
 */
export async function inviteUsable(db: Queryable, invite: Pick<InvitePayload, 'inviteId' | 'nonce'>): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM invites
      WHERE id = $1
        AND ${INVITE_AVAILABLE}
        AND (reserved_until IS NULL OR reserved_until < now() OR reserved_nonce = $2)`,
    [invite.inviteId, Buffer.from(invite.nonce, 'base64url')],
  );
  return result.rows.length > 0;
}

// ─── Reserve / consume (spec "Invite atomicity") ───────────────────────────

/**
 * Step 2: reserve the invite for this nonce for RESERVATION_MINUTES. Single
 * winner under concurrency (the row lock serialises the two UPDATEs, and the
 * loser's re-evaluated WHERE fails); the same nonce may retry; an abandoned
 * reservation lapses. `reserved_email` is recorded for reconciliation.
 * Returns true if this nonce now holds the invite.
 */
export async function reserveInvite(
  db: Queryable,
  args: { inviteId: string; nonce: string; email: string },
): Promise<boolean> {
  const result = await db.query(
    `UPDATE invites
        SET reserved_until = now() + interval '${RESERVATION_MINUTES} min',
            reserved_nonce = $2,
            reserved_email = $3
      WHERE id = $1
        AND used_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
        AND (reserved_until IS NULL OR reserved_until < now() OR reserved_nonce = $2)
      RETURNING id`,
    [args.inviteId, Buffer.from(args.nonce, 'base64url'), normalizeEmail(args.email)],
  );
  return result.rows.length > 0;
}

/**
 * Step 3: mark the invite used by `userId`, but only if this nonce still holds
 * it and nobody has used it. Returns true when exactly this call consumed it.
 */
export async function consumeInvite(
  db: Queryable,
  args: { inviteId: string; nonce: string; userId: string },
): Promise<boolean> {
  const result = await db.query(
    `UPDATE invites SET used_by = $3, used_at = now()
      WHERE id = $1 AND reserved_nonce = $2 AND used_at IS NULL`,
    [args.inviteId, Buffer.from(args.nonce, 'base64url'), args.userId],
  );
  return result.rowCount === 1;
}

/** Emails are compared lower-cased and trimmed (Better Auth stores them lower-cased). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ─── Reconcile (spec "Invite atomicity" step 4; called by 06-05's purge) ───

/**
 * Repairs what a crash between the user insert and `consumeInvite` could
 * leave behind. Touches only rows whose reservation has EXPIRED at `now`
 * (never a live one, whose `after` hook may still be running):
 *
 *  1. Mark: an expired, unconsumed reservation whose `reserved_email` matches
 *     a user created inside that reservation's window (widened by
 *     RECONCILE_SLACK_MINUTES each side), who is not already
 *     `used_by` another invite, gets that user recorded as its consumer. One
 *     user per invite even if two expired reservations name the same email
 *     (the earliest-created invite wins; the other stays unconsumed).
 *  2. Delete (fail closed): a user who consumes no invite, was created more
 *     than one reservation window plus the slack before `now` (so no live `after` hook can
 *     still be about to consume one), and is not named by any live
 *     reservation, is deleted. The FK cascade removes their sessions and
 *     accounts.
 *
 * `db` may be a checked-out client inside the purge's transaction.
 */
export async function reconcileInvites(
  db: Queryable,
  now: Date,
): Promise<{ marked: number; deleted: number }> {
  const marked = await db.query(
    `WITH candidates AS (
       SELECT DISTINCT ON (u.id) i.id AS invite_id, u.id AS user_id
         FROM invites i
         JOIN "user" u
           ON u.email = i.reserved_email
          AND u."createdAt" >= i.reserved_until - interval '${RESERVATION_MINUTES + RECONCILE_SLACK_MINUTES} min'
          AND u."createdAt" <= i.reserved_until + interval '${RECONCILE_SLACK_MINUTES} min'
        WHERE i.used_at IS NULL
          AND i.reserved_until IS NOT NULL
          AND i.reserved_until < $1
          AND NOT EXISTS (SELECT 1 FROM invites other WHERE other.used_by = u.id)
        ORDER BY u.id, i.created_at, i.id
     )
     UPDATE invites i
        SET used_by = c.user_id, used_at = $1
       FROM candidates c
      WHERE i.id = c.invite_id AND i.used_at IS NULL
      RETURNING i.id`,
    [now],
  );
  const deleted = await db.query(
    `DELETE FROM "user" u
      WHERE u."createdAt" < $1::timestamptz - interval '${RESERVATION_MINUTES + RECONCILE_SLACK_MINUTES} min'
        AND NOT EXISTS (SELECT 1 FROM invites i WHERE i.used_by = u.id)
        AND NOT EXISTS (
          SELECT 1 FROM invites i
           WHERE i.reserved_email = u.email AND i.used_at IS NULL AND i.reserved_until >= $1
        )
      RETURNING u.id`,
    [now],
  );
  return { marked: marked.rowCount ?? 0, deleted: deleted.rowCount ?? 0 };
}
