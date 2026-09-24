# Spec: Phase 6 — Hosted Mode & Accounts

## Overview
Phase 6 turns the Phase 5 single-tenant image into a **two-mode** app.
- **`SOULBOUND_MODE=selfhost`** (the default) must behave **exactly** as Phase 5 shipped: the same passphrase gate, the same error messages, all 377 tests and smoke 7/7 unchanged.
- **`SOULBOUND_MODE=hosted`** swaps the passphrase for player accounts: Better Auth on Postgres, with email magic link through Resend, Google and Discord. It adds invite-only sign-up, account deletion with a 7-day grace period, anti-framing headers, a redacted error tracker, and a live deployment on Render.

This is the first of eight phases (6-13) from `.planning/explorations/2026-09-24-hosted-multiplayer-saas-design.md`. Phases 7-11 build on the Postgres pool, the migration system, the session gate and the middleware order set here. The Stripe webhook slot (Phase 11) is reserved in the tested order now.

**Architecture:** Pragmatic, plus two ideas from Clean (chosen 2026-09-24 from three read-only proposals):
- a hosted branch inside `buildApp()`;
- `node-pg-migrate` with SQL files;
- a runtime `ModeGate` in the frontend;
- developer runbooks, each ending with a check the agent runs;
- from Clean: a `withTestDb()` helper and a reserved webhook slot.

## Requirements
| ID | Description | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| R23 | Mode switch | Must | `SOULBOUND_MODE` unset/`selfhost` → Phase 5 behaviour byte-for-byte (377 tests + smoke 7/7 unchanged; every existing config error message unchanged). `hosted` without `DATABASE_URL`, `BETTER_AUTH_SECRET` or `RESEND_API_KEY` exits non-zero with a named-variable message. `hosted` **with** `SOULBOUND_PASSPHRASE` set also exits with a clear message. Any other `SOULBOUND_MODE` value exits naming the allowed values |
| R24a | Sign-in | Must | Magic link (Resend), Google and Discord all complete sign-in on the live host. Sessions: `expiresIn` 2 592 000 s, `updateAge` 86 400 s, cookie flags `HttpOnly; Secure; SameSite=Lax` (asserted from a real Set-Cookie header in tests) |
| R24b | Origin/CSRF | Must | Every non-GET/HEAD/OPTIONS `/api/*` request in hosted mode with a missing or foreign `Origin` gets 403 `ORIGIN_REJECTED`. Tested per route, including `/api/auth/*` POSTs and `DELETE /api/account` |
| R24c | Invite-only | Must | A new account (any method) can only be created with a valid, unexpired, unused invite. Two concurrent sign-ups with the same code produce exactly one account (race test). Codes are stored as SHA-256 hashes only |
| R24d | Account deletion | Must | `DELETE /api/account`: inline confirm in the UI (no native dialog); all sessions revoked at once; account hidden (the session gate treats it as signed out). Signing in within 7 days cancels the deletion. After 7 days the purge job hard-deletes the user and cascades. Tested with an injected clock |
| R24e | Anti-framing | Must | Hosted responses carry `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`. Self-host responses are unchanged (asserted absent) |
| R25a | Render deploy | Must | `render.yaml` Blueprint: Docker web service (last stage `runtime`), Postgres 16, `preDeployCommand` running migrations, `healthCheckPath: /api/health`, secrets as `sync: false`. `scripts/verify-hosted.sh <url>` passes against the live URL |
| R25b | Error tracker | Must | Off unless `SENTRY_DSN` is set. A test sends an event built from an error containing the API key, `BETTER_AUTH_SECRET`, a session cookie, an invite code and player text. The captured payload contains none of them. `dataCollection` is fully disabled |
| R25c | Ops baseline | Must | Anthropic Console workspace spend limit set and uptime monitor alerting (developer attests, with screenshots in `evidence/`) |

## Architecture
Two modes behind one entrypoint:
1. `config.ts` reads `SOULBOUND_MODE` **first**, then takes and validates the secrets that mode needs.
2. `buildApp(config)` keeps its signature. A new optional `config.hosted` (`HostedDeps`) switches on the hosted branch.
3. With `hosted` absent, every line of the current selfhost path runs unchanged. Existing tests never set it.

