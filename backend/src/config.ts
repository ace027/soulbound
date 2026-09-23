/**
 * The single place backend environment configuration is read.
 *
 * `ANTHROPIC_API_KEY` and `SOULBOUND_PASSPHRASE` are each read exactly once,
 * here, at module load. Neither is ever exported as a plain string property
 * on a shared object — the key only through `getAnthropicApiKey()`, the
 * passphrase only through `checkPassphrase()` — and `redact()` is the one
 * function anything else in the backend should use to make sure either secret
 * can never leak into a log line, an error response body, or a stack trace
 * (CLAUDE.md's auth section / Plan 01-03's R2: the key must not appear in the
 * frontend bundle, in any log line, in an error response, or in a stack
 * trace; Phase 5's access gate holds the passphrase to the same standard).
 *
 * Phase 2 wires the Anthropic SDK client using `getAnthropicApiKey()` and the
 * model IDs below. This module does not call the Anthropic API itself.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import { MIN_PASSPHRASE_LENGTH } from '@soulbound/shared';

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

const MISSING_PASSPHRASE_MESSAGE = `
Missing required environment variable: SOULBOUND_PASSPHRASE

The Soulbound Chronicles backend cannot start without a deployer-set access
passphrase. This is NOT your Anthropic API key — it's a phrase you make up
yourself and hand to the players you invite, so a stranger who finds the port
can't spend your Anthropic credits.

To fix this:
  1. cp .env.example .env
  2. Add a passphrase of your own choosing to the new .env file (12+ characters)
  3. Restart the server

See .env.example for the expected format.
`.trim();

function shortPassphraseMessage(length: number): string {
  return (
    `Invalid SOULBOUND_PASSPHRASE: ${length} character(s) long.\n\n` +
    `The access passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters —\n` +
    'short passphrases are easy to guess or brute-force against an internet-facing\n' +
    'port. Choose a longer phrase, e.g. a few random words.'
  );
}

const NON_ASCII_PASSPHRASE_MESSAGE = `
Invalid SOULBOUND_PASSPHRASE: contains a character outside printable ASCII (0x20-0x7E).

Browsers cannot send non-Latin-1 bytes in an HTTP header value, so a
passphrase containing one (an accent, an emoji, a curly quote pasted from a
word processor, ...) would silently lock every player out — the request would
never even reach this server with the header intact. Use only plain ASCII
letters, digits, punctuation and spaces.
`.trim();

function readPassphrase(): Secret {
  const raw = process.env.SOULBOUND_PASSPHRASE;
  // Same reasoning as readApiKey(): a plaintext copy left in process.env is
  // reachable by anything in the process, including Node's own diagnostic
  // report on a fatal error. Nothing else reads this variable after this
  // one-time read, so deleting it is safe.
  delete process.env.SOULBOUND_PASSPHRASE;
  if (!raw || raw.trim().length === 0) {
    throw new Error(MISSING_PASSPHRASE_MESSAGE);
  }
  const trimmed = raw.trim();
  if (trimmed.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(shortPassphraseMessage(trimmed.length));
  }
  if (!/^[\x20-\x7E]+$/.test(trimmed)) {
    throw new Error(NON_ASCII_PASSPHRASE_MESSAGE);
  }
  return new Secret(trimmed);
}

const soulboundPassphrase = readPassphrase();

/** SHA-256 digest of a string, as a Buffer, for constant-time comparison. */
function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Compares a candidate passphrase (e.g. from an `Authorization: Bearer`
 * header) against the configured one without leaking timing information: both
 * sides are hashed to a fixed-length SHA-256 digest first — `timingSafeEqual`
 * requires equal-length buffers and would otherwise throw (or, worse, invite
 * a naive `===` fallback) on a candidate of a different length than the real
 * passphrase, which is itself a timing signal about the real length.
 */
export function checkPassphrase(candidate: string): boolean {
  const candidateDigest = sha256(candidate);
  const realDigest = sha256(soulboundPassphrase.reveal());
  return timingSafeEqual(candidateDigest, realDigest);
}

/**
 * Strips every occurrence of the live API key and the live passphrase out of
 * a string. Use this on anything derived from a caught error (message,
 * stack, a provider error body) before it is logged server-side or sent to a
 * client — a misbehaving provider response can otherwise echo the key back
 * inside its own message, and a route that echoes request context back in an
 * error could do the same for the passphrase.
 */
