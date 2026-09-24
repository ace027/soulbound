# The Soulbound Chronicles — Roadmap

## Phases

- [x] **Phase 1: Foundation & Contract** — scaffold, Docker, and the shared World Voice contract
- [x] **Phase 2: Backend & World Voice** — three routes on the official SDK, structured outputs, caching verified
- [x] **Phase 3: Frontend Port** — components, screens, game logic, saves
- [x] **Phase 4: Parity & Verification** — end-to-end playthrough, constraint audit, doc updates
- [x] **Phase 5: Docker Image Publishing** — access gate, single image, GHCR release, self-host package
- [ ] **Phase 6: Hosted Mode & Accounts** — mode switch, sign-in, invites, live hosted skeleton, ops baseline
- [ ] **Phase 7: Server Saves & Shared-World Seams** — per-account saves, import, backups, turn logic in `shared/`, turn log
- [ ] **Phase 8: Metering & Allowance** — usage ledger, 250-turn allowance, creation cap, daily spend cap
- [ ] **Phase 9: Follow-ability, then Friends** — suggested actions, free recap, invite gate, invite friends free
- [ ] **Phase 10: Quests & Objectives** — tracked quests in the contract, Codex and prompt
- [ ] **Phase 11: Subscription Billing** — Stripe, priced from friends' real usage
- [ ] **Phase 12: Condition & Inventory** — own design pass first, then contract + balance rules
- [ ] **Phase 13: Launch Hardening & Conversion** — ToS/privacy, CSP, friends to paid, public-beta waitlist

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

