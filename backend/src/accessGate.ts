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
 * The most distinct rate-limit keys (`req.ip` values, or the shared
 * `'unknown'` key) this limiter will track at once, before new, never-seen
 * keys start sharing one overflow bucket instead of each getting their own.
 *
 * 10,000 is chosen, not left unbounded, because a self-hosted, single-tenant
 * deployment behind a passphrase and a Host allow-list has no legitimate
 * reason to see anywhere close to that many distinct real client addresses —
 * a household or small group sharing one passphrase is the whole audience.
 * At roughly 100 bytes per `Bucket` entry plus its `Map` overhead, 10,000
 * entries caps this limiter's own memory at a low, fixed number of megabytes
 * regardless of how many distinct keys an attacker manages to present (see
 * `createRateLimiter`'s doc comment for how this fails — toward throttling,
 * never bypass — once the cap is reached).
 */
const MAX_TRACKED_KEYS = 10_000;

/** The shared bucket every key past `MAX_TRACKED_KEYS` folds into. */
const OVERFLOW_KEY = '\u0000overflow';

/** A rate-limiter middleware with a test-only hook for inspecting its internal state. */
export interface RateLimiterHandler extends RequestHandler {
  /**
   * Test-only: the current number of distinct tracked keys. Lets a test
   * prove the sweep actually shrinks the map, without either reaching into
   * module-private state or waiting on 1,000 real HTTP round trips just to
   * observe it — the test still drives 1,000 real requests through the
   * middleware to populate it, this just reads the result cheaply.
   */
  __trackedKeyCount(): number;
}

/**
 * A fixed-window, per-client rate limiter for gated `/api/*` requests.
 *
 * `now` is injectable so tests can control the window boundary precisely,
 * rather than depending on wall-clock timing (flaky, and unable to assert an
 * exact `Retry-After`). Buckets live in an in-process `Map` — this backend is
 * single-tenant, single-process (see the spec's Rate-limit store decision),
 * so there is no cross-instance state to share.
 *
 * Two things keep that `Map` from growing without bound (independent
 * review, task 3 follow-up):
 *
 *   1. **A sweep, at most once per window.** Every call checks whether a
 *      full window has passed since the last sweep; if so, it walks the map
 *      once and deletes every entry whose window has already expired. This
 *      is O(1) amortized per request (one full-map walk per 60s, not per
 *      request) and needs no background timer — nothing runs when the
 *      server is idle.
 *   2. **A hard cap** (`MAX_TRACKED_KEYS`). If the map is already at the cap
 *      after a sweep and a request arrives from a key that isn't already
 *      tracked, that request is folded into a single shared `OVERFLOW_KEY`
 *      bucket instead of getting a fresh entry. This is what actually bounds
 *      memory under sustained pressure from many distinct (forged or real)
 *      keys arriving faster than one sweep interval can clear them — sweeping
 *      alone only reclaims SPACE that a stopped attacker leaves behind; it
 *      does not stop an attacker who keeps presenting new keys continuously.
 *      Folding into a shared bucket means the limiter fails TOWARD
 *      throttling once the cap is hit (an overflowing caller now shares a
 *      budget with everyone else past the cap, so 429s arrive sooner), never
 *      toward bypass (nobody past the cap gets an unlimited, untracked ride).
 */
export function createRateLimiter(opts: {
  perMinute: number;
  now: () => number;
  /** Override for tests; defaults to `MAX_TRACKED_KEYS`. */
  maxTrackedKeys?: number;
  /**
   * The bucket key for a request. Hosted mode only (hostedGate.ts: IPv6 by
   * /64, or the signed-in user's id). Absent, the key is exactly what it has
   * always been: `req.ip`, or the shared `'unknown'` bucket.
   */
  keyFor?: (req: Request, res: Response) => string;
}): RateLimiterHandler {
  const { perMinute, now, maxTrackedKeys = MAX_TRACKED_KEYS, keyFor } = opts;
  const buckets = new Map<string, Bucket>();
  let lastSweep = now();

  function sweepExpired(t: number): void {
    if (t - lastSweep < WINDOW_MS) return;
    lastSweep = t;
    for (const [key, bucket] of buckets) {
      if (t - bucket.windowStart >= WINDOW_MS) {
        buckets.delete(key);
      }
    }
  }

  const handler = ((req: Request, res: Response, next: NextFunction): void => {
    const t = now();
    sweepExpired(t);

    // A request with no resolvable IP shares one fixed bucket, so an absent
    // `req.ip` fails TOWARD throttling (everyone with no IP shares a budget),
    // never toward bypass (spec's Rate-limit key decision).
    let key = keyFor === undefined ? (req.ip ?? 'unknown') : keyFor(req, res);
    if (!buckets.has(key) && buckets.size >= maxTrackedKeys) {
      // The cap is full and this key has never been seen: give it the
      // shared overflow bucket rather than growing the map further. See the
      // function doc comment above.
      key = OVERFLOW_KEY;
    }

    let bucket = buckets.get(key);
    if (bucket === undefined || t - bucket.windowStart >= WINDOW_MS) {
      // A new window: replace the stale entry (if any) and start fresh.
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
  }) as RateLimiterHandler;

  handler.__trackedKeyCount = () => buckets.size;

  return handler;
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
