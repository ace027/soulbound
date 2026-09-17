# Design Exploration — The Soulbound Chronicles: Artifact → Dockerized App

**Date:** 2026-09-17
**Status:** Design complete, all blocking questions resolved — handed to `/legion:start`
**Branch:** `claude/admiring-wright-hfmugk`

## Initial Ask

> "We are going to be making my game Soulbound. Opus 5 should be used as an orchestrator and Sonnet/Haiku can be used for any subagents where it makes sense."

Migrate `souldbound-world.jsx` — a 1,440-line single-file React artifact that ran inside Claude.ai — into a real, independently-runnable, Dockerized frontend/backend application, without regressing any of the game design decisions logged over the artifact's development.

Source context: `CLAUDE.md`, `PROJECT-BACKGROUND.md`, `MIGRATION-PLAN.md`, `design-decisions-log.md` (all at repo root; note they are referenced as `docs/*` in `CLAUDE.md` — see Known Discrepancies).

---

## Research Summary

### Facts (verified against the source this session)

**Repository state**
- 5 tracked files, all at repo root. No `docs/` directory, no `.planning/`, no `package.json`, no build tooling, no tests. Two commits, both "Add files via upload".
- Environment has Node v22.22.2, npm 10.9.7, Docker 29.3.1 available — the app can be built *and actually run* in this sandbox.

**`souldbound-world.jsx` structure** (1,440 lines / 105 KB; filename contains a typo — "sould")
- Exactly one import in the entire file: `import { useState, useRef, useEffect } from "react"` (line 1). No ReactDOM, no mount code, no `index.html`, no bundler entry. It assumes an environment that supplies the React runtime, JSX transpilation, and mounting — i.e. the artifact sandbox. **There is no existing scaffold to extend; the app must be built around this file's logic from scratch.**
- Single default export: `App()` at line 786 (~655 lines), owning all state and handlers. Four presentational children: `SkillCard` (534–565), `SoulCodexContents` (568–654), `WorldLog` (657–741), `ActionBar` (744–783). No context, no state library.
- Static data constants: `WORLD_SYSTEM_PROMPT` (63–216, ~154 lines), `WORLD_LORE` (219–302, ~84 lines), `QUESTIONS` (305–331, 5 entries), `RACES` (334–380, 9 entries), `TIER_STYLE` (525–531), save keys (5–7).
- 16 `useState` hooks (787–802), 1 `useRef`, exactly 2 `useEffect`s. No `useReducer`.

**The three API call sites** — all `fetch("https://api.anthropic.com/v1/messages")`, all `model: "claude-sonnet-5"`, all `max_tokens: 2000`:

| Function | Lines | `system` blocks | Cached |
|---|---|---|---|
| `determineUniqueSkill` | 383–432 | **none at all** | No |
| `callWorldEngine` | 446–499 | `buildSystemBlocks()` | Yes |
| `generateIntroScene` | 502–522 | `buildSystemBlocks()` | Yes |

