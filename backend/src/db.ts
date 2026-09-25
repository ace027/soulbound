/**
 * Hosted mode's database access: one `pg` Pool, and the boot-time check that
 * the schema is fully migrated (spec: Key Decisions → "DB access", "When
 * migrations run").
 *
 * Self-host never touches this module's dependencies. `pg` and
 * `node-pg-migrate` are imported DYNAMICALLY, inside the functions below,
 * never at this module's top level — so importing `db.ts` itself costs
 * nothing and opens nothing (pinned by selfhostNoPg.test.ts). Only `import
 * type` appears statically, and TypeScript erases it.
 *
 * Nothing here reads the environment: the database URL is always passed in
 * by the caller (config.ts's `getHostedSecrets()`, or migrate.ts), never read
 * from `process.env`, so `pg` never picks it up from there (R25d).
 *
 * Every error this module throws has passed through a redactor: the URL's own
 * (the full URL, its password, and the URL-decoded password) plus the caller's
 * (config.ts's `redact()`, which covers every configured secret). The thrown
 * error is a NEW Error carrying only the redacted message and the driver's
 * `code` — never the original as `cause`, since a `cause` is printed in full
 * by `util.inspect` and would carry the unredacted text straight back out.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool, PoolConfig } from 'pg';

/** A function that strips secrets out of a string. */
export type Redactor = (input: string) => string;

/**
 * `backend/migrations`, resolved from this file's own location: `dist/db.js`
 * in the image and at run time, `src/db.ts` under Vitest — both one level
 * below `backend/`. The Dockerfile's `api` stage copies the directory next to
 * `dist/` for exactly this reason.
 */
export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

/** node-pg-migrate's bookkeeping table (its own default name, stated explicitly). */
export const MIGRATIONS_TABLE = 'pgmigrations';

/** The exact message the app exits with when a migration hasn't been applied. */
export const PENDING_MIGRATIONS_MESSAGE = 'Pending database migrations: run `npm run migrate`';

/**
 * A redactor for one database URL: the full URL, its raw (still
 * percent-encoded) password, and the URL-decoded password, longest first so a
 * shorter form never leaves a fragment of a longer one behind. An unparseable
 * URL still has the whole string redacted.
 */
export function urlRedactor(databaseUrl: string): Redactor {
  const secrets = new Set<string>([databaseUrl]);
  try {
    const raw = new URL(databaseUrl).password;
    if (raw !== '') {
      secrets.add(raw);
      try {
        secrets.add(decodeURIComponent(raw));
      } catch {
        // Malformed percent-encoding: the raw form is already covered.
      }
    }
  } catch {
    // Not a URL at all: only the whole string can be matched.
  }
  const ordered = [...secrets].filter((s) => s.length > 0).sort((a, b) => b.length - a.length);
  return (input) => ordered.reduce((text, secret) => text.split(secret).join('[REDACTED]'), input);
}

/** Applies each redactor in turn. */
function chain(...redactors: (Redactor | undefined)[]): Redactor {
  const list = redactors.filter((r): r is Redactor => r !== undefined);
  return (input) => list.reduce((text, r) => r(text), input);
}

/** Rebuilds `err` as a fresh Error whose message (and nothing else) is redacted. */
export function redactError(err: unknown, redact: Redactor): Error {
  const message = err instanceof Error ? err.message : String(err);
  const safe = new Error(redact(message));
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string') {
    (safe as Error & { code?: string }).code = code;
  }
  return safe;
}

/**
 * Pool limits (review cycle 1, Infra S5). At most 10 connections: one
 * instance, and a small managed Postgres plan caps connections well below
 * `pg`'s unbounded growth under load. A 5 s connect timeout: `pg`'s default is
 * none, so an unreachable or silent database would hang a request (and the
 * boot check) until the OS gives up on the TCP connection, minutes later.
 */
export const POOL_MAX_CONNECTIONS = 10;
export const POOL_CONNECTION_TIMEOUT_MS = 5000;

