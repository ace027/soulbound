/**
 * Hosted-mode tests for `config.ts` (Phase 6, R23 / R25d).
 *
 * Same pattern as config.test.ts: every case re-imports the module with
 * `vi.resetModules()` and its own environment, because config.ts reads (and
 * deletes) `process.env` exactly once, at load. Every value here is an obvious
 * fake.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FAKE_KEY = 'sk-ant-test-fake-hosted-key-never-sent';
const FAKE_PASSPHRASE = 'test-passphrase-not-real';
const FAKE_DB_PASSWORD = 'fake-db-password-0123456789';
const FAKE_DATABASE_URL = `postgres://soulbound:${FAKE_DB_PASSWORD}@db.test.invalid:5432/soulbound`;
const FAKE_AUTH_SECRET = 'fake-better-auth-secret-0123456789abcdef';
const FAKE_RESEND_KEY = 're_fake_resend_key_0123456789';
const FAKE_GOOGLE_SECRET = 'fake-google-client-secret-0123';
const FAKE_DISCORD_SECRET = 'fake-discord-client-secret-0123';
const PUBLIC_URL = 'https://soulbound.test.invalid';

/** Every secret value this file ever configures, for the leak checks. */
const ALL_SECRET_VALUES = [
  FAKE_KEY,
  FAKE_PASSPHRASE,
  FAKE_DATABASE_URL,
  FAKE_DB_PASSWORD,
  FAKE_AUTH_SECRET,
  FAKE_RESEND_KEY,
  FAKE_GOOGLE_SECRET,
  FAKE_DISCORD_SECRET,
];

/** The seven secrets config.ts must take out of process.env before anything else. */
const SECRET_VARIABLES = [
  'ANTHROPIC_API_KEY',
  'SOULBOUND_PASSPHRASE',
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'RESEND_API_KEY',
  'GOOGLE_CLIENT_SECRET',
  'DISCORD_CLIENT_SECRET',
] as const;

const ALL_VARIABLES = [
  ...SECRET_VARIABLES,
  'SOULBOUND_MODE',
  'BETTER_AUTH_URL',
  'EMAIL_FROM',
  'GOOGLE_CLIENT_ID',
  'DISCORD_CLIENT_ID',
  'SENTRY_DSN',
  'USER_RATE_LIMIT_PER_MINUTE',
  'FRONTEND_ORIGIN',
  'ALLOWED_HOSTS',
  'PORT',
  'RATE_LIMIT_PER_MINUTE',
  'TRUST_PROXY',
  'STATIC_DIR',
];

const originalNodeEnv = process.env.NODE_ENV;

function clearEnv(): void {
  for (const name of ALL_VARIABLES) {
    delete process.env[name];
  }
  process.env.NODE_ENV = originalNodeEnv;
}

/** A complete, valid hosted environment (no passphrase). */
function setHostedEnv(): void {
  clearEnv();
  process.env.SOULBOUND_MODE = 'hosted';
  process.env.ANTHROPIC_API_KEY = FAKE_KEY;
  process.env.DATABASE_URL = FAKE_DATABASE_URL;
  process.env.BETTER_AUTH_SECRET = FAKE_AUTH_SECRET;
  process.env.BETTER_AUTH_URL = PUBLIC_URL;
  process.env.RESEND_API_KEY = FAKE_RESEND_KEY;
  process.env.EMAIL_FROM = 'Soulbound <noreply@soulbound.test.invalid>';
  process.env.GOOGLE_CLIENT_ID = 'fake-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = FAKE_GOOGLE_SECRET;
  process.env.DISCORD_CLIENT_ID = 'fake-discord-client-id';
  process.env.DISCORD_CLIENT_SECRET = FAKE_DISCORD_SECRET;
}

async function importError(): Promise<Error> {
  try {
    await import('../config.js');
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
    return err as Error;
  }
  throw new Error('expected config.ts to throw, but it loaded');
}

beforeEach(() => {
  vi.resetModules();
  setHostedEnv();
});

afterEach(() => {
  clearEnv();
  vi.resetModules();
});

