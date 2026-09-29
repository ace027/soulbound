# Retrospective Log

Retrospective findings from completed phases and milestones.
Referenced by `/legion:plan` for continuous improvement.

---

## Phase 1: Foundation & Contract — 2026-09-17

### Key Findings

**Worked**
- Orchestrator independently re-running each agent's verify commands caught two real defects under a "Complete" status: unmatched routes returning HTML instead of JSON, and `docker build` failing outright (a phase exit criterion).
- Comparing **rendered runtime strings** rather than source text for the verbatim extraction. The legacy `.jsx` is CRLF and the extracted `.ts` are LF; a source diff would have shown a false ~150-byte mismatch. JS normalizes CRLF→LF in template literals, so runtime strings always matched.
- Accepting a guard only after **observing it fail**. The drift guard was tested by introducing a rename; `npm run build` still exited 0, proving `tsc` could not catch it.
- Hard-exclusion lists for byte-identical files. The polish run was given four files it must not open; all four verified unmodified after.
- Agents disclosing their own limits — one reviewer flagged it had no shell so its analysis was reasoned not executed; another refused to claim a `docker build` pass and proved the logic with a throwaway copy. Both more useful than a clean claim.

**Didn't work**
- **3 of 11 review defects were introduced by fixes**, not present beforehand: a duplicate `tsconfig` `"module"` key exposed by applying `node16`, an `EACCES` from adding `USER node` to a root-owned tree, and a root-owned BuildKit secret that became unreadable once the build stage dropped privileges. None were caught by review; all surfaced by running the fix.
- **Cross-plan verification went stale twice in one phase.** Plan 04 verified non-root against the `runtime` Docker stage; Plan 06 pointed compose at `builder`; nobody re-checked, so the frontend shipped as root through review cycle 1. Same shape for `frontend/.dockerignore`, written for a build context that doesn't exist.
- The orchestrator **overstated the drift guard** to the developer, describing it as the only thing between a renamed field and a broken parser when it compared one file against itself. Review found the blind spot that had been claimed as covered.
- **`sed`-patching prose produced a garbled comment that survived three reviewers and two review cycles.** It compiled, so no review rubric was looking at it. Only the polish pass caught it.
- Plan prose was wrong twice (six keyframes enumerated when there are seven; three plans estimated when six were needed). Both caught only because verify steps diffed rather than trusting the enumeration.

### Patterns to Keep
- Orchestrator re-runs every agent's verify commands independently. "Agent reported Complete" is not a verification input — 2 of 6 plans had real defects under that status.
- Verify by diff or measurement, never by enumeration.
- Demonstrate a guard failing before trusting it.
- Hard-exclusion lists for files with byte-identical requirements.
- Model tiering by task nature: Haiku for mechanical copy, Sonnet for scoped implementation, Opus for the contract and the risky logic. No rework was attributable to under-powering a model.
- Point reviewers at a specific suspected weakness rather than requesting a general read. "Find the rename this guard would miss" produced the phase's most valuable finding.

### Patterns to Drop
- `sed` for editing comments or prose in source files — use `Edit`.
- Verifying a property against one artifact when a later plan may swap which artifact is used.
- Treating an agent's self-reported Complete status as evidence.

### Action Items
| # | Action | Priority | Evidence |
|---|--------|----------|----------|
| 1 | **Pull R16 (tests) forward from Phase 4 to Phase 2** | High | 3 of 11 defects were fix-induced with no regression net; Phase 2 adds paid API calls |
| 2 | Run plan critique before Phase 3 | High | `App.tsx` game-logic port is the phase's real regression risk |
| 3 | Add a cross-plan re-verification step at phase close — re-check earlier-verified properties against what later plans changed | High | Non-root and `.dockerignore` both went stale within one phase |
| 4 | Use `Edit` for comment/prose changes, never `sed` | Medium | Garbled comment in `shared/src/worldVoice.ts` outlived 2 review cycles |
| 5 | Phase 2 must add the `/api` proxy or explicitly accept the `runtime` image as non-deployable | Medium | Dormant trap; goes live with the first `fetch('/api/...')` |
| 6 | Add a test asserting the contract guard *fails* correctly, not only that it passes | Medium | The guard runs at startup but has no regression protection of its own |

