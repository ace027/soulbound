# CLAUDE.md — The Soulbound Chronicles

## What this project is
"The Soulbound Chronicles" is a Tensura-inspired (*Tensei Shitara Slime Datta Ken*) text RPG set in an original fantasy world, **Vaeltharion**. It began as a single-file React artifact in Claude.ai (`soulbound-world.jsx`), where Claude itself acts as the in-game "World Voice" — an AI game master narrating an entire world, called via direct Anthropic API requests from the browser. This repo is the migration of that artifact into a real app: proper frontend/backend split, Docker, and a path toward persistent shared-world multiplayer.

Read these before doing substantial work:
- `docs/PROJECT-BACKGROUND.md` — full project vision, current state, long-term roadmap
- `docs/design-decisions-log.md` — **why** systems work the way they do. Read before touching skill tiers, mastery thresholds, Soul Rewrite, sub-ability emergence, the save system, or questionnaire design. These are deliberate tradeoffs from real iteration (including adversarial prompt testing), not oversights.
- `docs/MIGRATION-PLAN.md` — the plan for moving from artifact → Dockerized app, and the record of decisions already settled (auth is settled — don't re-open it)

## Working style for this project
The developer iterates **by feel**: they test in the running app, describe what feels wrong in plain language, and want you to diagnose root cause and fix it directly — not run a long design discussion before every change. Keep change summaries concise. Put deep rationale in `docs/design-decisions-log.md`, not repeated at length in chat/PR descriptions.

Before making any change:
1. View the actual current source files first. Don't assume a prior conversation summary (including this one) still reflects the code — it may have been edited since.
2. Check `docs/design-decisions-log.md` for any system you're about to touch. If a requested "fix" would reverse a logged decision, **flag that explicitly before proceeding** rather than silently reverting it.
3. Make one coherent change per session/commit. Don't generate multiple parallel versions of the same file unless explicitly asked.

## Hard constraints — do not violate without flagging first

1. **No `window.confirm` / `window.alert` / `window.prompt`.** These silently failed to render in the artifact's sandboxed iframe, so the project standardized on in-UI confirm state instead (tap to arm → inline Confirm/Cancel → tap Confirm). Keep using that pattern for any destructive action (deleting a save, overwriting a slot, etc.), even though a real browser context would technically support native dialogs — consistency and the existing UI pattern matter more here than the native API being available again.

2. **Saves use `localStorage`, not the artifact's `window.storage` API.** `window.storage` is a Claude-artifact-only persistence API that doesn't exist in a normal deployed app anyway — don't reintroduce anything resembling it. `window.storage` was tried first for saves and abandoned because it didn't reliably persist across reload; `localStorage` (synchronous calls) is the proven, working mechanism. As this becomes a real backend-connected app, saves may eventually move server-side (see multiplayer notes in PROJECT-BACKGROUND.md) — but that's a deliberate architecture change to plan for, not something to casually swap in.
   **That plan now exists (decided 2026-09-24, not yet built):** in the planned **hosted mode** (Phase 7), saves live server-side per account behind an adapter that keeps `App.tsx` byte-identical. **Self-host mode keeps `localStorage` exactly as above.** Until Phase 7 ships, this constraint applies unchanged everywhere. See `docs/design-decisions-log.md` → "Hosted mode (2026-09-24)".

3. **Flexbox scroll regions**: any scrollable panel needs `min-height: 0` on *every* flex ancestor in its chain, or content overflows the container instead of scrolling (flex children default to `min-height: auto` — a real, non-obvious CSS trap that caused a real bug here once). Never rely on a React Fragment (`<>...</>`) to act as a flex/scroll container — wrap shared sub-components needing their own scroll behavior in an actual `<div>`.

4. **Preserve the World Voice JSON response contract exactly** when editing the system prompt or any of the three API call functions (unique-skill determination, the live world engine loop, intro scene generation). The frontend parses these field names:
   - `narration`
   - `state_updates.skill_mastery_changes`
   - `state_updates.new_skills_granted`
   - `state_updates.skill_evolutions`
   - `state_updates.unique_sub_ability_unlocked`
   - `state_updates.world_events`
   - `narrative_memory_updates.new_entities`
   - `narrative_memory_updates.note`
   - `gm_note`

   If a field must be renamed or restructured, update the corresponding frontend handler in the *same* change — never let the prompt and the parser drift apart.

5. **`max_tokens` ≥ 2000** on all three World Voice–adjacent API calls. This was raised from an original 1000 after real JSON truncation errors in production use. Don't lower it.

6. **The "MUST NOT" rule list inside the system prompt is load-bearing for game balance.** It currently includes: no Ultimate Skills outside the one defined Sevreth-encounter path; never honor a player's direct request for a skill; Plundering never works unless the player's actual Unique Skill grants it; Extra Skills require the prerequisite Common Skill at 80+ mastery; Soul Rewrite is a rare narrative climax, never on request or as a combat/mastery reward; certain Sovereign ambiguities (e.g., Ithren's dual nature) must never resolve, even after the fact. Treat *additions* to this list as cheap insurance. Treat *removals or softenings* as requiring explicit confirmation from the developer, not silent adjustment.

7. **World lore facts live in `WORLD_LORE`; behavioral/reveal constraints live in `WORLD_SYSTEM_PROMPT`'s MUST NOT list.** This split was deliberate (lore = static reference material, cacheable; behavior = rules, kept together with other narration rules) — don't merge them back together or split reveal constraints out into the lore block.

8. **`determineUniqueSkill()` is deliberately system-blind** — it sends **no `system` parameter at all**: not `WORLD_LORE`, not `WORLD_SYSTEM_PROMPT`, no system blocks of any kind. `backend/src/routes/uniqueSkill.ts` passes `useSystem: false`, and `backend/src/anthropic.ts` applies it as a conditional spread that omits the key entirely rather than sending `system: undefined` — a materially different request shape, pinned by `backend/src/__tests__/anthropic.test.ts` asserting `'system' in request === false`. Its job is soul-reading from questionnaire answers, not world-consistency, and sending it neither block keeps that call cheap, focused, and byte-identical to the prompt that survived the Tier 0 adversarial tests. This was an explicit choice, not an oversight — don't "fix" it by giving it *any* system access without confirming first. (Strengthened from "lore-blind" in the Phase 4 review, with the developer's approval: the old wording forbade only lore, so attaching `WORLD_SYSTEM_PROMPT` alone would have read as compliant while changing the validated prompt.)

## Model & API pattern
- **Models are split — this is deliberate, and the split is load-bearing.**
  - `claude-opus-5` on unique-skill determination (`/api/unique-skill`), at `effort: 'medium'`
  - `claude-sonnet-5` on the world engine loop AND intro scene generation, both at `effort: 'high'`
  Defined in one place, `backend/src/config.ts`'s `MODELS` — never as a literal at a call site.
  **World-engine and intro-scene MUST stay on the same model as each other** — they are the
  only two routes that send system blocks, so they share one cache namespace. Prompt caches are
  model-scoped, so moving only one of them silently strands the other's cache warmth. WHICH model
  the pair shares is a cost/quality choice; THAT they share one is the invariant, and it is pinned
  by a test in `backend/src/__tests__/config.test.ts`. Measured
  twice: 2026-09-17 the intro-scene call read back the exact 15,132 tokens the world-engine call
  wrote, and 2026-09-18 the same shared namespace was observed in the reverse direction at
  **15,490** (intro-scene wrote; every subsequent world-engine call read it — five of them, across
  two sessions, in `.planning/phases/04-parity-verification/evidence/usage-lines.log`). **Quote
  15,523; 15,522, 15,490 and 15,132 are superseded.** The 15,490 was measured live on 2026-09-18
  and then invalidated the same day by the narration-length edit to `WORLD_SYSTEM_PROMPT`;
  re-derived free with `count_tokens`, system-only went 13,669 -> 13,701, projecting ~15,522 —
  which two live runs on 2026-09-19 then confirmed at **15,523**, one token off the free
  derivation (`.planning/experiments/2026-09-19-sonnet-split/` and
  `.planning/experiments/2026-09-19-cache-ttl-break/`). Re-derive rather than re-measure. The
  number moves whenever
  `WORLD_SYSTEM_PROMPT` or `WORLD_LORE` changes — re-derive it with `count_tokens`, which is free.
  The property, not the number, is what this constraint protects.
  `determineUniqueSkill` is independent of that pair: it sends no system blocks at all, so it has
  no cached prefix and nothing to share with anything (see #8). Its model and effort move freely.
  It runs Opus 5 at `medium` — one short soul-read from five questionnaire answers, not
  rule-adherence over a 15k-token prompt.
  ⚠️ **This arrangement has reversed twice, each time deliberately.** It began all-Sonnet, moved to
  Opus on the two system-block routes (2026-09-17), and moved to Sonnet on that pair with Opus on
  unique-skill (2026-09-18) — the developer's call each time, made with the prior reversal in view.
  Do not "correct" it back to an earlier arrangement. The rationale for each move is in
  `docs/design-decisions-log.md`.
- `WORLD_SYSTEM_PROMPT` and `WORLD_LORE` are both static per playthrough (and across playthroughs) and are sent as separate `system` blocks via a shared `buildSystemBlocks()` helper, with `cache_control: { type: "ephemeral" }` on the `WORLD_LORE` block, so their token cost is paid once via prompt caching rather than on every call.
- Verify caching is actually engaging (`cache_creation_input_tokens` / `cache_read_input_tokens` in the API response) once this is running in a real environment with visibility into raw responses — this was previously hard to verify from inside an artifact.

## Auth architecture — RESOLVED, do not re-litigate
Inside the Claude.ai artifact, calls to `api.anthropic.com` were authenticated automatically by the platform — that doesn't exist in a normal deployed app. **Resolved: a backend proxy holding the deployer's own Anthropic API key**, read from the `ANTHROPIC_API_KEY` environment variable at startup (`backend/src/config.ts`), which `docker compose` populates from `.env` — a host-run backend needs the variable exported or `--env-file` passed, since nothing loads `.env` into the Node process itself. The key never reaches the browser bundle or any client-side `fetch()`. The backend is built and shipped on this model — don't re-open the question.
- Usage runs on **Anthropic Console credits**. A Claude Max subscription does *not* include API access; a proxy converting API-key requests into OAuth calls against Max was raised and declined.
- Deployment shape is **single-tenant self-hosting**: one deployer, one container, their own key, on their own trusted machine. So a self-hosting deployer does bring their own key — via `.env`, not via the UI.
- **Paste-per-session BYOK** (session-only, in-memory, as in the artifact) is the documented *rejected* alternative, not a fallback to reach for. It assumes an untrusted host, which doesn't match this deployment shape.

Published images (Phase 5) add a **deployer-set access gate**: every `/api/*` route except `/api/health` requires `Authorization: Bearer <SOULBOUND_PASSPHRASE>`, behind a per-client rate limit (`backend/src/accessGate.ts`). This is access control on the proxy, not a re-opening of the decision above — the key architecture is unchanged, and the backend still holds the deployer's key from `.env`. It is **not** the rejected BYOK: the passphrase is issued by the deployer, and players never hold an Anthropic key. See `docs/design-decisions-log.md` → "Access gate for published images (2026-09-23)".

**Hosted mode replaces that passphrase gate with a session gate (Phase 6, built 2026-09-24).** With `SOULBOUND_MODE=hosted`, `buildApp()` mounts `backend/src/hostedGate.ts`'s session gate behind a pinned 15-step middleware order. The steps are the Host allow-list, anti-framing, the per-IP limiter, the reserved webhook slot, the Origin check, invite redeem, Better Auth, the session gate and the per-user limiter, and each position is pinned by `backend/src/__tests__/hosted/hostedOrder.test.ts` plus `scripts/mutate-order.sh`. A hosted 401 is `SIGN_IN_REQUIRED` (never `PASSPHRASE_REQUIRED`), and hosted `/api/access` answers carry `Soulbound-Mode: hosted`. `selfhost` (the default) is frozen: its pre-Phase-6 tests stay unedited, and `selfhostNoPg.test.ts` proves it never loads a hosted package. Don't move a step, or edit a self-host test, to make a hosted change fit — flag it instead. Deploy: `render.yaml` plus `docs/runbooks/phase-6-hosted-setup.md`. See `docs/design-decisions-log.md` → "Hosted mode — Phase 6 build (2026-09-24)".

**Hosted mode (decided 2026-09-24, Phases 6-13, not yet built)** deliberately widens the single-tenant scope above. It adds a second mode alongside the unchanged self-host one: player accounts (Better Auth), server saves, and a Stripe subscription with a monthly turn allowance. **The key architecture is still unchanged:** the backend holds the operator's key, players never see it, and BYOK stays rejected. This is the one deliberate re-opening of this section, made by the developer with the reversal named. Don't widen it further (e.g. to per-player keys) without asking. See `.planning/explorations/2026-09-24-hosted-multiplayer-saas-design.md` and the design log.

See `docs/MIGRATION-PLAN.md` for the full decision and all three rejected options.

## Current functional scope (as of migration)
Character creation (race select → open-ended questionnaire → Unique Skill generation → intro scene), a live simulation loop, the full skill tier system (Intrinsic/Common/Extra/Unique/Ultimate) with mastery tracking and emergent sub-abilities at 25/60/100, Soul Rewrite, a persistent narrative-memory system (entity ledger + rolling notes) to prevent NPC/history drift, and a mobile-responsive two-tab layout with a Soul Codex sidebar. Full detail in `docs/PROJECT-BACKGROUND.md`.
