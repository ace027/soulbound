/**
 * Hosted DB foundation (06-02, D2): the migrations, the pending-migration boot
 * check, the migrate CLI, and DB error redaction (R25d), against real Postgres.
 */
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MIGRATIONS_DIR,
  PENDING_MIGRATIONS_MESSAGE,
  assertNoPendingMigrations,
  createPool,
  urlRedactor,
} from '../../db.js';
import { main as migrateMain, runMigrations } from '../../migrate.js';
import { withTestDb } from '../helpers/withTestDb.js';

const ALL_MIGRATIONS = ['001_better-auth', '002_soulbound-hosted'];
const ALL_TABLES = ['account', 'account_deletions', 'invites', 'session', 'user', 'verification'];

/**
 * A fake password that is ALSO the host name: DNS errors quote the host, so an
 * unredacted error would visibly carry the password. Lower-case, because URL
 * parsing lower-cases the host.
 */
const FAKE_PW = 'fakedbpwcanary0123456789abcdefghijk';
const BAD_HOST_URL = `postgres://soulbound:${FAKE_PW}@${FAKE_PW}.invalid:5432/nowhere`;

async function tablesIn(pool: import('pg').Pool, schema: string): Promise<string[]> {
  const { rows } = await pool.query<{ table_name: string }>(
    'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
    [schema],
  );
  return rows.map((row) => row.table_name);
}

describe('migrations', () => {
  const lifecycle = withTestDb({ migrate: false });

  it('go up, down, and up again cleanly', async () => {
    const { pool, url, schema } = lifecycle;
    const quiet = { databaseUrl: url, schema, log: () => undefined };

    expect(await runMigrations({ ...quiet, direction: 'up' })).toEqual(ALL_MIGRATIONS);
    expect(await tablesIn(pool, schema)).toEqual([...ALL_TABLES, 'pgmigrations'].sort());

    expect(await runMigrations({ ...quiet, direction: 'down', count: Infinity })).toEqual(
      [...ALL_MIGRATIONS].reverse(),
    );
    expect(await tablesIn(pool, schema)).toEqual(['pgmigrations']);

    expect(await runMigrations({ ...quiet, direction: 'up' })).toEqual(ALL_MIGRATIONS);
    expect(await tablesIn(pool, schema)).toEqual([...ALL_TABLES, 'pgmigrations'].sort());

    // Nothing left to apply.
    expect(await runMigrations({ ...quiet, direction: 'up' })).toEqual([]);
  });
});

