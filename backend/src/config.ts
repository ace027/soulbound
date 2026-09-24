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
 *
 * ── Two modes (Phase 6, R23) ────────────────────────────────────────────────
 * Load order is fixed: (1) take EVERY secret either mode could use out of
 * `process.env` (`takeEnv`), (2) read and validate `SOULBOUND_MODE`, (3)
 * validate only what that mode needs. Step 1 comes first so an invalid mode —
 * or any other boot failure — never leaves a secret sitting in the
 * environment. `selfhost` (the default) runs exactly the Phase 5 validation
 * with byte-identical messages. `hosted` swaps the passphrase for accounts:
 * its secrets are reachable only through `getHostedSecrets()`, and `redact()`
 * covers all of them.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import { MIN_PASSPHRASE_LENGTH, type SoulboundMode } from '@soulbound/shared';

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
 * `toJSON`. Only `.reveal()` returns the real value, and only this module
 * calls it — from `getAnthropicApiKey()`, `checkPassphrase()`,
 * `getHostedSecrets()` and `redact()`.
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

/**
 * Reads and deletes an env var in one step, before anything validates it.
 *
 * `ANTHROPIC_API_KEY` and `SOULBOUND_PASSPHRASE` must BOTH be removed from
 * `process.env` before EITHER is validated — not "read-and-validate the
 * first, then read-and-validate the second". If the key is missing, the old
 * shape (`readApiKey()` deleting-then-throwing before `readPassphrase()` ever
 * ran) would leave the real passphrase sitting in `process.env` at the exact
 * moment `readApiKey()` throws — and that throw is precisely when a crash
 * (Node's diagnostic report, an uncaught exception) is most likely to dump
 * the whole environment to disk. Taking both values out of `process.env`
 * first, unconditionally, closes that window regardless of which one (if
 * either) turns out to be invalid.
 */
function takeEnv(name: string): string | undefined {
  const raw = process.env[name];
  delete process.env[name];
  return raw;
}

// Step 1: every secret either mode could use, taken before ANYTHING is
// validated — including the mode itself. In self-host mode the five hosted
// secrets are taken and then ignored: a deployer may share one `.env` between
// modes, so their presence is not an error, but they must still never linger
// in the environment.
const rawApiKey = takeEnv('ANTHROPIC_API_KEY');
const rawPassphrase = takeEnv('SOULBOUND_PASSPHRASE');
const rawDatabaseUrl = takeEnv('DATABASE_URL');
const rawBetterAuthSecret = takeEnv('BETTER_AUTH_SECRET');
const rawResendApiKey = takeEnv('RESEND_API_KEY');
const rawGoogleClientSecret = takeEnv('GOOGLE_CLIENT_SECRET');
const rawDiscordClientSecret = takeEnv('DISCORD_CLIENT_SECRET');

// Not secrets, but taken the same way: Better Auth would otherwise read
// BETTER_AUTH_URL from the environment on its own (R24a passes it explicitly),
// and one read-and-delete rule for every hosted variable is easier to audit
// than two.
const rawBetterAuthUrl = takeEnv('BETTER_AUTH_URL');
const rawEmailFrom = takeEnv('EMAIL_FROM');
const rawGoogleClientId = takeEnv('GOOGLE_CLIENT_ID');
const rawDiscordClientId = takeEnv('DISCORD_CLIENT_ID');
const rawSentryDsn = takeEnv('SENTRY_DSN');

// Step 2: the mode.
function readMode(): SoulboundMode {
  const raw = process.env.SOULBOUND_MODE;
  if (raw === undefined || raw.trim().length === 0) {
    return 'selfhost';
  }
  const trimmed = raw.trim();
  if (trimmed === 'selfhost' || trimmed === 'hosted') {
    return trimmed;
  }
  throw new Error(
    `Invalid SOULBOUND_MODE: ${JSON.stringify(raw)}.\n\n` +
      "Expected 'selfhost' (the default: one deployer, a shared passphrase) or\n" +
      "'hosted' (player accounts), e.g.\n" +
      '  SOULBOUND_MODE=selfhost',
  );
}

