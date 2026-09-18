# 04-01 — Summary

**Plan**: 04-01 — Eight-constraint preservation audit (Phase 4, Wave 1)
**Requirement**: R13
**Agent**: QA Verification Specialist
**Audited at HEAD**: `4e29596769490d0f8af0905faa719610fc3e415f`
**Date**: 2026-09-18
**Cost**: free (no API calls; both Vitest suites run locally)

---

## Outcome

**All eight `CLAUDE.md` hard constraints audited. 8 PASS, 0 FAIL, 0 UNVERIFIED.**
Four observations recorded that are not constraint violations (below).

The R13 checklist now exists at
`.planning/phases/04-parity-verification/04-01-CONSTRAINT-AUDIT.md`, and R13's own text no longer
contradicts it.

| # | Constraint | Verdict |
|---|---|---|
| 1 | No `window.confirm` / `alert` / `prompt`; in-UI confirm | PASS |
| 2 | Saves via `localStorage`, never `window.storage` | PASS |
| 3 | `min-height: 0` on every flex ancestor of a scroll region | PASS |
| 4 | World Voice JSON contract field names preserved | PASS |
| 5 | `max_tokens` ≥ 2000 on all three World Voice calls | PASS |
| 6 | MUST NOT list intact (no removals or softenings) | PASS |
| 7 | Lore / behaviour split preserved, blocks not merged | PASS |
| 8 | `determineUniqueSkill` sends no `system` param at all | PASS |

---

## Tasks completed

**Task 1 — constraints 1-4 (frontend-facing).** Each re-derived at HEAD `4e29596`, not carried over
from Phase 3's review at `61fbb07`. Constraint 3 was walked as **four** ancestor chains (mobile
World tab, mobile Codex tab, desktop right column, desktop left sidebar) from each of the two scroll
regions to the page root, produced as four tables rather than a claim. Six flex-item ancestors
exist across those chains; 6/6 carry `minHeight: 0`.

**Task 2 — constraints 5-8 (backend/prompt).** Phase 3 was the frontend port and could not have
touched `backend/src/`; these were verified anyway rather than assumed. Constraints 6 and 7 were
compared against the **current** `backend/src/data/worldSystemPrompt.ts` and `worldLore.ts` using a
directional test (removals are the failure, additions are not), not byte-equality with legacy.
Constraint 8 was verified on the **strong** claim (`'system' in request === false`), not the weaker
"lore-blind" one.

**Task 3 — deliverables.** Audit document written, `PROJECT.md:38` corrected, this summary written.

---

## Files modified

Exactly the three declared in the plan's `files_modified`. The source tree is byte-identical outside
them — nothing in `frontend/`, `backend/`, `shared/` or `legacy/` was touched, so plans 04-02 and
04-03 run against an uncontaminated tree.

| File | Change |
|---|---|
| `.planning/phases/04-parity-verification/04-01-CONSTRAINT-AUDIT.md` | new — eight-row verdict table, per-constraint evidence, four ancestor-chain tables, four observations |
| `.planning/phases/04-parity-verification/04-01-SUMMARY.md` | new — this file |
| `.planning/PROJECT.md` | 1 line — R13 "seven" → "eight" (line 38); 1 insertion, 1 deletion |

```
$ git status --porcelain
 M .planning/PROJECT.md
?? .planning/phases/04-parity-verification/04-01-CONSTRAINT-AUDIT.md
?? .planning/phases/04-parity-verification/04-01-SUMMARY.md
```

No code was mutated at any point, so retro rule P2-3 (assert-the-mutation-applied, restore with
`diff` proof) never became applicable.

---

## Evidence produced

Derived counts, each with the command that produced it (retro rule AI-4):

| Figure | Command | Result |
|---|---|---|
| Constraint count | `grep -cE '^[0-9]+\. \*\*' CLAUDE.md` | **8** |
| Native dialog calls | `grep -rnE '\b(window\.)?(confirm\|alert\|prompt)\(' … \| grep -vcE '^\S+:[0-9]+:\s*(\*\|//\|/\*)'` | **0** |
| `window.storage` uses | `grep -rn 'window\.storage' frontend/src shared/src backend/src` | **1**, a `//` comment |
| Scroll regions | `grep -rnE 'overflow(Y\|X)?:\s*"(auto\|scroll)"' … ` comment-filtered | **2** |
| `minHeight: 0` sites | `grep -rnE 'minHeight:\s*0' frontend/src --include='*.tsx'` comment-filtered | **6** |
| Contract field names | `diff` of `CLAUDE.md:28-38` vs `worldVoice.ts:212-220` | **9**, identical |
| `max_tokens` | `anthropic.ts:112` | **16000** (≥ 2000) |
| API call sites in backend | `grep -rn 'messages\.parse' backend/src` | **1** (all 3 routes share it) |
| MUST NOT list removals vs legacy | normalized `diff`, `grep -c '^<'` | **0** |
| MUST NOT list additions vs legacy | normalized `diff`, `grep -c '^>'` | **1** |
| `WORLD_SYSTEM_PROMPT` additions vs legacy | normalized `diff` | **2** substantive (3 lines, 1 blank) |
| `WORLD_LORE` diff vs legacy | normalized `diff` | **0** — byte-identical |
| Backend suite | `cd backend && npx vitest run` | **7 files, 108 tests passed** |
| Frontend suite | `cd frontend && npx vitest run` | **9 files, 129 tests passed** |

