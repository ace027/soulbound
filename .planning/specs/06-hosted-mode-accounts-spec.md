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
| R23 | Mode switch | Must | Config reads secrets and mode in this order: **(1)** take every secret out of `process.env` (`ANTHROPIC_API_KEY`, `SOULBOUND_PASSPHRASE`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `GOOGLE_CLIENT_SECRET`, `DISCORD_CLIENT_SECRET`); **(2)** validate `SOULBOUND_MODE`; **(3)** validate what that mode needs. Tested: an invalid mode still leaves no secret in `process.env`. Unset or `selfhost` behaves exactly as Phase 5 did: 377 tests and smoke 7/7 unedited, and every existing config error message byte-identical. `hosted` requires the following, and exits non-zero naming the variable when one is missing or invalid: `DATABASE_URL`; `BETTER_AUTH_SECRET` (≥ 32 chars); `BETTER_AUTH_URL` (an `https:` origin; `http://localhost…` only when `NODE_ENV !== 'production'`); `RESEND_API_KEY`; `EMAIL_FROM`. In hosted mode, `FRONTEND_ORIGIN` must equal `BETTER_AUTH_URL`'s origin (and defaults to it). `hosted` with `SOULBOUND_PASSPHRASE` set exits. Any other mode value exits naming `selfhost` / `hosted` |
| R24a | Sign-in | Must | Magic link (Resend), Google and Discord each complete sign-in on the live host. Better Auth gets `baseURL`, `secret`, `trustedOrigins: [publicOrigin]` and `useSecureCookies: true` **explicitly** (config deletes the env vars it would otherwise read). Sessions: `expiresIn` 2 592 000 s, `updateAge` 86 400 s, `cookieCache` **off**. A test asserts the Set-Cookie carries `HttpOnly`, `Secure` and `SameSite=Lax`. Magic-link tokens are stored hashed (`storeToken: 'hashed'`). A spoofed `X-Forwarded-Host` does not change the emailed link (tested). Sign-out is available in the UI |
| R24b | Origin/CSRF | Must | In hosted mode, every non-GET/HEAD/OPTIONS `/api/*` request is compared with the public origin. A missing Origin, `null`, a foreign origin, or `Sec-Fetch-Site: cross-site` → 403 `ORIGIN_REJECTED`. Tested per route, including `/api/auth/*` POSTs, `/api/invites/redeem` and `DELETE /api/account`. The only bypass is the reserved `POST /api/billing/webhook` (exact path and method), and a test proves no other path skips the check. **Accepted risk (documented):** magic-link verify is a GET, so login-CSRF into an *existing* account is possible. Creating a *new* account also needs the `sb_invite` cookie |
| R24c | Invite-only | Must | A new account, by any method, needs a valid, **unexpired** (default 14 days), unused invite. Generated codes carry 128 bits (`crypto.randomBytes(16)` as base64url, 22 chars); only the SHA-256 is stored. `/api/invites/redeem` accepts only `^[A-Za-z0-9_-]{22}$` behind a 1 KB body limit and its own limiter (5/min per IP). In a race test (`repeats: 20`) where two sign-ups present the same invite, exactly one account is created. A failed user insert or a failed `after` hook never leaves a code reusable **and** never leaves an account without a consumed invite (tested with injected failures) |
| R24d | Account deletion | Must | `DELETE /api/account` (inline confirm, never a native dialog):<br>• All of the user's sessions are revoked, so an old cookie gets 401 **immediately** (tested; possible because `cookieCache` is off).<br>• The account is hidden.<br>• Signing in within 7 days cancels the deletion.<br>• After 7 days the purge job hard-deletes the user; the cascade covers sessions, accounts, invites.used_by (set null) and `account_deletions`, and the purge also deletes `verification` rows for that email.<br>• The purge uses `pg_try_advisory_xact_lock` on a dedicated client (tested with two concurrent purges and an injected clock) |
| R24e | Anti-framing | Must | Hosted responses carry `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`. A test asserts both are **absent** from self-host responses |
| R24f | Abuse controls | Must | The magic-link send only emails an address that already has an account, **or** a request carrying a valid `sb_invite` cookie. The response is identical either way, so it can't be used to enumerate emails. Each email gets at most 3 sends per 15 minutes. A sign-up whose provider reports `emailVerified: false` is refused before any invite is reserved. `accountLinking.trustedProviders` = `['google']` (Discord is never trusted); `allowDifferentEmails: false`. In hosted mode the per-IP limiter keys IPv6 by /64, and a per-user limiter runs after the session gate. Better Auth's own limiter is **disabled**, because it trusts the client-supplied first `X-Forwarded-For` value, and our limiters cover it |
| R25a | Render deploy | Must | `render.yaml` Blueprint:<br>• A Docker web service built from the last stage, `runtime`.<br>• A Postgres 16 database with a named plan.<br>• `preDeployCommand: node backend/dist/migrate.js`.<br>• `healthCheckPath: /api/health`.<br>• `ALLOWED_HOSTS` including the `onrender.com` hostname.<br>• Secrets as `sync: false`.<br>`node-pg-migrate` and `pg` are runtime `dependencies`, which a test asserts from `backend/package.json`. `scripts/verify-hosted.sh <url>` passes against the live URL |
| R25b | Error tracker | Must | Off unless `SENTRY_DSN` is set. When on:<br>• `defaultIntegrations: false`, with only the minimum error-capture integrations added explicitly.<br>• `beforeBreadcrumb` returns `null`.<br>• `beforeSend` **rebuilds** the event from an allow-list: exception type; stack frames reduced to function, filename and line number; a fixed internal error code; route template; mode.<br>• Message text, exception values, request, user, contexts, extra and variables are **all dropped**.<br>A test uses Sentry's test transport. It throws an error whose message and stack carry the API key, `BETTER_AUTH_SECRET`, the DB password, a session-cookie value, an invite code, an email and player text; **none** appears in the captured payload. Option names are verified against the installed `@sentry/node` 11 before use (the research could not confirm a `dataCollection` option) |
| R25c | Ops baseline | Must | Anthropic Console workspace spend limit set and uptime monitor alerting (developer attests, with screenshots in `evidence/`) |
| R25d | Secret hygiene | Must | `redact()` covers every configured secret. For `DATABASE_URL` that means the full URL, its password, and the URL-decoded password. Hosted secrets are ≥ 32 chars, so a tiny secret can't redact ordinary characters. A test uses 3+ secrets, including overlapping substrings. A test forces a DB connection error and asserts it comes out redacted. The DB URL goes to `pg` and `node-pg-migrate` programmatically, never through the environment |

