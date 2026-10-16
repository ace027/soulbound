---
phase: 15-world-map-character-stats
compacted: 2026-10-16
original_summaries: [15-01-SUMMARY.md, 15-02-SUMMARY.md, 15-03-SUMMARY.md, 15-04-SUMMARY.md]
requirements_satisfied: [R37]
---

# Phase 15: World Map & Character Stats — Compacted Summary

## Deliverables
- 15-01 Contract, request caps and World Voice rules (Complete)
- 15-02 Game state, save v2 migration and guard rails (Complete): frontend/src/components/__tests__/codexAccount.test.tsx
- 15-03 Condition strip, kingdom map and mobile Map tab (Complete with Warnings): .planning/phases/15-world-map-character-stats/evidence/screenshots.mjs, frontend/src/components/ConditionStrip.tsx, frontend/src/components/SoulCodexContents.tsx, frontend/src/components/WorldMap.tsx, frontend/src/components/__tests__/worldMap.test.tsx, frontend/src/data/kingdomLayout.ts, frontend/src/screens/SimulationScreen.tsx
- 15-04 Adversarial re-run, live smoke run and design log (Complete): docs/design-decisions-log.md

## Decisions
- 15-01: I did not touch the plan-listed simulationScreen.test.tsx and components.test.tsx. No fixtures in them needed the new keys, and the frontend suite passes.
- 15-01: backend/src/data/introScene.ts doesn't exist. The intro prompt lives in routes/introScene.ts, which is edited.
- 15-01: The only removed lines in worldSystemPrompt.ts are the JSON example's last key and the world_events description line, both rewritten. No MUST NOT bullet was cha
- 15-02: `shared/src/index.ts` is unchanged because it already re-exports `gameState.js`.
- 15-02: `Race.baseline` is optional in the shared type so pre-v2 saved characters still type-check.
- 15-02: `ApplyWorldUpdateResult` gained a separate `systemEntries` array; App appends it after `logEntry`, so `logEntry` stays a single entry.
- 15-03: The overlay covers only the WorldLog, so the ActionBar stays usable. It is a non-modal dialog with no focus trap; Escape is caught by a document listener while 
- 15-03: The Map button sits in the Codex Location block and appears only when `onOpenMap` is passed, so desktop has it and mobile does not (mobile uses the Map tab).
- 15-03: WorldMap uses `useIsMobile()` to switch to a portrait layout of the same graph. This was the screenshot fix and keeps the planned `{places, currentPlaceId, loca
- 15-04: Case 6 is reported as a harness FAIL with a substance-PASS note rather than editing the criterion or the script.
- 15-04: I did not re-run the skill-scope suite after the fix because it doesn't touch the schema.

## Conventions and Open Questions
- 15-01 convention: Later plans can import KingdomSchema, KINGDOMS, ConditionChanges, StatGrowth and Setback from @soulbound/shared.
- 15-01 convention: The request-side condition, attributes, places, currentPlaceId and growthLog are all optional, so v1 clients still validate.
- 15-01 convention: frontend/src/game/applyWorldUpdate.ts does not yet consume condition_changes, stat_growth, setback or kingdom/place_id.
- 15-02 convention: `applyWorldUpdate` now returns `clampEvents` and `systemEntries`, and consumes `condition_changes`, `stat_growth`, `setback`, `kingdom` and `place_id`.
- 15-02 convention: The `GameState` fixtures in tests need all five new fields: condition, attributes, places, currentPlaceId and growthLog.
- 15-02 convention: `loadSave` always returns a v2 slot
- 15-03 convention: `MobileTab = 'World' | 'Codex' | 'Map'` is exported from SimulationScreen.tsx.
- 15-03 convention: Test hooks: testids `condition-strip-full`, `condition-strip-compact`, `world-map` and `you-are-here`
- 15-03 convention: each pin is `g[role=img]` named "<name>, <kingdom>[ (you are here)]"
- 15-04 convention: Triad needs to write 15-04-SUMMARY.md and clear the earlier BLOCKED state. Escalation #3 is resolved by the live re-run.
- 15-04 convention: To re-run: `ANTHROPIC_API_KEY="$SOULBOUND_ANTHROPIC_KEY" node` on `adversarial.mjs` and `run.mjs`. Run `grammar-probe.mjs` before any future contract addition.

## Files Modified
| File | Change |
|------|--------|
| `frontend/src/components/__tests__/codexAccount.test.tsx` | 15-02: Game state, save v2 migration and guard rails |
| `.planning/phases/15-world-map-character-stats/evidence/screenshots.mjs` | 15-03: Condition strip, kingdom map and mobile Map tab |
| `frontend/src/components/ConditionStrip.tsx` | 15-03: Condition strip, kingdom map and mobile Map tab |
| `frontend/src/components/SoulCodexContents.tsx` | 15-03: Condition strip, kingdom map and mobile Map tab |
| `frontend/src/components/WorldMap.tsx` | 15-03: Condition strip, kingdom map and mobile Map tab |
| `frontend/src/components/__tests__/worldMap.test.tsx` | 15-03: Condition strip, kingdom map and mobile Map tab |
| `frontend/src/data/kingdomLayout.ts` | 15-03: Condition strip, kingdom map and mobile Map tab |
| `frontend/src/screens/SimulationScreen.tsx` | 15-03: Condition strip, kingdom map and mobile Map tab |
| `docs/design-decisions-log.md` | 15-04: Adversarial re-run, live smoke run and design log |

## Verification
- 15-01 (R37): 10/10 verification commands passed
- 15-02 (R37): 6/6 verification commands passed
- 15-03 (R37): 5/5 verification commands passed
- 15-04 (R37): 5/5 verification commands passed

## Agents
- 15-01: engineering-backend-architect
- 15-02: engineering-senior-developer
- 15-03: engineering-frontend-developer
- 15-04: testing-qa-verification-specialist

## Also Covered
- shared/src/worldVoice.ts
- backend/src/routes/worldEngine.ts
- backend/src/data/worldSystemPrompt.ts
- backend/src/routes/introScene.ts
- backend/src/__tests__/contract.test.ts
- backend/src/__tests__/prompts.test.ts
- backend/src/__tests__/routes.test.ts
- frontend/src/game/__tests__/applyWorldUpdate.test.ts
- frontend/src/screens/__tests__/simulationScreen.test.tsx
- frontend/src/components/__tests__/components.test.tsx
- CLAUDE.md
- .planning/phases/04-parity-verification/evidence/counttokens.mjs
- backend/src/__tests__/anthropic.test.ts
- backend/src/__tests__/fixtures/introScene.prompt.txt
- frontend/src/__tests__/appIntegration.test.tsx
- frontend/src/__tests__/prologueIntegration.test.tsx
- frontend/src/lib/__tests__/api.test.ts
- frontend/src/lib/apiStub.ts
- shared/src/gameState.ts
- frontend/src/data/races.ts
- frontend/src/lib/saves.ts
- frontend/src/lib/__tests__/saves.test.ts
- frontend/src/lib/__tests__/passphrase.test.ts
- frontend/src/game/places.ts
- frontend/src/game/__tests__/applyWorldUpdate.test.ts
- frontend/src/game/__tests__/guardRails.property.test.ts
- frontend/src/App.tsx
- frontend/src/screens/__tests__/simulationScreen.test.tsx
- frontend/src/components/__tests__/components.test.tsx
- frontend/src/__tests__/constraints.test.ts
- frontend/src/__tests__/appIntegration.test.tsx
- frontend/src/__tests__/prologueIntegration.test.tsx
- frontend/src/lib/__tests__/api.test.ts
- frontend/src/lib/apiStub.ts
- frontend/src/App.tsx
- frontend/src/components/__tests__/components.test.tsx
- frontend/src/screens/__tests__/simulationScreen.test.tsx
- .planning/experiments/2026-10-16-stats-live/run.mjs
- .planning/experiments/2026-10-16-stats-live/adversarial.mjs
- .planning/experiments/2026-10-16-stats-live/RESULTS.md
- .planning/experiments/2026-10-16-stats-live/transcripts/
- .planning/ROADMAP.md
- .planning/STATE.md
