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
