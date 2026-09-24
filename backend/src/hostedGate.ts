/**
 * Hosted mode's request controls (spec "Hosted middleware order", R24b, R24e,
 * R24f). The other mode's counterpart to accessGate.ts, in the same style:
 * small factories, an injected clock, error codes from `@soulbound/shared`,
 * the same `{ error: { message, code } }` envelope.
 *
 * `server.ts` mounts these, in its hosted branch only, at fixed positions of
 * the 15-step order; `hostedOrder.test.ts` pins each position. What each one
 * is for:
 *
 *   3   `frameHeaders`, `modeHeader`  — anti-framing and the mode signal
 *   6   `ipKey`                        — the per-IP limiter's key (IPv6 by /64)
 *   7   `exactWebhookPath`             — the reserved Stripe slot matches one exact path
 *   8   `originCheck`                  — CSRF: state-changing requests must come from the public origin
 *   11  `sessionGate`                  — a live session, and no pending deletion
 *   12  `userLimiter`                  — per signed-in player
 *
 * This file is loaded statically by server.ts, and so by self-host too. It
 * must never import a hosted package (`better-auth`, `pg`, ...): the session
 * reader and `fromNodeHeaders` are handed in by the caller (HostedDeps), and
 * `pg` appears only as a type through `Queryable`, which TypeScript erases.
 */

import type { IncomingHttpHeaders } from 'node:http';
import { isIPv4, isIPv6 } from 'node:net';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { MODE_HEADER, ORIGIN_REJECTED, SIGN_IN_REQUIRED } from '@soulbound/shared';
import { createRateLimiter, type RateLimiterHandler } from './accessGate.js';
import type { Queryable } from './invites.js';

/** The reserved Stripe webhook (Phase 11). The only request that skips the Origin check. */
export const BILLING_WEBHOOK_PATH = '/api/billing/webhook';

/** Methods the Origin check lets through: they must never change state. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const ORIGIN_REJECTED_MESSAGE = 'Request rejected: it did not come from this site';
export const SIGN_IN_REQUIRED_MESSAGE = 'Sign in required';

/**
 * Anti-framing (R24e), plus `Referrer-Policy: no-referrer` (spec Revision
 * History row 21: the invite fragment and any other URL state never leave in
 * a Referer). Mounted globally, so API, static and 404 responses all carry them.
 */
export function frameHeaders(): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  };
}

/**
 * `Soulbound-Mode: hosted` (06-CONTEXT addendum). Mounted on `/api/access`
 * ahead of every gate and limiter, so the 204, the 401 `SIGN_IN_REQUIRED`
 * and a 429 all carry it: the frontend learns the mode from any answer.
 */
export function modeHeader(): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader(MODE_HEADER, 'hosted');
    next();
  };
}

/**
 * Step 7's guard. Express 5 routes are case-insensitive and ignore a trailing
 * slash, so `app.post(BILLING_WEBHOOK_PATH)` alone would also match
 * `/API/Billing/Webhook` and `/api/billing/webhook/`, and each of those would
 * skip the Origin check. This passes the request on to the slot only for the
 * exact path (query ignored) and POST; anything else leaves the route
 * (`next('route')`) before its body is read, and meets the Origin check.
 */
export function exactWebhookPath(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const url = req.originalUrl;
    const q = url.indexOf('?');
    const pathOnly = q === -1 ? url : url.slice(0, q);
    if (req.method === 'POST' && pathOnly === BILLING_WEBHOOK_PATH) {
      next();
      return;
    }
    next('route');
  };
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * CSRF control (R24b). Mount with `app.use('/api', …)`: every request under
 * `/api` whose method is not GET/HEAD/OPTIONS must carry `Origin` equal to
 * `publicOrigin`, byte for byte. Rejected with 403 `ORIGIN_REJECTED`:
 *  - no Origin, or the literal `null` (sandboxed frames, some redirects);
 *  - any other origin;
 *  - `Sec-Fetch-Site: cross-site`, even alongside a matching Origin.
 * No exemptions. The webhook slot is mounted before this, not excused by it.
 * The method is `req.method` as sent: nothing here honours
 * `X-HTTP-Method-Override`.
 */
export function originCheck(publicOrigin: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const origin = firstHeader(req.headers.origin);
    const fetchSite = firstHeader(req.headers['sec-fetch-site']);
    if (origin === publicOrigin && fetchSite?.toLowerCase() !== 'cross-site') {
      next();
      return;
    }
    res.status(403).json({ error: { message: ORIGIN_REJECTED_MESSAGE, code: ORIGIN_REJECTED } });
  };
}

/** The signed-in player, as the session gate leaves it in `res.locals.user`. */
export interface SessionUser {
  id: string;
  email: string;
}

/**
 * Reads the session for a request: Better Auth's `auth.api.getSession`,
 * handed in through HostedDeps so this file never imports `better-auth`.
 * `disableRefresh` is part of the type so the gate can't forget it (see
 * `sessionGate`).
 */