describe('SOULBOUND_MODE', () => {
  it('an invalid mode throws naming both valid values, and leaves none of the 7 secrets in process.env', async () => {
    process.env.SOULBOUND_PASSPHRASE = FAKE_PASSPHRASE;
    process.env.SOULBOUND_MODE = 'multiplayer';
    for (const name of SECRET_VARIABLES) {
      expect(process.env[name], `${name} set before import`).toBeDefined();
    }

    const err = await importError();
    expect(err.message).toMatch(/SOULBOUND_MODE/);
    expect(err.message).toContain('selfhost');
    expect(err.message).toContain('hosted');
    for (const name of SECRET_VARIABLES) {
      expect(process.env[name], `${name} left in process.env`).toBeUndefined();
    }
  });

  it('defaults to selfhost when unset', async () => {
    delete process.env.SOULBOUND_MODE;
    process.env.SOULBOUND_PASSPHRASE = FAKE_PASSPHRASE;
    const { MODE } = await import('../config.js');
    expect(MODE).toBe('selfhost');
  });

  it('selfhost with hosted secrets also set (a shared .env) boots, and still removes them from process.env', async () => {
    process.env.SOULBOUND_MODE = 'selfhost';
    process.env.SOULBOUND_PASSPHRASE = FAKE_PASSPHRASE;
    const config = await import('../config.js');
    expect(config.MODE).toBe('selfhost');
    expect(config.HOSTED_PUBLIC_URL).toBeUndefined();
    expect(config.SENTRY_DSN).toBeUndefined();
    expect(config.checkPassphrase(FAKE_PASSPHRASE)).toBe(true);
    for (const name of SECRET_VARIABLES) {
      expect(process.env[name], `${name} left in process.env`).toBeUndefined();
    }
  });
});

describe('hosted mode: required variables', () => {
  it.each([
    ['DATABASE_URL'],
    ['BETTER_AUTH_SECRET'],
    ['BETTER_AUTH_URL'],
    ['RESEND_API_KEY'],
    ['EMAIL_FROM'],
  ])('is fatal when %s is missing, and the message names it', async (name) => {
    delete process.env[name];
    const err = await importError();
    expect(err.message).toContain(`Missing required environment variable: ${name}`);
  });

  it('rejects a 31-character BETTER_AUTH_SECRET', async () => {
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(31);
    const err = await importError();
    expect(err.message).toMatch(/BETTER_AUTH_SECRET/);
    expect(err.message).toMatch(/at least 32/);
  });

  it('accepts a 32-character BETTER_AUTH_SECRET', async () => {
    process.env.BETTER_AUTH_SECRET = 'y'.repeat(32);
    const { MODE } = await import('../config.js');
    expect(MODE).toBe('hosted');
  });

  it('rejects a RESEND_API_KEY shorter than 16 characters', async () => {
    process.env.RESEND_API_KEY = 're_short_15char';
    const err = await importError();
    expect(err.message).toMatch(/RESEND_API_KEY/);
    expect(err.message).toMatch(/at least 16/);
  });

  it('rejects an OAuth client secret shorter than 16 characters', async () => {
    process.env.DISCORD_CLIENT_SECRET = 'discord-short';
    const err = await importError();
    expect(err.message).toMatch(/DISCORD_CLIENT_SECRET/);
  });

  it('rejects an OAuth client ID without its secret, naming the missing one', async () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    const err = await importError();
    expect(err.message).toMatch(/GOOGLE_CLIENT_SECRET/);
  });

  it('boots with no OAuth providers configured', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.DISCORD_CLIENT_ID;
    delete process.env.DISCORD_CLIENT_SECRET;
    const { GOOGLE_CLIENT_ID, DISCORD_CLIENT_ID, getHostedSecrets } = await import('../config.js');
    expect(GOOGLE_CLIENT_ID).toBeUndefined();
    expect(DISCORD_CLIENT_ID).toBeUndefined();
    const secrets = getHostedSecrets();
    expect('googleClientSecret' in secrets).toBe(false);
    expect('discordClientSecret' in secrets).toBe(false);
  });

  it('rejects a DATABASE_URL whose password is shorter than 16 characters', async () => {
    process.env.DATABASE_URL = 'postgres://soulbound:postgres@db.test.invalid:5432/soulbound';
    const err = await importError();
    expect(err.message).toMatch(/DATABASE_URL password/);
    expect(err.message).not.toContain('postgres@');
  });

  it('accepts a password-less DATABASE_URL (a local trust-auth test cluster)', async () => {
    process.env.DATABASE_URL = 'postgres://soulbound@localhost:5432/soulbound_test';
    const { getHostedSecrets } = await import('../config.js');
    expect(getHostedSecrets().databaseUrl).toBe('postgres://soulbound@localhost:5432/soulbound_test');
  });

  it('rejects a DATABASE_URL that is not a postgres connection string, without echoing it', async () => {
    process.env.DATABASE_URL = `mysql://soulbound:${FAKE_DB_PASSWORD}@db.test.invalid/soulbound`;
    const err = await importError();
    expect(err.message).toMatch(/DATABASE_URL/);
    expect(err.message).not.toContain(FAKE_DB_PASSWORD);
  });
});

