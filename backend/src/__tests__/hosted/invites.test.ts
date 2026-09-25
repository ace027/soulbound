/**
 * invites.ts against real Postgres (spec R24c; Key Decisions → "Invite
 * atomicity"): hash-only storage, one answer for every bad code, the
 * nonce-scoped reservation (single winner under a race, retryable by its
 * holder, lapsing when abandoned), consumption, and the purge's
 * reconciliation (plan critique 1).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  consumeInvite,
  createInvite,
  hashCode,
  inviteCookieKey,
  inviteUsable,
  readInviteCookie,
  reconcileInvites,
  redeemInvite,
  reserveInvite,
  verifyInviteCookie,
} from '../../invites.js';
import { main as createInviteMain, parseArgs } from '../../scripts/createInvite.js';
import { withTestDb } from '../helpers/withTestDb.js';

const db = withTestDb();
const key = inviteCookieKey('fake-auth-secret-for-hosted-invite-tests-Hw3q8');

const nonce = () => randomBytes(16).toString('base64url');

async function insertUser(email: string, createdAt: Date): Promise<string> {
  const id = randomUUID();
  await db.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, '', $2, true, $3, $3)`,
    [id, email, createdAt],
  );
  return id;
}

async function inviteRow(id: string) {
  const { rows } = await db.pool.query('SELECT * FROM invites WHERE id = $1', [id]);
  return rows[0] as Record<string, unknown>;
}

async function userExists(id: string): Promise<boolean> {
  const { rows } = await db.pool.query('SELECT 1 FROM "user" WHERE id = $1', [id]);
  return rows.length === 1;
}

describe('createInvite', () => {
  it('returns a 22-character base64url code', async () => {
    const { code } = await createInvite(db.pool);
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(code, 'base64url').length).toBe(16);
  });

  it('stores only the SHA-256: no column holds the code', async () => {
    const { id, code } = await createInvite(db.pool);
    const row = await inviteRow(id);
    for (const [column, value] of Object.entries(row)) {
      const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
      expect(text, column).not.toContain(code);
      if (Buffer.isBuffer(value)) expect(value.toString('base64url'), column).not.toBe(code);
    }
    expect((row.code_hash as Buffer).equals(hashCode(code))).toBe(true);
  });

  it('honours expiresInDays and rejects nonsense', async () => {
    const { id } = await createInvite(db.pool, { expiresInDays: 3 });
    const { rows } = await db.pool.query(
      "SELECT expires_at - created_at = interval '3 days' AS ok FROM invites WHERE id = $1",
      [id],
    );
    expect(rows[0].ok).toBe(true);
    await expect(createInvite(db.pool, { expiresInDays: 0 })).rejects.toThrow(/1 to 365/);
  });
});

describe('redeemInvite', () => {
  it('a valid code yields a signed cookie for that invite, with a fresh nonce each time', async () => {
    const { id, code } = await createInvite(db.pool);
    const first = await redeemInvite(db.pool, code, { key });
    const second = await redeemInvite(db.pool, code, { key });
    expect(first?.inviteId).toBe(id);
    const a = verifyInviteCookie(key, readInviteCookie(first!.setCookie.split(';')[0])!);
    const b = verifyInviteCookie(key, readInviteCookie(second!.setCookie.split(';')[0])!);
    expect(a?.inviteId).toBe(id);
    expect(a?.nonce).not.toBe(b?.nonce);
    expect(first!.setCookie).not.toContain(code);
    // Decoded, the payload is exactly {inviteId, nonce, exp}: the code is not in it.
    const signed = readInviteCookie(first!.setCookie.split(';')[0])!;
    const decoded = Buffer.from(signed.split('.')[0]!, 'base64url').toString('utf8');
    expect(Object.keys(JSON.parse(decoded)).sort()).toEqual(['exp', 'inviteId', 'nonce']);
    expect(decoded).not.toContain(code);
  });

  it('unknown, used, expired, reserved and malformed codes all return the same null', async () => {
    const used = await createInvite(db.pool);
    await db.pool.query('UPDATE invites SET used_at = now() WHERE id = $1', [used.id]);
    const expired = await createInvite(db.pool);
    await db.pool.query("UPDATE invites SET expires_at = now() - interval '1 second' WHERE id = $1", [expired.id]);
    const reserved = await createInvite(db.pool);
    await reserveInvite(db.pool, { inviteId: reserved.id, nonce: nonce(), email: 'held@example.test' });

    const results = await Promise.all(
      [
        'AAAAAAAAAAAAAAAAAAAAAA', // well-formed, unknown
        used.code,
        expired.code,
        reserved.code,
        'short',
        `${used.code}x`,
        'AAAAAAAAAAAAAAAAAAAA+/', // right length, not base64url
        12345,
        undefined,
      ].map((code) => redeemInvite(db.pool, code, { key })),
    );
    expect(results).toEqual(Array(results.length).fill(null));
  });

  it('a malformed code never reaches the database', async () => {
    const spy = vi.spyOn(db.pool, 'query');
    try {
      await redeemInvite(db.pool, "'; DROP TABLE invites; --", { key });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('reserve and consume', () => {
  it('a reservation by nonce A blocks nonce B; A can retry', async () => {
    const { id } = await createInvite(db.pool);
    const a = nonce();
    const b = nonce();
    expect(await reserveInvite(db.pool, { inviteId: id, nonce: a, email: 'a@example.test' })).toBe(true);
    expect(await reserveInvite(db.pool, { inviteId: id, nonce: b, email: 'b@example.test' })).toBe(false);
    expect(await reserveInvite(db.pool, { inviteId: id, nonce: a, email: 'a@example.test' })).toBe(true);
    const row = await inviteRow(id);
    expect(row.reserved_email).toBe('a@example.test');
    expect(await inviteUsable(db.pool, { inviteId: id, nonce: a })).toBe(true);
    expect(await inviteUsable(db.pool, { inviteId: id, nonce: b })).toBe(false);
  });

  it('records reserved_email lower-cased and trimmed', async () => {
    const { id } = await createInvite(db.pool);
    await reserveInvite(db.pool, { inviteId: id, nonce: nonce(), email: '  Mixed.Case@Example.TEST ' });
    expect((await inviteRow(id)).reserved_email).toBe('mixed.case@example.test');
  });

  it('once the reservation lapses, B can reserve', async () => {
    const { id } = await createInvite(db.pool);
    const a = nonce();
    const b = nonce();
    await reserveInvite(db.pool, { inviteId: id, nonce: a, email: 'a@example.test' });
    await db.pool.query("UPDATE invites SET reserved_until = now() - interval '1 second' WHERE id = $1", [id]);
    expect(await reserveInvite(db.pool, { inviteId: id, nonce: b, email: 'b@example.test' })).toBe(true);
    expect(await reserveInvite(db.pool, { inviteId: id, nonce: a, email: 'a@example.test' })).toBe(false);
  });

  it('an expired or used invite cannot be reserved', async () => {
    const expired = await createInvite(db.pool);
    await db.pool.query("UPDATE invites SET expires_at = now() - interval '1 second' WHERE id = $1", [expired.id]);
    expect(await reserveInvite(db.pool, { inviteId: expired.id, nonce: nonce(), email: 'x@example.test' })).toBe(false);
    const used = await createInvite(db.pool);
    await db.pool.query('UPDATE invites SET used_at = now() WHERE id = $1', [used.id]);
    expect(await reserveInvite(db.pool, { inviteId: used.id, nonce: nonce(), email: 'x@example.test' })).toBe(false);
  });

  it('two concurrent reservations, one winner', { repeats: 20 }, async () => {
    const { id } = await createInvite(db.pool);
    const [c1, c2] = await Promise.all([db.pool.connect(), db.pool.connect()]);
    try {
      const results = await Promise.all([
        reserveInvite(c1, { inviteId: id, nonce: nonce(), email: 'one@example.test' }),
        reserveInvite(c2, { inviteId: id, nonce: nonce(), email: 'two@example.test' }),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
    } finally {
      c1.release();
      c2.release();
    }
  });

  it('consume needs the reserving nonce, and succeeds only once', async () => {
    const { id } = await createInvite(db.pool);
    const a = nonce();
    const userId = await insertUser(`consume-${randomUUID()}@example.test`, new Date());
    await reserveInvite(db.pool, { inviteId: id, nonce: a, email: 'a@example.test' });
    expect(await consumeInvite(db.pool, { inviteId: id, nonce: nonce(), userId })).toBe(false);
    expect(await consumeInvite(db.pool, { inviteId: id, nonce: a, userId })).toBe(true);
    expect(await consumeInvite(db.pool, { inviteId: id, nonce: a, userId })).toBe(false);
    const row = await inviteRow(id);
    expect(row.used_by).toBe(userId);
    expect(row.used_at).not.toBeNull();
  });
});

describe('reconcileInvites (critique 1)', () => {
  // Each case runs at a `now` well past its own rows, and asserts only on its
  // own rows (other describes leave rows in the same schema).
  it('marks an expired reservation whose user exists but never consumed it', async () => {
    const email = `orphan-${randomUUID()}@example.test`;
    const { id } = await createInvite(db.pool);
    // Better Auth stamps createdAt (app clock) BEFORE the hook reserves (DB
    // clock), so a real orphan's createdAt precedes its reservation's start.
    const userId = await insertUser(email, new Date(Date.now() - 1000));
    await reserveInvite(db.pool, { inviteId: id, nonce: nonce(), email });

    // Just after the full 10-minute reservation lapses.
    const later = new Date(Date.now() + 11 * 60_000);
    const result = await reconcileInvites(db.pool, later);
    expect(result.marked).toBeGreaterThanOrEqual(1);
    const row = await inviteRow(id);
    expect(row.used_by).toBe(userId);
    expect(await userExists(userId)).toBe(true);
  });

  it('two invites with overlapping windows, one failed and one succeeded, do not cross-mark', async () => {
    const email = `overlap-${randomUUID()}@example.test`;
    const failed = await createInvite(db.pool);
    const succeeded = await createInvite(db.pool);
    const n1 = nonce();
    const n2 = nonce();
    // Same email reserves both (e.g. a failed attempt, then a second invite).
    await reserveInvite(db.pool, { inviteId: failed.id, nonce: n1, email });
    await reserveInvite(db.pool, { inviteId: succeeded.id, nonce: n2, email });
    const userId = await insertUser(email, new Date());
    expect(await consumeInvite(db.pool, { inviteId: succeeded.id, nonce: n2, userId })).toBe(true);
    // A second, unrelated user and invite in the same window.
    const otherEmail = `overlap-other-${randomUUID()}@example.test`;
    const other = await createInvite(db.pool);
    await reserveInvite(db.pool, { inviteId: other.id, nonce: nonce(), email: otherEmail });
    const otherUser = await insertUser(otherEmail, new Date());

    await reconcileInvites(db.pool, new Date(Date.now() + 13 * 60_000));

    const failedRow = await inviteRow(failed.id);
    expect(failedRow.used_at).toBeNull(); // the user already consumes `succeeded`
    expect(failedRow.used_by).toBeNull();
    expect((await inviteRow(succeeded.id)).used_by).toBe(userId);
    expect((await inviteRow(other.id)).used_by).toBe(otherUser);
    expect(await userExists(userId)).toBe(true);
    expect(await userExists(otherUser)).toBe(true);
  });

  it('does nothing to a live reservation or its user', async () => {
    const email = `live-${randomUUID()}@example.test`;
    const { id } = await createInvite(db.pool);
    await reserveInvite(db.pool, { inviteId: id, nonce: nonce(), email });
    // A user who looks old (created well before now) but whose invite is still reserved.
    const userId = await insertUser(email, new Date(Date.now() - 60 * 60_000));
    const before = await inviteRow(id);

    await reconcileInvites(db.pool, new Date());

    expect(await inviteRow(id)).toEqual(before);
    expect(await userExists(userId)).toBe(true);
  });

  it('deletes an invite-less user past the window (fail closed), but not a recent one', async () => {
    const oldUser = await insertUser(`noinvite-old-${randomUUID()}@example.test`, new Date(Date.now() - 13 * 60_000));
    const insideSlack = await insertUser(`noinvite-slack-${randomUUID()}@example.test`, new Date(Date.now() - 11 * 60_000));
    const newUser = await insertUser(`noinvite-new-${randomUUID()}@example.test`, new Date());
    const consumer = await insertUser(`consumer-${randomUUID()}@example.test`, new Date(Date.now() - 60 * 60_000));
    const { id } = await createInvite(db.pool);
    await db.pool.query('UPDATE invites SET used_by = $2, used_at = now() WHERE id = $1', [id, consumer]);

    const result = await reconcileInvites(db.pool, new Date());

    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(await userExists(oldUser)).toBe(false);
    expect(await userExists(newUser)).toBe(true);
    expect(await userExists(insideSlack)).toBe(true);
    expect(await userExists(consumer)).toBe(true);
  });

  it('runs on a checked-out client inside a transaction (as the purge will)', async () => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await reconcileInvites(client, new Date());
      await client.query('COMMIT');
      expect(result).toEqual({ marked: expect.any(Number), deleted: expect.any(Number) });
    } finally {
      client.release();
    }
  });
});

describe('invite:create script', () => {
  it('parses --days and rejects anything else', () => {
    expect(parseArgs([])).toEqual({});
    expect(parseArgs(['--days', '7'])).toEqual({ expiresInDays: 7 });
    for (const bad of [['--days'], ['--days', '0'], ['--days', '366'], ['--days', 'x'], ['7']]) {
      expect(parseArgs(bad)).toHaveProperty('error');
    }
  });

  it('prints a fragment link once, stores only the hash, and clears its variables', async () => {
    const url = new URL(db.url);
    url.searchParams.set('options', `-c search_path=${db.schema}`);
    process.env.DATABASE_URL = url.toString();
    process.env.BETTER_AUTH_URL = 'https://play.example/';
    const out: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void out.push(line));
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await createInviteMain([])).toBe(0);
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
    expect(process.env.DATABASE_URL).toBeUndefined();
    expect(process.env.BETTER_AUTH_URL).toBeUndefined();
    expect(out).toHaveLength(1);
    const match = /^https:\/\/play\.example\/#invite=([A-Za-z0-9_-]{22})$/.exec(out[0]!);
    expect(match).not.toBeNull();
    const code = match![1]!;
    const { rows } = await db.pool.query('SELECT id FROM invites WHERE code_hash = $1', [hashCode(code)]);
    expect(rows).toHaveLength(1);
    // And it redeems.
    expect(await redeemInvite(db.pool, code, { key })).not.toBeNull();
  });

  it('without BETTER_AUTH_URL prints just the code; without DATABASE_URL exits 1', async () => {
    const url = new URL(db.url);
    url.searchParams.set('options', `-c search_path=${db.schema}`);
    process.env.DATABASE_URL = url.toString();
    const out: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void out.push(line));
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await createInviteMain([])).toBe(0);
      expect(out[0]).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(await createInviteMain([])).toBe(1);
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  });
});
