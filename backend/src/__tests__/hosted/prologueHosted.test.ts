/**
 * Hosted-mode gating of the prologue routes (Phase 14, plan 14-02). Hosted
 * suite: needs Postgres via `scripts/test-db.sh` and is excluded from
 * `npm test` (run with `npm run test:hosted -w backend`).
 *
 * The prologue routes are mounted with the three game routes, after the hosted
 * session gate, so with no session cookie they answer 401 SIGN_IN_REQUIRED
 * (never the self-host PASSPHRASE_REQUIRED), and a foreign Origin is refused
 * at the Origin check before anything else. No Anthropic call can happen: both
 * requests are refused before any route handler runs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN_REJECTED, PROLOGUE_OPENING, SIGN_IN_REQUIRED } from '@soulbound/shared';
import { PUBLIC_URL, startHostedApp, type HostedApp, type Result } from '../helpers/hostedApp.js';
import { withTestDb } from '../helpers/withTestDb.js';

const db = withTestDb();

function errorCode(res: Result): unknown {
  return (res.json as { error?: { code?: unknown } } | undefined)?.error?.code;
}

const OPENING = { role: 'narrator', text: PROLOGUE_OPENING };
const BEAT_BODY = { history: [OPENING, { role: 'player', text: 'I reach for the small soul.' }] };
const PROFILE_BODY = {
  history: [
    OPENING,
    ...[1, 2, 3, 4].flatMap((i) => [
      { role: 'player', text: `action ${i}` },
      { role: 'narrator', text: `Narration ${i}.` },
    ]),
  ],
};

describe('prologue routes in hosted mode', () => {
  let h: HostedApp;

  beforeAll(async () => {
    h = await startHostedApp(db);
  });
  afterAll(async () => {
    await h.close();
  });

  it.each([
    ['/api/prologue/beat', BEAT_BODY],
    ['/api/prologue/profile', PROFILE_BODY],
  ])('%s with no session cookie -> 401 SIGN_IN_REQUIRED (never PASSPHRASE_REQUIRED)', async (path, json) => {
    const res = await h.request({ method: 'POST', path, json, headers: { origin: PUBLIC_URL } });
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe(SIGN_IN_REQUIRED);
    expect(errorCode(res)).not.toBe('PASSPHRASE_REQUIRED');
  });

  it.each([
    ['/api/prologue/beat', BEAT_BODY],
    ['/api/prologue/profile', PROFILE_BODY],
  ])('%s with a foreign Origin -> 403 ORIGIN_REJECTED', async (path, json) => {
    const res = await h.request({ method: 'POST', path, json, headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe(ORIGIN_REJECTED);
  });
});