export const MODE: SoulboundMode = readMode();

function validateApiKey(raw: string | undefined): Secret {
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

const anthropicApiKey = validateApiKey(rawApiKey);

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

function validatePassphrase(raw: string | undefined): Secret {
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

const PASSPHRASE_IN_HOSTED_MESSAGE = `
Invalid SOULBOUND_PASSPHRASE: it is set, but it is not used in hosted mode.

Hosted mode (SOULBOUND_MODE=hosted) signs players in with accounts instead of
a shared passphrase, so a passphrase left in the environment would be a live
secret guarding nothing. Remove SOULBOUND_PASSPHRASE from the hosted
environment, or set SOULBOUND_MODE=selfhost to keep the passphrase gate.
`.trim();

/**
 * Self-host validates the passphrase exactly as Phase 5 did. Hosted mode
 * refuses to boot if one is set at all (R23) — it was already taken out of
 * `process.env` above, so the refusal itself leaves nothing behind.
 */
function readPassphraseForMode(raw: string | undefined): Secret | undefined {
  if (MODE === 'selfhost') {
    return validatePassphrase(raw);
  }
  if (raw !== undefined && raw.trim().length > 0) {
    throw new Error(PASSPHRASE_IN_HOSTED_MESSAGE);
  }
  return undefined;
}

const soulboundPassphrase: Secret | undefined = readPassphraseForMode(rawPassphrase);

// ─── Hosted-mode configuration (Phase 6, R23 / R25d) ─────────────────────────

/** Minimum length for BETTER_AUTH_SECRET: it keys session signing and the invite-cookie HMAC. */
const MIN_AUTH_SECRET_LENGTH = 32;

/**
 * Minimum length for every other hosted secret (the Resend key, the OAuth
 * client secrets, a DATABASE_URL password). Not a strength rule — these are
 * issued by their providers — but a `redact()` guard: every configured secret
 * is stripped from every log line and error body, so a tiny one (a DB password
 * of `postgres`) would rewrite ordinary text wherever it happened to occur.
 */
const MIN_HOSTED_SECRET_LENGTH = 16;

function missingHostedVariableMessage(name: string, purpose: string, example: string): string {
  return (
    `Missing required environment variable: ${name}\n\n` +
    `Hosted mode (SOULBOUND_MODE=hosted) cannot start without ${purpose}.\n` +
    'Set it in the hosted environment, e.g.\n' +
    `  ${name}=${example}`
  );
}

function shortHostedSecretMessage(name: string, length: number, minimum: number): string {
  return (
    `Invalid ${name}: ${length} character(s) long.\n\n` +
    `Hosted secrets must be at least ${minimum} characters. Every configured secret\n` +
    'is stripped from every log line and error response, so a short one would also\n' +
    'rewrite ordinary text that happens to contain it. Use the full value your\n' +
    'provider issued, or generate one, e.g.\n' +
    '  openssl rand -base64 32'
  );
}

/** A required hosted secret: present, trimmed, and at least `minimum` characters. */
function readRequiredHostedSecret(
  name: string,
  raw: string | undefined,
  minimum: number,
  purpose: string,
  example: string,
): Secret {
  if (!raw || raw.trim().length === 0) {
    throw new Error(missingHostedVariableMessage(name, purpose, example));
  }
  const trimmed = raw.trim();
  if (trimmed.length < minimum) {
    throw new Error(shortHostedSecretMessage(name, trimmed.length, minimum));
  }
  return new Secret(trimmed);
}

/**
 * An optional OAuth provider: both its client ID and secret, or neither. One
 * without the other is a half-configured provider that would fail only when a
 * player first clicks its button.
 */
function readOptionalOAuthProvider(
  provider: string,
  idName: string,
  rawId: string | undefined,
  secretName: string,
  rawSecret: string | undefined,
): { clientId: string; clientSecret: Secret } | undefined {
  const id = rawId?.trim() ?? '';
  const secret = rawSecret?.trim() ?? '';
  if (id.length === 0 && secret.length === 0) {
    return undefined;
  }
  if (id.length === 0 || secret.length === 0) {
    const missing = id.length === 0 ? idName : secretName;
    throw new Error(
      `Missing environment variable: ${missing}\n\n` +
        `${provider} sign-in needs both ${idName} and ${secretName}. Set both to\n` +
        `enable ${provider}, or unset both to leave it off.`,
    );
  }
  if (secret.length < MIN_HOSTED_SECRET_LENGTH) {
    throw new Error(shortHostedSecretMessage(secretName, secret.length, MIN_HOSTED_SECRET_LENGTH));
  }
  return { clientId: id, clientSecret: new Secret(secret) };
}

/**
 * DATABASE_URL, plus the password forms `redact()` has to strip. A driver
 * error can quote the URL whole, or just the password — raw (still
 * percent-encoded, as written in the URL) or decoded — so all three are kept.
 * Error messages here never echo the value: it carries the password.
 */
function readDatabaseUrl(raw: string | undefined): {
  url: Secret;
  password: Secret | undefined;
  decodedPassword: Secret | undefined;
} {
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      missingHostedVariableMessage(
        'DATABASE_URL',
        'a Postgres connection string',
        'postgres://soulbound:<password>@db.example.internal:5432/soulbound',
      ),
    );
  }
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    parsed = new URL('invalid:');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(
      'Invalid DATABASE_URL: not a postgres:// or postgresql:// connection string.\n\n' +
        '(The value is not shown here because it may contain a password.) Expected, e.g.\n' +
        '  DATABASE_URL=postgres://soulbound:<password>@db.example.internal:5432/soulbound',
    );
  }
  if (parsed.password.length === 0) {
    // A password-less URL (a local test cluster using trust auth) has
    // nothing in it to redact beyond the URL itself.
    return { url: new Secret(trimmed), password: undefined, decodedPassword: undefined };
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(parsed.password);
  } catch {
    throw new Error(
      'Invalid DATABASE_URL: its password is not valid percent-encoding.\n\n' +
        'Percent-encode reserved characters in the password (for example "@" as %40\n' +
        'and "/" as %2F), or use the connection string exactly as your provider shows it.',
    );
  }
  if (decoded.length < MIN_HOSTED_SECRET_LENGTH) {
    throw new Error(
      shortHostedSecretMessage('DATABASE_URL password', decoded.length, MIN_HOSTED_SECRET_LENGTH),
    );
  }
  return {
    url: new Secret(trimmed),
    password: new Secret(parsed.password),
    decodedPassword: new Secret(decoded),
  };
}

