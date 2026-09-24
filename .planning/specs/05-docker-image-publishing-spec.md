# Spec: Phase 5 — Docker Image Publishing

## Overview

Publish one Docker image that a self-hosting deployer can pull and run, without turning their
Anthropic key into an open proxy for anyone who reaches the port. Three problems block this today,
all confirmed in source:

1. The frontend `runtime` stage can't be deployed. `serve -s` answers `/api/*` with 200 +
   `index.html` (`frontend/Dockerfile:51-69`, `docker-compose.yml:14-23`).
2. The backend has no access control. Only the loopback bind (`docker-compose.yml:63`) protects it.
3. There is no publish path. `ci.yml` only builds and tests, and every `package.json` is at `0.0.1`.

The architecture is the **Pragmatic proposal plus two elements from Clean**, chosen by the developer
on 2026-09-23 from three competing read-only proposals:
- **One image.** The backend serves the built frontend, so everything is same-origin and no proxy is
  needed.
- **From Clean:** the rate limit and passphrase gate run before body parsing, and the header is
  `Authorization: Bearer`.

The auth decision (option 2, a deployer-set access gate) is recorded in `.planning/STATE.md` → Next
Action 2. The fixed inputs are GHCR, a manual `workflow_dispatch` release, and a passphrase stored in
`localStorage`.

**This departs from STATE.md's earlier note** (Next Action 2, which recommended "a proxy that
forwards `/api`"). Serving the bundle from the backend keeps the same property that note was after,
same-origin with no CORS, without a proxy. The design-log entry names the departure.

**Not in scope:** multiplayer, user accounts, TLS termination, server-side saves, and any change to
the settled key architecture (the backend still holds `ANTHROPIC_API_KEY`). No change to game
behaviour. `App.tsx` stays byte-identical.

## Requirements

