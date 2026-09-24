# Phase 6: Hosted Mode & Accounts — Context

**Goal**: Turn the Phase 5 single-tenant image into a two-mode app. `SOULBOUND_MODE=selfhost` (the
default) behaves exactly as Phase 5 shipped. `SOULBOUND_MODE=hosted` replaces the passphrase with
invite-only player accounts (Better Auth on Postgres: magic link via Resend, Google, Discord),
account deletion with a 7-day grace period, anti-framing headers, a redacted error tracker, and a live
Render deployment.

**Requirements**: R23 mode switch · R24a sign-in · R24b Origin/CSRF · R24c invite-only · R24d account
deletion · R24e anti-framing · R24f abuse controls · R25a Render deploy · R25b error tracker · R25c ops
baseline · R25d secret hygiene

**The spec is the primary source**: `.planning/specs/06-hosted-mode-accounts-spec.md` (`7c737a6`).
It has the 15-step hosted middleware order, every contract, the SQL, failure modes and acceptance
checks. It was critiqued once (QA REWORK and security CAUTION, 6 blockers in total), and all findings
were applied (Revision History rows 1-19). **Read it before your plan.** Where this file and the spec
disagree, the spec wins, except for the one addendum below. Report any disagreement you find rather
than choosing a side.

**Phase base commit**: `7c737a6`. Baseline, derived by running `npm run build && npm test` at that
commit: **187 backend + 190 frontend = 377 passing**. `frontend/src/App.tsx` must stay byte-identical
to `7856b7d`. The frontend e2e suite (`npm run test:e2e --workspace frontend`) runs 6 tests.

---

## Decisions already made — do not reopen

| Decision | Made by | Where recorded |
|---|---|---|
| Hosted mode exists: accounts, server saves (Phase 7) and Stripe (Phase 11) alongside an unchanged self-host mode. The operator's key stays on the backend; BYOK stays rejected | developer, 2026-09-24 | `CLAUDE.md` → Auth architecture; design log "Hosted mode (2026-09-24)" |
| Better Auth (not Lucia, which is deprecated; not Auth.js, which is in security-only maintenance) | developer, explore session | design doc |
| Host: **Render** (after a pricing comparison) · Email: **Resend** | developer, `/legion:plan 6` | this file |
| **Architecture: Pragmatic + 2 from Clean**: a hosted branch inside `buildApp()`, `node-pg-migrate` with SQL files, a runtime `ModeGate`, and runbooks; from Clean, `withTestDb()` and a reserved webhook slot | developer, from three read-only proposals | spec → Overview, Key Decisions |
| 30-day rolling sessions, 7-day deletion grace, single-use invite codes | developer, explore session | spec R24a/c/d |
| Release workflow held until the repo moves to a personal GitHub; key rotation deferred to before Phase 9 invites | developer | `STATE.md` |

**Do not dispatch `release.yml`.** Do not raise key rotation. Do not open a PR unless asked.

## Planning addendum: spec gaps closed here (spec Revision History row 20)

The spec has `ModeGate` render `AccountPanel` "in hosted mode only", but once a player is signed in,
`GET /api/access` returns 204 in **both** modes. So the frontend can't tell which mode it's in.
Resolution (applied in 06-04 and 06-06):
- In hosted mode, every `GET /api/access` response (204 and 401) carries the header
  `Soulbound-Mode: hosted`. Self-host responses never carry it; a test asserts it is absent.
- `frontend/src/lib/api.ts` gains `getAccessState(): Promise<{ access: 'ok' | 'required' | 'signin' | 'unknown'; hosted: boolean }>`.
  **`checkAccess()` is left exactly as it is.** `AccessGate.tsx:51` types its state to
  `'pending' | 'ok' | 'required' | 'unknown'`, and `:70` stores `checkAccess()`'s result in it, so
  adding `'signin'` to `checkAccess` would break the build. A hosted 401 already maps to `'unknown'`
  (`api.ts:409`). Only `ModeGate` uses `getAccessState()`.
- The header name is added to `shared/src/accessGate.ts` as `MODE_HEADER = 'Soulbound-Mode'`, so both
  sides use one string.

