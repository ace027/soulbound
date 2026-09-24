# The Soulbound Chronicles — Roadmap

## Phases

- [x] **Phase 1: Foundation & Contract** — scaffold, Docker, and the shared World Voice contract
- [x] **Phase 2: Backend & World Voice** — three routes on the official SDK, structured outputs, caching verified
- [x] **Phase 3: Frontend Port** — components, screens, game logic, saves
- [x] **Phase 4: Parity & Verification** — end-to-end playthrough, constraint audit, doc updates
- [x] **Phase 5: Docker Image Publishing** — access gate, single image, GHCR release, self-host package

## Phase Details

### Phase 1: Foundation & Contract
**Goal**: A runnable empty skeleton plus the single contract module every later phase depends on. Nothing game-facing works yet, but `docker compose up` succeeds and the World Voice types exist.
**Requirements**: R1, R2, R3, R8, R15 (docs move only)
**Recommended Agents**: Backend Architect, Infrastructure & DevOps Engineer, Senior Developer
**Success Criteria**:
- `docker compose up` starts both services; frontend serves, backend responds to a health check
- Backend fails fast with a clear message when `ANTHROPIC_API_KEY` is absent, and starts cleanly when present
- `.env.example` committed with an empty key; real `.env` gitignored; `chmod 600` documented
- `shared/worldVoice.ts` defines every contract field exactly as `CLAUDE.md` constraint #4 names them, and a JSON Schema is derived from it
- `WORLD_SYSTEM_PROMPT`, `WORLD_LORE`, `RACES`, `QUESTIONS` extracted byte-identical to the legacy file (verified by diff, not by eye)
- Docs moved into `docs/` so `CLAUDE.md`'s existing references resolve; legacy artifact moved to `legacy/`
**Plans**: 6 (planned 2026-09-17 — revised up from the initial estimate of 3; the 3-task-per-plan cap and the dependency structure don't permit fewer)

### Phase 2: Backend & World Voice
**Goal**: All three API routes live, callable, and returning schema-valid JSON — with prompt caching finally verified against real responses, which was never possible from inside the artifact.
**Requirements**: R4, R5, R6, R7
**Recommended Agents**: Backend Architect, AI Engineer, Security Engineer
**Success Criteria**:
- `/api/unique-skill` (Sonnet 5, **no system blocks**), `/api/world-engine` and `/api/intro-scene` (both Opus 5, `buildSystemBlocks()`) all return valid responses against the shared schema
- Models live in one config module, not scattered across three route files
- `max_tokens: 16000` on all three; no assistant prefill; no `budget_tokens`
- `cache_creation_input_tokens` / `cache_read_input_tokens` logged per call, and a second world-engine call demonstrably reads cache
- Non-2xx responses produce diagnosable structured errors, replacing the legacy "no `response.ok` check" pattern
- API key absent from every log line, error response, and stack trace — checked, not assumed
**Plans**: 5 (planned 2026-09-17 — revised up from 3: tests pulled forward from Phase 4 per retro action item 1, and live verification is its own plan because it is the only one requiring a real API key)

### Phase 3: Frontend Port
**Goal**: The game is playable. UI ported from the artifact with behavior intact, wired to the backend rather than to Anthropic directly.
**Requirements**: R9, R10, R11, R12
**Recommended Agents**: Frontend Developer, Senior Developer, UX Architect
**Success Criteria**:
- All five phase screens render and navigate: title (with inline save browser) → race select → questionnaire → loading → simulation
- `lib/api.ts` calls the backend only; no client-side call reaches `api.anthropic.com`
- `lib/saves.ts` uses byte-identical key names, so a save written by the artifact still loads; new saves carry `schemaVersion`
- Game logic intact: mastery, tiers, Soul Rewrite, sub-ability emergence at 25/60/100, `usage_notes` accumulation, 40-note and 80-entry caps
- Mobile two-tab layout works below 700px and now responds to resize (legacy line 1348 bug fixed)
- Google Fonts loaded once via `index.html`, not re-injected per render in six places
- No `window.confirm`/`alert`/`prompt` anywhere; `min-height: 0` present on every flex ancestor of a scroll region
**Plans**: 10 (planned 2026-09-17 — revised up from 4. Two reasons found only by reading the code:
`frontend/package.json` has no test runner at all, so a blocking wave-0 plan is needed before the
retro's "tests alongside build" is even possible; and the 3-task-per-plan cap plus the dependency
structure don't permit fewer. Architecture chosen from three competing proposals — see 03-CONTEXT.md.)

### Phase 4: Parity & Verification
**Goal**: Prove the migrated app matches the artifact, and bring the logged decisions back in sync with the code.
**Requirements**: R13, R14, R16, R15
**Recommended Agents**: QA Verification Specialist, Test Results Analyzer, Technical Writer
**Success Criteria**:
- A full playthrough runs in-sandbox: race select → questionnaire → Unique Skill → intro scene → several World Engine turns
- Save, reload the page, load the save, confirm state restored
- Vitest contract test passes on a valid fixture and fails loudly on a malformed one; save round-trip tests pass
- All eight preservation constraints audited against the migrated code, one by one, with evidence
- `CLAUDE.md` updated: model split recorded, stale "auth is an OPEN DECISION" note pointed at its resolution in `MIGRATION-PLAN.md`
- `design-decisions-log.md` updated: the Opus 5 model split and its rationale, plus the correction that `determineUniqueSkill` sends no `system` param at all (the log currently says only that it lacks `WORLD_LORE`)
- `legacy/souldbound-world.jsx` deleted once parity is confirmed (git history preserves it)
**Plans**: 6 (planned 2026-09-18 — revised up from 3. R16 turned out to be already satisfied by
Phase 2's `contract.test.ts` and Phase 3's save round-trip tests, so it became a verification plan;
but R15's real scope (CLAUDE.md's stale "OPEN DECISION" auth heading, and a design log with zero
mentions of the model split), the retro's committed-Playwright-guard item, and the 69 legacy
citations that deletion would strand each earned their own plan. Only one plan spends money.)

### Phase 5: Docker Image Publishing
**Goal**: Publish one Docker image a self-hosting deployer can pull and run, without turning their Anthropic key into an open proxy for anyone who reaches the port.
**Requirements**: R17 access gate, R18 rate limit, R19 frontend gate, R20 single deployable image, R21 release pipeline, R22 self-host package and records
**Spec**: `.planning/specs/05-docker-image-publishing-spec.md` (critiqued once; REWORK → 12 findings applied)
**Recommended Agents**: Backend Architect, Security Engineer, Frontend Developer, Infrastructure & DevOps Engineer, Technical Writer
**Success Criteria**:
- Every `/api/*` route except `/api/health` refuses requests without the deployer's passphrase (401 `PASSPHRASE_REQUIRED`), rate-limited before the check and before body parsing; the passphrase never appears in logs or responses (mutation-verified)
- The browser asks for the passphrase inline before the title screen; `App.tsx` is byte-identical to `7856b7d`
- One image serves the frontend and the API same-origin; no `/api` path can return `index.html`
- `scripts/smoke-image.sh` passes locally and in CI on every push
- `release.yml` publishes `{version}` + `latest` for amd64 + arm64 to GHCR on manual dispatch, refusing to overwrite (the first publish is UNTESTED until dispatched after merge)
- `compose.selfhost.yml` runs on a non-default port end to end; README, design log, CLAUDE.md and PROJECT.md match what shipped; versions at `0.1.0`
**Plans**: 6 (planned 2026-09-23 from the spec; serial waves per retro AI-5. Architecture chosen from three competing proposals: Pragmatic + 2 from Clean. See 05-CONTEXT.md.)

## Progress

| Phase | Plans | Completed | Status |
|-------|-------|-----------|--------|
| 1. Foundation & Contract | 6 | 6 | **Shipped** 2026-09-17 — review passed (2 cycles) · [PR #1](https://github.com/DeanItServices/soulbound/pull/1) |
| 2. Backend & World Voice | 5 | 5 | **Shipped** 2026-09-17 — review passed (3 cycles) · [PR #1](https://github.com/DeanItServices/soulbound/pull/1) |
| 3. Frontend Port | 10 | 10 | **Shipped** 2026-09-18 — review passed (2 cycles, 3-reviewer panel) · [PR #2](https://github.com/DeanItServices/soulbound/pull/2) (merged) |
| 4. Parity & Verification | 6 | 6 | **Shipped** 2026-09-18 — review passed (3 cycles, 3-reviewer panel) · [PR #3](https://github.com/DeanItServices/soulbound/pull/3) |
| 5. Docker Image Publishing | 6 | 6 | **Shipped** 2026-09-24 — review passed (3 cycles, 3-reviewer panel) · [PR #6](https://github.com/DeanItServices/soulbound/pull/6) · GHCR publish UNTESTED until first dispatch |
| **Total** | **33** | **33** | 100% |
