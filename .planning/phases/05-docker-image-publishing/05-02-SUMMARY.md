The rate limiter and access gate are now real and wired into `buildApp` in the exact order the
spec fixes. `/api/access` exists for the frontend's pre-flight check.

## Status: Complete

**Correction to the original deviation note below:** task 3 originally called for spawning a
read-only `engineering-security-engineer` review via an "Agent tool" that was not available in this
session's toolset, so I performed that review myself (see "Security review findings" below) and
flagged it as a warning rather than a genuinely independent review. **That has since been
superseded**: the orchestrator ran a real, independent Security Engineer agent (read-only) against
this plan's diff and reported its verdict as **PASS WITH FIXES**, with five findings. See
"Independent security review (orchestrator-run) and fixes" at the end of this document for those
findings, what was fixed, and the re-run mutation table. With that review now actually performed,
the status is Complete rather than Complete with Warnings — the original self-review below is kept
for its own record, not as a substitute.

The original warning (superseded, kept for the record): task 3 calls for spawning a read-only
`engineering-security-engineer` review via an "Agent tool". No such tool (a `Task`/`Agent` call
accepting `subagent_type`) was available in this session's toolset — only `SendMessage` to
already-running peer agents, and the heavier-weight `create_session` (Claude Code Remote), neither
of which is "spawn a read-only review agent, give it these files, it makes no edits" as the plan
describes. I performed the review myself, read-only, against `backend/src/accessGate.ts`, the
`server.ts` diff, and the spec's Failure Modes table, rather than silently skipping the
second-agent-review requirement. See "Security review findings" below. Flagging this honestly
rather than reporting a review that didn't happen the way the plan specified.

## Tasks

### Task 1 — Standalone middlewares
Created `backend/src/accessGate.ts`:
- `createRateLimiter({ perMinute, now })`: fixed 60s window, `Map<string, {count, windowStart}>`
  keyed on `req.ip ?? 'unknown'`, pruned on next access to that key. Over limit → 429
  `TOO_MANY_REQUESTS` with an integer `Retry-After` (seconds to window end, minimum 1).
- `createAccessGate(check)`: parses `Authorization`, requires scheme `Bearer` (case-insensitive
  scheme match; exact token), calls `check(token)`. Failure → 401 `PASSPHRASE_REQUIRED` +
  `WWW-Authenticate: Bearer realm="soulbound"`. Logs nothing.

`backend/src/__tests__/accessGate.test.ts`: fresh Express app per test, injected clock, no real
network. Covers: N+1 request in a window → 429 with integer `Retry-After`; window reset after 60s;
separate IPs → separate buckets; undefined `req.ip` → shared `'unknown'` bucket; missing/wrong
scheme/wrong token/empty token → 401 each; correct token → `next()`; case-insensitive scheme.

Verify:
```
$ npm test -w @soulbound/backend -- accessGate
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

### Task 2 — Wired into `buildApp`
`AppConfig` gained `checkPassphrase`, `RATE_LIMIT_PER_MINUTE`, `TRUST_PROXY`, optional `now`.
`app.set('trust proxy', TRUST_PROXY)` runs right after `express()`. `/api/health` stays first among
`/api` routes (ends the response itself, before the limiter/gate). Then
`app.use('/api', createRateLimiter(...))`, `app.use('/api', createAccessGate(checkPassphrase))`,
then `express.json`, then `GET /api/access` (204), then the three World Voice routers, then an
`/api`-scoped JSON 404, then a global JSON 404 (unchanged reachable surface until 05-04 replaces it
with static serving), then the error handler.

`routes.test.ts`: the shared harness (`buildTestApp()`) now passes `RATE_LIMIT_PER_MINUTE: 600`, and
`httpRequest` sends the Bearer header (`AUTH_HEADERS`) by default, with a `noAuth: true` escape
hatch and a `headers` override for tests that need something else. New `describe('access gate', …)`
block: no header → 401 (SDK not called); wrong passphrase → 401 (SDK not called); `/api/health`
with no header → 200; `/api/access` → 204 authorized / 401 unauthorized; `POST /API/unique-skill`
(mixed case) with no header → 401; a 1 MB unauthenticated body → 401, not 413; `OPTIONS
/api/world-engine` with no header → 204 (CORS answers first); a nested describe builds its own app
(`RATE_LIMIT_PER_MINUTE: 3`, injected clock) and proves a burst → 429 with `Retry-After`, and that
wrong-passphrase attempts count against the limit. Added one Host-allow-list test:
`TRUST_PROXY=1` with a rebound Host still gets 403 (trust proxy never changes Host handling).
Fixed one existing test (`buildApp middleware > answers an unmatched route with JSON…`) that used
raw `fetch` with no header — added the header, since it now needs to clear the gate before hitting
the `/api`-scoped 404 the test is actually about.

Verify:
```
$ npm run build && npm test -w @soulbound/backend
(build: 0 errors, three workspaces)
 Test Files  8 passed (8)
      Tests  165 passed (165)
