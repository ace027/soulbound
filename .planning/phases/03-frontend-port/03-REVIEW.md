# Phase 3: Frontend Port — Review Summary

## Result: PASSED (2 cycles)

Reviewed 2026-09-17 at HEAD `61fbb07`. Dynamic three-reviewer panel, non-overlapping rubrics:

| Reviewer | Lens | Verdict |
|---|---|---|
| QA Verification Specialist | Port parity vs. the legacy artifact; CLAUDE.md constraints; evidence quality | NEEDS WORK |
| Test Results Analyzer | Test-suite validity, via an independent mutation sweep | NEEDS WORK |
| Frontend Developer | React correctness, hooks, props, render hazards, error paths | NEEDS WORK |

All three verdicts were NEEDS WORK with **zero BLOCKER findings against the ported
behaviour itself**. The QA reviewer diffed every module against legacy line ranges it
derived independently and found no dropped, reordered, or silently-changed behaviour.
The blockers that did exist were *coverage* blockers — code that was correct but
unconstrained by any test.

## Findings and resolutions

| # | Sev | Finding | Resolution |
|---|---|---|---|
| 1 | BLOCKER | `handleAction`'s entire `catch` branch was unobserved. Replacing it with `void e;` — deleting the player-visible "The World Voice fell silent" entry — left the suite green and `tsc` clean. | **Fixed.** Two integration tests: a rejected `fetch`, and a 502 with a structured envelope. Assert the error entry renders with the real cause and no `undefined`, that `isThinking` resets, and that no partial autosave fires. |
| 2 | BLOCKER | "`newSkillIds` carries granted names only, never evolved ones" — stated in three docstrings — had zero coverage at either layer. Adding `newNames.add(ev.new_name)` to the evolution loop survived. | **Fixed.** Two tests in `applyWorldUpdate.test.ts`, including the sharp grant-then-evolve case where one name is both granted and evolved in one turn. |
| 3 | WARNING | The 2000/2500 ms glow-clear timeouts are called "do not unify them" in three places, yet 2500 → 9999 survived. | **Fixed.** A `setTimeout` spy pins the action path at exactly 2500. Fake timers were rejected: they fight `waitFor` and the pending fetch, and `shouldAdvanceTime` crosses the boundary non-deterministically. |
| 4 | WARNING | `handleAction`'s `isThinking` double-submit guard was untested. `components.test.tsx` asserts the Act button carries `disabled`, which is a presentational prop, not proof the handler refuses a call. | **Fixed.** A test fires a second submit through ActionBar's Enter-key path (which calls `handleAction` directly, bypassing `disabled`) while a turn is in flight, and asserts one `fetch` and one action entry. |
| 5 | WARNING | `setPhase` typed `(phase: string) => void` on `SimulationScreen` and `SoulCodexContents`, bridged from App's `Phase` union by an unchecked cast. A typo'd phase would fall through to `return null` — a blank screen, no error. | **Fixed.** `Phase` is exported; both props narrowed; the cast is gone. |
| 6 | WARNING | `.planning/STATE.md` and `ROADMAP.md` still said Phase 3 was "planned, 0/10" and told the reader to run `/legion:build`. | **Fixed.** Both updated. Phase 4 would have started from a state file asserting the opposite of the truth. |
| 7 | SUGGESTION | Two early-return guards (`\|\| !gameState`, `if (!selectedRace) return;`) have no legacy analogue and were undisclosed in a file whose docstring enumerates every other delta. | **Fixed.** Documented as `strict: true`-forced and unreachable, with the reachability argument stated. |
| 8 | SUGGESTION | `writeSave`'s quota-exceeded / private-mode `catch` had no test. | **Fixed.** Two tests stubbing `Storage.prototype.setItem` to throw, asserting `false` is returned, nothing throws, and no phantom index entry is left. |
| 9 | SUGGESTION | Mutant counts disagree across plan (10), commit (11), and the file's own annotations. | **Acknowledged, not renumbered.** See "Counting" below. |
| 10 | SUGGESTION | Index-based `key` on the sub-abilities map. | **Not changed** — byte-identical to legacy 627, append-only in practice, and styling/markup changes are out of scope this phase. |
| 11 | WARNING | **Inherited closure race — deliberately NOT fixed.** | See below. |

### Finding 11 — the one thing left open, on purpose

`handleAction` closes over `currentSlotId`. `handleManualSave` ("+ Slot") has no
`isThinking` guard, so a player can create a new slot while a world-engine call is in
flight; that turn's autosave then lands on the **old** slot and the new slot stays one
turn stale. The reviewer reproduced this live with a deferred `fetch`.

It is present identically in legacy 913-1031, so the port did not introduce it. Under
CLAUDE.md's working-style rule — flag rather than silently change inherited behaviour —
this is a developer call, not a review fix. The minimal fix, if wanted, is to mirror
`currentSlotId` in a `useRef` and read that inside the `setLog` updater, which leaves the
deliberate autoSave-inside-setLog pattern intact.

## Verification after the fix cycle

All four previously-surviving mutants now die, each re-run with the mutation asserted
applied before any conclusion was drawn:

| Mutation | Before | After |
|---|---|---|
| evolved skill's name added to `newSkillIds` | survived | **2 tests fail** |
| 2500 ms → 9999 ms | survived | **1 test fails** |
| `isThinking` dropped from the guard | survived | **1 test fails** |
| `catch` body replaced with `void e;` | survived | **2 tests fail** |

