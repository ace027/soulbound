import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Vitest harness for the frontend workspace (plan 03-01, wave 0).
 *
 * Shaped after backend/vitest.config.ts — same "harness, not a testing
 * strategy" posture: no coverage thresholds, no reporters beyond the default,
 * and `vitest run` (not watch) as the `test` script.
 *
 * Differences from the backend, both forced by what waves 2-4 render:
 *  - `environment: 'jsdom'` — waves 2-4 mount React components with React
 *    Testing Library. Wave 1's modules are pure and would run under `node`,
 *    but one environment for the workspace is simpler than two.
 *  - `setupFiles` — src/test/setup.ts registers the jest-dom matchers and
 *    stubs Element.prototype.scrollIntoView, which jsdom does not implement.
 *    Installing @testing-library/jest-dom without importing its /vitest entry
 *    leaves every toBeInTheDocument() an unregistered matcher.
 *
 * The react plugin is loaded so .tsx test files get the automatic JSX runtime
 * transform; a vitest.config.ts fully replaces vite.config.ts, so the plugin
 * list does not carry over from there.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Same defense in depth as the backend: never pick up a built copy of a
    // test out of dist/ alongside its own source file.
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