/** The redactor `createPool` attached to each pool, for `assertNoPendingMigrations`. */
const poolRedactors = new WeakMap<Pool, Redactor>();

export interface CreatePoolOptions {
  /** config.ts's `redact()`, applied on top of the URL's own redactor. */
  redact?: Redactor;
  /** Extra `pg` Pool settings (e.g. `max`, `options` for a test's search_path). */
  pool?: Omit<PoolConfig, 'connectionString'>;
}

/**
 * Creates the one shared `pg` Pool (Better Auth's Kysely adapter takes it as
 * is). Creating a pool opens no connection; the first query does, and the
 * first query at boot is `assertNoPendingMigrations`.
 *
 * An idle client's error (the server restarting, a dropped connection) is
 * emitted on the pool; with no listener, Node would crash the process with
 * the raw, unredacted error. It is logged redacted instead, and the pool
 * replaces the client on the next checkout.
 */
export async function createPool(
  databaseUrl: string,
  options: CreatePoolOptions = {},
): Promise<Pool> {
  const redact = chain(urlRedactor(databaseUrl), options.redact);
  try {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      max: POOL_MAX_CONNECTIONS,
      connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
      ...options.pool,
      connectionString: databaseUrl,
    });
    pool.on('error', (err) => {
      console.error('[db] idle client error:', redactError(err, redact).message);
    });
    poolRedactors.set(pool, redact);
    return pool;
  } catch (err) {
    throw redactError(err, redact);
  }
}

/** Double-quotes a SQL identifier (Postgres rules: `"` doubles). */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export interface PendingCheckOptions {
  /** The schema holding the migrations table; node-pg-migrate's default is `public`. */
  schema?: string;
  /** Extra redactor, on top of the one `createPool` attached. */
  redact?: Redactor;
  /** Migrations directory; defaults to `MIGRATIONS_DIR`. */
  dir?: string;
}

/**
 * Throws `PENDING_MIGRATIONS_MESSAGE` if any migration file has not been
 * applied to `schema`. Read-only: it never creates the migrations table or
 * takes node-pg-migrate's lock (a dry-run `runner()` would do both), so the
 * app can call it at boot without racing a deploy's `migrate`.
 *
 * "Applied" means exactly what node-pg-migrate means by it: the file list
 * comes from node-pg-migrate's own `getMigrationFilePaths` (same ignore rule,
 * same sort), and a migration's name is its file name without the extension
 * (`migration.js`, `this.name = basename(path, extname(path))`), matched
 * against the `name` column of its table.
 */
export async function assertNoPendingMigrations(
  pool: Pool,
  options: PendingCheckOptions = {},
): Promise<void> {
  const redact = chain(poolRedactors.get(pool), options.redact);
  const schema = options.schema ?? 'public';
  let pending: string[];
  try {
    // A deep import: `node-pg-migrate/migration` is a legacy subpath export,
    // not part of the documented API, which is why package.json pins
    // node-pg-migrate exactly (9.0.0). Re-check this path on any upgrade.
    const { getMigrationFilePaths } = await import('node-pg-migrate/migration');
    const files = await getMigrationFilePaths(options.dir ?? MIGRATIONS_DIR);
    const names = files.map((file) => path.basename(file, path.extname(file)));

    const present = await pool.query<{ present: boolean }>(
      "SELECT to_regclass(format('%I.%I', $1::text, $2::text)) IS NOT NULL AS present",
      [schema, MIGRATIONS_TABLE],
    );
    let applied = new Set<string>();
    if (present.rows[0]?.present === true) {
      const result = await pool.query<{ name: string }>(
        `SELECT name FROM ${quoteIdent(schema)}.${quoteIdent(MIGRATIONS_TABLE)}`,
      );
      applied = new Set(result.rows.map((row) => row.name));
    }
    pending = names.filter((name) => !applied.has(name));
  } catch (err) {
    throw redactError(err, redact);
  }
  if (pending.length > 0) {
    throw new Error(PENDING_MIGRATIONS_MESSAGE);
  }
}