```
Count before this plan (from 05-01's own before/after checkpoint): 146. After task 2: 165 (+19).

### Task 3 — Secret-leak proof, main() exit case, mutation sweep, security review
Added to `routes.test.ts`: a route throws `Error('upstream echoed something: ${FAKE_PASSPHRASE}')`;
asserts neither the captured `console.error` log nor the response body contains the passphrase.
Added to `server.test.ts`: `main()` exits 1 naming `SOULBOUND_PASSPHRASE` when unset, and the logged
line contains neither the fake key nor a stack trace.

Final count: **146 → 167 (+21)**.

Committed before the mutation sweep (protocol point): `cc13831`.

## Final `buildApp` middleware order (pasted from `backend/src/server.ts`)

```ts
export function buildApp(config: AppConfig): Express {
  const {
    FRONTEND_ORIGIN,
    ALLOWED_HOSTS,
    redact,
    checkPassphrase,
    RATE_LIMIT_PER_MINUTE,
    TRUST_PROXY,
    now = Date.now,
  } = config;
  const app = express();
  app.set('trust proxy', TRUST_PROXY);

  // Host allow-list, FIRST
  app.use((req, res, next) => { /* isHostAllowed(...) → 403 or next() */ });

  // CORS (answers OPTIONS with 204 before anything else)
  app.use((req, res, next) => { /* ACAO/ACAM/ACAH headers; OPTIONS → 204 */ });

  // /api/health — no credentials, ends the response itself
  app.get('/api/health', (_req, res) => { res.status(200).json({ status: 'ok' }); });

  // Rate limiter, then access gate — both /api-scoped, both before express.json
  app.use('/api', createRateLimiter({ perMinute: RATE_LIMIT_PER_MINUTE, now }));
  app.use('/api', createAccessGate(checkPassphrase));

  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  // Frontend pre-flight check
  app.get(ACCESS_CHECK_PATH, (_req, res) => { res.sendStatus(204); });

  // The three World Voice routers
  app.use(uniqueSkillRouter);
  app.use(worldEngineRouter);
  app.use(introSceneRouter);

  // /api-scoped JSON 404
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { message: 'Not found', code: 'NOT_FOUND' } });
  });

  // Global JSON 404 (05-04 replaces this with static + SPA fallback)
  app.use((_req, res) => {
    res.status(404).json({ error: { message: 'Not found', code: 'NOT_FOUND' } });
  });

  // Central error handler (unchanged)
  app.use(errorHandler);
  return app;
}
```

This matches the plan's `must_haves` order exactly: Host allow-list → CORS → `GET /api/health` →
`app.use('/api', rateLimiter)` → `app.use('/api', accessGate)` → `express.json` →
`GET /api/access` → routers → `app.use('/api', JSON 404)` → error handler.

## Files modified
- `backend/src/accessGate.ts` (new)
- `backend/src/server.ts`
- `backend/src/__tests__/accessGate.test.ts` (new)
- `backend/src/__tests__/routes.test.ts`
- `backend/src/__tests__/server.test.ts`
- `.planning/phases/05-docker-image-publishing/05-02-SUMMARY.md` (this file)

## Test counts
- Backend: **146 → 167** (+21): +10 in `accessGate.test.ts` (task 1), +9 in `routes.test.ts` (task
  2's gate-behaviour block plus the TRUST_PROXY/Host test), +2 in task 3 (one in `routes.test.ts`,
  one in `server.test.ts`).
- Frontend: unchanged (this plan touches no frontend file).
- Full workspace: `npm run build` clean across `shared`/`backend`/`frontend`;
  `npm test -w @soulbound/backend` → `Test Files 8 passed (8)`, `Tests 167 passed (167)`.

## Mutation table
Each mutated on the committed tree (`cc13831`), restored with `git checkout -- <file>`, confirmed
clean with `git diff --exit-code` before the next mutation. Nothing else wrote to the tree during
the sweep.

| # | Mutation | File | Result |
|---|---|---|---|
| 1 | Delete `app.use('/api', createAccessGate(checkPassphrase))` | `server.ts` | **RED** — 6 tests failed, including `access gate > no header returns 401…` and the rate-limiter burst test (which now got 204 instead of 401 on its wrong-passphrase probes) |
| 2 | Move `express.json` above the limiter/gate | `server.ts` | **RED** — `access gate > a 1 MB unauthenticated body gets 401, not 413…` failed (got 413) |
| 3 | Replace `timingSafeEqual(candidateDigest, realDigest)` with `candidate === soulboundPassphrase.reveal()` (raw-string `===`, no hashing) | `config.ts` | **SURVIVED** — all 167 tests stayed green. Recorded honestly per the plan's own instruction: `===` returns the same boolean as the hash-then-`timingSafeEqual` path for every functional test case, so no test built for this plan can distinguish them by outcome. The timing property `timingSafeEqual` protects against is not observable from a `vitest` assertion on response status/body — it is a code-review-only property, not a mutation-testable one. Verified by re-reading `checkPassphrase`'s implementation directly: it is unchanged from 05-01 and remains hash-then-`timingSafeEqual`. |
| 4 | Drop the passphrase branch from `redact()` (key redaction only) | `config.ts` | **RED** — 2 tests failed: `error handler > a thrown error echoing the passphrase is redacted from both the log and the response body` (this plan, `routes.test.ts`) and one config-level `redact()` test from 05-01 (`redact() > strips both the API key and the passphrase from one string`) |

3 of 4 mutations caught by a test on the first pass; #3 is the plan-anticipated "behaviourally
equivalent" case and was recorded as such rather than papered over with an invented timing test.

## Security review findings

Performed directly (see the Status warning above on why no separate agent ran it), read-only,
against `backend/src/accessGate.ts`, the `server.ts` diff (`421d896..HEAD`), and the spec's Failure
Modes table.

1. **In-process rate-limit `Map` has no cap on distinct keys.** `createRateLimiter` prunes a key's
   own bucket on its next access past the window boundary, but never evicts a key that stops being
   used — an attacker able to present many distinct `req.ip` values (which, with `TRUST_PROXY`
   unset, means many distinct real source addresses; a single client cannot spoof this) could grow
   the map unboundedly. **Disposition: accepted, not fixed.** This is the exact tradeoff the spec's
   "Rate-limit store" decision names explicitly (in-process `Map`, single-tenant, "no dependency
   added"; Redis is out of scope). Fixing it would mean adding eviction logic and a new test outside
   this plan's `files_modified`, and the threat it addresses (many real source IPs hammering one
   self-hosted deployment) is already the scenario the passphrase and Host allow-list exist to make
   expensive for an attacker to reach in the first place. Recorded here rather than silently noticed
   and dropped.
2. **`extractBearerToken` does not trim the token.** `Authorization: Bearer  x` (two spaces) yields
   token `" x"`, which will never match a real passphrase (the real one is compared byte-for-byte
   after `readPassphrase()`'s own trim). This is correct, not a bug: the frontend's
   `setPassphrase`/`postJson` path (05-03's job) is the one place a user-typed value gets trimmed
   before it is ever put in a header, so the header the browser sends is always exactly right. No
   change needed here.
3. **Header value could theoretically arrive as an array.** Node folds most headers to a single
   string, but `createAccessGate` defensively takes `header[0]` if `req.headers['authorization']`
   were ever an array — verified this cannot silently degrade to "any value in the array passes",
   since only `header[0]` is ever checked. No fix needed.
4. **Nothing in `accessGate.ts` calls `console.*`.** Confirmed by reading the whole file: the module
   has zero logging calls, so there is no path by which it could log the header value even by
   accident. This directly satisfies the spec's "never logs the header value" requirement without
   relying on `redact()` at all in this module (the error-handler's `redact()` on the config side
   remains the backstop for anything a route or the SDK might echo back).
5. **Mount-order and mounting-rule compliance.** Confirmed every `/api` middleware (limiter, gate,
   the two 404 handlers) uses `app.use('/api', …)`, never a hand-written `req.path.startsWith`
   check, matching the spec's Mounting rule. Confirmed with a live test
   (`POST /API/unique-skill` with no header → 401, not a fallthrough) rather than by inspection
   alone.

No in-scope finding required a code change beyond what tasks 1-3 already implemented; item 1 is
recorded as an accepted, spec-endorsed tradeoff rather than fixed.

## Decisions made
- `httpRequest` in `routes.test.ts` now sends the gate's Bearer header **by default** (`AUTH_HEADERS`),
  with a `noAuth: true` flag and a `headers` override, rather than adding the header to every one of
  the ~20 existing call sites individually. This kept the diff to that file smaller and made the
  gate's own tests (which need to omit or vary the header) the only ones that had to say so
  explicitly.
- The rate-limiter's burst test and the `TRUST_PROXY` Host test each build their own `buildApp(...)`
  instance and close their own server, per the plan's Limiter isolation requirement — neither
  touches the shared 600/min harness.
- Mutation #3 (`timingSafeEqual` → `===`) is recorded as SURVIVED with the reasoning above, per the
  plan's explicit instruction not to invent a timing test to force a false red.
- Performed the Security Engineer review myself rather than skip it, since no `Agent`/`Task`-style
  tool with a `subagent_type` parameter was available in this session — see the Status section.

## Issues / carry-forward notes for 05-03 and 05-04
- **For 05-03 (frontend gate):** `ACCESS_CHECK_PATH` (`/api/access`) now returns 204 with a valid
  Bearer header and 401 `PASSPHRASE_REQUIRED` without one — exactly the contract `checkAccess()` and
  `AccessGate` need. Nothing else in the backend changed shape.
- **For 05-04 (static serving):** the global (non-`/api`) JSON 404 registered in this plan is a
  placeholder — the plan's own comment on it says so. 05-04 replaces it with
  `express.static(STATIC_DIR)` plus an SPA fallback when `STATIC_DIR` is set, and must keep the
  `/api`-scoped 404 registered **before** that fallback so nothing under `/api` can ever reach it
  (already true today: the `/api`-scoped 404 sits above the global one in registration order).
- **Standing note:** the retro's "audit guard coverage at phase start" (AI-7) properties — fails
  closed, passphrase never logged, `/api/*` never returns HTML — are each mutation-verified above
  except "never returns HTML for `/api/*`", which isn't yet meaningfully testable until 05-04 adds a
  non-`/api` static/SPA path to contrast against; today every unmatched route (both `/api` and not)
  returns the same JSON 404, so there is no HTML path to fail into yet.
- ~~Escalate to the developer: task 3 named a specific tool (`engineering-security-engineer` via
  the "Agent tool") that was not present in this session.~~ **Resolved**: the orchestrator ran that
  review independently and reported it back (see the final section of this document). No further
  action needed from a future session on this point.

## Auto-remediated
- **Fixed my own test regression during task 2**: after making `httpRequest` send the Bearer header
  by default, the pre-existing `buildApp middleware > answers an unmatched route with JSON…` test
  (which drives the app with raw `fetch`, not `httpRequest`) started failing with 401 instead of
  404, because it never carried a header. Added the header to that one `fetch` call. Re-ran
  `npm test -w @soulbound/backend -- routes.test.ts` and confirmed all 23 tests in that file passed
  before moving on (AI-1: a fix is a claim).
- **Fixed my own editing slip while adding the follow-up tests**: an `Edit` call meant to insert new
  tests before the `OPTIONS /api/world-engine…` test accidentally wrapped that test (and the
  pre-existing "rate limiter (own app…)" describe below it) inside a new, bogus `describe(...)`
  block, and dropped the `async` keyword from the `OPTIONS` test's callback while its body still
  awaited a promise. Caught immediately by re-reading the diff (AI-2) rather than by a test failure
  (this was a syntax-level problem, so `tsc` would have caught it on the very next build regardless).
  Fixed by restoring the original flat structure — a plain top-level `it(...)` for the OPTIONS test,
  followed by the untouched `describe('rate limiter (own app, own clock…)')` as a sibling, not a
  child. Re-ran `npm run build -w @soulbound/backend` (clean) and the full suite (180/180) before
  moving on.

## Independent security review (orchestrator-run) and fixes

After this plan's original completion, the orchestrator ran a genuinely independent, read-only
Security Engineer agent against the diff (something this session could not do itself — see the
corrected Status note above). Its verdict: **PASS WITH FIXES**. Five findings, addressed below.
`.env.example` is outside this plan's `files_modified`; the orchestrator explicitly authorized the
one `TRUST_PROXY` comment edit to it. `backend/src/config.ts` and
`backend/src/__tests__/config.test.ts` are also outside the original `files_modified`, but the
orchestrator's fix instructions named specific edits to both, which is the authorization for
touching them in this follow-up.

1. **Rate limiter's `Map` never shrinks (`accessGate.ts:60-68` at review time).** Old entries were
   only replaced when the same key came back, so "pruned per window" wasn't true — forged
   `X-Forwarded-For` values or rotating addresses could grow the map without limit, with no
   authentication required to trigger it (the limiter runs before the gate). **Fixed:**
   `createRateLimiter` now sweeps every expired entry at most once per window (an in-closure
   `lastSweep` timestamp gates the sweep so it's not a per-request walk), and caps distinct tracked
   keys at `MAX_TRACKED_KEYS = 10_000` (justified in a comment: a self-hosted, passphrase-gated,
   single-tenant deployment has no legitimate reason to see anywhere near that many distinct real
   clients; at ~100 bytes/entry this bounds the limiter's own memory to a few MB regardless of
   attacker behavior). Once the cap is reached, a never-seen key is folded into one shared
   `OVERFLOW_KEY` bucket rather than getting a fresh entry — fails toward throttling (an overflowing
   caller now shares a tighter budget), never toward bypass. `createRateLimiter` also gained an
   optional `maxTrackedKeys` override (tests only) and a `__trackedKeyCount()` test hook on the
   returned handler. **Tests** (`routes.test.ts`, `describe('rate-limiter map growth…')`): drives
   1,000 distinct forced `req.ip` values through a real limiter instance, asserts
   `__trackedKeyCount()` reads 1000, advances the injected clock past the window, sends one more
   request, and asserts the count drops to 1; a second test uses a tiny `maxTrackedKeys: 2` override
   to prove the third and fourth never-seen keys share one overflow bucket (tracked-key count stays
   at 3, not 4).
2. **`express.json` mounted globally (`server.ts:213` at review time), so non-`/api` paths had their
   bodies parsed up to 512 KB with no passphrase check.** **Fixed:** changed to
   `app.use('/api', express.json({ limit: JSON_BODY_LIMIT }))`. Verified every router's own routes
   are already full `/api/...` paths (`grep` confirmed all three: `/api/unique-skill`,
   `/api/world-engine`, `/api/intro-scene`), so this is a pure scope narrowing with no route-path
   change needed, and the body-parser error mapping (`mapBodyParserError`) still applies unchanged
   since it runs in the same central error handler regardless of which middleware raised the error.
   **Test** (`routes.test.ts`): `POST /x` (a non-`/api` path) with a 1 MB body and no header now
   returns 404, not 413 — proving the parser never ran for that path at all.
3. **`TRUST_PROXY` unsafe without a real proxy (`config.ts:395-405` at review time).** Docker's
   published-port networking presents connections from the bridge gateway (a `172.x` address,
   classified "trusted" by `uniquelocal` or hop-count 1), but nothing in that path overwrites a
   client-supplied `X-Forwarded-For`, so a caller behind plain Docker port publishing could spoof a
   fresh IP — and a fresh rate-limit bucket — on every request. **Fixed (docs, not behaviour, per the
   instruction):** expanded `config.ts`'s `TRUST_PROXY` doc comment and rewrote `.env.example`'s
   `TRUST_PROXY` comment block to say explicitly: set it only when a real reverse proxy in front is
   known to overwrite (not append to) `X-Forwarded-For`; Docker port publishing is not such a proxy;
   prefer the smallest matching hop count over `uniquelocal` when you do set it.
4. **Spec test gaps** (Failure Modes: "unit test that `TRUST_PROXY` changes the key", plus several
   named edge cases). **Added** (`routes.test.ts`, unless noted):
   - `TRUST_PROXY=1` with different `X-Forwarded-For` values → separate buckets;
   - `TRUST_PROXY` unset with the same `X-Forwarded-For` variations → one shared bucket (both socket
     peers are 127.0.0.1 in-test, proving the header is ignored);
   - a whitespace-only Bearer token → 401;
   - a tab (not a space) between `Bearer` and the token → 401 (only a single space separates scheme
     from token, per `extractBearerToken`);
   - `HEAD` on a gated route with no header → 401 (contrasted with `HEAD /api/health`, which is
     exempt and returns 200);
   - a trailing slash on a gated route (`/api/unique-skill/`) with no header → 401, not a
     fallthrough;
   - `Retry-After` is exactly `60` at the very start of a window and `1` at 59.5s in (injected clock,
     exact assertions, not just "defined" or "≥1" as the earlier tests checked).
5. **Smaller fixes, all applied:**
   - `redact()` (`config.ts`) now determines which of the two secrets is longer and replaces that one
     first, so a (hypothetical, currently-impossible-by-validation) case where one secret is a
     substring of the other can't leave a fragment of the longer one behind. **Test**
     (`config.test.ts`): sets a key and a passphrase where the passphrase is a literal substring of
     the key, redacts a string containing the key, and asserts no fragment of either secret survives
     in the output.
   - `config.ts` now takes both `ANTHROPIC_API_KEY` and `SOULBOUND_PASSPHRASE` out of `process.env`
     (via a shared `takeEnv()` helper) *before* validating either, replacing the old
     read-delete-validate-per-secret shape where a key failure could leave the passphrase still
     sitting in `process.env` at the exact moment of the throw (and vice versa). **Tests**
     (`config.test.ts`, one in each of the `ANTHROPIC_API_KEY` and `SOULBOUND_PASSPHRASE` describe
     blocks): each asserts that when the OTHER secret is the one that's invalid, both env vars are
     still gone from `process.env` by the time the throw is caught.
   - `buildApp`'s default clock (`server.ts`) is now `() => performance.now()`, not `Date.now`.
     Checked first, per the instruction: the limiter only ever compares two readings of the clock to
     each other (`t - bucket.windowStart`), never against a wall-clock/epoch value, so nothing
     depends on `Date.now()`'s epoch semantics — a monotonic clock is strictly better here, since
     `Date.now()` can jump on an NTP correction or a manual clock change, which could silently reopen
     a spent window or freeze one open past 60 real seconds. No behavioral test added for this one
     specifically (there is nothing a `vitest` assertion can distinguish here beyond what the
     existing injected-clock tests already cover, since every test passes its own `now`), but it is
     exercised implicitly by `main()`'s "boots and returns a listening server" test in
     `server.test.ts`, which calls `buildApp` with no `now` override at all.

**Accepted, not fixed** (per the instruction):
- Failed-passphrase requests share a rate-limit bucket with real players — a guesser and a legitimate
  player behind the same `req.ip` (or, with `TRUST_PROXY` set, the same forwarded address) draw from
  one budget. This is a residual, documented risk of a per-IP fixed-window limiter with no separate
  per-credential tracking, and splitting them would need a second dimension to the bucket key (a
  larger change than this follow-up's scope).
- `/api/health` stays unlimited (and ungated) — required so the compose healthcheck, which sends no
  credentials, keeps working.

### Re-run mutation table (task 3's original four, plus two new mutations)

Each mutated on the committed tree (`9dd995c`), restored with `git checkout -- <file>`, confirmed
clean with `git diff --exit-code` before the next mutation. Nothing else wrote to the tree during
the sweep.

| # | Mutation | File | Result |
|---|---|---|---|
| 1 | Delete `app.use('/api', createAccessGate(checkPassphrase))` | `server.ts` | **RED** — 10 tests failed |
| 2 | Move `express.json` (now `app.use('/api', express.json(...))`) above the limiter/gate | `server.ts` | **RED** — 1 test failed (`access gate > a 1 MB unauthenticated body…` got 413 instead of 401) |
| 3 | Replace `timingSafeEqual(candidateDigest, realDigest)` with `candidate === soulboundPassphrase.reveal()` | `config.ts` | **SURVIVED** — all 180 tests stayed green, same reasoning as the original task-3 run: behaviourally equivalent for every functional assertion; the timing property is code-review-only, not mutation-testable |
| 4 | Drop the passphrase branch from `redact()` (key redaction only, reverting to the pre-fix single-`split` form) | `config.ts` | **RED** — 2 tests failed (the passphrase-leak route test, and 05-01's `redact()` test) |
| 5 (new) | Disable the sweep (`sweepExpired` becomes a no-op) | `accessGate.ts` | **RED** — 1 test failed (`rate-limiter map growth… > sweeps expired entries…`: tracked-key count stayed at 1000 instead of dropping to 1 after the window advanced) |
| 6 (new) | Mount `express.json` globally again (drop the `/api` scope) | `server.ts` | **RED** — 1 test failed (`a 1 MB body to a non-/api path…` got 413 instead of 404) |

5 of 6 mutations caught by a test; #3 is the same plan-anticipated "behaviourally equivalent" case
recorded in the original task-3 sweep, unchanged by this follow-up since `checkPassphrase` itself
was not touched.

### New counts

- Backend: **167 → 180** (+13): +10 in `routes.test.ts` (the non-`/api` body test, whitespace/tab
  token tests, `HEAD`, trailing-slash, exact `Retry-After` values, the two `TRUST_PROXY`-changes-the-
  key tests, and the two rate-limiter map-growth tests) and +3 in `config.test.ts` (the two
  delete-order tests and the `redact()` longer-secret-first test).
- Full workspace: `npm run build` clean across `shared`/`backend`/`frontend`;
  `npm test -w @soulbound/backend` → `Test Files 8 passed (8)`, `Tests 180 passed (180)`.

### Files touched in this follow-up (beyond the original plan's `files_modified`)
- `backend/src/config.ts` and `backend/src/__tests__/config.test.ts` — not in 05-02's original
  `files_modified`, but the orchestrator's fix instructions named specific edits to both; recorded
  here as the authorization for touching them.
- `.env.example` — explicitly authorized by the orchestrator for the one `TRUST_PROXY` comment edit.

### Commits
- `9dd995c` — `fix(backend): apply independent security review fixes to the access gate` (committed
  before the mutation re-run, per protocol).


## Review cycle 1 correction (orchestrator)
Two corrections from the phase review's QA reviewer, both re-derived before recording:
- "spec-anticipated" → **"plan-anticipated"** (2 occurrences). The allowance for a behaviourally
  equivalent survivor lives in `05-02-PLAN.md`, not in the spec. The spec's Acceptance Checks row is
  `Required: true` and names the variant "swap `timingSafeEqual` for `===` **on a length mismatch**".
- **That spec variant is caught.** Replacing the SHA-256-then-`timingSafeEqual` compare with
  `timingSafeEqual(Buffer.from(candidate), Buffer.from(real))` (no hashing, so buffers differ in length)
  turns **4** backend tests red (orchestrator re-run, restored clean):
  `rejects a candidate of a different length without throwing`, `rejects an empty candidate`,
  `the wrong passphrase returns 401 and never reaches the SDK`,
  `a burst past the limit gets 429 before the gate, and wrong-passphrase attempts count too`.
  The raw-string `===` swap still survives as a documented behavioural equivalent: its timing
  property is checked by code review only. The spec's required row is met by the length-mismatch
  variant.
