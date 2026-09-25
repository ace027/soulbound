# 06-07 Summary: Render Blueprint, verify-hosted.sh, runbook, records

## Status: Complete, except the live checks (awaiting developer)

Executed by engineering-infrastructure-devops, with the technical writer's work (runbook, design log,
CLAUDE.md). Everything the agent can do alone is built, proven locally and committed. Every step that
needs the developer's accounts (Render, Resend, Google, Discord, Sentry, UptimeRobot, the Anthropic
Console) is **UNTESTED — awaiting developer**. Nothing here claims a live check passed. Every count below
comes from runner output, quoted next to it.

`release.yml` was **not** dispatched. `compose.selfhost.yml:41` and `README.md` lines 68, 72 and 115 (the
`deanitservices` lines) are unchanged: `grep -n -i deanitservices` shows the same 4 lines as at `7c737a6`.

## Commits
| Commit | What |
|---|---|
| `15f9fb2` | `/api/debug/ip` behind `DEBUG_PROXY_HOPS=1` (`server.ts`), plus `hosted/debugIp.test.ts` (8 tests) |
| `b13214d` | `render.yaml`, `scripts/verify-hosted.sh`, `evidence/verify-hosted-local.txt`, `evidence/render-yaml-validation.txt` |
| `3e69d37` | `docs/runbooks/phase-6-hosted-setup.md`, `.env.example` hosted block, README "Hosted mode" section |
| `3a2465a` | Design-log entry, the CLAUDE.md paragraph, directory mappings |
| this commit | this SUMMARY |

## Files touched
| File | Change |
|---|---|
| `render.yaml` | New. A Docker web service `soulbound` built from the last stage (`runtime`), with `branch: main`, `autoDeployTrigger: checksPass`, `plan: 0.5c-512mb`, `numInstances: 1`, `healthCheckPath`, `preDeployCommand: node backend/dist/migrate.js`, `SOULBOUND_MODE`/`NODE_ENV`/`TRUST_PROXY` values, `DATABASE_URL` via `fromDatabase`, `ALLOWED_HOSTS` via a self-referencing `RENDER_EXTERNAL_HOSTNAME`, and 11 `sync: false` variables. Also a Postgres `soulbound-db`: `"16"`, `0.1c-256mb`, `ipAllowList: []` |
| `scripts/verify-hosted.sh` | New. `<url> [--session]`: 7 anonymous checks plus a session check. The cookie goes to curl on stdin. It never prints a body |
| `backend/src/server.ts` | `HostedDeps.debugProxyHops?`, `DEBUG_IP_PATH`, `debugIpHandler`; mounted right after the per-IP limiter only when set; `main()` sets it from `DEBUG_PROXY_HOPS === '1'` and logs one boot line |
| `backend/src/__tests__/hosted/debugIp.test.ts` | New, 8 hosted tests (critique revision 2) |
| `docs/runbooks/phase-6-hosted-setup.md` | New. 14 numbered steps, each with Do / Check / Status, plus operating notes |
| `.env.example` | A commented "Hosted mode (Render sets these; not needed for self-host)" block appended |
| `README.md` | A "Hosted mode" section added before "Expose the frontend on your LAN" |
| `docs/design-decisions-log.md` | New entry "Hosted mode — Phase 6 build (2026-09-24)" |
| `CLAUDE.md` | One paragraph added after the Phase 5 access-gate paragraph |
| `.planning/config/directory-mappings.yaml` | `backend/migrations` (`touch_with_care`: append-only once deployed) and `docs/runbooks` |
| `.planning/phases/06-hosted-mode-accounts/evidence/verify-hosted-local.txt`, `render-yaml-validation.txt` | New evidence |

**Outside the plan's `files_modified`: only the new test file.** `/api/debug/ip` needed a test, as
critique revision 2 required. `server.ts` is in the list.

