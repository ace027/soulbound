/**
 * `npm run tracker:test -w @soulbound/backend`: sends ONE canary event to the
 * configured error tracker, for checking the live dashboard (06-07 runbook).
 *
 * Reads only SENTRY_DSN (read and deleted, like config.ts does) and never
 * imports config.ts, so it runs without any other app secret. The canary
 * error is full of obviously fake, secret-shaped values; if any of them shows
 * up on the dashboard, the allow-list in errorTracker.ts has a hole.
 */

import { initErrorTracker } from '../errorTracker.js';

const CANARY_VALUES = [
  'sk-ant-FAKE-canary-api-key-not-real-0000000000',
  'FAKE-canary-better-auth-secret-not-real-000000',
  'postgres://soulbound:FAKE-canary-db-password@db.invalid:5432/soulbound',
  'better-auth.session_token=FAKEcanarySessionToken0000',
  'FAKEcanaryInviteCode00',
  'canary.player@example.invalid',
  'I whisper the true name of the slime king to the river (canary player text)',
];

async function run(): Promise<number> {
  const dsn = process.env.SENTRY_DSN;
  delete process.env.SENTRY_DSN;
  if (!dsn || dsn.trim().length === 0) {
    console.error('SENTRY_DSN is not set; nothing to send. Set it and re-run.');
    return 1;
  }

  const reporter = await initErrorTracker({ dsn, mode: 'hosted' });
  if (reporter === undefined) {
    console.error('The error tracker did not start.');
    return 1;
  }

  const canary = new Error(`tracker canary: ${CANARY_VALUES.join(' | ')}`, {
    cause: new Error(CANARY_VALUES.join(' | ')),
  });
  Object.assign(canary, { cookie: CANARY_VALUES[3], email: CANARY_VALUES[5] });

  const eventId = reporter.report(canary, { code: 'INTERNAL_ERROR', route: 'tracker:test' });
  const sent = await reporter.flush(5000);
  if (!sent) {
    console.error(`Event ${eventId} did not leave the send queue within 5 s.`);
    return 1;
  }
  // flush() resolving true means the queue drained, NOT that the tracker
  // accepted the event (a network failure also drains it). The dashboard is
  // the only confirmation.
  console.log(`Canary event ${eventId} left the send queue. Delivery is confirmed only on the dashboard.`);
  console.log('There, confirm it shows only: the type "Error", frames, and the tags');
  console.log('code=INTERNAL_ERROR, route=tracker:test, mode=hosted. No canary value may appear.');
  return 0;
}

run().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error('tracker:test failed:', err instanceof Error ? err.name : 'non-Error');
    process.exit(1);
  },
);
