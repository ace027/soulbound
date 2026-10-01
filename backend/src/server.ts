/**
 * The Soulbound Chronicles backend entrypoint.
 *
 * Express app, a Host allow-list, a CORS policy for the frontend origin, the
 * health check, the `/api` rate limiter and access gate, JSON body parsing,
 * the three World Voice routes, optional static frontend serving, and a
 * central error handler — in the order `buildApp()`'s doc comment lists.
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
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express, {
  type ErrorRequestHandler,
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import type { Pool } from 'pg';
import { ACCESS_CHECK_PATH, assertWorldVoiceContract } from '@soulbound/shared';
import { ACCOUNT_PATH, INVITE_INVALID, INVITE_REDEEM_PATH } from '@soulbound/shared';
import { createAccessGate, createRateLimiter } from './accessGate.js';
import type { SendEmail } from './auth.js';
import {
  BILLING_WEBHOOK_PATH,
  exactWebhookPath,
  frameHeaders,
  ipKey,
  modeHeader,
  originCheck,
  sessionGate,
  userLimiter,
  type FromNodeHeaders,
  type GetSession,
  type SessionUser,
} from './hostedGate.js';
import { initErrorTracker, type ErrorContext, type ErrorReporter } from './errorTracker.js';
import { WORLD_SYSTEM_PROMPT } from './data/worldSystemPrompt.js';
// These three route modules never import config.ts at their own top level
// (see each file's "Lazy import" comment) — they only reach for it inside
// their async handlers — so importing them here, statically, at server.ts's
// own top level, does not reproduce the "throws with no key present" hazard
// anthropic.ts's lazy-config comment documents.
import introSceneRouter from './routes/introScene.js';
import prologueRouter from './routes/prologue.js';
import uniqueSkillRouter from './routes/uniqueSkill.js';
import worldEngineRouter from './routes/worldEngine.js';

interface ApiError extends Error {
  statusCode?: number;
  code?: string;
  /** body-parser tags its own failures with a `type` (see `mapBodyParserError`). */
  type?: string;
}

/**
 * Hosted-mode dependencies: everything the hosted branch of `buildApp` mounts.
 * Built by `buildHostedDeps()` (from `main()`, hosted mode only, through
 * dynamic imports) or by a test. Absent in self-host, where nothing below
 * changes. Better Auth's pieces arrive as plain functions, so neither this
 * file nor hostedGate.ts imports `better-auth`.
 */
export interface HostedDeps {
  /** BETTER_AUTH_URL's origin: the only `Origin` a state-changing request may carry. */
  publicOrigin: string;
  /** The one shared `pg` pool (db.ts's `createPool`). */
  pool: Pool;
  /** Better Auth's `auth.api.getSession` (step 11). */
  getSession: GetSession;
  /** `better-auth/node`'s `fromNodeHeaders` (step 11). */
  fromNodeHeaders: FromNodeHeaders;
  /** auth.ts's invite-context wrapper; runs first on the auth mount (step 10). */
  withInviteContext: RequestHandler;
  /** auth.ts's allow-listed Better Auth handler; ends every `/api/auth/*` request (step 10). */
  handler: (req: IncomingMessage & { originalUrl?: string }, res: ServerResponse) => Promise<void> | void;
  /** invites.ts's `redeemInvite`, bound to the pool and cookie key: the Set-Cookie, or null (step 9). */
  redeemInvite: (code: unknown) => Promise<{ setCookie: string } | null>;
  /**
   * account.ts's `requestAccountDeletion`, bound to the pool and Better Auth:
   * records the deletion request and revokes every session of the user.
   * `buildHostedDeps` always sets it; while absent (a test's deps), `DELETE
   * /api/account` is not mounted (step 14).
   */
  requestAccountDeletion?: (userId: string) => Promise<void>;
  /** Requests per minute per signed-in player (config's USER_RATE_LIMIT_PER_MINUTE; step 12). */
  userRateLimitPerMinute: number;
  /** Sends an error to the tracker (errorTracker.ts), when one is enabled. */
  reportError?: (err: unknown, context: ErrorContext) => void;
  /**
   * Mounts `GET /api/debug/ip` (runbook step 5, the proxy-hop observation).
   * `main()` sets it only when `DEBUG_PROXY_HOPS=1`; `buildHostedDeps` never does.
   */
  debugProxyHops?: boolean;
}

