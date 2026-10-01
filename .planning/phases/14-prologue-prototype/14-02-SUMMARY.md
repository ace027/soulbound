# Plan 14-02 Summary — Prologue routes

**Status: Complete** (Wave 2, executor: engineering-ai-engineer with the security-engineer lens; orchestrator re-verified)

## Files
- `backend/src/routes/prologue.ts` (new, 193 lines) — v2.1 narrator and profile prompts ported verbatim, pure renderers, `POST /api/prologue/beat` and `/profile`; no `system` key, models from `MODELS`, via `callWorldVoice`
- `backend/src/server.ts` — one import, one comment, one `app.use(prologueRouter);` (3 added, 0 removed vs `216f550`)
- `backend/src/__tests__/prologueRoutes.test.ts` (new, 30 tests)
- `backend/src/__tests__/hosted/prologueHosted.test.ts` (new, 4 tests)

## Verification (orchestrator re-run)
- Backend 338 -> **368** (+30), 21 files; frontend 263 unchanged; `npx tsc --noEmit` ok
- `git diff --quiet 216f550` over the three other routes, `untrustedText.ts`, `data/`, `routes.test.ts`, `anthropic.test.ts`: clean; 14-01 files unchanged
- Executor: all frontmatter and task-level verification commands passed; prompt-fidelity greps pass against `run-v2-1.mjs`
- Hosted suite (executor, Postgres via `scripts/test-db.sh`): `prologueHosted.test.ts` 4/4 (401 `SIGN_IN_REQUIRED` with no session on both paths, 403 `ORIGIN_REJECTED` for a foreign Origin); full `test:hosted` 186 passed, 0 skipped

## Mutations (green baseline first; all caught, restored, hash confirmed)
| Mutation | Caught by |
|---|---|
| `stripDelimiters` removed from narrator branch | 2 failures (beat and profile narrator-tag tests) |
| `wrapUntrusted` replaced with raw text | 5 failures |
| `useSystem: false` -> `true` in beat handler | 1 failure (`'system' in request`) |
| `beat >= 2` -> `beat >= 1` | idle-note test |
| `app.use(prologueRouter)` deleted | 25 failures (404s) |

## Decisions
- Tag-count assertions are relative (static count K measured from a benign history), matching tolerantly (case, whitespace, self-closing).
- Extra coverage beyond the plan: four hostile actions in a row, tagged narrator entries on the profile route, a wrong passphrase, nested and spaced tag variants.
- Local `RequestValidationError`/`describeIssues`; no `console.log`; no new error mapping.

## Issues / Errors
None. (`backend/.vitest-hosted.json` was written by the hosted run; gitignored.)