/**
 * BETTER_AUTH_URL: the public origin every magic link and OAuth callback is
 * built from (R24a) — passed to Better Auth explicitly, so a spoofed
 * `X-Forwarded-Host` can never redirect a link. Must be a bare `https:`
 * origin; `http://localhost` is allowed only outside production, for local
 * development.
 */
function readBetterAuthUrl(raw: string | undefined): string {
  const example = 'https://soulbound.example.com';
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      missingHostedVariableMessage(
        'BETTER_AUTH_URL',
        'the public origin players reach it at (magic links and OAuth callbacks are built from it)',
        example,
      ),
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error(
      'Invalid BETTER_AUTH_URL: not a parseable URL.\n\n' +
        'Expected the full public origin including the scheme, e.g.\n' +
        `  BETTER_AUTH_URL=${example}`,
    );
  }
  if (
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error(
      'Invalid BETTER_AUTH_URL: must be a bare origin (scheme, host and optional port),\n' +
        'with no credentials, path, query or fragment, e.g.\n' +
        `  BETTER_AUTH_URL=${example}`,
    );
  }
  const isLocalhost = parsed.hostname === 'localhost';
  const isProduction = process.env.NODE_ENV === 'production';
  if (parsed.protocol === 'https:') {
    return parsed.origin;
  }
  if (parsed.protocol === 'http:' && isLocalhost && !isProduction) {
    return parsed.origin;
  }
  throw new Error(
    `Invalid BETTER_AUTH_URL: ${JSON.stringify(parsed.origin)} is not an https origin.\n\n` +
      'Session cookies are Secure, so hosted mode must be served over https.\n' +
      'http://localhost is accepted only when NODE_ENV is not "production". e.g.\n' +
      `  BETTER_AUTH_URL=${example}`,
  );
}