Record this in the design-log entry (06-07).

## Facts derived for this phase (checked at `7c737a6`, cite by file:line)

1. **`config.ts` validates the passphrase unconditionally.** `rawPassphrase = takeEnv(...)` is at
   `config.ts:88`, and `validatePassphrase(rawPassphrase)` runs at module load at `:165`. Hosted mode
   must still take the value (so it never lingers in `process.env`), but must **reject** it rather
   than validate it (spec R23). `takeEnv` is at `:81-85`; `redact` at `:194`.
2. **`buildApp` takes config as a parameter, and `main()` imports config dynamically**
   (`server.ts:16-18` docstring, `:361-372`). Hosted dependencies (`pg`, `better-auth`,
   `node-pg-migrate`, `@sentry/node`) follow the same rule: **dynamic import behind the mode check**,
   never a top-level import in any module that self-host loads.
3. **Current mount order** (`server.ts`): trust proxy `:209`, Host allow-list `:216`, CORS `:226`,
   health `:240`, limiter `:247`, passphrase gate `:248`, `express.json` `:259`, `/api/access`
   `:264`, routers `:272-274`, `/api` 404 `:280`, static `:300`, global 404 `:315`, error handler
   `:346`.
4. **`AccessGate` fails OPEN on `'unknown'`** (`AccessGate.tsx:12`, `api.ts:387`). Today a hosted
   401 `SIGN_IN_REQUIRED` would read as `'unknown'` and render the app. `ModeGate` must intercept
   `'signin'` *before* `AccessGate` ever mounts. The server still enforces access, so this is a UX
   issue, not a security hole, but it must be tested.
5. **The frozen frontend tests pin `'required'`**: `frontend/src/lib/__tests__/api.test.ts:602-609`.
6. **The backend Vitest config has no `setupFiles`** (`backend/vitest.config.ts`). `config.test.ts`'s
   `resetEnv()` (`:21-34`) clears only the Phase 5 variables.
7. **The image `api` stage copies only `dist`** (`backend/Dockerfile:99-100`), after
   `npm ci --omit=dev`. So migrations need their own `COPY`, and `pg` + `node-pg-migrate` must be
   runtime `dependencies`. `runtime` (`:113`) is the last stage, and that's the one Render builds.
8. **Both workflows run `npm test`**: `ci.yml:38` (job `build-and-test` at `:15`) and
   `release.yml:63` (job `test` at `:32`). Both get the Postgres service.
9. **Sandbox Postgres**: the PostgreSQL 16 binaries are at `/usr/lib/postgresql/16/bin`. A `postgres`
   system user exists. The sandbox runs as root, and `initdb` refuses root.
10. **Sandbox process control**: `pkill -f <pattern>` kills the calling shell when the pattern matches
    its own command line (exit 144; happened twice in Phase 5). Find processes with
    `ps -eo pid,args | awk` and kill them by PID.
11. **Never print environment variables.** The sandbox holds a real Anthropic key. Run local
    docker/servers with `env -u SOULBOUND_ANTHROPIC_KEY -u ANTHROPIC_API_KEY` and a fake key.

## Guard audit at phase start (retro AI-7)

These are properties this phase introduces, and the plan that commits a guard for each. Nothing may
reach review without its guard.

| Property | Guard | Plan |
|---|---|---|
| Selfhost never loads `pg` / `better-auth` / `node-pg-migrate` / `@sentry/node` | `selfhostNoPg.test.ts` (`vi.doMock` throw) | 06-02 (06-03 and 06-01 extend it to their packages as they arrive) |
| No secret remains in `process.env`, even when the mode is invalid | `hostedConfig.test.ts` | 06-01 |
| Tracker payload has no secret, cookie, code, email or player text | `errorTracker.test.ts` canary | 06-01 |
| Only one account per invite, under a race | `invites.test.ts` `repeats: 20` | 06-03 |
| Magic link ignores `X-Forwarded-Host` | spoofed-host test | 06-03 |
| Middleware order (15 steps) | `hostedOrder.test.ts` + scripted mutations | 06-04 |
| Anti-framing headers are absent in selfhost | `hostedOrder.test.ts` or a selfhost server test (a **new** file) | 06-04 |
| An old cookie gets 401 immediately after deletion | `account.test.ts` | 06-05 |
| At most one purge holds the lock | `purge.test.ts` | 06-05 |
| `App.tsx` unchanged; existing tests unedited | `git diff 7856b7d -- frontend/src/App.tsx`; `git diff --stat 7c737a6 -- '*.test.ts' '*.test.tsx'` shows only new files | every plan |

