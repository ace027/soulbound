# Plan 15-01 Summary: Contract, request caps and World Voice rules

## Result
**Status**: Partial
**Wave**: 1
**Agent**: engineering-backend-architect
**Completed**: 2026-10-16

## Agent Selection Rationale

| Candidate | Semantic | Heuristic | Memory | Total | Source |
|-----------|----------|-----------|--------|-------|--------|
| engineering-backend-architect | — | 11 | 0 | 11 | mandatory |
| engineering-senior-developer | — | 20 | 0 | 20 | heuristic |
| project-manager-senior | — | 13 | 0 | 13 | heuristic |

- **Task type detected**: implementation
- **Confidence**: LOW
- **Adapter**: claude-code
- **Model tier**: sonnet

## Completed Tasks
- [x] Task 1: Contract schemas (done)
- [x] Task 2: Request caps and per-turn block (done)
- [ ] Task 3: Prompt rules, MUST NOT additions, intro scene and token count (partial)

## Files Modified
- `CLAUDE.md`
- `backend/src/__tests__/contract.test.ts`
- `backend/src/__tests__/prompts.test.ts`
- `backend/src/__tests__/routes.test.ts`
- `backend/src/data/worldSystemPrompt.ts`
- `backend/src/routes/introScene.ts`
- `backend/src/routes/worldEngine.ts`
- `frontend/src/game/__tests__/applyWorldUpdate.test.ts`
- `shared/src/worldVoice.ts`

## Verification Results
10/10 verification commands passed (run by Triad after the agent finished).

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `npm run build` | 0 | PASS |
| `npm test -w backend` | 0 | PASS |
| `npm test -w frontend` | 0 | PASS |
| `npm run build -w shared` | 0 | PASS |
| `npm test -w backend -- contract` | 0 | PASS |
| `grep -q "state_updates.condition_changes" shared/src/worldVoice.ts` | 0 | PASS |
| `npm test -w backend -- routes prompts` | 0 | PASS |
| `npm run build -w backend` | 0 | PASS |
| `grep -q "state_updates.setback" CLAUDE.md` | 0 | PASS |
| `grep -c "MUST NOT" backend/src/data/worldSystemPrompt.ts` | 0 | PASS |

## Key Decisions
- The intro prompt's `kingdom` stays `"..."` because the model picks it. The prompts test substitutes a real kingdom before schema-validating the example.
- Token count: `count_tokens` on `claude-sonnet-5-5` gives system-only 13,836 before and 14,770 after the edit. I projected 14,770 plus the 1,821 non-system overhead from the 2026-09-19 derivation, which gives about 16,591. That excludes growth in the JSON schema, so the live figure will be a little higher. CLAUDE.md marks 15,523 superseded as of 2026-10-16.
- A grant line renders as `1 grant` for one and `N grants` otherwise. Passthrough was kept on the new request sub-objects, matching the existing style.

## Issues Encountered
- Six files outside the write list needed fixture or stub edits to get the build and tests green: `anthropic.test.ts`, `api.test.ts`, `appIntegration.test.tsx`, `prologueIntegration.test.tsx`, `apiStub.ts` and the `introScene.prompt.txt` fixture. All are minimal additions of the new keys.
- `backend/src/data/introScene.ts` does not exist, so nothing was done there.
- `.planning/STATE.md` was already modified before I started and I did not touch it.

## Escalations
| # | Severity | Type | Decision | Status | Resolution |
|---|----------|------|----------|--------|------------|
| 1 | info | out-of-scope-files | Approve the minimal edits to `anthropic.test.ts`, `api.test.ts`, `appIntegration.test.tsx`, `prologueIntegration.test.tsx`, `apiStub.ts` and the `introScene.prompt.txt` fixture. | pending | INVALID: type "out-of-scope-files" is not one of architecture, dependency, scope, schema, api, deletion, infrastructure, quality |

- #1 context: The strict schema change made these fixtures and stubs fail to parse. `apiStub.ts` is parsed at import time, so the whole `api.test.ts` suite failed until it was fixed.

## Handoff Context
- **Key outputs**: CLAUDE.md; backend/src/__tests__/contract.test.ts; backend/src/__tests__/prompts.test.ts; backend/src/__tests__/routes.test.ts; backend/src/data/worldSystemPrompt.ts; backend/src/routes/introScene.ts; backend/src/routes/worldEngine.ts; frontend/src/game/__tests__/applyWorldUpdate.test.ts; shared/src/worldVoice.ts
- **Decisions made**: The intro prompt's `kingdom` stays `"..."` because the model picks it. The prompts test substitutes a real kingdom before schema-validating the example.; Token count: `count_tokens` on `claude-sonnet-5-5` gives system-only 13,836 before and 14,770 after the edit. I projected 14,770 plus the 1,821 non-system overhead from the 2026-09-19 derivation, which gives about 16,591. That excludes growth in the JSON schema, so the live figure will be a little higher. CLAUDE.md marks 15,523 superseded as of 2026-10-16.; A grant line renders as `1 grant` for one and `N grants` otherwise. Passthrough was kept on the new request sub-objects, matching the existing style.
- **Open questions**: (none)
- **Conventions established**: Frontend `applyWorldUpdate.ts` does not yet consume `condition_changes`, `stat_growth`, `setback`, `kingdom` or `place_id`. That is for a later plan.; Request field names are `condition{hp,mp,sp,max_*}`, `attributes{STR,AGI,INT,WIL}`, `places`, `currentPlaceId` and `growthLog`. All are optional, so v1 saves still work.; A live `usage` read is still needed to confirm the real cached-prefix size and update CLAUDE.md.

## Requirements Covered
- R37

## Token Usage
34 requests, 2404847 input tokens (2314811 cached), 22212 output tokens, $0.9101
