import { defineConfig } from 'vitest/config';

/**
 * Minimal Vitest harness for the backend workspace (plan 02-02).
 *
 * Node environment only — this backend never touches a DOM. No coverage
 * thresholds, no watch-mode default (the `test` script uses `vitest run`,
 * not bare `vitest`), no reporters beyond Vitest's own default. This is a
 * harness, not a testing strategy: keep it that way.
 */
export default defineConfig({
  test: {
    environment: 'node',
    // Defense in depth alongside tsconfig.json's exclude of src/__tests__
    // from the build: this stops a stale or future dist/**/*.test.js from
    // ever being picked up and run alongside its own source test, which
    // silently doubled every test run before both fixes were in place.
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Clears every hosted-mode variable (SOULBOUND_MODE, DATABASE_URL, ...)
    // before each test file. Without it, a developer shell exporting hosted
    // variables would flip config.ts into hosted mode and turn the frozen
    // self-host tests red. See the file's own comment.
    setupFiles: ['./src/__tests__/setup/clearHostedEnv.ts'],
  },
});
