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