- `buildSystemBlocks()` (438–443) returns `[{type:"text", text: WORLD_SYSTEM_PROMPT}, {type:"text", text: WORLD_LORE, cache_control:{type:"ephemeral"}}]`. The breakpoint on the *second* block caches the whole prefix — both blocks. This is correct as written.
- `determineUniqueSkill` sends no `system` param whatsoever — it is not merely lore-blind (as `design-decisions-log.md` records), it is *entirely* system-prompt-blind. Consistent with the log's note that this prompt has "deliberately minimal constraint language" and originally "ZERO explicit refusal/defensive instructions," which was then adversarially stress-tested and passed.
- All three parse identically: join `data.content` text blocks → strip ```` ```json ```` fences via regex → bare `JSON.parse`. **No `response.ok` check before `.json()`** on any of the three. A non-2xx error body surfaces as a generic parse failure in the outer `try/catch`, not as a diagnosable error.
- **No assistant prefill anywhere** (verified: zero `"assistant"` role matches). Relevant because prefill returns HTTP 400 on Sonnet 5 / Opus 5 — the port is not exposed to that breaking change.

**Auth** — zero credential handling exists. Grep for `x-api-key|apikey|anthropic-dangerous|ANTHROPIC_API_KEY|process.env` returns nothing. Headers on all three calls are `{"Content-Type": "application/json"}` only. This worked solely because the Claude.ai host intercepted those fetches and injected auth. Deployed as a static site, all three calls fail on both CORS and missing credentials.

**Persistence** — `localStorage` only, centralized in four helpers (lines 9–50): `listSaves`, `loadSave`, `writeSave`, `deleteSave`. Keys: `sbc-save-index` (array of slot metadata) and `sbc-save:<slotId>` (`{gameState, log (capped to 80), savedAt}`). One ad-hoc backward-compat shim at 845–848 defaults `narrativeMemory`. No schema version field.

**Styling** — entirely inline `style={{...}}` objects plus one `<style>` block per screen (6 of them) carrying a Google Fonts `@import`, six `@keyframes`, a hover rule, and scrollbar pseudo-elements. No Tailwind, no CSS modules, no external stylesheet. Style objects are a majority of the line count in most components.

**Anthropic API, current behavior** (from the `claude-api` skill reference)
- `claude-sonnet-5` ($2/$10 per MTok) and `claude-opus-5` ($5/$25 per MTok) are both current, both 1M context. The model ID strings are complete as-is — no date suffixes.
- **Structured outputs** are available via `output_config: {format: {...}}` on `messages.create()`. The older top-level `output_format` parameter is deprecated.
- **Prompt caches are model-scoped.** Render order is `tools` → `system` → `messages`; any byte change in the prefix invalidates everything after it. Minimum cacheable prefix is 512–4096 tokens depending on model — shorter prefixes silently don't cache. Verify via `usage.cache_read_input_tokens`.
- Opus 5 runs **adaptive thinking on by default** (unlike Opus 4.8/4.7). Depth is controlled by `output_config.effort` (`low`…`max`, default `high`), not `budget_tokens` — which returns 400 on both Sonnet 5 and Opus 5.
- Sonnet 5 does **not** support mid-conversation system messages; Opus 5 does. Not needed here (all three calls are single-shot), but relevant if the World Engine ever becomes multi-turn.
- Recommended `max_tokens` for non-streaming is ~16,000; lowballing truncates mid-thought.
- The official SDK (`@anthropic-ai/sdk`) is the correct client for a Node backend, not raw `fetch`.

### Inferences

- The single biggest *code* risk in this migration is not the backend — it's mechanically restructuring ~655 lines of `App()` and hundreds of inline style objects without silently dropping a UI behavior that was tuned by feel. The static data and the three call functions port near-verbatim; the UI is where regressions will hide.
- `generateIntroScene` is called exactly once per playthrough. `callWorldEngine` is called every turn. They currently share a cache namespace because they share a model. Splitting their models breaks that.
- The prompt-caching bug already fixed once (`generateIntroScene` concatenating the system prompt into the user message) suggests the risk pattern here is *drift between the three call sites*, not any single one being wrong. A shared, typed helper is the structural fix.
- `design-decisions-log.md` is unusually complete and treats itself as the record of *why*. It should be updated in the same change as any decision it covers, not retroactively.

### Assumptions (stated, not verified)

- Single-tenant self-hosting is the deployment shape (each deployer runs their own container with their own key) — taken from `MIGRATION-PLAN.md`'s resolved auth decision.
- Existing `localStorage` saves in the developer's browser are worth preserving; the port keeps the exact key names so they continue to load.
- No CI is currently configured and none is required for this phase.
- Multiplayer/Postgres is explicitly out of scope for this migration (per `MIGRATION-PLAN.md` step 8 and `PROJECT-BACKGROUND.md` sequencing).

---

## Product Definition

- **Target users:** initially the developer and their playtester; then self-hosting deployers who supply their own Anthropic API key; eventually public web players (validation phase).
- **Primary outcome:** the exact game that worked in the artifact, running as a real app the developer can start with `docker compose up`, iterate on by feel, and have Claude Code test end-to-end without manual relay.
- **Value proposition:** removes the artifact's three hard ceilings at once — no auth of its own, no file structure an agent can navigate safely, no way for Claude to self-test — while changing zero game behavior the developer didn't explicitly ask to change.
- **Non-goals for this phase:** multiplayer, Postgres, server-side saves, user accounts, monetization, local inference cluster, fine-tuning, any lore or balance change, any rewrite of `WORLD_SYSTEM_PROMPT`'s MUST NOT list.

---

## Decisions Taken (this session)

| # | Decision | Chosen | Note |
|---|---|---|---|
| 1 | Session scope | **Full migration, playable** | `MIGRATION-PLAN.md` steps 2–7 in one pass, run end-to-end in-sandbox |
| 2 | Language | **TypeScript, both sides** | Contract becomes a shared compile-time type |
| 3 | JSON contract enforcement | **Add structured outputs** | `output_config.format`; field names unchanged |
| 4 | Model per call site | **Opus 5 on `callWorldEngine` + `generateIntroScene`**, Sonnet 5 on `determineUniqueSkill` | ⚠️ Reverses a logged decision — see below |

### ⚠️ Decision 4 reverses a logged decision — recorded explicitly

`CLAUDE.md` ("Model & API pattern") and `design-decisions-log.md` both record `claude-sonnet-5` used **identically across all three call sites**. Moving `callWorldEngine` to `claude-opus-5` reverses that. This was flagged before the choice was made and the developer selected it deliberately. Consequences:

1. **Cost.** The World Engine is the hot path — one call per player action. Opus 5 is $5/$25 per MTok vs Sonnet 5's $2/$10, roughly 2.5× per token on both directions.
2. **Thinking is on by default on Opus 5** at `effort: "high"`. That is additional billed output tokens on every turn. `effort` should be treated as the first tuning lever — `medium` is worth measuring before accepting `high` as the default.
3. **Cache namespace split.** Caches are model-scoped. `generateIntroScene` (Sonnet 5) and `callWorldEngine` (Opus 5) would no longer share the `WORLD_LORE` cache. Since intro scene runs once per playthrough, its cache *write* would essentially never be *read* — it would pay full price for `WORLD_LORE` every time, and stop warming the loop's cache.
4. **The adversarial questionnaire testing in the log was validated on Sonnet 5.** That testing covers `determineUniqueSkill`, which stays on Sonnet 5 — so that validation still holds. But the log's note is worth honoring: prompt resilience is partly a property of the model, so World Voice behavior on Opus 5 should be re-observed rather than assumed identical.

**Resolved alongside this decision (OQ-1):** `generateIntroScene` moves to Opus 5 as well. It is one call per playthrough, so the cost delta is negligible, and it acts as a cache *warmer* for the Opus 5 World Engine loop instead of stranding a cache write in the Sonnet 5 namespace. Consequence 3 above is therefore neutralised. `determineUniqueSkill` stays on Sonnet 5 — it sends no system blocks, so it has no cache to share, and its prompt is the adversarially-validated one.

`CLAUDE.md` and `design-decisions-log.md` must both be updated in the same change that makes this model split, per `CLAUDE.md`'s own working rules.

---

## Recommended Approach

**A TypeScript monorepo: `frontend/` (Vite + React) + `backend/` (Node + Express + official Anthropic SDK) + `shared/` (the World Voice contract as types + JSON Schema), orchestrated by `docker-compose.yml`, ported in dependency order with the legacy artifact retained as a read-only reference until parity is confirmed.**

Rationale:

- **`shared/` is the load-bearing idea.** `CLAUDE.md` constraint #4 says the prompt and the parser must never drift apart. Today that is enforced by discipline. With a single `shared/worldVoice.ts` defining the contract, the JSON Schema handed to `output_config.format` and the type the frontend handler parses against are generated from one source. Drift becomes a build failure. This is the one structural change that converts a documented rule into a mechanical guarantee.
- **Structured outputs + the shared schema compound.** The schema isn't hand-maintained alongside a type; it is the type. That removes the failure mode where someone adds a field to the prompt and forgets the parser.
- **The official SDK over raw `fetch`** gives typed request/response objects, retry and timeout handling, and typed error classes — replacing three hand-rolled `fetch` calls that don't even check `response.ok`.
- **Porting in dependency order** (static data → backend routes → shared contract → UI) means each layer is verifiable before the next depends on it, and the riskiest step (the ~655-line `App()` teardown) happens last, against a backend already proven to work.
- **Keeping the legacy file** during the port respects `design-decisions-log.md`'s statement that the code is the source of truth for current behavior. It is the parity oracle; it gets deleted only once the app is confirmed playable.

---

## Alternatives Considered

| Approach | Strengths | Tradeoffs | Decision |
|---|---|---|---|
| **TS monorepo, full port, structured outputs** (recommended) | Contract drift becomes a compile error; backend self-testable; matches the plan's scaffold | Largest single session; TS adds porting overhead to working JS | **Chosen** |
| Verbatim JS port, prompt-instructed JSON | Fastest; least chance of introducing bugs during the move; exactly matches `MIGRATION-PLAN.md`'s tree | Leaves contract drift and JSON parse failures as live runtime risks; no type safety heading into multiplayer | Rejected — the contract is the thing most worth hardening |
| Vertical slice (`determineUniqueSkill` only) first | Lowest risk per session; developer feels it sooner | Three sessions to reach playable; scaffold churn repeated | Rejected by developer (scope = full) |
| Scaffold-only, stubs | Cleanest review surface | Delivers nothing playable | Rejected by developer |
| Single container (backend serves built frontend) | One image, simplest deploy | Couples frontend rebuild to backend; awkward for Vite HMR during by-feel iteration | Rejected for dev; worth revisiting as a production build target |
| Move saves server-side now | Solves the per-device limitation noted in the log | `CLAUDE.md` constraint #2 calls this a deliberate architecture change to plan for, not swap in casually; multiplayer is explicitly a later phase | Deferred |
| Rewrite inline styles to Tailwind/CSS modules | Cuts a large share of the line count; easier to maintain | Highest-risk possible change to UI tuned by feel, bundled into an already-large migration | Deferred (OQ-3) |

---

## Feature Scope

### MVP — this migration

**Scaffold & tooling**
- [ ] `frontend/` Vite + React + TS; `backend/` Node + Express + TS; `shared/` TS package
- [ ] `docker-compose.yml` running both; one `Dockerfile` per service
- [ ] `.env.example` with empty `ANTHROPIC_API_KEY=`; real `.env` gitignored; setup docs instruct `chmod 600 .env`
- [ ] Move the four markdown docs into `docs/` so `CLAUDE.md`'s own references resolve
- [ ] Root `README.md`: setup, `docker compose up`, key configuration

**Backend**
- [ ] `@anthropic-ai/sdk` client; key read from `process.env.ANTHROPIC_API_KEY` **once at startup, fail-fast with a clear error if absent**
- [ ] Key never in logs, never in error responses or stack traces, never in the frontend bundle
- [ ] `buildSystemBlocks()` ported verbatim — `WORLD_SYSTEM_PROMPT` uncached, `WORLD_LORE` with `cache_control: {type:"ephemeral"}`
- [ ] `POST /api/unique-skill` → `determineUniqueSkill` (Sonnet 5, **no system blocks** — preserve exactly)
- [ ] `POST /api/world-engine` → `callWorldEngine` (Opus 5, system blocks, per decision 4)
- [ ] `POST /api/intro-scene` → `generateIntroScene` (Opus 5, system blocks, per OQ-1)
- [ ] `max_tokens` raised from 2000 → 16000 (constraint #5 is a floor; raising is aligned with it)
- [ ] `output_config.format` carrying the JSON Schema generated from `shared/`
- [ ] Real error handling: check status, typed SDK error classes, structured error responses — replacing the current "no `response.ok` check" pattern
- [ ] Log `usage.cache_creation_input_tokens` / `cache_read_input_tokens` per call (this is how step 7 of the plan finally gets verified)

**Shared contract**
- [ ] `shared/worldVoice.ts` — `narration`, `state_updates.{skill_mastery_changes, new_skills_granted, skill_evolutions, unique_sub_ability_unlocked, world_events}`, `narrative_memory_updates.{new_entities, note}`, `gm_note`. Field names **exactly** as in `CLAUDE.md` constraint #4.
- [ ] JSON Schema derived from those types, consumed by the backend; the same types consumed by the frontend handler
- [ ] Game-state types: `GameState`, `Character`, `Skill`, `NarrativeMemory`, `SaveSlot`

**Frontend**
- [ ] Static data into `src/data/`: `worldSystemPrompt.ts`, `worldLore.ts`, `races.ts`, `questions.ts` — verbatim (system prompt and lore live backend-side; the frontend needs `RACES`/`QUESTIONS`)
- [ ] Components extracted: `SkillCard`, `SoulCodex`, `WorldLog`, `ActionBar`, and the five phase screens
- [ ] `lib/api.ts` — calls the backend, never Anthropic
- [ ] `lib/saves.ts` — the four localStorage helpers, **same key names** (`sbc-save-index`, `sbc-save:<id>`) so existing saves still load; add a `schemaVersion` field going forward
- [ ] All game logic in `handleAction` ported intact: mastery, tiers, Soul Rewrite, sub-ability emergence at 25/60/100, `usage_notes` accumulation, the 40-note memory cap, the 80-entry log cap

**Constraint preservation (explicit checklist — these are `CLAUDE.md` hard constraints)**
- [ ] No `window.confirm` / `alert` / `prompt`; keep tap-to-arm → inline Confirm/Cancel
- [ ] `min-height: 0` on every flex ancestor of a scroll region; no Fragment used as a flex/scroll container
- [ ] World Voice JSON contract field names unchanged
- [ ] `max_tokens` ≥ 2000 on all three calls
- [ ] MUST NOT rule list in `WORLD_SYSTEM_PROMPT` unchanged (additions fine, removals need confirmation)
- [ ] `WORLD_LORE` = facts, `WORLD_SYSTEM_PROMPT` = behavior; not merged
- [ ] `determineUniqueSkill` stays lore-blind (and, as found, system-blind)

**Bugs found during research — fix as part of the port**
- [ ] Line 1348: `const isMobile = window.innerWidth < 700` computed during render with no resize listener → replace with a `matchMedia` subscription or CSS media queries
- [ ] Google Fonts `@import` inside a `<style>` tag re-injected on every render, in 6 places → one `<link>` in `index.html` or self-hosted fonts
- [ ] No `response.ok` check before `.json()` on all three calls → handled by the SDK port + explicit error handling

**Verification**
- [ ] `docker compose up` → app loads
- [ ] Full playthrough in-sandbox: race select → questionnaire → Unique Skill → intro scene → several World Engine turns
- [ ] Save, reload the page, load the save, confirm state restored
- [ ] Confirm `cache_read_input_tokens > 0` from the second World Engine call onward
- [ ] Contract test: a fixture response parses cleanly against the shared type; a malformed one fails loudly

### Later (explicitly not this phase)
- [ ] Streaming narration for perceived latency
- [ ] Server-side saves / accounts (prerequisite for multiplayer)
- [ ] Postgres authoritative world state
- [ ] CSP headers, LLM-output sanitization pass, dependency audit (the hardening plan in `PROJECT-BACKGROUND.md`)
- [ ] Rate limiting / abuse protection if an instance is ever exposed beyond localhost
- [ ] Styling system reconsideration (OQ-3)
- [ ] Race-select grid: 9 races in a 2-column layout leaves an uneven final row (cosmetic, known, logged)
- [ ] Local inference cluster, fine-tuning

---

## Experience / Workflow

Player flow is unchanged from the artifact:

```
Title (+ save browser inline)
  → Race select (9 races)
  → Questionnaire (5 open-ended questions, Back/Continue)
  → [POST /api/unique-skill]  → Unique Skill revealed
  → [POST /api/intro-scene]   → opening scene
  → Simulation loop:
       player types action
         → [POST /api/world-engine]
         → narration + state_updates applied
         → autosave to localStorage
       (Soul Codex sidebar; two-tab World/Codex below 700px)