export function redact(input: string): string {
  if (!input) return input;
  let result = input.split(anthropicApiKey.reveal()).join('[REDACTED]');
  const passphrase = soulboundPassphrase.reveal();
  if (passphrase.length > 0) {
    result = result.split(passphrase).join('[REDACTED]');
  }
  return result;
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
 * Model IDs, centralized here so the three World Voice routes don't scatter
 * literals across files. Exactly these strings — never append a date suffix.
 *
 * ── The split, and why it is shaped this way (revised 2026-09-18) ──────────
 * `worldEngine` and `introScene` MUST stay on the SAME model as each other.
 * Prompt caches are model-scoped, and those two are the only routes that send
 * system blocks — they share one cache namespace, so whichever runs first pays
 * the ~15.5k-token cache write and the rest read it ~12x cheaper. Moving only
 * one of them strands the other's cache warmth, with a bill as the only
 * symptom. Pinned by a test in config.test.ts. WHICH model they share is a
 * cost/quality choice; THAT they share one is the invariant.
 *
 * `uniqueSkill` is independent. It sends no `system` parameter at all
 * (CLAUDE.md #8), so it has no cached prefix and nothing to share with
 * anything. Its model and effort move freely without touching the pair.
 *
 * History: all-Sonnet, then Opus on the two system-block routes, now Sonnet on
 * the pair with Opus on uniqueSkill — the developer's deliberate call each
 * time, made with the prior reversal in view. Do not "correct" it back to an
 * earlier arrangement; see docs/design-decisions-log.md.
 */
export const MODELS = {
  uniqueSkill: 'claude-opus-5',
  worldEngine: 'claude-sonnet-5',
  introScene: 'claude-sonnet-5',
} as const;

/**
 * How many requests per minute a single rate-limit bucket (see `TRUST_PROXY`
 * and the `req.ip` key it feeds) may make against `/api/*` before the access
 * gate's limiter answers 429. Default 30 is generous for one household of
 * players sharing a passphrase, and cheap insurance against a leaked
 * passphrase being hammered.
 *
 * Bounded to a sane integer range so a typo (`RATE_LIMIT_PER_MINUTE=0`, which
 * would lock everyone out including the deployer, or a stray non-numeric
 * value) fails at boot rather than silently degrading into either "nothing
 * gets through" or "the limiter is effectively off".
 */
function readRateLimitPerMinute(): number {
  const raw = process.env.RATE_LIMIT_PER_MINUTE;
  if (raw === undefined || raw.trim().length === 0) {
    return 30;
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 600) {
    throw new Error(
      `Invalid RATE_LIMIT_PER_MINUTE: ${JSON.stringify(raw)}.\n\n` +
        'Expected an integer from 1 to 600 (requests per minute, per client), e.g.\n' +
        '  RATE_LIMIT_PER_MINUTE=30',
    );
  }
  return parsed;
}

export const RATE_LIMIT_PER_MINUTE: number = readRateLimitPerMinute();

/**
 * Express's `trust proxy` setting, forwarded verbatim to `app.set('trust
 * proxy', ...)` so `req.ip` reads the real client address from
 * `X-Forwarded-For` instead of the immediate socket peer (the reverse proxy
 * or container gateway) when this backend sits behind one.
 *
 * `true` is rejected outright: it trusts every hop in `X-Forwarded-For`,
 * including one an attacker supplies directly when there is no proxy in
 * front of this server at all — trivially spoofable, and it would let a
 * single caller claim a fresh IP (and a fresh rate-limit bucket) on every
 * request. `'loopback'` and `'uniquelocal'` are Express's named presets for
 * "trust only private/loopback hops"; a small integer is "trust exactly this
 * many hops", both of which name a specific, bounded amount of trust rather
 * than an unbounded one.
 */
function readTrustProxy(): false | 'loopback' | 'uniquelocal' | number {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw.trim().length === 0) {
    return false;
  }
  const trimmed = raw.trim();
  if (trimmed === 'false') {
    return false;
  }
  if (trimmed === 'true') {
    throw new Error(
      'Invalid TRUST_PROXY: "true".\n\n' +
        'Trusting every hop in X-Forwarded-For is spoofable by any caller when no\n' +
        'reverse proxy actually sits in front of this server, letting one client claim\n' +
        'a fresh rate-limit bucket on every request. Use a specific, bounded amount of\n' +
        "trust instead: 'loopback', 'uniquelocal', or a small integer hop count, e.g.\n" +
        '  TRUST_PROXY=loopback',
    );
  }
  if (trimmed === 'loopback' || trimmed === 'uniquelocal') {
    return trimmed;
  }
  const asInt = Number(trimmed);
  if (Number.isInteger(asInt) && asInt >= 1 && asInt <= 5) {
    return asInt;
  }
  throw new Error(
    `Invalid TRUST_PROXY: ${JSON.stringify(raw)}.\n\n` +
      "Expected 'loopback', 'uniquelocal', or an integer from 1 to 5 (the number of\n" +
      'trusted reverse-proxy hops in front of this server), e.g.\n' +
      '  TRUST_PROXY=loopback',
  );
}

export const TRUST_PROXY: false | 'loopback' | 'uniquelocal' | number = readTrustProxy();

/**
 * Absolute path to a directory of pre-built frontend static files, served by
 * the backend so a self-hosted deployment ships as one image (Phase 5, R20).
 * `undefined` when unset — the dev `docker-compose.yml` setup, where the Vite
 * dev server serves the frontend separately, is unaffected.
 *
 * Validated at boot rather than left to fail per-request: a `STATIC_DIR`
 * without an `index.html` would otherwise serve 404s for the SPA shell
 * indefinitely, discovered only when a player reports a blank page.
 */
function readStaticDir(): string | undefined {
  const raw = process.env.STATIC_DIR;
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!path.isAbsolute(trimmed)) {
    throw new Error(
      `Invalid STATIC_DIR: ${JSON.stringify(raw)} is not an absolute path.\n\n` +
        'Expected an absolute path to a directory containing a built index.html, e.g.\n' +
        '  STATIC_DIR=/app/frontend/dist',
    );
  }
  if (!existsSync(path.join(trimmed, 'index.html'))) {
    throw new Error(
      `Invalid STATIC_DIR: ${JSON.stringify(raw)} has no index.html.\n\n` +
        'Expected a built frontend directory, e.g. the output of `npm run build`\n' +
        'in frontend/, containing index.html at its root.',
    );
  }
  return trimmed;
}

export const STATIC_DIR: string | undefined = readStaticDir();