/** Hosted, `DEBUG_PROXY_HOPS=1` only: echoes the caller's own address as Express sees it. */
export const DEBUG_IP_PATH = '/api/debug/ip';

/**
 * The proxy-hop probe (spec Failure Modes, "Wrong trust proxy hop count"). It
 * answers the caller's own `req.ip`, `req.ips` and the number of
 * `X-Forwarded-For` entries that reached the app, and logs nothing. With no
 * `X-Forwarded-For` sent by the caller, `xffHops` is the number of entries the
 * platform's proxies appended, which is the `TRUST_PROXY` hop count.
 */
function debugIpHandler(req: Request, res: Response): void {
  const header = req.headers['x-forwarded-for'];
  const joined = Array.isArray(header) ? header.join(',') : (header ?? '');
  const xffHops = joined
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0).length;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ip: req.ip ?? null, ips: req.ips, xffHops });
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
  /** Hosted mode only; see `HostedDeps`. Existing self-host configs never set it. */
  hosted?: HostedDeps;
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

/** Hosted: redeem's own body limit and per-IP limiter (spec R24c). */
const REDEEM_BODY_LIMIT = '1kb';
const REDEEM_PER_MINUTE = 5;

/** Hosted: the reserved webhook's raw-body limit (Phase 11 verifies the signature over it). */
const WEBHOOK_BODY_LIMIT = '64kb';

/**
 * Hosted: the `Set-Cookie` that clears Better Auth's session cookie
 * (06-03-SUMMARY: its name and attributes), sent by `DELETE /api/account`.
 */
const CLEAR_SESSION_COOKIE =
  '__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax';

/**
 * Hosted: the largest body `/api/auth/*` accepts. Better Auth itself sets no
 * limit (06-04-SUMMARY, Warning 2: it took a 150 KB body). Its real bodies
 * are an email address or a provider name, far under this.
 */
export const AUTH_BODY_LIMIT_BYTES = 16 * 1024;

/**
 * Hosted: a raw byte cap in front of the Better Auth mount. It never reads or
 * parses the body, so step 10 still receives the untouched stream:
 *  - a `Content-Length` over the limit is refused before a byte is read, with
 *    the same 413 `PAYLOAD_TOO_LARGE` the JSON parser gives (through
 *    `mapBodyParserError`), and `Connection: close` so the rest isn't drained;
 *  - a body without one (chunked) is counted as the HTTP parser hands it to
 *    the request (`push`, which is what feeds every reader, in either stream
 *    mode, without switching modes), and the request is destroyed once it
 *    passes the limit. Adding a 'data' listener instead would start the
 *    stream flowing before Better Auth attaches its own, and lose chunks.
 */