```

Developer flow after migration:

```
cp .env.example .env && chmod 600 .env   # paste key
docker compose up
→ frontend on :5173, backend on :3001
→ iterate by feel; Claude Code can now drive the whole loop itself
```

The last line is the meaningful capability change: `design-decisions-log.md` records that the artifact sandbox could reach `api.anthropic.com` but had no credential, so live testing always required the developer to run it and relay results. With a backend holding a real key, that round-trip disappears.

---

## Technical Direction

```
soulbound/
├── CLAUDE.md
├── README.md
├── docker-compose.yml
├── .env.example                  # ANTHROPIC_API_KEY=   (real .env gitignored)
├── docs/
│   ├── PROJECT-BACKGROUND.md
│   ├── MIGRATION-PLAN.md
│   └── design-decisions-log.md
├── legacy/
│   └── souldbound-world.jsx      # parity reference; deleted once playable
├── shared/
│   └── src/
│       ├── worldVoice.ts         # THE contract — types + derived JSON Schema
│       └── gameState.ts
├── backend/                      # Node + Express + TypeScript
│   ├── src/
│   │   ├── server.ts             # fail-fast key check at startup
│   │   ├── anthropic.ts          # SDK client + buildSystemBlocks() + usage logging
│   │   ├── data/{worldSystemPrompt,worldLore}.ts
│   │   └── routes/{uniqueSkill,worldEngine,introScene}.ts
│   └── Dockerfile
└── frontend/                     # Vite + React + TypeScript
    ├── src/
    │   ├── App.tsx
    │   ├── data/{races,questions}.ts
    │   ├── components/{SkillCard,SoulCodex,WorldLog,ActionBar}.tsx
    │   ├── components/screens/{Title,RaceSelect,Questionnaire,Loading,Simulation}.tsx
    │   └── lib/{api,saves}.ts
    └── Dockerfile