---

## Nothing left UNVERIFIED

Every constraint produced direct evidence. No row needed the UNVERIFIED verdict.

Eight-for-eight on a first audit is the result this role is trained to distrust, so the reasoning is
stated rather than assumed: these are **preservation** properties on a tree that has already been
through three phases of review, and four of the eight (4, 5, 7, 8) are fully guarded by committed
automated tests or a startup assertion that would fail the process on drift. The two greps-for-
absence (1, 2) have zero true positives.

Two rest on something weaker, and both are handed onward rather than glossed:

- **Constraint 3** rests on manual chain-reading, because jsdom computes no flex layout and no
  committed test can observe it → observation O-1, for plan 04-03's Playwright smoke test.
- **Constraint 6** is only *partially* test-guarded. One of its eleven bullets is asserted
  (`prompts.test.ts:274-287`, the untrusted-tag rule); none of the six rules `CLAUDE.md:42` names by
  hand is asserted anywhere. It passes on this audit's `diff` against legacy, which is a
  point-in-time check, not a standing guard → observation O-5, with a drafted six-assertion
  regression test, for plan 04-02.

---

## Observations handed onward — recorded, not fixed

This was an audit-only plan; a fix here would have exceeded `files_modified` and contaminated 04-02
and 04-03. Full detail in the audit document's final section.

- **O-1 → plan 04-03.** Constraint 3's chains are valid only because `index.css` declares no `body`
  or `#root` rule, so neither layout root is a flex item. If anyone adds `display: flex` there, both
  layouts break at depth 1 and nothing in the suite would catch it. A good candidate assertion for
  04-03's Playwright smoke test — the one place a real layout engine is available.
- **O-2 → this phase's prose.** "Two deliberate, approved additions" is a whole-`WORLD_SYSTEM_PROMPT`
  figure. At MUST-NOT-list scope the derived number is **one**; the second addition is the
  `world_events` shape spec in RESPONSE FORMAT. Both underlying facts are correct, the attribution
  in `04-CONTEXT.md` is not. Flagged per AI-4 so it is not restated.
- **O-3 → plan 04-04.** `CLAUDE.md:40` says `max_tokens` was "raised from an original 1000" with a
  floor of 2000; the code has been at 16000 since Phase 2. Constraint 5 **passes** (16000 ≥ 2000),
  but `CLAUDE.md`'s prose history is stale. Documentation drift, and 04-04 owns `CLAUDE.md`.
- **O-5 → plan 04-02.** The one genuine hole. Constraint 6 is the constraint whose violation is
  invisible — deleting a MUST NOT bullet breaks no build and fails no test — and only 1 of its 11
  bullets is asserted (`grep -rn 'What you MUST NOT do' backend/src/__tests__/` → 1 hit,
  `prompts.test.ts:282`). The audit document drafts the fix: six `toMatch` assertions over the
  already-sliced MUST NOT block, one per rule `CLAUDE.md:42` names. Not written here — it is a
  backend test file, outside this plan's three declared files, and 04-02 owns test-gap closure.
- **O-4 → developer decision.** `worldLore.ts:83`'s Mycelium continuity ambiguity is a reveal
  constraint with no counterpart in the MUST NOT list (`grep -ci 'mycelium'` → 0 in the list, 2 in
  the lore). It is pre-existing and byte-identical to the artifact, so constraint 7 is not violated —
  nothing moved. Adding a generic ambiguity bullet would be an *addition*, which constraint 6 calls
  cheap insurance, but that is the developer's call, not an auditor's.

---

## Constraints deliberately left alone

The inherited `currentSlotId` closure race (`App.tsx:291`, identical to legacy 913-1031) was
encountered while reading `App.tsx` for constraint 1. Per the Phase 4 planning gate it stays
unfixed and is not reported as a new finding; it remains recorded in `03-REVIEW.md` finding 11.