/** EMAIL_FROM: the sender Resend puts on magic-link emails. */
function readEmailFrom(raw: string | undefined): string {
  const example = 'Soulbound <noreply@soulbound.example.com>';
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      missingHostedVariableMessage('EMAIL_FROM', 'a sender address for magic-link emails', example),
    );
  }
  const trimmed = raw.trim();
  // A CR or LF here would let the value inject extra mail headers.
  if (!trimmed.includes('@') || /[\r\n]/.test(trimmed)) {
    throw new Error(
      'Invalid EMAIL_FROM: expected one email address, optionally with a display name,\n' +
        'on a single line, e.g.\n' +
        `  EMAIL_FROM=${example}`,
    );
  }
  return trimmed;
}

/**
 * USER_RATE_LIMIT_PER_MINUTE: hosted mode's per-user limiter, keyed on the
 * signed-in user after the session gate (R24f). Same bounds and voice as
 * RATE_LIMIT_PER_MINUTE below; read only in hosted mode.
 */
function readUserRateLimitPerMinute(): number {
  const raw = process.env.USER_RATE_LIMIT_PER_MINUTE;
  if (raw === undefined || raw.trim().length === 0) {
    return 60;
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 600) {
    throw new Error(
      `Invalid USER_RATE_LIMIT_PER_MINUTE: ${JSON.stringify(raw)}.\n\n` +
        'Expected an integer from 1 to 600 (requests per minute, per signed-in player), e.g.\n' +
        '  USER_RATE_LIMIT_PER_MINUTE=60',
    );
  }
  return parsed;
}

interface HostedConfig {
  databaseUrl: Secret;
  databasePassword: Secret | undefined;
  databaseDecodedPassword: Secret | undefined;
  betterAuthSecret: Secret;
  resendApiKey: Secret;
  publicOrigin: string;
  emailFrom: string;
  google: { clientId: string; clientSecret: Secret } | undefined;
  discord: { clientId: string; clientSecret: Secret } | undefined;
  sentryDsn: string | undefined;
  userRateLimitPerMinute: number;
}

function readHostedConfig(): HostedConfig {
  const database = readDatabaseUrl(rawDatabaseUrl);
  const betterAuthSecret = readRequiredHostedSecret(
    'BETTER_AUTH_SECRET',
    rawBetterAuthSecret,
    MIN_AUTH_SECRET_LENGTH,
    'a session-signing secret',
    '<output of: openssl rand -base64 32>',
  );
  const publicOrigin = readBetterAuthUrl(rawBetterAuthUrl);
  const resendApiKey = readRequiredHostedSecret(
    'RESEND_API_KEY',
    rawResendApiKey,
    MIN_HOSTED_SECRET_LENGTH,
    'a Resend API key (magic-link emails are sent through Resend)',
    're_<your Resend API key>',
  );
  const emailFrom = readEmailFrom(rawEmailFrom);
  const google = readOptionalOAuthProvider(
    'Google',
    'GOOGLE_CLIENT_ID',
    rawGoogleClientId,
    'GOOGLE_CLIENT_SECRET',
    rawGoogleClientSecret,
  );
  const discord = readOptionalOAuthProvider(
    'Discord',
    'DISCORD_CLIENT_ID',
    rawDiscordClientId,
    'DISCORD_CLIENT_SECRET',
    rawDiscordClientSecret,
  );
  const sentryDsn = rawSentryDsn?.trim() || undefined;
  return {
    databaseUrl: database.url,
    databasePassword: database.password,
    databaseDecodedPassword: database.decodedPassword,
    betterAuthSecret,
    resendApiKey,
    publicOrigin,
    emailFrom,
    google,
    discord,
    sentryDsn,
    userRateLimitPerMinute: readUserRateLimitPerMinute(),
  };
}

