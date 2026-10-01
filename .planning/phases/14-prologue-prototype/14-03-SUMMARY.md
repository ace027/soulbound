# Plan 14-03 Summary — Flag, API client, PrologueScreen

**Status: Complete** (Wave 3, executor: engineering-frontend-developer; orchestrator re-verified)

## Files
- `frontend/src/lib/prologueFlag.ts` (new) — `isPrologueEnabled` (only `?prologue=1`), `prologueCanon` (`scene` only for `?canon=scene`)
- `frontend/src/lib/api.ts` — import extended, `prologueBeat` and `prologueProfile` appended (0 lines removed)
- `frontend/src/screens/PrologueScreen.tsx` (new) — four-turn scene, reading/distilling states, inline errors, copy scene record, return to title
- `frontend/src/screens/QuestionnaireScreen.tsx` — form renamed `QuestionnaireForm` (body unchanged), hook-free flagged wrapper as default export
- New tests: `prologueFlag.test.ts`, `prologueApi.test.ts` (20 together), `prologueScreen.test.tsx` (27), `questionnaireFlag.test.tsx` (7)

## Verification (orchestrator re-run)
- Frontend 263 -> **317** (+54), 21 files; the original 263 pass unmodified (the flag-off proof); backend 368 unchanged
- `tsc --noEmit` ok; `npm run build -w frontend` ok
- `git diff --quiet 216f550` over `App.tsx`, `api.test.ts`, `creationScreens.test.tsx`, `questionnaireReview.test.tsx`, `src/__tests__`: clean
- QuestionnaireScreen diff: two imports, one comment paragraph, the signature rename, the appended wrapper
- Executor: 16/16 verification commands (one comment containing "localStorage" reworded after the first grep)

## Mutations
| Mutation | Caught by |
|---|---|
| `onComplete` called twice | 4 tests |
| `busyRef` guard removed | double-click test |
| action restore on beat error removed | 2 tests |
| profile JSON added to scene record | 2 tests |
| wrapper always renders PrologueScreen | 5 new + 16 existing tests (21 failures) |
| wrapper always renders QuestionnaireForm | flag-on test |
Restores by `cp`; hash-confirmed for the last three; the first three were restored by `cp` and the full suite re-ran green (orchestrator re-ran the full suites after the wave).

## Decisions
- Synchronous `busyRef` and `completedRef` for double-click protection (state goes stale between two clicks).
- The scene is done only when four player actions exist and no request is pending; the textarea stays visible and disabled during the fourth beat.
- Beat request sends the trimmed action; on error the raw input is restored.
- `?canon=scene` only affects the profile call when the flag is on.

## Issues carried to the next step
- **Contract mismatch (real, latent):** `PROLOGUE_NARRATION_MAX` is 3000 but history entries are capped at 2000 (`PROLOGUE_ENTRY_MAX`); the client sends narration back, so a narration over 2000 characters would be rejected with 400 `INVALID_REQUEST` on the next call. Fixed in a follow-up commit after this wave (narration cap lowered to 2000 plus a regression test).
- Layout: the screen copies the questionnaire's vertically centred container; the column re-centres as the transcript grows. 14-04's e2e must check this.
- Visual defects: not rendered by this plan.
