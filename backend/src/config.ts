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
  // Trimmed, not raw. A key pasted into .env with a trailing newline or a
  // stray space produces an `x-api-key` header the API rejects, surfacing as
  // a confusing UPSTREAM_ERROR three calls deep instead of anything that
  // names the real cause. Trimming here also keeps `redact()` matching the
  // exact bytes actually sent in the header.
  return new Secret(raw.trim());
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

/**
 * The single origin the CORS policy echoes back in
 * `Access-Control-Allow-Origin`.
 *
 * Validated at module load, and fatal on a bad value, for the same reason the
 * missing-key check is: a malformed CORS policy is a security property that
 * silently degrades rather than erroring, and the only symptom is either every
 * browser request failing (typo) or every origin being trusted (`*`). Two
 * rejections:
 *
 *  - `*` — a wildcard ACAO turns this backend, which spends money per request,
 *    into an open proxy for any page on the internet. There is no legitimate
 *    configuration for this service where that is what was meant.
 *  - anything `new URL()` cannot parse, or that has no real origin (a
 *    non-special scheme yields the literal string "null") — a value that never
 *    matches any browser `Origin` header, so every preflight fails with a
 *    message that points at the browser rather than at this config line.
 *
 * Normalized to `URL.origin`, which strips a trailing slash and any path — an
 * `Origin` header never carries either, so an un-normalized value with one
 * would never match.
 */
function readFrontendOrigin(): string {
  const raw = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173').trim();

  if (raw === '*') {
    throw new Error(
      'Invalid FRONTEND_ORIGIN: "*".\n\n' +
        'A wildcard Access-Control-Allow-Origin would let any website on the internet\n' +
        'drive this backend and spend the configured Anthropic API key. Set\n' +
        'FRONTEND_ORIGIN to the exact origin the frontend is served from, e.g.\n' +
        '  FRONTEND_ORIGIN=http://localhost:5173',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `Invalid FRONTEND_ORIGIN: ${JSON.stringify(raw)} is not a parseable URL.\n\n` +
        'Expected a full origin including the scheme, e.g.\n' +
        '  FRONTEND_ORIGIN=http://localhost:5173',
    );
  }

  if (parsed.origin === 'null') {
    throw new Error(
      `Invalid FRONTEND_ORIGIN: ${JSON.stringify(raw)} has no origin a browser can send.\n\n` +
        'Use an http(s) origin, e.g.\n' +
        '  FRONTEND_ORIGIN=http://localhost:5173',
    );
  }

  return parsed.origin;
}

export const FRONTEND_ORIGIN: string = readFrontendOrigin();

/**
 * The `Host` header values this server will answer at all.
 *
 * Binding to 127.0.0.1 is not by itself a boundary: a page on the public
 * internet can point a hostname it controls at 127.0.0.1 (DNS rebinding) and
 * then reach this server from the victim's own browser, with the browser
 * sending `Host: evil.example`. CORS does not stop that — the request is still
 * issued and still spends money before any response header is read, and a
 * simple `POST` with a form content-type is not preflighted at all. Checking
 * `Host` against a fixed allow-list is what makes the loopback bind mean
 * something.
 *
 * Derived from PORT so the default needs no configuration, and overridable via
 * `ALLOWED_HOSTS` (comma-separated) for reverse-proxy or container setups. An
 * entry with no port matches that hostname on any port; `*` is rejected for
 * the same reason a wildcard CORS origin is.
 */
function readAllowedHosts(): readonly string[] {
  const raw = process.env.ALLOWED_HOSTS;

  if (raw !== undefined && raw.trim().length > 0) {
    const entries = raw
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0);

    if (entries.length === 0) {
      throw new Error('Invalid ALLOWED_HOSTS: no host entries after parsing. Use a comma-separated list, e.g. ALLOWED_HOSTS=localhost:3001,127.0.0.1:3001');
    }
    if (entries.includes('*')) {
      throw new Error(
        'Invalid ALLOWED_HOSTS: "*".\n\n' +
          'Accepting any Host header re-opens the DNS-rebinding path the allow-list\n' +
          'exists to close. List the exact hosts this server is reached at, e.g.\n' +
          '  ALLOWED_HOSTS=localhost:3001,127.0.0.1:3001',
      );
    }
    return Object.freeze(entries);
  }

  return Object.freeze([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
}

export const ALLOWED_HOSTS: readonly string[] = readAllowedHosts();

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
