# Phase 4: Parity & Verification — Review Summary

## Result: PASSED (3 cycles)

Reviewed 2026-09-18, starting at HEAD `d2f843a`. Dynamic three-reviewer panel, non-overlapping
rubrics, **run serially where a reviewer held mutation rights** — the direct application of the
Phase 3 retro's AI-1, after three parallel reviewers there misread each other's live mutations as a
flaky Vitest pool.

| Reviewer | Lens | Cycle 1 | Cycle 2 | Cycle 3 |
|---|---|---|---|---|
| QA Verification Specialist | Evidence quality & parity claims | NEEDS WORK (6) | NEEDS WORK (5/6 closed, 1 partial, 5 new) | NEEDS WORK (5/8 closed, 3 partial) |
| Technical Writer | Documentation truth & the deletion | NEEDS WORK (11) | NEEDS WORK (9/11 closed, 2 deferred, 3 new) | — |
| Test Results Analyzer | Test-suite validity | **PASS** (4, none blocking) | — | — |

**29 findings across three cycles. Zero BLOCKERs at any point.** All closed or, for two items,
recorded and then resolved at the review gate by developer decision.

## The headline: the verification held, the documentation did not

The substantive work survived independent re-derivation. A reviewer reproduced, without trusting
the phase's own reports:

- `WORLD_LORE` byte-identity against the recovered artifact — `diff` exit 0, CRLF-normalized
- the whole-prompt diff **at a wider slice than the audit used** — 3 additions, 0 removals
- the 9-name contract field diff — IDENTICAL
- every headline count (8 constraints, 69 citations, 25 files, 108/129 tests, 5 e2e, 3 typechecks)
- the recovery path end to end

A second reviewer re-ran four of 04-02's mutations and 04-03's mutant 1 and **matched the reported
SHAs to the digit** — strong evidence both authors ran what they documented rather than reasoning
about it. It also killed the *adjacent* `minHeight: 0` site (line 129, no `overflow`) and got
CLAUDE.md #3's exact failure signature, establishing that 04-03's reported survivor is a genuinely
redundant declaration rather than an excused weak test.

What failed review was the set of documents that outlive the deleted oracle, and every defect was
the same species this phase was chartered to eliminate: **claims restated rather than derived.**

## Findings that mattered

| # | Cycle | Sev | Finding | Resolution |
|---|---|---|---|---|
| 1 | 1 | WARNING | The design log named the **Ultimate-path restriction** as a post-artifact addition to `WORLD_SYSTEM_PROMPT`. It is *in* the artifact (`grep -c` → 1 in both). The real second addition is the `world_events` shape spec — which 04-01 derived correctly in the same phase. | **Fixed.** A false claim about what differs from the artifact, asserted at the moment the oracle was deleted. A later constraint-6 audit would have concluded a balance rule post-dated the artifact. |
| 2 | 1 | WARNING | **Constraints 1 and 2 had no committed guard of any kind.** The audit's 8/8 justification claimed seven of eight were guarded; five were. Proven by mutation: `window.confirm` *and* `window.alert` in the delete branch, all 242 tests green. | **Fixed.** `frontend/src/__tests__/constraints.test.ts`, verified by re-applying that exact mutation. The audit now also records the **false positive**: gating the delete on `window.confirm` *does* fail a test, but only because jsdom's `confirm()` returns `undefined` and the gate swallows the call. Reading that as coverage is the trap. |
| 3 | 1 | WARNING | The paid, unrepeatable R14 run retained **zero** raw evidence — in the phase that fixed exactly that failure for layout, two plans earlier (retro AI-5). | **Fixed.** `evidence/` holds the 7 usage lines, 8 screenshots, 3 drivers. Re-scanned for the key: 0. |
| 4 | 1 | WARNING | `CLAUDE.md` asserted 15,132 cache tokens after 04-05 measured 15,490 and retired the figure; on no carried-forward list. | **Fixed.** Both measurements recorded, with which to quote. |
| 5 | 1 | WARNING | `README.md` still advertised `legacy/` as the live parity oracle — the first place a reader who hits `legacy 1022-1027` looks. 04-06's own stated principle, applied to its own blind spot. | **Fixed.** |
| 6 | 1 | WARNING | Four of the audit's evidence blocks invoked the deleted file and no longer ran. | **Fixed.** `"$LEGACY"` plus a documented preamble, verified end to end. |
| 7 | 2 | WARNING | **04-05's mastery progression was contradicted by the screenshots cycle 1 had just committed.** "Kept Verdict 0 → 12 → 19" sampled the intro scene, turn 3, and the *separate* reload session as one three-turn progression. | **Fixed** to 3 → 9 → 12 / 5 → 5 → 9 / 8 → 11 → 16, verified against the images. See "the mechanism working", below. |
| 8 | 2 | WARNING | The new constraints guard required a `window.` prefix, so bare `confirm(...)` / `alert(...)` — the same native API, more idiomatic — passed all 136 tests while jsdom printed "Not implemented: Window's confirm() method". | **Fixed** and verified by mutation. |
| 9 | 3 | WARNING | The bare-global guard excluded `prompt` on the stated reasoning that it is a common identifier here. **Measured: false** — zero bare `prompt(` calls, all four mentions in comments that `stripComments` removes. A bare `prompt("...")` passed all 138 tests. | **Fixed.** `prompt` added; the docstring now carries the re-runnable derivation instead of the false rationale. |
| 10 | 3 | WARNING | The corrected mastery bullet **reused a stale number as its new baseline** ("starting from 0 / 5 / 16"). 16 is turn 3's Dark Sense value; the intro capture cuts off below that row, and mastery does not decrease. | **Fixed.** States what the image shows; declines to assert what it does not. |
| 11 | 3 | WARNING | The tag caveat sat ~21 lines *below* the copy-pasteable block it corrected, so a reader ran the failing command first. | **Fixed.** Verified in a simulated fresh clone. |
| 12 | 1-3 | — | **Hard constraint 8 understated what the code guarantees** — it forbade lore access while the code sends no `system` param at all. Raised independently by two reviewers. | **Not fixed by the review** — hard constraints are the developer's. Put to them at the gate and **approved**; `CLAUDE.md` constraint 8 now reads "system-blind" with the route, the spread and the pinning test cited. |

