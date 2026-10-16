# Phase 15: World Map & Character Stats — Review Summary

## Result: PASSED

**Cycles Used**: 3
**Reviewers**: testing-qa-verification-specialist, engineering-frontend-developer, design-ui-designer, engineering-senior-developer
**Evaluators**: code-quality, ui-ux, integration, business-logic
**Completed**: 2026-10-16

## Findings Summary
- Must-fix (blocker, critical, major) found: 6; fixed: 6; unresolved: 0
- Suggestions (minor, advisory): 2
- Deferred (confidence 50-79%): 22
- Hot spots (flagged by 2+ reviewers): `frontend/src/lib/saves.ts`, `frontend/src/screens/SimulationScreen.tsx`, `frontend/src/components/WorldMap.tsx`, `frontend/src/components/ConditionStrip.tsx`, `frontend/src/game/applyWorldUpdate.ts`, `frontend/src/App.tsx`, `frontend/src/game/places.ts`

## Findings Detail
| ID | Severity | Location | Issue | Reviewers | Confidence | Status |
|----|----------|----------|-------|-----------|------------|--------|
| F-001 | critical | `frontend/src/game/applyWorldUpdate.ts (with backend/src/routes/worldEngine.ts):306` | The client stores model-supplied strings unbounded, but the request schema caps them. `places[id].name` is set from `newState.location`, and `growthLog[].milestone` is set from `g.milestone`. `PlaceRequestSchema.name` is `max(80)` and `GrowthLogEntryRequestSchema.milestone` is `max(200)`. The `location` field itself is allowed up to 400 chars on the request, and the shared `stat_growth` schema has no length bound on `milestone`. Nothing truncates either string before it is saved. | testing-qa-verification-specialist | 85% | fixed |
| F-002 | critical | `frontend/src/App.tsx:249-267` | F-001 and F-004 are fixed only in `applyWorldUpdate.ts`. Character creation still stores the intro scene's `sceneEvent.location` unbounded in `GameState.location` (line 253) and as the place `name` (line 273). It is also not sliced before it goes into `slugPlaceId`. | evaluator:code-quality, evaluator:integration, evaluator:business-logic | 80% | fixed |
| F-003 | advisory | `backend/src/data/introScene.ts` | This path is in the evaluated file list but does not exist. The intro prompt lives in `/home/user/soulbound/backend/src/routes/introScene.ts`. | evaluator:code-quality | 90% | deferred |
| F-004 | critical | `frontend/src/game/applyWorldUpdate.ts:343-354` | The client writes model-authored strings into state with no truncation, but the backend request schema bounds them. A new place is stored with `name: newState.location`. `PlaceRequestSchema.name` is `.max(80)`, while `location` is allowed up to 400 chars and the prompt gives the model no length limit. A migrated v1 save does the same: `name: location` can be up to 400 chars. Growth `milestone` is stored as given, but `GrowthLogEntryRequestSchema.milestone` is `.max(200)`. | evaluator:integration, evaluator:business-logic | 80% | fixed |
| F-005 | major | `frontend/src/lib/saves.ts (migration; the same F-004 defect, outside the listed files):71` | The v1 to v2 migration writes `name: location` with no `.slice(0, 80)`. The migrated place `kingdom` is `'unknown'`, so it is never repaired from the opening scene. This is the migrated-save half of F-004, and it is still open. | testing-qa-verification-specialist | 85% | fixed |
| F-006 | major | `frontend/src/lib/saves.ts (not in the review list; the call site matters here):71` | The v1 to v2 migration seeds `places[placeId].name` with `location`, untruncated. `location` can be up to 400 chars, but the name limit is 80. F-004 named this case specifically, and it is not fixed. | engineering-senior-developer | 80% | fixed |
| F-007 | critical | `frontend/src/lib/saves.ts:71` | F-004 is only partly fixed. `applyWorldUpdate.ts` now slices `name` to 80, `milestone` to 200 and `location` to 400. The v1 → v2 migration still writes `name: location` with no slice. `location` can be up to 400 characters, and `PlaceRequestSchema.name` is `.max(80)`. | evaluator:integration | 90% | fixed |
| F-008 | advisory | `frontend/src/App.tsx, frontend/src/lib/saves.ts:251-276` | No defect found. The F-002, F-005, F-006 and F-007 fixes are in place. App.tsx slices the intro location to 400 and the place name to 80. The v1 to v2 migration in saves.ts slices the name to 80. `slugPlaceId` also caps the slug at 60 characters. | design-ui-designer | 85% | deferred |