## Architecture
Two modes behind one entrypoint:
1. `config.ts` reads `SOULBOUND_MODE` **first**, then takes and validates the secrets that mode needs.
2. `buildApp(config)` keeps its signature. A new optional `config.hosted` (`HostedDeps`) switches on the hosted branch.
3. With `hosted` absent, every line of the current selfhost path runs unchanged. Existing tests never set it.

### Hosted middleware order
This is the security model; each position is pinned by a test that fails when it moves. The order tests run with a 2-second per-request timeout, so a hang counts as a failure rather than a stall.
1. `trust proxy` (from `TRUST_PROXY`; Render starts at `1`, confirmed empirically — see Failure Modes)
2. Host allow-list — must include the `onrender.com` hostname (Render's health check sends it)
3. **Anti-framing headers** (hosted only)
4. CORS (unchanged; hosted is same-origin)
5. `GET /api/health`
6. Per-IP rate limiter (existing; hosted mode keys IPv6 by /64)
7. **Reserved:** `POST /api/billing/webhook` with `express.raw` — Phase 11. It sits here, before the Origin check, because Stripe sends no Origin; it matches only the exact path and method, and requires signature verification before any side effect. Empty now, but named in the order test
8. **Origin check** on non-GET/HEAD/OPTIONS `/api/*` (compared with the public origin)
9. **`POST /api/invites/redeem`** with its own `express.json({ limit: '1kb' })` and a 5/min limiter
10. **`app.all('/api/auth/*splat', invite-context wrapper → toNodeHandler(auth))`** — must be before `express.json` (Better Auth issue #3295: it hangs otherwise). It ends every auth request itself, so the session gate needs **no** exemption list
11. **Session gate** — replaces `createAccessGate` (server.ts:248) in hosted mode. Calls `auth.api.getSession` with the cookie cache disabled. Returns 401 `SIGN_IN_REQUIRED` for no session, or a user with a pending deletion
12. **Per-user limiter** (keyed on the session's user id)
13. `express.json` scoped to `/api` (server.ts:259, unchanged)
14. `GET /api/access` (204), `DELETE /api/account`
15. The three game routers, then `/api` 404, static, global 404, error handler (unchanged; the error handler also reports to the tracker when enabled)

### Key Decisions
| Decision | Choice | Rationale | Alternatives Considered |
|----------|--------|-----------|------------------------|
| Mode branching | Optional `config.hosted` inside the existing `buildApp` | Selfhost path provably untouched; existing test configs compile unchanged (routes.test.ts builds `AppConfig` literals) | Per-mode assemblers (Clean): more structure, bigger `server.ts` diff |
| DB access | `pg` Pool, shared by Better Auth (its built-in Kysely adapter accepts a Pool) and our code | One pool; no ORM; Phases 7-11 need atomic `UPDATE … RETURNING` and `ON CONFLICT`, which plain SQL expresses directly | Kysely/Drizzle: another concept for ~6 queries |
| Migrations | `node-pg-migrate` 9 (ESM, Node ≥20.11), plain `.sql` files in `backend/migrations/`. Better Auth's schema is committed as migration 001, generated once with `npx auth@latest generate` | One migration history; advisory lock by default; `.sql` supported (verified in the 9.0.0 source) | Better Auth's own `migrate` (Kysely-only, a second history); a hand-rolled runner |
| When migrations run | Render `preDeployCommand: node backend/dist/migrate.js` (paid plans; Starter qualifies). `migrate.ts` does **not** import `config.ts`: it reads and deletes only `DATABASE_URL`, then passes it to `runner()` as `databaseUrl`. At boot, the hosted app **checks** for pending migrations and exits if any, rather than applying them. Every migration has a `-- Down Migration` section. The Better Auth CLI is run pinned to the installed `better-auth` version (`npx auth@<that version> generate`), never `@latest` | A failed migration fails the deploy while the previous deploy keeps serving. Keeping migrate independent of config means the pre-deploy doesn't need every app secret. Pinning keeps the generated schema matching the runtime library | Migrate at boot under a lock: couples app start to schema change |
| Invite carrier | `POST /api/invites/redeem {code}` checks the code and sets `__Host-sb_invite` (`Secure; HttpOnly; SameSite=Lax; Path=/`, 15 min). The cookie carries `{inviteId, nonce, exp}` authenticated with HMAC-SHA256, whose key is derived from `BETTER_AUTH_SECRET` by HKDF (info `"soulbound/sb_invite"`) — **never the raw code**. An `AsyncLocalStorage` wrapper around the Better Auth handler exposes the parsed cookie to the hooks and to `sendMagicLink`. With no cookie (e.g. a magic link opened on another device), sign-up fails with a clear message: "open the link in the browser where you entered your invite" | A databaseHook's `ctx` request fields are **not documented**, and for OAuth the request body is gone by the callback. We mount the handler, so wrapping it is under our control. D3's first task verifies the ALS context survives Better Auth's internal async (test) | Community invite plugins (unaudited deps); `hooks.before` (can't tell sign-up from sign-in) |
| Invite atomicity | 1. The `before` hook checks `emailVerified`.<br>2. It then reserves: `UPDATE invites SET reserved_until = now() + '10 min', reserved_nonce = $nonce WHERE id = $inviteId AND used_at IS NULL AND (expires_at IS NULL OR expires_at > now()) AND (reserved_until IS NULL OR reserved_until < now() OR reserved_nonce = $nonce) RETURNING id`. No row → throw `APIError` (aborts). The same holder can retry.<br>3. The `after` hook runs `UPDATE invites SET used_by = $user, used_at = now() WHERE id = $inviteId AND reserved_nonce = $nonce AND used_at IS NULL`. If that fails, the hook deletes the just-created user (a compensating action) and throws.<br>4. The hourly purge also **reconciles**, touching only **expired** reservations (`reserved_until < $now`): the user whose email equals `reserved_email`, created inside that window and not already consuming another invite, gets the invite marked used. An invite-less user past the window is deleted (fail closed). | Better Auth hook transactionality is **not documented**, and a raw `pg` query won't join its transaction. A nonce-scoped reservation is single-winner, retryable by its holder, and expires if abandoned. Compensation plus reconciliation cover a failed `after`, so an account never exists without its invite being consumed | A plain consume in `before` (burns the code on a failed insert); Better Auth's `transaction: true` (undocumented for the Kysely adapter) |
| Deletion grace | Our own `account_deletions(user_id PK → user ON DELETE CASCADE, requested_at)` table. `session.create.after` clears it (sign-in cancels deletion). Purge job hard-deletes the user; the FK cascade removes sessions, accounts and our rows | Better Auth's `deleteUser` is an immediate hard delete with no grace period (docs); a separate table avoids coupling to its schema | Better Auth `user.additionalFields`: couples our semantics to its table |
| Purge scheduling | In-process hourly `setInterval` in hosted `main()`: a dedicated client, `BEGIN`, `pg_try_advisory_xact_lock(<const>)` (released at commit, so a pooled connection can't keep it), with an injectable clock | The Starter instance is always on; one process; no extra $1/mo service. The lock makes overlapping or multiple instances safe | Render Cron Job (separate service, separate deploy) — noted as the upgrade path |
| Error tracker | `@sentry/node` 11: `Sentry.init` only when `SENTRY_DSN` is set, with `defaultIntegrations: false`. **Manual** `captureException` from our error handler and the fatal handlers. `beforeSend` **rebuilds** the event from an allow-list (see R25b), and `beforeBreadcrumb` returns `null` | A value-matching redactor can't catch per-request values (cookies, invite codes, player text) — both critiques found this. Dropping message text and every free-form field removes them by construction. No preload keeps the Dockerfile `CMD` unchanged for self-host | `redact()`-only scrubbing (fails R25b); `--import instrument.mjs` + auto-instrumentation (captures bodies and headers by default). Frontend Sentry is deferred to Phase 13 with CSP |
| Frontend | `main.tsx`: `<ModeGate>` wraps the existing `<AccessGate>` rather than replacing it. `checkAccess()` is **unchanged** (`'ok' \| 'required' \| 'unknown'`, asserted by `api.test.ts:608`; `AccessGate.tsx:51,70` stores its result in a state typed to exactly those values, so adding a member would break the build). A new `getAccessState()` returns `{ access: 'ok' \| 'required' \| 'signin' \| 'unknown'; hosted }`, where `'signin'` is 401 `SIGN_IN_REQUIRED` and `hosted` comes from the `Soulbound-Mode` header. `checkAccess()` keeps mapping `SIGN_IN_REQUIRED` to `'unknown'` as it does today. On `'signin'`, `ModeGate` renders `<SignIn/>`; otherwise it renders `<AccessGate><App/></AccessGate>` exactly as today. `App.tsx` is untouched. `AccountPanel` (sign-out, delete account) is a small overlay button rendered by `ModeGate` in hosted mode only | One image serves both modes (Phase 5 R20); the self-host frontend path and its 190 tests are unchanged | A `VITE_` build flag (Minimal): two frontend builds; renaming `'required'` (breaks frozen tests) |
| Test database | Hosted tests live in their own Vitest project (`backend/vitest.hosted.config.ts`), run by `npm run test:hosted`.<br>• `withTestDb()` creates a throwaway schema per test file.<br>• `test:hosted` **fails** when `TEST_DATABASE_URL` is unset, and asserts 0 skipped through `--reporter=json`.<br>• Plain `npm test` stays exactly as today: the self-host suite, no DB.<br>• `scripts/test-db.sh` starts a local Postgres 16 cluster **as the `postgres` system user** (the sandbox runs as root; `initdb` refuses root) and prints the URL.<br>• CI and `release.yml` both get a `postgres:16` service and run both suites.<br>• A new backend `setupFiles` entry clears `SOULBOUND_MODE`, `DATABASE_URL`, `BETTER_AUTH_*`, `RESEND_API_KEY`, `SENTRY_DSN` and `EMAIL_FROM` before every test file. That's a harness change, not a test edit, so a developer shell exporting hosted variables can't turn the frozen self-host tests red | Deterministic, real Postgres; a separate command means a green `npm test` can't hide an untested hosted path | pg-mem (not real Postgres; misses advisory locks and concurrency); a skip-when-unset single suite (hides regressions) |

## API and Type Contracts
- **`shared/src/accessGate.ts`** (append only; existing exports untouched): `SIGN_IN_REQUIRED = 'SIGN_IN_REQUIRED'`, `ORIGIN_REJECTED = 'ORIGIN_REJECTED'`, `INVITE_REQUIRED = 'INVITE_REQUIRED'`, `INVITE_INVALID = 'INVITE_INVALID'`, `INVITE_REDEEM_PATH = '/api/invites/redeem'`, `ACCOUNT_PATH = '/api/account'`, `INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{22}$/`, `MODE_HEADER = 'Soulbound-Mode'`, `SoulboundMode = 'selfhost' | 'hosted'`.
- **`backend/src/config.ts`:**
  - New exports: `MODE: SoulboundMode`, and `getHostedSecrets(): { databaseUrl, betterAuthSecret, resendApiKey, googleClientSecret?, discordClientSecret? }`. The getter is a function, like `getAnthropicApiKey`, so it can't be swept up by `JSON.stringify`.
  - Also new: `HOSTED_PUBLIC_URL` (read from `BETTER_AUTH_URL`), `GOOGLE_CLIENT_ID?`, `DISCORD_CLIENT_ID?`, `SENTRY_DSN?`, `EMAIL_FROM`.
  - `checkPassphrase` is exported only in selfhost; in hosted it throws if called.
  - `redact(input)` removes **every configured secret**, longest first (the generalised rule from `config.ts:194-213`).
- **`backend/src/server.ts`:** `AppConfig` gains `hosted?: HostedDeps`, where `HostedDeps = { auth, pool, redeemInvite, requestAccountDeletion, reportError? }`. `buildApp` keeps its signature.
- **HTTP:**
  - `GET /api/access` returns 204, 401 `PASSPHRASE_REQUIRED` (selfhost) or 401 `SIGN_IN_REQUIRED` (hosted). In hosted mode both carry `Soulbound-Mode: hosted` (`MODE_HEADER` in `shared`); selfhost never sends it.
  - `POST /api/invites/redeem {code: string matching INVITE_CODE_PATTERN}` returns 204 plus a `Set-Cookie: __Host-sb_invite`, or 400 `INVITE_INVALID` (the same response for unknown, used and expired codes).
  - `DELETE /api/account` returns 204 (clears the session cookie), or 401.
  - `/api/auth/*` is Better Auth's own surface.
  - All errors use the existing `{ error: { message, code } }` envelope.
- **DB:**
  - Better Auth tables `user`, `session`, `account`, `verification` (migration 001).
  - Ours (002): `invites(id uuid pk, code_hash bytea unique not null, created_at, expires_at timestamptz not null default now() + interval '14 days', reserved_until, reserved_nonce bytea, reserved_email text, used_by text references "user"(id) on delete set null, used_at)` and `account_deletions(user_id text pk references "user"(id) on delete cascade, requested_at timestamptz not null)`.
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
| Tests | Self-host-runnable: `backend/src/__tests__/{hostedConfig,errorTracker,redact,selfhostNoPg}.test.ts`. DB-backed, under `backend/src/__tests__/hosted/`: `{hostedOrder,invites,account,purge}.test.ts`, run by `vitest.hosted.config.ts`. Helpers: `helpers/withTestDb.ts`, `setup/clearHostedEnv.ts` | Existing `__tests__` convention | `accessGate.test.ts` |
| Frontend gate | `frontend/src/components/ModeGate.tsx`, `SignIn.tsx`, `AccountPanel.tsx` | Components dir; `AccessGate` precedent | `AccessGate.tsx` (single-quote new-code style) |
| Frontend API | `frontend/src/lib/api.ts` (modify: `checkAccess` unchanged; new `getAccessState`, `redeemInvite`, `deleteAccount`) | The only API client | existing `checkAccess` |
| Auth client | `frontend/src/lib/authClient.ts` (`createAuthClient` + `magicLinkClient`) | frontend-io | `passphrase.ts` |
| Deploy | `render.yaml` (repo root) | Blueprint location | `compose.selfhost.yml` at root |
| Verification | `scripts/verify-hosted.sh` | Next to `smoke-image.sh` | `smoke-image.sh` |
| Local test DB | `scripts/test-db.sh` | scripts/ | `smoke-image.sh` |
| Runbooks | `docs/runbooks/phase-6-hosted-setup.md` | docs/ | README sections |
| CI | `.github/workflows/ci.yml` and `.github/workflows/release.yml` (both: `postgres:16` service, `TEST_DATABASE_URL`, `npm run test:hosted` after `npm test`) | — | existing jobs |

## Data and Control Flow
- **Invited sign-up (magic link):**
  1. The player opens the invite link `/?invite=CODE`. `SignIn` posts to `/api/invites/redeem`, the server checks `hash(CODE)` and sets the `sb_invite` cookie, and `SignIn` shows the email field.
  2. The player submits their email. Better Auth's `/sign-in/magic-link` passes our Origin check. `sendMagicLink` calls Resend only if the address already has an account or the ALS holds a valid invite cookie, and only within the per-email cap. The response is identical either way.
  3. The player clicks the emailed link, which hits `/api/auth/magic-link/verify` (GET).
  4. The invite-context wrapper puts the verified `__Host-sb_invite` payload into ALS. `user.create.before` checks `emailVerified`, then reserves the invite with its nonce. The user is inserted, `user.create.after` marks the invite used (compensating on failure), and the session cookie is set. The player is redirected to `/`.
  5. `ModeGate` gets 204 from `/api/access` and renders `<App/>`.
- **OAuth sign-up:** the same as magic link, except the cookie goes out before the redirect and comes back on `/api/auth/callback/{provider}`, a same-site GET. Lax cookies are sent on top-level navigation.
- **Returning sign-in:** no user is created, so no invite is needed. `session.create.after` deletes any `account_deletions` row.
- **Deletion:**
  1. `AccountPanel`: arm → Confirm → `DELETE /api/account`.
  2. The server inserts `account_deletions`, revokes all of the user's sessions, and clears the cookie.
  3. The hourly purge, in one transaction on a dedicated client, takes `pg_try_advisory_xact_lock(<const>)`. It deletes `verification` rows for the affected emails, runs `DELETE FROM "user" WHERE id IN (SELECT user_id FROM account_deletions WHERE requested_at < now() - interval '7 days')` (which cascades), then runs the invite reconciliation. Retention at the processors (Resend logs, Sentry) is documented in the runbook.
- **Errors:** error handler → `redact()` → response. If the tracker is on, it also runs `captureException(redacted Error)` through `beforeSend` (which redacts again).

## Compatibility Constraints
- **Selfhost is frozen:**
  - The existing 187 backend and 190 frontend tests pass **without edits**.
  - `scripts/smoke-image.sh` passes 7/7.
  - `git diff 7856b7d -- frontend/src/App.tsx` is empty.
  - Every existing config error message stays byte-identical, pinned by the existing `config.test.ts`.
- **Selfhost never opens a DB connection:** `pg`, `better-auth`, `node-pg-migrate` and `@sentry/node` are dynamically imported behind the mode check. `selfhostNoPg.test.ts` uses `vi.doMock('pg', () => { throw new Error('pg imported in selfhost') })` (and the same for the other three), then imports `server.js` and builds a selfhost app, and the test passes.
- **`checkAccess` is unchanged:** its three return values and `AccessGate.tsx` stay as they are. `'signin'` exists only on the new `getAccessState()`.
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
| Test DB unavailable | `npm run test:hosted` **fails**, in CI or locally; it never skips | `test:hosted` exits non-zero when `TEST_DATABASE_URL` is unset; the JSON reporter asserts 0 skipped |
| Spoofed `X-Forwarded-Host` | Magic link still points at `BETTER_AUTH_URL` | Test sends a spoofed header and checks the link passed to the mocked sender |
| Unverified provider email | Sign-up refused before reservation | Hook unit test with `emailVerified: false` |
| Magic-link bombing | No email for unknown address without an invite cookie; ≤ 3/15 min per address | Tests on the mocked sender's call count |
| Old session after deletion | 401 at once | Test: `DELETE`, then reuse the old cookie |
| `after` hook fails | User deleted (compensation); invite not reusable by others | Injected-failure test |
| DB connection error text | Password redacted (raw and URL-decoded) | Forced bad-host connection test |
| Invalid mode with secrets set | Exits; no secret left in `process.env` | `hostedConfig.test.ts` |

## Acceptance Checks
| Check | Command or Evidence | Required |
|-------|---------------------|----------|
| Selfhost unchanged | `npm test` (existing 377 pass, unedited) + `scripts/smoke-image.sh` 7/7 + App.tsx diff empty + `git diff --stat main -- '*.test.ts' '*.test.tsx'` shows only **new** test files | true |
| Hosted suite | `scripts/test-db.sh` then `TEST_DATABASE_URL=… npm run test:hosted` — all pass, 0 skipped | true |
| Order pinned | Scripted mutation (sed, run, then `git checkout -- backend/src/server.ts`): move the Better Auth mount below `express.json`; move the Origin check below the auth mount; remove the session gate → each caught within the 2 s timeout | true |
| Race-safe invites | Race test with `{ repeats: 20 }` on real Postgres (concurrent reservations and two concurrent end-to-end sign-ups) | true |
| Tracker redaction | Canary test on Sentry's test transport: no secret, cookie, code, email or player text in the payload | true |
| Live deploy | `scripts/verify-hosted.sh https://<service>.onrender.com`: health 200, frame headers, foreign-Origin 403, `/api/access` 401 `SIGN_IN_REQUIRED`, `/api/invites/redeem` 400 on a bad code | true |
| Live sign-in ×3 | The developer signs in with magic link, Google and Discord. The agent confirms 3 `account` rows and the cookie flags via `verify-hosted.sh --session` | true |
| Proxy hop count | Runbook: one request logged with `X-Forwarded-For` + `req.ips`; `TRUST_PROXY` set from the observation; evidence committed | true |
| Tracker live | `npm run tracker:test` → dashboard screenshot shows no canary values | true |
| Ops attestations | Screenshots of the Console spend limit and the uptime monitor in `evidence/` | true |

## Deliverables
### D1 Mode & hosted config
- **Path:** `backend/src/config.ts`
- **Purpose:** R23
- **Key Content:** mode-first reading; per-mode `takeEnv`; generalised `redact`
- **Dependencies:** none
- **Estimated Size:** +150 lines

### D2 DB, migrations, test harness
- **Path:** `backend/src/db.ts`, `backend/src/migrate.ts`, `backend/migrations/*.sql` (up + down), `helpers/withTestDb.ts`, `setup/clearHostedEnv.ts`, `vitest.hosted.config.ts`, `scripts/test-db.sh`, the CI + release services, the Dockerfile `COPY backend/migrations`, and `pg` + `node-pg-migrate` as runtime deps
- **Purpose:** foundation for everything after this
- **Dependencies:** D1
- **Estimated Size:** ~350 lines

### D3 Better Auth + invites
- **Path:** `backend/src/auth.ts`, `invites.ts`, `scripts/createInvite.ts`
- **Purpose:** R24a, R24c, R24f
- **First task:** verify against the installed `better-auth` source that ALS context survives into `databaseHooks` and `sendMagicLink`, and that `session.create.after`, `accountLinking` and `rateLimit.enabled` exist with these names. Record the findings with file:line from `node_modules`
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
- **Path:** `ModeGate.tsx`, `SignIn.tsx`, `AccountPanel.tsx` (sign-out + delete), `lib/authClient.ts`, `api.ts` (add `getAccessState`, `redeemInvite`, `deleteAccount`; `checkAccess` unchanged), `main.tsx`
- **Purpose:** R24 UI
- **Dependencies:** D4 contracts
- **Estimated Size:** ~450 lines

### D7 Error tracker
- **Path:** `backend/src/errorTracker.ts`
- **Purpose:** R25b, R25d
- **Dependencies:** D1
- **Estimated Size:** ~120 lines

### D8 Deploy & verification
- **Path:** `render.yaml`, `scripts/verify-hosted.sh`, `docs/runbooks/phase-6-hosted-setup.md` (Render, Postgres plan, Resend domain, Google/Discord OAuth apps, Sentry, UptimeRobot, Console limit, proxy-hop observation, repo-move re-link, processor retention), `.env.example`, README
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
| 1 | Which request fields does a Better Auth databaseHook `ctx` expose, and does ALS context survive into it? | Non-blocking | Don't rely on `ctx`: ALS wrapper (Key Decisions) | D3's first task verifies ALS propagation with a test. If it fails, the fallback is `hooks.before` on the verify/callback endpoints, stashing the invite on a request-scoped map keyed by the verification token |
| 2 | Render's proxy hop count | Non-blocking | `TRUST_PROXY=1`, confirmed empirically in the runbook | The runbook step plus evidence |
| 3 | Does `magicLink({ disableSignUp })` block DB-level creation? | Non-blocking | Not used; the `user.create.before` invite hook is the single gate for all methods, and `sendMagicLink` gating (R24f) limits sends | None |
| 4 | Render plan ID for "Starter" (the Blueprint uses new IDs like `0.5c-512mb`; docs list legacy names) | Non-blocking | Use the ID shown in the Render dashboard at setup; the runbook records it | The runbook confirms it |
| 5 | Email sender domain for Resend (needs DNS on a domain the developer owns) | Non-blocking | Use Resend's onboarding sender for developer-only testing; the runbook sets up a real domain before Phase 9 invites | The runbook covers both |
| 6 | Custom domain vs `onrender.com` | Non-blocking | `onrender.com` for Phase 6 (developer-only); custom domain later | `ALLOWED_HOSTS`/`BETTER_AUTH_URL` are env-driven, so no code change |
| 7 | `@sentry/node` 11 option names (`defaultIntegrations`, test transport) | Non-blocking | Verify in the installed package before use (R25b) | D7 task 1 records them |

## Complexity Assessment
**Rating: Complex.** 12 requirement IDs (R23, R24a-f, R25a-d), 9 deliverables, a new runtime dependency set (`better-auth`, `pg`, `node-pg-migrate`, `@sentry/node`), a new database, a security-critical middleware order, and a live deploy with steps only the developer can do (OAuth apps, DNS, dashboard screenshots).

| Factor | Assessment |
|--------|------------|
| Security surface | High: auth, CSRF, invite race, session revocation, error-tracker leakage. Every one has a named test |
| Regression risk | Contained: the selfhost path is frozen and pinned by 377 unedited tests, smoke 7/7 and `selfhostNoPg` |
| Unknowns | 3 verified at build time (ALS propagation, Better Auth option names, Sentry option names), each with a recorded fallback |
| External steps | Render, Resend, Google, Discord, Sentry, UptimeRobot, Console limit: runbook-driven, each ending in an agent-run check |

**Recommended decomposition:** about 7 plans in **serial waves** (retro AI-5: parallel plans touching `server.ts`, `config.ts` or `package.json` collide). D1+D7 → D2 → D3 → D4+D5 → D6 → D8+D9, with D8's live steps gated on the developer.

## Revision History
| # | Section | Change | Reason |
|---|---------|--------|--------|
| 1 | R23 | `BETTER_AUTH_URL` required (https origin); passed to Better Auth explicitly along with `secret` and `trustedOrigins`; spoofed-host test | Security #1 (BLOCKER): an unset base URL lets forwarded headers redirect magic links |
| 2 | R25b, Key Decisions | Tracker rebuilt from an allow-list; free-form fields dropped; `defaultIntegrations: false`; breadcrumbs null | Security #2 + QA #2 (BLOCKER): `redact()` can't remove per-request values |
| 3 | Key Decisions, API | `checkAccess` keeps `'required'` and adds `'signin'`; `ModeGate` wraps `AccessGate` | QA #1 (BLOCKER): renaming broke `api.test.ts:608` / `AccessGate.tsx:51,103` |
| 4 | R24c, SQL | `expires_at` default 14 days, checked in the reservation | QA #3 (BLOCKER) |
| 5 | CI | `release.yml` also gets the Postgres service and `test:hosted` | QA #4 (BLOCKER): the release test job would fail |
| 6 | R23 | Take every secret first, then validate the mode | QA #5 |
| 7 | Test DB | Separate `test:hosted` (fails when unset, 0-skip assertion); `setupFiles` clears hosted env | QA #6, #8 |
| 8 | R25d | Secrets ≥ 32 chars; 3-secret overlap test; DB URL + decoded password redacted; forced-error test | QA #7, Security #8 |
| 9 | Acceptance | `repeats: 20`; scripted mutations with revert; 2 s timeouts | QA #9 |
| 10 | Invite atomicity | Nonce-scoped retryable reservation; compensating delete; purge reconciliation | QA #10, Security #9 |
| 11 | R24d, Purge | `cookieCache` off + immediate-401 test; `pg_try_advisory_xact_lock` on a dedicated client; `verification` rows purged | QA #11, Security #6, #14 |
| 12 | Migrations | `migrate.ts` independent of config; pinned CLI; down migrations; runtime deps asserted | QA #12, #13, #16 |
| 13 | Invite carrier | `__Host-` cookie, HMAC via HKDF from `BETTER_AUTH_SECRET`, no raw code, cross-device error | QA #14, Security #13 |
| 14 | R24f (new) | Magic-link send gating + per-email cap; `emailVerified` check; account-linking pinned; IPv6 /64; per-user limiter; Better Auth limiter off | Security #4, #5, #14; QA #15 |
| 15 | Order | Webhook slot moved before the Origin check (exact path/method); `redeem` before the gate with 1 KB limit; exemption list removed | Security #3, #12 |
| 16 | R24b | Origin compared with the public origin; missing/`null`/cross-site rejected; login-CSRF on verify documented as accepted risk | Security #10, #11 |
| 17 | R24c | 128-bit codes, strict input pattern, redeem limiter | Security #7, QA #15 |
| 18 | Compatibility | `selfhostNoPg` test mechanism specified | QA #17 |
| 19 | R24a, D6 | `storeToken: 'hashed'`; sign-out UI | Security #13, QA #16 |
| 20 | Frontend, API, Compatibility | `checkAccess` left unchanged; `'signin'` and `hosted` moved to a new `getAccessState()`; `Soulbound-Mode` header on hosted `/api/access` | Found while planning (06-CONTEXT addendum): `AccessGate.tsx:51,70` types its state to the three existing values, and the spec had no way for a signed-in client to know it was hosted |
| 21 | Invite atomicity, DB, R25d, R24e, R25b, flow | `reserved_email` added; reconciliation joins on it, only for expired reservations, and fails closed. Invite link uses a fragment (`/#invite=`), stripped before the first fetch. `Referrer-Policy: no-referrer` on hosted responses. Non-auth hosted secrets must be ≥ 16 chars (auth secret ≥ 32). Tracker enabled only in hosted mode, with a frame allow-list. Webhook slot matches the exact path; the Origin check is mounted with `app.use('/api')`. The ALS fallback is keyed by token/`state`. Blueprint DB `ipAllowList: []`; `/api/debug/ip` behind a flag replaces the temporary logging patch | Plan critique (QA REWORK, security BLOCK): the nonce-only reconciliation could mark the wrong invite (both reviewers); Express 5 routes are case-insensitive; per-request values in frame names; query-string invites leak to logs and Referer |
| 22 | R24a, R24c, R24d, R24f, Deletion flow | **S1:** the session gate reads with `disableRefresh`, so only the browser's own `GET /api/auth/get-session` rolls the session (it is the only response that can carry the renewed cookie). **S2:** the invite-path send cap is keyed on the invite id (3 per 15 min per invite, however often it is re-redeemed), plus a process-wide ceiling of 30 invite-path sends per hour; the per-address limit uses separate maps for existing accounts and new addresses, so invite traffic can't overflow returning players' bucket. **S3:** Google stays a trusted linking provider; an `account.create.before` hook refuses a Google account row unless its ID token's `email_verified` is `true`. **S4:** the purge also deletes `verification` rows past `expiresAt` (injected clock, same transaction). **S5:** an invite-path send records `(inviteId, nonce, email)` in memory for the link's 300 s lifetime, and a magic-link sign-up must match it (OAuth sign-ups send no email and are unaffected) | Phase 6 review cycle 1 (S1-S4 WARNING; S5 security SUGGESTION, applied). S3 option chosen by the developer: "keep Google trusted, add a check" |