`tsc --noEmit` exits 0. **127 tests across 9 files** (was 119).

## Process finding — the "flaky test" that was not flaky

Three reviewers ran in parallel against one working tree, one of which mutates source
files by design. All three independently observed an intermittent failure and attributed
it to Vitest worker-pool flakiness. **None of them was seeing a flake.** They were seeing
each other's live mutations:

- `expected +0 to be 5` in `applyWorldUpdate.test.ts` = the QA reviewer's `|| 5` → `?? 5`.
- a 9-test `api.test.ts` failure = the analyzer's `response.ok` → `if (false)`, which its
  own table records as killing exactly 9 of 32.

On a clean tree the suite is 8/8 green across eight consecutive full runs. No flake exists.

The fault is in the panel design, not in any reviewer — each correctly declined to certify
what it could not reproduce, and each lacked the one piece of context that would have
explained it. **A reviewer that mutates source needs its own worktree, or must run
serially after the read-only reviewers.**

## Counting

The analyzer noted the review brief's "29 killed mutants" matches nothing in the
repository. It is right: the commits' explicit claims are 11 + 4 + 3 + 5 + 4 + 5 = **32**,
with plans 02 and 05 never stating an achieved count at all. The 29 came from restating a
number out of earlier prose without re-deriving it — the exact failure this phase adopted a
rule against, committed in the brief that asked reviewers to watch for it.

Similarly, `applyWorldUpdate.test.ts`'s annotations resolve to 13 named mutants (12 comment
lines, one of which names two), not the "eleven" the phase-close commit states. Rather than
publish a fourth number, the durable form is `grep -c 'MUTANT' <file>` at the time of
reading. Counts in prose go stale; the derivation does not.

## Cycle 2 — re-review of the fix commit

Cycle 1's fixes were applied and then declared PASS without re-entering the review
loop. That was a gap: eight fixes across six files, including production code, verified
only by the orchestrator re-running the four mutants it had written the fixes against.
Cycle 2 re-reviewed the fix commit properly.

**Run serially this time**, with the mutating reviewer alone on the tree — the direct fix
for cycle 1's contamination. It was also told explicitly that the "flake" it had reported
was another reviewer's live mutation, so it would not spend the cycle re-investigating a
phantom or soften a real finding by attributing it to imagined flakiness.

**Verdict: PASS.** All four cycle-1 findings independently re-verified as closed — not
taken on the orchestrator's word. Two results worth recording:

- **The 2500 ms fix survives its sharpest variant.** The reviewer mutated 2500 → **2000**,
  not just → 9999. That is the collision case: `autoSave`'s own status reset is also
  2000 ms, so 2000 legitimately appears in the spy's call list. The assertion still fails,
  so the test distinguishes the two constants rather than merely seeing a familiar number.
- **The `Phase` narrowing is real, not cosmetic.** Mutating `setPhase("title")` to
  `setPhase("titel")` in `SoulCodexContents.tsx` now produces a `tsc` error. Before the
  cast was removed it would have compiled and silently blank-screened.

### New finding, found and fixed in cycle 2

**`deleteSave`'s try/catch was uncovered.** Removing it entirely left all 127 tests green
— the same shape as the `writeSave` gap cycle 1 found, on the sibling function. It matters
more than the symmetry suggests: `App.tsx#handleDeleteSave` calls it from a synchronous
onClick with no error boundary anywhere in the app, on the tap-to-arm → Confirm flow that
CLAUDE.md constraint #1 governs. A throw there is a dead delete button with nothing
rendered to explain it. Confirmed independently, then closed with two tests; the mutation
now kills both. `listSaves` and `loadSave` were checked the same way and are already
covered — this was specific to `deleteSave`.

Also fixed: the new `writeSave` failure tests restored their `Storage.prototype` spies
with a trailing call rather than a `finally`. The reviewer demonstrated the leak is real,
not theoretical — a failing assertion skips the restore and poisons the *next* test with a
misattributed stack trace. Now in `try/finally`.

Confirmed clean by a whole-project `tsc --noUnusedLocals --noUnusedParameters`: the dead
`act` import (found by hand, since `noUnusedLocals` is not set in `frontend/tsconfig.json`)
was the only one.

**129 tests across 9 files**, `tsc` exits 0.

### A second contamination vector, also mine

A stop hook prompted a commit while cycle 2's reviewer was mid-sweep. The commit itself was
safe — the single path was inspected before and after staging, and `git add -A` would have
captured a live mutation instead. But the reviewer still observed HEAD changing under it
mid-run and said so. Committing during a review run is its own hazard, distinct from
running reviewers in parallel, and the same rule closes both: **while a reviewer holds the
tree, do not write to it.**

## Not covered by automated tests

1. **Real pixel layout.** jsdom performs no layout. The suite asserts *declared* style
   properties — which does catch a removed `flex: 1` or `minHeight: 0`, contrary to what
   the plans originally claimed — but cannot see an actually collapsed panel. Plan 03-08's
   screenshots closed this once, manually; the harness was deleted, so there is **no
   repeatable visual regression guard** going forward.
2. **A live backend.** Every frontend test mocks `fetch`. The API wiring has never touched
   a real Express server or a real model call. That is R14, in Phase 4.
3. **The `runtime` Docker image**, which still answers `/api/*` with 200 + HTML. Known,
   deferred, and dormant only while nothing is served from it.
4. **Cross-browser and touch.** One Chromium build, fixed viewports, synthetic events.
5. **The two inert null guards' unreachability** is argued, not asserted by a test.
