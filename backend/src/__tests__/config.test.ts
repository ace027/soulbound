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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FAKE_KEY = 'sk-ant-test-fake-key-never-sent-mocked-only';

function resetEnv(): void {
  process.env.ANTHROPIC_API_KEY = FAKE_KEY;
  delete process.env.FRONTEND_ORIGIN;
  delete process.env.ALLOWED_HOSTS;
  delete process.env.PORT;
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