### Metrics
- Plans completed: 6/6
- Commits: 12 (6 feat, 2 fix, 3 chore, 1 refactor)
- Files modified: 34 · Source LOC shipped: ~960 (excl. verbatim data and legacy artifact)
- Review: passed on cycle 2 of 3 — 0 blockers, 8 warnings, 3 suggestions, all resolved
- First-pass review rate: 0/1 (cycle 1 returned NEEDS WORK from Infrastructure)
- Agents: 6 spawns across 4 personalities plus orchestrator
- Escalations: 0

### Agent recommendation adjustments for future planning
- Prefer **Haiku 4.5** for verbatim/mechanical extraction with a diff-based verify step — performed correctly at a fraction of the cost.
- Prefer **orchestrator (Opus 5)** for contract definition and any work where a silent regression is costlier than the token spend.
- When a phase spans code + secrets + infrastructure, use a **dynamic review panel** with non-overlapping rubrics rather than the classic pairing. The security and infrastructure lenses each found defects the QA lens did not.

---

## Phase 2: Backend & World Voice — 2026-09-17

### Continuity check — Phase 1's action items
5 of 6 honored. **AI-1** (pull tests forward from Phase 4) was decisive: without a suite, the
mutation sweeps that found both blockers would have had nothing to run against. **AI-3**
(cross-plan re-verification at phase close) was written into 02-05 as an explicit task and is
what surfaced the container gaps. **AI-5** closed by explicit acceptance in `docker-compose.yml`;
**AI-6** closed with 3 throw-assertions in `contract.test.ts`. **AI-2** (plan critique before
Phase 3) is still outstanding — carried forward again. **AI-4** was violated, in a new flavor.

### Key Findings

**Worked**
- **The dynamic panel paid off a second time.** Three non-overlapping rubrics found three
  different defect classes: QA found the `server.ts` blocker by mutation testing, security found
  DNS rebinding, the API lens found `CLAUDE.md` claiming one model where the code splits three.
  No single reviewer would have found all three.
- **Probing the fixes found more than reviewing the original code.** Two of the four most serious
  issues — the delimiter bypass and the Compose 403 — were in code that had just been reported
  complete. Cycle 3 justified its own existence.
- **Free verification before paid.** `count_tokens` settled a figure a reviewer called
  unverifiable, at zero cost, and revealed that the output schema sits *inside* the cached prefix
  (1,827 of 15,132 tokens) — now the measured reason both Opus routes must send identical
  `output_config`, not merely identical system blocks.
- **Designing a plan to report BLOCKED rather than fake a pass.** 02-05 explicitly forbade
  stubbing or reasoning that mocked tests were equivalent. Structural honesty, not incidental.
- Making the adversarial sample *replace* a bland one cost nothing and proved Opus 5 holds the
  MUST NOT list under a direct Ultimate-Skill / Soul-Rewrite / Plundering / Sovereign attack.

**Didn't work**
- **Fix-induced defects, second phase running, and escalating in severity.** Phase 1: 3 of 11
  defects were introduced by fixes. Phase 2: **both blockers were introduced by cycle 2's own
  fixes** — the Host allow-list 403'd every API call under Compose, and the prompt-injection
  guard's single-pass regex was bypassable. This is now the dominant defect source in this
  project, and it moved from warning-class to blocker-class.
- **A green healthcheck masked a total outage.** The Compose 403 persisted while the container
  reported healthy, because the healthcheck curls localhost from inside the container and never
  touches the proxied path users take.
- **`sed` silently failed and produced a false negative.** A router-unregistration mutation did
  not apply, the suite stayed green, and the blocker was nearly reported as regressed. Same root
  cause as Phase 1's AI-4 in a new flavor: **`sed` fails without a signal.**
- **A subagent false alarm nearly became a fix** — "config.ts leaks the key to `process.report`"
  was the probe's own environment (the host exports the same value under a second name). Caught
  only by re-running with a canary.