function authBodyCap(limitBytes: number): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const declared = req.headers['content-length'];
    if (declared !== undefined) {
      if (Number(declared) > limitBytes) {
        res.setHeader('Connection', 'close');
        const err: ApiError = new Error('request entity too large');
        err.type = 'entity.too.large';
        next(err);
        return;
      }
      next();
      return;
    }
    let seen = req.readableLength;
    let exceeded = seen > limitBytes;
    const push = req.push.bind(req);
    req.push = (chunk: unknown, encoding?: BufferEncoding): boolean => {
      if (exceeded) return false;
      if (chunk !== null && chunk !== undefined) {
        seen += typeof chunk === 'string' ? Buffer.byteLength(chunk) : (chunk as Uint8Array).length;
        if (seen > limitBytes) {
          exceeded = true;
          process.nextTick(() => req.destroy());
          return false;
        }
      }
      return push(chunk, encoding);
    };
    if (exceeded) {
      req.destroy();
      return;
    }
    next();
  };
}

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
 *
 * With `config.hosted` set, the spec's 15-step hosted order is mounted
 * instead ("Hosted middleware order"; each position is pinned by
 * hosted/hostedOrder.test.ts and scripts/mutate-order.sh): trust proxy, Host
 * allow-list, anti-framing headers, CORS, health, the per-IP limiter (IPv6 by
 * /64), the reserved webhook slot, the Origin check, invite redeem, the Better
 * Auth mount, the session gate, the per-user limiter, then the same
 * `express.json` and everything after it. (With `hosted.debugProxyHops`, the
 * `/api/debug/ip` probe is also mounted right after the per-IP limiter.)
 * Only the steps that differ sit in
 * `if (hosted …)` blocks; the self-host lines are the ones above, unchanged.
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
    hosted,
  } = config;
  const reportError = hosted?.reportError;
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

  // Hosted step 3: anti-framing on every response (R24e), and the mode header
  // on every /api/access answer, ahead of any limiter or gate.
  if (hosted !== undefined) {
    app.use(frameHeaders());
    app.use(ACCESS_CHECK_PATH, modeHeader());
  }

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
  if (hosted !== undefined) {
    // Step 6: per-IP limiter, IPv6 keyed by /64 (R24f).
    app.use('/api', createRateLimiter({ perMinute: RATE_LIMIT_PER_MINUTE, now, keyFor: ipKey }));

    // Runbook step 5 only: absent unless DEBUG_PROXY_HOPS=1 (see debugIpHandler).
    if (hosted.debugProxyHops === true) {
      app.get(DEBUG_IP_PATH, debugIpHandler);
    }

    // Step 7: Reserved for Phase 11 (Stripe). Must verify the signature before
    // any side effect. Sits before the Origin check because Stripe sends no
    // Origin. `exactWebhookPath` lets only the exact path and POST in (Express
    // routes are case-insensitive and non-strict); anything else leaves this
    // route before its body is read, and meets the Origin check.
    app.post(
      BILLING_WEBHOOK_PATH,
      exactWebhookPath(),
      express.raw({ type: 'application/json', limit: WEBHOOK_BODY_LIMIT }),
      (_req: Request, res: Response) => {
        res.status(404).json({ error: { message: 'Not found', code: 'NOT_FOUND' } });
      },
    );

    // Step 8: the Origin check (R24b), on every state-changing /api request.
    app.use('/api', originCheck(hosted.publicOrigin));

    // Step 9: invite redeem, before the session gate (the player has no
    // account yet). Its own limiter runs before its own 1 KB body parser.
    app.post(
      INVITE_REDEEM_PATH,
      createRateLimiter({ perMinute: REDEEM_PER_MINUTE, now, keyFor: ipKey }),
      express.json({ limit: REDEEM_BODY_LIMIT }),
      async (req: Request, res: Response) => {
        const body: unknown = req.body;
        const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
        const result = await hosted.redeemInvite(code);
        if (result === null) {
          res.status(400).json({ error: { message: 'This invite code is not valid', code: INVITE_INVALID } });
          return;
        }
        res.setHeader('Set-Cookie', result.setCookie);
        res.sendStatus(204);
      },
    );

    // Step 10's raw byte cap: counts, never reads (see authBodyCap).
    app.use('/api/auth', authBodyCap(AUTH_BODY_LIMIT_BYTES));

    // Step 10: Better Auth, BEFORE express.json (better-auth issue #3295: it
    // hangs otherwise). The handler ends every /api/auth/* request itself.
    app.all('/api/auth/*splat', hosted.withInviteContext, hosted.handler);

    // Step 11: the session gate replaces the passphrase gate. Step 12: per player.
    app.use('/api', sessionGate(hosted));
    app.use('/api', userLimiter(hosted.userRateLimitPerMinute, now));
  } else {
    app.use('/api', createRateLimiter({ perMinute: RATE_LIMIT_PER_MINUTE, now }));
    app.use('/api', createAccessGate(checkPassphrase));
  }

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

  // Hosted step 14: account deletion (06-05 supplies requestAccountDeletion).
  const requestAccountDeletion = hosted?.requestAccountDeletion;
  if (requestAccountDeletion !== undefined) {
    app.delete(ACCOUNT_PATH, async (_req: Request, res: Response) => {
      const user = res.locals.user as SessionUser;
      await requestAccountDeletion(user.id);
      res.setHeader('Set-Cookie', CLEAR_SESSION_COOKIE);
      res.sendStatus(204);
    });
  }

  // The three World Voice routes (plan 02-03). Each goes through the single
  // `callWorldVoice` helper in anthropic.ts — none builds its own request.
  // Registered ahead of the JSON 404 handlers and the error handler below so
  // all still apply to them.
  app.use(uniqueSkillRouter);
  app.use(worldEngineRouter);
  app.use(introSceneRouter);
  // Prologue routes (Phase 14, opt-in from the frontend): system-free, so they join no cache namespace.
  app.use(prologueRouter);

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
    const bodyParserMapping = mapBodyParserError(apiErr);
    const statusCode = bodyParserMapping?.statusCode ?? apiErr.statusCode ?? 500;
    const code =
      bodyParserMapping?.code ?? apiErr.code ?? (statusCode === 500 ? 'INTERNAL_ERROR' : 'ERROR');

    const rawMessage = err instanceof Error ? err.message : String(err);
    const rawStack = err instanceof Error ? err.stack : undefined;

    console.error(`[error] ${req.method} ${req.path}:`, redact(rawStack ?? rawMessage));

    // The tracker (hosted mode with a DSN only) gets the route TEMPLATE, never
    // the concrete path. It must never turn a handled error into a crash.
    if (reportError !== undefined) {
      const routePath: unknown = req.route?.path;
      try {
        reportError(err, { code, route: typeof routePath === 'string' ? routePath : 'unmatched' });
      } catch {
        console.error('[error-tracker] report failed');
      }
    }

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

