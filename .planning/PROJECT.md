# The Soulbound Chronicles

## What This Is
A Tensura-inspired text RPG set in the original fantasy world of Vaeltharion, where Claude acts as "The World Voice" — an AI game master narrating an entire living world. The game was built and iterated as a single-file React artifact inside Claude.ai (`souldbound-world.jsx`, 1,440 lines). This project is its migration into a real, independently-runnable, Dockerized application: a TypeScript monorepo with a proper frontend/backend split, a backend that holds the Anthropic API key, and the World Voice JSON contract enforced as a shared compile-time type.

## Core Value
Removes the artifact's three hard ceilings at once — it had no auth of its own, no file structure an agent could navigate safely, and no way for Claude to self-test — while changing zero game behavior the developer didn't explicitly ask to change. The result is an app the developer can start with `docker compose up`, iterate on by feel, and have Claude Code exercise end-to-end without manually relaying results.

## Who It's For
Initially the developer and their playtester. Then self-hosting deployers who supply their own Anthropic API key (single-tenant, one deployer per container). Eventually public web players during the validation phase.

## Requirements

### Validated
(None yet — ship to validate)

### Active

**Foundation**
- **R1** — TypeScript monorepo: `frontend/` (Vite + React), `backend/` (Node + Express), `shared/`; one Dockerfile per service; `docker compose up` runs both
- **R2** — Backend holds `ANTHROPIC_API_KEY` via `.env`; read once at startup with fail-fast validation; never in logs, error responses, stack traces, or the frontend bundle
- **R3** — `shared/` defines the World Voice JSON contract as TS types plus a derived JSON Schema, consumed by backend and frontend, so prompt/parser drift becomes a compile error
- **R8** — Static data ported verbatim: `WORLD_SYSTEM_PROMPT`, `WORLD_LORE`, `RACES`, `QUESTIONS`

**Backend / World Voice**
- **R4** — Three routes mirroring the artifact's call functions (`/api/unique-skill`, `/api/world-engine`, `/api/intro-scene`) via the official `@anthropic-ai/sdk`, with real status checking and typed error handling
- **R5** — Structured outputs (`output_config.format`) on all three routes, schema generated from `shared/`
- **R6** — Model split, centralized in one config module: `claude-sonnet-5` on unique-skill; `claude-opus-5` on world-engine and intro-scene
- **R7** — Prompt caching preserved (`buildSystemBlocks()`, `cache_control: ephemeral` on `WORLD_LORE`); per-call usage logging to finally verify cache engagement

**Frontend**
- **R9** — Components and five phase screens ported with behavior intact: `SkillCard`, `SoulCodex`, `WorldLog`, `ActionBar`, title/race/questionnaire/loading/simulation
- **R10** — Game logic ported intact: mastery, skill tiers, Soul Rewrite, sub-ability emergence at 25/60/100, `usage_notes` accumulation, 40-note memory cap, 80-entry log cap
- **R11** — `localStorage` saves with byte-identical key names (`sbc-save-index`, `sbc-save:<id>`) so existing saves load; add a `schemaVersion` field going forward
- **R12** — Fix three bugs found during research: `window.innerWidth` computed during render with no resize listener (legacy line 1348); Google Fonts `@import` re-injected per render in six places; missing `response.ok` checks on all three calls

**Verification**
- **R13** — All eight `CLAUDE.md` hard constraints preserved, tracked as an explicit checklist
- **R14** — End-to-end playthrough verified in-sandbox; `cache_read_input_tokens > 0` confirmed from the second World Engine call onward
- **R16** — Vitest contract test (fixture parses against the shared type, malformed fails loudly) and save/load round-trip tests
- **R15** — `docs/` move so `CLAUDE.md`'s own references resolve; `CLAUDE.md` and `design-decisions-log.md` updated in the same change that makes the model split

### Out of Scope
- Multiplayer, Postgres authoritative world state, server-side saves, user accounts
- Monetization; local inference cluster; fine-tuning (LoRA/QLoRA)
- Streaming narration
- Any styling-system change (inline styles port verbatim)
- Any lore, balance, or `WORLD_SYSTEM_PROMPT` MUST NOT list change
- CSP headers / output-sanitization hardening pass; rate limiting
- Race-select grid cosmetic fix (9 races leave an uneven final row in a 2-column layout)

## Constraints

