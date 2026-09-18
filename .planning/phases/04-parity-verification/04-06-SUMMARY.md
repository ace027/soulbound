# 04-06 — Legacy deletion and phase-close cross-plan re-verification

**Status: COMPLETE. Phase 4 closes.** Run against the final tree at `3d01fa5`.

## Task 1 — every repo-wide assertion, re-run at close

Nothing verified mid-phase is assumed to still hold. Each check re-run, not cited.

| Check | Owner | Command | Result |
|---|---|---|---|
| eight constraints | 04-01 | `grep -cE '^[0-9]+\. \*\*' CLAUDE.md` | **8** ✅ |
| no "OPEN DECISION" | 04-04 | `grep -n 'OPEN DECISION' CLAUDE.md` | no match ✅ |
| model split in log | 04-04 | `grep -ci 'opus' docs/design-decisions-log.md` | **5** ✅ |
| no native dialogs | P3 / c#1 | `grep -rnE 'window\.(confirm\|alert\|prompt)\('` (code only) | no match ✅ |
| no `window.storage` | P3 / c#2 | `grep -rn 'window\.storage'` (comments excluded) | no match ✅ |
| no direct Anthropic calls | P3 | `grep -rn 'anthropic' frontend/src` minus `__tests__` | no match ✅ |
| no JSX `<style>` injection | P3 | `grep -rnE '<style'` (comments excluded) | no match ✅ |
| backend typecheck | all | `npx tsc --noEmit` | exit 0 ✅ |
| frontend typecheck | all | `npx tsc --noEmit` | exit 0 ✅ |
| shared typecheck | all | `npx tsc --noEmit` | exit 0 ✅ |
| full suite | all | `npm test` | **108** backend + **129** frontend ✅ |
| e2e layout guard | 04-03 | `npm run test:e2e` | **5 passed** ✅ |
| production build | 04-03 | `npm run build` | ✅ |

**Both known scoping traps were applied up front** rather than rediscovered: the `<style>` grep
matches four prose comments describing the removal, and the `anthropic` grep matches the two
negative assertions inside the test that enforces the ban. Scoped to code, both are clean.

The full suite and all three typechecks were re-run **again** after the deletion below.

## Task 2 — the legacy artifact is retired

**Counts re-derived, not restated:** 25 files carry citations
(`grep -rl 'legacy [0-9]\|legacy/souldbound' frontend/src shared/src backend/src | wc -l`), and
there are **69** occurrences
(`grep -rhoE 'legacy [0-9]+(-[0-9]+)?' frontend/src shared/src | wc -l`). Both unchanged from the
planning-gate derivation. No code imports the file — verified, not assumed.

**Deletion was conditional on parity, and parity was confirmed.** Plan 04-05 reported R14 **MET**
against a live backend and the real models: a full creation-to-play run, a cross-route cache read
(intro-scene wrote 15,490 tokens, world-engine read the same 15,490), and save → reload → load
verified field by field against state the app's own autosave wrote from real model output. Had
04-05 reported UNTESTED, the file would have stayed.

**Approach chosen: delete, with a single documented resolution point.** The three options were
delete-with-a-pointer, delete-and-rewrite-all-69-citations, or keep. Rewriting 69 citations across
25 files was rejected: it churns the docstrings of every ported file at phase close — a large,
risky diff with no behavioural gain. Keeping was rejected because parity is confirmed and the
logged decision (PROJECT.md, ROADMAP) is to delete once it is.

**Recoverable at `3d01fa5`**, and the recovery was *tested*, not asserted:

```
git show 3d01fa5:legacy/souldbound-world.jsx                        # 1440 lines
git show 3d01fa5:legacy/souldbound-world.jsx | sed -n '1022,1027p'  # a cited range
```

That second command returns the exact `autoSave`-inside-`setLog` block that `App.tsx`'s docstring
cites as `legacy 1022-1027`. The citation scheme still resolves.

**Scope extension, declared not absorbed:** this plan's `files_modified` named only the legacy file
and this summary, but the resolution note went into `docs/design-decisions-log.md`. A note buried in
a phase summary is not "where the next reader will find it" — the next reader is someone reading
`App.tsx` and hitting `legacy 913-1031`. The design log is where `CLAUDE.md` already sends readers
for why-decisions. The same edit also corrected that file's line 3, which still named the artifact
as "the source of truth for current behavior" — 04-04 found it and deliberately deferred it here,
because deletion is what settles it.

## Task 3 — Phase 4 exit criteria

| ROADMAP criterion | Verdict | Evidence |
|---|---|---|
| Full playthrough in-sandbox | **MET** | 04-05: creation → intro → 3 world-engine turns, real browser, real models |
| Save, reload, load, state restored | **MET** | 04-05: 4/4 fields match across a full reload, on app-written live state |
| Contract test passes valid / fails malformed; save round-trip | **MET** | 04-02: 8 mutations, 0 survivors |
| All eight constraints audited with evidence | **MET** | 04-01: 8 verdicts, 0 FAIL, 0 UNVERIFIED; re-run above |
| `CLAUDE.md` updated (model split, auth note) | **MET** | 04-04; re-verified above |
| `design-decisions-log.md` updated (split + `determineUniqueSkill` correction) | **MET** | 04-04: log went from 0 to 5 "opus" mentions |
| `legacy/souldbound-world.jsx` deleted once parity confirmed | **MET** | this plan |

