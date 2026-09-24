import { defineConfig } from 'vitest/config';
import { HOSTED_TESTS_DIR, SETUP_FILES } from './vitest.config.ts';

/**
 * The hosted suite: DB-backed tests under src/__tests__/hosted, against a real
 * Postgres (`npm run test:hosted`; spec Key Decisions → "Test database").
 *
 * Standalone on purpose — NOT `mergeConfig` over vitest.config.ts. Merging
 * concatenates arrays, so the base config's `exclude` (which lists the hosted
 * directory, to keep `npm test` DB-free) would come along and exclude every
 * test this config exists to run. Only the `setupFiles` list is shared.
 *
 * It cannot pass quietly:
 *  - globalSetup (setup/requireTestDb.ts) throws when TEST_DATABASE_URL is
 *    unset, so a missing database is a failure, never a skip;
 *  - the `test:hosted` script then runs scripts/assert-no-skips.mjs over the
 *    JSON report, which fails on any skipped or todo test, or on zero tests.
 *
 * Files run one at a time: node-pg-migrate takes one fixed advisory lock
 * (fail-fast by default), and later suites race real rows on purpose.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: [`${HOSTED_TESTS_DIR}/**/*.test.ts`],
    exclude: ['**/node_modules/**', '**/dist/**'],
    setupFiles: SETUP_FILES,
    globalSetup: ['./src/__tests__/setup/requireTestDb.ts'],
    fileParallelism: false,
    testTimeout: 10000,
    hookTimeout: 30000,
  },
});
