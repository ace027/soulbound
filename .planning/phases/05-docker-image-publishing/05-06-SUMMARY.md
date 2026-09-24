# 05-06 Summary — Self-host package, records, 0.1.0, cross-plan re-verification

## Status: Complete

Executed by the orchestrator. The Technical Writer drafted the prose in task 2, and the orchestrator
reviewed it against the code. Everything below was derived from commands run in this plan
(evidence: `evidence/selfhost-nondefault-port.txt`, `evidence/phase-close-reverification.txt`).
Nothing is taken from an earlier SUMMARY.

## Commits
| Commit | What |
|---|---|
| `87f3f0a` | (a) `compose.selfhost.yml` plus its evidence |
| `2900ccc` | (b) records: README, design log, CLAUDE.md, PROJECT.md, one `docker-compose.yml` comment |
| `706d62d` | (c) `0.1.0` in all four `package.json` files and the lockfile |
| this commit | SUMMARY, ROADMAP tick, STATE |

## Task 1 — `compose.selfhost.yml`
One service, `ghcr.io/deanitservices/soulbound:${SOULBOUND_VERSION:-latest}`, configured as follows:
- every variable is listed explicitly (no `env_file`);
- the key accepts `SOULBOUND_ANTHROPIC_KEY` with `ANTHROPIC_API_KEY` as a fallback (verified: with only `ANTHROPIC_API_KEY` set, compose resolves it);
- `ALLOWED_HOSTS` and `FRONTEND_ORIGIN` are derived from `SOULBOUND_PORT`;
- the default bind is `127.0.0.1`;
- it carries `read_only`, `cap_drop: ALL`, `no-new-privileges` and the node `fetch` healthcheck.

The run on **port 3999** (a fresh build tagged `ghcr.io/deanitservices/soulbound:local`) gave:

| Check | Result |
|---|---|
| health | 200 |
| `/` | 200, `text/html` |
| `/api/access` | 401 `PASSPHRASE_REQUIRED` without the header, 204 with it |
| `/api/x` | 404 JSON |
| Host `localhost:3999` | 200 |
| Host `evil.example` | 403 |
| hardening | `ReadonlyRootfs=true CapDrop=[ALL] SecurityOpt=[no-new-privileges:true] User=node` |
| passphrase occurrences in the logs | 0 |

**Deviation:** the plan named `evidence/sample.env`. The repo's `*.env` ignore rule correctly refuses
that name, so the file is `evidence/sample.env.example` (fake values), following the repo's own
`.env.example` convention, rather than force-adding past an ignore rule that exists to protect secrets.

## Task 2 — records
- **README:**
  - a `SOULBOUND_PASSPHRASE` setup step;
  - a new `## Self-hosting` section (steps, a variables table, plain `docker run` with `ALLOWED_HOSTS`, the private-package note, `TRUST_PROXY`, upgrades);
  - `## Expose the frontend on your LAN` rewritten. Its two false claims are gone (`grep "has no authentication\|Nothing else needs changing"` finds nothing), and it adds the passphrase, the shared LAN rate-limit bucket and the plain-HTTP note.
  - **The README's `docker run` example was run verbatim** against the local build, with the image tag swapped: page 200 HTML, `/api/access` 401 without the header and 204 with it.
- **Design log:** `## Access gate for published images (2026-09-23)`, covering the options and the choice, not-BYOK, the departure from the reverse-proxy note, the error codes, printable ASCII, the single image, and the accepted gaps. The historical-scripts list was extended to the two `.planning/experiments/2026-09-19-*/playthrough.mjs` scripts after checking that they send no header.
- **CLAUDE.md:** one added paragraph in the auth section. `git diff --numstat 4319383 -- CLAUDE.md` gives `2 0` (additions only).
- **PROJECT.md:** R17–R22 under a new **Distribution** group. "Rate limiting" is removed from Out of Scope with a pointer to R18.
- **`docker-compose.yml` (scope addition, recorded here):** the backend `ports:` comment still claimed "no application-level auth". It's now reworded, with no setting changed. It wasn't in `files_modified`; it had gone stale because of this phase, and the plan's intent ("every document a future session reads as instructions matches what shipped") covers it.
- `grep -c SOULBOUND_PASSPHRASE`: README 7, `.env.example` 1, `docker-compose.yml` 1, `compose.selfhost.yml` 3. All non-zero.
- **Versions:** all four manifests and the lockfile's root and workspace entries are `0.1.0`. The lockfile diff touches only version fields (the grep for non-version changed lines is empty).

## Task 3 — cross-plan re-verification (final tree, `706d62d`)
| # | Check | Result |
|---|---|---|
| 1 | `npm ci && npm run build && npm test` | ci ok, build ok; **backend 187/187 (8 files), frontend 184/184 (13 files)** |
| 2 | `npm run test:e2e` | **6 passed** |
| 3 | `git diff --exit-code 7856b7d -- frontend/src/App.tsx` | exit 0, byte-identical |
| 4 | dev compose (`SOULBOUND_PASSPHRASE=… --env-file /dev/null config -q`) and self-host compose config | both exit 0 |
| 5 | **fresh** `docker build --no-cache --secret id=npm_ca,…` then `scripts/smoke-image.sh soulbound:phase5-final` | **7/7 passed** |
| 6 | mutation re-run (below) | 11 caught, 1 survived as expected |
| 7 | constraint-guard audit (below) | all guarded; #7 partial (pre-existing) |
| 8 | CI `smoke-image` on the pushed final commit | recorded in STATE after the push (see below) |