## The mechanism working — worth recording

Finding 7 exists **because** finding 3's fix worked. Committing the screenshots turned an unchecked
prose claim into a checkable one, and the first check failed it. The evidence was filed to make
re-verification possible without re-spending ~$0.31 on the API; its first act was to catch an error
in the document it was filed under.

That is the argument for retaining raw evidence, stated better than any policy could.

## The process failure, named plainly

**Every fix commit seeded a new instance of the defect class it was closing.** Cycle 1's fixes
introduced pointer drift in the opposite direction ("Two alternatives" over three bullets) and a
turn count contradicting evidence committed in the same breath. Cycle 2's fixes introduced a false
rationale and a stale baseline number.

Cycle 3's reviewer named the root cause: *"the fixes were not re-checked against the same evidence
standard applied to the original findings."* That is accurate. Findings were derived; fixes were
reasoned about. The `prompt` exclusion is the cleanest example — one run of the proposed pattern
would have shown 0 matches and killed the rationale instantly.

**Rule for the next phase: a fix is a claim, and carries the same derivation burden as a finding.**

An honest limitation on this PASS: cycle 3's three fixes were verified by the orchestrator — by
mutation for the `prompt` hole, against the images for the numbers, and in a `--no-tags` clone for
the recovery path — but were **not** independently re-reviewed, the cycle limit having been reached.
Given the pattern above, that is the weakest link in this verdict, and it is stated rather than
smoothed over.

## Also corrected, found outside review

The `parity-oracle` tag **cannot be pushed from this environment** (four retries with backoff,
`remote end hung up`; the branch pushes fine, so it is a tag-ref permission). README, the design log
and the audit all instructed readers to run `git show parity-oracle:...`, which fails in any fresh
clone — a fix-induced defect worse than the bare-SHA fragility it replaced. All three now lead with
`git show 3d01fa5:...`, an ancestor of the pushed branch, verified in a tagless clone. **Push the
tag when you have credentials that allow tag refs**; until then the SHA is the working handle.

## Final state

```
backend   108 tests / 7 files        npx tsc --noEmit  exit 0
frontend  139 tests / 10 files       npx tsc --noEmit  exit 0   (129 at review start, +10 guards)
e2e         5 tests / 1 file         shared tsc        exit 0
npm run build  clean
```

## Carried forward — see `04-06-SUMMARY.md` for the full list

Ten open items remain recorded, none blocking: Docker Compose never exercised against live calls;
the non-deployable `runtime` image; nothing runs `test:e2e` in CI; long-session behaviours (80-entry
cap, 40-note cap, Soul Rewrite) never reached; **constraint 6's MUST NOT list only partially
test-guarded** — the same shape as the constraint 1/2 gap this review closed, and the obvious next
one to take; the inherited 8px body-margin defect; the stale `max_tokens` prose; the declined
`currentSlotId` closure race; cross-browser coverage; cache-expiry cost.
