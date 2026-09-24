/**
 * `withTestDb()` — a throwaway, fully migrated Postgres schema for one hosted
 * test file (spec Key Decisions → "Test database").
 *
 * Call it once at a test file's top level. It registers:
 *  - `beforeAll`: creates schema `t_<random>` in TEST_DATABASE_URL's database,
 *    runs every migration into it through the same `runMigrations()` the
 *    production `migrate` uses (node-pg-migrate's `schema` option), and opens
 *    a pool whose `search_path` is that schema;
 *  - `afterAll`: `DROP SCHEMA ... CASCADE`, then closes the pool.
 *
 * The returned handle's `pool`, `url` and `schema` are readable inside tests
 * and hooks (after `beforeAll`), never at the top level.
 *
 * `migrate: false` gives an empty schema, for tests of the migrations
 * themselves.
 */
import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll } from 'vitest';
import { createPool } from '../../db.js';
import { runMigrations } from '../../migrate.js';

export interface TestDb {
  /** Pool with `search_path` set to `schema`. */
  readonly pool: Pool;
  /** TEST_DATABASE_URL (the database, not the schema). */
  readonly url: string;
  /** This file's schema, `t_<random>`. */
  readonly schema: string;
}

export interface WithTestDbOptions {
  /** Apply every migration in `beforeAll`. Default true. */
  migrate?: boolean;
}

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (url === undefined || url.trim() === '') {
    // requireTestDb.ts (globalSetup) already fails the run; this is for a
    // hosted test file run through some other config.
    throw new Error('TEST_DATABASE_URL is required for test:hosted');
  }
  return url;
}

export function withTestDb(options: WithTestDbOptions = {}): TestDb {
  const schema = `t_${randomBytes(6).toString('hex')}`;
  let url: string | undefined;
  let pool: Pool | undefined;

  beforeAll(async () => {
    url = testDatabaseUrl();
    // The schema name is `t_` + hex, so it needs no quoting in libpq's options.
    pool = await createPool(url, { pool: { max: 4, options: `-c search_path=${schema}` } });
    if (options.migrate === false) {
      await pool.query(`CREATE SCHEMA "${schema}"`);
    } else {
      await runMigrations({ databaseUrl: url, schema, createSchema: true, log: () => undefined });
    }
  });

  // Runs even when beforeAll failed partway, so a half-built schema is still dropped.
  afterAll(async () => {
    if (pool === undefined) return;
    try {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await pool.end();
    }
  });

  const ready = <T>(value: T | undefined, name: string): T => {
    if (value === undefined) {
      throw new Error(`withTestDb: ${name} is only available inside tests and hooks, after beforeAll`);
    }
    return value;
  };

  return {
    get pool() {
      return ready(pool, 'pool');
    },
    get url() {
      return ready(url, 'url');
    },
    schema,
  };
}
