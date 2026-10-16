# Plan 15-04 Summary: Adversarial re-run, live smoke run and design log

## Result
**Status**: BLOCKED
**Wave**: 4
**Agent**: testing-qa-verification-specialist
**Completed**: 2026-10-16
**Failure Class**: BLOCKER — The shipped World Voice contract (the three new `state_updates` fields plus `kingdom` and `place_id`) exceeds the API's structured-output grammar limit. The plan forbids changes to `shared/src/` and `

## Agent Selection Rationale

| Candidate | Semantic | Heuristic | Memory | Total | Source |
|-----------|----------|-----------|--------|-------|--------|
| testing-qa-verification-specialist | — | 19 | 0 | 19 | mandatory |
| engineering-senior-developer | — | 23 | 2.5 | 25.5 | heuristic |
| engineering-backend-architect | — | 14 | 3.25 | 17.25 | heuristic |

- **Task type detected**: quality-review
- **Confidence**: LOW
- **Adapter**: claude-code
- **Model tier**: sonnet

## Completed Tasks
- [ ] Task 1: Adversarial stat and place cases (partial)
- [ ] Task 2: 20-turn live smoke run (partial)
- [x] Task 3: Design log and planning records (done)

## Files Modified
- `.planning/experiments/2026-10-16-stats-live/RESULTS.md`
- `.planning/experiments/2026-10-16-stats-live/adversarial.mjs`
- `.planning/experiments/2026-10-16-stats-live/run.mjs`
- `docs/design-decisions-log.md`

## Verification Results
5/5 verification commands passed (run by Triad after the agent finished).

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `test -f .planning/experiments/2026-10-16-stats-live/RESULTS.md` | 0 | PASS |
| `grep -q "World map & character stats" docs/design-decisions-log.md` | 0 | PASS |
| `ls .planning/experiments/2026-10-16-stats-live/transcripts/` | 0 | PASS |
| `grep -q "clamp rate" .planning/experiments/2026-10-16-stats-live/RESULTS.md` | 0 | PASS |
| `grep -q "15" .planning/STATE.md` | 0 | PASS |

## Key Decisions
- I did not change `shared/`, `backend/` or the prompt. Which field to drop, fold or split is a contract decision for the developer (CLAUDE.md #4).
- I used jiti to import the frontend TypeScript because tsx is not installed and `--experimental-strip-types` cannot resolve the extensionless imports.
- `adversarial.mjs` and `run.mjs` spawn the built backend rather than re-implementing the route, so model, effort, max_tokens and system blocks are production's.
- I recorded STATE.md as "built, pending review" with the live block spelled out, not a plain "built".

## Issues Encountered
- The offline tests mock the model, so they cannot see the grammar-size failure. The cached-prefix figure (~16,591) is still a projection, not a live read.
- App.tsx builds the initial state with `places: {}` and ignores the intro scene's `kingdom` and `place_id`, so the opening location is not on the map until the first later `scene_set`.
- `applyWorldUpdate` mints a new place when `place_id` is null and the location is worded differently, which can duplicate a place. Case 7 and the smoke run's return step would measure this.
- The skill-scope re-run was a byte-identical copy of the 2026-10-01 `run.mjs`, so its `results.json` landed in the new transcripts folder and the copy was deleted.
- Blocked: The shipped World Voice contract (the three new `state_updates` fields plus `kingdom` and `place_id`) exceeds the API's structured-output grammar limit. The plan forbids changes to `shared/src/` and `backend/src/`, and choosing which field to cut is a contract decision for the developer.
- BLOCKER: The shipped World Voice contract (the three new `state_updates` fields plus `kingdom` and `place_id`) exceeds the API's structured-output grammar limit. The plan forbids changes to `shared/src/` and `

## Escalations
| # | Severity | Type | Decision | Status | Resolution |
|---|----------|------|----------|--------|------------|
| 1 | blocker | api-contract | Cut or restructure the Phase 15 World Voice contract so it fits the API grammar limit (drop or fold `stat_growth` or `condition_changes`, or split the call). The prompt, parser and `applyWorldUpdate` must change in the same change. | pending | INVALID: type "api-contract" is not one of architecture, dependency, scope, schema, api, deletion, infrastructure, quality |
| 2 | info | test-coverage | Add an opt-in live probe that sends `zodOutputFormat(WorldVoiceResponseSchema)` with a 30-token prompt and fails on a 400. | pending | INVALID: type "test-coverage" is not one of architecture, dependency, scope, schema, api, deletion, infrastructure, quality |
| 3 | blocker | api | Resolve: The shipped World Voice contract (the three new `state_updates` fields plus `kingdom` and `place_id`) exceeds the API's structured-output grammar limit. The plan forbids changes to `shared/src/` and ` | approved | Developer chose (2026-10-16) non-null condition_changes and setback with sentinels (0/'' and kind 'none'). Fixed in 99ad066; grammar-probe.mjs passes live. Re-run 15-04's live checks. |

- #1 context: Every `/api/world-engine` and `/api/intro-scene` call fails in production with `400 compiled grammar is too large`, surfaced as 502. This breaks the live game, not only the tests. Evidence is in `.planning/experiments/2026-10-16-stats-live/transcripts/grammar-bisect-output.txt` and `RESULTS.md`.
- #2 context: It costs about nothing and would have caught this at plan 15-01. It is outside this plan's files.
- #3 context: The agent returned blocked; a BLOCKER is not auto-fixed.

## Handoff Context
- **Key outputs**: .planning/experiments/2026-10-16-stats-live/RESULTS.md; .planning/experiments/2026-10-16-stats-live/adversarial.mjs; .planning/experiments/2026-10-16-stats-live/run.mjs; docs/design-decisions-log.md
- **Decisions made**: I did not change `shared/`, `backend/` or the prompt. Which field to drop, fold or split is a contract decision for the developer (CLAUDE.md #4).; I used jiti to import the frontend TypeScript because tsx is not installed and `--experimental-strip-types` cannot resolve the extensionless imports.; `adversarial.mjs` and `run.mjs` spawn the built backend rather than re-implementing the route, so model, effort, max_tokens and system blocks are production's.; I recorded STATE.md as "built, pending review" with the live block spelled out, not a plain "built".
- **Open questions**: (none)
- **Conventions established**: After the developer fixes the contract and rebuilds, run `ANTHROPIC_API_KEY="$SOULBOUND_ANTHROPIC_KEY" node .planning/experiments/2026-10-16-stats-live/adversarial.mjs` (about $0.20).; Then run the same with `run.mjs` (cap $3, expect well under $1). It writes `transcripts/smoke-run.json` with the criteria and clamp rate. Update `RESULTS.md`, the design-log "Live results" paragraph and the ROADMAP status from those.; Re-derive the cached-prefix count with `count_tokens` after the fix, and consider a live schema probe as a regression check (`transcripts/grammar-bisect.mjs` is the template).; Triad needs to write 15-04-SUMMARY.md.

## Requirements Covered
- R37

## Token Usage
35 requests, 2827533 input tokens (2709648 cached), 37113 output tokens, $1.2077