describe('hosted mode: BETTER_AUTH_URL', () => {
  it('rejects a plain-http non-localhost origin', async () => {
    process.env.BETTER_AUTH_URL = 'http://example.com';
    const err = await importError();
    expect(err.message).toMatch(/BETTER_AUTH_URL/);
    expect(err.message).toMatch(/https/);
  });

  it('accepts http://localhost:5173 outside production', async () => {
    process.env.NODE_ENV = 'development';
    process.env.BETTER_AUTH_URL = 'http://localhost:5173';
    const { HOSTED_PUBLIC_URL, FRONTEND_ORIGIN } = await import('../config.js');
    expect(HOSTED_PUBLIC_URL).toBe('http://localhost:5173');
    expect(FRONTEND_ORIGIN).toBe('http://localhost:5173');
  });

  it('rejects http://localhost:5173 when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BETTER_AUTH_URL = 'http://localhost:5173';
    const err = await importError();
    expect(err.message).toMatch(/BETTER_AUTH_URL/);
  });

  it('rejects a URL with a path (it must be a bare origin)', async () => {
    process.env.BETTER_AUTH_URL = `${PUBLIC_URL}/app`;
    const err = await importError();
    expect(err.message).toMatch(/BETTER_AUTH_URL/);
  });
});

describe('hosted mode: passphrase and FRONTEND_ORIGIN', () => {
  it('refuses to boot when SOULBOUND_PASSPHRASE is set, and still removes it from process.env', async () => {
    process.env.SOULBOUND_PASSPHRASE = FAKE_PASSPHRASE;
    const err = await importError();
    expect(err.message).toMatch(/SOULBOUND_PASSPHRASE/);
    expect(err.message).toMatch(/not used in hosted mode/);
    expect(process.env.SOULBOUND_PASSPHRASE).toBeUndefined();
  });

  it('defaults FRONTEND_ORIGIN to BETTER_AUTH_URL', async () => {
    const { FRONTEND_ORIGIN } = await import('../config.js');
    expect(FRONTEND_ORIGIN).toBe(PUBLIC_URL);
  });

  it('accepts a FRONTEND_ORIGIN equal to BETTER_AUTH_URL (trailing slash normalized)', async () => {
    process.env.FRONTEND_ORIGIN = `${PUBLIC_URL}/`;
    const { FRONTEND_ORIGIN } = await import('../config.js');
    expect(FRONTEND_ORIGIN).toBe(PUBLIC_URL);
  });

  it('rejects a FRONTEND_ORIGIN that differs from BETTER_AUTH_URL', async () => {
    process.env.FRONTEND_ORIGIN = 'https://elsewhere.test.invalid';
    const err = await importError();
    expect(err.message).toMatch(/FRONTEND_ORIGIN/);
    expect(err.message).toMatch(/BETTER_AUTH_URL/);
  });
});

describe('hosted mode: USER_RATE_LIMIT_PER_MINUTE', () => {
  it('defaults to 60', async () => {
    const { USER_RATE_LIMIT_PER_MINUTE } = await import('../config.js');
    expect(USER_RATE_LIMIT_PER_MINUTE).toBe(60);
  });

  it.each([['0'], ['601'], ['12.5'], ['lots']])('rejects %s', async (value) => {
    process.env.USER_RATE_LIMIT_PER_MINUTE = value;
    const err = await importError();
    expect(err.message).toMatch(/USER_RATE_LIMIT_PER_MINUTE/);
  });

  it('is undefined in selfhost, even when set to an invalid value', async () => {
    delete process.env.SOULBOUND_MODE;
    process.env.SOULBOUND_PASSPHRASE = FAKE_PASSPHRASE;
    process.env.USER_RATE_LIMIT_PER_MINUTE = '0';
    const { USER_RATE_LIMIT_PER_MINUTE } = await import('../config.js');
    expect(USER_RATE_LIMIT_PER_MINUTE).toBeUndefined();
  });
});

