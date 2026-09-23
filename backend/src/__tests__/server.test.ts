/**
 * Startup tests for `server.ts`'s `main()` — the half of that file the route
 * tests cannot execute, because it calls `process.exit` and binds the real
 * port.
 *
 * Why this file exists: before it, `server.ts` was executed by NO test. Three
 * separate mutations of it left the suite green — unregistering all three
 * routers, replacing the error handler's client message with the raw stack,
 * and deleting the `assertWorldVoiceContract` startup call. routes.test.ts now
 * covers the first two by driving `buildApp()` itself; this file covers the
 * third, plus the host-matching rule the CORS-bypass guard depends on.
 *
 * `main()` is called in-process rather than booted as a child process, because
 * the interesting input — a DRIFTED WORLD_SYSTEM_PROMPT — is a static import
 * inside the module graph, and `vi.doMock` can substitute it without needing a
 * compiled `dist/` to exist first (which would make this test silently depend
 * on build order). `process.exit` is mocked to throw, so the "guard fired"
 * path is observable and the "guard was deleted" path cannot leave a real
 * listening server behind on the configured port: PORT is pinned to 0 below,
 * and any server `main()` does return is closed in the test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { WORLD_SYSTEM_PROMPT } from '../data/worldSystemPrompt.js';
import { isHostAllowed } from '../server.js';

const FAKE_KEY = 'sk-ant-test-fake-key-never-sent-mocked-only';

/** A prompt whose RESPONSE FORMAT block renames one of the nine contract fields. */
const DRIFTED_PROMPT = WORLD_SYSTEM_PROMPT.replace('"gm_note":', '"gm_notes":');

const FAKE_PASSPHRASE = 'test-passphrase-not-real';

function setStartupEnv(): void {
  process.env.ANTHROPIC_API_KEY = FAKE_KEY; // config.ts deletes it on read
  process.env.SOULBOUND_PASSPHRASE = FAKE_PASSPHRASE; // config.ts deletes it on read
  process.env.PORT = '0'; // ephemeral, so a stray listen can never collide
  process.env.ALLOWED_HOSTS = '127.0.0.1';
}

describe('server.ts startup (main)', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    setStartupEnv();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      // Throwing (rather than returning) both makes the call observable and
      // stops execution exactly where the real process.exit would.
      throw new Error(`process.exit(${code})`);
    }) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
    vi.doUnmock('../data/worldSystemPrompt.js');
    vi.resetModules();
  });

  it('sanity: DRIFTED_PROMPT really differs from the real prompt', () => {
    expect(WORLD_SYSTEM_PROMPT).toContain('"gm_note":');
    expect(DRIFTED_PROMPT).not.toBe(WORLD_SYSTEM_PROMPT);
  });

  it('exits 1 when WORLD_SYSTEM_PROMPT has drifted from the response contract', async () => {
    vi.doMock('../data/worldSystemPrompt.js', () => ({ WORLD_SYSTEM_PROMPT: DRIFTED_PROMPT }));
    const { main } = await import('../server.js');

    let server: Server | undefined;
    let thrown: unknown;
    try {
      server = await main();
    } catch (err) {
      thrown = err;
    } finally {
      // Only reachable if the guard was removed — never leave a listener up.
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    }

    expect(server).toBeUndefined();
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);

    // And it said which field drifted, rather than exiting silently.
    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toContain('gm_note');
  });

  it('boots and returns a listening server on the real, undrifted prompt', async () => {
    const { main } = await import('../server.js');
    const server = await main();
    try {
      expect(server.listening).toBe(true);
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('exits 1 with a one-line message (no stack) when config fails to load', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { main } = await import('../server.js');

    let thrown: unknown;
    try {
      await main();
    } catch (err) {
      thrown = err;
    }

    expect((thrown as Error).message).toBe('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toContain('ANTHROPIC_API_KEY');
    expect(logged).not.toMatch(/\n\s+at /); // one clean message, not a stack dump
  });

  it('exits 1 naming SOULBOUND_PASSPHRASE when it is unset, and never echoes the fake key', async () => {
    delete process.env.SOULBOUND_PASSPHRASE;
    const { main } = await import('../server.js');

    let thrown: unknown;
    try {
      await main();
    } catch (err) {
      thrown = err;
    }

    expect((thrown as Error).message).toBe('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toContain('SOULBOUND_PASSPHRASE');
    expect(logged).not.toContain(FAKE_KEY);
    expect(logged).not.toMatch(/\n\s+at /);
  });
});

describe('isHostAllowed', () => {
  const withPort = ['localhost:3001', '127.0.0.1:3001', '[::1]:3001'];

  it('accepts exactly the allow-listed host:port pairs', () => {
    for (const host of withPort) expect(isHostAllowed(host, withPort)).toBe(true);
    expect(isHostAllowed('127.0.0.1:3002', withPort)).toBe(false);
    expect(isHostAllowed('localhost', withPort)).toBe(false);
  });

  it('rejects a rebound hostname regardless of port, and rejects a missing/empty Host', () => {
    expect(isHostAllowed('evil.example', withPort)).toBe(false);
    expect(isHostAllowed('evil.example:3001', withPort)).toBe(false);
    expect(isHostAllowed(undefined, withPort)).toBe(false);
    expect(isHostAllowed('   ', withPort)).toBe(false);
  });

  it('treats a hostname-only entry as "any port on that hostname"', () => {
    expect(isHostAllowed('127.0.0.1:49512', ['127.0.0.1'])).toBe(true);
    expect(isHostAllowed('127.0.0.1', ['127.0.0.1'])).toBe(true);
    expect(isHostAllowed('[::1]:49512', ['[::1]'])).toBe(true);
    expect(isHostAllowed('evil.example:49512', ['127.0.0.1'])).toBe(false);
  });

  it('is case-insensitive on the Host header', () => {
    expect(isHostAllowed('LOCALHOST:3001', withPort)).toBe(true);
  });
});
