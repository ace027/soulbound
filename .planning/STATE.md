# Project State

## Current Position
- **Phase**: 6 of 13 — **shipped and merged: [PR #7](https://github.com/DeanItServices/soulbound/pull/7) merged 2026-09-25 as `89219af` (pre-ship gate 6/6; includes the white page-frame fix `80d6ca2`); review PASSED (3 cycles); live deploy checks pending the developer.** Everything verifiable without the developer's accounts is done; the 14-step runbook (`docs/runbooks/phase-6-hosted-setup.md`) is UNTESTED until the developer runs it (merge to `main` first — the Blueprint deploys `main`). Tests: 304 backend + 249 frontend, hosted 182 (0 skipped), e2e 14 (in CI), smoke 7/7, mutate-order 3/3. Spec rows 1-23. Review record: `.planning/phases/06-hosted-mode-accounts/06-REVIEW.md`.
- **Phase 6 results**: 06-01 ✅ `61382ec`, `a541df5`, `730421b` — mode switch, hosted secrets, generalised `redact`, allow-list tracker (hosted-only); backend 187 → 248 (+61 new, 0 edited), frontend 190; 8/8 mutations caught (orchestrator re-ran the suite: 248 + 190)
  06-02 ✅ `3e018dd`, `bb8fbd4`, `6aaa203` — pg pool, node-pg-migrate (001 from `auth@1.7.6` CLI, 002 with `reserved_email`), `test:hosted` (fails unset / on skips), CI+release Postgres service, image carries migrations; backend 248 → 258, hosted 11/11 0 skipped, smoke 7/7, 6/6 mutations; CI green run 36051126070. Handoff: 06-04 wires the boot-time pending-migration exit (orchestrator re-verified 258 + 190, hosted 11/11)
  06-03 ✅ `8ee0b4b`, `235eb11`, `84d52c0` — Better Auth 1.7.6 (ALS PROPAGATES, verified in source + negative control), invites (HMAC/HKDF `__Host-` cookie, nonce reservation + `reserved_email` reconcile), send gating, 25 `disabledPaths` + path allow-list, `npm audit` 0; backend 258 → 268, hosted 11 → 61 (0 skipped), 7 mutations; CI green run 36054191300. Warnings carried: Better Auth disables its own origin/callback checks under `NODE_ENV=test` (forced on + asserted); refused sign-up burns the magic link (06-06: offer a new link); DB logs can hold emails (06-07 runbook) (orchestrator re-verified 268 + 190, hosted 61/61)
  06-04 ✅ `feffecd`, `29e6aed`, `4cee6b3`, `41b51dd` — `hostedGate.ts` (Origin, frame + Referrer-Policy, session gate, per-user limiter, IPv6 /64), 15-step order in `buildApp`, `buildHostedDeps()` (pending migrations → exit 1), selfhost lines unchanged (diff -w); backend 268 → 284, hosted 61 → 126 (0 skipped), smoke 7/7, mutate-order 3/3 + 11 more; CI green run 36056811612. Findings: better-call 1.4.0 re-serialises a parsed body, so #3295's hang no longer occurs — step 10 is now pinned by who answers malformed JSON (design log must correct 'hangs'); `/api/auth/*` had no body cap (→ 06-05); server-side getSession drops the refreshed cookie (→ 06-06) (orchestrator re-verified 284 + 190, hosted 126/126, mutate-order 3/3)
  06-05 ✅ `66f925c`, `ddde5bc` — `DELETE /api/account` (row first, then revoke all sessions), sign-in cancels deletion (in the auth hook), hourly purge on a dedicated client under `pg_try_advisory_xact_lock` (injected clock, verification rows via `value` JSON, reconcile), 16 KB `/api/auth` body cap; hosted 126 → 150 (0 skipped), 7/7 mutations, mutate-order 3/3; CI green run 36059182803. Carried: purge needs Postgres ≥ 16 (`IS JSON OBJECT`); purge failures only log `[purge] failed` (06-07 runbook) (orchestrator re-verified 284 + 190, hosted 150/150, mutate-order 3/3)
  06-06 ✅ `c9795ad`, `be578c5`, `9ae5775` — `ModeGate` (outside `AccessGate`), `SignIn` (fragment invite stripped before first fetch; known error codes only; "send me a new link"), `AccountPanel` (inline delete confirm), session refresh every 12 h so the 30-day cookie rolls, `better-auth` client lazy-loaded (self-host never downloads it); App.tsx and AccessGate.tsx byte-identical, `checkAccess` unchanged; frontend 190 → 244, e2e 6 → 14, 7 mutations; CI green run 36062010541. UX: the Account button first overlapped story text at 390 px; moved into an inline Account section at the end of the Soul Codex on the developer's call (context from `ModeGate`, App.tsx still untouched) (orchestrator re-verified 284 + 244, e2e 14/14, viewed game-390 + signin-390; after `a3406d3` the frontend count is 246 = 190 + 28 + 28, runner `Tests  246 passed (246)`)
  06-07 ✅ (local) `15f9fb2`..`70ae28e` — `render.yaml` (keys confirmed against Render docs + schema, 0 errors; Postgres "16", `ipAllowList: []`, `branch: main`), `scripts/verify-hosted.sh` (7/7 local, 8/8 with `--session`), `/api/debug/ip` behind `DEBUG_PROXY_HOPS=1`, 14-step runbook (all UNTESTED — awaiting developer), design log "Hosted mode — Phase 6 build", CLAUDE.md +additions only, mappings; hosted 150 → 158; smoke 7/7; mutate-order 3/3; CI green run 36064729438. Corrections recorded: a magic-link sign-up writes no `account` row (expect 2 account rows, 1 user); #3295 hang no longer occurs (orchestrator re-verified 284 + 244, hosted 158/158, no secrets in committed deploy files)
- **Phase 6 review**: cycle 1 (Security, QA, Infra panel) — all NEEDS WORK, 0 blockers, 10 warnings, ~16 suggestions. Fixed: `d05a186` (backend: session roll via `disableRefresh`, per-invite + global send caps, Google verified-email link check — developer kept Google trusted, invite↔email binding, verification TTL purge, 110 s shutdown, token encryption, pool timeout, exact `node-pg-migrate` pin), `d4a4940` (frontend: failed sign-out + Codex slot tests), `558f259`..`263e643` (Render shutdown delay, dashboard-sync warning, `mutate-order.sh` baseline + SIGINT, CI hosted smoke + e2e jobs, absolute preDeploy, expand/contract). CI green run 36076726372 (3 jobs). Tests 284 + 249, hosted 174 (0 skipped).
  Cycle 2: Security PASS, Infra PASS, QA NEEDS WORK (low; 4 findings: Google-check malformed inputs untested, pool test passed by construction, map-full path untested, `mutate-order.sh` mis-attribution). Fixed in `3ceb9f5` (+19 unit, +8 hosted tests; ID tokens no longer stored; ceiling log line; drift guards; CI migration count derived). CI green run 36079718951. Tests 304 + 249, hosted 182. Carried to Phase 7: login CSRF into an existing account (ROADMAP Phase 7).
  Cycle 3: Security PASS, Infra PASS (1 runbook wording fix), QA PASS (11/11 mutations caught, counts re-derived, smoke 7/7). Fixes `9356d36`. **Review PASSED.**
- **Previously**: Phase 6 pending planning. Phases 1-5 shipped; [PR #6](https://github.com/DeanItServices/soulbound/pull/6) merged 2026-09-24 as `86faa9f`.
- **Roadmap extended 2026-09-24**: Phases 6-13 (hosted mode + gameplay) added from `.planning/explorations/2026-09-24-hosted-multiplayer-saas-design.md`. Requirements R23-R35 in PROJECT.md. Reversals (single-tenant auth scope and CLAUDE.md #2, hosted mode only; PROJECT.md out-of-scope) recorded in CLAUDE.md (+3/−0) and the design log → "Hosted mode (2026-09-24)".
- **Review cycle 3**: Security PASS, QA PASS, Infra PASS — **review PASSED (3 cycles)**. Cycle-3 suggestions applied in `3c50def`. Full record: `.planning/phases/05-docker-image-publishing/05-REVIEW.md`. Tests at close: 187 backend + 190 frontend, e2e 6/6.
- **Review cycle 2**: Security PASS, QA PASS, Infra NEEDS WORK (1 warning: the pushed amd64 image was claimed byte-identical to the smoke-tested one, unenforced). Fixed: `fdb1306` (matching labels + post-push amd64 diff-ID check that fails closed; `github.ref` injection removed; arm64 cache), `585330c` (README 403 cause), `efb4829` (rejected passphrase cleared; stored non-ASCII value dropped; each mutation-verified), plus summary wording corrections. Tests 187 + 189, e2e 6/6.
- **Review cycle 1** (3-reviewer panel: Security, QA, Infra): NEEDS WORK — 1 blocker (self-host healthcheck 403 on any non-default port), 6 warnings, 12 suggestions. Fixed: `8e382e0`..`3f64eb3` (healthcheck proven healthy on :3999; release perms scoped to publish, main-only, smoke the pushed build, runbook, unpublished-image note, timeouts; AccessGate non-ASCII + unreachable-server recovery; wrong-passphrase test; real e2e submit; length-mismatch mutation recorded as caught). Not taken: CSP/anti-framing headers (CSP is out of scope in PROJECT.md — developer decision), SHA-pinning `docker/*` actions, build/npm caches.
  ⚠️ **A real `SOULBOUND_ANTHROPIC_KEY` from this sandbox's environment was printed into one fix agent's session transcript** (not into any file or commit — exact-match checked). Rotation recommended to the developer.
- **Phase 5 results**: 05-01 ✅ `5c45340`, `421d896` — passphrase required at boot, config readers, shared contract; backend tests 117 → 146, 3/3 mutations caught
  05-02 ✅ `846d7e8`..`95609ae` — rate limiter + gate before body parsing, `/api/access`; independent Security Engineer review (orchestrator-run) PASS WITH FIXES → all fixed (map sweep + 10k cap, `/api`-scoped JSON parsing, TRUST_PROXY Docker warning, test gaps); backend tests 146 → 180; mutations 5/6 caught, 1 behaviourally-equivalent (`===` vs timingSafeEqual) recorded
  05-03 ✅ `0f16655`..`aa886bf` — passphrase store, Bearer header + `checkAccess`, `AccessGate` wrapping `App` in `main.tsx`; `App.tsx` byte-identical; frontend tests 150 → 184; e2e 6/6 (guard narrowed to `/api/access` only); mutations 2/2 caught
  05-04 ✅ `b9181de`..`a400774` — backend serves the bundle (`STATIC_DIR`; no fallback for file paths; `/api` 404 first); `backend/Dockerfile` builder → frontend-build (`$BUILDPLATFORM`) → api → runtime; dev compose targets `api`; frontend `runtime` stage removed; image `soulbound:05-04` 373MB, uid 1000; backend tests 180 → 187; mutations 2/2 caught
  05-05 ✅ `a54ddeb`..`236b006` — `scripts/smoke-image.sh` (7/7 local; negative run on pre-gate `7856b7d` fails checks 2,3,4,6); CI `smoke-image` job green on `af876ca` (run 78); `release.yml` dispatch-only, fail-closed overwrite check verified under `bash -e`. UNTESTED until first dispatch after merge: GHCR push, arm64, real GHCR existence response
  05-06 ✅ `87f3f0a`, `2900ccc`, `706d62d` — `compose.selfhost.yml` (verified on :3999), README/design log/CLAUDE.md (+2/−0)/PROJECT.md, `0.1.0`; phase-close re-verification: 187 + 184 tests, e2e 6/6, App.tsx unchanged, fresh-build smoke 7/7, mutations 11/12 caught (#6 equivalent, as recorded)
- **Status**: **Phase 5 complete — review passed (3 cycles)**; all 6 plans executed successfully (serial waves; was: planned — 6 plans across 6 serial waves) (`.planning/phases/05-docker-image-publishing/`).
  Spec critiqued once (REWORK → 12 findings applied), plans critiqued once (CAUTION → 29 findings
  applied; see `05-CONTEXT.md` → Execution protocol). Zero Anthropic spend planned.
- **Phases 1-4**: **All four phases complete and shipped.** Phase 4 review PASSED after 3 cycles (3-reviewer panel, 29 findings, 0 blockers); shipped as [PR #3](https://github.com/DeanItServices/soulbound/pull/3), 15 commits / 48 files / +4,757−1,474. R13, R14, R15, R16 close. The legacy artifact is deleted — recover it with `git show 3d01fa5:legacy/souldbound-world.jsx` (the `parity-oracle` tag is local-only and cannot be pushed from this environment; the SHA is on the branch and works everywhere).
  ⚠️ **Correction**: this file previously said PR #2 was "open against `main`". It was **merged** 2026-09-18T01:49Z (head `5147bd8`). That is why Phase 4 needed a new PR rather than additions to #2.
- **Last Activity**: 2026-09-24 — Phase 5 shipped as [PR #6](https://github.com/DeanItServices/soulbound/pull/6)
  (pre-ship gate 6/6, CI green on `33d5aca`). Also on the PR, after the review: playtest prompt
  fixes (`fc5b2cd`, `363026f`, `2085d39` — narration length, no contrast framing, Unique Skill
  legibility; live-verified, Tier 0 adversarial tests re-run and held), polish (`727e7ca`,
  `35ac809`), map refresh (`33d5aca`). Before that: Phase 5 planning (2026-09-23). Earlier the same day: stale compose comment fixed (`1506c3a`), map refreshed (`7856b7d`),
  auth decided — option 2, a deployer-set access gate (Next Action 2).
  Planning decisions: GHCR; `workflow_dispatch`-only release; passphrase stored in `localStorage`;
  architecture **Pragmatic + 2 from Clean** (one image, the backend serves the bundle; gate and
  limiter before `express.json`; `Authorization: Bearer`), chosen from three read-only proposals.
  Spec: `.planning/specs/05-docker-image-publishing-spec.md`. ROADMAP now lists Phase 5 (0/6).
- **Developer decisions 2026-09-24:**
  - **First release is deliberately on hold** until the repo moves from `DeanItServices` to the developer's personal GitHub. Don't dispatch `release.yml` before then.
    - `release.yml` derives the image name from the repo owner, so it follows the move automatically.
    - After the move, update the hardcoded `ghcr.io/deanitservices/soulbound` in `compose.selfhost.yml:41` and `README.md` (lines 68, 72, 115). Leave the historical mention in `docs/design-decisions-log.md` as it is.
  - **Key rotation is deferred by the developer**, who will rotate before friends are invited. It's tracked as a Phase 9 invite-gate item, so don't raise it again before then.
- **Next Action**: Developer: work through `docs/runbooks/phase-6-hosted-setup.md` — `main` now carries `render.yaml`, so the Render Blueprint can be created (step 2); the agent verifies each step as it's reported. In parallel, `/legion:plan 7` (Phase 7 must first close the carried login-CSRF item).
  After merge: dispatch `release.yml` once (GitHub → Actions → Release → Run workflow) — the GHCR
  publish is the one UNTESTED step. ⚠️ `SOULBOUND_PASSPHRASE` is now **required at boot** — add it to
  `.env` (12+ printable ASCII characters).
- **Branch** (developer decision 2026-09-26): **`main` is the default branch; all work happens on `dev`**, which ships to `main` by pull request. `dev` was cut from `65f6ca1` and carries the 6 post-PR-#7 commits (retro, map refresh, return-to-title fix). Don't create per-session `claude/*` branches. The old `claude/legion-status-uxlaqo` (same head as `dev`) and `claude/admiring-wright-hfmugk` (`5048e5e`, a superseded STATE.md edit) were deleted by the developer on GitHub (verified 2026-09-26: the remote has only `main` and `dev`). This environment can't delete remote branches — the git proxy rejects ref deletes — so future branch removals go to the developer.

### Two things to carry into any next phase
1. **A fix is a claim, and carries the same derivation burden as a finding.** All three review cycles
   closed their findings and each fix commit seeded a new, smaller instance of the same defect class,
   because findings were derived while fixes were reasoned about.
2. **Retaining raw evidence pays immediately.** The screenshots committed to close one finding caught
   a wrong number in the very summary they were filed under, on their first use.

### Resolved from playtest notes
- **No way back to the title screen during character creation** (reported and fixed 2026-09-25).
  Both creation screens now have "← Return to title", which clears race, name and answers. The
  developer lifted the `App.tsx` freeze for it. See the design log → "Return to title from
  character creation". Not yet merged to `main`. **Developer decision 2026-09-25: it ships in
  Phase 7's PR**, not on its own.

### Known environment limits
`git push origin <tag>` fails here (`remote end hung up`) while branch pushes succeed — a tag-ref
permission. Any durability scheme must survive without tags. This matters for the Docker publish work
below: a tag-triggered release workflow cannot be tagged from this environment.

**Docker works, but the daemon is not started.** `docker` and `dockerd` are both installed
(`/usr/bin/`, Engine 29.3.1) and `/var/run/docker.sock` exists — with nothing listening on it, which
makes every command fail as if Docker were unavailable. It is not. Start it and it works:

```bash
nohup dockerd > /tmp/dockerd.log 2>&1 &   # run as root, detached
sleep 8                                    # not listening instantly
docker version --format 'Server {{.Server.Version}}'
```

Verified 2026-09-22 end to end: `docker run --rm hello-world` pulled from Docker Hub through the agent
proxy and ran. overlayfs storage driver, cgroups v1, ~30 GB free. Per-session — a fresh container
starts with no daemon. The daemon was stopped again afterwards, so this session left it as found.

**The app was never run under Docker here.** Every live test ran natively: `node backend/dist/server.js`
on :3001 and `vite` on :5173, with Playwright driving the pre-installed Chromium at `/opt/pw-browsers/`.

## Progress
```
[████████████████████] 100% — 27/27 plans complete
```

## Ship record
- **PR #7** — https://github.com/DeanItServices/soulbound/pull/7 — **MERGED** 2026-09-25 as `89219af` (head `80d6ca2`, merge commit; CI 6/6 green on the head)
  Phase 6 — 59 commits, 106 files, +18,228/−104. Pre-ship gate **6/6**: 7/7 summaries, review PASSED (3 cycles), no blocker escalations, 304 + 249 tests, hosted 182 (0 skipped), e2e 14, clean tree. Descends from PR #6's merge (`86faa9f`); not rebased. Live deploy checks remain with the developer.

- **PR #3** — https://github.com/DeanItServices/soulbound/pull/3 (base `main`, head `claude/admiring-wright-hfmugk`)
  Phase 4 — 15 commits, 48 files, +4,757/−1,474. Pre-ship gate **6/6**, the first phase where gate 3a
  (build completeness) holds as literally specified: all 6 plans produced SUMMARY.md files, which was
  retro AI-6's purpose. Tests 115 backend + 139 frontend + 5 e2e, three typechecks clean, build clean,
  working tree clean, review PASSED (3 cycles).
  ⚠️ **Not rebased, deliberately.** `3d01fa5` is referenced 9 times across README, the design log, the
  constraint audit and this file — it is the recovery handle for 69 legacy citations. A rebase rewrites
  it and silently breaks the recovery path. The branch descends cleanly from PR #2's merged head
  (`5147bd8` is an ancestor) and `main` carries no independent work, so there is no conflict to resolve.

- **PR #2** — https://github.com/DeanItServices/soulbound/pull/2 — **MERGED** 2026-09-18T01:49Z (head `5147bd8`)
  Phase 3 — 14 commits, 46 files, +7,653/-28. Pre-ship gate: tests 237/237, shared+backend+frontend
  builds clean, working tree clean, review PASSED (2 cycles).
  ⚠️ **PR #1 was already merged** (`38cb2c9`, head `eed43ec`), so this is a NEW pull request — a
  merged PR cannot track new work. No rebase was done: `eed43ec` is an ancestor of `origin/main`, so
  the branch descends cleanly from merged history with no divergence, and rebasing would have
  rewritten 14 SHAs that STATE.md and 03-REVIEW.md reference by name. This repo already lost a full
  set of SHA references to a history rewrite once (see "Committer email" below).
  ⚠️ **Gate 3a (build completeness) does not hold as literally specified** — this project has never
  produced `SUMMARY.md` files; all three phases recorded plan outcomes in commit messages. Every one
  of the 10 plans has a commit and the plan→commit table below is the evidence. Recorded rather than
  marked green.

- **PR #1** — https://github.com/DeanItServices/soulbound/pull/1 (base `main`, head `claude/admiring-wright-hfmugk`)
  Covers **both** Phase 1 and Phase 2: `main` had not received Phase 1 either.
- Pre-ship gate: 6/6. Tests 108/108, build clean, working tree clean.
- ⚠️ **One gap recorded in the PR rather than hidden**: the containerized verification
  (compose healthy, Vite proxy forwarding, non-root, no key in frontend env) was captured at
  `0f060ea`, one commit behind the shipped HEAD `02ea728`. That commit's only backend change was
  behavior-neutral import reordering, and 108 tests are green — but it was not re-verified in a
  container, because pruning Docker's image store (to repair snapshot corruption) ran into a
  Docker Hub 429 on the base-image pull. Re-run when the limit clears if you want it closed.

## Recent Decisions
- **Design source**: `.planning/explorations/2026-09-17-soulbound-artifact-to-app-design.md` (committed `e56f400`)
- **Codebase map**: ✅ refreshed 2026-09-24 at commit `35ac809` — `.planning/CODEBASE.md` plus the
  `.planning/codebase/` dataset (**63 chunks, 150 symbols, fingerprint `76035132f82dfdd9`**).
  Picks up Phase 5 (access gate, limiter, single image, `AccessGate.tsx`, `passphrase.ts`) and the
  2026-09-24 prompt changes. Previous dataset was `1506c3a` / `9ff2babb3c9f807f`. The fingerprint
  command sorts blob hashes by hash — see `.planning/codebase/search.md`.
- **Scope**: full migration to playable, not a scaffold or vertical slice
- **Language**: TypeScript both sides; the World Voice contract lives in `shared/` so prompt/parser drift becomes a compile error
- **JSON contract**: structured outputs (`output_config.format`), field names unchanged
- **Models**: `claude-opus-5` on `callWorldEngine` + `generateIntroScene`, `claude-sonnet-5` on `determineUniqueSkill` — ⚠️ reverses a logged decision; `CLAUDE.md` and `design-decisions-log.md` must be updated in Phase 4 (R15)
- **Execution mode**: Autonomous — report at phase boundaries
- **Planning depth**: Standard — deep analysis already lives in the exploration doc
- **Cost profile**: Balanced — Opus 5 for the contract and the `App.tsx` game-logic port, Sonnet 5 for backend routes and UI extraction, Haiku 4.5 for verbatim data copying

## Next Action

**Nothing is in flight.** All 4 phases are shipped and merged; the roadmap is exhausted. Open
items, newest first:

1. ~~**Stale comment in `docker-compose.yml`**~~ — **DONE** 2026-09-23 (`1506c3a`). It now says the
   `runtime` stage fails every game call, that `lib/api.ts` surfaces it as `NON_JSON_RESPONSE` while
   the container reports healthy, and names the same-origin reverse proxy as the preferred fix.

2. **Publishing Docker images is a real Phase 5**, not a quick task. The blocker is documented above:
   `frontend/Dockerfile`'s `runtime` stage serves the bundle with `serve -s dist`, whose SPA fallback
   answers ANY unmatched path with 200 + index.html — including `/api/*`, which the frontend calls as
   relative same-origin paths. It would return HTML to a JSON parser on every call. Fix by serving
   behind a proxy that forwards `/api` (keeps same-origin, keeps CORS out of it) rather than by adding
   a configurable API base (which forces CORS and exposing the backend). Then: versioning (everything
   is `0.0.1`), a publish workflow (`ci.yml` only runs build-and-test), multi-arch, a consumer compose
   file using `image:` instead of `build:`, and env that is not hardcoded to one machine.
   ✅ **Auth question DECIDED 2026-09-23 (developer): option 2 — a deployer-set access gate.**
   The problem: the backend has no application-level auth or rate limiting; loopback port binding
   is its only protection. A public image makes it easy for strangers to expose one (VPS,
   port-forward, the README's LAN section taken further), and an exposed instance is an open proxy
   billing the deployer's Anthropic key at ~$0.06-0.08 per turn.
   Options weighed:
   1. Stay single-tenant, docs-only warnings — rejected: safety depends on every deployer reading them.
   2. **Access gate — CHOSEN.** The deployer sets a shared passphrase/token in `.env`; the backend
      rejects `/api/*` without it (plus a basic rate limit). Still one deployer, one key.
   3. Real user accounts — rejected: out of scope per PROJECT.md (belongs with multiplayer).
   What this does NOT change: the settled key architecture (backend proxy holding the deployer's
   own key from `.env`, never in the browser). This is access control on that proxy, not a
   re-opening of it — CLAUDE.md's "do not re-litigate" still holds.
   Carry into Phase 5 planning:
   - The gate belongs in `server.ts`, which carries a standing rule: no new middleware without a
     test asserting what it emits. Test the 401/429 bodies and that the token never appears in logs
     or error responses (same bar as `ANTHROPIC_API_KEY`, R2).
   - `/api/health` stays open — the compose healthcheck calls it from inside the container.
   - Decide how the browser holds the token (e.g. entered once, kept in `localStorage` alongside
     saves). It is a deployer-issued passphrase, not the Anthropic key, so this is NOT the rejected
     paste-per-session BYOK — say so in the design log to head off that misreading.
   - Out of scope stays out: PROJECT.md lists rate limiting as out of scope for the migration;
     Phase 5 deliberately brings a basic limit in as part of this decision — record that in
     PROJECT.md when the phase is planned.
   - Log the decision and its rationale in `docs/design-decisions-log.md` in the same change that
     implements it.

3. **LAN exposure is documented, not applied.** README's "Expose the frontend on your LAN" describes
   the one-line compose change; `docker-compose.yml` is deliberately unchanged, so the default stays
   loopback-only. Applying it is the deployer's affirmative choice.

4. **The intro-scene prompt was left untouched** when the entity-ledger bug was fixed. A live probe
   showed the model already populates `new_entities` unprompted, so no change was needed. Making it
   explicit would be a third sanctioned deviation from that verbatim port — flagged, not taken.

### Shipped after Phase 4 (both merged)
- **PR #5** — https://github.com/DeanItServices/soulbound/pull/5 — merged `f70aa31`. README only:
  the LAN section, and Setup moved to `SOULBOUND_ANTHROPIC_KEY` (it had been telling readers to use
  the one name `.env.example` warns against).
- **PR #4** — https://github.com/DeanItServices/soulbound/pull/4 — merged `c994f53`. The model split
  swapped to Sonnet 5 on world-engine + intro-scene / Opus 5 on unique-skill, narration cut to 2-3
  paragraphs, prompt cache moved to a 1-hour TTL, and **the entity-ledger drift fixed** — creation
  discarded the intro scene's `narrative_memory_updates`, so turn 1 was told "KNOWN ENTITIES: (none
  yet)" about a cast the intro had just introduced, and denied its own NPC. Evidence for both live
  runs is under `.planning/experiments/`.
  **Cached prefix is now 15,523, confirmed live twice.** Re-derive with `count_tokens` (free) rather
  than re-measuring; `CLAUDE.md` carries the number.

### Phase 4 Plans
| Plan | Wave | Deliverable | Agent | Cost |
|---|---|---|---|---|
| 01 | 1 | R13 — eight-constraint audit; corrects R13's own "seven" | QA Verification | free |
| 02 | 1 | R16 — close with evidence from the existing suite | Test Results Analyzer | free |
| 03 | 1 | Retro AI-5 — committed Playwright smoke test | Frontend Dev | free |
| 04 | 2 | R15 — CLAUDE.md auth note; design-log model split | Technical Writer | free |
| 05 | 3 | R14 — live playthrough + cache proof | orchestrator | **~$0.25** |
| 06 | 4 | Legacy deletion + 69 citations + cross-plan re-verification | orchestrator | free |

Wave 1's three plans are file-disjoint (verified) and run in parallel. **Only plan 05 spends
money**, isolated so the phase completes without a key — in which case R14 is reported UNTESTED.

### Five facts derived while planning that revised ROADMAP's 3-plan estimate
1. **R16 is already satisfied.** `backend/src/__tests__/contract.test.ts` has all five cases R16
   asks for (valid passes; rename, missing field and unparseable JSON each throw loudly), and save
   round-trip tests exist at `saves.test.ts:163`. R16 became a verification plan, not a build plan.
2. **R13's text is stale**: PROJECT.md:38 says "seven" constraints; CLAUDE.md has **eight**. The
   audit covers 8 and 04-01 corrects the wording.
3. **R15 is half-done and half-wrong**: CLAUDE.md:49-54 already records the model split, but
   CLAUDE.md:63 still says auth is an "OPEN DECISION, resolve before scaffolding a backend" — the
   backend is shipped and merged. And `docs/design-decisions-log.md` has **zero** occurrences of
   "opus" or "sonnet"; the split was never logged there at all.
4. **Deleting legacy breaks 69 citations across 25 files** (`grep -rhoE 'legacy [0-9]+(-[0-9]+)?'`).
   Git history preserves the file; the docstring references stop resolving. 04-06 decides this
   before deleting, not after.
5. **R14's two blockers are already diagnosed** — the `SOULBOUND_ANTHROPIC_KEY` env var and the CA
   mount for containerized calls. Both are written into 04-05 so they are not rediscovered.

### Planning-gate decisions
- **The inherited `currentSlotId` closure race stays unfixed** — offered at the gate and declined.
  It is legacy 913-1031 behaviour, so fixing it would deviate from the artifact. Recorded as a
  decision, not an oversight. A plan that "helpfully" repairs it is reversing a developer call.
- **Every Phase 4 plan writes a `SUMMARY.md`** (retro AI-6). Three phases recorded outcomes only in
  commit messages, which is why the ship gate's build-completeness check could not hold as
  specified. That ends this phase.
- Architecture proposals and the spec pipeline skipped — this is a verification phase against
  already-shipped code, not a design problem.

### Phase 3 execution record
| Plan | Wave | Commit |
|---|---|---|
| 01 | 0 | `2a0786f` test harness |
| 02, 04, 05 | 1 | `9f7f6a0` saves, game logic, viewport hook |
| 03, 07 | 1 | `2ee1faa` API client, creation screens |
| 06 | 2 | `1b8e8f5` presentational components + shared LogEntry |
| 08 | 3 | `bca8dd0` loading/simulation screens, CLAUDE.md #3 fixes |
| 09 | 4 | `963513c` App.tsx wiring |
| 10 | 5 | `61fbb07` integration test + cross-plan re-verification |
| review | — | cycle 1: 4 surviving mutants closed. cycle 2: `deleteSave` gap closed, 129 tests |

### ⚠️ Carried into Phase 4 from the Phase 3 review
1. **Inherited closure race, NOT fixed — developer call needed.** `handleAction`
   closes over `currentSlotId`. Clicking "+ Slot" (`handleManualSave`, which has no
   `isThinking` guard) while a world-engine call is in flight lands that turn's
   autosave on the OLD slot; the new slot stays one turn stale. Reproduced live
   during review. Present identically in legacy 913-1031, so the port did not
   introduce it — flagged rather than changed, per CLAUDE.md's working-style rule.
   Minimal fix if wanted: mirror `currentSlotId` in a `useRef` and read that inside
   the `setLog` updater.
2. **No repeatable visual regression guard.** jsdom performs no layout, so the
   suite asserts declared style properties only. Plan 03-08's screenshot harness was
   deleted after use. Nothing automated would catch a future collapsed panel.
3. **Nothing has touched a live backend.** Every frontend test mocks `fetch`.
   The API wiring's "PASS" has never reached a real Express server — that is R14.
4. **`runtime` Docker image still non-deployable** (`/api/*` answers 200 + HTML).
   Known and deferred; it becomes real the moment the frontend is served from it.

### Process finding from the review — worth not repeating
Three reviewers ran in parallel against one working tree, one of which mutates
source files by design. All three independently observed a "flaky" test and
attributed it to Vitest pool flakiness. It was not flaky: the failures were other
reviewers' live mutations. `|| 5` → `?? 5` produced `expected +0 to be 5`, and
`response.ok` → `if (false)` produced the 9-test api failure. On a clean tree the
suite is 8/8 green. **A mutating reviewer needs its own worktree, or must run
serially.** Cycle 2 ran serially and was clean. A second vector surfaced there: a stop
hook prompted a commit mid-sweep, and the reviewer saw HEAD move under it. Same rule
covers both — **while a reviewer holds the tree, do not write to it.**

### Phase 3 Plans (post-critique)
| Plan | Wave | Deliverable | Agent | Model |
|---|---|---|---|---|
| 01 | 0 | Test harness — jest-dom wiring, scrollIntoView stub, configs frozen | Frontend Dev | Sonnet 5 |
| 02 | 1 | `lib/saves.ts` + tests (R11) | Frontend Dev | Sonnet 5 |
| 03 | 1 | `lib/api.ts` + content-type guard + zero-cost stub (R9, R12) | Frontend Dev | Sonnet 5 |
| 04 | 1 | `game/applyWorldUpdate.ts` (925-1021) + 10 mutants (R10) | orchestrator | Opus 5 |
| 05 | 1 | `hooks/useIsMobile.ts` + tests (R12) | Frontend Dev | Sonnet 5 |
| 07 | 1 | Title / Race / Questionnaire screens (R9) | Frontend Dev | Sonnet 5 |
| 06 | 2 | Four components + `shared` LogEntry extension (R9) | Frontend Dev | Sonnet 5 |
| 08 | 3 | Loading / Simulation screens + CLAUDE.md #3 fixes + screenshots | UX Architect | Sonnet 5 |
| 09 | 4 | `App.tsx` wiring (seeded-save path, zero cost) | orchestrator | Opus 5 |
| 10 | 5 | Integration test + phase-close cross-plan re-verification | orchestrator | Opus 5 |

Wave 1 runs **five** plans in parallel (file-disjointness verified).

### ⚠️ Plan critique ran and returned REWORK — findings applied
Carried forward unaddressed through two retros, it caught five execution-blocking defects:

1. **Four factual errors in the plans**: "17 `useState`" (legacy has 16 + 1 `useRef`) — which would
   have made a *correct* port fail its own verify gate; every component port range off by one at the
   start; "`writeSave` already slices the log" (it has zero slices — the cap is in `autoSave`); and
   a new `game/tierStyle.ts` duplicating a `TIER_STYLE` **already exported by `shared`**.
2. **A fix-induced defect in the prescribed fix**: the CLAUDE.md #3 replacement div omitted `flex: 1`,
   which collapses the mobile layout — and **jsdom does no layout**, so every test would have passed
   on a visibly broken page. Third consecutive phase where a fix introduces the defect.
3. **Wave 0 could not run waves 2-4's tests**: `@testing-library/jest-dom` installed but never
   registered, the exclude glob matching none of this phase's test directories, and no
   `scrollIntoView` stub (jsdom lacks it; legacy 812 calls it on every log change).
4. **Three vacuous verifications**: the `<style>` grep pointed at `components/`, which contains none
   of the six blocks; "17 `useState`" was unsatisfiable; "compare programmatically" is not executable
   against JSX with conditionals and template interpolation.
5. **Three orphaned seams**: the 80-entry cap, the `logEntry` composition (range said 1008, it is
   built at 1014), and `actionHistory` growing past the backend's `max(2000)`.

Also applied: `shared/src/gameState.ts` gained an owner (plan 06) for the missing `LogEntry.etchingSkill`
and `unknown[]` `newSkills`; plan 09 was split so the integration test cannot be absorbed into the
wiring; and the **cross-plan re-verification** the context claimed to apply — but no plan contained —
is now plan 10.

**Rule adopted for this phase: derive every count and range, report the derivation, never restate a
number from prose.** Four of the five blocking defects were that failure.

### Architecture: Pragmatic, chosen from three proposals
Three read-only proposals were generated. **Pragmatic** won: split the five screens into
`screens/*.tsx`, but leave the state graph alone — `App.tsx` keeps all **16** `useState` (plus one
`useRef`) and the
`autoSave`-inside-`setLog` closure exactly as legacy has them. Clean's `useGameSession` hook was
rejected because it rewrites the state graph, which is the most behaviour-load-bearing and
least-tested part of the port. Minimal's single 700-line `App.tsx` was rejected because its own
author called it "unreviewable by diff, with the tests covering none of it".

The one deviation from verbatim is `game/applyWorldUpdate.ts` — extracted purely so R10's rules
become testable.

### Four things verified while planning that changed the plans
1. **`shared/src/gameState.ts` already exports the save keys** (`SAVE_INDEX_KEY`, `SAVE_PREFIX`,
   `MAX_LOG_SAVED`, `SAVE_SCHEMA_VERSION`). `lib/saves.ts` imports them; redeclaring would create a
   second source of truth for the one thing that must stay byte-identical.
2. **The 25/60/100 thresholds are model-side, not client-side** (`WORLD_SYSTEM_PROMPT` 40/55/93/139).
   A frontend test asserting them would have been untestable fiction, and a client-side guard would
   silently swallow legitimate unlocks on an overshooting mastery jump. Plans forbid both.
3. **Legacy violates CLAUDE.md #3 twice on one scroll chain** — `WorldLog`'s root (L659) lacks
   `minHeight: 0`, and a Fragment at L1388 acts as the mobile flex/scroll container with its parent
   also missing it. A literal verbatim port would carry both forward. Plans 06 and 08 fix them.
4. **`frontend/package.json` has no test runner**, which is why wave 0 exists and why the plan count
   went 4 → 10.

### What review changed (see 02-REVIEW.md)
Two blockers, ten warnings, nine suggestions — all resolved. The panel's shared conclusion was
that the code was right but the net around it wasn't: a 22-mutation sweep found 11 survivors,
including unregistering every route and replacing the whole cached prefix with junk, suite green.

- `server.ts` is now exercised by tests (`buildApp()` extracted).
- The cycle-2 security fix itself introduced a blocker: the Host allow-list 403'd every API call
  under Compose while the container still reported **healthy** — the healthcheck curls localhost
  from inside the container and never touches the proxied path. Worth remembering as a pattern:
  **a passing healthcheck does not mean the app is reachable the way users reach it.**
- The prompt-injection guard was bypassable two ways (single-pass regex splicing, and
  `actionHistory` echoing player text back undelimited a turn later). Both closed and pinned.

### ⚠️ Carry into Phase 3/4 planning
- **Cost — superseded by the Phase 4 measurement.** Phase 2 recorded $0.0499 per cached
  world-engine turn and ~$2.65 per 50-turn session. Re-derived from Phase 4's committed usage log
  (`.planning/phases/04-parity-verification/evidence/usage-lines.log`) at current published rates:
  a cached turn is **$0.063-$0.080, mean $0.072** (n=5), and a 50-turn session is **~$3.74**.
  Creation is **$0.147** — $0.006 for unique-skill on Sonnet plus $0.141 for intro-scene, of which
  **$0.097 is the one-time cache write**, not the prose. Output tokens dominate at **80%** of a
  cached turn, so narration length is what moves the bill. A >5-min pause re-pays that $0.097
  write instead of the $0.008 read. Derive costs from the usage log, never restate a per-turn
  figure — the $0.31 first reported for the Phase 4 run was the Phase 2 rate restated; the real
  total was $0.51.
- **The 15,132-token figure is stale** — cycle 2 added two lines to `WORLD_SYSTEM_PROMPT`.
  Re-derive with `count_tokens` (free). Only re-proving cache engagement costs money.
- **`WORLD_SYSTEM_PROMPT` is no longer byte-identical to the legacy artifact** (two deliberate,
  approved additions). Phase 4's parity audit must compare against the *current* file, not assume
  byte-equality with legacy.
- Phase 3 must not add middleware to `server.ts` without a test asserting what it emits — the
  CORS header value was the one security property that could silently degrade without erroring.

### Docker checks — closed later the same day
All 7 cross-plan checks now pass, plus the live error-path criterion. Docker was never broken:
this sandbox's PID 1 is `process_api` with no service manager, so `dockerd` had simply never been
started. Started by hand it works; a Docker Hub 429 on anonymous pulls then cleared on retry.

Verified in containers: `docker compose up` healthy end to end, Vite proxy forwarding
`:5173/api` → backend, both containers `uid=1000(node)`, frontend env carrying no `ANTHROPIC*`,
and four live non-2xx paths (400 / 404 / 502 / 401) all structured with the key absent from logs.

**If you need Docker again in a fresh session, start it yourself:**
```bash
setsid nohup dockerd > /tmp/dockerd.log 2>&1 < /dev/null &
# if it dies with "timeout waiting for containerd": pkill -9 -x dockerd containerd
#   && rm -f /var/run/docker.sock /run/containerd/containerd.sock, then retry
export NPM_CA_FILE=/root/.ccr/ca-bundle.crt   # required for builds here
```

### ⚠️ Blocker to plan for in Phase 4 (R14)
A containerized World Voice call fails in this sandbox: `self-signed certificate in certificate
chain`. The proxy CA is injected at **build** time for npm only and never reaches the runtime
image's trust store. **Not a product defect** — the developer's machine does not TLS-intercept —
but R14's in-sandbox end-to-end playthrough cannot run without this, no Dockerfile change needed:
```
-e NODE_EXTRA_CA_CERTS=/ca/ca-bundle.crt -v /root/.ccr/ca-bundle.crt:/ca/ca-bundle.crt:ro
```
With it mounted, the container reached the API and a bogus key mapped correctly to
`AUTHENTICATION_FAILED` / 401.

## Auth decision (2026-09-17) — settled, do not re-litigate
A Claude Max subscription does **not** include API access; Anthropic bills the API separately via Console credits. The artifact only worked because claude.ai injected auth tied to whoever opened it — `docs/design-decisions-log.md` records this as "a crude form of bring your own Claude account". Proceeding on Console credits with the Opus 5 split intact (originally estimated ~$0.04/turn, ~$2.10 per 50-turn session assuming caching engages; **measured 2026-09-17: $0.0499/turn, ~$2.65/session** — caching does engage, but output tokens run higher than the estimate assumed). A proxy converting API-key requests into OAuth calls against a Max subscription was raised and declined — that is the separation Anthropic's terms draw between the two products.

## Committer email — resolved
✅ **RESOLVED 2026-09-17.** All 23 commits on this branch now use `noreply@anthropic.com`. Fixed by `git rebase --exec "git commit --amend --no-edit --reset-author" 31f7381` followed by a force-push-with-lease.

Verified the rewrite changed metadata only: the tree hash was byte-identical before and after (`06c8793...`), `git diff` between the old and new HEAD was empty, and the commit count stayed at 23. Tests, builds and the verbatim data files were re-checked after.

**Consequence worth knowing:** rewriting the oldest commit changed every descendant's SHA, so all 23 commits have new IDs. The SHA references in these planning docs were remapped by matching commit subjects and each was confirmed to resolve to a real on-branch commit. Any SHA quoted in an older chat transcript or elsewhere outside this repo is stale — the commit exists, under a different ID.

**Auth decision (2026-09-17)**: a Claude Max subscription does not include API access — Anthropic bills the API separately via Console credits. The artifact worked only because claude.ai injected auth tied to the viewer. Proceeding on Console credits with the Opus 5 split intact (originally estimated ~$0.04/turn, ~$2.10 per 50-turn session assuming caching engages; **measured 2026-09-17: $0.0499/turn, ~$2.65/session** — caching does engage, but output tokens run higher than the estimate assumed). A proxy converting API-key requests into OAuth calls against a Max subscription was raised and declined.

## Phase 2 Plans
| Plan | Wave | Deliverable | Agent | Model | Status |
|---|---|---|---|---|---|
| 01 | 1 | Anthropic client module | Backend Architect | Sonnet 5 | ✅ `f0081fb` |
| 02 | 1 | Vitest + contract-guard test | QA Verification | Sonnet 5 | ✅ `1d18c25` |
| 03 | 2 | Three World Voice routes | AI Engineer | Sonnet 5 | ✅ `9ecb0ae` |
| 04 | 3 | Route tests vs mocked SDK | QA Verification | Sonnet 5 | ✅ `9ca38c2` |
| 05 | 4 | Live verification & cache proof | orchestrator | Opus 5 | ✅ caching proven live |

**Verified so far without a key**: 38 tests green; three routes built on one shared helper; `unique-skill` omits `system` entirely; the two Opus routes send byte-identical system blocks *and* `output_config`, so they share a cache namespace; all three carry `max_tokens: 16000`, `effort: 'high'`, no prefill, no `budget_tokens`; prompts byte-identical to the artifact by rendered-string diff.

**All three now verified by 02-05**: the API accepted the derived schema on every call; `cache_read_input_tokens` hit 15,132 on the second Opus call and again on `intro-scene`; and Opus 5 refused an adversarial Ultimate-Skill / Soul-Rewrite / Plundering / Ithren turn on every count.

## Phase 1 Plans
| Plan | Wave | Deliverable | Agent | Model | Status |
|---|---|---|---|---|---|
| 01 | 1 | Repository reorganization & workspace root | Infrastructure & DevOps | Haiku 4.5 | ✅ |
| 02 | 2 | Shared contract package | orchestrator | Opus 5 | ✅ |
| 03 | 2 | Backend service skeleton | Backend Architect | Sonnet 5 | ✅ |
| 04 | 2 | Frontend service skeleton | Frontend Developer | Sonnet 5 | ✅ |
| 05 | 3 | Verbatim static-data extraction | general | Haiku 4.5 | ✅ |
| 06 | 3 | Compose wiring & end-to-end verification | orchestrator | Opus 5 | ✅ |

Planning-gate notes: architecture proposals and the spec pipeline were skipped — the committed exploration doc already carries the competing-approach analysis and serves as the spec. Plan critique was skipped for this phase (mechanical scaffold); run it before Phase 3, where the `App.tsx` game-logic port is the real regression risk. GitHub issue creation skipped — no `gh` CLI in this environment.


## Phase 1 findings carried into later phases
- **Legacy CSS drift** — the six duplicated `<style>` blocks were not identical. `breathe`, `glowPulse`, `etchIn` and the scrollbar thumb width differ between copies; each was resolved by plurality among existing legacy values. During the Phase 3 UI port, if a screen looks subtly off against the artifact, these four rules are the first place to look. There is no single "correct" original to diff against.
- **Seven keyframes, not six** — `cardHover` exists in legacy (as an empty block) and was missed by the plan's prose. Caught by diffing extracted lists.
- **Backend dev watch loop and frontend `dev` script are unexercised** — no plan's verify block covered them. Check manually when dev-loop iteration starts.
- **`runtime` frontend image has no route to the backend** — `serve -s` answers `/api/*` with 200 + index.html. Must gain a reverse proxy or a configurable API base URL before it is ever deployed. Dormant only while the frontend makes no API calls.
- **No auth or rate limiting on the backend** — ports now bind `127.0.0.1` as mitigation. Revisit when Phase 2's paid routes go live.
- **Docker builds need a trusted CA in this sandbox** — outbound HTTPS is TLS-intercepted. Handled via an optional BuildKit secret that no-ops elsewhere; set `NPM_CA_FILE` when building here.