### 6. Mutation re-run
Each mutation ran on a committed tree, was restored with `git checkout -- <file>`, and was confirmed with `git diff --quiet`.

| # | From | Mutation | Result | First failing test |
|---|---|---|---|---|
| 1 | 05-01 | `takeEnv` keeps `SOULBOUND_PASSPHRASE` in `process.env` | CAUGHT (3) | "is removed from process.env once read" |
| 2 + 7 | 05-01/02 | `redact()` never strips the passphrase (same edit for both rows) | CAUGHT (2) | "strips both the API key and the passphrase from one string"; "a thrown error echoing the passphrase is redacted from both the log and the response body" |
| 3 | 05-01 | accept `TRUST_PROXY=true` | CAUGHT (1) | "rejects \"true\" — every hop is spoofable…" |
| 4 | 05-02 | delete the gate mount | CAUGHT (11) | "no header returns 401 PASSPHRASE_REQUIRED and never reaches the SDK" |
| 5 | 05-02 | `express.json` above the limiter/gate | CAUGHT (1) | "a 1 MB unauthenticated body gets 401, not 413…" |
| 6 | 05-02 | `timingSafeEqual` → raw `===` | **SURVIVED**, as 05-02 recorded: behaviourally equivalent, so the timing property is checked by code review only | — |
| 6b | spec | drop hashing: `timingSafeEqual` on raw buffers (the closest mutation-testable reading of the spec's "swap for `===` on a length mismatch" row; a literal `===` swap is behaviourally equivalent like #6; added in review cycle 1) | CAUGHT (4) | "rejects a candidate of a different length without throwing" |
| 8 | 05-03 | `checkAccess` falls back to `'required'` | CAUGHT (3) | "maps a 502 text/plain (Vite proxy, no backend) to unknown" |
| 9 | 05-03 | any 401 clears storage | CAUGHT (1) | "401 AUTHENTICATION_FAILED does NOT clear the stored passphrase" |
| 10 | 05-04 | static block before the `/api` 404 | CAUGHT (2) | "returns a JSON 404 for an unmatched /api path, both GET and POST" |
| 11 | 05-04 | `/api` 404 mount → `req.path.startsWith('/api')` | CAUGHT (1) | "returns a JSON 404 for a mixed-case /api path…, never HTML" |
| 12 | 05-04 | drop the file-extension guard on the fallback | CAUGHT (1) | "returns a plain 404, never HTML, for a missing/stale asset chunk" |

### 7. Constraint-guard audit (AI-7)
| Property | Guarded by |
|---|---|
| CLAUDE.md #1 no `confirm/alert/prompt` | `frontend/src/__tests__/constraints.test.ts` |
| #2 `localStorage`, never `window.storage` | `frontend/src/__tests__/constraints.test.ts` |
| #3 `minHeight: 0` on scroll chains | `components.test.tsx`, `simulationScreen.test.tsx` (declared styles), `frontend/e2e/smoke.spec.ts` (real layout) |
| #4 prompt/parser contract | `backend/src/__tests__/contract.test.ts`, plus the startup guard in `server.test.ts` |
| #5 `max_tokens` ≥ 2000 | `backend/src/__tests__/anthropic.test.ts` |
| #6 the MUST NOT list | `backend/src/__tests__/prompts.test.ts` (six named rules plus a bullet-count floor) |
| #7 lore vs behaviour split | **Partial.** `anthropic.test.ts` "carries the real WORLD_SYSTEM_PROMPT and WORLD_LORE, in that order" guards the separate blocks. The *content* split (no lore fact in the behaviour block) is review-only. This predates Phase 5; recorded, not changed |
| #8 unique-skill sends no `system` key | `anthropic.test.ts` (`'system' in request === false`), `routes.test.ts` |
| New: the gate fails closed | `routes.test.ts` access-gate tests (mutation #4), `server.test.ts` boot-without-passphrase |
| New: the passphrase is never logged | `config.test.ts` redact, `routes.test.ts` log/body leak (mutation #2/7), smoke check 7 |
| New: `/api/*` never returns HTML | `routes.test.ts` static-mode tests (mutations #10, #11, #12), smoke check 5 |

## UNTESTED (cannot be exercised from this branch)
- **The GHCR publish** (both tags, both platforms), **the arm64 build**, and **the existence check against a real GHCR response**. `workflow_dispatch` only appears once `release.yml` is on the default branch.
- **To dispatch the first release after merge:** GitHub → Actions → **Release** → **Run workflow** (on `main`), or a session using the GitHub MCP `actions_run_trigger` with workflow `release.yml`. Record the result in STATE.md.
- **If the existence check stops the first dispatch:** read the step's printed stderr. If it's a genuine "absent" that the pattern missed, widen the pattern in a one-line PR and dispatch again. Never add a bypass.
- **After the first publish:** the package may be private. The repo owner sets it public in the GitHub package settings.

## Auto-remediation
- `Auto-remediated:` the first commit (a) attempt failed on the ignored `sample.env`; renamed it to `sample.env.example` and recommitted.
- `Auto-remediated:` a stray `sleep 240` left behind by the 05-05 agent's CI polling was stopped before this plan began writing, so that agent couldn't wake mid-plan.

dockerd was started for tasks 1 and 3 and stopped at the end. No Anthropic spend: every run used fake keys.
