/**
 * The image's `api` stage installs with `npm ci --omit=dev` (backend/Dockerfile),
 * so anything hosted mode needs at run time — including `migrate.js`, the
 * Render pre-deploy — must be a runtime dependency (spec R25a). A package
 * that slips into devDependencies still passes every test here and then
 * fails only in the deployed image.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_JSON = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');

const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe('backend/package.json', () => {
  it.each(['pg', 'node-pg-migrate', 'better-auth', '@sentry/node'])(
    '%s is a runtime dependency, not a devDependency',
    (name) => {
      expect(pkg.dependencies ?? {}).toHaveProperty([name]);
      expect(pkg.devDependencies ?? {}).not.toHaveProperty([name]);
    },
  );

  it('better-auth is pinned to an exact version (migration 001 was generated from it)', () => {
    expect(pkg.dependencies?.['better-auth']).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
