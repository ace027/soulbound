/**
 * Vitest `setupFiles` entry (backend): clears every hosted-mode variable
 * before each test file runs.
 *
 * `config.ts` reads `SOULBOUND_MODE` first, so a developer shell (or CI job)
 * that happens to export `SOULBOUND_MODE=hosted` — or any hosted secret —
 * would otherwise switch the frozen self-host suite onto the hosted path and
 * turn it red for reasons that have nothing to do with the code under test.
 * This is a harness change, not a test edit: the existing tests stay byte for
 * byte as they were. Hosted tests set exactly the variables they need.
 */

const HOSTED_VARIABLES = [
  'SOULBOUND_MODE',
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'SENTRY_DSN',
  'USER_RATE_LIMIT_PER_MINUTE',
] as const;

for (const name of HOSTED_VARIABLES) {
  delete process.env[name];
}
