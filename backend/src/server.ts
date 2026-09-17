/**
 * The Soulbound Chronicles backend entrypoint.
 *
 * Express app, JSON body parsing, a Host allow-list, a CORS policy for the
 * frontend dev origin, the health check, and a central error handler. Phase 2
 * adds the three World Voice routes; this file stays minimal on purpose.
 *
 * The app itself is built by `buildApp()`, which is exported and takes its
 * configuration as an argument. That split exists so the route tests exercise
 * THIS pipeline rather than a hand-rebuilt copy of it: before it existed,
 * unregistering all three routers, replacing the error handler's client
 * message with the raw stack, and deleting the startup contract guard all left
 * the suite green, because no test executed this file at all.
 *
 * `buildApp` takes config as a parameter rather than importing it, because
 * `config.ts` reads ANTHROPIC_API_KEY at its own module top level and throws
 * synchronously when it is absent — see `main()`'s lazy import below.
 */

import express, {
  type ErrorRequestHandler,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import type { Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { assertWorldVoiceContract } from '@soulbound/shared';
import { WORLD_SYSTEM_PROMPT } from './data/worldSystemPrompt.js';
// These three route modules never import config.ts at their own top level
// (see each file's "Lazy import" comment) — they only reach for it inside
// their async handlers — so importing them here, statically, at server.ts's
// own top level, does not reproduce the "throws with no key present" hazard
// anthropic.ts's lazy-config comment documents.
import introSceneRouter from './routes/introScene.js';
import uniqueSkillRouter from './routes/uniqueSkill.js';
import worldEngineRouter from './routes/worldEngine.js';

interface ApiError extends Error {
  statusCode?: number;
  code?: string;
  /** body-parser tags its own failures with a `type` (see `mapBodyParserError`). */
  type?: string;
}

/** The slice of `config.ts` the app itself needs. */
export interface AppConfig {
  FRONTEND_ORIGIN: string;
  ALLOWED_HOSTS: readonly string[];
  redact: (input: string) => string;
}

/**
 * The maximum JSON request body this server will read.
 *
 * Explicit, not body-parser's 100kb default. The two things it has to balance:
 *
 *  - A legitimate long-playthrough save must never 413. The world-engine body
 *    carries the full GameState, and two of its arrays grow for the whole
 *    playthrough (`actionHistory`, and the Unique Skill's `usage_notes`). A
 *    500-turn run is roughly 500 actions x ~250 chars (~125 KB) plus ~300
 *    usage notes (~45 KB) plus the entity ledger and standing notes (~55 KB) —
 *    about 230 KB, already over the 100kb default.
 *  - An oversized body must not become an oversized prompt. That is NOT what
 *    this limit is for: the render functions read only bounded slices (the
 *    last 5 actions, the last 8 usage notes), and every remaining
 *    prompt-reaching field carries its own `.max()` in the route schemas. This
 *    limit is the memory/DoS backstop behind those bounds.
 */
const JSON_BODY_LIMIT = '512kb';

/**
 * Splits the hostname out of a `Host` header value, leaving an IPv6 literal's
 * brackets intact (`[::1]:3001` -> `[::1]`, `127.0.0.1:3001` -> `127.0.0.1`).
 */
function hostnameOf(host: string): string {
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    return close === -1 ? host : host.slice(0, close + 1);
  }
  const colon = host.indexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

/**
 * Exact match on `host:port`, or a hostname-only allow-list entry matching any
 * port on that hostname. Exported for the tests that prove a rebinding host is
 * rejected.
 */
export function isHostAllowed(
  hostHeader: string | undefined,
  allowedHosts: readonly string[],
): boolean {
  if (hostHeader === undefined) return false;
  const host = hostHeader.trim().toLowerCase();
  if (host.length === 0) return false;
  if (allowedHosts.includes(host)) return true;
  const hostname = hostnameOf(host);
  return allowedHosts.some((entry) => hostnameOf(entry) === entry && entry === hostname);
}

/**
 * Turns body-parser's own failures into the same `{ statusCode, code }` shape
 * every other error in this app carries. Without this they reach the error
 * handler as a bare `Error` with a `status` (not `statusCode`) and no `code`,
 * and a malformed JSON body surfaces to the client as `code: "ERROR"` — an
 * unactionable string the frontend cannot branch on.
 */
function mapBodyParserError(err: ApiError): { statusCode: number; code: string } | undefined {
  switch (err.type) {
    case 'entity.parse.failed':
      return { statusCode: 400, code: 'INVALID_REQUEST' };
    case 'entity.too.large':
      return { statusCode: 413, code: 'PAYLOAD_TOO_LARGE' };
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return { statusCode: 415, code: 'UNSUPPORTED_MEDIA_TYPE' };
    default:
      return undefined;
  }
}

/**
 * Builds the real Express pipeline: Host allow-list, CORS, JSON body parsing,
 * health check, the three World Voice routes, the JSON 404, and the central
 * sanitizing error handler — in that order.
 */
export function buildApp(config: AppConfig): Express {
  const { FRONTEND_ORIGIN, ALLOWED_HOSTS, redact } = config;
  const app = express();

  // Host allow-list, FIRST — ahead of CORS and ahead of body parsing. CORS
  // headers are read by the browser only after the request has already been
  // issued and (on these routes) already spent money, and a rebound hostname
  // pointed at 127.0.0.1 makes the loopback bind meaningless on its own. See
  // config.ts's ALLOWED_HOSTS comment.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isHostAllowed(req.headers.host, ALLOWED_HOSTS)) {
      res.status(403).json({ error: { message: 'Forbidden', code: 'FORBIDDEN' } });
      return;
    }
    next();
  });

  // CORS: allow only the configured frontend origin (defaults to Vite's dev
  // port). No `cors` package — this is the entire policy the plan asks for.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  // The three World Voice routes (plan 02-03). Each goes through the single
  // `callWorldVoice` helper in anthropic.ts — none builds its own request.
  // Registered ahead of the JSON 404 handler and the error handler below so
  // both still apply to them.
  app.use(uniqueSkillRouter);
  app.use(worldEngineRouter);
  app.use(introSceneRouter);

  // Unmatched routes. Without this, Express answers with its default HTML
  // error page, which a JSON client cannot parse — the frontend's fetch
  // wrapper would fail on JSON.parse rather than surfacing a clean 404.
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: { message: 'Not found', code: 'NOT_FOUND' },
    });
  });

  // Central error handler. Never forwards a stack trace, the API key, or a
  // raw upstream provider error body to the client — those are logged
  // server-side (redacted) and replaced with a sanitized shape.
  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    const apiErr = err as ApiError;
    const bodyParser = mapBodyParserError(apiErr);
    const statusCode = bodyParser?.statusCode ?? apiErr.statusCode ?? 500;
    const code =
      bodyParser?.code ?? apiErr.code ?? (statusCode === 500 ? 'INTERNAL_ERROR' : 'ERROR');

    const rawMessage = err instanceof Error ? err.message : String(err);
    const rawStack = err instanceof Error ? err.stack : undefined;

    console.error(`[error] ${req.method} ${req.path}:`, redact(rawStack ?? rawMessage));

    const clientMessage = statusCode === 500 ? 'Internal server error' : redact(rawMessage);

    res.status(statusCode).json({
      error: {
        message: clientMessage,
        code,
      },
    });
  };

  app.use(errorHandler);

  return app;
}

