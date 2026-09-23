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

import type { Server } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express, {
  type ErrorRequestHandler,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { ACCESS_CHECK_PATH, assertWorldVoiceContract } from '@soulbound/shared';
import { createAccessGate, createRateLimiter } from './accessGate.js';
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
  checkPassphrase: (candidate: string) => boolean;
  RATE_LIMIT_PER_MINUTE: number;
  TRUST_PROXY: false | 'loopback' | 'uniquelocal' | number;
  /**
   * Absolute path to a pre-built frontend (its `index.html` at the root),
   * served by this same process when set — the published image (Phase 5,
   * R20). Undefined in dev, where Vite serves the frontend separately.
   */
  STATIC_DIR?: string;
  /**
   * Injectable clock for the rate limiter's tests; defaults to
   * `performance.now()`, not `Date.now()`. The limiter only ever compares two
   * readings of this clock to each other (`t - bucket.windowStart`) — it
   * never needs a wall-clock/epoch value — so a monotonic clock is strictly
   * better here: `Date.now()` can jump backward or forward if the system
   * clock is stepped (NTP correction, a container host suspend/resume,
   * a manual `date` change), which could silently reopen an already-spent
   * window or freeze a fresh one open far longer than one minute.
   * `performance.now()` cannot be adjusted this way.
   */
  now?: () => number;
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
 *  - An oversized body must not become an oversized prompt. Read this part
 *    carefully before changing the number, because an earlier version of this
 *    comment got it wrong: it is NOT true that the schemas alone bound the
 *    prompt. Only the SCALAR fields are individually capped. Three collections
 *    are interpolated IN FULL, not sliced, and their per-item `.max()` bounds
 *    MULTIPLY:
 *      skills    200 items x (name 200 + 50 sub-abilities x 200)  ~ 2.0M chars
 *      entities  500 items x ~2.2K                                 ~ 1.1M chars
 *      notes     500 items x 2K                                    ~ 1.0M chars
 *    Schema-only worst case is therefore ~4.2M chars (~1M+ tokens). What
 *    actually stops that is THIS CONSTANT — so for those three fields the body
 *    limit is the operative token guard, not a mere memory backstop. At 512kb
 *    the worst case is still a ~125K-token Opus prompt (single-digit dollars
 *    for one request), which is self-inflicted and local-only under this
 *    project's single-tenant threat model.
 *    Consequence: raising this value raises the worst-case prompt cost
 *    proportionally, with no schema change to notice. A future "saves got
 *    bigger, bump it to 2mb" would quietly 8x it. Cap the three collections
 *    with slices in the render function if you need a bigger body.
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
 * Builds the real Express pipeline, in this order: Host allow-list, CORS,
 * `GET /api/health` (no credentials needed — the compose healthcheck calls
 * it), the `/api` rate limiter, the `/api` access gate, `/api`-scoped JSON
 * body parsing, `GET /api/access` (the frontend's pre-flight passphrase
 * check), the three World Voice routes, an `/api`-scoped JSON 404, then
 * (only when `STATIC_DIR` is set) the built frontend and its SPA fallback,
 * then a global JSON 404, and finally the central sanitizing error handler.
 *
 * This is now the only server in the published image (Phase 5, R20): when
 * `STATIC_DIR` points at a built frontend, this same process serves it
 * same-origin, so there is no second container and no separate CORS/proxy
 * story to keep in sync with this one. The ordering below is load-bearing
 * for that: the `/api`-scoped JSON 404 is registered BEFORE the static
 * middleware and its SPA fallback, so nothing under the `/api` mount can
 * ever fall through to `index.html` — an unmatched `/api/*` path always gets
 * JSON, in either mode, even for `/API/x` or `/api/../api/x` (Express 5's
 * router normalizes these to `/api` before `app.use('/api', …)` ever sees
 * them). With `STATIC_DIR` unset (dev, where Vite serves the frontend), no
 * static middleware or fallback is registered at all, and the chain ends in
 * the same global JSON 404 this app has always had.
 *
 * The limiter runs BEFORE the gate so a passphrase-guessing burst is
 * throttled even though every guess also gets rejected. Both run BEFORE
 * `express.json` so an unauthenticated request's body is never parsed —
 * `routes.test.ts` proves this with an oversized, unauthenticated body that
 * gets 401, not 413. `express.json` itself is scoped to `/api` (not a global
 * `app.use`), same as the limiter and gate: every real route in this app
 * lives under `/api`, and a global mount would parse a body for ANY path —
 * including one with no passphrase required at all — before anything is
 * known to even match a route. Every `/api` middleware is mounted with
 * `app.use('/api', …)`, never a hand-written `req.path.startsWith` check:
 * Express 5's router matches `/API/x`, `/api/x/` and `/api/../api/x` as
 * `/api`, and a string-prefix check would not (verified by probe).
 */
export function buildApp(config: AppConfig): Express {
  const {
    FRONTEND_ORIGIN,
    ALLOWED_HOSTS,
    redact,
    checkPassphrase,
    RATE_LIMIT_PER_MINUTE,
    TRUST_PROXY,
    STATIC_DIR,
    now = () => performance.now(),
  } = config;
  const app = express();
  app.set('trust proxy', TRUST_PROXY);

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

  // Registered ahead of the limiter and gate below, and ending the response
  // itself, so it is never limited or gated — the compose healthcheck
  // (docker-compose.yml) calls this with no credentials.
  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  // Rate limiter, then access gate, both scoped to /api and both BEFORE
  // express.json — see this function's header comment for why the order
  // matters. Wrong-passphrase attempts still count against the limiter.
  app.use('/api', createRateLimiter({ perMinute: RATE_LIMIT_PER_MINUTE, now }));
  app.use('/api', createAccessGate(checkPassphrase));

  // Scoped to /api, like the limiter and gate above — NOT a global
  // app.use(express.json(...)). A non-/api path (e.g. an eventual static
  // asset request, or simply a typo'd route) has no reason to have its body
  // read and buffered up to JSON_BODY_LIMIT before it is even known whether
  // anything matches; every real route in this app lives under /api. Fixed
  // per the independent security review: the previous global mount parsed a
  // request body for ANY path with no passphrase required, contradicting
  // this function's own header comment that both middlewares above run
  // before body parsing.
  app.use('/api', express.json({ limit: JSON_BODY_LIMIT }));

  // The frontend's pre-flight check: reaching this handler at all means the
  // limiter and gate above already passed, so there is nothing left to
  // verify beyond returning success with no body.
  app.get(ACCESS_CHECK_PATH, (_req: Request, res: Response) => {
    res.sendStatus(204);
  });

  // The three World Voice routes (plan 02-03). Each goes through the single
  // `callWorldVoice` helper in anthropic.ts — none builds its own request.
  // Registered ahead of the JSON 404 handlers and the error handler below so
  // all still apply to them.
  app.use(uniqueSkillRouter);
  app.use(worldEngineRouter);
  app.use(introSceneRouter);

  // Unmatched /api routes get a JSON 404, scoped the same way as the limiter
  // and gate above (never a hand-written path check). This must be
  // registered before any later catch-all (05-04's static/SPA fallback), so
  // nothing under /api can ever fall through to an HTML response.
  app.use(
    '/api',
    (_req: Request, res: Response) => {
      res.status(404).json({
        error: { message: 'Not found', code: 'NOT_FOUND' },
      });
    },
  );

  // Serve the built frontend when STATIC_DIR is set (the published image,
  // Phase 5/R20) — registered AFTER the /api JSON 404 above, so nothing
  // under /api can ever reach this. express.static answers real files
  // (index.html, /assets/*.js, etc.) directly. The GET fallback after it
  // only ever answers a path with NO file extension (an SPA route like
  // /some/deep/link): a path WITH an extension (a stale/renamed chunk after
  // an upgrade, e.g. /assets/missing-chunk.js) falls through to the global
  // JSON 404 below instead of getting index.html back — returning HTML for
  // that case would silently blank the page instead of surfacing a 404 the
  // client can detect and recover from (a cache-busted reload).
  if (STATIC_DIR !== undefined) {
    app.use(express.static(STATIC_DIR));
    app.get(/.*/, (req: Request, res: Response, next: NextFunction) => {
      if (path.extname(req.path) !== '') {
        next();
        return;
      }
      res.sendFile(path.join(STATIC_DIR, 'index.html'));
    });
  }

  // Unmatched routes — either STATIC_DIR is unset (dev; every real route is
  // under /api, so this is the only thing left to hit), or STATIC_DIR is set
  // and this is an extensioned path express.static didn't recognize (a
  // stale chunk). Without this, Express answers with its default HTML error
  // page, which a JSON client cannot parse.
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
