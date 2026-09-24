/**
 * Vitest `globalSetup` for the hosted suite (vitest.hosted.config.ts): the run
 * fails outright when TEST_DATABASE_URL is unset. A hosted test must never
 * "pass" by skipping because no database was there (spec Failure Modes →
 * "Test DB unavailable").
 *
 * Locally: `URL=$(scripts/test-db.sh) && TEST_DATABASE_URL=$URL npm run test:hosted -w @soulbound/backend`.
 * CI: the `postgres:16` service in ci.yml / release.yml.
 */
export default function requireTestDb(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (url === undefined || url.trim() === '') {
    throw new Error('TEST_DATABASE_URL is required for test:hosted');
  }
}
