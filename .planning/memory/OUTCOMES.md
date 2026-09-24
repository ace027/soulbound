# Outcomes

## Phase 1 — Shipped 2026-09-17
task_type: ship
agent: ship-pipeline
result: success
pr: N/A (marked shipped; branch already pushed to origin/claude/admiring-wright-hfmugk)
verification: 5/5 passed (3 workspace builds, startup contract guard, verbatim data integrity)
tests: NOT AVAILABLE — zero test files; R16 scoped to Phase 4. Live docker compose run and the
  startup contract guard stood in. Recorded as not-applicable rather than passing, since a
  vacuous pass would misrepresent the safety net this phase actually shipped with.
known_gaps_shipped:
  - runtime frontend image has no /api route to the backend (serve -s answers 200 + index.html);
    dormant while the frontend makes no API calls, must be closed before that image deploys
  - no auth or rate limiting on the backend; 127.0.0.1 port binding is the mitigation
review: passed after 2 cycles, 0 blockers, 8 warnings + 3 suggestions resolved
notable: 3 defects were found while verifying fixes rather than by any reviewer — a duplicate
  tsconfig "module" key, an EACCES from dropping privileges on a root-owned tree, and a
  root-owned BuildKit secret that became unreadable once the build stage dropped privileges.

## Phase 2 — Shipped 2026-09-17
task_type: ship
agent: ship-pipeline
result: success
pr: https://github.com/DeanItServices/soulbound/pull/1
verification: 6/6 gates passed; 108/108 tests; containerized re-check 1 commit stale (Docker Hub 429)
note: Review found 2 blockers, both in code already reported as done — server.ts untested, and a
  security fix that 403'd every API call under Compose while the container reported healthy.
  Lesson: a passing healthcheck does not mean the app is reachable the way users reach it.

## Phase 4 — Shipped 2026-09-18
task_type: ship
agent: ship-pipeline
result: success
pr: https://github.com/DeanItServices/soulbound/pull/3
verification: 6/6 gates passed; 115 backend + 139 frontend + 5 e2e; 3 typechecks; build clean
note: First phase where gate 3a (build completeness) held as specified — all 6 plans wrote
  SUMMARY.md files, closing retro AI-6. Review took 3 cycles, 29 findings, 0 blockers; every
  fix commit seeded a smaller instance of the defect it closed, which produced the rule
  "a fix is a claim, and carries the same derivation burden as a finding".

## Phase 4 — Retrospective 2026-09-18
task_type: retrospective
agent: orchestrator
result: success
note: 7 of 7 prior action items closed (first time; AI-5 and AI-6 had each been carried).
  Central new finding: every fix commit seeded a smaller instance of the defect it closed,
  because findings were derived while fixes were reasoned about. Rule adopted — a fix is a
  claim, and carries the same derivation burden as a finding.


## Phase 5 — Review passed 2026-09-23
task_type: quality-review
agent: engineering-security-engineer, testing-qa-verification-specialist, engineering-infrastructure-devops
result: success
importance: 3
cycles: 3
summary: Phase 5 review passed in 3 cycles. 1 blocker (self-host healthcheck 403 on non-default
  ports — missed because port evidence curled from the host and never read .State.Health) and 7
  warnings fixed. Lesson: a passing healthcheck is not reachability, and a curl from outside is not
  a healthcheck — check both. Every fix round again seeded a smaller same-class defect (the
  byte-identical claim, the re-dispatch remedy), each caught by the next cycle.
tags: docker-image-publishing, review-passed, 3-cycles

## Phase 5 — Shipped 2026-09-24
task_type: ship
agent: ship-pipeline
result: success
pr: https://github.com/DeanItServices/soulbound/pull/6
verification: 6/6 gates passed (build, tests 187+190, e2e 6/6, App.tsx identical, compose configs, clean tree); CI green on 33d5aca
summary: First ship attempt was aborted by the developer pending review of post-review work; re-run
  after the map refresh. The PR body names the post-review prompt changes and polish explicitly,
  with the evidence that covers them instead of the review panel.
tags: docker-image-publishing, shipped, pr-6