/** How long a fatal handler waits for the tracker to send before exiting. */
const FATAL_FLUSH_TIMEOUT_MS = 2000;

/**
 * Fatal path with the tracker on: report, give it up to 2 s to send, exit 1.
 * A backstop timer exits even if the flush itself never settles.
 */
function reportThenExit(reporter: ErrorReporter, err: unknown, route: string): void {
  const exit = (): never => process.exit(1);
  try {
    reporter.report(err, { code: 'INTERNAL_ERROR', route });
  } catch {
    // Never let reporting block the exit.
  }
  setTimeout(exit, FATAL_FLUSH_TIMEOUT_MS + 500);
  reporter.flush(FATAL_FLUSH_TIMEOUT_MS).then(exit, exit);
}

/** What `buildHostedDeps` needs: config.ts's hosted values, passed in (never read from the environment here). */
export interface HostedBootOptions {
  databaseUrl: string;
  betterAuthSecret: string;
  resendApiKey: string;
  publicOrigin: string;
  emailFrom: string;
  google?: { clientId: string; clientSecret: string };
  discord?: { clientId: string; clientSecret: string };
  userRateLimitPerMinute: number;
  /** config.ts's `redact()`: every thrown or logged message passes through it. */
  redact: (input: string) => string;
  reportError?: HostedDeps['reportError'];
  /** Test seam: replaces the Resend sender. */
  sendEmail?: SendEmail;
  /** Test seam: the schema holding the tables (pool `search_path` and the migration check). Default `public`. */
  schema?: string;
}

/** A schema name safe to put in libpq's `options` unquoted. */
const SCHEMA_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;

/**
 * Hosted boot, in order: open the pool, refuse to start if any migration is
 * pending (`PENDING_MIGRATIONS_MESSAGE`: "run `npm run migrate`"), then build
 * the account system. `db.js`, `auth.js`, `invites.js` and `better-auth/node`
 * are imported here, dynamically, and only here: self-host never calls this.
 * On any failure the pool is closed and the (already redacted) error rethrown.
 */