describe('assertNoPendingMigrations', () => {
  const fresh = withTestDb({ migrate: false });

  it('throws on a fresh schema and passes once migrated', async () => {
    const { pool, url, schema } = fresh;
    await expect(assertNoPendingMigrations(pool, { schema })).rejects.toThrow(
      PENDING_MIGRATIONS_MESSAGE,
    );
    expect(PENDING_MIGRATIONS_MESSAGE).toContain('npm run migrate');

    // Partly migrated is still pending.
    await runMigrations({ databaseUrl: url, schema, count: 1, log: () => undefined });
    await expect(assertNoPendingMigrations(pool, { schema })).rejects.toThrow(
      PENDING_MIGRATIONS_MESSAGE,
    );

    await runMigrations({ databaseUrl: url, schema, log: () => undefined });
    await expect(assertNoPendingMigrations(pool, { schema })).resolves.toBeUndefined();
  });

  it('throws when a new migration file has not been applied yet', async () => {
    const { pool, schema } = fresh; // fully migrated by the test above
    const dir = mkdtempSync(path.join(tmpdir(), 'soulbound-migrations-'));
    try {
      for (const file of readdirSync(MIGRATIONS_DIR)) {
        copyFileSync(path.join(MIGRATIONS_DIR, file), path.join(dir, file));
      }
      await expect(assertNoPendingMigrations(pool, { schema, dir })).resolves.toBeUndefined();
      writeFileSync(path.join(dir, '003_future.sql'), '-- Up Migration\nSELECT 1;\n');
      await expect(assertNoPendingMigrations(pool, { schema, dir })).rejects.toThrow(
        PENDING_MIGRATIONS_MESSAGE,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('schema (002 and the 001 foreign keys)', () => {
  const db = withTestDb();

  it('invites.expires_at defaults to 14 days out', async () => {
    const { rows } = await db.pool.query<{ expires_at: Date; created_at: Date }>(
      "INSERT INTO invites (code_hash) VALUES (decode('aa01', 'hex')) RETURNING expires_at, created_at",
    );
    const row = rows[0]!;
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;
    expect(row.expires_at.getTime() - row.created_at.getTime()).toBe(fourteenDays);
    expect(Math.abs(row.expires_at.getTime() - (Date.now() + fourteenDays))).toBeLessThan(60_000);
  });

  it('deleting a user cascades to account_deletions and sessions, and nulls invites.used_by', async () => {
    const { pool } = db;
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ('u-cascade', 'Fake', 'fake@example.test', true)`,
    );
    await pool.query(
      `INSERT INTO session (id, "expiresAt", token, "updatedAt", "userId")
       VALUES ('s-cascade', now() + interval '1 day', 'fake-token-cascade', now(), 'u-cascade')`,
    );
    await pool.query(`INSERT INTO account_deletions (user_id, requested_at) VALUES ('u-cascade', now())`);
    await pool.query(
      `INSERT INTO invites (code_hash, used_by, used_at) VALUES (decode('bb02', 'hex'), 'u-cascade', now())`,
    );

    await pool.query(`DELETE FROM "user" WHERE id = 'u-cascade'`);

    const deletions = await pool.query('SELECT 1 FROM account_deletions WHERE user_id = $1', ['u-cascade']);
    expect(deletions.rowCount).toBe(0);
    const sessions = await pool.query('SELECT 1 FROM session WHERE "userId" = $1', ['u-cascade']);
    expect(sessions.rowCount).toBe(0);
    const invite = await pool.query<{ used_by: string | null; used_at: Date | null }>(
      "SELECT used_by, used_at FROM invites WHERE code_hash = decode('bb02', 'hex')",
    );
    expect(invite.rows).toHaveLength(1);
    expect(invite.rows[0]!.used_by).toBeNull();
    expect(invite.rows[0]!.used_at).not.toBeNull(); // the invite stays consumed
  });

  it('invites has the reserved_email column', async () => {
    const { rows } = await db.pool.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'invites' AND column_name = 'reserved_email'`,
      [db.schema],
    );
    expect(rows).toEqual([{ data_type: 'text' }]);
  });
});

describe('DB errors are redacted (R25d)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DATABASE_URL;
  });

  it('a bad-host connection error from the pool carries no password or URL', async () => {
    const pool = await createPool(BAD_HOST_URL, { pool: { connectionTimeoutMillis: 5000 } });
    try {
      const err = await assertNoPendingMigrations(pool).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      const shown = inspect(err, { depth: 5 });
      expect(shown).toContain('[REDACTED]'); // the host name was the password
      expect(shown).not.toContain(FAKE_PW);
      expect(shown).not.toContain(BAD_HOST_URL);
      expect((err as Error).cause).toBeUndefined();
    } finally {
      await pool.end();
    }
  });

  it('a bad-host error from runMigrations, and its log lines, carry no password', async () => {
    const lines: string[] = [];
    const err = await runMigrations({ databaseUrl: BAD_HOST_URL, log: (line) => lines.push(line) }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    const everything = [inspect(err), ...lines].join('\n');
    expect(everything).toContain('[REDACTED]');
    expect(everything).not.toContain(FAKE_PW);
  });

  it('the migrate CLI deletes DATABASE_URL, exits 1 and prints no password on a bad host', async () => {
    const printed: string[] = [];
    const capture = (...args: unknown[]) => void printed.push(args.map(String).join(' '));
    vi.spyOn(console, 'error').mockImplementation(capture);
    vi.spyOn(console, 'log').mockImplementation(capture);

    process.env.DATABASE_URL = BAD_HOST_URL;
    expect(await migrateMain()).toBe(1);
    expect(process.env.DATABASE_URL).toBeUndefined();
    expect(printed.join('\n')).toContain('[migrate] failed:');
    expect(printed.join('\n')).not.toContain(FAKE_PW);
  });

  it('the migrate CLI exits 1 with a clear message when DATABASE_URL is unset', async () => {
    const printed: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void printed.push(args.join(' ')));
    delete process.env.DATABASE_URL;
    expect(await migrateMain()).toBe(1);
    expect(printed.join('\n')).toContain('DATABASE_URL is not set');
  });

  it('the URL redactor strips the full URL, the raw password and the URL-decoded password', () => {
    const raw = 'fake%2Fpw%40canary0123456789abcdef';
    const decoded = decodeURIComponent(raw);
    const url = `postgres://soulbound:${raw}@db.example.test:5432/app`;
    const redact = urlRedactor(url);
    const out = redact(`a ${url} b ${raw} c ${decoded} d`);
    expect(out).toBe('a [REDACTED] b [REDACTED] c [REDACTED] d');
  });
});

describe('pool limits (review cycle 1, Infra S5)', () => {
  it('the pool is capped at 10 connections, with a 5 s connect timeout', async () => {
    const pool = await createPool('postgres://soulbound:fake-password-pool-limits-0000@127.0.0.1:1/nowhere');
    try {
      expect(pool.options.max).toBe(10);
      expect(pool.options.connectionTimeoutMillis).toBe(5000);
    } finally {
      await pool.end();
    }
  });

  it('a host that accepts but never answers fails within about 6 s, redacted', { timeout: 15_000 }, async () => {
    // A TCP listener that never speaks the Postgres protocol: DNS and the TCP
    // connect succeed, so only the connect timeout can end the attempt.
    const { createServer } = await import('node:net');
    const sockets: import('node:net').Socket[] = [];
    const silent = createServer((socket) => void sockets.push(socket));
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', () => resolve()));
    const { port } = silent.address() as import('node:net').AddressInfo;
    const url = `postgres://soulbound:${FAKE_PW}@127.0.0.1:${port}/nowhere`;
    const pool = await createPool(url);
    const started = Date.now();
    try {
      const err = await pool.query('SELECT 1').then(
        () => undefined,
        (e: unknown) => e,
      );
      const elapsed = Date.now() - started;
      expect(err).toBeInstanceOf(Error);
      expect(elapsed).toBeGreaterThanOrEqual(4_500);
      expect(elapsed).toBeLessThan(6_500);
      expect(inspect(err)).not.toContain(FAKE_PW);
    } finally {
      for (const s of sockets) s.destroy();
      await pool.end().catch(() => undefined);
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });
});
