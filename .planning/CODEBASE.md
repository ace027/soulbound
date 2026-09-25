# Codebase Map — The Soulbound Chronicles

```yaml
map_schema_version: 1
generated_at: "2026-09-25"
analyzed_commit: 7e98d587a8ea1b1003fec46cd28b57540e02972e   # code identical to main @ 89219af (PR #7)
source_file_count: 106
source_fingerprint: b8114726c56afe93
source_fingerprint_kind: sha256(sorted git blob hashes of tracked .ts/.tsx outside .planning/)[:16]
scope: full-project
symbol_count: 294
chunk_count: 106
```

> **Refreshed after Phase 6 (hosted mode and accounts, merged as PR #7).** The previous map
> (`35ac809`, fingerprint `76035132f82dfdd9`, 63 files) predated hosted mode entirely. 43 files are
> new: 7 hosted backend modules, 2 ops scripts, 5 frontend modules, 1 hosted Vitest config, and 28
> tests/helpers/e2e specs. All counts below are derived; each carries its command.

---

## Architecture

A TypeScript monorepo in three npm workspaces, migrated from a single 1,440-line React artifact.
Phases 1-4 finished the migration, Phase 5 made one publishable image behind a passphrase, and
Phase 6 added a **second deployment mode** alongside it.

```
shared/     ← the contract. Zod schemas + derived JSON Schema + game-state types + gate constants.
  ↑     ↑
backend/  frontend/
```

`shared/` is imported by both sides and imports neither. The World Voice JSON field names exist
once, so prompt/parser drift becomes a compile error rather than a runtime surprise.

### Two modes, one image

`SOULBOUND_MODE` (read in `backend/src/config.ts`) picks the mode at boot:

| | `selfhost` (default) | `hosted` |
|---|---|---|
| Who | one deployer, their own key | many players, operator's key |
| Gate on `/api/*` | passphrase (`accessGate.ts`) | session cookie (`hostedGate.ts` + Better Auth) |
| 401 code | `PASSPHRASE_REQUIRED` | `SIGN_IN_REQUIRED` |
| Storage | none server-side; saves in `localStorage` | Postgres 16 (accounts, invites, deletions); saves **still** `localStorage` until Phase 7 |
| Frontend | `AccessGate` passphrase form | `ModeGate` → `SignIn` / account panel in the Soul Codex |
| Status | **frozen** at Phase 5 behaviour | built, reviewed, live deploy checks untested |

Self-host is frozen by construction, not convention: its pre-Phase-6 tests are unedited,
`selfhostNoPg.test.ts` proves it never loads `pg`/Better Auth/Sentry, `selfhostHeaders.test.ts`
proves it emits none of hosted's headers, and `App.tsx` stayed byte-identical to `7856b7d` through
Phase 6 (the freeze was lifted 2026-09-25 for the return-to-title fix). Hosted
packages (`pg`, `better-auth`, `@sentry/node`) and the modules that pull them in (`db.ts`, `auth.ts`,
`invites.ts`, `account.ts`) load by dynamic `import()` only when `MODE === 'hosted'`.

**Self-host request path**: `frontend/src/lib/api.ts` (adds `Authorization: Bearer <passphrase>`) →
Express: Host allow-list → CORS → `/api/health` → rate limiter → passphrase gate → `express.json`
→ `backend/src/routes/*` → `callWorldVoice()` → Anthropic SDK. Limiter and gate run **before**
body parsing, so an unauthenticated 1 MB body gets 401, not 413.

**Hosted request path** — 15 pinned steps in `buildApp()` (`backend/src/server.ts`):
`trust proxy` → Host allow-list → frame headers (+ `Soulbound-Mode: hosted` on `/api/access`) →
CORS → `/api/health` → per-IP limiter (IPv6 grouped by /64) → reserved `POST /api/billing/webhook`
slot (exact path, raw body, 404 until Phase 11) → Origin check → `POST /api/invites/redeem` (own
limiter, 1 KB body) → 16 KB auth byte cap + Better Auth at `/api/auth/*` (before `express.json`) →
session gate (`disableCookieCache` + `disableRefresh`) → per-user limiter → `express.json` →
`/api/access`, `DELETE /api/account` → game routers. Each position is pinned by
`backend/src/__tests__/hosted/hostedOrder.test.ts` and proven by `scripts/mutate-order.sh`
(unmutated baseline first, then each move must be caught by a named test).

**Serving**: with `STATIC_DIR` set, the backend also serves the built frontend. `/api/*` can never
return `index.html`: the `/api` JSON 404 is mounted before the static block.

The frontend never talks to `api.anthropic.com`, and players never hold an Anthropic key in either
mode. A test asserts the first; CLAUDE.md's auth section settles the second.

## Module structure

| Path | Domain | Role |
|---|---|---|
| `shared/src/worldVoice.ts` (386) | contract | Zod schemas, derived JSON Schemas, `assertWorldVoiceContract` |
| `shared/src/gameState.ts` (201) | contract | Race/Skill/GameState/LogEntry/SaveSlot, save keys, `TIER_STYLE` |
| `shared/src/accessGate.ts` (65) | contract | Passphrase constants, plus (Phase 6) `SIGN_IN_REQUIRED`, `ORIGIN_REJECTED`, `INVITE_*`, `ACCOUNT_PATH`, `INVITE_CODE_PATTERN`, `MODE_HEADER`, `SoulboundMode` |
| `backend/src/anthropic.ts` (529) | backend | `buildSystemBlocks()` (1h TTL), per-route `EFFORT`, `callWorldVoice()`, typed error taxonomy |
| `backend/src/config.ts` (966) | backend | `MODELS`, `MODE`, key/passphrase/hosted-secret loading (deleted from `process.env` before validation), `redact()`, `getHostedSecrets()` |
| `backend/src/accessGate.ts` (215) | backend | Self-host: `createRateLimiter` (fixed window, key cap, injectable `keyFor`) and `createAccessGate` |
| `backend/src/server.ts` (889) | backend | `buildApp()` for both modes, `HostedDeps`/`buildHostedDeps`, `authBodyCap`, graceful shutdown (110 s drain), `debugIpHandler` |
| `backend/src/routes/*.ts` | backend | Three World Voice routes on one helper |
| `backend/src/data/*.ts` | prompt-data | `WORLD_LORE`, `WORLD_SYSTEM_PROMPT` |
| `backend/src/untrustedText.ts` (80) | backend | Player-text delimiting; prompt-injection guard |
| `backend/src/auth.ts` (607) | backend-hosted | **New.** One Better Auth 1.7.6 instance: magic link (Resend), Google + Discord, 25 `disabledPaths` + path allow-list, invite binding, `googleEmailVerified` hook, encrypted OAuth tokens, ID tokens nulled |
| `backend/src/invites.ts` (349) | backend-hosted | **New.** 128-bit codes stored as SHA-256, HMAC-signed `__Host-sb_invite` cookie (HKDF key), reserve → consume → compensate → reconcile, send caps |
| `backend/src/hostedGate.ts` (253) | backend-hosted | **New.** Host/frame/mode headers, Origin check, session gate, per-user limiter, `ipv6Slash64`, exact webhook path |
| `backend/src/account.ts` (236) | backend-hosted | **New.** `DELETE /api/account` (7-day grace, revoke all sessions, cancel on sign-in), hourly purge under `pg_try_advisory_xact_lock` |
| `backend/src/db.ts` (203) | backend-hosted | **New.** `createPool` (max 10, 5 s connect timeout), `assertNoPendingMigrations` — hosted refuses to boot with any pending |
| `backend/src/migrate.ts` (96) | backend-hosted | **New.** Render `preDeployCommand` entrypoint (`node /app/backend/dist/migrate.js`) |
| `backend/src/errorTracker.ts` (260) | backend-hosted | **New.** `@sentry/node` 11, hosted only; events rebuilt from an allow-list, `dataCollection` all off |
| `backend/src/scripts/*.ts` | backend-ops | **New.** `invite:create` and `tracker:test` operator scripts |
| `backend/migrations/*.sql` (2) | database | `001` Better Auth schema (CLI `auth@1.7.6`), `002` `invites` + `account_deletions`. Append-only once deployed |
| `frontend/src/main.tsx` | frontend-app | `<ModeGate><AccessGate><App/></AccessGate></ModeGate>` |
| `frontend/src/App.tsx` (375) | frontend-app | 16 `useState` + 1 `useRef`; all handlers. Byte-identical to `7856b7d` through Phase 6; since 2026-09-25 it also has `handleReturnToTitle` |
| `frontend/src/components/ModeGate.tsx` (135) | frontend-components | **New.** Reads `Soulbound-Mode` from `/api/access`; hosted → `SignIn` or the game with `HostedAccountContext`; self-host → no extra DOM |
| `frontend/src/components/SignIn.tsx` (380) | frontend-components | **New.** Magic link / Google / Discord; invite from `#invite=` (stripped before the first fetch); renders only known error codes |
| `frontend/src/components/AccountPanel.tsx` (157) + `hostedAccount.tsx` (26) | frontend-components | **New.** Inline "Account" section at the end of the Soul Codex (sign-out, arm → Confirm/Cancel delete), reached via context so `App.tsx` stays untouched |
| `frontend/src/components/AccessGate.tsx` (285) | frontend-components | Self-host passphrase form; fails open on an unreachable server |
| `frontend/src/lib/api.ts` (534) | frontend-io | Backend client; Bearer header, `checkAccess`, `getAccessState`, `redeemInvite`, `deleteAccount`, `emitSignInRequired` |
| `frontend/src/lib/authClient.ts` (150) | frontend-io | **New.** Better Auth client; sign-out result type; 12 h session refresh |
| `frontend/src/lib/saves.ts` (166) · `passphrase.ts` (84) | frontend-io | `localStorage` saves on byte-identical keys; stored passphrase |
| `frontend/src/game/*.ts` | game-logic | `applyWorldUpdate` (R10) and `mergeNarrativeMemory` (the one ledger merge) |
| `frontend/src/screens/*.tsx` | frontend-screens | Five phase screens, verbatim port |
| `frontend/src/components/SoulCodexContents.tsx` | frontend-components | Verbatim port; its **one** addition is `<HostedAccountSlot/>` at the end |
| `frontend/e2e/*.spec.ts` (3) | frontend-e2e | `smoke` (layout), `hosted` (ModeGate/SignIn/Account), `pageFrame` (no browser-default body margin) |

Line counts are `wc -l`. Outside TypeScript: `backend/Dockerfile`, `render.yaml` (Render Blueprint:
Docker, `branch: main`, `autoDeployTrigger: checksPass`, Postgres "16", `maxShutdownDelaySeconds:
120`), `scripts/{smoke-image,test-db,verify-hosted,mutate-order}.sh`, `.github/workflows/ci.yml`
(build-and-test incl. `test:hosted` on a postgres:16 service, smoke-image incl. hosted smoke, e2e),
`.github/workflows/release.yml` (dispatch-only GHCR publish, never run), `compose.selfhost.yml`,
`docs/runbooks/phase-6-hosted-setup.md` (14 steps, all UNTESTED).

## Dependency graph

`shared/` is the hub: **28 of 52** non-test, non-shared TypeScript files import
`@soulbound/shared`, and it imports nothing internal.

```bash
grep -rl '@soulbound/shared' --include=*.ts --include=*.tsx frontend/src backend/src shared/src \
  | grep -vE '__tests__|\.(test|spec)\.' | wc -l                        # -> 28
git ls-files '*.ts' '*.tsx' | grep -v '^\.planning/' \
  | grep -vE '__tests__|\.(test|spec)\.|/e2e/' | grep -v '^shared/' | wc -l   # -> 52 (incl. configs)
```

**Hosted isolation edge**: `server.ts` statically imports `hostedGate.ts` and `errorTracker.ts`
(plain middleware and a tracker whose Sentry import is itself dynamic), plus `import type` from
`auth.ts` and `pg`. It reaches `db.ts`, `auth.ts`, `invites.ts`, `account.ts` and `better-auth/node`
only through dynamic `import()` in the hosted branch (`server.ts:664-680`, `:870`). A static value
import of any of those from a self-host path breaks `selfhostNoPg.test.ts` — keep it that way.

**One cycle exists and it is type-only**: `App.tsx` → `SimulationScreen.tsx` / `SoulCodexContents.tsx`
→ `App.tsx`, via `import type { Phase }`, which TypeScript erases. If `Phase` ever needs to move,
`shared/src/gameState.ts` is the natural home.

## Route surface

| Route | Mode | Notes |
|---|---|---|
| `POST /api/unique-skill` | both | `claude-opus-5`, effort `medium`, **no system param** (CLAUDE.md #8) |
| `POST /api/world-engine` | both | `claude-sonnet-5`, effort `high`, `buildSystemBlocks()` |
| `POST /api/intro-scene` | both | Same model/effort/namespace as world-engine |
| `GET /api/access` | both | Self-host: 204 / 401 `PASSPHRASE_REQUIRED`. Hosted: 204 / 401 `SIGN_IN_REQUIRED`, always with `Soulbound-Mode: hosted` |
| `GET /api/health` | both | Liveness only, outside every gate. Does **not** prove reachability |
| `/api/auth/*` | hosted | Better Auth; only allow-listed paths answer, 25 are disabled |
| `POST /api/invites/redeem` | hosted | Before the session gate; 5/min, 1 KB; sets `__Host-sb_invite` |
| `DELETE /api/account` | hosted | Schedules deletion (7 days) and revokes every session |
| `POST /api/billing/webhook` | hosted | **Reserved** for Phase 11; 404 today, exact path + POST only, before the Origin check |
| `GET /api/debug/ip` | hosted | Only with `DEBUG_PROXY_HOPS=1` (runbook step 5, proxy-hop probe) |

Model rules unchanged: models only in `config.ts`'s `MODELS`, effort only in `anthropic.ts`'s
`EFFORT`; world-engine and intro-scene must share a model **and** effort (pinned by
`config.test.ts`). The split has reversed twice deliberately — do not "correct" it. Cached prefix:
re-derive with `count_tokens` whenever `WORLD_SYSTEM_PROMPT` or `WORLD_LORE` changes.

## Configuration

All read in `backend/src/config.ts` unless noted. Secrets are deleted from `process.env` once read
and stripped from logs by `redact()` (`redact.test.ts` covers every hosted secret).

| Variable | Mode | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | both | Fail-fast. **On the host set `SOULBOUND_ANTHROPIC_KEY`**; compose maps it through. Nothing loads `.env` into a host-run Node process |
| `SOULBOUND_MODE` | both | `selfhost` (default) or `hosted`; anything else fails boot |
| `SOULBOUND_PASSPHRASE` | selfhost | Required (12+ printable ASCII). Not read in hosted mode |
| `RATE_LIMIT_PER_MINUTE` | both | Per-IP, default 30, range 1-600 |
| `TRUST_PROXY` | both | Opt-in hop count or subnet; `true` rejected. Render needs the value runbook step 5 measures |
| `STATIC_DIR`, `PORT`, `FRONTEND_ORIGIN`, `ALLOWED_HOSTS` | both | As in Phase 5 |
| `DATABASE_URL` | hosted | Postgres ≥ 16. Pool max 10 (`POOL_MAX_CONNECTIONS`), 5 s connect timeout |
| `BETTER_AUTH_SECRET` | hosted | ≥ 32 chars; also the HKDF root for the invite-cookie key |
| `BETTER_AUTH_URL` | hosted | Public origin; becomes `HOSTED_PUBLIC_URL` and the Origin-check allow value |
| `RESEND_API_KEY`, `EMAIL_FROM` | hosted | Magic-link email. `EMAIL_FROM` is one address, optional display name, one line |
| `GOOGLE_CLIENT_ID/SECRET`, `DISCORD_CLIENT_ID/SECRET` | hosted | OAuth providers. Google stays in `trustedProviders`, guarded by `googleEmailVerified` |
| `SENTRY_DSN` | hosted | Optional. Unset → no Sentry SDK is loaded |
| `USER_RATE_LIMIT_PER_MINUTE` | hosted | Per-user after the session gate, default 60, range 1-600 |
| `DEBUG_PROXY_HOPS` | hosted | Read in `server.ts` `main()`; `=1` mounts `/api/debug/ip`. Runbook step 5 only — unset afterwards |
| `TEST_DATABASE_URL` | tests | Hosted suite only (`vitest.hosted.config.ts`); `requireTestDb.ts` fails the run without it |

Production values live in `render.yaml` (Blueprint). **Dashboard edits are overwritten by the next
Blueprint sync** — change variables in `render.yaml` on `main`.

## Test map

**553 default tests + 182 hosted + 16 e2e**, each derived by running it on this commit:

| Suite | Command | Result |
|---|---|---|
| Backend (self-host) | `npm test -w @soulbound/backend` | 304 passed, 18 files |
| Frontend (jsdom) | `npm test -w frontend` | 249 passed, 16 files |
| Hosted (real Postgres) | `URL=$(scripts/test-db.sh) && TEST_DATABASE_URL=$URL npm run test:hosted -w @soulbound/backend` | 182 passed, 0 skipped (`assert-no-skips.mjs` fails the run on any skip) |
| E2E (Playwright) | `npx playwright test --list` in `frontend/` | 16 tests in 3 files |

CI runs all four (`ci.yml`: `build-and-test` with a `postgres:16` service, `smoke-image` incl. the
hosted smoke, `e2e`). The default backend config excludes `src/__tests__/hosted/`, so `npm test`
never needs a database.

Every non-test module in `lib/`, `game/`, `hooks/`, `components/` and `screens/` has a paired
`__tests__/` file. `App.tsx` has no unit test by design — `appIntegration.test.tsx` drives the real
component. Tests are mutation-validated rather than coverage-measured: `applyWorldUpdate.test.ts`
carries 14 `// MUTANT:` annotations (`grep -c MUTANT`), and Phase 6's review ran 31 reviewer
mutations (`06-REVIEW.md`).

**Two layout suites, two jobs:** jsdom guards the *declaration* (a removed `flex: 1` or
`minHeight: 0`); Playwright guards the *consequence* (real overflow, scrolling, action-bar position,
no collapsed panel, no page frame). jsdom does no layout.

Constraint and freeze guards:

| Guard | File | Catches |
|---|---|---|
| CLAUDE.md #1 / #2 | `frontend/src/__tests__/constraints.test.ts` | `window.confirm/alert/prompt` (incl. bare globals), `window.storage` |
| CLAUDE.md #4 | `backend/src/__tests__/contract.test.ts` | Prompt/schema drift |
| CLAUDE.md #6 | `backend/src/__tests__/prompts.test.ts` | Deletion of any named balance rule |
| CLAUDE.md #8 | `backend/src/__tests__/anthropic.test.ts` | Any `system` key on unique-skill |
| Model pair | `backend/src/__tests__/config.test.ts` | world-engine / intro-scene on different models or effort |
| Self-host freeze | `selfhostNoPg.test.ts`, `selfhostHeaders.test.ts` | Hosted packages or headers leaking into self-host |
| Hosted order | `hosted/hostedOrder.test.ts` + `scripts/mutate-order.sh` | Any of the 15 steps moved |
| Shutdown drift | `shutdownDrift.test.ts` | `SHUTDOWN_TIMEOUT_MS` (110 s) not below `render.yaml`'s `maxShutdownDelaySeconds` (120) |
| Google takeover | `googleEmailVerified.test.ts` + `hosted/auth.test.ts` | Linking a Google identity whose ID token lacks `email_verified: true` |
| Page frame | `frontend/e2e/pageFrame.spec.ts` | The 8px browser-default body margin returning |

The three prompt render functions are pinned byte-for-byte by
`backend/src/__tests__/fixtures/*.prompt.txt`. Regenerate from the render function after an
intentional prompt change; never hand-edit a fixture.

## Risk areas

| Risk | Where | Why |
|---|---|---|
| **Hosted live checks are UNTESTED** | `docs/runbooks/phase-6-hosted-setup.md`, `render.yaml` | Render, Resend, Google/Discord apps, Sentry, UptimeRobot and the Console spend limit need the developer's accounts. All 14 steps await the developer; the agent verifies each |
| **Middleware order is the security model** | `server.ts` `buildApp()` | Both modes. Hosted's 15 steps are pinned; moving one (e.g. Better Auth after `express.json`, the webhook after the Origin check) is caught only because mutations proved the tests exist. Never move a step to make a change fit — flag it |
| **Login CSRF into an existing account** | `auth.ts` magic-link verify (a GET) | Carried to Phase 7 as a ROADMAP success criterion. Invite theft via this path is closed (invite bound to the emailed address) |
| **`localStorage` saves are not account-scoped** | `frontend/src/lib/saves.ts` | Accepted until Phase 7: on a shared device the next hosted player sees the previous player's saves |
| **In-memory state assumes one instance** | `hostedGate.ts` limiters, `invites.ts` send caps, `auth.ts` invite↔email binding (300 s) | Correct on one Render instance. Scaling out, or a restart mid-flow, loses them — move to Postgres/Redis before running more than one |
| **Invite atomicity** | `invites.ts` | Reserve → consume → compensating delete → reconcile (expired reservations only, matched on `reserved_email`). Changing one step without the others can burn or double-spend an invite |
| **Migrations are append-only, expand then contract** | `backend/migrations/` | The pre-deploy migrates while the old version still serves. Never edit an applied file; never drop what the running version still uses in the same deploy |
| **Better Auth is pinned exactly (1.7.6)** | `backend/package.json`, `001_better-auth.sql` | 001 was generated by the matching CLI. An upgrade needs a new migration from the new CLI, and a re-check of `disabledPaths`, the hooks and the `NODE_ENV=test` origin-check override |
| **Self-host is frozen** | pre-Phase-6 tests, `App.tsx` | Editing a self-host test or `App.tsx` to fit a hosted change breaks the freeze proof. `SoulCodexContents.tsx`'s `<HostedAccountSlot/>` is the one sanctioned addition |
| **Verbatim-port docstrings are load-bearing** | `App.tsx`, `applyWorldUpdate.ts`, components, screens | They record why apparent bugs are deliberate. "Cleaning" them reverses decisions |
| **69 citations point at a deleted file** | 13 source files | Resolve via git — see "The retired oracle" |
| **Inherited closure race, knowingly unfixed** | `App.tsx` `handleAction` / `handleManualSave` | Declined at the Phase 4 gate. Do not fix without asking |
| **Constraint 3 depends on no `#root` rule** | `frontend/src/index.css` | `display: flex` there breaks both layout roots' scroll chains. The e2e spec catches it; jsdom cannot |
| **The first GHCR publish has never run** | `.github/workflows/release.yml` | Do not dispatch until the repo moves off `DeanItServices` |
| **Hardcoded owner** | 4 `deanitservices` references | Update only when the repo moves |
| **A green healthcheck ≠ reachable** | `server.ts` | Check the proxied path, not localhost |

## Conventions

- **Single quotes** in `.ts` and new `.tsx`; **double quotes** in ported `.tsx` (legacy, deliberate).
- **No native dialogs, ever** (CLAUDE.md #1) — account deletion is arm → inline Confirm/Cancel.
- **Module headers explain *why***, cite spec requirement IDs (`R24a`…) and plan IDs (`06-05`), and
  in ported files cite artifact line numbers.
- **Hosted additions never edit self-host code paths**; they branch on `MODE` inside `buildApp()`
  or arrive through context (`HostedAccountContext`).
- **Error codes are shared constants** (`shared/src/accessGate.ts`); the frontend renders only codes
  it knows, never server text.
- **Counts and ranges are derived, never restated.** A number in prose carries its command.
- **A fix is a claim** and carries the same derivation burden as a finding.
- **Save-key constants come from `@soulbound/shared`** — except `saves.test.ts`, which hand-writes
  them on purpose.
- **Mutation checks restore with `cp` plus a hash check**, never `git checkout`.
- **Inline styles port verbatim.** Styling-system changes are out of scope.
- `noUnusedLocals` is **not** set in `frontend/tsconfig.json`; run
  `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` to find dead imports.

## The retired oracle

`legacy/souldbound-world.jsx` was the parity oracle — the behavioural reference the port was diffed
against. **It was deleted at the close of Phase 4**, once parity was confirmed against a live
playthrough. Nothing imported it; it was never built, typechecked or tested.

13 source files still cite its line numbers in docstrings (69 citations —
`git grep -hoE 'legacy [0-9]+(-[0-9]+)?' HEAD -- frontend/src shared/src backend/src | wc -l`). They resolve through git:

```bash
git show 3d01fa5:legacy/souldbound-world.jsx                        # the whole file
git show 3d01fa5:legacy/souldbound-world.jsx | sed -n '1022,1027p'  # a cited range
```

`3d01fa5` is an ancestor of the shipped branch, so this works in any clone. A `parity-oracle` tag
points at the same commit but is **local-only** — tag pushes fail from the agent environment, so
never assume it exists. **Do not rebase this branch**: nine documents reference that SHA by name,
and a rewrite silently breaks every one of them.

## Runbook

```bash
npm install                          # workspace root
npm run build -w @soulbound/shared   # required before either side typechecks
npm test                             # 553 tests, jsdom + backend, no browser, no database
npm run test:e2e -w frontend         # 16 Playwright tests, real layout, zero API calls

# hosted suite (needs PostgreSQL 16 binaries; CI uses a postgres:16 service instead):
URL=$(scripts/test-db.sh) && TEST_DATABASE_URL=$URL npm run test:hosted -w @soulbound/backend
scripts/test-db.sh --stop
scripts/mutate-order.sh              # proves each hosted middleware step is pinned

cd frontend && npx vite              # dev server, proxies /api to the backend
cd backend  && npm run dev           # self-host: ANTHROPIC_API_KEY + SOULBOUND_PASSPHRASE exported

# hosted operator scripts:
npm run invite:create -w @soulbound/backend [-- --days N]
npm run tracker:test  -w @soulbound/backend

# single image, as published:
docker build --secret id=npm_ca,src=${NPM_CA_FILE:-/dev/null} -f backend/Dockerfile -t soulbound:local .
scripts/smoke-image.sh soulbound:local     # 7 checks; uses fake keys
scripts/verify-hosted.sh <url> [--session] # checks a running hosted deployment (CI + runbook)

# Docker in this sandbox needs starting by hand:
setsid nohup dockerd > /tmp/dockerd.log 2>&1 < /dev/null &
export NPM_CA_FILE=/root/.ccr/ca-bundle.crt
```

In the agent sandbox, strip the real key from every test run:
`env -u SOULBOUND_ANTHROPIC_KEY -u ANTHROPIC_API_KEY npm test`. Never print environment variables.

Hosted deploy: `render.yaml` + `docs/runbooks/phase-6-hosted-setup.md`. Render runs
`node /app/backend/dist/migrate.js` as the pre-deploy step, and the app refuses to boot with a
pending migration.

Never `docker system prune` without a re-pull path. Playwright uses the sandbox's prebuilt
Chromium; **never run `npx playwright install`**. Never `pkill -f`; kill by PID.
