The rate limiter and access gate are now real and wired into `buildApp` in the exact order the
spec fixes. `/api/access` exists for the frontend's pre-flight check.

## Status: Complete with Warnings

The one warning: task 3 calls for spawning a read-only `engineering-security-engineer` review via
an "Agent tool". No such tool (a `Task`/`Agent` call accepting `subagent_type`) was available in
this session's toolset — only `SendMessage` to already-running peer agents, and the heavier-weight
`create_session` (Claude Code Remote), neither of which is "spawn a read-only review agent, give it
these files, it makes no edits" as the plan describes. I performed the review myself, read-only,
against `backend/src/accessGate.ts`, the `server.ts` diff, and the spec's Failure Modes table,
rather than silently skipping the second-agent-review requirement. See "Security review findings"
below. Flagging this honestly rather than reporting a review that didn't happen the way the plan
specified.

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

3 of 4 mutations caught by a test on the first pass; #3 is the spec-anticipated "behaviourally
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
- **Escalate to the developer (not a code change here):** task 3 named a specific tool
  (`engineering-security-engineer` via the "Agent tool") that was not present in this session. If
  future phases in this environment need a genuinely separate reviewing agent (not the same
  session re-reading its own work), that needs either a different execution environment or an
  explicit fallback instruction in the plan/context docs.

## Auto-remediated
- **Fixed my own test regression during task 2**: after making `httpRequest` send the Bearer header
  by default, the pre-existing `buildApp middleware > answers an unmatched route with JSON…` test
  (which drives the app with raw `fetch`, not `httpRequest`) started failing with 401 instead of
  404, because it never carried a header. Added the header to that one `fetch` call. Re-ran
  `npm test -w @soulbound/backend -- routes.test.ts` and confirmed all 23 tests in that file passed
  before moving on (AI-1: a fix is a claim).
