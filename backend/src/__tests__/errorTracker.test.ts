/**
 * The hosted error tracker (Phase 6, R25b).
 *
 * Uses the SDK's own `createTransport` with a capturing request function, so
 * the assertions run on the exact serialized envelope that would go over the
 * wire. Every value here is an obvious fake.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FAKE_DSN = 'https://fakepublickey@o0.ingest.test.invalid/1';

// Configured secrets: config.ts's redact() knows these. The API key is
// word-characters only so that, placed in a function name, it gets past the
// frame-name pattern and has to be removed by redact().
const FAKE_API_KEY = 'sk_ant_fake_canary_key_0123456789abcdef';
const FAKE_AUTH_SECRET = 'fake-canary-auth-secret-0123456789abcdefgh';
const FAKE_DB_PASSWORD = 'fake-canary-db-password-0123';

// Per-request values: no redactor knows these. They go only into the message,
// the cause, error properties and scope data — never into a function name.
const SESSION_COOKIE_VALUE = 'fakeCanarySessionToken0123456789';
const INVITE_CODE = 'FakeCanaryInviteCode01';
const EMAIL = 'canary.player@example.test';
const PLAYER_TEXT = 'I whisper the true name of the slime king to the river';

const CANARIES = [
  FAKE_API_KEY,
  FAKE_AUTH_SECRET,
  FAKE_DB_PASSWORD,
  SESSION_COOKIE_VALUE,
  INVITE_CODE,
  EMAIL,
  PLAYER_TEXT,
];

/** errorTracker.ts's own directory, which the frame allow-list treats as app code. */
const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fakeRedact(input: string): string {
  let result = input;
  for (const secret of [FAKE_AUTH_SECRET, FAKE_API_KEY, FAKE_DB_PASSWORD]) {
    result = result.split(secret).join('[REDACTED]');
  }
  return result;
}

type SentryModule = typeof import('@sentry/node');

async function startTracker(sentBodies: string[]) {
  const Sentry: SentryModule = await import('@sentry/node');
  const { initErrorTracker } = await import('../errorTracker.js');
  const reporter = await initErrorTracker({
    dsn: FAKE_DSN,
    mode: 'hosted',
    redact: fakeRedact,
    transport: (options) =>
      Sentry.createTransport(options, async (request) => {
        sentBodies.push(
          typeof request.body === 'string' ? request.body : new TextDecoder().decode(request.body),
        );
        return { statusCode: 200 };
      }),
  });
  if (reporter === undefined) throw new Error('expected the tracker to start');
  return { Sentry, reporter };
}

/** Splits a serialized envelope into its header and its event payload. */
function parseEnvelope(body: string): { header: Record<string, unknown>; event: Record<string, unknown> } {
  const lines = body.split('\n').filter((line) => line.length > 0);
  return { header: JSON.parse(lines[0]), event: JSON.parse(lines[2]) };
}

