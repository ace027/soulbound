# CLAUDE.md — The Soulbound Chronicles

## What this project is
"The Soulbound Chronicles" is a Tensura-inspired (*Tensei Shitara Slime Datta Ken*) text RPG set in an original fantasy world, **Vaeltharion**. It began as a single-file React artifact in Claude.ai (`soulbound-world.jsx`), where Claude itself acts as the in-game "World Voice" — an AI game master narrating an entire world, called via direct Anthropic API requests from the browser. This repo is the migration of that artifact into a real app: proper frontend/backend split, Docker, and a path toward persistent shared-world multiplayer.

Read these before doing substantial work:
- `docs/PROJECT-BACKGROUND.md` — full project vision, current state, long-term roadmap
- `docs/design-decisions-log.md` — **why** systems work the way they do. Read before touching skill tiers, mastery thresholds, Soul Rewrite, sub-ability emergence, the save system, or questionnaire design. These are deliberate tradeoffs from real iteration (including adversarial prompt testing), not oversights.
- `docs/MIGRATION-PLAN.md` — the plan and open decisions for moving from artifact → Dockerized app

## Working style for this project
The developer iterates **by feel**: they test in the running app, describe what feels wrong in plain language, and want you to diagnose root cause and fix it directly — not run a long design discussion before every change. Keep change summaries concise. Put deep rationale in `docs/design-decisions-log.md`, not repeated at length in chat/PR descriptions.

Before making any change:
1. View the actual current source files first. Don't assume a prior conversation summary (including this one) still reflects the code — it may have been edited since.
2. Check `docs/design-decisions-log.md` for any system you're about to touch. If a requested "fix" would reverse a logged decision, **flag that explicitly before proceeding** rather than silently reverting it.
3. Make one coherent change per session/commit. Don't generate multiple parallel versions of the same file unless explicitly asked.

## Hard constraints — do not violate without flagging first

1. **No `window.confirm` / `window.alert` / `window.prompt`.** These silently failed to render in the artifact's sandboxed iframe, so the project standardized on in-UI confirm state instead (tap to arm → inline Confirm/Cancel → tap Confirm). Keep using that pattern for any destructive action (deleting a save, overwriting a slot, etc.), even though a real browser context would technically support native dialogs — consistency and the existing UI pattern matter more here than the native API being available again.

2. **Saves use `localStorage`, not the artifact's `window.storage` API.** `window.storage` is a Claude-artifact-only persistence API that doesn't exist in a normal deployed app anyway — don't reintroduce anything resembling it. `window.storage` was tried first for saves and abandoned because it didn't reliably persist across reload; `localStorage` (synchronous calls) is the proven, working mechanism. As this becomes a real backend-connected app, saves may eventually move server-side (see multiplayer notes in PROJECT-BACKGROUND.md) — but that's a deliberate architecture change to plan for, not something to casually swap in.

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

8. **`determineUniqueSkill()` is deliberately lore-blind** — it does not receive `WORLD_LORE`. Its job is soul-reading from questionnaire answers, not world-consistency, and this keeps that call cheap and focused. This was an explicit choice, not an oversight — don't "fix" it by adding lore access without confirming first.

## Model & API pattern
- Model: `claude-sonnet-5`, used identically across all three call sites (unique-skill determination, world engine loop, intro scene generation).
- `WORLD_SYSTEM_PROMPT` and `WORLD_LORE` are both static per playthrough (and across playthroughs) and are sent as separate `system` blocks via a shared `buildSystemBlocks()` helper, with `cache_control: { type: "ephemeral" }` on the `WORLD_LORE` block, so their token cost is paid once via prompt caching rather than on every call.
- Verify caching is actually engaging (`cache_creation_input_tokens` / `cache_read_input_tokens` in the API response) once this is running in a real environment with visibility into raw responses — this was previously hard to verify from inside an artifact.

## Auth architecture — OPEN DECISION, resolve before scaffolding a backend
Inside the Claude.ai artifact, calls to `api.anthropic.com` were authenticated automatically by the platform — that doesn't exist in a normal deployed app. Before writing backend code, confirm with the developer which model applies:
- **Backend proxy holding the developer's own API key** — simplest, developer pays for usage, no per-user key handling.
- **True BYOK (bring your own key)** — user supplies their own key per session; backend proxies the request through and does not persist the key (matches the "session-only, in-memory" approach already used in the artifact version).

Do not default silently to one of these. If it's still unresolved when a session starts, ask. See `docs/MIGRATION-PLAN.md` for more detail.

## Current functional scope (as of migration)
Character creation (race select → open-ended questionnaire → Unique Skill generation → intro scene), a live simulation loop, the full skill tier system (Intrinsic/Common/Extra/Unique/Ultimate) with mastery tracking and emergent sub-abilities at 25/60/100, Soul Rewrite, a persistent narrative-memory system (entity ledger + rolling notes) to prevent NPC/history drift, and a mobile-responsive two-tab layout with a Soul Codex sidebar. Full detail in `docs/PROJECT-BACKGROUND.md`.