describe('hosted mode: happy path and accessors', () => {
  it('loads with MODE === "hosted", and getHostedSecrets() returns the configured values', async () => {
    process.env.SENTRY_DSN = 'https://fakepublickey@o0.ingest.test.invalid/0';
    const config = await import('../config.js');
    expect(config.MODE).toBe('hosted');
    expect(config.HOSTED_PUBLIC_URL).toBe(PUBLIC_URL);
    expect(config.EMAIL_FROM).toBe('Soulbound <noreply@soulbound.test.invalid>');
    expect(config.GOOGLE_CLIENT_ID).toBe('fake-google-client-id');
    expect(config.DISCORD_CLIENT_ID).toBe('fake-discord-client-id');
    expect(config.SENTRY_DSN).toBe('https://fakepublickey@o0.ingest.test.invalid/0');
    expect(config.getAnthropicApiKey()).toBe(FAKE_KEY);
    expect(config.getHostedSecrets()).toEqual({
      databaseUrl: FAKE_DATABASE_URL,
      betterAuthSecret: FAKE_AUTH_SECRET,
      resendApiKey: FAKE_RESEND_KEY,
      googleClientSecret: FAKE_GOOGLE_SECRET,
      discordClientSecret: FAKE_DISCORD_SECRET,
    });
    for (const name of [...SECRET_VARIABLES, 'BETTER_AUTH_URL', 'SENTRY_DSN']) {
      expect(process.env[name], `${name} left in process.env`).toBeUndefined();
    }
  });

  it('getHostedSecrets() throws in selfhost', async () => {
    delete process.env.SOULBOUND_MODE;
    process.env.SOULBOUND_PASSPHRASE = FAKE_PASSPHRASE;
    const { getHostedSecrets } = await import('../config.js');
    expect(() => getHostedSecrets()).toThrow(/not available in self-host mode/);
  });

  it('checkPassphrase throws in hosted', async () => {
    const { checkPassphrase } = await import('../config.js');
    expect(() => checkPassphrase(FAKE_PASSPHRASE)).toThrow(
      'checkPassphrase is not available in hosted mode',
    );
  });

  it('JSON.stringify of the whole module contains no secret', async () => {
    const config = await import('../config.js');
    const serialized = JSON.stringify(config);
    for (const secret of ALL_SECRET_VALUES) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe('hosted mode: no thrown message contains a secret', () => {
  // Each scenario breaks exactly one thing in an otherwise complete hosted
  // environment that carries every secret, then checks the resulting message
  // against all of them.
  const scenarios: [string, () => void][] = [
    ['invalid mode', () => (process.env.SOULBOUND_MODE = 'nope')],
    ['passphrase set', () => (process.env.SOULBOUND_PASSPHRASE = FAKE_PASSPHRASE)],
    ['short auth secret', () => (process.env.BETTER_AUTH_SECRET = FAKE_AUTH_SECRET.slice(0, 31))],
    ['short resend key', () => (process.env.RESEND_API_KEY = FAKE_RESEND_KEY.slice(0, 15))],
    ['short google secret', () => (process.env.GOOGLE_CLIENT_SECRET = FAKE_GOOGLE_SECRET.slice(0, 15))],
    ['discord id without secret', () => delete process.env.DISCORD_CLIENT_SECRET],
    [
      'non-postgres database URL',
      () => (process.env.DATABASE_URL = FAKE_DATABASE_URL.replace('postgres:', 'mysql:')),
    ],
    [
      'bad percent-encoding in the database password',
      () => (process.env.DATABASE_URL = FAKE_DATABASE_URL.replace(FAKE_DB_PASSWORD, `${FAKE_DB_PASSWORD}%zz`)),
    ],
    [
      'short database password',
      () => (process.env.DATABASE_URL = FAKE_DATABASE_URL.replace(FAKE_DB_PASSWORD, FAKE_DB_PASSWORD.slice(0, 15))),
    ],
    ['http auth URL', () => (process.env.BETTER_AUTH_URL = 'http://example.com')],
    ['missing email sender', () => delete process.env.EMAIL_FROM],
    ['frontend origin mismatch', () => (process.env.FRONTEND_ORIGIN = 'https://elsewhere.test.invalid')],
    ['missing API key', () => delete process.env.ANTHROPIC_API_KEY],
  ];

  it.each(scenarios)('%s', async (_label, breakIt) => {
    breakIt();
    const err = await importError();
    const text = `${err.message}\n${err.stack ?? ''}`;
    for (const secret of [...ALL_SECRET_VALUES, FAKE_DB_PASSWORD.slice(0, 15)]) {
      expect(text).not.toContain(secret);
    }
  });
});