/** Resets the scope data these tests set (Scope has no clear() in this SDK version). */
function clearScopes(Sentry: SentryModule): void {
  for (const scope of [Sentry.getGlobalScope(), Sentry.getIsolationScope(), Sentry.getCurrentScope()]) {
    scope.setUser(null).setContext('request', null).setExtra('canary', undefined).clearBreadcrumbs();
    scope.setTransactionName(undefined);
  }
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(async () => {
  vi.doUnmock('@sentry/node');
  const Sentry: SentryModule = await import('@sentry/node');
  await Sentry.close(100);
  clearScopes(Sentry);
  vi.resetModules();
});

describe('initErrorTracker: off by default', () => {
  it('(i) returns undefined with no DSN, and with a DSN in selfhost, without ever importing the SDK', async () => {
    let imported = false;
    vi.doMock('@sentry/node', () => {
      imported = true;
      throw new Error('the Sentry SDK was imported with the tracker off');
    });
    const { initErrorTracker } = await import('../errorTracker.js');

    expect(await initErrorTracker({ mode: 'hosted' })).toBeUndefined();
    expect(await initErrorTracker({ mode: 'hosted', dsn: '   ' })).toBeUndefined();
    expect(await initErrorTracker({ mode: 'selfhost', dsn: FAKE_DSN })).toBeUndefined();
    expect(imported).toBe(false);
  });
});

describe('initErrorTracker: the payload is rebuilt from an allow-list', () => {
  it('(ii) canary: no secret, cookie, invite code, email or player text reaches the envelope', async () => {
    const sent: string[] = [];
    const { Sentry, reporter } = await startTracker(sent);
    clearScopes(Sentry);

    // Scope data a request handler or a future integration might attach.
    Sentry.setUser({ id: 'user-1', email: EMAIL, ip_address: '203.0.113.9' });
    Sentry.setExtra('canary', { cookie: SESSION_COOKIE_VALUE, invite: INVITE_CODE, text: PLAYER_TEXT });
    Sentry.setContext('request', { cookie: `better-auth.session_token=${SESSION_COOKIE_VALUE}`, email: EMAIL });
    Sentry.setTag('player_text', PLAYER_TEXT);
    Sentry.getCurrentScope().setTransactionName(`/api/invites/redeem?code=${INVITE_CODE}`);

    const everything = [...CANARIES].join(' | ');
    // The message also tries to forge a stack frame inside the app directory,
    // carrying a per-request value in its filename.
    const message =
      `boom ${everything}\n` + `    at forgedFrame (${SRC_DIR}/routes/${INVITE_CODE}.ts:1:1)`;
    const err = new Error(message, { cause: new Error(`cause ${everything}`) });
    Object.assign(err, { cookie: SESSION_COOKIE_VALUE, email: EMAIL, extra: { text: PLAYER_TEXT } });
    err.stack =
      `Error: ${message}\n` +
      `    at leak_${FAKE_API_KEY} (${SRC_DIR}/routes/worldEngine.ts:10:5)\n` +
      `    at handler (${SRC_DIR}/${FAKE_DB_PASSWORD}.ts:20:1)\n` +
      '    at Layer.handle (/app/node_modules/express/lib/router/layer.js:7:3)\n' +
      '    at outsideTheApp (/home/someone/elsewhere/tool.js:3:3)\n' +
      '    at node:internal/process/task_queues:95:5';

    const eventId = reporter.report(err, { code: 'UPSTREAM_ERROR', route: '/api/world-engine' });
    expect(await reporter.flush(2000)).toBe(true);

    expect(sent).toHaveLength(1);
    const body = sent[0];
    for (const canary of CANARIES) {
      expect(body, `envelope leaked ${canary}`).not.toContain(canary);
    }
    expect(body).not.toContain('forgedFrame');
    expect(body).not.toContain('boom');
    expect(body).not.toContain('outsideTheApp');

    // The header, including any trace (dynamic sampling context) block.
    const { header, event } = parseEnvelope(body);
    expect(header.event_id).toBe(eventId);
    const headerText = JSON.stringify(header);
    for (const canary of CANARIES) {
      expect(headerText).not.toContain(canary);
    }
    expect(JSON.stringify(header.trace ?? {})).not.toContain('invites');
    expect(header.trace).toBeUndefined();

    // The event: only allow-listed fields (plus the SDK's own name/version).
    expect(Object.keys(event).sort()).toEqual(
      ['event_id', 'exception', 'level', 'platform', 'sdk', 'tags', 'timestamp'].sort(),
    );
    expect(event.tags).toEqual({ code: 'UPSTREAM_ERROR', route: '/api/world-engine', mode: 'hosted' });
    const values = (event.exception as { values: { type: string; value?: string; stacktrace: { frames: object[] } }[] })
      .values;
    expect(values).toHaveLength(1);
    expect(values[0].type).toBe('Error');
    expect(values[0].value).toBeUndefined();
    expect(values[0].stacktrace.frames).toEqual([
      { function: '?', filename: 'node:internal/process/task_queues', lineno: 95 },
      { function: 'Layer.handle', filename: '/app/node_modules/express/lib/router/layer.js', lineno: 7 },
      { function: 'handler', filename: `${SRC_DIR}/[REDACTED].ts`, lineno: 20 },
      { function: 'leak_[REDACTED]', filename: `${SRC_DIR}/routes/worldEngine.ts`, lineno: 10 },
    ]);
  });

  it('maps an unknown code to INTERNAL_ERROR, a bad route to "unmatched" and a bad type to "Error"', async () => {
    const sent: string[] = [];
    const { reporter } = await startTracker(sent);
    const err = new Error('x');
    err.name = `Type ${EMAIL}`;
    reporter.report(err, { code: `CODE_${INVITE_CODE}`, route: `/api/x?invite=${INVITE_CODE}` });
    await reporter.flush(2000);

    const { event } = parseEnvelope(sent[0]);
    expect(event.tags).toEqual({ code: 'INTERNAL_ERROR', route: 'unmatched', mode: 'hosted' });
    expect((event.exception as { values: { type: string }[] }).values[0].type).toBe('Error');
    expect(sent[0]).not.toContain(INVITE_CODE);
    expect(sent[0]).not.toContain(EMAIL);
  });

  it('reports a thrown non-Error as a bare NON_ERROR, never its contents', async () => {
    const sent: string[] = [];
    const { reporter } = await startTracker(sent);
    reporter.report(`player said: ${PLAYER_TEXT}`, { code: 'INTERNAL_ERROR', route: 'uncaughtException' });
    reporter.report({ email: EMAIL }, { code: 'INTERNAL_ERROR', route: 'unhandledRejection' });
    await reporter.flush(2000);

    expect(sent).toHaveLength(2);
    for (const body of sent) {
      expect(body).not.toContain(PLAYER_TEXT);
      expect(body).not.toContain(EMAIL);
      const { event } = parseEnvelope(body);
      expect((event.exception as { values: { type: string; stacktrace: { frames: unknown[] } }[] }).values).toEqual([
        { type: 'Error', stacktrace: { frames: [] } },
      ]);
    }
  });

  it('(iii) never records or sends a breadcrumb', async () => {
    const sent: string[] = [];
    const { Sentry, reporter } = await startTracker(sent);
    clearScopes(Sentry);
    Sentry.addBreadcrumb({ category: 'console', message: PLAYER_TEXT, data: { email: EMAIL } });

    expect(Sentry.getIsolationScope().getScopeData().breadcrumbs).toEqual([]);
    expect(Sentry.getCurrentScope().getScopeData().breadcrumbs).toEqual([]);

    reporter.report(new Error('with breadcrumbs'), { code: 'INTERNAL_ERROR', route: 'unmatched' });
    await reporter.flush(2000);
    expect(sent[0]).not.toContain('breadcrumbs');
    expect(sent[0]).not.toContain(PLAYER_TEXT);
    expect(sent[0]).not.toContain(EMAIL);
  });
});