| ID | Description | Priority | Acceptance Criteria |
|----|-------------|----------|-------------------|
| R17 | **Access gate.** The backend refuses every `/api/*` request except `/api/health` unless it carries `Authorization: Bearer <SOULBOUND_PASSPHRASE>`. The passphrase is required at startup (fails closed), compared in constant time, and never appears in logs, error bodies or stack traces. | Must | Tests: a missing or wrong header gets 401 `PASSPHRASE_REQUIRED` before any route handler, the body parser or the SDK runs. The correct header reaches the route. `/api/health` works with no header. Startup exits non-zero when the passphrase is unset, under 12 characters, or contains anything outside printable ASCII (browsers can't send non-Latin-1 header values). The passphrase value never appears in captured `console.error` output or in any response body, including the 500 path. |
| R18 | **Rate limit.** A per-client fixed window on gated `/api/*` requests runs *before* the passphrase check (so it also throttles guessing) and before `express.json`. Over the limit returns 429 `TOO_MANY_REQUESTS` plus `Retry-After`. Default 30/min, configurable, with `TRUST_PROXY` opt-in only. | Must | Tests: request N+1 in a window gets 429 with a `Retry-After` integer and the code `TOO_MANY_REQUESTS`, which is distinct from the upstream `RATE_LIMITED`. The window resets under a fake clock. Wrong-passphrase attempts count against the limit. `/api/health` is never limited. An invalid `RATE_LIMIT_PER_MINUTE` or `TRUST_PROXY` makes startup exit non-zero. |
| R19 | **Frontend gate.** Before the title screen, a wrapper outside `App` checks access with `GET /api/access`. If the check returns 401 `PASSPHRASE_REQUIRED`, an inline form (not `window.prompt`) collects the passphrase and stores it in `localStorage` under `sbc-access-passphrase`. Every API call sends it as a Bearer header. A later 401 with that code clears it and shows the form again. | Must | `git diff --exit-code 7856b7d -- frontend/src/App.tsx` passes (unchanged; `7856b7d` is the recorded phase base, and `App.tsx` has not changed since `31cb162`). Tests cover: the form renders on a 401; any other outcome renders `App` (the UI fails open, and the backend still enforces); the header is present on all three fetchers; a 401 `PASSPHRASE_REQUIRED` clears the storage key and re-shows the form; a 401 `AUTHENTICATION_FAILED` does not clear it; the submitted value is trimmed; the form is a real `<form>` (Enter submits) with mobile-safe input attributes, a show/hide toggle, a hidden username field for password managers, and top alignment. The existing constraint guard (`constraints.test.ts`) still passes. e2e: the no-paid-call guard (`smoke.spec.ts:403-411`) is **narrowed, not removed**. `/api/access` is stubbed with `page.route` (204) in `beforeEach` and is the only path exempted; it costs nothing. Every other `/api/*` request still fails the test. One new e2e test stubs `/api/access` → 401 and asserts the form is visible, usable and fully on screen at 375×800 and 1280×800. A test renders `<AccessGate><App/></AccessGate>` in jsdom. |
| R20 | **Single deployable image.** When `STATIC_DIR` is set, the backend serves the built bundle, with an SPA fallback for GET on non-`/api` paths only. `/api/*` never returns HTML. The dead frontend `runtime` stage is removed. The fallback never answers a path with a file extension. `backend/Dockerfile` splits into an `api` stage (no bundle) and a final `runtime` stage that adds it; the dev compose backend builds `target: api`. Dev is otherwise unchanged: compose still runs the Vite `builder` stage with its proxy. | Must | Tests: with `STATIC_DIR` set, `GET /` and `GET /some/deep/link` return `index.html`; `GET /api/nope` and `POST /api/nope` return JSON 404; an asset returns its file. With `STATIC_DIR` unset, `GET /` returns JSON 404 (today's behaviour). Startup exits non-zero when `STATIC_DIR` is set but has no `index.html`. `SOULBOUND_PASSPHRASE=x docker compose config -q` passes (a bare run fails by design with `:?`) and dev compose still targets `builder`. |
| R21 | **Release pipeline.** `.github/workflows/release.yml`, triggered by `workflow_dispatch` only, runs the tests, smoke-tests the amd64 image, then pushes `ghcr.io/deanitservices/soulbound:{version}` and `:latest` for `linux/amd64,linux/arm64`. It refuses to overwrite an existing version tag and refuses if the workspace versions disagree. A CI job runs the same smoke script on every push. | Must | The smoke script `scripts/smoke-image.sh` passes locally against a freshly built image (evidence committed). `ci.yml` gains a `smoke-image` job. `release.yml` has `permissions: packages: write`, uses only `GITHUB_TOKEN`, and has no `push:` or `tags:` trigger. The first real publish is **UNTESTED** until someone dispatches it after merge (see Open Question 1). |
| R22 | **Self-host package and records.** `compose.selfhost.yml` uses `image:`, reads every host-specific value from `.env`, derives `ALLOWED_HOSTS` from the published port, and keeps the loopback default. The README gains a Self-hosting section. The decision goes into `docs/design-decisions-log.md`. CLAUDE.md's auth section gets a pointer to the gate. PROJECT.md gets R17-R22 and moves rate limiting out of Out of Scope. ROADMAP.md gets Phase 5. Versions are bumped to `0.1.0`. | Must | `docker compose -f compose.selfhost.yml config -q` passes with a sample `.env`. A local run on a **non-default** port serves the app and passes the gate end to end (evidence committed). A grep finds `SOULBOUND_PASSPHRASE` in `.env.example`, the README and both compose files. All four `package.json` files read `0.1.0`. |

## Architecture

```
browser ──GET /──────────────────────────────▶ express.static(STATIC_DIR)  (index.html, assets)
        ──GET /api/access  (Bearer) ─┐
        ──POST /api/*      (Bearer) ─┤
                                     ▼
 buildApp():  Host allow-list → CORS → [/api/health] → rateLimit(/api) → accessGate(/api)
              → express.json → routers → JSON 404 for /api/* → static + SPA fallback → error handler
```

### Key Decisions

| Decision | Choice | Rationale | Alternatives Considered |
|----------|--------|-----------|----------------------|
| Serving shape | The backend serves the bundle, one image | One container, one port, same-origin: no CORS change, no proxy config to test outside Vitest. The ordering that prevents `/api` from falling back to `index.html` is testable in `routes.test.ts`'s real-pipeline harness. | nginx two-image edge (Clean): better future fit for a world server, but that is out of scope, and every deployer pays a second container today |
| Middleware order | health → rateLimit → gate → `express.json` | A request without the passphrase is never parsed at up to 512 KB (`server.ts:85`). Rate-limiting before the gate throttles passphrase guessing. Health stays first because the compose healthcheck calls it with no credentials (`docker-compose.yml:77-81`). | Gate after the body parser (Pragmatic as proposed): parses attacker-supplied bodies first |
| Header | `Authorization: Bearer <passphrase>` | Already in `Access-Control-Allow-Headers` (`server.ts:165`), so CORS needs no change. It's the conventional slot if real tokens ever replace the passphrase. | `X-Soulbound-Passphrase`: needs a CORS change and is non-standard |
| Error codes | 401 `PASSPHRASE_REQUIRED`, 429 `TOO_MANY_REQUESTS` | **The status codes 401 and 429 are already used** for upstream Anthropic failures, `AUTHENTICATION_FAILED` and `RATE_LIMITED` (`anthropic.ts:255-266`). New codes let the frontend tell "wrong passphrase / slow down" apart from "the deployer's key is bad / Anthropic quota". It keys on code, never on status. | Reuse `UNAUTHORIZED` / `RATE_LIMITED`: would clear a correct passphrase when the deployer's Anthropic key is wrong |
| When the browser asks | **Before the title screen**, via `GET /api/access` | A 401 during character creation strands the player on the loading screen with no retry (`App.tsx:267-269`). Asking first means no paid call can hit the gate mid-flow. A 401 later still re-prompts (passphrase rotated). | Only on the first 401 (as first described): loses the creation in progress |
| Where the gate UI lives | `AccessGate` wraps `<App/>` in `main.tsx`; `App.tsx` unchanged | `App.tsx` is a statement-for-statement port whose header forbids reshaping its 16 `useState` (`App.tsx:1-80`). A wrapper adds zero deviations. `appIntegration.test.tsx` renders `App` directly, so it stays unaffected. | A 17th `useState` in `App`: a new verbatim-port deviation to record, and touches the most behaviour-sensitive file |
| UI when the check isn't a 401 | Fail **open** in the UI | The backend enforces regardless. Failing closed would lock out any dev run without the backend up (Vite's proxy returns 502 `text/plain`, which maps to `'unknown'`). | Fail closed: adds no security |
| e2e guard change | Stub `/api/access` and exempt exactly that path | **The e2e guard fails any test that requests `/api/*`** (`smoke.spec.ts:403-411`), so an unmodified suite is impossible once the gate checks on mount. Also, if a dev backend is up on :3001, Vite would proxy to it and the form would cover the title screen. A stub makes both cases deterministic. The guard's purpose (no *paid* call) survives: `/api/access` never reaches Anthropic. | Leave e2e unmodified: impossible; drop the guard: loses a real protection |
| Passphrase strength | Required, trimmed, ≥12 chars, printable ASCII only, fail-fast | Mirrors `readApiKey()` (`config.ts:61-87`). A weak or empty passphrase fails loudly at boot instead of silently protecting nothing. | Optional passphrase: an unset gate is exactly the open proxy this phase exists to close |
| Env var name | `SOULBOUND_PASSPHRASE`, the same name on host and container | Unlike `ANTHROPIC_API_KEY` (`docker-compose.yml:35-44`) there's no Claude Code collision, so no name mapping is needed | `ACCESS_PASSPHRASE`: a second naming scheme for no gain |
| Rate-limit store | In-process `Map`, fixed window, pruned per window | Single-tenant, single process. No dependency added (`backend/package.json` has only express, the SDK and shared). | `express-rate-limit`: a new dependency for ~40 lines; Redis: multi-instance, out of scope |
| Client IP | `req.ip ?? 'unknown'`; `TRUST_PROXY` opt-in with values `loopback`, `uniquelocal` or `1`-`5` | `trust proxy: true` lets any client spoof `X-Forwarded-For` and get unlimited buckets. Without `TRUST_PROXY`, a deployer behind their own reverse proxy shares one bucket, which is documented. | `true` accepted: spoofable |
| Release trigger | `workflow_dispatch` only; version from root `package.json` | Tag pushes fail from the agent environment (`STATE.md`, Known environment limits), so every step must work without tags | Tag push; publish on every push to main |
| Overwrite policy | The release fails if `:{version}` already exists in GHCR; **the check fails closed** | Published versions stay immutable. Mechanism: after `docker/login-action` (authenticated), run `docker buildx imagetools inspect ghcr.io/deanitservices/soulbound:{version}`. Exit 0 → exists → fail. Non-zero **and** stderr matches `not found\|manifest unknown\|name unknown` → absent → proceed. **Any other error → fail.** Anonymous GHCR answers `denied` for both "absent" and "private" (verified), so an unauthenticated or naive `if inspect` check would fail open and overwrite. | Always overwrite; unauthenticated check (fails open) |
| First published version | `0.1.0` in all four `package.json` files | `0.0.1` has meant "unreleased scaffold" since Phase 1. The first public image deserves a deliberate number. | Keep `0.0.1` |
| Smoke test | `scripts/smoke-image.sh` shared by `ci.yml` (every push) and `release.yml` (before push) | Retro AI-4: test durability mechanisms in the target environment before documenting them. The CI job proves the image on every branch push. Only the GHCR push itself is left untested until the first dispatch. | Release-only smoke: never runs until merge |

## API and Type Contracts

**Shared, `shared/src/accessGate.ts`, re-exported from `shared/src/index.ts`.** This is the single
source for strings both sides must match, following the save-key precedent (`gameState.ts:163-164`):
```ts
export const ACCESS_HEADER = 'Authorization';
export const ACCESS_SCHEME = 'Bearer';
export const ACCESS_STORAGE_KEY = 'sbc-access-passphrase';
export const PASSPHRASE_REQUIRED = 'PASSPHRASE_REQUIRED';
export const TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS';
export const ACCESS_CHECK_PATH = '/api/access';
export const MIN_PASSPHRASE_LENGTH = 12;
```

**Backend config (`backend/src/config.ts`).** New exports:
- `SOULBOUND_PASSPHRASE` is read once, trimmed, wrapped in the existing `Secret` class, and deleted
  from `process.env`, exactly like the key (`config.ts:61-87`). Exposed only through
  `checkPassphrase(candidate: string): boolean`: SHA-256 both sides, then `crypto.timingSafeEqual`.
- `redact()` strips **both** the key and the passphrase.
- `RATE_LIMIT_PER_MINUTE: number`: default 30, integer 1-600, otherwise startup fails.
- `TRUST_PROXY: false | 'loopback' | 'uniquelocal' | number`: default `false`; accepts integers 1-5,
  rejects `true` and anything else.
- `STATIC_DIR: string | undefined`: when set, it must be an absolute path containing `index.html`,
  otherwise startup fails.

**Backend app (`backend/src/server.ts`).** `AppConfig` gains
`checkPassphrase, RATE_LIMIT_PER_MINUTE, TRUST_PROXY, STATIC_DIR` plus an optional injectable
`now?: () => number` for tests.

**Middleware (`backend/src/accessGate.ts`)** exports:
```ts
createRateLimiter(opts: { perMinute: number; now: () => number }): RequestHandler
createAccessGate(check: (candidate: string) => boolean): RequestHandler
```

**HTTP responses** (same envelope as every existing error, `server.ts:154`, `:213-218`):
| Case | Status | Body | Headers |
|---|---|---|---|
| missing/wrong passphrase | 401 | `{"error":{"message":"Passphrase required","code":"PASSPHRASE_REQUIRED"}}` | `WWW-Authenticate: Bearer realm="soulbound"` |
| over limit | 429 | `{"error":{"message":"Too many requests — try again shortly","code":"TOO_MANY_REQUESTS"}}` | `Retry-After: <seconds, integer ≥1>` |
| `GET /api/access` authorized | 204 | (empty) | — |
| unmatched `/api/*` | 404 | unchanged `NOT_FOUND` JSON | — |

**Mounting rule:** every `/api` middleware (limiter, gate, the JSON 404) is mounted with
`app.use('/api', …)`, never gated by a hand-written `req.path.startsWith('/api')`. Express 5's
router matches `/API/x`, `/api/x/` and `/api/../api/x` as `/api` (verified by probe); a string
prefix check would send an authorised `GET /API/nope` past the JSON 404 into the SPA fallback,
which returns HTML. The SPA fallback likewise lives after `app.use('/api', notFound)`, so nothing
under the `/api` mount can reach it. `/api/health` is registered **before** the `/api` limiter and
gate.

**Rate-limit key:** `req.ip ?? 'unknown'`. A request with no resolvable IP shares one fixed bucket,
so it fails toward throttling, not toward bypass.

`OPTIONS` preflights are answered by the existing CORS middleware (`server.ts:166-169`) *before* the
gate, so preflights never need credentials.

**Frontend.**
- New `frontend/src/lib/passphrase.ts` exports `getPassphrase(): string | null`,
  `setPassphrase(p: string): void`, `clearPassphrase(): void` and
  `onPassphraseRequired(fn: () => void): () => void` (a subscribe/unsubscribe event). Every
  `localStorage` access is wrapped in try/catch, matching `saves.ts`.
- `lib/api.ts`: `postJson` adds `Authorization: Bearer <p>` when one is stored. On
  `!response.ok && code === PASSPHRASE_REQUIRED` it calls `clearPassphrase()`, notifies subscribers,
  then throws the usual `ApiClientError` (message `"Passphrase required"`), so `App`'s existing catch
  paths (`App.tsx:268`, `:303`) render it unchanged. New export
  `checkAccess(): Promise<'ok' | 'required' | 'unknown'>`, where `'unknown'` means any non-401
  outcome, including a network error.
- New `frontend/src/components/AccessGate.tsx`: `<AccessGate>{children}</AccessGate>`. It calls
  `checkAccess()` on mount, renders `children` on `ok` or `unknown`, and renders an inline form
  (password input plus submit, styled with the same inline-style vocabulary as `TitleScreen`) on
  `required`. On submit it stores the passphrase and re-checks. It subscribes to
  `onPassphraseRequired` so it shows the form again after a mid-session 401, keeping `children`
  mounted underneath so game state survives.
- `main.tsx`: `<AccessGate><App/></AccessGate>`. Under `StrictMode`, dev builds run the mount
  effect twice, so there are two `/api/access` calls per dev page load. Both count against the
  limit. That's harmless at 30/min, and production builds make one call.

**Backward compatibility.**
- Existing saves are untouched: a different key, and `saves.ts` reads only through
  `SAVE_INDEX_KEY`/`SAVE_PREFIX` (`gameState.ts:163-164`).
- Existing dev `.env` files need one new line. This is a deliberate breaking change for dev, named in
  the README and `.env.example`.

## File Placement

| Artifact | Path | Placement Rationale | Existing Pattern |
|----------|------|---------------------|------------------|
| Shared gate constants | `shared/src/accessGate.ts` | Strings both sides must match; `shared` is the contract home | `SAVE_INDEX_KEY` in `shared/src/gameState.ts` |
| Rate limiter + gate middleware | `backend/src/accessGate.ts` | Flat `backend/src/` layout; no `middleware/` dir exists | `backend/src/untrustedText.ts` (a single-concern module) |
| Backend tests | `backend/src/__tests__/accessGate.test.ts` (new), `routes.test.ts`, `server.test.ts`, `config.test.ts` (modified) | Pipeline-level tests go through `buildApp` | `routes.test.ts:55-58` |
| Passphrase store | `frontend/src/lib/passphrase.ts` | `lib/` is the IO layer | `frontend/src/lib/saves.ts` |
| Gate UI | `frontend/src/components/AccessGate.tsx` | Presentational wrapper | `frontend/src/components/*` |
| Smoke script | `scripts/smoke-image.sh` | Shared by two workflows; repo-root tooling | none yet — the first `scripts/` file |
| Release workflow | `.github/workflows/release.yml` | Beside `ci.yml` | `.github/workflows/ci.yml` |
| Consumer compose | `compose.selfhost.yml` (repo root) | Deployers download one file; it sits beside the dev `docker-compose.yml` | `docker-compose.yml` |

## Data and Control Flow

1. **Boot.** `main()` → `import('./config.js')` validates the key, the passphrase, the rate limit,
   `TRUST_PROXY` and `STATIC_DIR`, and on any failure prints one scrubbed line and exits 1
   (`server.ts:243-248`). Then `assertWorldVoiceContract` runs, then `buildApp(config)`, then
   `listen`.
2. **Page load.** `GET /` passes the Host check and CORS, skips the `/api` middleware, and gets
   `index.html` from static. `main.tsx` mounts `AccessGate`, which calls `GET /api/access`.
3. **Access check.** Host check → CORS → rateLimit → gate → the `/api/access` handler returns 204,
   so the UI renders `App`. With no or a wrong passphrase: 401 `PASSPHRASE_REQUIRED` → the form →
   `setPassphrase` → re-check.
4. **Gameplay call.** `postJson` sends the Bearer header → rateLimit → gate → `express.json` →
   route → `callWorldVoice` → SDK. The response and error paths are unchanged.
5. **Rotation mid-session.** The deployer changes `.env` and restarts. The next call gets 401
   `PASSPHRASE_REQUIRED`. `api.ts` clears storage and emits the event. `App` shows its existing error
   line, `AccessGate` overlays the form, the player re-enters, and retries the action.
6. **Release.** Dispatch → test job (`npm ci`, build, test) → smoke job (build amd64 → run →
   `smoke-image.sh`) → publish job: check the four versions agree, check `:{version}` doesn't exist,
   then build and push both architectures with tags `{version}` and `latest`.

## Compatibility Constraints

- **The CLAUDE.md hard constraints all hold.**
  - #1: an inline form, never `window.prompt`. `constraints.test.ts` enforces it.
  - #2: `localStorage` only, nothing like `window.storage`.
  - #3: the gate form has no scroll region. If one is added, `minHeight: 0` rules apply.
  - #4, #5, #6, #7, #8: untouched. No prompt, contract, `max_tokens` or `system`-param change.
- **The settled auth architecture is unchanged.** The passphrase is issued by the deployer and never
  reaches Anthropic. This is not the rejected paste-per-session BYOK: the player never holds an
  Anthropic key. The design-log entry says so explicitly.
- **Standing rule** (`STATE.md`, "Carry into Phase 3/4 planning"): no middleware in `server.ts`
  without a test asserting what it emits. Each new middleware gets header- and body-level assertions.
- **The model split and cache invariant are untouched.** `config.test.ts`'s pair test must stay green.
- **The e2e suite** (`frontend/e2e/smoke.spec.ts`) gets exactly one sanctioned change, the stub
  plus narrowed exemption above, and one new test. The 5 existing geometry tests keep their
  assertions byte-for-byte.
- **CI has no key or passphrase** (`ci.yml` comment). Unit tests set fake values in-process, the same
  pattern as `FAKE_KEY` (`routes.test.ts:44-49`).
- **Never rebase the branch.** `3d01fa5` recovery handle, `STATE.md`.

## Failure Modes

| Failure Mode | Expected Behavior | Verification |
|--------------|-------------------|--------------|
| `SOULBOUND_PASSPHRASE` unset or empty | Startup exits 1 with an actionable message naming the variable and `.env.example`; the port is never bound | `server.test.ts` via the `main()` harness |
| Passphrase under 12 characters | Startup exits 1, the message states the minimum and does not echo the value | `config.test.ts` |
| Wrong or missing Bearer header | 401 `PASSPHRASE_REQUIRED`; no body parse; the SDK spy is never called | `routes.test.ts` asserts `create` not called |
| Passphrase echoed by an error path | Replaced with `[REDACTED]` in logs and bodies | Test: throw an error containing the passphrase from a route and assert neither log nor body contains it |
| Upstream Anthropic 401 | `AUTHENTICATION_FAILED` as today; the frontend does **not** clear the stored passphrase | `api.test.ts` |
| Rate limit exceeded | 429 `TOO_MANY_REQUESTS` + `Retry-After`; reached before the gate | `accessGate.test.ts` with an injected clock |
| Deployer behind a reverse proxy with no `TRUST_PROXY` | Everyone shares one bucket (degraded, documented) | README note; unit test that `TRUST_PROXY` changes the key |
| LAN players via the dev compose | All arrive from the Vite container's IP, so they share one bucket | README LAN section says so; `RATE_LIMIT_PER_MINUTE` is the knob |
| Mixed-case or dot-segment `/api` path (`/API/x`, `/api/../api/x`) | Gated, and a JSON 404 if unmatched; never the SPA shell | `routes.test.ts` static-mode cases include `GET /API/nope` with a valid passphrase → JSON 404 |
| `trust proxy` changes Host handling | It does not: the allow-list reads raw `req.headers.host` (`server.ts:153`), not `req.hostname`. Keep it that way. | A test sets `TRUST_PROXY=1` and asserts a rebound Host still gets 403 |
| `TRUST_PROXY=true` | Startup exits 1: spoofable | `config.test.ts` |
| `STATIC_DIR` set but no `index.html` | Startup exits 1 | `config.test.ts` |
| `/api/unknown` in static mode | JSON 404, never HTML | `routes.test.ts` (the exact trap from `docker-compose.yml:14-23`) |
| Host not in `ALLOWED_HOSTS` (self-host on a custom port or LAN name) | 403 `FORBIDDEN` (existing) — the most likely support issue | `compose.selfhost.yml` derives the defaults from `SOULBOUND_PORT`; a local smoke on a non-default port proves it |
| Release dispatched with a version already published | The publish job fails before building, naming the tag | `release.yml` step; exercised by the first real dispatch (UNTESTED until then) |
| Existence check errors in an unexpected way (for example GHCR's answer for a brand-new package under `GITHUB_TOKEN` differs from the expected strings; UNVERIFIED) | Fails closed: the dispatch fails with the raw stderr and publishes nothing. The worst case is a first dispatch that needs the match pattern widened, never an overwrite | The first dispatch; the result is recorded in STATE.md |
| Workspace versions disagree | The publish job fails | Script step in `release.yml`; mirrored as a local command in the plan's verification |
| `localStorage` unavailable (private mode, blocked) | `getPassphrase` returns null, `setPassphrase` does nothing; the form reappears every load, and nothing throws | `passphrase.test.ts` with a throwing storage stub |
| Backend down on page load | `checkAccess` → `'unknown'` → `App` renders; the first real call shows the existing `NETWORK_ERROR` message | `AccessGate` test |
| arm64 build breaks or is slow under QEMU | The publish job fails; nothing is pushed (single multi-platform push). Risk reduced: the frontend builds on `$BUILDPLATFORM`, so only the backend's `npm ci --omit=dev` and `tsc` run emulated. The lockfile has the arm64 rolldown binding (`package-lock.json:475`). | The first dispatch; the local sandbox can't build arm64 without QEMU/binfmt |

## Acceptance Checks

| Check | Command or Evidence | Required |
|-------|---------------------|----------|
| Unit suites green | `npm run build && npm test` (the backend and frontend counts both rise; report the new counts derived, not restated) | true |
| Typecheck clean, three workspaces | `npm run build` | true |
| e2e green | `cd frontend && npm run test:e2e` → 6 passed (5 existing + 1 gate test); `git diff` on `smoke.spec.ts` touches only the `beforeEach`/`afterEach` guard block and the new test | true |
| `App.tsx` byte-identical | `git diff --exit-code 7856b7d -- frontend/src/App.tsx` (the phase-base commit) | true |
| No `/api` fallback to HTML | `routes.test.ts` static-mode cases | true |
| Local image smoke | `docker build -f backend/Dockerfile -t soulbound:smoke . && scripts/smoke-image.sh soulbound:smoke` → all checks PASS; output committed under `.planning/phases/05-docker-image-publishing/evidence/` | true |
| Self-host compose on a non-default port | `SOULBOUND_PORT=3999 docker compose -f compose.selfhost.yml up -d` with a locally tagged image, then a curl sequence (health 200, `/` HTML, `/api/access` 401 → 204 with the header, `/api/x` JSON 404); evidence committed | true |
| Compose files parse | `SOULBOUND_PASSPHRASE=placeholder-passphrase docker compose config -q && docker compose -f compose.selfhost.yml --env-file .planning/phases/05-docker-image-publishing/evidence/sample.env config -q`. The dev compose uses `${SOULBOUND_PASSPHRASE:?}`, so a bare `config -q` with the variable unset **fails by design** (verified) | true |
| Versions agree at 0.1.0 | `node -e` comparing the four `package.json` versions | true |
| Mutation checks on the gate | Delete the gate mount, move it after `express.json`, swap `timingSafeEqual` for `===` on a length mismatch, remove `redact` of the passphrase → each must turn at least one test red (run serially, restore after; retro AI-1/AI-5) | true |
| GHCR publish | The first `workflow_dispatch` after merge produces both tags for two platforms | false (UNTESTED here) |

## Deliverables

### Shared gate contract
- **Path:** `shared/src/accessGate.ts` (new), `shared/src/index.ts` (modified)
- **Purpose:** the single source for the header, codes, storage key and path
- **Dependencies:** none · **Size:** ~20 lines

### Backend config
- **Path:** `backend/src/config.ts`, `backend/src/__tests__/config.test.ts`
- **Purpose:** passphrase `Secret` + `checkPassphrase` + extended `redact`, plus `RATE_LIMIT_PER_MINUTE`,
  `TRUST_PROXY` and `STATIC_DIR`, each fail-fast
- **Dependencies:** shared contract · **Size:** +~90 lines, tests +~120

### Gate middleware and pipeline wiring
- **Path:** `backend/src/accessGate.ts` (new), `backend/src/server.ts`,
  `backend/src/__tests__/accessGate.test.ts` (new), `routes.test.ts`, `server.test.ts`
- **Purpose:** rate limiter, gate and the `/api/access` route mounted in the documented order;
  `trust proxy` applied from config
- **Dependencies:** backend config · **Size:** ~80 + ~40 lines, tests ~250

### Static serving
- **Path:** `backend/src/server.ts`, `routes.test.ts` (static-mode cases using a temp dir fixture)
- **Purpose:** `express.static(STATIC_DIR)` plus an SPA fallback, after the `/api` JSON 404
- **Dependencies:** gate wiring (same file, serial) · **Size:** ~25 lines, tests ~80

### Frontend gate
- **Path:** `frontend/src/lib/passphrase.ts` (new), `frontend/src/lib/api.ts`,
  `frontend/src/components/AccessGate.tsx` (new), `frontend/src/main.tsx`, tests in
  `lib/__tests__/` and `components/__tests__/`
- **Purpose:** R19
- **Dependencies:** shared contract; the backend is not required (tests mock `fetch`) · **Size:**
  ~40 + ~30 + ~110 lines, tests ~200

### Image and dev wiring
- **Path:** `backend/Dockerfile`. It adds a stage `FROM --platform=$BUILDPLATFORM node:22-slim AS
  frontend-build`, which copies the root, `shared` **and `frontend`** manifests before `npm ci`.
  Today's builder copies only root, shared and backend (`backend/Dockerfile:11-13`), so vite and
  react would never be installed. That stage builds `shared` then `frontend`. The bundle is identical
  on every architecture, so building it on the build platform keeps it out of QEMU entirely. Runtime
  gets `COPY --from=frontend-build /app/frontend/dist /app/public` and
  `ENV STATIC_DIR=/app/public`. The per-arch builder and runtime keep their current manifests. The
  same `npm_ca` secret mount is used in the new stage. `frontend/Dockerfile` (deletes the `runtime` stage — `builder` stays
  for dev compose), `docker-compose.yml` (passes `SOULBOUND_PASSPHRASE` through with `:?`, header
  comment rewritten), `.env.example`
- **Dependencies:** static serving, config · **Size:** ~40 lines changed

### Smoke script, CI job, release workflow
- **Path:** `scripts/smoke-image.sh` (new), `.github/workflows/ci.yml` (adds a `smoke-image` job),
  `.github/workflows/release.yml` (new)
- **Key content:** the smoke script runs the image with a throwaway passphrase and a bogus key on an
  ephemeral port, waits for health, then asserts the following. It makes zero Anthropic calls.

  | Request | Expected result |
  |---|---|
  | `/api/health` | 200 |
  | `/` | 200 with `text/html` |
  | `/api/access` without a header | 401 `PASSPHRASE_REQUIRED` |
  | `/api/access` with the header | 204 |
  | `/api/x` | 404 JSON |
  | burst over `RATE_LIMIT_PER_MINUTE=3` | 429 `TOO_MANY_REQUESTS` |
  | container logs | do not contain the passphrase |

  Release: dispatch → test → smoke → publish (QEMU, buildx, GHCR login, version checks,
  `docker/build-push-action` with both platforms, OCI labels for source, revision and version).
- **Dependencies:** image · **Size:** ~80 + ~20 + ~90 lines

### Self-host package and records
- **Path:** `compose.selfhost.yml` (new). It must carry the dev compose's hardening:
  `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges:true` (`docker-compose.yml:68-72`).
  Static serving only reads, so read-only root works. It also keeps the node `fetch` healthcheck.
  `README.md` gets:
  - a new **Self-hosting** section, including the plain `docker run` case: `-p X:3001` needs
    `ALLOWED_HOSTS=localhost:X,...`, because the default comes from the in-container `PORT` and every
    request would otherwise get 403;
  - a **rewrite of "Expose the frontend on your LAN"** (`README.md:50-99`). "Nothing else needs
    changing" (`:73`) and "The backend has no authentication" (`:95`) both become false. The section
    must say the passphrase now gates every `/api` call, that LAN players share one rate-limit bucket
    (they all arrive via the Vite container), and that it's still plain HTTP.

  Also: `docs/design-decisions-log.md`, `CLAUDE.md`
  (auth section: one paragraph pointing at the gate, stating it's access control on the proxy and not
  a re-opening), `.planning/PROJECT.md` (R17-R22; move "rate limiting" out of Out of Scope with a
  pointer), `.planning/ROADMAP.md` (Phase 5), four `package.json` files → `0.1.0`
- **Dependencies:** everything above (the docs describe what shipped) · **Size:** ~60 + ~80 + ~40
  lines

## Path Validation

**Status:** all paths are valid against `.planning/config/directory-mappings.yaml`. New top-level
entries (`scripts/`, `compose.selfhost.yml`) have no mapping category; they're repo tooling, like the
existing root `docker-compose.yml`.

| Deliverable | Path | Category | Valid | Notes |
|-------------|------|----------|-------|-------|
| Shared contract | `shared/src/accessGate.ts` | contract | yes | touch_with_care, per mapping |
| Middleware | `backend/src/accessGate.ts` | backend | yes | |
| Passphrase store | `frontend/src/lib/passphrase.ts` | frontend-io | yes | |
| Gate UI | `frontend/src/components/AccessGate.tsx` | frontend-components | yes | first component that reaches storage (through `lib/`); the mapping says components "reach neither storage nor the API", which is true only if `AccessGate` calls `lib/` functions, never `localStorage` or `fetch` directly |
| Smoke script | `scripts/smoke-image.sh` | general | yes | new directory |

## Open Questions

| # | Question | Impact | Default Chosen by Spec | Planning Effect |
|---|----------|--------|------------------------|-----------------|
| 1 | Who dispatches the first release, and when? `workflow_dispatch` only appears once `release.yml` is on the default branch, so it can't run from this branch before merge. | Non-blocking | The phase ships with R21's publish step marked **UNTESTED**. After merge, the developer (or a session using the GitHub MCP `actions_run_trigger`) dispatches it once, and the result is recorded in STATE.md. Everything except the GHCR push is proven earlier by the CI `smoke-image` job on branch pushes. | Plan for it; don't block on it |
| 2 | Should the GHCR package be public? Visibility is a package setting, not something the workflow sets. | Non-blocking | The README says the package defaults to private on first push and tells the developer where to make it public. The workflow doesn't try to change visibility. | Docs only |
| 3 | Rate limit default: 30/min per IP. A normal turn is 1 call, creation is 2, plus 1 access check per page load. | Non-blocking | 30/min, overridable by `RATE_LIMIT_PER_MINUTE` (1-600). Evidence: human-paced play makes roughly 1-3 calls/min. | Use default |

## Complexity Assessment

**Rating:** Complex

| Metric | Value |
|--------|-------|
| Requirements | 6 (R17-R22) |
| Deliverables | 8 groups, 27 files: new 11, modify 16 (incl. 4 `package.json` version bumps and 3 planning docs) |
| Estimated waves | 6 (serial, per retro AI-5: tree-mutating agents run one at a time) |
| Estimated plans | 6 |
| Competing proposals | Already run (three proposals; developer chose Pragmatic + 2 from Clean) |

Dependency layers (derived from the Deliverables' "Dependencies" lines):
shared contract + config (1) → gate wiring (2) → frontend gate (3; needs only the shared contract,
but serialized behind 2 because both agents mutate the tree) → static serving + image (4) → smoke,
CI, release (5) → self-host package, docs and records, plus cross-plan re-verification (6).

**Critique-stage checklist (machine-checkable, PASS/FAIL):**
| # | Check | Result |
|---|---|---|
| 1 | Every requirement R17-R22 has at least one deliverable and one acceptance check | PASS |
| 2 | No Blocking open question remains | PASS (3 questions, all Non-blocking, each with a default) |
| 3 | Every critique BLOCKER/MAJOR finding has a Revision History row | PASS (#1-#5 → rows 1-5) |
| 4 | Every file:line citation re-verified after revision | PASS (critique #10 corrections applied; the rest were confirmed by the critic) |
| 5 | Every deliverable path validated against directory mappings | PASS (see Path Validation) |

**Rationale:** six requirements across backend, frontend, image, CI and docs, with one irreversible
external step (the GHCR publish) and two security properties (fail-closed gate, secret never logged)
that need mutation-verified tests.

**Recommended next step:** decompose into plans (`/legion:plan 5`, resuming at step 4).

## Revision History
| # | Section | Change | Reason |
|---|---------|--------|--------|
| 1 | R19, Key Decisions, Compat, Acceptance | "e2e unmodified" → stub `/api/access` + narrowed guard + 1 new gate e2e test + jsdom wrapper test | Critique #1 (BLOCKER): `smoke.spec.ts:403-411` fails any `/api/*` request |
| 2 | Key Decisions, Failure Modes | Overwrite check specified: authenticated `imagetools inspect`, explicit absent-strings, fail closed otherwise | Critique #2: anonymous GHCR answers `denied` for absent and private alike |
| 3 | Deliverables (Image), Failure Modes | `$BUILDPLATFORM` frontend-build stage that copies the frontend manifest | Critique #3: `backend/Dockerfile:11-13` omits it; keeps the bundle out of QEMU |
| 4 | Deliverables (Self-host) | README LAN section rewrite added | Critique #4: `README.md:73,95` become false |
| 5 | R20, Acceptance | Compose parse checks set the passphrase inline / use a sample env file | Critique #5: `:?` makes a bare `config -q` fail |
| 6 | API contracts, Failure Modes | Mount-path rule for every `/api` middleware; mixed-case/dot-segment cases tested | Critique #6: Express probe |
| 7 | API contracts, Key Decisions | `req.ip ?? 'unknown'` fixed fallback bucket | Critique #7 |
| 8 | API contracts, R19 | StrictMode double call documented; wrapper render test required | Critique #8 |
| 9 | Deliverables (Self-host) | Hardening parity required; plain `docker run` + `ALLOWED_HOSTS` documented | Critique #9 |
| 10 | Various | Four line citations corrected | Critique #10 |
| 11 | R19 | Base ref unified on `7856b7d` | Critique #11 |
| 12 | Overview | Departure from STATE's proxy recommendation named | Critique #12 |
| 13 | Failure Modes | `trust proxy` / Host allow-list independence pinned by a test | Critique's "checked, no problem": keep it true on purpose |
| 14 | R17, Key Decisions | Passphrase must be printable ASCII | Plan critique (assumptions #1): `fetch` refuses non-Latin-1 header values, so the UI would open and every call fail silently |
| 15 | R19 | Trim on submit; real `<form>`; mobile input attributes; show toggle; hidden username field; top alignment | Plan critique (assumptions #2, #5, #6) |
| 16 | R20 | `api` / `runtime` stage split; dev compose targets `api` | Plan critique (assumptions #7): dev would otherwise build and serve a stale bundle on :3001 |
| 17 | R20 | No SPA fallback for paths with a file extension | Plan critique (pre-mortem #10): a stale chunk would get HTML and blank the page after an upgrade |
| 18 | Deliverables (Self-host) | `compose.selfhost.yml` keeps the `SOULBOUND_ANTHROPIC_KEY` → `ANTHROPIC_API_KEY` fallback | Plan critique (assumptions #8): `.env.example` promises either name works |
| 19 | Deliverables (Smoke) | The smoke script runs every check, then exits non-zero if any failed | Plan critique (assumptions #4): stop-at-first-failure made the negative run unable to show the passphrase check failing |
| 20 | Key Decisions (Overwrite) | The existence check is written to survive Actions' `bash -e` | Plan critique (pre-mortem #4): a bare `out=$(…)` exits before the match, so every dispatch would fail |