Requirements R13, R14, R15, R16 all close.

## Not covered by automated tests — consolidated, carried forward

1. **Docker Compose against live API calls.** 04-05 ran host-run. The containerized path still
   needs `-e NODE_EXTRA_CA_CERTS=/ca/ca-bundle.crt -v /root/.ccr/ca-bundle.crt:/ca/ca-bundle.crt:ro`
   and has never been exercised against a real call.
2. **The `runtime` Docker image** still answers `/api/*` with 200 + HTML. Known since Phase 3,
   dormant only while nothing is served from it.
3. **Nothing runs `test:e2e` automatically.** CI runs `npm ci`, `npm run build`, `npm test`; root
   `npm test` does not reach workspace `test:e2e` scripts. The layout guard runs when a human runs
   it. Wiring it up needs a browser-install step and a decision on whether it gates merges.
4. **Long sessions.** Seven live calls is not fifty. The 80-entry log cap, the 40-note memory cap
   and Soul Rewrite were never reached. Sub-ability emergence was observed only as *correctly not
   firing* below mastery 25 — never as firing.
5. **Constraint 6 is only partially test-guarded** (04-01, O-5). The `WORLD_SYSTEM_PROMPT` MUST NOT
   rule list has one assertion covering one of its bullets
   (`grep -rn 'What you MUST NOT do' backend/src/__tests__/` → 1), and **none** of the six rules
   `CLAUDE.md:42` names is asserted anywhere. Deleting a balance rule breaks no build and fails no
   test. A six-`toMatch` regression test over the already-sliced MUST NOT block would close it.
   Left open deliberately: it is a constraint-6 gap in `prompts.test.ts`, outside every plan's
   declared files this phase.

   **Constraints 1 and 2 had the same gap and are now CLOSED** (found in the Phase 4 review, which
   established by mutation that a behaviour-preserving `window.confirm(...)` plus `window.alert(...)`
   in `TitleScreen.tsx`'s delete branch left all 242 tests green). Closed by
   `frontend/src/__tests__/constraints.test.ts`, which fails on exactly that mutation.
   **Trap for the next auditor:** the naive check gives a false positive. *Gating* the delete on
   `window.confirm` does fail an existing test — but only because jsdom's `confirm()` returns
   `undefined`, so the gate swallows the call and the tap-to-arm assertion fails on behaviour, not
   on the banned API. Do not read that failure as coverage.

11. **Hard constraint 8 understates what the code guarantees — developer decision.** `CLAUDE.md:46`
    says `determineUniqueSkill()` "does not receive `WORLD_LORE`" and forbids adding *lore* access.
    The code is stronger: it sends **no `system` parameter at all** (`routes/uniqueSkill.ts:169`
    `useSystem: false`, pinned by `anthropic.test.ts:286-293`). As literally written, a future
    session could add `WORLD_SYSTEM_PROMPT` — not lore — to that route and believe it complied,
    which would flip `useSystem` to `true` and change the exact prompt that survived the Tier 0
    adversarial tests. The design log now carries the corrected, stronger claim. **The constraint
    text itself was deliberately NOT edited**: hard constraints are the developer's, and
    strengthening one is their call, not a review fix.
6. **Body-margin layout defect** (04-03). Neither `index.css` nor the legacy artifact declared a
   `body` rule, so `body` keeps the UA default `margin: 8px`; every screen is `100vh` inside it, so
   the page is 8px taller than the viewport and acquires a scrollbar. Inherited, not introduced —
   the artifact never showed it because it rendered inside a Claude.ai iframe whose host page reset
   margins. One-line fix (`body { margin: 0 }`); it is a visual change to ported output, so it is
   the developer's call. The e2e spec encodes it as a named `BODY_MARGIN_OVERHANG_PX = 8` that
   should drop to 0 when a reset lands.
7. **`CLAUDE.md:40` `max_tokens` prose is stale** (04-01 O-3, 04-04). Says "raised from an original
   1000" with a floor of 2000; the code has been at 16000 since Phase 2. The constraint still
   passes — 2000 is a floor — but the history misleads. Inside a hard constraint, so not edited.
8. **The inherited `currentSlotId` closure race** (`App.tsx`, `03-REVIEW.md` finding 11). Creating a
   slot mid-turn lands that turn's autosave on the old slot. Present identically in legacy 913-1031.
   **Offered at the planning gate and declined — a decision, not an oversight.** The minimal fix, if
   ever wanted, is mirroring `currentSlotId` in a `useRef` read inside the `setLog` updater.
9. **Cross-browser and touch.** One Chromium build, fixed viewports, synthetic events.
10. **Cache expiry cost.** The measured `+$0.087` >5-minute-pause penalty was not reproduced; reads
    held at 15,490 throughout 04-05.

## Files

- `legacy/souldbound-world.jsx` — **deleted** (recoverable at `3d01fa5`)
- `docs/design-decisions-log.md` — retirement note + source-of-truth line corrected
- `.planning/phases/04-parity-verification/04-06-SUMMARY.md` (this file)
