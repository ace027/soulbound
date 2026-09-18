# Phase 4: Parity & Verification — Context

**Goal**: Prove the migrated app matches the artifact, and bring the logged decisions back in
sync with the code. Then delete the parity oracle.

**Requirements**: R13, R14, R16, R15

---

## Five things verified by reading the code, which changed this phase's shape

ROADMAP estimated 3 plans. It is 6. Each of these was derived, not restated — the rule Phase 3
adopted after four of its five blocking defects were restated numbers.

1. **R16 is already satisfied.** `backend/src/__tests__/contract.test.ts` has exactly the shape
   R16 asks for: case 1 does not throw on the real prompt; case 2 throws on a field rename
   (`gm_note` → `gm_notes`) naming both sides; case 3 throws on a missing field; case 4 throws a
   clear parse error on unparseable JSON; case 5 checks the derived schema's field paths against
   `CONTRACT_FIELD_NAMES`. Save round-trip tests exist at `frontend/src/lib/__tests__/saves.test.ts:163`.
   **R16 is a verification plan, not a build plan.**

2. **R13's own text is stale.** `.planning/PROJECT.md:38` says "All **seven** `CLAUDE.md` hard
   constraints"; `CLAUDE.md` contains **eight** (`grep -cE '^[0-9]+\. \*\*' CLAUDE.md` → 8);
   ROADMAP's Phase 4 criteria says eight. The audit covers 8 and corrects R13's wording.

3. **R15 is half-done and half-actively-wrong.**
   - `CLAUDE.md:49-54` **already** records the model split. That part needs no work.
   - `CLAUDE.md:63` still reads "Auth architecture — **OPEN DECISION**, resolve before scaffolding
     a backend". The backend is built, shipped and merged. This is actively misleading to the next
     reader, and it is the one R15 item nobody has touched.
   - `docs/design-decisions-log.md` contains **zero** occurrences of "opus" or "sonnet". The model
     split was never recorded there. That is the gap ROADMAP names.

4. **Deleting the legacy artifact has an uncosted consequence.** 25 source files carry **69**
   citations of legacy line numbers in their docstrings (`grep -rhoE 'legacy [0-9]+(-[0-9]+)?'
   frontend/src shared/src | wc -l` → 69). Git history preserves the file; the references stop
   resolving. This is a decision, not an `rm`.

5. **R14 has two documented blockers**, both already diagnosed in STATE.md: it needs a real API key
   (measured **$0.0499/turn**, ~$2.65 per 50-turn session) and, for containerized calls, the CA
   mount `-e NODE_EXTRA_CA_CERTS=/ca/ca-bundle.crt -v /root/.ccr/ca-bundle.crt:/ca/ca-bundle.crt:ro`.

## Decisions taken at the planning gate

- **The inherited `currentSlotId` closure race stays unfixed.** Offered and declined. It is present
  identically in legacy 913-1031, so fixing it would be a deliberate deviation from the artifact.
  It remains recorded in `03-REVIEW.md` finding 11 and in STATE.md. **Do not fix it in this phase**;
  a plan that "helpfully" repairs it is reversing a developer decision.
- **Every plan in this phase writes a `SUMMARY.md`.** Retro AI-6. Three phases have recorded plan
  outcomes only in commit messages, which is why the ship gate's build-completeness check could not
  hold as specified. That ends here: `{NN}-{PP}-SUMMARY.md` is a deliverable of every plan, not an
  afterthought.

## Rules carried from the Phase 3 retro — these are constraints, not suggestions

| # | Rule | Why |
|---|---|---|
| AI-1 | A mutating reviewer gets an isolated worktree, or runs serially after read-only ones | Three reviewers misdiagnosed each other's live mutations as a flaky test |
| AI-2 | While a reviewer holds the tree, do not write to it — including hook-prompted commits | Near-miss: `git add -A` would have committed a live mutation |
| AI-3 | After any fix cycle, re-enter review | The `deleteSave` gap survived cycle 1 and would have shipped |
| AI-4 | Any count in prose carries the command that derives it | "29 mutants" vs 32; "eleven" vs 14 annotation lines; four wrong port ranges |
| AI-7 | When an agent reports viewing visual evidence, view it yourself before repeating the claim | Plan 09's screenshots were unexamined when the PR cited them |
| P2-3 | When mutating code to test a test, assert the mutation applied before concluding | A `sed` no-op once produced a false "blocker regressed" reading |

## Cost control

**Only plan 04-05 spends money.** Every other plan runs free against the existing suite, the
committed code, or a stubbed/seeded path. 04-05 is isolated deliberately so the phase can complete
without a key if one is not available — in which case R14 is reported as **untested**, never as
passing. `frontend/src/lib/apiStub.ts` is the sanctioned zero-cost fixture; a seeded `localStorage`
save reaches the simulation screen with no API call.

## Plan structure

| Plan | Wave | Deliverable | Agent | Cost |
|---|---|---|---|---|
| 04-01 | 1 | R13 — eight-constraint audit with evidence; correct R13's own text | QA Verification Specialist | free |
| 04-02 | 1 | R16 — close with evidence from the existing suite; add only a genuine gap | Test Results Analyzer | free |
| 04-03 | 1 | Retro AI-5 — committed Playwright smoke test | Frontend Developer | free |
| 04-04 | 2 | R15 — `CLAUDE.md` auth note; `design-decisions-log.md` model split + `determineUniqueSkill` correction | Technical Writer | free |
| 04-05 | 3 | R14 — live playthrough, cache proof, CA mount | orchestrator (Opus 5) | **paid** |
| 04-06 | 4 | Legacy deletion decision + the 69 citations + phase-close cross-plan re-verification | orchestrator (Opus 5) | free |

Wave 1's three plans are file-disjoint (`.planning/` audit output, test files, `frontend/` e2e) and
run in parallel.