export type GetSession = (options: {
  headers: Headers;
  query: { disableCookieCache: true; disableRefresh: true };
}) => Promise<{ user: { id: string; email: string } } | null>;

/** `better-auth/node`'s `fromNodeHeaders`, likewise handed in. */
export type FromNodeHeaders = (headers: IncomingHttpHeaders) => Headers;

function signInRequired(res: Response): void {
  res.status(401).json({ error: { message: SIGN_IN_REQUIRED_MESSAGE, code: SIGN_IN_REQUIRED } });
}

/**
 * Step 11: replaces the passphrase gate in hosted mode. Every `/api` request
 * that reaches it needs a live session (read from the `session` table: the
 * cookie cache is off in auth.ts, and `disableCookieCache` is passed too), and
 * a user with no pending deletion. Either failure is the same 401
 * `SIGN_IN_REQUIRED`. There is no exemption list: health, the webhook slot,
 * redeem and `/api/auth/*` all end before this is reached.
 *
 * `disableRefresh`: the gate only reads the session. Rolling it forward is
 * left to the browser's own `GET /api/auth/get-session`, the one response
 * that can carry the renewed cookie back. If the gate refreshed the row, as
 * it did before review cycle 1 (S1), `get-session` would find nothing left to
 * refresh, and the browser cookie would still expire 30 days after sign-in
 * (better-auth `api/routes/session.mjs:170`, `:181`).
 */
export function sessionGate(opts: {
  getSession: GetSession;
  fromNodeHeaders: FromNodeHeaders;
  pool: Queryable;
}): RequestHandler {
  const { getSession, fromNodeHeaders, pool } = opts;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const session = await getSession({
      headers: fromNodeHeaders(req.headers),
      query: { disableCookieCache: true, disableRefresh: true },
    });
    if (session === null || session === undefined) {
      signInRequired(res);
      return;
    }
    const pending = await pool.query('SELECT 1 FROM account_deletions WHERE user_id = $1', [session.user.id]);
    if (pending.rows.length > 0) {
      signInRequired(res);
      return;
    }
    const user: SessionUser = { id: session.user.id, email: session.user.email };
    res.locals.user = user;
    next();
  };
}

/**
 * Step 12: per signed-in player (R24f), keyed on the session's user id. Same
 * window, 429 `TOO_MANY_REQUESTS` and bounded map as the per-IP limiter. A
 * request without a user (impossible behind the session gate) shares one
 * bucket, failing toward throttling.
 */
export function userLimiter(perMinute: number, now: () => number): RateLimiterHandler {
  return createRateLimiter({
    perMinute,
    now,
    keyFor: (_req, res) => {
      const user = res.locals.user as SessionUser | undefined;
      return user === undefined ? 'user:unknown' : `user:${user.id}`;
    },
  });
}

/** Parses one IPv6 address (zone already removed) into 8 numbers; undefined if it isn't one. */
function ipv6Hextets(address: string): number[] | undefined {
  let text = address.toLowerCase();
  // A trailing dotted quad (`::ffff:1.2.3.4`, `::1.2.3.4`) is two hextets.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (!isIPv4(tail)) return undefined;
    const [a, b, c, d] = tail.split('.').map(Number) as [number, number, number, number];
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const parse = (part: string): string[] => (part === '' ? [] : part.split(':'));
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return undefined;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return undefined;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * The hosted per-IP limiter's key (R24f; plan critique 3). One IPv6 client
 * usually holds a whole /64, so keying on the full address would give it
 * 2^64 buckets. The address is EXPANDED first (`::`, a `%zone`, an
 * IPv4-mapped `::ffff:a.b.c.d`), and only then cut to its first four
 * hextets, so every spelling of one /64 is one key:
 *   `2001:db8::1`, `2001:db8:0:0::2`, `2001:0db8:0000:0000:0000:0000:0000:0003` → `2001:db8:0:0::/64`
 * IPv4, and IPv4-mapped IPv6, come back as the dotted IPv4 address. Anything
 * that is neither is returned unchanged (still a key; never a bypass).
 */
export function ipv6Slash64(ip: string): string {
  const zone = ip.indexOf('%');
  const address = zone === -1 ? ip : ip.slice(0, zone);
  if (isIPv4(address)) return address;
  if (!isIPv6(address)) return ip;
  const h = ipv6Hextets(address);
  if (h === undefined) return ip;
  const mapped = h.slice(0, 5).every((g) => g === 0) && h[5] === 0xffff;
  if (mapped) {
    return [h[6]! >> 8, h[6]! & 0xff, h[7]! >> 8, h[7]! & 0xff].join('.');
  }
  return `${h
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}

/** `keyFor` for the hosted per-IP limiters (step 6, and redeem at step 9). */
export function ipKey(req: Request): string {
  return req.ip === undefined ? 'unknown' : ipv6Slash64(req.ip);
}