### Hosted middleware order
This is the security model; each position is pinned by a test that fails when it moves.
1. `trust proxy` (from `TRUST_PROXY`; Render starts at `1`, confirmed empirically — see Failure Modes)
2. Host allow-list — must include the `onrender.com` hostname (Render's health check sends it)
3. **Anti-framing headers** (hosted only)
4. CORS (unchanged; hosted is same-origin)
5. `GET /api/health`
6. Per-IP rate limiter (existing)
7. **Origin check** on non-GET/HEAD/OPTIONS `/api/*`
8. **Reserved:** `POST /api/billing/webhook` with `express.raw` — Phase 11. An empty slot now, but it is named in the order test
9. **`app.all('/api/auth/*splat', invite-context wrapper → toNodeHandler(auth))`** — must be before `express.json` (Better Auth issue #3295: it hangs otherwise)
10. **Session gate** — replaces `createAccessGate` (server.ts:248) in hosted mode. Returns 401 `SIGN_IN_REQUIRED` for a missing session or one whose user has a pending deletion. `/api/invites/redeem` and `/api/auth/*` are exempt
11. `express.json` scoped to `/api` (server.ts:259, unchanged)
12. `GET /api/access` (204 when signed in), `POST /api/invites/redeem`, `DELETE /api/account`
13. The three game routers, then `/api` 404, static, global 404, error handler (unchanged; the error handler also reports to the tracker when enabled)

### Key Decisions
| Decision | Choice | Rationale | Alternatives Considered |
|----------|--------|-----------|------------------------|
| Mode branching | Optional `config.hosted` inside the existing `buildApp` | Selfhost path provably untouched; existing test configs compile unchanged (routes.test.ts builds `AppConfig` literals) | Per-mode assemblers (Clean): more structure, bigger `server.ts` diff |
| DB access | `pg` Pool, shared by Better Auth (its built-in Kysely adapter accepts a Pool) and our code | One pool; no ORM; Phases 7-11 need atomic `UPDATE … RETURNING` and `ON CONFLICT`, which plain SQL expresses directly | Kysely/Drizzle: another concept for ~6 queries |
| Migrations | `node-pg-migrate` 9 (ESM, Node ≥20.11), plain `.sql` files in `backend/migrations/`. Better Auth's schema is committed as migration 001, generated once with `npx auth@latest generate` | One migration history; advisory lock by default; `.sql` supported (verified in the 9.0.0 source) | Better Auth's own `migrate` (Kysely-only, a second history); a hand-rolled runner |
| When migrations run | Render `preDeployCommand: node backend/dist/migrate.js` (paid plans; Starter qualifies). At boot, the hosted app **checks** for pending migrations and exits if any, rather than applying them | A failed migration fails the deploy while the previous deploy keeps serving. The boot check catches a manual run that skipped the pre-deploy | Migrate at boot under a lock: couples app start to schema change |
| Invite carrier | `POST /api/invites/redeem {code}` checks the code and sets a signed, HttpOnly, SameSite=Lax, 15-minute `sb_invite` cookie. An `AsyncLocalStorage` wrapper around the Better Auth handler exposes that cookie to `databaseHooks.user.create.before` | A databaseHook's `ctx` request fields are **not documented**, and for OAuth the request body is gone by the callback. We mount the handler, so wrapping it is under our control | Community invite plugins (unaudited deps); `hooks.before` (can't tell sign-up from sign-in) |
| Invite atomicity | `before` hook: `UPDATE invites SET reserved_until = now() + '10 min' WHERE code_hash = $1 AND used_at IS NULL AND (reserved_until IS NULL OR reserved_until < now()) RETURNING id` — no row means throw `APIError` (aborts). `after` hook: `SET used_by = $user, used_at = now()` | Better Auth hook transactionality is **not documented**, and a raw `pg` query won't join its transaction. A reservation is single-winner under concurrency, and if the user insert fails it simply expires, so no code is burned | A plain consume in `before` (burns the code on a failed insert); Better Auth's `transaction: true` (undocumented for Kysely) |
| Deletion grace | Our own `account_deletions(user_id PK → user ON DELETE CASCADE, requested_at)` table. `session.create.after` clears it (sign-in cancels deletion). Purge job hard-deletes the user; the FK cascade removes sessions, accounts and our rows | Better Auth's `deleteUser` is an immediate hard delete with no grace period (docs); a separate table avoids coupling to its schema | Better Auth `user.additionalFields`: couples our semantics to its table |
| Purge scheduling | In-process hourly `setInterval` in hosted `main()`, under `pg_try_advisory_lock`, with an injectable clock | The Starter instance is always on; one process; no extra $1/mo service. The lock makes overlapping or multiple instances safe | Render Cron Job (separate service, separate deploy) — noted as the upgrade path |
| Error tracker | `@sentry/node` 11: `Sentry.init` only when `SENTRY_DSN` is set, `dataCollection` all `false`, and `beforeSend`/`beforeBreadcrumb` run `redact()` over message, exception values, stack frames and extra data. **Manual** `captureException` from our error handler and the fatal handlers — no auto-instrumentation, no `--import` preload | v11 collects bodies, headers, cookies and AI inputs/outputs by default (docs). Manual capture keeps player text and prompts out by construction, and leaves the Dockerfile `CMD` unchanged for selfhost | `--import instrument.mjs` + `expressIntegration`: broader capture, preload changes the image CMD. Frontend Sentry: deferred (no player-facing errors are unreported today; add in Phase 13 with CSP) |
| Frontend | `main.tsx`: `<ModeGate>` replaces `<AccessGate>`. It calls `GET /api/access`: 204 → `<App/>`; 401 `PASSPHRASE_REQUIRED` → existing `<AccessGate>` flow; 401 `SIGN_IN_REQUIRED` → `<SignIn/>`. `App.tsx` is untouched | One image serves both modes (Phase 5 R20); no build-time flag | A `VITE_` build flag (Minimal): two frontend builds |
| Test database | `backend/src/__tests__/helpers/withTestDb.ts` needs `TEST_DATABASE_URL` and creates a throwaway schema per test file. `scripts/test-db.sh` starts a local Postgres 16 cluster **as the `postgres` system user** (the sandbox runs as root; `initdb` refuses root). CI uses a `postgres:16` service | Deterministic, real Postgres | pg-mem (not real Postgres; would miss advisory locks and concurrency) |

## API and Type Contracts
- **`shared/src/accessGate.ts`** (append only; existing exports untouched): `SIGN_IN_REQUIRED = 'SIGN_IN_REQUIRED'`, `ORIGIN_REJECTED = 'ORIGIN_REJECTED'`, `INVITE_REQUIRED = 'INVITE_REQUIRED'`, `INVITE_INVALID = 'INVITE_INVALID'`, `INVITE_REDEEM_PATH = '/api/invites/redeem'`, `ACCOUNT_PATH = '/api/account'`, `SoulboundMode = 'selfhost' | 'hosted'`.
- **`backend/src/config.ts`:**
  - New exports: `MODE: SoulboundMode`, and `getHostedSecrets(): { databaseUrl, betterAuthSecret, resendApiKey, googleClientSecret?, discordClientSecret? }`. The getter is a function, like `getAnthropicApiKey`, so it can't be swept up by `JSON.stringify`.
  - Also new: `HOSTED_PUBLIC_URL` (read from `BETTER_AUTH_URL`), `GOOGLE_CLIENT_ID?`, `DISCORD_CLIENT_ID?`, `SENTRY_DSN?`, `EMAIL_FROM`.
  - `checkPassphrase` is exported only in selfhost; in hosted it throws if called.
  - `redact(input)` removes **every configured secret**, longest first (the generalised rule from `config.ts:194-213`).
- **`backend/src/server.ts`:** `AppConfig` gains `hosted?: HostedDeps`, where `HostedDeps = { auth, pool, redeemInvite, requestAccountDeletion, reportError? }`. `buildApp` keeps its signature.
- **HTTP:**
  - `GET /api/access` returns 204, 401 `PASSPHRASE_REQUIRED` (selfhost) or 401 `SIGN_IN_REQUIRED` (hosted).
  - `POST /api/invites/redeem {code: string (1..64 printable ASCII)}` returns 204 plus a `Set-Cookie: sb_invite`, or 400 `INVITE_INVALID`.
  - `DELETE /api/account` returns 204 (clears the session cookie), or 401.
  - `/api/auth/*` is Better Auth's own surface.
  - All errors use the existing `{ error: { message, code } }` envelope.
- **DB:**
  - Better Auth tables `user`, `session`, `account`, `verification` (migration 001).
  - Ours (002): `invites(id uuid pk, code_hash bytea unique not null, created_at, expires_at, reserved_until, used_by text references "user"(id) on delete set null, used_at)` and `account_deletions(user_id text pk references "user"(id) on delete cascade, requested_at timestamptz not null)`.
- **Scripts (backend `package.json`):** `migrate` (`node dist/migrate.js`), `invite:create` (prints one code **once**; stores only the hash), `tracker:test` (sends a canary event full of fake secrets).

## File Placement
| Artifact | Path | Placement Rationale | Existing Pattern |
|----------|------|---------------------|------------------|
| Mode + hosted env | `backend/src/config.ts` (modify) | The single place env is read (its own header) | `takeEnv`, `readTrustProxy` |
| DB pool + pending-migration check | `backend/src/db.ts` | Backend module, like `anthropic.ts` | `anthropic.ts` single-client module |
| Migration entrypoint | `backend/src/migrate.ts` | Compiled to `dist/migrate.js` for `preDeployCommand` | `server.ts` `invokedDirectly` guard |
| Migrations | `backend/migrations/001_better-auth.sql`, `002_soulbound-hosted.sql` | New dir; copied into the image | — (new; Dockerfile `api` stage gains a COPY) |
| Better Auth instance + hooks | `backend/src/auth.ts` | Backend module | `accessGate.ts` |
| Invites | `backend/src/invites.ts` | Backend module | `accessGate.ts` |
| Account deletion + purge | `backend/src/account.ts` | Backend module | — |
| Hosted middleware (origin, frame, session gate) | `backend/src/hostedGate.ts` | Mirrors `accessGate.ts` for the other mode | `accessGate.ts` |
| Error tracker | `backend/src/errorTracker.ts` | Backend module | — |
| Invite CLI | `backend/src/scripts/createInvite.ts` | Compiled script | — |
| Tests | `backend/src/__tests__/{hostedConfig,hostedOrder,invites,account,errorTracker}.test.ts`, `helpers/withTestDb.ts` | Existing `__tests__` convention | `accessGate.test.ts` |
| Frontend gate | `frontend/src/components/ModeGate.tsx`, `SignIn.tsx`, `AccountPanel.tsx` | Components dir; `AccessGate` precedent | `AccessGate.tsx` (single-quote new-code style) |
| Frontend API | `frontend/src/lib/api.ts` (modify: `checkAccess` returns `'ok' \| 'passphrase' \| 'signin' \| 'unknown'`; `redeemInvite`, `deleteAccount`) | The only API client | existing `checkAccess` |
| Auth client | `frontend/src/lib/authClient.ts` (`createAuthClient` + `magicLinkClient`) | frontend-io | `passphrase.ts` |
| Deploy | `render.yaml` (repo root) | Blueprint location | `compose.selfhost.yml` at root |
| Verification | `scripts/verify-hosted.sh` | Next to `smoke-image.sh` | `smoke-image.sh` |
| Local test DB | `scripts/test-db.sh` | scripts/ | `smoke-image.sh` |
| Runbooks | `docs/runbooks/phase-6-hosted-setup.md` | docs/ | README sections |
| CI | `.github/workflows/ci.yml` (modify: `postgres:16` service, `TEST_DATABASE_URL`) | — | existing jobs |

## Data and Control Flow
- **Invited sign-up (magic link):**
  1. The player opens the invite link `/?invite=CODE`. `SignIn` posts to `/api/invites/redeem`, the server checks `hash(CODE)` and sets the `sb_invite` cookie, and `SignIn` shows the email field.
  2. The player submits their email. Better Auth's `/sign-in/magic-link` passes our Origin check, and `sendMagicLink` calls Resend.
  3. The player clicks the emailed link, which hits `/api/auth/magic-link/verify` (GET).
  4. The invite-context wrapper puts the `sb_invite` cookie into ALS. `user.create.before` reserves the invite, the user is inserted, `user.create.after` marks it used, and the session cookie is set. The player is redirected to `/`.
  5. `ModeGate` gets 204 from `/api/access` and renders `<App/>`.
- **OAuth sign-up:** the same as magic link, except the cookie goes out before the redirect and comes back on `/api/auth/callback/{provider}`, a same-site GET. Lax cookies are sent on top-level navigation.
- **Returning sign-in:** no user is created, so no invite is needed. `session.create.after` deletes any `account_deletions` row.
- **Deletion:**
  1. `AccountPanel`: arm → Confirm → `DELETE /api/account`.
  2. The server inserts `account_deletions`, revokes all of the user's sessions, and clears the cookie.
  3. The hourly purge takes `pg_try_advisory_lock(<const>)` and runs `DELETE FROM "user" WHERE id IN (SELECT user_id FROM account_deletions WHERE requested_at < now() - interval '7 days')`, which cascades.
- **Errors:** error handler → `redact()` → response. If the tracker is on, it also runs `captureException(redacted Error)` through `beforeSend` (which redacts again).

## Compatibility Constraints
- **Selfhost is frozen:**
  - The existing 187 backend and 190 frontend tests pass **without edits**.
  - `scripts/smoke-image.sh` passes 7/7.
  - `git diff 7856b7d -- frontend/src/App.tsx` is empty.
  - Every existing config error message stays byte-identical, pinned by the existing `config.test.ts`.
- **Selfhost never opens a DB connection:** a test asserts that `pg` is not imported in selfhost mode, using dynamic imports behind the mode check.
- **Same image for both modes:** the Dockerfile gains only `COPY backend/migrations` in the `api` stage, and `runtime` stays the last stage.
- **CLAUDE.md #1:** no native dialogs; the deletion confirm is inline.
- **CLAUDE.md #2:** saves stay in `localStorage` in both modes this phase (server saves are Phase 7).
- **CLAUDE.md #4-#8:** untouched; there are no prompt or model changes.
- **Render and the repo move:** the Blueprint doesn't pin a repo (it defaults to the one containing it). After the move, re-check the Git connection (runbook step).

## Failure Modes
| Failure Mode | Expected Behavior | Verification |
|--------------|-------------------|--------------|
| `hosted` with a missing secret | Exit 1 naming the variable, before binding | `hostedConfig.test.ts` |
| `hosted` + `SOULBOUND_PASSPHRASE` set | Exit 1: "not used in hosted mode" | same |
| Pending migrations at boot | Exit 1: "run `npm run migrate`" | test with a fresh schema |
| Better Auth mounted after `express.json` | Order test fails (a request would hang) | `hostedOrder.test.ts` mutation: move the mount |
| Foreign Origin on POST | 403 `ORIGIN_REJECTED` | per-route test |
| Invite reused concurrently | Exactly one user created | `Promise.all` race test on real Postgres |
| User insert fails after reservation | Invite reusable after `reserved_until` | test with a forced insert failure |
| Discord returns `email: null` | Sign-up refused with a clear error (email required for magic-link recovery) | unit test on the hook |
| Purge running on two instances | Only one holds the lock | advisory-lock test |
| Wrong `trust proxy` hop count on Render | The per-IP limiter keys on the proxy IP | Runbook: deploy with `1`, log `X-Forwarded-For` + `req.ips` for one request, set the count from observation, record it in evidence |
| Render health check 403 | Allow-list missing the `onrender.com` host | `verify-hosted.sh` health step; `ALLOWED_HOSTS` in `render.yaml` |
| Tracker leaks a secret | Canary event contains `[REDACTED]` only | `errorTracker.test.ts` + `tracker:test` on the live dashboard |
| Test DB unavailable in CI | Suite **fails** (never silently skips) | CI sets `TEST_DATABASE_URL`; the helper throws when `CI=true` and it's unset |

## Acceptance Checks
| Check | Command or Evidence | Required |
|-------|---------------------|----------|
| Selfhost unchanged | `npm test` (existing 377 pass, unedited) + `scripts/smoke-image.sh` 7/7 + App.tsx diff empty | true |
| Hosted suite | `TEST_DATABASE_URL=… npm test` — the new hosted tests pass | true |
| Order pinned | Mutation: move the Better Auth mount below `express.json`, and the session gate above `/api/auth` → both caught | true |
| Race-safe invites | Race test green on 20 runs | true |
| Live deploy | `scripts/verify-hosted.sh https://<service>.onrender.com`: health 200, frame headers, foreign-Origin 403, `/api/access` 401 `SIGN_IN_REQUIRED` | true |
| Live sign-in ×3 | The developer signs in with magic link, Google and Discord. The agent confirms 3 `account` rows and the cookie flags via `verify-hosted.sh --session` | true |
| Tracker redaction live | `npm run tracker:test` → dashboard screenshot shows `[REDACTED]` | true |
| Ops attestations | Screenshots of the Console spend limit and the uptime monitor in `evidence/` | true |

## Deliverables
### D1 Mode & hosted config
- **Path:** `backend/src/config.ts`
- **Purpose:** R23
- **Key Content:** mode-first reading; per-mode `takeEnv`; generalised `redact`
- **Dependencies:** none
- **Estimated Size:** +150 lines

### D2 DB, migrations, test harness
- **Path:** `backend/src/db.ts`, `backend/src/migrate.ts`, `backend/migrations/*.sql`, `helpers/withTestDb.ts`, `scripts/test-db.sh`, the CI service, the Dockerfile COPY
- **Purpose:** foundation for everything after this
- **Dependencies:** D1
- **Estimated Size:** ~350 lines

### D3 Better Auth + invites
- **Path:** `backend/src/auth.ts`, `invites.ts`, `scripts/createInvite.ts`
- **Purpose:** R24a, R24c
- **Dependencies:** D2
- **Estimated Size:** ~300 lines

### D4 Hosted gate & order
- **Path:** `backend/src/hostedGate.ts`, `server.ts` hosted branch, `hostedOrder.test.ts`
- **Purpose:** R24b, R24e, and the order
- **Dependencies:** D3
- **Estimated Size:** ~250 lines

### D5 Account deletion + purge
- **Path:** `backend/src/account.ts`
- **Purpose:** R24d
- **Dependencies:** D3, D4
- **Estimated Size:** ~150 lines

### D6 Frontend
- **Path:** `ModeGate.tsx`, `SignIn.tsx`, `AccountPanel.tsx`, `lib/authClient.ts`, `api.ts`, `main.tsx`
- **Purpose:** R24 UI
- **Dependencies:** D4 contracts
- **Estimated Size:** ~450 lines

### D7 Error tracker
- **Path:** `backend/src/errorTracker.ts`
- **Purpose:** R25b
- **Dependencies:** D1
- **Estimated Size:** ~120 lines

### D8 Deploy & verification
- **Path:** `render.yaml`, `scripts/verify-hosted.sh`, `docs/runbooks/phase-6-hosted-setup.md`, `.env.example`, README
- **Purpose:** R25a, R25c
- **Dependencies:** all

### D9 Records
- **Path:** design log entry, CLAUDE.md (additions only)
- **Purpose:** records
- **Key Content:** the hosted order and `SIGN_IN_REQUIRED` noted beside the Phase 5 paragraph
- **Dependencies:** all

## Path Validation
**Status:** All paths are valid against `.planning/config/directory-mappings.yaml` (backend/src, frontend/src/components, frontend/src/lib, scripts, .github/workflows). New, unmapped directories: `backend/migrations/` and `docs/runbooks/` — add both to the mappings in D9.

## Open Questions
| # | Question | Impact | Default Chosen by Spec | Planning Effect |
|---|----------|--------|------------------------|-----------------|
| 1 | Which request fields does a Better Auth databaseHook `ctx` expose? | Non-blocking | Don't rely on it: ALS wrapper (Key Decisions) | Use the ALS design; the D3 first task verifies by reading the installed source and records it |
| 2 | Render's proxy hop count | Non-blocking | `TRUST_PROXY=1`, confirmed empirically in the runbook | The runbook step plus evidence |
| 3 | Does `magicLink({ disableSignUp })` block DB-level creation? | Non-blocking | Not used; the `user.create.before` invite hook is the single gate for all methods | None |
| 4 | Render plan ID for "Starter" (the Blueprint uses new IDs like `0.5c-512mb`; docs list legacy names) | Non-blocking | Use the ID shown in the Render dashboard at setup; the runbook records it | The runbook confirms it |
| 5 | Email sender domain for Resend (needs DNS on a domain the developer owns) | Non-blocking | Use Resend's onboarding sender for developer-only testing; the runbook sets up a real domain before Phase 9 invites | The runbook covers both |
| 6 | Custom domain vs `onrender.com` | Non-blocking | `onrender.com` for Phase 6 (developer-only); custom domain later | `ALLOWED_HOSTS`/`BETTER_AUTH_URL` are env-driven, so no code change |

## Complexity Assessment
*(filled by Section 5)*

## Revision History
| # | Section | Change | Reason |
|---|---------|--------|--------|
