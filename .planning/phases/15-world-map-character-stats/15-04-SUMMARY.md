# Plan 15-04 Summary: Adversarial re-run, live smoke run and design log

## Result
**Status**: Complete
**Wave**: 4
**Agent**: testing-qa-verification-specialist
**Completed**: 2026-10-16

## Agent Selection Rationale

| Candidate | Semantic | Heuristic | Memory | Total | Source |
|-----------|----------|-----------|--------|-------|--------|
| testing-qa-verification-specialist | — | 19 | 2.5 | 21.5 | mandatory |
| engineering-senior-developer | — | 23 | 3 | 26 | heuristic |
| engineering-backend-architect | — | 14 | 3.25 | 17.25 | heuristic |

- **Task type detected**: quality-review
- **Confidence**: LOW
- **Adapter**: claude-code
- **Model tier**: sonnet

## Completed Tasks
- [x] Task 1: Adversarial stat and place cases (done)
- [x] Task 2: 20-turn live smoke run (done)
- [x] Task 3: Design log and planning records (done)

## Files Modified
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
- Case 6 is reported as a harness FAIL with a substance-PASS note rather than editing the criterion or the script.
- I did not re-run the skill-scope suite after the fix because it doesn't touch the schema.

## Issues Encountered
- The live cache read was 17,538 tokens, against the ~16,665 projection quoted in CLAUDE.md. CLAUDE.md is forbidden to me, so the developer needs to update the quote.
- Every place in the smoke run was in Kaldrath, so multi-kingdom map coverage is not proven live.
- The intro scene's `place_id` is null and `App.tsx` ignores it, so the opening location is not pinned on the map.
- Sample sizes are small (n = 2 per adversarial case, one 20-turn run). Whether stat growth ever fires correctly rests on the offline 200-turn test.

## Escalations
| # | Severity | Type | Decision | Status | Resolution |
|---|----------|------|----------|--------|------------|
| 1 | info | quality | Update the CLAUDE.md cached-prefix quote from ~16,665 (the `count_tokens` projection) to the live read of 17,538. CLAUDE.md is forbidden to me. | pending |  |
| 2 | info | quality | Decide whether to pin the opening location from the intro scene_set on the frontend, and whether to add a CI-gated schema-size probe as a backend test. | pending |  |

- #1 context: The final worldEngine calls in `transcripts/smoke-run.json` report cache_read_input_tokens 17,538.
- #2 context: Both are outside this plan's files. `grammar-probe.mjs` is the manual, live version of the probe.

## Handoff Context
- **Key outputs**: docs/design-decisions-log.md
- **Decisions made**: Case 6 is reported as a harness FAIL with a substance-PASS note rather than editing the criterion or the script.; I did not re-run the skill-scope suite after the fix because it doesn't touch the schema.
- **Open questions**: (none)
- **Conventions established**: Triad needs to write 15-04-SUMMARY.md and clear the earlier BLOCKED state. Escalation #3 is resolved by the live re-run.; To re-run: `ANTHROPIC_API_KEY="$SOULBOUND_ANTHROPIC_KEY" node` on `adversarial.mjs` and `run.mjs`. Run `grammar-probe.mjs` before any future contract addition.

## Requirements Covered
- R37

## Token Usage
20 requests, 850467 input tokens (798620 cached), 10478 output tokens, $0.3941