**`CLAUDE.md` hard constraints — do not violate without flagging first**
1. No `window.confirm` / `alert` / `prompt`; destructive actions use tap-to-arm → inline Confirm/Cancel
2. Saves use `localStorage`, never anything resembling the artifact's `window.storage` API
3. Scrollable panels need `min-height: 0` on every flex ancestor; never use a Fragment as a flex/scroll container
4. World Voice JSON response contract field names preserved exactly; prompt and parser never drift apart
5. `max_tokens` >= 2000 on all three World Voice calls
6. The MUST NOT rule list in `WORLD_SYSTEM_PROMPT` is load-bearing for balance — additions are cheap, removals need explicit confirmation
7. Lore facts live in `WORLD_LORE`, behavioral/reveal constraints in `WORLD_SYSTEM_PROMPT` — do not merge
8. `determineUniqueSkill()` is deliberately lore-blind (in fact it sends no `system` param at all — preserve this)

**API constraints**
- Assistant prefill returns HTTP 400 on Sonnet 5 and Opus 5 (the artifact uses none — keep it that way)
- `budget_tokens` returns 400 on both models; Opus 5 thinking is adaptive-on by default, tuned via `output_config.effort`
- Prompt caches are model-scoped — the two Opus 5 routes share one namespace, unique-skill has none
- Model ID strings are complete as-is; never append date suffixes

**Working style**
- Developer iterates by feel: test in the running app, describe what feels wrong, expect root-cause diagnosis and a direct fix — not a design discussion per change
- One coherent change per session/commit; no parallel versions of the same file
- Deep rationale goes in `design-decisions-log.md`, not chat or PR descriptions

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Design source: `.planning/explorations/2026-09-17-soulbound-artifact-to-app-design.md` | Research pass over the artifact, docs, and current API behavior before any code | Committed as `e56f400` |
| Full migration to playable, not scaffold or vertical slice | Backend now holds a real key, so Claude Code can self-test end-to-end — a capability the artifact phase never had | `MIGRATION-PLAN.md` steps 2–7 in one pass |
| TypeScript both sides | Makes `CLAUDE.md` constraint #4 mechanical rather than a matter of discipline | `shared/worldVoice.ts` is the single contract source |
| Structured outputs via `output_config.format` | Kills the JSON truncation/parse-failure class that drove `max_tokens` 1000→2000; field names unchanged | Schema derived from the shared types |
| Opus 5 on `callWorldEngine` **and** `generateIntroScene` | ⚠️ Reverses the logged all-Sonnet decision. Developer chose it deliberately after the reversal was flagged. Intro scene joins Opus 5 so it warms the loop's cache instead of stranding a write in the Sonnet namespace | `CLAUDE.md` + `design-decisions-log.md` must be updated in the same change (R15) |
| `determineUniqueSkill` stays on Sonnet 5 | Its prompt is the adversarially-validated surface, and it sends no system blocks so it has no cache to share | Unchanged from the artifact |
| `max_tokens` 2000 → 16000 | Constraint #5 is a floor; raising is aligned with it and with current non-streaming guidance | Applied to all three routes |
| Legacy artifact retained during the port | `design-decisions-log.md` treats the code as source of truth for current behavior — it is the parity oracle | `legacy/souldbound-world.jsx`, deleted once playable |
| Codebase map generated 2026-09-18 | Deferred through Phases 1-3 because the legacy file dominated the tree; run once the migration landed, as planned | `.planning/CODEBASE.md` + `.planning/codebase/` at commit `8a9f165`. Refresh after Phase 4 deletes `legacy/` |
| Workflow: Autonomous / Standard depth / Balanced cost | Matches the developer's stated by-feel working style; deep analysis already lives in the exploration doc | Opus 5 orchestrates; Sonnet 5 and Haiku 4.5 do delegated work |

## Architecture Influences

The artifact is a single 1,440-line file with exactly one import and one default export. There is no existing scaffold to extend — the app is built around this file's logic from scratch.

The recurring failure mode in this codebase's history is **drift between the three API call sites**, not any single one being wrong: a previously-fixed bug had `generateIntroScene` concatenating the system prompt into the user message, so it never benefited from caching. The structural answer is one shared contract module and one centralized model/config block, rather than three routes maintained in parallel.

The riskiest work is not the backend — it is mechanically restructuring the ~655-line `App()` component and its hundreds of inline style objects without silently dropping a behavior tuned by feel. Static data and the three call functions port near-verbatim; the UI is where regressions hide. That work is sequenced last, against a backend already proven to work, and is handled by Opus 5 directly rather than delegated.

Long-term direction (explicitly not this phase): persistent shared-world multiplayer on an authoritative Postgres world-state server, a 2D/3D layer over the text engine, and a local inference cluster. The `shared/` contract and the frontend/backend split are the first structural steps toward that.

---
*Last updated: 2026-09-17 after initialization*