**One deviation: `main()` reads `DEBUG_PROXY_HOPS` itself, not through `config.ts`.** `config.ts`
normally holds every env read, but it isn't in this plan's files, and the flag isn't a secret: it only
adds a probe. The comment at the read says so.

## Render keys (every one checked against Render's docs, 2026-09-24)
Sources:
- the Blueprint reference, https://render.com/docs/blueprint-spec, downloaded and grepped rather than
  summarised;
- Render's published JSON Schema, https://render.com/schema/render.yaml.json (sha256 `57aa0a1f…`);
- the pages on deploys, web services, the free tier, health checks, Docker and environment variables.

| Key | Confirmed | Evidence |
|---|---|---|
| `runtime: docker` | yes | spec: "`docker` for services that build an image from a Dockerfile"; schema `runtime` |
| `dockerfilePath`, `dockerContext` | yes | spec: "relative to the repo root… If omitted, Render uses `./Dockerfile`"; schema `serverService` properties |
| No Dockerfile target field (Render builds the last stage) | yes, by absence | the schema's `serverService` properties list has no target key; the negative control with a `dockerTarget` key is rejected |
| `healthCheckPath` | yes | spec: "Web services only… always starts with a `/`" |
| Health-check `Host` | yes | health-checks page: without a custom domain, "Render uses the service's onrender.com subdomain" |
| `preDeployCommand` | yes, **paid only** | deploys page: "available for paid web services, private services, and background workers"; it runs on a separate instance; a failure fails the deploy and the previous deploy keeps serving |
| `envVars[].fromDatabase {name, property: connectionString}` | yes | spec example is verbatim; `connectionString` is "the URL for connecting to the datastore over the private network" |
| `fromService … envVarKey: RENDER_EXTERNAL_HOSTNAME` (self-reference) | yes | spec: "To self-reference, provide the service's own name"; it gives the example `APP_HOST` ← `RENDER_EXTERNAL_HOSTNAME`. The env-vars page says it is "the service's onrender.com hostname" |
| `sync: false` | yes | spec: prompted "only during the initial Blueprint creation"; "When you update an existing Blueprint, Render ignores any environment variables with `sync: false`" |
| `generateValue` (deliberately not used) | yes | spec: "If the environment variable doesn't already exist, Render adds it" |
| `ipAllowList: []` on the database | yes | spec: databases take "a list of the IP address ranges allowed… over the public internet"; the example `ipAllowList: [] # Only allow internal connections`; its IP-rules table lists Postgres as optional on any plan. (Web services need Scale/Enterprise for it, so it isn't set there) |
| `postgresMajorVersion: "16"` | yes | spec: "as a string… You can't modify this value after creation"; schema enum `10`-`18` |
| `branch` | yes | spec: "the branch of the linked `repo`… If you omit this field, Render uses the repo's default branch" |
| `autoDeployTrigger: checksPass` | yes | spec: "Trigger a deploy only if the linked branch's CI checks pass" |
| `numInstances: 1` | yes | spec: "For a manually scaled service… Render uses 1 for a new service" |
| `region: oregon` | yes | spec: the default; "You can't modify this value after creation" |
| `databaseName`, `user` | yes | spec example and schema `database` properties |
| Web `plan: 0.5c-512mb` | yes | spec plan table: "0.5 CPU 512 MB `0.5c-512mb`" (free is 0.1 CPU). The schema also still accepts the legacy `starter` |
| Database `plan: 0.1c-256mb` | yes | spec plan table: "0.1 CPU 256 MB `0.1c-256mb`", listed separately from `free`. The schema also accepts the legacy `basic-256mb` |
| `PORT` default 10000 | yes | web-services page: "The default value of PORT is 10000 for all Render web services" |
| Free Postgres expires | yes | free page: "Free Render Postgres databases expire 30 days after creation" |
| Env vars become Docker build args | yes | Docker page. `backend/Dockerfile` declares no `ARG` (grepped), so no secret reaches a layer |

**Schema validation:** 0 errors. All 4 negative controls are rejected: Postgres `"9"`, a `dockerTarget`
key, web plan `starterx`, and database plan `free-forever`
(`evidence/render-yaml-validation.txt`).

**Not confirmable from the docs; recorded as untested:**
- which **plan names the dashboard shows** (Open Question 4; runbook step 2 records them);
- whether the Blueprint form **accepts blank** `sync: false` values (runbook step 3 says so).

## Verification (runner output)
**Gate, `npm run build && npm test`** (build exit 0):
```
 Test Files  16 passed (16)
      Tests  284 passed (284)
 Test Files  15 passed (15)
      Tests  244 passed (244)
```
- 284 + 244 is unchanged: this plan adds no self-host test.
- The new tests are hosted-only.

**Hosted suite** (`URL=$(scripts/test-db.sh) && TEST_DATABASE_URL=$URL npm run test:hosted -w @soulbound/backend`):
```
 ✓ src/__tests__/hosted/debugIp.test.ts (8 tests) 759ms
      Tests  158 passed (158)
[assert-no-skips] OK: 158 tests, 0 skipped, 0 todo
```
- That's 150 + 8 new.

**The 8 new tests (`debugIp.test.ts`):**
- the path constant;
- without the flag, signed out → 401 `SIGN_IN_REQUIRED`, and signed in → 404 `NOT_FOUND` with no probe body;
- with the flag and `TRUST_PROXY=1` → exactly `{ip, ips, xffHops}` with `no-store`, plus the frame header;
- two `X-Forwarded-For` entries → `xffHops: 2`, and trust 1 or 2 picks the matching entry;
- `TRUST_PROXY=false` ignores a spoofed header;
- a request logs nothing (spies on `console.log`, `error`, `warn` and `info`);
- it's behind the per-IP limiter (200, 200, 429);
- self-host → 401 `PASSPHRASE_REQUIRED`, and 404 with the passphrase.

**Mutations** (committed first, `cp` backup, sha256 changed, `cp` restore, hash re-checked, `git status` clean):

| # | Mutation | Result |
|---|---|---|
| a | the route mounted without the flag check | `× without the flag, it does not exist: 401 signed out, 404 signed in`, `Tests  1 failed \| 7 passed (8)` |
| b | the handler logs the XFF header | `× with the flag, a request logs nothing`, `Tests  1 failed \| 7 passed (8)` |

**`scripts/mutate-order.sh`** (on `15f9fb2`; still 3/3):
```
PASS  (a) express.json above the Better Auth mount: suite failed as required (rc=1, 15s; Tests  1 failed | 157 passed (158); 2 s timeouts: 0)
PASS  (b) Origin check moved below the Better Auth mount: suite failed as required (rc=1, 15s; Tests  11 failed | 147 passed (158); 2 s timeouts: 0)
PASS  (c) session gate deleted: suite failed as required (rc=1, 15s; Tests  21 failed | 137 passed (158); 2 s timeouts: 0)
mutate-order: all 3 mutations caught; backend/src/server.ts restored (sha256 e29f4a02036f41c81fa0af3856c60c8c432f3c4a3cd7a48e6d7e0e5f964e0ef2)
```

**Ad-hoc type check with tests included** (a throwaway tsconfig, deleted afterwards): errors only in the
frozen files: `anthropic.test.ts` 11, `routes.test.ts` 1 and `server.test.ts` 3. These are the counts
06-01 to 06-05 recorded. There are none in `debugIp.test.ts`.

**Frozen checks:**
- `git diff 7856b7d -- frontend/src/App.tsx | wc -c` → `0`.
- No test file that existed at `7c737a6` is modified: `git cat-file -e` on every `--diff-filter=M` test
  file printed nothing.
- `git diff --stat 7c737a6 -- '*.test.ts' '*.test.tsx'` → `18 files changed, 4709 insertions(+)`, all
  insertions.

**CLAUDE.md is additions only.** Both `git diff -U0 709496b -- CLAUDE.md | grep '^-[^-]'` and the same
against `7c737a6` print nothing (grep rc=1). The design-log diff is also additions only.

**`scripts/smoke-image.sh soulbound:verify-0607`** → `7/7 passed`. The Docker daemon was started for this
plan and stopped afterwards by PID.

**Local dry run (AI-4)** is in `evidence/verify-hosted-local.txt`, with no secrets: a grep for the DB
password, every fake secret and the cookie value finds 0 matches.
- **Image:** built with no `--target`, the stage Render builds.
- **Migrate:** `node backend/dist/migrate.js` in the image (the `preDeployCommand`), run against a
  throwaway role with a 48-character password → `[migrate] done: 2 migration(s) applied`.
- **Hosted container:** fake secrets, `TRUST_PROXY=1`, read-only, all caps dropped,
  `NODE_ENV=development` (needed only because the URL is http://localhost).
- **`scripts/verify-hosted.sh http://localhost:3001` → `[verify-hosted] 7/7 passed`, exit 0:**
  ```
  PASS  1 GET /api/health -> 200
  PASS  2 frame headers: X-Frame-Options DENY, frame-ancestors 'none', Referrer-Policy no-referrer
  PASS  3 GET / -> 200 text/html
  PASS  4 POST /api/invites/redeem, foreign Origin -> 403 ORIGIN_REJECTED
  PASS  5 GET /api/access, no cookie -> 401 SIGN_IN_REQUIRED, Soulbound-Mode: hosted
  PASS  6 POST /api/invites/redeem, own Origin, bad code -> 400 INVITE_INVALID
  PASS  7 GET /api/debug/ip, no cookie -> 401 (DEBUG_PROXY_HOPS is off)
  ```
- **`--session`, with a real session row:**
  - the cookie was signed by `better-call`'s own `serializeSignedCookie` with the same fake secret →
    `PASS  8 … 204, Soulbound-Mode: hosted`, `8/8 passed`;
  - a forged cookie → `FAIL  8 … -> 401`, exit 1.
- **The runbook step 9 commands, run with `docker exec` in the container:**
  - `createInvite.js` printed the link once, and redeeming it gave `204`;
  - the Render-shell count one-liner printed `account:google 1`, `invites_used 0`, `users 1`. So
    `require("pg")` resolves from `/app`.
- **`DEBUG_PROXY_HOPS=1`:**
  - the boot line appears;
  - the probe answers `{"ip":"127.0.0.1","ips":[],"xffHops":0}`, then `xffHops` 1 and then 2;
  - verify-hosted's check 7 then fails as intended (`6/7`).
- **SIGTERM:** `docker stop` took 99 ms, exit code 0.

**Provider-endpoint probe** (backs the runbook step 7 and 8 checks), local, with Google configured and
Discord not:
- `sign-in/social google: 200 url,redirect`;
- `sign-in/social discord: 404 … PROVIDER_NOT_FOUND`;
- `GET callback/google: 302`;
- `GET callback/discord: 404`.

The throwaway databases (`verify0607`, `probe0607`) and the role were dropped, and `scripts/test-db.sh --stop` ran.

## Findings and decisions
1. **"3 account rows" can't happen.** Better Auth writes no `account` row for a magic-link sign-up
   (`better-auth/dist/plugins/magic-link/index.mjs:164`, `createUser` with no account). After signing in
   three ways on one address, the check expects:
   - `account:google 1` and `account:discord 1`;
   - plus `users 1` and `invites_used 1`.

   Recorded in the runbook (step 9) and the design log. This corrects the spec's Acceptance Check wording.
2. **The provider count runs in the Render shell** (critique revision 1), not through `psql` in
   `verify-hosted.sh`:
   - the database has `ipAllowList: []`;
   - the image has neither `psql` nor `curl`.

   It's a `node -e` one-liner using the image's own `pg`.
3. **`ALLOWED_HOSTS` needs no manual step.** A documented self-reference to `RENDER_EXTERNAL_HOSTNAME`
   fills it. A custom domain later needs a plain value listing both hosts (runbook operating notes).
4. **`BETTER_AUTH_URL`/`FRONTEND_ORIGIN` stay `sync: false`, as planned.** `RENDER_EXTERNAL_URL` could fill
   them. I kept explicit values for the security-relevant origin, and because it's unconfirmed that a
   self-reference resolves before the first deploy.
5. **`NODE_ENV: production` is pinned in `render.yaml`**, even though the image sets it (06-03:
   `NODE_ENV=test` disables Better Auth's own checks).
6. **`branch: main` plus `checksPass`** mean the Phase 6 branch must be merged to `main` before the
   Blueprint is created. That's the runbook's "Before you start".
7. **4xx reporting (06-01, decision 5)** is left as it is: every handled error is reported. Revisit once
   the live volume is known (runbook operating notes).

Every "For 06-07" item from 06-01 to 06-06 is carried into the design log or the runbook:
- `flush()` means the queue drained, not delivery; `dataCollection` with every field off, and no
  `sendDefaultPii` (step 10);
- DB logs can hold emails, so log retention is covered (step 14);
- a refused sign-up burns the magic link (step 9);
- OAuth callbacks are untested until live (steps 7-9);
- never `NODE_ENV=test` (step 3, `render.yaml`);
- the #3295 correction, and step 10 pinned by who answers malformed JSON (design log);
- the 16 KB cap, including the chunked reset (design log);
- session refresh is client-driven (design log);
- Postgres ≥ 16 (`render.yaml`, step 2);
- watch for `[purge] failed (<SQLSTATE>)` (operating notes);
- the Account button overlapping at 390 px (design log, accepted);
- two access calls per self-host load (design log).

## Developer checklist (copied in order from the runbook's awaiting-developer steps)
Before starting: merge the Phase 6 branch into `main`. `render.yaml` deploys only `main`, after CI passes.

| # | You do | Then the agent runs or reads | Passing |
|---|---|---|---|
| 1 | `openssl rand -base64 48`; save it as `BETTER_AUTH_SECRET`; paste only `printf %s '<it>' \| wc -c` | reads the number | `64`; no `Invalid BETTER_AUTH_SECRET` at boot |
| 2 | Render → New → Blueprint → this repo, `main`; keep web `0.5c-512mb` and Postgres 16 `0.1c-256mb`; paste the plan IDs and Postgres version the dashboard shows | writes `evidence/render-plan-ids.txt`; updates `render.yaml` if an ID differs | a paid web plan, a paid Postgres, version 16 |
| 3 | Fill the `sync: false` prompts: `BETTER_AUTH_URL` = `FRONTEND_ORIGIN` = `https://<svc>.onrender.com`; `ANTHROPIC_API_KEY`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM=Soulbound <onboarding@resend.dev>`; OAuth and Sentry blank. Screenshot the Environment tab with values hidden → `evidence/render-env-names.png` | checks the screenshot | every name present; no `SOULBOUND_PASSPHRASE` |
| 4 | Apply the Blueprint; paste the `[migrate]` pre-deploy lines and the first boot lines | `scripts/verify-hosted.sh https://<svc>.onrender.com` → `evidence/verify-hosted-live.txt` | `[migrate] done: 2 migration(s) applied`, `listening on port 10000`, `7/7 passed` |
| 5 | Add `DEBUG_PROXY_HOPS=1`; `curl` `/api/debug/ip` (no XFF) and `api.ipify.org`; set `TRUST_PROXY` = `xffHops`; `curl` again with `X-Forwarded-For: 203.0.113.9`; **delete** `DEBUG_PROXY_HOPS`; paste the outputs with your IP as `<me>` | checks them; reruns `verify-hosted.sh` → `evidence/proxy-hops-live.txt` | `xffHops` = `TRUST_PROXY`; the spoof still shows `<me>`; check 7 → 401 |
| 6 | Resend account and API key; keep the onboarding sender (it delivers only to your Resend address). Before Phase 9: verify a subdomain and switch `EMAIL_FROM` | reads `evidence/resend-delivered.png` (later `resend-domain.png`) | step 9's email is delivered; later, the domain is Verified |
| 7 | Google OAuth client (Web): origin `https://<svc>.onrender.com`, redirect `https://<svc>.onrender.com/api/auth/callback/google`, consent in Testing with you as a test user; set `GOOGLE_CLIENT_ID`/`_SECRET` | `curl -X POST -H 'Origin: …' --data '{"provider":"google"}' …/api/auth/sign-in/social` | 200 (404 = not configured) |
| 8 | Discord app → OAuth2 → redirect `https://<svc>.onrender.com/api/auth/callback/discord`; set `DISCORD_CLIENT_ID`/`_SECRET`; verify your Discord email | the same curl with `discord` | 200 |
| 9 | Render Shell: `cd /app && node backend/dist/scripts/createInvite.js --days 7`; open the link; sign in by magic link (your Resend address), sign out, sign in with Google, sign out, sign in with Discord (same address); screenshot the session cookie row, value blurred → `evidence/session-cookie-devtools.png`; run `verify-hosted.sh … --session` locally with the cookie read by `read -rs`; **sign out**; run the count one-liner in the Render Shell; paste the outputs | checks → `evidence/signin-live.txt` | Secure ✓ HttpOnly ✓ SameSite Lax; `8/8 passed`; `account:discord 1`, `account:google 1`, `invites_used 1`, `users 1` |
| 10 | Sentry Node.js project; set `SENTRY_DSN`; Render Shell: `cd /app && node backend/dist/scripts/trackerTest.js`; screenshot the event → `evidence/sentry-canary.png` | checks the screenshot | the event holds only the type, frames and tags `code`/`route`/`mode`; no canary value, server name, request or user |
| 11 | UptimeRobot HTTP(s) monitor on `https://<svc>.onrender.com/api/health`, 5 min, with an email alert; screenshot → `evidence/uptimerobot.png` | checks it | the exact health URL, 5 min, a contact, Up |
| 12 | Console: a monthly spend limit on the workspace holding the Render key; screenshot → `evidence/console-spend-limit.png` | checks it | a limit is set on that workspace |
| 13 | After the repo move only: grant Render access to the new repo; re-link the service and the Blueprint; Manual Deploy | compares the deploy SHA with `git ls-remote <new> main`; runs `verify-hosted.sh` → `evidence/repo-move-relink.txt` | SHAs equal; `7/7` |
| 14 | Confirm your Resend, Sentry and Render workspace plans and their retention; paste the plan names | writes `evidence/processor-retention.txt` | documented figures: Resend 30 days (Free), Sentry 30/90 days, Render logs 7/14/30, PITR 3/7 days |

Once each step passes, the agent changes that runbook Status to "PASSED on <date>" with its evidence file.
Until then, STATE.md should record Phase 6 as "complete except live checks".

## CI
Run 133 on `3a2465a`, the head of the push, which contains every code commit of this plan (`15f9fb2`, `b13214d`):
https://github.com/DeanItServices/soulbound/actions/runs/36064729438. Conclusion: **success** for both jobs.
- `build-and-test`: every step succeeded, including `Build (all workspaces)`, `Test` and
  `Test (hosted, real Postgres)`.
- `smoke-image`: `Build image` and `Smoke test image` both succeeded.

The job log wasn't pulled, so no CI test count is quoted here; the step conclusions are. This SUMMARY
commit's own run wasn't re-checked, because it changes only this markdown file.
