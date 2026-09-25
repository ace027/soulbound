/**
 * Applies every pending migration in `backend/migrations` — the Render
 * `preDeployCommand` (`node backend/dist/migrate.js`, R25a) and
 * `npm run migrate -w @soulbound/backend` locally.
 *
 * Needs exactly one environment variable: DATABASE_URL. It is read, then
 * deleted from `process.env` straight away, and handed to node-pg-migrate
 * programmatically as `databaseUrl` — never through the environment (R25d).
 *
 * This file deliberately does NOT import the app's settings loader. That
 * loader validates every app secret at load (the Anthropic key, the auth
 * secret, the email key, ...), and the pre-deploy step must be able to run
 * with nothing but the database URL. It imports only `db.ts`, which reads no
 * environment and loads no driver at its top level.
 *
 * Output never contains the URL or its password: node-pg-migrate's own log
 * lines (including its "could not connect" dump, which `util.inspect`s the
 * driver error) and any thrown error all pass through the URL's redactor.
 */

import { pathToFileURL } from 'node:url';
import { MIGRATIONS_DIR, MIGRATIONS_TABLE, urlRedactor, type Redactor } from './db.js';

export interface RunMigrationsOptions {
  databaseUrl: string;
  direction?: 'up' | 'down';
  /** Target schema (the hosted tests' per-file schema). Omitted in production: `public`. */
  schema?: string;
  /** Create `schema` if it doesn't exist. */
  createSchema?: boolean;
  /** How many to apply; `Infinity` for all. node-pg-migrate defaults to all up, one down. */
  count?: number;
  /** Receives each (already redacted) log line. */
  log?: (message: string) => void;
  dir?: string;
}

/**
 * Runs node-pg-migrate with the project's settings and returns the names of
 * the migrations it applied. Every error it throws is redacted.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<string[]> {
  const redact: Redactor = urlRedactor(options.databaseUrl);
  const log = options.log ?? ((message: string) => console.log(message));
  try {
    const { runner } = await import('node-pg-migrate');
    const applied = await runner({
      databaseUrl: options.databaseUrl,
      dir: options.dir ?? MIGRATIONS_DIR,
      direction: options.direction ?? 'up',
      migrationsTable: MIGRATIONS_TABLE,
      ...(options.schema === undefined ? {} : { schema: options.schema }),
      ...(options.createSchema === undefined ? {} : { createSchema: options.createSchema }),
      ...(options.count === undefined ? {} : { count: options.count }),
      log: (message: string) => log(redact(message)),
    });
    return applied.map((migration) => migration.name);
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    throw new Error(redact(detail));
  }
}

/** The CLI entry point. Resolves to the process exit code. */
export async function main(): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    console.error(
      '[migrate] DATABASE_URL is not set. Set it to the Postgres connection URL, e.g. postgres://user:password@host:5432/dbname',
    );
    return 1;
  }

  try {
    const applied = await runMigrations({ databaseUrl, log: (line) => console.log(`[migrate] ${line}`) });
    console.log(`[migrate] done: ${applied.length} migration(s) applied`);
    return 0;
  } catch (err) {
    // runMigrations has already redacted the message; redact once more in
    // case anything here ever changes what reaches this line.
    const redact = urlRedactor(databaseUrl);
    console.error('[migrate] failed:', redact(err instanceof Error ? err.message : String(err)));
    return 1;
  }
}

// Only run when this file IS the process entrypoint (copied from server.ts).
// Importing it (from the hosted test helper) must not touch a database or
// call `process.exit`.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  void main().then((code) => process.exit(code));
}
