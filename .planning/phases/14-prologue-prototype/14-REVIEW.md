# Phase 14: Prologue Prototype — Review Summary

## Result: PASSED
**Cycles:** 2 of 3 · **Date:** 2026-10-01 · **Panel (dynamic):** testing-qa-verification-specialist (mutating, ran alone), engineering-security-engineer (read-only), engineering-frontend-developer (read-only). Panel rubrics only; the optional multi-pass evaluators were not loaded.
**Scope reviewed:** `git diff 216f550..HEAD` (29 files in shared, backend, frontend, docs, CLAUDE.md; +3,627/-7 before the cycle-1 fixes), including the three post-build commits `4e83e9d` (narration cap), `cc7106d` (layout) and `d5df291` (unique-skill limit as scope).

**Phase status after review:** built and reviewed. NOT closed: ROADMAP criteria 1 (the safety-gate sheet is still UNREAD), 5 (three playtest sessions) and 6 (canon and replace/add/stop decision) belong to the developer. This review did not read or judge the gate evidence.

## Findings summary
| | Found | Resolved |
|---|---|---|
| Blockers | 0 | 0 |
| Warnings | 7 | 7 |
| Suggestions | 4 | 2 taken, 2 left (see below) |

## Findings detail
| # | Sev | File | Issue | Fix | Cycle fixed |
|---|---|---|---|---|---|
| F1 | WARNING | `PrologueScreen.tsx` | `onComplete` could fire after unmount (Return to title while the profile call was pending), starting paid calls for an abandoned character | `aliveRef` (set true inside the effect for StrictMode safety) guarding the profile and beat calls; unmount and StrictMode tests | 1 |
| F2 | WARNING | `PrologueScreen.tsx` | Action textarea had no accessible name | `aria-label="Your action"`, `aria-describedby` hint | 1 |
| F3 | WARNING | `PrologueScreen.tsx` | Focus lost after the fourth beat | focus falls back to the "Let it take hold" button | 1 |
| Q1 | WARNING | `routes/prologue.ts` (tests) | Prompt text claimed verbatim but unpinned (five rewordings survived) | committed fixtures `prologueNarrator.prompt.txt` / `prologueProfile.prompt.txt` and `prologuePrompts.test.ts`, checked against `run-v2-1.mjs` | 1 |
| Q2 | WARNING | `shared/src/prologue.ts` (tests) | Profile history length not pinned (`.length(9)` -> `.min(3)` survived) | rejection tests for 3/5/7/11 entries, schema and route level | 1 |
| Q3 | WARNING | `routes/prologue.ts` (tests) | Beat and profile route labels swappable without a red test, corrupting per-route cost logs | usage-line route-label test | 1 |
| Q5 | WARNING | `routes/prologue.ts` | A whitespace-only model narration surfaced as a bare ZodError 500 | guard throws `WorldVoiceCallError('INVALID_RESPONSE_SHAPE', 502, ...)`; test | 1 |
| F4 | SUGGESTION | `PrologueScreen.tsx` | Progress bar and narration lacked roles/live announcements | `role="progressbar"`, transcript `role="log"` `aria-live="polite"` | 1 (taken) |
| Q4 | SUGGESTION | tests | `isTrivialAction` untested | 17-case table test | 1 (taken) |
| Q6 | SUGGESTION | tests | no trim test; over-claiming `completedRef` test name | trim test; honest rename | 1 (taken) |
| S1 | SUGGESTION | `routes/prologue.ts` | Client-held narrator history is only de-tagged, trusted by position | Informational: recorded in the design log; no code change (no more privileged than posting arbitrary answers to the unchanged unique-skill route) | n/a |

## Left as is (cycle 2, below the action threshold)
- Frontend (MEDIUM, 65%): focus is not restored to a control after a failed profile call.
- QA: four aliveRef guards (after the beat call, beat catch, beat finally, profile catch) and `completedRef` / the `aria-valuenow` clamp have no test that goes red when removed. On React 19 the first four only skip silent post-unmount state updates; the last three are unobservable defence in depth (the disabled button and the `turns >= 4` check already cover them). Four equivalent or cosmetic survivors from cycle 1 (allow 5 players; beat `.max(8)`; profile "last must be narrator"; response `beat` bounds) are likewise covered by other checks.

## Reviewer verdicts
- **testing-qa-verification-specialist:** cycle 1 NEEDS WORK (4 warnings, ~75 mutations, 13 genuine survivors); cycle 2 **PASS** (~60 mutations; all 16 cycle-1 survivors now killed by named tests; counts re-derived twice; nothing left running; tree clean).
- **engineering-security-engineer:** cycle 1 **PASS**; cycle 2 **PASS** (new 502 guard, fixtures and unmount guard checked; no secret material in fixtures; no `system` key on either route; unique-skill still system-blind).
- **engineering-frontend-developer:** cycle 1 NEEDS WORK (3 warnings, 1 suggestion); cycle 2 **PASS** (all four findings re-verified fixed).

## Evidence at review close
Backend 404 tests (23 files), frontend 327 (22 files), Playwright 28 (12 prologue), hosted prologue suite 4/4 and `mutate-order.sh` 3/3 earlier; both typechecks and the build clean; `App.tsx`, `worldEngine.ts` and `introScene.ts` byte-identical to `216f550`; `uniqueSkill.ts` differs by exactly the one intended prompt line (d5df291) with its fixture. Fix commit: `90a31fb`.

## Post-review polish
Not run. `settings.review.polish` defaults to true, but a code-polish pass over files whose guards were just pinned by mutation testing adds risk for no finding; run `/legion:polish` separately if wanted.
