/**
 * `redact()` across every configured hosted secret (Phase 6, R25d).
 *
 * The self-host two-secret behaviour is pinned by config.test.ts; this file
 * covers the generalised, N-secret version: longest-first over overlapping
 * secrets, and every form a DATABASE_URL password can take in a driver error.
 * Every value here is an obvious fake.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Three overlapping secrets: RESEND is a substring of AUTH, and GOOGLE shares
// RESEND's tail. Redacting a shorter one first would leave fragments behind.
const FAKE_RESEND_KEY = 're_overlap_fake_key_0123';
const FAKE_AUTH_SECRET = `authprefix-${FAKE_RESEND_KEY}-authsuffix`;
const FAKE_GOOGLE_SECRET = `google-${FAKE_RESEND_KEY.slice(3)}`;
const FAKE_KEY = 'sk-ant-test-fake-redact-key-never-sent';

// A password with a reserved character in both encoded forms: "@" as %40 and
// "/" as %2F. Drivers may quote it raw (as written in the URL) or decoded.
const RAW_DB_PASSWORD = 'fake%40pass%2Fword-0123456789';
const DECODED_DB_PASSWORD = 'fake@pass/word-0123456789';
const FAKE_DATABASE_URL = `postgres://soulbound:${RAW_DB_PASSWORD}@db.test.invalid:5432/soulbound`;

const VARIABLES = [
  'SOULBOUND_MODE',
  'ANTHROPIC_API_KEY',
  'SOULBOUND_PASSPHRASE',
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'FRONTEND_ORIGIN',
];

function clearEnv(): void {
  for (const name of VARIABLES) {
    delete process.env[name];
  }
}

function setHostedEnv(): void {
  clearEnv();
  process.env.SOULBOUND_MODE = 'hosted';
  process.env.ANTHROPIC_API_KEY = FAKE_KEY;
  process.env.DATABASE_URL = FAKE_DATABASE_URL;
  process.env.BETTER_AUTH_SECRET = FAKE_AUTH_SECRET;
  process.env.BETTER_AUTH_URL = 'https://soulbound.test.invalid';
  process.env.RESEND_API_KEY = FAKE_RESEND_KEY;
  process.env.EMAIL_FROM = 'noreply@soulbound.test.invalid';
  process.env.GOOGLE_CLIENT_ID = 'fake-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = FAKE_GOOGLE_SECRET;
}

beforeEach(() => {
  vi.resetModules();
  setHostedEnv();
});

afterEach(() => {
  clearEnv();
  vi.resetModules();
});

describe('redact() in hosted mode', () => {
  it('has fixtures that really overlap (guards the test itself)', () => {
    expect(FAKE_AUTH_SECRET).toContain(FAKE_RESEND_KEY);
    expect(FAKE_RESEND_KEY).toContain(FAKE_GOOGLE_SECRET.slice('google-'.length));
    expect(decodeURIComponent(RAW_DB_PASSWORD)).toBe(DECODED_DB_PASSWORD);
  });

  it('removes 3+ overlapping secrets longest-first, leaving no fragment of any', async () => {
    const { redact } = await import('../config.js');
    const input = `auth=${FAKE_AUTH_SECRET} resend=${FAKE_RESEND_KEY} google=${FAKE_GOOGLE_SECRET} key=${FAKE_KEY}`;
    const result = redact(input);
    expect(result).toBe('auth=[REDACTED] resend=[REDACTED] google=[REDACTED] key=[REDACTED]');
    expect(result).not.toContain('authprefix');
    expect(result).not.toContain('authsuffix');
    expect(result).not.toContain('overlap');
  });

  it('removes the full DATABASE_URL as one token', async () => {
    const { redact } = await import('../config.js');
    expect(redact(`connect ECONNREFUSED ${FAKE_DATABASE_URL}`)).toBe('connect ECONNREFUSED [REDACTED]');
  });

  it('removes the raw (percent-encoded) DATABASE_URL password on its own', async () => {
    const { redact } = await import('../config.js');
    const result = redact(`password "${RAW_DB_PASSWORD}" rejected`);
    expect(result).toBe('password "[REDACTED]" rejected');
  });

  it('removes the URL-decoded DATABASE_URL password on its own', async () => {
    const { redact } = await import('../config.js');
    const result = redact(`password authentication failed for "${DECODED_DB_PASSWORD}"`);
    expect(result).toBe('password authentication failed for "[REDACTED]"');
    expect(result).not.toContain('pass/word');
  });

  it('leaves a string with no secrets unchanged', async () => {
    const { redact } = await import('../config.js');
    const plain = 'The slime rests by the river; nothing secret here. user@example.com 0123456789';
    expect(redact(plain)).toBe(plain);
    expect(redact('')).toBe('');
  });

  it('never matches an empty secret (an empty OAuth secret, a password-less DB URL)', async () => {
    process.env.DATABASE_URL = 'postgres://soulbound@localhost:5432/soulbound_test';
    delete process.env.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_SECRET = '';
    process.env.DISCORD_CLIENT_SECRET = '   ';
    const { redact } = await import('../config.js');
    const plain = 'abc def — ordinary text';
    expect(redact(plain)).toBe(plain);
    // The URL itself is still a configured secret.
    expect(redact('postgres://soulbound@localhost:5432/soulbound_test')).toBe('[REDACTED]');
  });
});

describe('redact() in selfhost mode', () => {
  it('ignores hosted secrets (taken but unused), and still strips the key and passphrase', async () => {
    process.env.SOULBOUND_MODE = 'selfhost';
    process.env.SOULBOUND_PASSPHRASE = 'test-passphrase-not-real';
    const { redact } = await import('../config.js');
    expect(redact(`k=${FAKE_KEY} p=test-passphrase-not-real`)).toBe('k=[REDACTED] p=[REDACTED]');
    expect(redact('plain text')).toBe('plain text');
  });
});