### Phases 6-13: design source
All eight phases come from `.planning/explorations/2026-09-24-hosted-multiplayer-saas-design.md` (explored and refined 2026-09-24). **Two modes, one codebase:** every phase must leave `SOULBOUND_MODE=selfhost` behaving exactly as Phase 5 shipped, proven by the existing suite plus `scripts/smoke-image.sh`. Deliberate reversals (single-tenant auth scope, CLAUDE.md #2, PROJECT.md out-of-scope) are recorded in CLAUDE.md and the design log → "Hosted mode (2026-09-24)". Plan counts are set by `/legion:plan N`.

### Phase 6: Hosted Mode & Accounts
**Goal**: A hosted instance that the developer alone can sign into, deployed from day one, with self-host untouched.
**Requirements**: R23, R24, R25
**Recommended Agents**: Backend Architect, Security Engineer, Infrastructure & DevOps Engineer
**Success Criteria**:
- `SOULBOUND_MODE` defaults to `selfhost`; the existing suite and the smoke test (7/7) still pass unchanged
- **Sign-in:**
  - Email link, Google and Discord all work on the live host.
  - Sessions last 30 days, rolling.
  - Every state-changing route rejects a foreign Origin (tested).
- **Access:** single-use invite codes; an anti-framing header present.
- **Account deletion:**
  - An inline confirm, never a native dialog (CLAUDE.md #1).
  - The account is hidden at once and purged after 7 days (tested with a shortened grace).
- **Mount order:** the auth handler sits before `express.json`, and each ordering claim has a test that fails when the order breaks.
- **Ops baseline:** the Anthropic Console spend limit is set, error-tracker redaction is tested, and the uptime alert is received.
**Plans**: TBD

### Phase 7: Server Saves & Shared-World Seams
**Goal**: Saves follow the player across devices in hosted mode, and the data model is ready for a shared world later.
**Requirements**: R26, R27
**Recommended Agents**: Backend Architect, Frontend Developer, QA Verification Specialist
**Success Criteria**:
- **Saves:**
  - `/api/saves` rejects another player's save (tested).
  - The adapter keeps `App.tsx` byte-identical and keeps the save synchronous inside `setLog`.
  - Browser saves import once.
  - The 20-slot cap never blocks autosave to an existing slot.
- **Backups:** a restore has been rehearsed on the live database.
- **Turn logic in `shared/`:**
  - `applyWorldUpdate` and `mergeNarrativeMemory` live there, re-exported at the old paths.
  - All 14 `MUTANT` annotations still pass.
  - The mutation spot-check is re-run.
- **Data seams:** `world_id` on every save; entity IDs backfilled on old saves; a `turn_events` row per World Voice call.
**Plans**: TBD

### Phase 8: Metering & Allowance
**Goal**: Every paid call is metered and bounded per player and app-wide, before anyone else plays on the operator's key.
**Requirements**: R28
**Recommended Agents**: Backend Architect, Security Engineer, QA Verification Specialist
**Success Criteria**:
- **Metering:** each call writes a usage row from the real `usage` fields; turn cost is re-derived from the ledger.
- **Allowance:** 250 turns a month, checked before each call and debited after, with remaining turns shown in the UI.
- **Character creation:** 3 free a month, then 2 turns each, counted at `/api/unique-skill`.
- **Daily spend cap:** alerts at 50% and 80%. At 100% it pauses paid calls with an in-UI message while saves still work.
- **Before invites:** the usage-policy check is recorded, and the privacy notice shows at sign-up.
**Plans**: TBD

### Phase 9: Follow-ability, then Friends
**Goal**: Fix the playtest's "hard to follow / hard to use my skill" friction, then invite friends to play free.
**Requirements**: R31, R32, R35
**Recommended Agents**: AI Engineer, Frontend Developer, QA Verification Specialist
**Success Criteria**:
- **Suggested actions:**
  - `suggested_actions` is added to the prompt, shared schema, `CONTRACT_FIELD_NAMES`, the parser and CLAUDE.md #4, all in one commit.
  - Chips fill the action box and never auto-submit.
  - The MUST NOT addition is guarded by `prompts.test.ts`.
  - The adversarial turn tests are re-run live, and they hold.
- **Recap:** it works at zero API cost in both modes, verified by a request count.
- **Invite gate:** all "ready to invite friends" checklist items are demonstrated on the live host, with evidence. That includes the **Anthropic key rotated** (deferred to here by the developer on 2026-09-24). A Discord link is in the game. Friends are invited.
**Plans**: TBD

### Phase 10: Quests & Objectives
**Goal**: Sessions have direction the player can see, built while friends play.
**Requirements**: R33
**Recommended Agents**: AI Engineer, Frontend Developer
**Success Criteria**:
- **Contract:** `quest_updates` is in the contract (prompt, schema and parser in one commit).
- **Game state:** quests are capped and carry stable IDs. Old saves load with no quests.
- **Prompt:** the `ACTIVE QUESTS` block is bounded, with the cached prefix unchanged (it sits outside the system blocks).
- **Rules:** the MUST NOT additions are guarded by tests; a live run shows quests opening and completing.
**Plans**: TBD

### Phase 11: Subscription Billing
**Goal**: Hosted play pays for itself, at a price set from real usage.
**Requirements**: R29
**Recommended Agents**: Backend Architect, Security Engineer
**Success Criteria**:
- **Price:** $10 / 250 turns is confirmed or adjusted from the Phase 8 ledger, with the derivation recorded.
- **Stripe:**
  - Checkout and the Customer Portal work in test mode.
  - Webhooks are signature-verified on the raw body, mounted before `express.json`.
  - Handling for lapsed and failed payments is tested.
  - No card data reaches our servers.
**Plans**: TBD

### Phase 12: Condition & Inventory
**Goal**: Consequences that stick, judged with real players.
**Requirements**: R34
**Recommended Agents**: AI Engineer, QA Verification Specialist
**Success Criteria**:
- **Design first:** a `/legion:explore` design is approved first, covering defeat semantics, item and tier rules, and what the World Voice may change.
- **Contract:** the contract and MUST NOT additions land together.
- **Testing:** the adversarial turn tests are re-run; old saves still load.
**Plans**: TBD

### Phase 13: Launch Hardening & Conversion
**Goal**: Ready for paying players beyond the invite list.
**Requirements**: R30
**Recommended Agents**: Security Engineer, Technical Writer, Infrastructure & DevOps Engineer
**Success Criteria**:
- ToS and a privacy policy are published.
- CSP is live.
- A restore drill is re-run.
- Friends are moved to paid with notice.
- The public-beta waitlist is open.
**Plans**: TBD

## Progress

| Phase | Plans | Completed | Status |
|-------|-------|-----------|--------|
| 1. Foundation & Contract | 6 | 6 | **Shipped** 2026-09-17 — review passed (2 cycles) · [PR #1](https://github.com/DeanItServices/soulbound/pull/1) |
| 2. Backend & World Voice | 5 | 5 | **Shipped** 2026-09-17 — review passed (3 cycles) · [PR #1](https://github.com/DeanItServices/soulbound/pull/1) |
| 3. Frontend Port | 10 | 10 | **Shipped** 2026-09-18 — review passed (2 cycles, 3-reviewer panel) · [PR #2](https://github.com/DeanItServices/soulbound/pull/2) (merged) |
| 4. Parity & Verification | 6 | 6 | **Shipped** 2026-09-18 — review passed (3 cycles, 3-reviewer panel) · [PR #3](https://github.com/DeanItServices/soulbound/pull/3) |
| 5. Docker Image Publishing | 6 | 6 | **Shipped** 2026-09-24 — review passed (3 cycles, 3-reviewer panel) · [PR #6](https://github.com/DeanItServices/soulbound/pull/6) (merged `86faa9f`) · GHCR publish UNTESTED until first dispatch |
| 6. Hosted Mode & Accounts | TBD | 0 | Pending — plan with `/legion:plan 6` |
| 7. Server Saves & Shared-World Seams | TBD | 0 | Pending |
| 8. Metering & Allowance | TBD | 0 | Pending |
| 9. Follow-ability, then Friends | TBD | 0 | Pending |
| 10. Quests & Objectives | TBD | 0 | Pending |
| 11. Subscription Billing | TBD | 0 | Pending |
| 12. Condition & Inventory | TBD | 0 | Pending (design pass first) |
| 13. Launch Hardening & Conversion | TBD | 0 | Pending |
| **Total** | **33 + TBD** | **33** | Phases 1-5 shipped; 6-13 pending |