// Step 3 (hosted): validated here, after the API key and the passphrase
// rejection, and before FRONTEND_ORIGIN below, which defaults to this origin.
// Self-host never runs it: the hosted variables it would read were taken
// above and are simply dropped.
const hosted: HostedConfig | undefined = MODE === 'hosted' ? readHostedConfig() : undefined;

/** Hosted mode's public origin (from BETTER_AUTH_URL); undefined in self-host. */
export const HOSTED_PUBLIC_URL: string | undefined = hosted?.publicOrigin;
/** Sender for magic-link emails; undefined in self-host. */
export const EMAIL_FROM: string | undefined = hosted?.emailFrom;
/** Google OAuth client ID when Google sign-in is configured; hosted only. */
export const GOOGLE_CLIENT_ID: string | undefined = hosted?.google?.clientId;
/** Discord OAuth client ID when Discord sign-in is configured; hosted only. */
export const DISCORD_CLIENT_ID: string | undefined = hosted?.discord?.clientId;
/**
 * The error tracker's DSN. Not a secret (it only permits sending events), but
 * taken from the environment like one. Undefined in self-host, which never
 * loads the tracker even when SENTRY_DSN is set (R25b).
 */
export const SENTRY_DSN: string | undefined = hosted?.sentryDsn;
/** Per-signed-in-player requests per minute (R24f); undefined in self-host. */
export const USER_RATE_LIMIT_PER_MINUTE: number | undefined = hosted?.userRateLimitPerMinute;

/**
 * The hosted secrets, for the modules that must hand them to a library (the
 * `pg` pool, Better Auth, Resend, the OAuth providers). A function rather than
 * an exported value for the same reason as `getAnthropicApiKey()`: it can't be
 * swept up by `console.log(config)` or `JSON.stringify(config)`. Throws in
 * self-host, where none of them is configured.
 */
export function getHostedSecrets(): {
  databaseUrl: string;
  betterAuthSecret: string;
  resendApiKey: string;
  googleClientSecret?: string;
  discordClientSecret?: string;
} {
  if (hosted === undefined) {
    throw new Error('getHostedSecrets is not available in self-host mode');
  }
  return {
    databaseUrl: hosted.databaseUrl.reveal(),
    betterAuthSecret: hosted.betterAuthSecret.reveal(),
    resendApiKey: hosted.resendApiKey.reveal(),
    ...(hosted.google ? { googleClientSecret: hosted.google.clientSecret.reveal() } : {}),
    ...(hosted.discord ? { discordClientSecret: hosted.discord.clientSecret.reveal() } : {}),
  };
}

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
  // Hosted mode has no passphrase; a caller reaching this there is wired to
  // the wrong gate, and failing loudly beats comparing against nothing.
  if (MODE === 'hosted' || soulboundPassphrase === undefined) {
    throw new Error('checkPassphrase is not available in hosted mode');
  }
  const candidateDigest = sha256(candidate);
  const realDigest = sha256(soulboundPassphrase.reveal());
  return timingSafeEqual(candidateDigest, realDigest);
}

/**
 * Every configured secret `redact()` strips, sorted once, at load, LONGEST
 * FIRST. If one secret is a substring of another, redacting the shorter one
 * first would consume only part of an occurrence of the longer one, leaving a
 * fragment of it in the output instead of a clean `[REDACTED]`. Doing the
 * longer one first can never have that problem: once every occurrence of the
 * longer string is gone, nothing a shorter pass finds can be a leftover piece
 * of it. Empty strings are dropped (splitting on `''` would redact between
 * every character), and so are duplicates.
 *
 * Self-host: the API key and the passphrase, exactly as in Phase 5. Hosted:
 * the API key, DATABASE_URL (whole, its password as written, and that
 * password URL-decoded), BETTER_AUTH_SECRET, RESEND_API_KEY and any
 * configured OAuth client secret.
 */
