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