export async function buildHostedDeps(options: HostedBootOptions): Promise<HostedDeps> {
  const { schema, redact } = options;
  if (schema !== undefined && !SCHEMA_NAME_PATTERN.test(schema)) {
    throw new Error('buildHostedDeps: invalid schema name');
  }
  const { createPool, assertNoPendingMigrations } = await import('./db.js');
  const pool = await createPool(options.databaseUrl, {
    redact,
    ...(schema === undefined ? {} : { pool: { options: `-c search_path=${schema}` } }),
  });
  try {
    await assertNoPendingMigrations(pool, { redact, ...(schema === undefined ? {} : { schema }) });
    const [
      { createAuth, createResendSender },
      { inviteCookieKey, redeemInvite },
      { fromNodeHeaders },
      { requestAccountDeletion },
    ] = await Promise.all([
      import('./auth.js'),
      import('./invites.js'),
      import('better-auth/node'),
      import('./account.js'),
    ]);
    const hostedAuth = await createAuth({
      pool,
      publicUrl: options.publicOrigin,
      secret: options.betterAuthSecret,
      emailFrom: options.emailFrom,
      sendEmail: options.sendEmail ?? createResendSender(options.resendApiKey),
      ...(options.google === undefined ? {} : { google: options.google }),
      ...(options.discord === undefined ? {} : { discord: options.discord }),
      redact,
    });
    const key = inviteCookieKey(options.betterAuthSecret);
    return {
      publicOrigin: options.publicOrigin,
      pool,
      getSession: async (request) => {
        const session = await hostedAuth.auth.api.getSession(request);
        return session === null ? null : { user: { id: session.user.id, email: session.user.email } };
      },
      fromNodeHeaders,
      withInviteContext: hostedAuth.withInviteContext,
      handler: hostedAuth.handler,
      redeemInvite: (code) => redeemInvite(pool, code, { key }),
      requestAccountDeletion: (userId) => requestAccountDeletion(pool, hostedAuth, userId, new Date()),
      userRateLimitPerMinute: options.userRateLimitPerMinute,
      ...(options.reportError === undefined ? {} : { reportError: options.reportError }),
    };
  } catch (err) {
    await pool.end().catch(() => undefined);
    throw err;
  }
}

/**
 * How long SIGTERM waits for open requests before exiting anyway (hosted
 * only). A world-engine turn can run for well over a minute, so this must
 * outlast one; render.yaml's `maxShutdownDelaySeconds: 120` gives the process
 * 120 s before a SIGKILL, and 110 s leaves 10 s of margin inside that.
 */
export const SHUTDOWN_TIMEOUT_MS = 110_000;

/**
 * Hosted: on SIGTERM, stop accepting, let open requests finish, stop the
 * purge schedule (waiting for a run in progress), then close the pool.
 * Logs a fixed line at the start and at the end (no request data, no PII).
 * Exported for its test.
 */
