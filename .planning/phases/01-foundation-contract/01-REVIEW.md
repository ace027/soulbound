# Phase 1: Foundation & Contract — Review Summary

## Result: PASSED

**Cycles used**: 2 of 3
**Reviewers**: QA Verification Specialist, Security Engineer, Infrastructure & DevOps Engineer (dynamic panel, non-overlapping rubrics)
**Completed**: 2026-09-17

## Findings Summary
| | Count |
|---|---|
| Total findings | 11 |
| Blockers found / resolved | 0 / 0 |
| Warnings found / resolved | 8 / 8 |
| Suggestions found / resolved | 3 / 3 |
| Found during fix verification (not by reviewers) | 3 |

## Findings Detail
| Sev | File | Issue | Fix | Cycle |
|---|---|---|---|---|
| WARN | `backend/src/config.ts` | `process.env.ANTHROPIC_API_KEY` never cleared — second unguarded plaintext copy | `delete` after read | 1 |
| WARN | *(absent)* `.dockerignore` | `frontend/.dockerignore` inert; Docker reads only context-root ignore files | Root `.dockerignore`; removed the inert one | 1 |
| WARN | `frontend/Dockerfile` | `builder` stage had no `USER`, so compose ran the frontend as root | `USER node` (reworked in cycle 2) | 1 |
| WARN | `shared/src/worldVoice.ts` | Drift guard had no link to the prompt text | Comment corrected c1; **guard closed c2** | 1→2 |
| WARN | `shared/src/worldVoice.ts` | Guard was dead code — unimported, untested | Wired into backend startup | 2 |
| WARN | `frontend/Dockerfile` | `runtime` stage `serve -s` returns 200 + HTML for `/api/*` | Comment states the gap; behaviour deferred to Phase 2/3 | 1 |
| WARN | `docker-compose.yml` | Both ports bound `0.0.0.0` with no auth | Bound to `127.0.0.1` | 1 |
| WARN | `backend/src/server.ts` | No `unhandledRejection` / `uncaughtException` redaction | Handlers added | 1 |
| SUGG | `package.json` | Root `npm test` failed — no workspace defines it | Removed until R16 | 1 |
| SUGG | `backend/tsconfig.json` | `bundler` resolution lets `tsc` pass on imports Node ESM rejects | `node16` | 1 |
| SUGG | `.env.example` | `NPM_CA_FILE` scope guidance | Added | 1 |

## Found during fix verification, not by any reviewer
| Issue | How it surfaced |
|---|---|
| Duplicate `"module"` key in `backend/tsconfig.json` — a later `"ES2022"` silently overrode the earlier value | Applying the `node16` fix failed the build |
| `USER node` alone broke the frontend container (`EACCES` on `node_modules/.vite-temp`) — `/app` is root-owned after `COPY`/`npm ci` | Container died on first `compose up` after the fix |
| BuildKit secret mounts root-owned 0400, so once the stage ran as `node` the CA was silently unreadable and `npm ci` failed on TLS with a misleading npm-internal error | Cycle-2 Dockerfile rework failed to build |

Every one was introduced or exposed by a fix, and caught by verifying the fix rather than by shipping it.

## Reviewer Verdicts
| Reviewer | Cycle 1 | Cycle 2 | Key observation |
|---|---|---|---|
| QA Verification Specialist | PASS | — | All 6 exit criteria independently reproduced. Found the drift guard's blind spot: it checks one file against itself. Also chased the CRLF/LF question and confirmed Plan 05's runtime-string comparison was load-bearing, not pedantry. |
| Security Engineer | PASS | — | `Secret` wrapper holds against every reflection and serialization path. Found the unguarded `process.env` copy. Could not execute (no shell) — flagged the methodology gap itself; the orchestrator then ran the probes. |
| Infrastructure & DevOps | NEEDS WORK | **PASS** | Proved `.dockerignore` inertness with a probe file. Measured the cycle-1 `chown -R` at 683MB vs 541MB and named the cheaper correct pattern. Confirmed no regressions in cycle 2. |

**Aggregate**: cycle 1 NEEDS WORK → cycle 2 **PASS**

## The drift guard — what changed
The original check compared the derived JSON Schema against `CONTRACT_FIELD_NAMES`, both authored in the same file. Renaming a field inside `WORLD_SYSTEM_PROMPT`'s RESPONSE FORMAT block left both inputs unchanged, so it reported clean while prompt and parser diverged — the exact failure `CLAUDE.md` #4 exists to prevent.

`assertWorldVoiceContract(promptText)` now compares three arms including the live prompt, and runs at backend startup so it is not inert. Demonstrated on the blind-spot case: a prompt-only rename still compiles (`tsc` cannot see inside a string literal) and the backend exits 1 naming both files.

## Carried into Phase 2
- `runtime` stage has no `/api` route to the backend. Dormant only because the frontend makes no API calls yet. Needs a reverse proxy or a configurable API base URL **before** that image is deployed.
- No auth or rate limiting on the backend. Loopback binding is the current mitigation; revisit when paid routes go live.
- Tests remain Phase 4 (R16). The contract check runs at startup but has no test asserting it fails correctly.

## Post-Review Polish
Skipped — cycle 2's fixes already covered the clarity and consistency items, and the phase closed on a verified green stack.
