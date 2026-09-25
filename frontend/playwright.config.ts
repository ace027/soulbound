import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright harness for the frontend workspace (plan 04-03, Phase 4).
 *
 * Same posture as vitest.config.ts — a harness, not a testing strategy: one
 * browser, no retries, no reporter beyond the default, no coverage gates.
 *
 * ── Why this exists at all ───────────────────────────────────────────────
 * jsdom performs no layout: `getBoundingClientRect` returns zeros and
 * `scrollHeight` always equals `clientHeight`. The 129-test Vitest suite
 * asserts *declared* style properties, which does catch a deleted `flex: 1`
 * or `minHeight: 0` — but it cannot see whether a panel actually collapsed,
 * whether the scroll region actually scrolls, or whether the action bar is
 * actually on screen. e2e/smoke.spec.ts is the only place in this repo with a
 * real layout engine behind those questions.
 *
 * ── Deliberately NOT wired into `npm test` ───────────────────────────────
 * `test` stays `vitest run`: fast, jsdom-only, no browser dependency. This
 * suite runs under the separate `test:e2e` script so CI (.github/workflows/
 * ci.yml, which runs `npm test`) does not silently acquire a browser
 * download. Since Phase 6 review cycle 1, ci.yml runs `test:e2e` in its own
 * `e2e` job, which installs Chromium explicitly (see 04-03-SUMMARY.md for the
 * original, pre-CI decision).
 *
 * ── executablePath ───────────────────────────────────────────────────────
 * The agent sandbox ships a prebuilt Chromium that differs from the build
 * `npx playwright install` would fetch, so pointing at it explicitly is
 * required there. It is resolved, not hardcoded, so this config still works
 * on a normal machine with a normally-installed browser:
 *   1. $PW_CHROMIUM_PATH, if set  — explicit override
 *   2. the sandbox path, if it exists on disk
 *   3. undefined — Playwright's own managed download
 */
function resolveChromium(): string | undefined {
  const override = process.env.PW_CHROMIUM_PATH;
  if (override) return override;
  const sandbox = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return existsSync(sandbox) ? sandbox : undefined;
}

/**
 * Not Vite's default 5173: that is the port `npm run dev` uses, and a dev
 * server left running would otherwise be silently reused as the system under
 * test. `strictPort` makes a collision fail loudly instead of drifting to a
 * port the tests are not pointed at.
 */
const PORT = 5174;

export default defineConfig({
  testDir: './e2e',
  /**
   * Failure artifacts (traces, error context) land under node_modules rather
   * than Playwright's default ./test-results, which is untracked build output
   * that would show up in `git status` on every red run. .gitignore already
   * covers node_modules/ and is outside this plan's declared files, so the
   * output is routed to an already-ignored path instead of adding a rule.
   */
  outputDir: 'node_modules/.playwright-artifacts',
  // A layout regression is a layout regression. A retry here would only turn a
  // real failure into an intermittent one.
  retries: 0,
  // The geometry assertions read post-layout boxes; parallel viewport resizes
  // in one browser are fine, but serial keeps failure output readable.
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    launchOptions: { executablePath: resolveChromium() },
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