export function closePoolOnSigterm(server: Server, pool: Pool, stopPurge: () => Promise<void>): void {
  process.once('SIGTERM', () => {
    const started = Date.now();
    const seconds = () => ((Date.now() - started) / 1000).toFixed(1);
    console.log(`[shutdown] SIGTERM received: draining open requests (up to ${SHUTDOWN_TIMEOUT_MS / 1000} s)`);
    setTimeout(() => {
      console.log(`[shutdown] timed out after ${seconds()} s with requests still open; exiting 1`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
    // Timers are cleared at once, so no purge starts while requests drain.
    const purgeStopped = stopPurge().catch(() => undefined);
    server.close(() => {
      purgeStopped
        .then(() => pool.end())
        .then(
          () => {
            console.log(`[shutdown] drained in ${seconds()} s; exiting 0`);
            process.exit(0);
          },
          () => {
            console.log(`[shutdown] drained in ${seconds()} s, but closing the pool failed; exiting 1`);
            process.exit(1);
          },
        );
    });
  });
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

  // The error tracker: hosted mode with SENTRY_DSN only. Otherwise this
  // resolves to undefined without loading the SDK, and everything below runs
  // exactly as it did before the tracker existed.
  let reporter: ErrorReporter | undefined;
  try {
    reporter = await initErrorTracker({ dsn: config.SENTRY_DSN, mode: config.MODE, redact });
  } catch (err) {
    console.error(redact(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  // Hosted mode: the pool, the pending-migration check and the account
  // system (buildHostedDeps). Any failure exits 1 with a redacted message.
  let hostedDeps: HostedDeps | undefined;
  if (config.MODE === 'hosted') {
    try {
      const secrets = config.getHostedSecrets();
      const { HOSTED_PUBLIC_URL, EMAIL_FROM, USER_RATE_LIMIT_PER_MINUTE } = config;
      if (HOSTED_PUBLIC_URL === undefined || EMAIL_FROM === undefined || USER_RATE_LIMIT_PER_MINUTE === undefined) {
        throw new Error('Hosted configuration is incomplete');
      }
      const hostedReporter = reporter;
      hostedDeps = await buildHostedDeps({
        databaseUrl: secrets.databaseUrl,
        betterAuthSecret: secrets.betterAuthSecret,
        resendApiKey: secrets.resendApiKey,
        publicOrigin: HOSTED_PUBLIC_URL,
        emailFrom: EMAIL_FROM,
        ...(config.GOOGLE_CLIENT_ID !== undefined && secrets.googleClientSecret !== undefined
          ? { google: { clientId: config.GOOGLE_CLIENT_ID, clientSecret: secrets.googleClientSecret } }
          : {}),
        ...(config.DISCORD_CLIENT_ID !== undefined && secrets.discordClientSecret !== undefined
          ? { discord: { clientId: config.DISCORD_CLIENT_ID, clientSecret: secrets.discordClientSecret } }
          : {}),
        userRateLimitPerMinute: USER_RATE_LIMIT_PER_MINUTE,
        redact,
        ...(hostedReporter === undefined
          ? {}
          : { reportError: (err: unknown, context: ErrorContext) => void hostedReporter.report(err, context) }),
      });
      // Runbook step 5: a deliberate, temporary operator flag. Not a secret, so
      // it is read here rather than taken by config.ts; it only adds a probe.
      if (process.env.DEBUG_PROXY_HOPS === '1') {
        hostedDeps = { ...hostedDeps, debugProxyHops: true };
        console.log(`[soulbound-backend] ${DEBUG_IP_PATH} is enabled (DEBUG_PROXY_HOPS=1); unset it once TRUST_PROXY is set`);
      }
    } catch (err) {
      console.error(redact(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  }

  const app = buildApp(
    hostedDeps === undefined
      ? config
      : { ...config, hosted: hostedDeps },
  );

  // Express 5 forwards rejected promises from route handlers to the error
  // handler above, but nothing catches a crash outside the request pipeline.
  // Node's default for an unhandled rejection is to print the raw, unredacted
  // stack to stderr and exit — bypassing `redact()` entirely. Matters from
  // Phase 2 onward, when async Anthropic SDK calls can reject outside a
  // handler.
  process.on('unhandledRejection', (reason: unknown) => {
    const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    console.error('[fatal] unhandled rejection:', redact(detail));
    if (reporter === undefined) {
      process.exit(1);
    }
    reportThenExit(reporter, reason, 'unhandledRejection');
  });

  process.on('uncaughtException', (err: Error) => {
    console.error('[fatal] uncaught exception:', redact(err.stack ?? err.message));
    if (reporter === undefined) {
      process.exit(1);
    }
    reportThenExit(reporter, err, 'uncaughtException');
  });

  if (hostedDeps !== undefined) {
    const server = app.listen(PORT, () => {
      console.log(`[soulbound-backend] listening on port ${PORT}`);
    });
    // The hourly account purge (R24d). Hosted only: self-host never reaches here.
    const { startPurgeSchedule } = await import('./account.js');
    const stopPurge = startPurgeSchedule(hostedDeps.pool);
    closePoolOnSigterm(server, hostedDeps.pool, stopPurge);
    return server;
  }

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