## Reviewer Verdicts
- Cycle 1, testing-qa-verification-specialist: **NEEDS WORK**
- Cycle 1, engineering-frontend-developer: **PASS**
- Cycle 1, design-ui-designer: **NEEDS WORK**
- Cycle 1, engineering-senior-developer: **NEEDS WORK**
- Cycle 1, evaluator:code-quality: **NEEDS WORK**
- Cycle 1, evaluator:ui-ux: **NEEDS WORK**
- Cycle 1, evaluator:integration: **NEEDS WORK**
- Cycle 1, evaluator:business-logic: **NEEDS WORK**
- Cycle 2, testing-qa-verification-specialist: **NEEDS WORK**
- Cycle 2, engineering-frontend-developer: **NEEDS WORK**
- Cycle 2, design-ui-designer: **NEEDS WORK**
- Cycle 2, engineering-senior-developer: **NEEDS WORK**
- Cycle 2, evaluator:integration: **NEEDS WORK**
- Cycle 2, evaluator:business-logic: **NEEDS WORK**
- Cycle 3, testing-qa-verification-specialist: **PASS**
- Cycle 3, engineering-frontend-developer: **PASS**
- Cycle 3, design-ui-designer: **PASS**
- Cycle 3, engineering-senior-developer: **PASS**
- Cycle 3, evaluator:integration: **PASS**
- Cycle 3, evaluator:business-logic: **PASS**

## Suggestions (Not Required)
- F-003 `backend/src/data/introScene.ts`: This path is in the evaluated file list but does not exist. The intro prompt lives in `/home/user/soulbound/backend/src/routes/introScene.ts`. (fix: Correct the manifest path, or confirm that the file was deliberately not created.)
- F-008 `frontend/src/App.tsx, frontend/src/lib/saves.ts`: No defect found. The F-002, F-005, F-006 and F-007 fixes are in place. App.tsx slices the intro location to 400 and the place name to 80. The v1 to v2 migration in saves.ts slices the name to 80. `slugPlaceId` also caps the slug at 60 characters. (fix: None needed.)

