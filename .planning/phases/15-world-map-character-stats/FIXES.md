# Phase 15: World Map & Character Stats — Review Fixes

Fixes applied by the review loop, one section per cycle. Re-review decides whether each one holds.

## Cycle 1

**Date**: 2026-10-16
**Checks**: 20/20 passed
**Files changed**: `frontend/src/App.tsx`, `frontend/src/__tests__/appIntegration.test.tsx`, `frontend/src/game/__tests__/applyWorldUpdate.test.ts`, `frontend/src/game/applyWorldUpdate.ts`

| Finding | Severity | File | Agent | Status | Notes |
|---------|----------|------|-------|--------|-------|
| F-001 | critical | `frontend/src/game/applyWorldUpdate.ts (with backend/src/routes/worldEngine.ts)` | engineering-senior-developer | not fixed | partial |
| F-002 | major | `frontend/src/App.tsx` | engineering-frontend-developer | fix applied | A new game now seeds `places` and `currentPlaceId` from the intro `scene_set`. It pins the opening place with the same slug rule as `applyWorldUpdate`, using the intro's kingdom (or 'unknown'). The place block was not extracted into a shared helper because that would mean editing `applyWorldUpdate.ts` and `places.ts`, which are outside my writable list. The logic is inlined in `App.tsx` and reuses `slugPlaceId`. |
| F-004 | critical | `frontend/src/game/applyWorldUpdate.ts` | engineering-backend-architect | not fixed | partial |

## Cycle 2

**Date**: 2026-10-16
**Checks**: 20/20 passed
**Files changed**: `frontend/src/App.tsx`, `frontend/src/__tests__/appIntegration.test.tsx`, `frontend/src/lib/__tests__/saves.test.ts`, `frontend/src/lib/saves.ts`

| Finding | Severity | File | Agent | Status | Notes |
|---------|----------|------|-------|--------|-------|
| F-002 | critical | `frontend/src/App.tsx` | engineering-frontend-developer | not fixed | partial |
| F-005 | major | `frontend/src/lib/saves.ts (migration; the same F-004 defect, outside the listed files)` | engineering-senior-developer | fix applied | The v1/v0 to v2 migration in saves.ts now seeds the place name with location.slice(0, 80). F-005 and F-006 are the same one-line defect, so one fix covers both. A new migration test loads a save with a 400-char location and checks the name is cut to 80 chars. |
| F-006 | major | `frontend/src/lib/saves.ts (not in the review list; the call site matters here)` | engineering-senior-developer | fix applied | The v1/v0 to v2 migration in saves.ts now seeds the place name with location.slice(0, 80). F-005 and F-006 are the same one-line defect, so one fix covers both. A new migration test loads a save with a 400-char location and checks the name is cut to 80 chars. |
| F-007 | critical | `frontend/src/lib/saves.ts` | engineering-backend-architect | fix applied | `migrateSave` now writes `name: location.slice(0, 80)`. That edit was already on disk when I went to make it, so the file had changed after I first read it, and I made no source edit of my own. I added a migration test with a 300-character location. It checks the place name is at most 80 characters, the key is at most 100, and `kingdom` and `firstSeenTurn` are valid. It also checks `currentPlaceId` points at that place. |