```

**Auth (already resolved in `MIGRATION-PLAN.md`, restated for completeness):** backend-held key via `.env`, single-tenant self-host. The key never reaches the browser bundle or any client-side fetch. `docker-compose.yml` passes it through as `ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}`. Backend reads it once at startup and fails fast with a clear message if absent — not three calls deep into gameplay. Rejected alternatives (baked-in key; paste-per-session BYOK) are documented there. No separate decision was needed this session.

**Model configuration**

| Route | Model | System blocks | Cached |
|---|---|---|---|
| `/api/unique-skill` | `claude-sonnet-5` | none (preserve) | n/a |
| `/api/world-engine` | `claude-opus-5` | `buildSystemBlocks()` | yes |
| `/api/intro-scene` | `claude-opus-5` | `buildSystemBlocks()` | yes — shares the loop's cache |

Models belong in one `config.ts` constant block, not scattered across three route files — the migration's whole premise is that three call sites drifting apart is the recurring failure mode here.

**Anthropic call shape**
- Official `@anthropic-ai/sdk`, not raw `fetch`
- `max_tokens: 16000` (non-streaming; constraint #5's floor of 2000 respected)
- `output_config: { format: { ...schema from shared/ } }`
- No assistant prefill (400 on both models; the artifact doesn't use it, so nothing to remove)
- No `budget_tokens` (400 on both models); Opus 5 thinking is adaptive-on by default, tuned via `output_config.effort` — start at the default and measure `medium`
- Log `usage.{cache_creation_input_tokens, cache_read_input_tokens, input_tokens, output_tokens}` on every call

**Testing:** Vitest both sides. Minimum bar — a contract test that parses a fixture World Engine response against the shared type and fails loudly on a malformed one, plus save/load round-trip tests. Full-playthrough verification is manual-in-sandbox for this phase.

**Orchestration plan for the build** (per the developer's ask: Opus 5 orchestrates, Sonnet/Haiku do the work)

| Wave | Work | Agent |
|---|---|---|
| 0 | Scaffold, Docker, `.env`, docs move | Opus 5 (orchestrator) |
| 1 | `shared/` contract types + JSON Schema | Opus 5 — highest-leverage, everything depends on it |
| 1 | Verbatim static-data extraction (`WORLD_SYSTEM_PROMPT`, `WORLD_LORE`, `RACES`, `QUESTIONS`) | Haiku 4.5 — mechanical copy, verify byte-identical |
| 2 | Backend SDK client, three routes, error handling, usage logging | Sonnet 5 |
| 3 | UI component extraction (`SkillCard`, `SoulCodex`, `WorldLog`, `ActionBar`, 5 screens) | Sonnet 5, parallel per component |
| 3 | `lib/saves.ts` + `lib/api.ts` | Sonnet 5 |
| 4 | `App.tsx` state/handler port — mastery, Soul Rewrite, sub-ability emergence | **Opus 5 directly** — densest game logic, highest regression risk |
| 5 | End-to-end run, cache verification, doc updates | Opus 5 |

Waves 1–3 parallelize cleanly. Wave 4 does not — it is the part where a silently dropped behavior costs the most, and it is the reason the developer's "one coherent change per session" rule matters most here.

---

## Known Discrepancies (found this session)

1. **`CLAUDE.md` references `docs/PROJECT-BACKGROUND.md`, `docs/design-decisions-log.md`, `docs/MIGRATION-PLAN.md`; all three are at repo root.** Fixed by the scaffold's `docs/` move — no `CLAUDE.md` edit needed.
2. **`CLAUDE.md` marks auth an "OPEN DECISION — resolve before scaffolding a backend"; `MIGRATION-PLAN.md` resolves it** (backend-held key via `.env`, with both alternatives and their rejection rationale documented). `CLAUDE.md` is stale on this point and should be updated to point at the resolution rather than re-open it every session.
3. **Filename typo:** `souldbound-world.jsx` (not `soulbound-`). Both `CLAUDE.md` and `PROJECT-BACKGROUND.md` refer to it as `soulbound-world.jsx`. Resolves itself when the file moves to `legacy/` and is eventually deleted.
4. **`design-decisions-log.md` says `determineUniqueSkill` was "NOT given access to `WORLD_LORE`."** It in fact passes no `system` parameter at all, so it also receives no `WORLD_SYSTEM_PROMPT`. The intent (cheap, focused, soul-reading only) is preserved either way, but the log understates it. Worth a one-line correction.

---

## Open Questions

- **OQ-1 — Does `generateIntroScene` move to Opus 5 too?** ✅ **RESOLVED 2026-09-17: yes.** Intro scene runs on `claude-opus-5`, sharing the Opus 5 cache namespace with the World Engine and warming its `WORLD_LORE` cache. `determineUniqueSkill` stays on `claude-sonnet-5`.
- **OQ-2 — `effort` setting on the Opus 5 World Engine loop.** Default is `high` with thinking on. `medium` may hold quality at meaningfully lower cost on the per-turn hot path. Resolution path: ship at the default, log token usage per turn, measure `medium` against real play. Deferred — needs live data, not a decision now.
- **OQ-3 — Inline styles: port verbatim, or move to a styling system?** Porting verbatim is recommended for this migration (lowest regression risk on UI tuned by feel), with a system reconsidered as a separate, isolated change. Deferred by default.
- **OQ-4 — Does the World Voice behave identically on Opus 5?** The log's adversarial testing was validated on Sonnet 5 and its conclusion explicitly notes that prompt resilience is partly a property of the model. `determineUniqueSkill` — the tested surface — stays on Sonnet 5, so that validation holds. World Engine tone and rule adherence on Opus 5 should be observed in the first real playthrough rather than assumed. Resolution path: play it.
- **OQ-5 — Delete `legacy/souldbound-world.jsx` at the end of this migration, or keep it?** Recommend keeping through the migration as the parity oracle, deleting once a full playthrough is confirmed, since git history preserves it regardless.

---

## Start Input

Migrate The Soulbound Chronicles from a 1,440-line single-file React artifact (`souldbound-world.jsx`) into a Dockerized TypeScript monorepo: `frontend/` (Vite + React + TS), `backend/` (Node + Express + TS + official `@anthropic-ai/sdk`), and `shared/` holding the World Voice JSON contract as types plus a derived JSON Schema, so prompt/parser drift becomes a compile error instead of a runtime failure.

The backend holds the Anthropic API key via `.env` (single-tenant self-host; resolved in `MIGRATION-PLAN.md`), reads it once at startup with fail-fast validation, and exposes three routes mirroring the artifact's call functions: `/api/unique-skill` (Sonnet 5, no system blocks — preserve exactly), `/api/world-engine` and `/api/intro-scene` (both Opus 5 — a deliberate reversal of the logged all-Sonnet decision; sharing one cache namespace so intro scene warms the loop). All three use `output_config.format` structured outputs against the shared schema, `max_tokens: 16000`, `buildSystemBlocks()` with `cache_control: ephemeral` on `WORLD_LORE`, and per-call usage logging to finally verify prompt caching engages.

Port order: static data → shared contract → backend routes → UI components → `App.tsx` game logic → end-to-end run. Static data (`WORLD_SYSTEM_PROMPT`, `WORLD_LORE`, `RACES`, `QUESTIONS`) copies verbatim. `localStorage` save keys stay byte-identical (`sbc-save-index`, `sbc-save:<id>`) so existing saves load. Three bugs fix as part of the port: `window.innerWidth` computed during render with no resize listener (line 1348), per-render Google Fonts `@import` in six places, and missing `response.ok` checks on all three API calls.

All seven `CLAUDE.md` hard constraints are preserved and tracked as an explicit checklist. Decision 4 (Opus 5 on the World Engine) reverses a logged decision and requires updating `CLAUDE.md` and `design-decisions-log.md` in the same change. Out of scope: multiplayer, Postgres, server-side saves, styling system changes, any lore or balance change.

Orchestration: Opus 5 owns the shared contract and the `App.tsx` game-logic port (highest regression risk); Sonnet 5 handles backend routes and UI component extraction in parallel; Haiku 4.5 handles verbatim static-data extraction.