- **Test debt was paid late.** +631 source lines vs **+1,262 test lines**, nearly all of the test
  code arriving during review rather than build. The build shipped a suite that could not detect
  its own routes being unregistered.
- **Self-inflicted Docker damage cost the final verification.** `pkill -9` corrupted containerd's
  snapshot store; the repair prune deleted the cached base image; Docker Hub then rate-limited the
  re-pull. The shipped container check is one commit stale as a direct result.

### Patterns to Keep
- Cross-plan re-verification at phase close — validated twice now.
- Dynamic panel with non-overlapping rubrics for anything spanning code + secrets + infrastructure.
- **Mutation testing as the acceptance criterion for "is this test real?"** A test that does not
  fail against the code it protects is decoration.
- Orchestrator independently reproducing every blocker before acting on it.
- Free/unbilled verification paths before spending.
- Writing the staleness of your own evidence into the artifact rather than omitting it.

### Patterns to Drop
- `sed`/regex for applying code mutations *or* prose edits — no failure signal.
- Treating a healthcheck as a reachability signal.
- `pkill -9` on dockerd/containerd; pruning an image store without a guaranteed re-pull path.
- Accepting a subagent finding without reproducing it.

### Action Items
| # | Action | Priority | Evidence |
|---|--------|----------|----------|
| 1 | **Budget a review cycle explicitly for probing fixes**, not just original code | High | Two phases running; in Phase 2 both blockers were fix-induced |
| 2 | Any middleware gating reachability needs a test asserting the **user's path**, not an internal probe | High | Compose 403 while the container reported healthy |
| 3 | When mutating code to test a test, **assert the mutation applied** before concluding | High | `sed` no-op produced a false "blocker regressed" reading |
| 4 | Write tests alongside build in Phase 3, not deferred to review | High | 2:1 test:source ratio, nearly all from review cycles |
| 5 | Run plan critique before Phase 3 *(carried from Phase 1 AI-2)* | High | `App.tsx` game-logic port is the real regression risk |
| 6 | Reproduce a subagent finding before it drives a fix | Medium | `process.report` false alarm |
| 7 | Graceful `TERM` for docker daemons; never prune without a re-pull path | Medium | Lost the final containerized verification |

### Metrics
- Plans completed: 5/5 · Commits: 8 · Files: 35 (+2,462 / −243)
- Source LOC: +631 · Test LOC: +1,262 (**2:1**)
- Tests: 38 → 108 (+184%), 3 files → 7
- Review: passed on cycle 3 of 3 — 2 blockers, 10 warnings, 9 suggestions, all resolved
- First-pass review rate: 0/1 (cycle 1 returned NEEDS WORK from 2 of 3 reviewers)
- Agents: 7 spawns across 5 personalities plus orchestrator · Escalations: 0
- Spend: ~$0.26 live verification; $0 for the `count_tokens` confirmations

### Agent recommendation adjustments for future planning
- The **dynamic panel** recommendation from Phase 1 is confirmed, not merely repeated — each lens
  found defects the others missed, in a phase where a classic pairing would have had no security
  reviewer at all despite the phase introducing key handling and a paid unauthenticated route.
- **Give reviewers the fixes as their target**, not only the original code. The highest-value
  cycle-3 prompts named the new module and said "if this is bypassable the defense is theater."
- Phase 3 is UI: prefer a panel including a **UX/accessibility lens**, and note that Phase 3's
  risk is silent behavioral drift in ported logic, which mutation testing suits well and visual
  review does not.

---

## Phase 3: Frontend Port — 2026-09-18