## Deferred (Medium Confidence)
- `backend/src/routes/worldEngine.ts (with frontend/src/game/applyWorldUpdate.ts)` [major, 60%]: `growthLog` is capped at 200 entries on the request. The client appends to it with no cap. The same applies to `places`, where the client's `MAX_PLACES` of 200 matches the server and is safe. Growth is limited to one per milestone and one per turn, so 200 entries is reachable in a very long run.
- `frontend/src/lib/saves.ts` [minor, 60%]: `migrateSave` passes any save with `schemaVersion >= 2` straight through without checking that `condition`, `attributes`, `places` and `growthLog` exist. A corrupt or partially written v2 save with a missing field loads successfully. `applyWorldUpdate` then spreads `gameState.growthLog` (a TypeError if undefined) and reads `condition[...]`.
- `frontend/src/screens/SimulationScreen.tsx` [minor, 70%]: `mapOpen` is kept separately from the derived `overlayOpen = mapOpen && !isMobile`. If the viewport crosses the 700px line while the desktop overlay is open, `mapOpen` stays true. The overlay is hidden on mobile, and it reopens by itself when the viewport widens again. The focus effect then also moves focus to Close without any user action. The Close button is about 24px tall (10px font, 4px vertical padding).
- `frontend/src/components/WorldMap.tsx` [advisory, 55%]: `WorldMap` sorts the places, groups them by kingdom and runs `layoutPins` for all seven regions on every render. It has no `useMemo` and is not wrapped in `React.memo`. `SimulationScreen` re-renders on every keystroke because `input` state is passed down, so the map re-renders too, whether it is the open overlay or the mobile tab.
- `frontend/src/components/ConditionStrip.tsx` [minor, 55%]: The meter container has `role="meter"` with an `aria-label`, and the visible text "HP 84/100" is a child of it. `role="meter"` has presentational children, so that text is dropped from the accessibility tree. `role="meter"` also has uneven support across screen readers. The meters change after turns, but no polite live region announces damage or the move to HP 0 and a setback.
- `frontend/src/screens/SimulationScreen.tsx` [minor, 75%]: The inactive mobile tab text colour `#6a5a40` sits on `#0a0805`. I computed a contrast of about 3.0:1, which is below the 4.5:1 AA minimum for 11px text. The new "Map" tab uses it, and the tab bar is now a three-tab primary navigation. `components.test.tsx` says every ConditionStrip pair is AA-checked, but nothing checks the tab bar.
- `frontend/src/components/ConditionStrip.tsx` [advisory, 55%]: The meter fill animates with `transition: width 1s ease` and there is no `prefers-reduced-motion` handling.
- `frontend/src/game/applyWorldUpdate.ts` [minor, 70%]: The setback HP restore fraction `0.25` is a bare literal, while the other rails (`MAX_DELTA_FRACTION`, `MAX_POOL_GROWTH`, `ATTRIBUTE_CEILING`, `MAX_PLACES`) are exported constants. Pool names are derived by `g.stat.slice(4) as 'hp'|'mp'|'sp'` and `max_${pool}` template indexing, which depends on the `max_` prefix length.
- `frontend/src/lib/saves.ts` [minor, 55%]: The module header still says "Three deliberate hardenings", and the `loadSave` doc (lines 108-119) describes only the `schemaVersion` and `narrativeMemory` backfills. Migration is now a fourth behaviour. In addition, `migrateSave` seeds the place ID with `slugPlaceId(location, 'unknown')` (line 66). When the same location is later reported with a known kingdom and no `place_id`, `applyWorldUpdate` slugs `<name>-<kingdom>` (line 344). That slug differs from the migrated `<name>-unknown` ID, so a second place is created.
- `frontend/src/game/applyWorldUpdate.ts (with /home/user/soulbound/backend/src/routes/worldEngine.ts)` [major, 75%]: The client stores `places[id].name = newState.location` and `growthLog.milestone = g.milestone` without any length limit. The request schema bounds `PlaceRequestSchema.name` at 80 and `GrowthLogEntryRequestSchema.milestone` at 200. The model-controlled `location` is allowed up to 400 characters, and the milestone has no limit on the client.
- `frontend/src/game/places.ts` [minor, 60%]: `slugPlaceId` strips every non-`[a-z0-9]` character. Names in non-Latin scripts or consisting only of punctuation all collapse to `place-<kingdom>`, so unrelated places share one ID. The same name reported first with `kingdom: null` and later with a real kingdom gets two different IDs (`...-unknown` and `...-kaldrath`), so one place becomes two pins.
- `frontend/src/App.tsx` [advisory, 55%]: `console.debug('[stats:clamp]', ...)` is development telemetry left in the production turn handler. `clampEvents` is otherwise unused outside the unit tests, and no test checks that it reaches this handler.
- `frontend/src/screens/SimulationScreen.tsx` [major, 70%]: The desktop map overlay has `role="dialog"` but no `aria-modal` and no focus management beyond the first move. Focus is not trapped, and Tab leaves the dialog for the WorldLog, ActionBar and Codex behind it. Nothing marks the WorldLog underneath as inert. The WorldLog stays readable by screen readers and keeps receiving the live updates.
- `frontend/src/components/WorldMap.tsx` [minor, 50%]: The SVG has `minWidth: 300` and sits inside an `overflowX: auto` wrapper. On a 320px viewport with 14px panel padding, the content width is about 292px, so the map overflows and scrolls sideways. The `maxWidth` of `(100vh - 200px) * ratio` can drop below 300 on short landscape phones. `minWidth` then overrides it.
- `frontend/src/components/WorldMap.tsx` [minor, 50%]: Each pin is a `role="img"` group inside a `role="group"` kingdom, which sits inside an SVG with `role="group"`. The same information is repeated in the "Discovered places" list. The "you are here" marker is a ring plus a colour change, with no label on the map itself. The ring is only a 3 unit offset from the dot.
- `backend/src/routes/worldEngine.ts` [major, 50%]: The request schema caps `growthLog` at `.max(200)`. The client never trims `growthLog`; it is bounded only by one growth per milestone.
- `frontend/src/game/applyWorldUpdate.ts` [minor, 75%]: The repeat check (`milestoneKey`, line 278) is computed from the untruncated `g.milestone`. The log stores the version truncated to 200 characters (line 308). A model that repeats a milestone longer than 200 characters never matches the stored one, so the "once per milestone" guard fails for it.
- `frontend/src/game/applyWorldUpdate.ts` [minor, 55%]: `currentScene` is set from the model's `scene_summary` with no bound, while the request schema caps it at 20,000. The `kingdom` value is also taken from the model without any check in this file.
- `frontend/src/game/applyWorldUpdate.ts` [minor, 55%]: `kingdom` from the model is written into `places` unvalidated and unbounded, both on place creation and on the `unknown` to `kingdom` upgrade at line 344. The map layout only knows six kingdoms.
- `frontend/src/App.tsx` [minor, 70%]: The place-pinning rule (slug the location, build the `Place`, set `currentPlaceId`) is hand-copied into an inline IIFE inside the `GameState` literal. A comment says it mirrors `applyWorldUpdate`, but nothing enforces that.
- `frontend/src/lib/saves.ts` [minor, 50%]: The v1 to v2 migration slices the place `name` to 80, but it leaves `gameState.location` as it was in the v1 save. `base.location` is not clamped to 400. A legacy save that stored a longer location would send it on, and the request schema may reject it.
- `frontend/src/lib/saves.ts (relates to /home/user/soulbound/frontend/src/game/applyWorldUpdate.ts:348-357)` [minor, 55%]: A v0 or v1 save migrates its current location to a place with kingdom `'unknown'` and the id `<slug>-unknown`. The same place can later come back from the model with no `place_id` but with a real kingdom. `slugPlaceId` includes the kingdom, so the id becomes `<slug>-kaldrath`. That misses the migrated entry, and a second pin is created for the same name.