const redactionTargets: readonly string[] = (() => {
  const secrets: (Secret | undefined)[] = [anthropicApiKey, soulboundPassphrase];
  if (hosted !== undefined) {
    secrets.push(
      hosted.databaseUrl,
      hosted.databasePassword,
      hosted.databaseDecodedPassword,
      hosted.betterAuthSecret,
      hosted.resendApiKey,
      hosted.google?.clientSecret,
      hosted.discord?.clientSecret,
    );
  }
  const values = secrets
    .map((secret) => secret?.reveal() ?? '')
    .filter((value) => value.length > 0);
  // Stable sort: equal lengths keep the order above (the key first), as
  // Phase 5's two-secret version did.
  return Object.freeze([...new Set(values)].sort((a, b) => b.length - a.length));
})();

/**
 * Strips every occurrence of every configured secret (see
 * `redactionTargets`) out of a string. Use this on anything derived from a
 * caught error (message, stack, a provider error body) before it is logged
 * server-side or sent to a client — a misbehaving provider response can
 * otherwise echo the key back inside its own message, a route that echoes
 * request context back in an error could do the same for the passphrase, and
 * a database driver error can quote its connection string.
 */
export function redact(input: string): string {
  if (!input) return input;
  let result = input;
  for (const secret of redactionTargets) {
    result = result.split(secret).join('[REDACTED]');
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
function readFrontendOrigin(defaultOrigin = 'http://localhost:5173'): string {
  const raw = (process.env.FRONTEND_ORIGIN ?? defaultOrigin).trim();

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

/**
 * Hosted mode is same-origin: the backend serves the frontend at the public
 * origin, so FRONTEND_ORIGIN defaults to BETTER_AUTH_URL's origin and must
 * equal it. A different value would advertise a CORS origin that no hosted
 * page is ever served from.
 */
function readHostedFrontendOrigin(publicOrigin: string): string {
  const origin = readFrontendOrigin(publicOrigin);
  if (origin !== publicOrigin) {
    throw new Error(
      `Invalid FRONTEND_ORIGIN: ${JSON.stringify(origin)} does not match BETTER_AUTH_URL's origin ${JSON.stringify(publicOrigin)}.\n\n` +
        'In hosted mode the frontend is served from the public origin itself. Unset\n' +
        'FRONTEND_ORIGIN (it defaults to BETTER_AUTH_URL), or set it to the same origin, e.g.\n' +
        `  FRONTEND_ORIGIN=${publicOrigin}`,
    );
  }
  return origin;
}

export const FRONTEND_ORIGIN: string =
  hosted === undefined ? readFrontendOrigin() : readHostedFrontendOrigin(hosted.publicOrigin);

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
 *
 * **`'uniquelocal'` and a hop count are not automatically safe just because
 * they are bounded — they are only safe when something in front of this
 * server actually OVERWRITES `X-Forwarded-For` on every request**, rather
 * than merely appending to whatever the client sent. Docker's published-port
 * networking is the case that bites here: a container reached via
 * `-p 3001:3001` sees the connection arrive from the Docker bridge gateway
 * (a private `172.x` address), which `'uniquelocal'` (and hop-count 1) both
 * classify as "trusted". But nothing in that path strips or overwrites a
 * `X-Forwarded-For` header the ORIGINAL CLIENT sent — Docker's userland/NAT
 * port publishing is not a reverse proxy and does not touch application-layer
 * headers at all. A caller can set `X-Forwarded-For: <anything>` directly and
 * Express will trust it, treating every request as a fresh IP and therefore
 * a fresh rate-limit bucket — silently defeating the limiter while `req.ip`
 * still looks plausible in a log line. `TRUST_PROXY` is safe to set ONLY
 * when a real reverse proxy (nginx, Caddy, a cloud load balancer, ...) sits
 * in front of this backend and is KNOWN to overwrite (not append to)
 * `X-Forwarded-For` with the real client address on every request — and even
 * then, prefer the smallest hop count that matches the actual proxy chain
 * over `'uniquelocal'`, which trusts any number of private-range hops. Plain
 * Docker port publishing, with no such proxy, should leave `TRUST_PROXY`
 * unset (`false`): every request behind the bridge shares one rate-limit
 * bucket, which is a documented, accepted degradation (see
 * `.env.example` and the README's self-hosting section) — not a security
 * hole, unlike a `TRUST_PROXY` value that turns out to be spoofable.
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
