# Plan 14-04 Summary — Spanning tests and placement e2e

**Status: Complete with Warnings** (Wave 4, executor: testing-qa-verification-specialist; orchestrator re-verified). Tests only; no source changed by this plan.

## Files (all new)
- `backend/src/__tests__/prologueHandoff.test.ts` (4 tests) — profile route output posted verbatim to the unchanged `/api/unique-skill`; hostile profile values stay inside `<player_answer>` wrapping (six opening / five closing tags, relative counts); over-length profile value -> 502; renderer unchanged
- `frontend/src/__tests__/prologueIntegration.test.tsx` (4 tests) — whole `<App />` with `?prologue=1`: 4 beat calls, 1 profile, 1 unique-skill whose `answers` equal the five profile keys plus the chosen name and race, then intro-scene and the simulation; flag off makes no `/api/prologue/` request; profile failure then retry; unique-skill failure after a good profile recorded as today's `App.tsx` behaviour
- `frontend/e2e/prologue.spec.ts` (6 tests at each of 390 and 1280 px) — real geometry: no overlap, no horizontal overflow, narration scrolled into view each turn, 2000-character unbroken action wraps, error/reading/copy-fallback states fit

## Verification (orchestrator re-run)
- Backend 369 -> **373** (+4, 22 files); frontend 317 -> **321** (+4, 22 files); whole Playwright suite **28 passed** (12 new, existing specs unaffected)
- `git diff HEAD` over `frontend/src`, `backend/src/routes`, `shared`: no source change; `uniqueSkill.ts` and `App.tsx` identical to `216f550`
- Executor: 12/12 verification commands

## Mutations (all caught, restored, hash confirmed)
| Mutation | Caught by |
|---|---|
| `wrapUntrusted` removed on `answers.flaw` in `uniqueSkill.ts` | handoff cases 1, 2 |
| bond `.max(ANSWER_MAX)` -> `.max(10)` | handoff cases 1, 2, 4 |
| `onComplete({ ...profile, nature: '' })` | integration five-key assertion |
| wrapper always renders the prologue | integration flag-off test |
| textarea container `position:absolute; top:0` | opening and four-turn e2e (first pass caught only one 390 px test; the opening test was strengthened and now fails at both widths) |

## Decisions
- One weak assertion recorded: handoff case 3's "no unique-skill request" half is partly true by construction; the 502 and error code are pinned.
- The e2e asserts the container starts at x = 0 but does not pin its top, because of defect 1 below.

## Visual defects seen (screenshots at 390 and 1280 px, viewed)
1. Page opens scrolled 64 px: `sharedBg` is `minHeight: 100vh` plus 32 px padding top and bottom (content-box), and `PrologueScreen`'s scroll-into-view effect also runs on mount. The padding pattern is shared with the other screens (TitleScreen uses 100vh + 40 px), so the overflow is partly pre-existing; the on-mount scroll is this phase's.
2. The column re-centres as the transcript grows (Return to title top: 104 -> 80 -> 36 px at 390 px): visible content jump. This phase's doing (copied the questionnaire's centring, which has fixed-height content).
3. Auto-scroll leaves Return to title off-screen on later turns (no sticky header).
4. Low contrast: disabled Act button `#4a3a28` on `#1a1610`; hint and Return to title link `#6a5a40` on near-black. Both colours are copied from the questionnaire (pre-existing styling).
5. Copy-fallback textarea has almost no inner padding.
6. Large empty area under the opening at 390 px (vertical centring).
No overflow, overlap or clipping at either width.

## Follow-up
Defects 1 and 2 are fixed in a follow-up commit (stop scrolling on mount; top-align the column). 3-6 are reported to the developer, not changed (4 is shared styling with the questionnaire).