## Carry-forward rules (retro 2026-09-18, all HIGH unless noted)

- **AI-1: a fix is a claim.** Before committing a fix, re-run the derivation that produced the
  finding (the mutation, the count, the curl).
- **AI-2: re-read your diff against the evidence you just committed**, not against your reasoning.
- **AI-3: derive every fact in a brief.** Every file:line in these plans was checked at `7c737a6`.
  If one has moved, trust the file and say so in your SUMMARY.
- **AI-4: test durability mechanisms in the target environment before documenting them.** A runbook
  step is not "done" until its closing check has actually run. Anything that can only run on the
  developer's accounts is recorded as **UNTESTED — awaiting developer**, never described as working.
- **AI-5: serial execution for any agent that modifies the tree.** All seven waves are serial.
- **AI-6: every plan writes a `SUMMARY.md`.**
- **Mutations never destroy work.** Commit before any mutation step. Back up the mutated file with
  `cp` and restore it with `cp`, never with `git checkout` (which reverts uncommitted work and can't
  restore untracked files). A plan critique finding (QA #1) showed four plans would have lost work.
- **Each plan's `<critique_revisions>` block is binding** and wins over the text above it.
- **Counts carry their derivation.** Every test count in a SUMMARY comes from runner output quoted
  next to it.

## The gate every plan must pass before its SUMMARY

1. `npm run build && npm test` → 187 backend + 190 frontend still pass, plus that plan's **new**
   self-host-runnable tests, which the SUMMARY lists by name.
2. From 06-02 onward: `scripts/test-db.sh` then `TEST_DATABASE_URL=… npm run test:hosted -w @soulbound/backend`
   → all pass, **0 skipped**.
3. `git diff 7856b7d -- frontend/src/App.tsx` is empty.
4. `git diff --stat 7c737a6 -- '*.test.ts' '*.test.tsx'` lists only **new** files. The one sanctioned
   exception is none: if an existing test must change, stop and report instead.
5. From 06-02 onward, if the plan touched the Dockerfile or `package.json`: `scripts/smoke-image.sh`
   7/7 (the Docker daemon permitting; if there's no daemon, say so and name the CI run that proves it).

## Plan structure

| Wave | Plan | Deliverables | Agent(s) |
|---|---|---|---|
| 1 | 06-01 Mode config & error tracker | D1, D7 (R23, R25b, R25d) | engineering-senior-developer + engineering-security-engineer |
| 2 | 06-02 DB, migrations, test harness | D2 | engineering-infrastructure-devops + engineering-senior-developer |
| 3 | 06-03 Better Auth & invites | D3 (R24a, R24c, R24f) | engineering-backend-architect + engineering-security-engineer |
| 4 | 06-04 Hosted gate & middleware order | D4 (R24b, R24e, order) | engineering-senior-developer + engineering-security-engineer |
| 5 | 06-05 Account deletion & purge | D5 (R24d) | engineering-backend-architect |
| 6 | 06-06 Frontend | D6 (R24 UI) | engineering-frontend-developer |
| 7 | 06-07 Deploy, runbook, records | D8, D9 (R25a, R25c) | engineering-infrastructure-devops + technical writer |

Waves are strictly serial. Every plan commits and pushes its own work to
`claude/legion-status-uxlaqo` (never rebase; never rewrite history). Commit trailers:
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
`Claude-Session: https://claude.ai/code/session_01Qvth63ypuSKXxYo98MbgCf`.
No model identifiers in commit messages or code comments.

## Architecture proposals
Three read-only proposals were generated (Minimal, Clean, Pragmatic). The developer chose **Pragmatic
+ 2 from Clean**. See the spec's Overview and Key Decisions.
