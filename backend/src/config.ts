/**
 * The single place backend environment configuration is read.
 *
 * `ANTHROPIC_API_KEY` is read exactly once, here, at module load. It is never
 * exported as a plain string property on a shared object — only through
 * `getAnthropicApiKey()` — and `redact()` is the one function anything else in
 * the backend should use to make sure the key can never leak into a log line,
 * an error response body, or a stack trace (CLAUDE.md's auth section / Plan
 * 01-03's R2: the key must not appear in the frontend bundle, in any log
 * line, in an error response, or in a stack trace).
 *
 * Phase 2 wires the Anthropic SDK client using `getAnthropicApiKey()` and the
 * model IDs below. This module does not call the Anthropic API itself.
 */

import { inspect } from 'node:util';

const MISSING_KEY_MESSAGE = `
Missing required environment variable: ANTHROPIC_API_KEY

The Soulbound Chronicles backend cannot start without an Anthropic API key.

To fix this:
  1. cp .env.example .env
  2. Add your key to the new .env file (get one at https://console.anthropic.com/account/keys)
  3. Restart the server

See .env.example for the expected format.
`.trim();

/**
 * Wraps a secret string so accidental logging can't leak it. `console.log`
 * and `util.inspect` both honor `[inspect.custom]`; `JSON.stringify` honors
 * `toJSON`. Only `.reveal()` returns the real value, and nothing outside this
 * module calls it except `getAnthropicApiKey()` and `redact()`.
 */
class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toJSON(): string {
    return '[REDACTED]';
  }

  toString(): string {
    return '[REDACTED]';
  }

  [inspect.custom](): string {
    return '[REDACTED]';
  }
}

function readApiKey(): Secret {
  const raw = process.env.ANTHROPIC_API_KEY;
  // Remove the plaintext copy from process.env immediately. Without this the
  // key lives in two places: inside `Secret` (guarded) and in process.env
  // (completely unguarded). That second copy is reachable by anything in the
  // process — and Node's own diagnostic report writes the whole environment
  // to disk in plaintext on a fatal error (`--report-on-fatalerror`,
  // `--report-uncaught-exception`, `process.report.writeReport()`), which is
  // exactly the "key must never appear in a stack trace" case R2 forbids.
  // Verified by probe: process.report.getReport().environmentVariables leaked
  // a canary key before this line existed. Nothing else reads this variable
  // after config.ts's one-time read, so deleting it is safe.
  delete process.env.ANTHROPIC_API_KEY;
  if (!raw || raw.trim().length === 0) {
    // Fail fast, at startup, before the app is built or the port is bound —
    // not three calls deep into gameplay.
    throw new Error(MISSING_KEY_MESSAGE);
  }
  return new Secret(raw);
}

const anthropicApiKey = readApiKey();

/**
 * The Anthropic API key, for the Anthropic client to consume (Phase 2).
 * Deliberately a function rather than a property on an exported config
 * object, so it can't be accidentally swept up by `console.log(config)` or
 * `JSON.stringify(config)` elsewhere in the codebase.
 */
export function getAnthropicApiKey(): string {
  return anthropicApiKey.reveal();
}

/**
 * Strips every occurrence of the live API key out of a string. Use this on
 * anything derived from a caught error (message, stack, a provider error
 * body) before it is logged server-side or sent to a client — a misbehaving
 * provider response can otherwise echo the key back inside its own message.
 */
export function redact(input: string): string {
  if (!input) return input;
  return input.split(anthropicApiKey.reveal()).join('[REDACTED]');
}

export const PORT: number = Number.parseInt(process.env.PORT ?? '3001', 10);

export const FRONTEND_ORIGIN: string =
  process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';

/**
 * Model IDs, centralized here so Phase 2's three World Voice routes don't
 * scatter literals across files. Exactly these strings per CLAUDE.md and the
 * Plan 01-03 contract — never append a date suffix.
 */
export const MODELS = {
  uniqueSkill: 'claude-sonnet-5',
  worldEngine: 'claude-opus-5',
  introScene: 'claude-opus-5',
} as const;
