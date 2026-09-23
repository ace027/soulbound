/**
 * The deployer-set access gate for `/api/*` (Phase 5, R17/R18).
 *
 * Two middlewares, meant to be mounted in this order, both scoped with
 * `app.use('/api', …)` (never a hand-written `req.path.startsWith` check —
 * see the spec's Mounting rule):
 *
 *   1. `createRateLimiter` — a per-client fixed window, so a passphrase-
 *      guessing burst gets throttled even before the gate rejects it. It runs
 *      BEFORE the gate on purpose: wrong-passphrase attempts must still count
 *      against the limit, or the limiter does nothing against a guesser.
 *   2. `createAccessGate` — a constant-time passphrase check against the
 *      `Authorization: Bearer <passphrase>` header. It runs BEFORE
 *      `express.json` in `server.ts`, so a request with no or the wrong
 *      passphrase is rejected before its body is ever parsed — an
 *      unauthenticated caller cannot spend the JSON-parsing budget, let alone
 *      reach a route or the Anthropic SDK.
 *
 * Both use error codes that do not exist anywhere else in this backend
 * (`PASSPHRASE_REQUIRED`, `TOO_MANY_REQUESTS`, from `@soulbound/shared`) —
 * deliberately distinct from the upstream Anthropic failures
 * `AUTHENTICATION_FAILED` (401) and `RATE_LIMITED` (429) that `anthropic.ts`
 * already emits. The frontend branches on `code`, never on `status`, so a bad
 * deployer key (upstream 401) can never be mistaken for a wrong passphrase,
 * and Anthropic's own rate limit can never be mistaken for this gate's.
 *
 * Neither middleware ever logs the `Authorization` header value.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ACCESS_HEADER, ACCESS_SCHEME, PASSPHRASE_REQUIRED, TOO_MANY_REQUESTS } from '@soulbound/shared';

interface Bucket {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 60_000;

/**
 * A fixed-window, per-client rate limiter for gated `/api/*` requests.
 *
 * `now` is injectable so tests can control the window boundary precisely,
 * rather than depending on wall-clock timing (flaky, and unable to assert an
 * exact `Retry-After`). Buckets live in an in-process `Map` — this backend is
 * single-tenant, single-process (see the spec's Rate-limit store decision),
 * so there is no cross-instance state to share.
 */
export function createRateLimiter(opts: { perMinute: number; now: () => number }): RequestHandler {
  const { perMinute, now } = opts;
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    // A request with no resolvable IP shares one fixed bucket, so an absent
    // `req.ip` fails TOWARD throttling (everyone with no IP shares a budget),
    // never toward bypass (spec's Rate-limit key decision).
    const key = req.ip ?? 'unknown';
    const t = now();

    let bucket = buckets.get(key);
    if (bucket === undefined || t - bucket.windowStart >= WINDOW_MS) {
      // A new window: prune the stale entry (if any) and start fresh. Pruning
      // here, on access, is enough for a single-tenant deployment — there is
      // no background sweep, and the number of distinct keys is bounded by
      // the number of distinct clients that have ever called this server.
      bucket = { count: 0, windowStart: t };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > perMinute) {
      const windowEndsAt = bucket.windowStart + WINDOW_MS;
      const retryAfterSeconds = Math.max(1, Math.ceil((windowEndsAt - t) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: { message: 'Too many requests — try again shortly', code: TOO_MANY_REQUESTS },
      });
      return;
    }

    next();
  };
}

/**
 * Requires `Authorization: <ACCESS_SCHEME> <passphrase>` and calls `check()`
 * on the token. The scheme comparison is case-insensitive (per RFC 7235, and
 * because a client/proxy sending `bearer` instead of `Bearer` should not be a
 * confusing, silent 401); the token itself is compared exactly by `check()`.
 *
 * On any failure — missing header, wrong scheme, empty or wrong token — this
 * returns 401 with `WWW-Authenticate: Bearer realm="soulbound"` and never logs
 * the header value (only the fact that a request lacked/failed one, if a
 * caller wants to log that separately — this module itself logs nothing).
 */
export function createAccessGate(check: (candidate: string) => boolean): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers[ACCESS_HEADER.toLowerCase()];
    const headerValue = Array.isArray(header) ? header[0] : header;

    const token = extractBearerToken(headerValue);

    if (token !== undefined && token.length > 0 && check(token)) {
      next();
      return;
    }

    res.setHeader('WWW-Authenticate', `${ACCESS_SCHEME} realm="soulbound"`);
    res.status(401).json({
      error: { message: 'Passphrase required', code: PASSPHRASE_REQUIRED },
    });
  };
}

/**
 * Pulls the token out of an `Authorization` header value, requiring the exact
 * configured scheme (case-insensitive) followed by exactly one space. Returns
 * `undefined` for a missing header, a wrong scheme, or a malformed value —
 * every one of those is a 401 to the caller, so the gate does not need to
 * distinguish them.
 */
function extractBearerToken(headerValue: string | undefined): string | undefined {
  if (headerValue === undefined) return undefined;
  const spaceIndex = headerValue.indexOf(' ');
  if (spaceIndex === -1) return undefined;
  const scheme = headerValue.slice(0, spaceIndex);
  if (scheme.toLowerCase() !== ACCESS_SCHEME.toLowerCase()) return undefined;
  return headerValue.slice(spaceIndex + 1);
}
