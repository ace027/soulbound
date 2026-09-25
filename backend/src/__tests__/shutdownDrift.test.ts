/**
 * Shutdown drift guard (review cycle 2, infra suggestion 6). render.yaml's
 * `maxShutdownDelaySeconds` is how long Render waits after SIGTERM before a
 * SIGKILL; server.ts drains for up to SHUTDOWN_TIMEOUT_MS. If the drain ever
 * outlasts Render's wait, a long turn is killed mid-flight with no clean exit.
 * Nothing but this test ties the two numbers together.
 *
 * Parsed with a regex (no YAML dependency is installed): the key must appear
 * exactly once, as a plain integer.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SHUTDOWN_TIMEOUT_MS } from '../server.js';

const RENDER_YAML = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../render.yaml');

describe('render.yaml vs server.ts shutdown timing', () => {
  it("Render's maxShutdownDelaySeconds outlasts the SIGTERM drain", () => {
    const yaml = readFileSync(RENDER_YAML, 'utf8');
    const matches = [...yaml.matchAll(/^\s*maxShutdownDelaySeconds:\s*(\S+)\s*(?:#.*)?$/gm)];
    expect(matches, 'maxShutdownDelaySeconds appears exactly once').toHaveLength(1);
    const raw = matches[0]![1]!;
    expect(raw, 'maxShutdownDelaySeconds is a plain integer').toMatch(/^\d+$/);
    const seconds = Number(raw);
    expect(seconds * 1000).toBeGreaterThan(SHUTDOWN_TIMEOUT_MS);
  });
});
