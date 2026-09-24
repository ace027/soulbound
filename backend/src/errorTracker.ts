/**
 * The hosted-mode error tracker (Phase 6, R25b).
 *
 * Off unless BOTH `mode === 'hosted'` and a DSN are set. Self-host never loads
 * the Sentry SDK, even with SENTRY_DSN set: the import below is dynamic and
 * sits behind that check, so nothing in the self-host process ever resolves
 * the package (pinned by errorTracker.test.ts).
 *
 * When on, the design is "can't leak what it never keeps", not "scrub what it
 * finds": a value-matching redactor can't recognise per-request values (a
 * session cookie, an invite code, an email, a line of player text), so:
 *
 *  1. `report()` never hands the SDK the caller's error. It builds a fresh one
 *     carrying only the error's type and the frame lines of its stack, with
 *     the message cut off the front — multi-line error text could otherwise
 *     forge `at …` frames. If the stack doesn't start with the message the
 *     way V8 writes it, no frames are kept at all (fail closed).
 *  2. `beforeSend` returns a NEW event built from an allow-list: exception
 *     type; frames reduced to {function, filename, lineno}, kept only from the
 *     app's own directory, `node_modules/<pkg>/` or `node:` internals; and
 *     `tags: { code, route, mode }` with `code` mapped through the known set.
 *     Everything else — message, exception value, request, user, contexts,
 *     extra, breadcrumbs, server name, the envelope's trace header — is
 *     dropped by never being copied.
 *  3. `beforeBreadcrumb` returns null, default integrations are off, and the
 *     SDK's own data collection is switched off field by field as a second
 *     layer.
 *
 * Option names were checked against the installed SDK (11.0.0); see
 * .planning/phases/06-hosted-mode-accounts/06-01-SUMMARY.md for file:line.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INVITE_INVALID,
  INVITE_REQUIRED,
  ORIGIN_REJECTED,
  PASSPHRASE_REQUIRED,
  SIGN_IN_REQUIRED,
  TOO_MANY_REQUESTS,
  type SoulboundMode,
} from '@soulbound/shared';
import type { WorldVoiceErrorCode } from './anthropic.js';

// The only place the SDK is loaded (dynamically, one line). Everything else
// refers to its types through `Sentry`.
const loadSentry = (): Promise<typeof import('@sentry/node')> => import('@sentry/node');
type Sentry = Awaited<ReturnType<typeof loadSentry>>;
type SentryOptions = NonNullable<Parameters<Sentry['init']>[0]>;
type SentryEvent = Parameters<NonNullable<SentryOptions['beforeSend']>>[0];

/** A transport factory, as the SDK's `transport` option takes it (tests pass a capturing one). */
export type TrackerTransport = SentryOptions['transport'];

export interface ErrorContext {
  /** An internal error code; anything outside `KNOWN_CODES` is sent as INTERNAL_ERROR. */
  code: string;
  /** The Express route template (`req.route.path`), `'unmatched'`, or a fatal handler's name. */
  route: string;
}

export interface ErrorReporter {
  /** Captures `err` (sanitised as above) and returns the event id. */
  report(err: unknown, context: ErrorContext): string;
  /** Waits up to `timeoutMs` for queued events to send. */
  flush(timeoutMs: number): Promise<boolean>;
}

export interface ErrorTrackerOptions {
  dsn?: string;
  mode: SoulboundMode;
  transport?: TrackerTransport;
  /**
   * `config.ts`'s `redact()`, run over every kept function name and filename.
   * Optional so `scripts/trackerTest.ts` can run without loading config; the
   * allow-list above does not depend on it.
   */
  redact?: (input: string) => string;
}

const ANTHROPIC_CODES = [
  'AUTHENTICATION_FAILED',
  'RATE_LIMITED',
  'UPSTREAM_UNAVAILABLE',
  'INVALID_RESPONSE_SHAPE',
  'UPSTREAM_ERROR',
] as const satisfies readonly WorldVoiceErrorCode[];
// Compile-time guard: fails the build if anthropic.ts gains a code this list lacks.
type MissingAnthropicCode = Exclude<WorldVoiceErrorCode, (typeof ANTHROPIC_CODES)[number]>;
const anthropicCodesComplete: MissingAnthropicCode extends never ? true : never = true;
void anthropicCodesComplete;

/** The fixed codes an event may carry: shared constants, anthropic.ts, and server.ts's own. */
const KNOWN_CODES: ReadonlySet<string> = new Set<string>([
  PASSPHRASE_REQUIRED,
  TOO_MANY_REQUESTS,
  SIGN_IN_REQUIRED,
  ORIGIN_REJECTED,
  INVITE_REQUIRED,
  INVITE_INVALID,
  ...ANTHROPIC_CODES,
  // server.ts's error handler: body-parser mappings and its two fallbacks.
  'INVALID_REQUEST',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INTERNAL_ERROR',
  'ERROR',
  'NON_ERROR',
]);

