# Plan 14-01 Summary — Prologue contract and config keys

**Status: Complete** (Wave 1, executor: engineering-backend-architect; orchestrator re-verified)

## Files
- `shared/src/prologue.ts` (new) — `PROLOGUE_OPENING`, constants (entry 2000, narration 3000, profile field 1500), canon enum, history/beat/profile request schemas, narration/beat-response/profile schemas, `PrologueBeatResponse` type
- `shared/src/index.ts` — line 4 `export * from './prologue.js';`
- `backend/src/config.ts` — `MODELS` + `prologueBeat`, `prologueProfile` (`claude-sonnet-5-5`)
- `backend/src/anthropic.ts` — `WorldVoiceRoute` union and `EFFORT` (`'low'` for both); comment text only otherwise
- `backend/src/__tests__/config.test.ts` — consented edit: two keys added to the `toEqual`, title "three" -> "five" (4 changed lines vs `216f550`)
- `backend/src/__tests__/prologueContract.test.ts` (new, 27 tests), `backend/src/__tests__/prologueConfig.test.ts` (new, 5 tests)

## Verification (orchestrator re-run)
- `npm run build -w shared` ok; `cd backend && npx tsc --noEmit` ok
- Backend 306 -> **338** (+32), 20 files; frontend 263 (unchanged)
- `git diff --quiet 216f550` over `shared/src/worldVoice.ts`, `backend/src/routes`, `backend/src/data`, `anthropic.test.ts`, `routes.test.ts`: clean
- `PROLOGUE_OPENING` text matches `run-v2-1.mjs`
- Executor: 10/10 verification commands passed

## Mutations (all caught, restored, hash confirmed)
| Mutation | Caught by |
|---|---|
| Opening first word changed | literal-equality test |
| Alternation check removed | repeated-role tests |
| `memory` -> `memories` in profile schema | key-alignment test (+3) |
| `prologueBeat` effort `'low'` -> `'high'` | prologueConfig test |
| `prologueProfile` removed from `EFFORT` | `tsc --noEmit` TS2741 |

## Decisions
- SDK schema transform confirmed: `minLength`/`maxLength` are dropped and folded into `description`; tests assert this and a comment says the bound is advisory, enforced only by the Zod parse (14-CONTEXT decision 12).
- Alternation check reports one issue at the first repeated role; a wrong first role and a wrong opening text are separate issues, all on a `history` path.

## Issues / Errors
None.