## Fixes Applied
- cycle 1: engineering-senior-developer on F-001 (partial); engineering-frontend-developer on F-002 (done); engineering-backend-architect on F-004 (partial); checks 20/20 passed
- cycle 2: engineering-frontend-developer on F-002 (partial); engineering-senior-developer on F-005, F-006 (done); engineering-backend-architect on F-007 (done); checks 20/20 passed
- minor findings: engineering-backend-architect on F-003, F-003, F-009 (done); engineering-frontend-developer on F-004, F-005, F-006, F-007, F-008 (done); left as is: F-003 [advisory] `backend/src/data/introScene.ts`: not fixed. The path in the review manifest doesn't exist, and the intro prompt lives in `backend/src/routes/introScene.ts`. The fix is a manifest correction, not a code change. / F-007 (partial): I did not add the tab bar to the AA test. The test needs a new case, and the colour change alone fixes the contrast. / F-005 (partial): layoutPins still runs on every render of WorldMap. React.memo skips the re-render when the props are unchanged, so it no longer runs on keystrokes. Memoising it per kingdom would be a larger change. / F-006 (partial): I kept role="meter" and its aria-valuetext as the finding suggested. The visible "HP 84/100" text is still presentational inside it, and the new live region covers the alert case.; checks 20/20 passed, 6 file(s) changed

## Cycle Delta
- cycle 1: 1 out-of-domain finding(s) filtered (design-ui-designer on frontend, owner engineering-frontend-developer); see .planning/logs/authority-decisions-2026-10-16.log
- cycle 1: 3 must-fix, 1 suggestions, 16 deferred, 0 dropped (low confidence)
- cycle 2: 4 must-fix (resolved 2, new 3, unchanged 1), 0 suggestions, 4 deferred, 0 dropped (low confidence)
- cycle 3: 0 must-fix (resolved 4, new 0, unchanged 0), 1 suggestions, 2 deferred, 0 dropped (low confidence)

## Coverage
No coverage data found (looked for coverage/coverage-summary.json, coverage-summary.json, coverage/lcov.info, lcov.info, coverage.xml, coverage/cobertura-coverage.xml, coverage/coverage.xml, coverage.txt, coverage/coverage.txt). Advisory only: run the test suite with coverage to check review.coverage_thresholds.