**Scope**: 10 plans, 6 waves. Shipped as [PR #2](https://github.com/DeanItServices/soulbound/pull/2).

### Carried action items — status

Every applicable item from the Phase 1 and Phase 2 retros was honored, and the two
highest-value ones paid off measurably:

| Prior item | Status | Evidence |
|---|---|---|
| P1-2 / P2-5 — run plan critique before Phase 3 | **Honored** | Caught 5 execution-blocking defects *before* any code was written. Highest-leverage single act of the phase. |
| P1-3 — cross-plan re-verification at phase close | **Honored** | Became plan 03-10. Found two of its own gates mis-scoped. |
| P2-1 — budget a review cycle for probing fixes | **Partially** | Cycle 2 did exactly this and found a real gap — but only after I first skipped it (see failure 1). |
| P2-3 — assert the mutation applied before concluding | **Honored** | Every mutation this phase used `assert count == 1` before writing. No false readings. |
| P2-4 — write tests alongside build, not deferred to review | **Honored** | 119 tests existed before review opened; review added 10. Phase 2's ratio was inverted. |
| P2-6 — reproduce a subagent finding before it drives a fix | **Honored** | Reproduced the `deleteSave` gap, the `flex: 1` mutant, and the "flake" myself. The last one overturned all three reviewers. |
| P2-2, P2-7 | N/A | No middleware and no Docker work this phase. |

### What went well

- **Plan critique is worth more than a review cycle.** Deferred through two retros, it finally
  ran and caught four factual errors plus a fix-induced defect — including a `useState` count
  that would have made a *correct* port fail its own verify gate.
- **"Derive every count and range" caught what critique didn't.** Four more wrong port ranges
  surfaced during execution (plans 04, 06, 07, 08). Plan 08's would have moved `App()`'s
  `return null` into a screen component.
- **Agents flagged plan defects instead of working around them.** Plan 06 found its task asking
  for a test of markup that lives in a different component; plan 08 found its task depending on
  a function that would not exist for another wave. Both reported rather than improvised.
- **Wave 1's five-way parallel dispatch held.** File-disjointness was verified before dispatch
  and no conflict occurred.
- **Zero-cost verification worked.** `apiStub.ts` plus a seeded `localStorage` save reached every
  screen with no paid call. The whole phase cost nothing in API spend.

### What didn't work — four process failures, three of them mine

1. **I skipped the review loop's re-review step.** After cycle 1 I applied 8 fixes across 6 files
   including production code, then declared PASS having only re-run the four mutants I wrote those
   fixes against. Cycle 2 — which only happened because the user re-ran `/legion:review` — found
   the uncovered `deleteSave` try/catch that would otherwise have shipped.
2. **Parallel reviewers contaminated each other.** Three reviewers, one working tree, one mutating
   by design. All three independently reported a "flaky test" and attributed it to Vitest pool
   flakiness. None was flaky: `|| 5` → `?? 5` produced `expected +0 to be 5`, and
   `response.ok` → `if (false)` produced a 9-test API failure. Clean tree is 8/8 green.
3. **I wrote to the tree while a reviewer held it.** A stop hook prompted a commit mid-sweep.
   Near-miss: the single path was inspected first, but `git add -A` would have committed a
   deliberate regression and pushed it.
4. **I restated a count instead of deriving it** — "29 killed mutants" in a review brief that
   asked reviewers to watch for exactly that failure. The real figure from commit text is 32.
   I also amplified a plan's wrong claim that jsdom cannot detect a removed `flex: 1`; it can,
   and a reviewer corrected me.

Also: **I never opened my own screenshots** until asked. Plan 09 captured three PNGs and asserted
on DOM text only. They were correct when finally viewed, but the claim preceded the looking.

### Patterns to keep

- Plan critique before build, unconditionally.
- Derive counts and ranges; publish the derivation command, not the number.
- Mutation testing as the acceptance criterion for a test's existence.
- A dedicated integration test for wiring that pure-function tests structurally cannot reach.
- Reviewers with non-overlapping rubrics, explicitly told what is out of scope — the polish pass
  correctly changed nothing because it was told which comments were the audit trail.

### Patterns to drop

- Parallel reviewers on one tree when any of them mutates source.
- Declaring PASS on your own fixes without re-entering review.
- Counts written in prose without their derivation.
- Trusting a delegated agent's "I viewed the screenshot" when that claim is load-bearing.

### Action Items

| # | Action | Priority | Evidence |
|---|---|---|---|
| 1 | A mutating reviewer gets an isolated worktree, or runs serially after the read-only ones | High | Three reviewers misdiagnosed each other's mutations as a flake |
| 2 | While a reviewer holds the tree, do not write to it — including hook-prompted commits | High | Near-miss: `git add -A` would have committed a live mutation |
| 3 | After any fix cycle, re-enter review. A fix verified only against the mutant it was written for is unverified | High | The `deleteSave` gap survived cycle 1 and would have shipped |
| 4 | Any count in prose carries the command that derives it (`grep -c 'MUTANT' <file>`) | High | 29 vs 32; "eleven" vs 14 annotation lines; three plans' ranges |
| 5 | Commit a Playwright smoke test so visual evidence is repeatable | Medium | Screenshots live in scratchpad and die with the container; jsdom does no layout |
| 6 | Produce `SUMMARY.md` files, or amend the ship gate to read commit messages | Medium | Ship gate 3a cannot hold as written — zero SUMMARY files across three phases |
| 7 | When an agent reports viewing visual evidence, view it too before repeating the claim | Medium | Plan 09's screenshots were unexamined when the PR body cited them |

### Metrics

- Plans completed: **10/10**, 6 waves
- Review: **2 cycles** — 11 findings in cycle 1 (2 BLOCKER, 5 WARNING, 4 SUGGESTION), 1 new in cycle 2
- Escalations: **0**
- Tests: **237** (129 frontend from zero, 108 backend); 14 named mutants in the game-logic suite
- Diff vs `main`: 46 files, +7,665/−27
- Agents: Frontend Developer (x5), UX Architect, orchestrator (x3); review panel of 3 + 1 re-review + 1 polish
- API spend: **$0** — every verification used a stub or a seeded save

---

## Phase 4: Parity & Verification — 2026-09-18

**PASSED after 3 cycles.** 29 findings, **0 blockers**. 6/6 plans. Shipped as PR #3.
The project's final phase — all 27 plans across 4 phases complete.

### Prior action items: 7 of 7 closed — a first

| Prior AI | Status | Evidence |
|---|---|---|
| AI-1 mutating reviewer isolated or serial | **CLOSED, and it worked** | Zero contamination across 3 cycles / 4 agent runs, vs Phase 3's three-way misdiagnosis |
| AI-2 don't write while a reviewer holds the tree | **CLOSED** | Edits queued until reviewers released; only pushes (tree-read-only) during runs |
| AI-3 re-enter review after any fix cycle | **CLOSED, and it paid twice** | Cycles 2 and 3 each found real defects in the prior cycle's fixes |
| AI-4 counts carry their derivation | **PARTIAL — see below** | Held for findings, failed for fixes |
| AI-5 commit a Playwright smoke test | **CLOSED** | `frontend/e2e/smoke.spec.ts`, 5 tests, real geometry |
| AI-6 produce SUMMARY.md files | **CLOSED** | All 6 plans; ship gate 3a held literally for the first time in 4 phases |
| AI-7 view visual evidence yourself | **CLOSED, and it paid** | Committed screenshots then caught a wrong number in their own summary |

AI-5 and AI-6 had each been carried forward unaddressed through a prior phase.

### Key Findings

**What went well**
- Serial execution for tree-mutating agents is proven in both directions now: it fails loudly in
  parallel (Phase 3), works silently in serial (Phase 4). Keep it; do not re-try parallel.
- Independent re-derivation validated the substance. A reviewer reproduced the `WORLD_LORE`
  byte-identity, the whole-prompt diff **at a wider slice than the audit used**, and the 9-name
  contract diff; another re-ran four mutations and **matched the reported SHAs to the digit**.
- Free derivation before paid verification: `count_tokens` predicted a 15,491-token prefix, the
  live run measured 15,490. Zero cost, before spending anything.
- An agent refused a wrong instruction in its own brief. The 04-04 briefing claimed BYOK "remains
  the documented alternative"; `MIGRATION-PLAN.md:14` marks it *Superseded*. The agent wrote from
  evidence, keeping a false claim out of the file every future session reads as instructions.
- Mutation-first verification beat a green suite: 242 passing tests said constraints 1 and 2 were
  guarded; one mutation said otherwise.

**What didn't work — the central finding**
**Every fix commit seeded a new, smaller instance of the defect class it was closing.** Three
cycles, three times: cycle 1 fixed pointer drift and created pointer drift the other way; cycle 2
corrected wrong numbers and reused a stale one as the new baseline; cycle 3 closed a guard gap with
a rationale that measured false. Cycle 3's reviewer named the cause: *"the fixes were not
re-checked against the same evidence standard applied to the original findings."* Findings were
derived; fixes were reasoned about.

Also:
- Three cycles — the configured maximum — and cycle 3 still returned NEEDS WORK. The loop never
  converged on its own.
- Two factual errors in orchestrator briefings to agents (the BYOK claim; a `backend/src/lib/`
  path that does not exist), both caught by the agents. Plan prose passed along as fact — the exact
  failure AI-4 exists to prevent, committed while briefing agents about AI-4.
- A durability mechanism was documented before being tested: the `parity-oracle` tag was created,
  written into three files as the recovery path for 69 citations, and only then found unpushable
  in this environment. For a window the docs instructed readers to run a command that fails in any
  fresh clone.

### Action Items

| # | Action | Priority | Evidence |
|---|---|---|---|
| 1 | **A fix is a claim.** Before committing a fix, run the derivation that produced the finding — re-run the mutation, re-derive the count | High | 3 of 3 cycles seeded a new defect |
| 2 | Re-read your own diff against the **evidence you just committed**, not against your reasoning | High | Mastery numbers contradicted screenshots in the same commit |
| 3 | Derive every fact in an agent brief before sending it; cite file:line, never plan prose | High | BYOK claim and `lib/` path, both wrong, both caught by the agent |
| 4 | Test durability mechanisms in the target environment **before** documenting them | High | The `parity-oracle` tag |
| 5 | Keep serial execution for any tree-mutating agent; do not re-try parallel | High | 0 contamination vs 3 misdiagnoses in Phase 3 |
| 6 | Commit raw evidence for paid/unrepeatable runs as a standing rule | Medium | Caught a real error on first use |
| 7 | Audit which constraints have **no committed guard** at phase start, not at review | Medium | Constraints 1, 2 and 6 were all unguarded and all found late |

### Environment limits learned
- `git push origin <tag>` fails here (`remote end hung up`) while branch pushes succeed — a tag-ref
  permission. **Any durability scheme must survive without tags.**
- A merged PR cannot track new work. PR #2 merged mid-session while STATE.md still called it open;
  Phase 4 needed PR #3. Check PR state before assuming, and **never rebase this branch** — nine
  documents reference `3d01fa5` by name as the recovery handle for 69 legacy citations.

### Metrics
- Plans: 6/6 · Review: PASSED, 3 cycles, 29 findings, 0 blockers · Escalations: 0
- First-pass review rate, project-wide: **0/4** (2, 3, 2, 3 cycles) — no phase has ever passed cycle 1
- Agents: QA Verification, Test Results Analyzer, Frontend Developer, Technical Writer, orchestrator ×2
- Ship: 15 commits, 48 files, +4,757/−1,474 · PR #3
- Tests: 237 → 254, plus 5 e2e · Cost: ~$0.31 actual vs ~$0.25 budgeted (one harness bug, attributed)

---

## Phase 6: Hosted Mode & Accounts — 2026-09-25

### Key Findings
**Prior action items (Phase 4 AI-1..7): 5 of 7 held.** AI-3/4/5/6/7 held. AI-1 mostly held
(red→green per fix; cycle 2 still found 3 untested edges in cycle-1 guards; cycle 3 caught 11/11).
AI-2 was broken by the orchestrator's own record edits: a runbook sentence split, a stale 244 count,
and a stale ROADMAP pointer, all caught by reviewers.

**What went well**
- Two critique rounds caught design defects before code: spec 6 blockers, plans 3 blockers. They
  included the nonce-only reconciliation that could mark the wrong invite (both critics found it
  independently), mutation restores that would wipe uncommitted work, and case-insensitive routes
  bypassing the Origin check. None needed a code rework.
- Verifying the installed library source as each plan's first task caught 4 wrong spec claims:
  Sentry 11 has no `sendDefaultPii`; Better Auth #3295 no longer hangs; a magic-link sign-up writes
  no `account` row; Better Auth disables its origin checks under `NODE_ENV=test`.
- 7 serial waves with zero contamination. The orchestrator independently re-verified every wave, and
  the counts matched 7/7.
- Review had 0 blockers in any cycle, and cycle 3 was all PASS. CI gained the e2e job and a hosted
  image smoke test. $0 Anthropic spend.

**What didn't work**
- A fix handed from one plan to another was reasoned about, never tested across both. 06-04 found the
  server-side session gate drops the renewed cookie; 06-06 added a browser refresh. Nothing tested the
  two together, and the gate consumed the daily refresh first, so the "30-day rolling" session never
  rolled. Security caught it in review cycle 1 (S1).
- Visual defects were seen and normalised. The Account button covering story text was recorded
  honestly in screenshots, then accepted. The 8px white page frame, present since Phase 3, was
  noticed by two agents and dismissed as "how the existing game looks". The developer found both.
- Review cycle 1 still found 4 security warnings the critiques missed (session refresh, Google
  trusted-provider linking skipping email verification, per-cookie invite caps, verification-row
  retention). Each came from an assumed library default.
- `mutate-order.sh` counted a database outage as a caught mutation until cycle 2.
- The project-wide first-pass review rate is 0/6.

**Patterns to keep:** critique both spec and plans, with binding `<critique_revisions>` blocks · a
library-source check as the first task · a guard-audit table at phase start · serial tree-mutating
agents with independent per-wave verification · red→green evidence per fix · a panel review with
read-only reviewers in parallel and the mutating QA reviewer alone · asking the developer about
spec-pinned choices (the Google trust decision).

**Patterns to drop:** accepting "that's how it already looks" for visuals · treating a cross-plan
handoff as fixed without a spanning test · orchestrator record edits during review without
re-reading the rendered diff.

### Action Items

| # | Action | Priority | Evidence |
|---|---|---|---|
| 1 | **A fix handed between plans gets a test that spans both plans**, owned by the plan that completes it | High | S1: the session never rolled despite 06-04 plus 06-06 |
| 2 | **Report visual defects to the developer, including pre-existing ones.** Build agents may not normalise them | High | Account button over narration; white 8px frame since Phase 3 |
| 3 | **Library claims in a spec stay "unverified" until checked in installed source.** Spec critique explicitly checks library defaults (trusted providers, session refresh, test-mode switches) | High | 4 wrong library claims; 4 security warnings from assumed defaults |
| 4 | The orchestrator re-reads the rendered diff of its own record edits before committing (AI-2 applied to itself) | Medium | Split runbook sentence; stale 244; stale ROADMAP pointer |
| 5 | Every mutation harness has an unmutated baseline and failure attribution from day one | Medium | `mutate-order.sh` false PASS on a DB outage until cycle 2 |
| 6 | New UI elements ship with a placement e2e (no overlap, no page frame) | Medium | `pageFrame.spec.ts` and the overlap checks came after the fact |
| 7 | Phase 7 closes login CSRF into an existing account before server saves go live | High | Security review cycle 2, finding 3; ROADMAP Phase 7 criterion |

### Metrics
- Plans: 7/7 (7 serial waves) · Review: PASSED, 3 cycles, 0 blockers, 14 warnings fixed, ~19 suggestions applied or recorded · Escalations: 0
- First-pass review rate, project-wide: **0/6** (2, 3, 2, 3, 3, 3 cycles)
- Pre-build critique: spec 6 blockers, plans 3 blockers, all applied before code
- Agents: Senior Developer, Infrastructure & DevOps, Backend Architect, Frontend Developer, Security Engineer, QA Verification
- Tests: backend 187 → 304 · frontend 190 → 249 · hosted 0 → 182 (0 skipped) · e2e 6 → 16
- Ship: PR #7 merged `89219af`; 61 commits, 109 files, +18,305/−104 · Anthropic spend: $0

---