/**
 * Last-resort redaction for the one log line that happens BEFORE config.ts has
 * loaded, and therefore before `redact()` (which strips the exact key bytes)
 * exists. Pattern-based rather than value-based: it cannot read the key, and
 * must not hold a second plaintext copy of it to try.
 */
function scrubKeyShapedStrings(input: string): string {
  return input.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[REDACTED]');
}

export async function main(): Promise<Server> {
  // config.ts reads ANTHROPIC_API_KEY once, at import time, and throws a
  // clear, actionable error if it's missing. Importing it dynamically here
  // (rather than as a static top-level import) lets us report that failure
  // as a clean one-line message instead of a raw stack trace, while still
  // exiting non-zero before the app is built or the port is bound.
  let config: typeof import('./config.js');
  try {
    config = await import('./config.js');
  } catch (err) {
    console.error(scrubKeyShapedStrings(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  const { PORT, redact } = config;

  // CLAUDE.md constraint #4: the prompt and the parser must never drift apart.
  // This asserts that WORLD_SYSTEM_PROMPT's RESPONSE FORMAT block, the derived
  // JSON Schema, and CONTRACT_FIELD_NAMES all name the same nine fields.
  // Run at startup, like the API key check, so drift fails the process
  // immediately instead of surfacing mid-game as an unexplained parse failure.
  try {
    assertWorldVoiceContract(WORLD_SYSTEM_PROMPT);
  } catch (err) {
    console.error(redact(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  const app = buildApp(config);

  // Express 5 forwards rejected promises from route handlers to the error
  // handler above, but nothing catches a crash outside the request pipeline.
  // Node's default for an unhandled rejection is to print the raw, unredacted
  // stack to stderr and exit — bypassing `redact()` entirely. Matters from
  // Phase 2 onward, when async Anthropic SDK calls can reject outside a
  // handler.
  process.on('unhandledRejection', (reason: unknown) => {
    const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    console.error('[fatal] unhandled rejection:', redact(detail));
    process.exit(1);
  });

  process.on('uncaughtException', (err: Error) => {
    console.error('[fatal] uncaught exception:', redact(err.stack ?? err.message));
    process.exit(1);
  });

  return app.listen(PORT, () => {
    console.log(`[soulbound-backend] listening on port ${PORT}`);
  });
}

// Only boot when this file IS the process entrypoint. Importing it (from a
// test, or from a future tool that wants `buildApp`) must not bind a port or
// call `process.exit`.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  void main();
}
