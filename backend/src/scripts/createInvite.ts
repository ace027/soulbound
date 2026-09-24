/**
 * `npm run invite:create -w @soulbound/backend [-- --days N]`: creates one
 * invite and prints it ONCE. Only the code's SHA-256 is stored.
 *
 * Reads DATABASE_URL (required) and BETTER_AUTH_URL (optional), deleting both
 * from the environment straight away. Like migrate.ts, it does not import the
 * app's settings loader, so it runs with nothing but the database URL.
 *
 * With BETTER_AUTH_URL set it prints a link, `<url>/#invite=<code>`. The code
 * is in the fragment, which a browser never sends to the server, so it never
 * reaches a request log or a Referer header (plan critique 8; spec Revision
 * History row 21). Without it, it prints just the code.
 */

import { pathToFileURL } from 'node:url';
import { createPool, redactError, urlRedactor } from '../db.js';
import { createInvite } from '../invites.js';

/** Parses `--days N` (1..365). Returns an error message for anything else. */
export function parseArgs(argv: readonly string[]): { expiresInDays?: number } | { error: string } {
  if (argv.length === 0) return {};
  if (argv.length === 2 && argv[0] === '--days' && /^\d{1,3}$/.test(argv[1]!)) {
    const days = Number(argv[1]);
    if (days >= 1 && days <= 365) return { expiresInDays: days };
  }
  return { error: 'Usage: invite:create [--days N]   (N from 1 to 365; default 14)' };
}

/** The CLI entry point. Resolves to the process exit code. */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL;
  const publicUrl = process.env.BETTER_AUTH_URL;
  delete process.env.DATABASE_URL;
  delete process.env.BETTER_AUTH_URL;

  const args = parseArgs(argv);
  if ('error' in args) {
    console.error(`[invite] ${args.error}`);
    return 1;
  }
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    console.error('[invite] DATABASE_URL is not set. Set it to the Postgres connection URL.');
    return 1;
  }

  const redact = urlRedactor(databaseUrl);
  let pool;
  try {
    pool = await createPool(databaseUrl);
    const { code, expiresAt } = await createInvite(pool, args);
    const base = publicUrl?.trim().replace(/\/+$/, '');
    console.log(base ? `${base}/#invite=${code}` : code);
    console.error(`[invite] expires ${expiresAt.toISOString()}. It is shown only once; only its hash is stored.`);
    return 0;
  } catch (err) {
    console.error('[invite] failed:', redactError(err, redact).message);
    return 1;
  } finally {
    await pool?.end().catch(() => undefined);
  }
}

// Only run when this file IS the process entrypoint (copied from migrate.ts).
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  void main().then((code) => process.exit(code));
}
