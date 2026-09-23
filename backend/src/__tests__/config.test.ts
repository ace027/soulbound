/**
 * Fail-fast tests for `config.ts`.
 *
 * Every value here is read once, at module load, and a bad one is fatal by
 * design: a backend that boots with a broken CORS policy or a key that carries
 * a trailing newline does not fail visibly, it fails three calls deep into
 * gameplay with a message that points somewhere else entirely.
 *
 * Each case re-imports the module with `vi.resetModules()` and its own env,
 * because `config.ts` reads `process.env` exactly once — and deletes
 * `ANTHROPIC_API_KEY` as it does, so every case sets it again.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FAKE_KEY = 'sk-ant-test-fake-key-never-sent-mocked-only';
const FAKE_PASSPHRASE = 'test-passphrase-not-real';

function resetEnv(): void {
  process.env.ANTHROPIC_API_KEY = FAKE_KEY;
  process.env.SOULBOUND_PASSPHRASE = FAKE_PASSPHRASE;
  delete process.env.FRONTEND_ORIGIN;
  delete process.env.ALLOWED_HOSTS;
  delete process.env.PORT;
  // The three Phase 5 optional settings. Deleted here, not just left unset by
  // omission, so a case that sets TRUST_PROXY=true (etc.) to assert a throw
  // can't leak that value into the next case via a stale process.env — every
  // case starts from a clean slate.
  delete process.env.RATE_LIMIT_PER_MINUTE;
  delete process.env.TRUST_PROXY;
  delete process.env.STATIC_DIR;
}

beforeEach(() => {
  vi.resetModules();
  resetEnv();
});

afterEach(() => {
  resetEnv();
  vi.resetModules();
});

describe('ANTHROPIC_API_KEY', () => {
  it('is stored trimmed — a trailing newline from a pasted .env never reaches the header', async () => {
    process.env.ANTHROPIC_API_KEY = `${FAKE_KEY}\n`;
    const { getAnthropicApiKey, redact } = await import('../config.js');

    expect(getAnthropicApiKey()).toBe(FAKE_KEY);
    expect(getAnthropicApiKey()).not.toMatch(/\s$/);
    // redact() must strip the bytes actually sent, i.e. the trimmed ones.
    expect(redact(`x-api-key: ${FAKE_KEY}`)).toBe('x-api-key: [REDACTED]');
  });

  it('is still fatal when absent or whitespace-only', async () => {
    process.env.ANTHROPIC_API_KEY = '   ';
    await expect(import('../config.js')).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it('is removed from process.env once read', async () => {
    await import('../config.js');
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('is removed from process.env even when SOULBOUND_PASSPHRASE is the one that is invalid', async () => {
    // Both secrets must come OUT of process.env before EITHER is validated —
    // not "read-and-validate the key, then read-and-validate the
    // passphrase". Otherwise a passphrase-validation failure here would never
    // even reach the point of deleting ANTHROPIC_API_KEY (this case), and
    // conversely a key-validation failure must not leave the passphrase
    // sitting in process.env either (the next case). Both directions matter:
    // whichever one is invalid, NEITHER raw value should survive in the
    // environment by the time the throw happens.
    process.env.SOULBOUND_PASSPHRASE = 'short';
    await expect(import('../config.js')).rejects.toThrow(/SOULBOUND_PASSPHRASE/);
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(process.env.SOULBOUND_PASSPHRASE).toBeUndefined();
  });
});

describe('SOULBOUND_PASSPHRASE', () => {
  it('is fatal when absent or whitespace-only', async () => {
    process.env.SOULBOUND_PASSPHRASE = '   ';
    await expect(import('../config.js')).rejects.toThrow(/SOULBOUND_PASSPHRASE/);
  });

  it('is fatal when shorter than the minimum, and the message never echoes the value', async () => {
    const short = 'shortpass';
    process.env.SOULBOUND_PASSPHRASE = short;
    let thrown: unknown;
    try {
      await import('../config.js');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toMatch(/at least 12/);
    expect(message).not.toContain(short);
  });

  it('rejects a non-ASCII character (accented letter)', async () => {
    process.env.SOULBOUND_PASSPHRASE = 'passphrase-café-ok';
    await expect(import('../config.js')).rejects.toThrow(/printable ASCII/);
  });

  it('rejects a non-ASCII character (emoji)', async () => {
    process.env.SOULBOUND_PASSPHRASE = 'passphrase-🔥-emoji';
    await expect(import('../config.js')).rejects.toThrow(/printable ASCII/);
  });

  it('is removed from process.env once read', async () => {
    await import('../config.js');
    expect(process.env.SOULBOUND_PASSPHRASE).toBeUndefined();
  });

  it('is removed from process.env even when ANTHROPIC_API_KEY is the one that is invalid', async () => {
    // The reverse direction of the case in the ANTHROPIC_API_KEY describe
    // block above: a missing/invalid key must not leave the real passphrase
    // sitting unguarded in process.env at the moment config.ts throws.
    process.env.ANTHROPIC_API_KEY = '   ';
    await expect(import('../config.js')).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(process.env.SOULBOUND_PASSPHRASE).toBeUndefined();
  });

  it('is trimmed before validation and comparison', async () => {
    process.env.SOULBOUND_PASSPHRASE = `  ${FAKE_PASSPHRASE}  `;
    const { checkPassphrase } = await import('../config.js');
    expect(checkPassphrase(FAKE_PASSPHRASE)).toBe(true);
  });
});

describe('checkPassphrase', () => {
  it('accepts the exact configured passphrase', async () => {
    const { checkPassphrase } = await import('../config.js');
    expect(checkPassphrase(FAKE_PASSPHRASE)).toBe(true);
  });

  it('rejects a wrong candidate', async () => {
    const { checkPassphrase } = await import('../config.js');
    expect(checkPassphrase('definitely-the-wrong-one')).toBe(false);
  });

  it('rejects a candidate of a different length without throwing', async () => {
    const { checkPassphrase } = await import('../config.js');
    expect(() => checkPassphrase('short')).not.toThrow();
    expect(checkPassphrase('short')).toBe(false);
  });

  it('rejects an empty candidate', async () => {
    const { checkPassphrase } = await import('../config.js');
    expect(checkPassphrase('')).toBe(false);
  });
});

describe('redact()', () => {
  it('strips both the API key and the passphrase from one string', async () => {
    const { redact } = await import('../config.js');
    const input = `key=${FAKE_KEY} pass=${FAKE_PASSPHRASE}`;
    expect(redact(input)).toBe('key=[REDACTED] pass=[REDACTED]');
  });

  it('redacts the longer secret first, so a shorter secret that is a substring of it cannot leave a fragment behind', async () => {
    vi.resetModules();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-shared-substring-suffix';
    // The passphrase (>=12 chars) is a substring of the key above. If the
    // shorter one were redacted first, only the passphrase-length slice
    // inside each key occurrence would be replaced, leaving key fragments
    // ("sk-ant-" plus leftover characters) in the output instead of one
    // clean [REDACTED] per occurrence.
    process.env.SOULBOUND_PASSPHRASE = 'shared-substring-suffix';
    const { redact } = await import('../config.js');

    const input = 'leaked key: sk-ant-shared-substring-suffix';
    const result = redact(input);
    expect(result).toBe('leaked key: [REDACTED]');
    // Specifically: no fragment of either secret survives.
    expect(result).not.toContain('shared-substring-suffix');
    expect(result).not.toContain('sk-ant-');
  });
});

describe('RATE_LIMIT_PER_MINUTE', () => {
  it('defaults to 30 when unset', async () => {
    const { RATE_LIMIT_PER_MINUTE } = await import('../config.js');
    expect(RATE_LIMIT_PER_MINUTE).toBe(30);
  });

  it('accepts a valid integer in range', async () => {
    process.env.RATE_LIMIT_PER_MINUTE = '60';
    const { RATE_LIMIT_PER_MINUTE } = await import('../config.js');
    expect(RATE_LIMIT_PER_MINUTE).toBe(60);
  });

  it('rejects a non-numeric value', async () => {
    process.env.RATE_LIMIT_PER_MINUTE = 'lots';
    await expect(import('../config.js')).rejects.toThrow(/RATE_LIMIT_PER_MINUTE/);
  });

  it('rejects zero', async () => {
    process.env.RATE_LIMIT_PER_MINUTE = '0';
    await expect(import('../config.js')).rejects.toThrow(/RATE_LIMIT_PER_MINUTE/);
  });

  it('rejects a value above 600', async () => {
    process.env.RATE_LIMIT_PER_MINUTE = '601';
    await expect(import('../config.js')).rejects.toThrow(/RATE_LIMIT_PER_MINUTE/);
  });

  it('rejects a non-integer', async () => {
    process.env.RATE_LIMIT_PER_MINUTE = '30.5';
    await expect(import('../config.js')).rejects.toThrow(/RATE_LIMIT_PER_MINUTE/);
  });
});

describe('TRUST_PROXY', () => {
  it('defaults to false when unset', async () => {
    const { TRUST_PROXY } = await import('../config.js');
    expect(TRUST_PROXY).toBe(false);
  });

  it('accepts the literal string "false"', async () => {
    process.env.TRUST_PROXY = 'false';
    const { TRUST_PROXY } = await import('../config.js');
    expect(TRUST_PROXY).toBe(false);
  });

  it('accepts "loopback"', async () => {
    process.env.TRUST_PROXY = 'loopback';
    const { TRUST_PROXY } = await import('../config.js');
    expect(TRUST_PROXY).toBe('loopback');
  });

  it('accepts "uniquelocal"', async () => {
    process.env.TRUST_PROXY = 'uniquelocal';
    const { TRUST_PROXY } = await import('../config.js');
    expect(TRUST_PROXY).toBe('uniquelocal');
  });

  it('accepts an integer hop count 1-5', async () => {
    process.env.TRUST_PROXY = '2';
    const { TRUST_PROXY } = await import('../config.js');
    expect(TRUST_PROXY).toBe(2);
  });

  it('rejects "true" — every hop is spoofable with no proxy in front', async () => {
    process.env.TRUST_PROXY = 'true';
    await expect(import('../config.js')).rejects.toThrow(/TRUST_PROXY/);
  });

  it('rejects an unknown string', async () => {
    process.env.TRUST_PROXY = 'nonsense';
    await expect(import('../config.js')).rejects.toThrow(/TRUST_PROXY/);
  });

  it('rejects an out-of-range integer', async () => {
    process.env.TRUST_PROXY = '6';
    await expect(import('../config.js')).rejects.toThrow(/TRUST_PROXY/);
  });
});

describe('STATIC_DIR', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'soulbound-static-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is undefined when unset', async () => {
    const { STATIC_DIR } = await import('../config.js');
    expect(STATIC_DIR).toBeUndefined();
  });

  it('accepts an absolute directory containing index.html', async () => {
    writeFileSync(path.join(tmpDir, 'index.html'), '<html></html>');
    process.env.STATIC_DIR = tmpDir;
    const { STATIC_DIR } = await import('../config.js');
    expect(STATIC_DIR).toBe(tmpDir);
  });

  it('rejects a relative path', async () => {
    process.env.STATIC_DIR = 'frontend/dist';
    await expect(import('../config.js')).rejects.toThrow(/STATIC_DIR/);
  });

  it('rejects a directory with no index.html', async () => {
    process.env.STATIC_DIR = tmpDir;
    await expect(import('../config.js')).rejects.toThrow(/STATIC_DIR/);
  });
});

describe('FRONTEND_ORIGIN', () => {
  it('rejects "*" — a wildcard ACAO turns a money-spending backend into an open proxy', async () => {
    process.env.FRONTEND_ORIGIN = '*';
    await expect(import('../config.js')).rejects.toThrow(/FRONTEND_ORIGIN/);
  });

  it('rejects a value new URL() cannot parse', async () => {
    process.env.FRONTEND_ORIGIN = 'http://';
    await expect(import('../config.js')).rejects.toThrow(/not a parseable URL/);
  });

  it('rejects a scheme-less value, which parses but has no origin a browser can send', async () => {
    // `new URL('localhost:5173')` succeeds — "localhost:" is read as the
    // scheme — and yields the literal origin "null". Nothing would ever match
    // it, so it is rejected as loudly as an unparseable value.
    process.env.FRONTEND_ORIGIN = 'localhost:5173';
    await expect(import('../config.js')).rejects.toThrow(/no origin/);
  });

  it('rejects a non-http scheme with no real origin', async () => {
    process.env.FRONTEND_ORIGIN = 'data:text/plain,hi';
    await expect(import('../config.js')).rejects.toThrow(/no origin/);
  });

  it('normalizes to URL.origin, so a trailing slash still matches a browser Origin header', async () => {
    process.env.FRONTEND_ORIGIN = 'http://localhost:5173/';
    const { FRONTEND_ORIGIN } = await import('../config.js');
    expect(FRONTEND_ORIGIN).toBe('http://localhost:5173');
  });

  it('defaults to the Vite dev origin', async () => {
    const { FRONTEND_ORIGIN } = await import('../config.js');
    expect(FRONTEND_ORIGIN).toBe('http://localhost:5173');
  });
});

describe('ALLOWED_HOSTS', () => {
  it('derives loopback hosts from PORT by default', async () => {
    process.env.PORT = '3001';
    const { ALLOWED_HOSTS } = await import('../config.js');
    expect([...ALLOWED_HOSTS]).toEqual(['localhost:3001', '127.0.0.1:3001', '[::1]:3001']);
  });

  it('follows a non-default PORT', async () => {
    process.env.PORT = '4242';
    const { ALLOWED_HOSTS } = await import('../config.js');
    expect([...ALLOWED_HOSTS]).toEqual(['localhost:4242', '127.0.0.1:4242', '[::1]:4242']);
  });

  it('is overridable, comma-separated, lowercased and trimmed', async () => {
    process.env.ALLOWED_HOSTS = ' Soulbound.local:8080 , 127.0.0.1 ';
    const { ALLOWED_HOSTS } = await import('../config.js');
    expect([...ALLOWED_HOSTS]).toEqual(['soulbound.local:8080', '127.0.0.1']);
  });

  it('rejects "*" — that re-opens the DNS-rebinding path the list exists to close', async () => {
    process.env.ALLOWED_HOSTS = 'localhost:3001,*';
    await expect(import('../config.js')).rejects.toThrow(/ALLOWED_HOSTS/);
  });
});

describe('MODELS', () => {
  it('names exactly the three call sites, with no date-suffixed model IDs', async () => {
    const { MODELS } = await import('../config.js');
    expect(MODELS).toEqual({
      uniqueSkill: 'claude-opus-5',
      worldEngine: 'claude-sonnet-5',
      introScene: 'claude-sonnet-5',
    });
  });

  /**
   * The invariant, asserted separately from the current values above so that a
   * future model change has to break it deliberately rather than by accident.
   *
   * worldEngine and introScene are the only two routes that send system blocks,
   * so they share one model-scoped prompt cache. Whichever runs first pays the
   * ~15.5k-token write; the rest read it ~12x cheaper. Splitting them across
   * models strands the other's cache warmth and produces no error — only a
   * bill. WHICH model they share is a free choice; THAT they share one is not.
   */
  it('keeps worldEngine and introScene on the same model — they share a cache', async () => {
    const { MODELS } = await import('../config.js');
    expect(MODELS.worldEngine).toBe(MODELS.introScene);
  });

  it('never appends a date suffix to any model ID', async () => {
    const { MODELS } = await import('../config.js');
    for (const id of Object.values(MODELS)) {
      expect(id).not.toMatch(/-\d{8}$/);
    }
  });
});