const EXCEPTION_TYPE_PATTERN = /^[A-Za-z]\w{0,63}$/;
const FUNCTION_NAME_PATTERN = /^[\w$.<>]{1,100}$/;
const ROUTE_PATTERN = /^[\w/:*.-]{1,100}$/;
const NODE_MODULES_PACKAGE = /\/node_modules\/(?:@[\w.-]+\/)?[\w.-]+\//;
const MAX_FRAMES = 50;

/**
 * The app's own code: the directory this module sits in — `backend/dist` in
 * the image, `backend/src` under Vitest.
 */
const APP_DIR = path.dirname(fileURLToPath(import.meta.url));

function isAllowedFilename(filename: string): boolean {
  return (
    filename.startsWith(`${APP_DIR}${path.sep}`) ||
    filename.startsWith('node:') ||
    NODE_MODULES_PACKAGE.test(filename)
  );
}

function sanitizeType(type: unknown): string {
  return typeof type === 'string' && EXCEPTION_TYPE_PATTERN.test(type) ? type : 'Error';
}

/**
 * Builds the error the SDK actually sees: the original's type and the frame
 * lines of its stack, nothing else. A thrown non-Error becomes NON_ERROR.
 */
function toReportableError(err: unknown): Error {
  if (!(err instanceof Error)) {
    const replacement = new Error('NON_ERROR');
    replacement.stack = 'Error: NON_ERROR';
    return replacement;
  }
  const type = sanitizeType(err.name);
  const reportable = new Error(type);
  reportable.name = type;
  const stack = typeof err.stack === 'string' ? err.stack : '';
  // V8 writes `${name}: ${message}` (or just `${name}` for an empty message)
  // and then one `    at …` line per frame. Cut that header off by its
  // exact text; anything else is an unrecognised stack and keeps no frames.
  const header = err.message ? `${String(err.name)}: ${err.message}\n` : `${String(err.name)}\n`;
  const frames = stack.startsWith(header) ? stack.slice(header.length) : '';
  reportable.stack = frames ? `${type}\n${frames}` : type;
  return reportable;
}

function buildAllowListedEvent(
  event: SentryEvent,
  mode: SoulboundMode,
  redact: (input: string) => string,
): SentryEvent {
  const values = (event.exception?.values ?? []).map((value) => {
    const frames = (value.stacktrace?.frames ?? [])
      .filter((frame) => typeof frame.filename === 'string' && isAllowedFilename(frame.filename))
      .slice(-MAX_FRAMES)
      .map((frame) => {
        const fn =
          typeof frame.function === 'string' && FUNCTION_NAME_PATTERN.test(frame.function)
            ? frame.function
            : '?';
        return {
          function: redact(fn),
          filename: redact(frame.filename as string),
          ...(typeof frame.lineno === 'number' ? { lineno: frame.lineno } : {}),
        };
      });
    return { type: sanitizeType(value.type), stacktrace: { frames } };
  });

  const tags = event.tags ?? {};
  const code = typeof tags.code === 'string' && KNOWN_CODES.has(tags.code) ? tags.code : 'INTERNAL_ERROR';
  const route = typeof tags.route === 'string' && ROUTE_PATTERN.test(tags.route) ? tags.route : 'unmatched';

  return {
    type: undefined,
    ...(event.event_id ? { event_id: event.event_id } : {}),
    ...(event.timestamp ? { timestamp: event.timestamp } : {}),
    level: 'error',
    platform: 'node',
    exception: { values },
    tags: { code, route, mode },
  };
}

/**
 * Starts the tracker when hosted mode has a DSN; otherwise returns undefined
 * without loading the SDK.
 */
export async function initErrorTracker(
  opts: ErrorTrackerOptions,
): Promise<ErrorReporter | undefined> {
  const dsn = opts.dsn?.trim();
  if (opts.mode !== 'hosted' || !dsn) {
    return undefined;
  }
  const redact = opts.redact ?? ((input: string) => input);
  const mode = opts.mode;
  const Sentry = await loadSentry();

  Sentry.init({
    dsn,
    ...(opts.transport ? { transport: opts.transport } : {}),
    // Manual capture only: no global handlers, no HTTP/console/context
    // integrations, no module patching. The SDK's own stack parsing (not an
    // integration) is all `captureException` needs, so the explicit list of
    // "minimum error-capture integrations" is empty.
    defaultIntegrations: false,
    integrations: [],
    enableRuntimeChannelInjection: false,
    beforeBreadcrumb: () => null,
    maxBreadcrumbs: 0,
    beforeSend: (event) => buildAllowListedEvent(event, mode, redact),
    // Second layer: the SDK's own collection switched off field by field
    // (every default is "collect"). The allow-list above would drop all of
    // it anyway.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    includeServerName: false,
    sendClientReports: false,
    attachStacktrace: false,
    // Pinned so SENTRY_DEBUG / SENTRY_SPOTLIGHT in the environment can't turn
    // on debug logging or a second event sink.
    debug: false,
    spotlight: false,
  });

  return {
    report(err: unknown, context: ErrorContext): string {
      return Sentry.captureException(toReportableError(err), {
        tags: { code: context.code, route: context.route },
      });
    },
    flush(timeoutMs: number): Promise<boolean> {
      return Sentry.flush(timeoutMs);
    },
  };
}
