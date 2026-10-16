# Phase 15: World Map & Character Stats -- Context

## Phase Goal
The player always knows where they are in Vaeltharion and what condition they are in, and both respond to the story. The World Voice reports changes through new required-nullable contract fields; the frontend enforces the limits and owns stable place IDs. Design: .planning/explorations/2026-10-16-world-map-and-stats-design.md (Approach B).

## Requirements Covered
- R37: World map and character stats. HP/MP/SP plus STR/AGI/INT/WIL, race baselines, rare narrator growth, HP 0 leads to a narrative setback (never death), a schematic six-kingdom map with discovered places, save schema v2 with a migration, and five MUST NOT additions.

## What Already Exists (from prior phases)
- shared/src/worldVoice.ts: strict zod contract (WorldEventSchema 106-111, StateUpdatesSchema 116-122, WorldVoiceResponseSchema 145-151, WORLD_VOICE_JSON_SCHEMA 187, CONTRACT_FIELD_NAMES 211-217).
- shared/src/gameState.ts: GameState interface 108-115, race types 28-38, SAVE_SCHEMA_VERSION = 1 at 168.
- backend/src/routes/worldEngine.ts: GameStateRequestSchema 121-143, renderWorldEnginePrompt 178 (per-turn block, uncached).
- backend/src/data/worldSystemPrompt.ts: MUST NOT list 97-108 (11 bullets, floor pinned by prompts.test.ts 360-374), response format 110-133.
- backend/src/routes/introScene.ts:107 inlines a four-key scene_set example pinned by prompts.test.ts 376-395 and byte-exact fixtures 141-175.
- frontend/src/game/applyWorldUpdate.ts: applyWorldUpdate 84-88, scene_set handling 194-198. frontend/src/lib/saves.ts: loadSave 83 with backfill, writeSave 114, no versioned migration. App.tsx: initial state 251-256, restore backfill 188-192.
- frontend/src/data/races.ts: nine race entries {id, name, desc, intrinsic}.
- SimulationScreen.tsx: mobile tabs World/Codex (104), desktop 240px Soul Codex sidebar. SkillCard mastery bar is the meter pattern.

## Key Design Decisions
- Approach B from the design doc; developer decisions 1-10 there are binding.
- Plans run strictly in sequence (contract+backend -> frontend state -> UI -> verification) so each plan leaves every workspace green. Plan 1 adds the contract and backend side with all new request fields OPTIONAL, so older clients keep working until plan 2 sends them; the parser consumes the new fields in plan 2 within the same phase build.
- Kingdoms: Kaldrath, Verdance, Ashenveil, Aurelis, Tidemark, Sundrach, plus 'unknown'. WORLD_LORE is unchanged; the map layout is a frontend asset.
- Board quick-assess (2026-10-16, 6.2/10, no red flags) adopted as constraints: accessibility/contrast criteria in the UI plan; v1->v2 round-trip migration tests with field-level equality; clamp telemetry (every clamp recorded as raw vs applied); explicit behaviour for nulls, out-of-range values and unknown place_id; 'rare' growth defined numerically (target at most 1 accepted stat_growth per 25 turns; a 200-turn seeded invariant test offline).
- Board recommendations declined, recorded in the design log by plan 4: a canonical place list in WORLD_LORE (that is the rejected Approach C and would change the cached lore); a 200+ turn LIVE run (cost; replaced by the offline 200-turn invariant test plus a 20-turn live smoke run).
- Open questions resolved: Human Grit stays narrative in v1; MP/SP at 0 is narrative-only in v1 (the narrator portrays exhaustion, the game blocks nothing); hosted metering unaffected.
- Guard rails: per-turn change capped at ceil(40% of that pool's max); values clamped to 0..max; HP 0 without a setback floors at 1; a setback that lands at HP 0 restores HP to ceil(25% of max_hp); at most one stat_growth per turn, pools +1..+5, attributes exactly +1, attribute ceiling 20, a milestone grants once (normalised text match against growthLog).

## Plan Structure
- **Plan 15-01 (Wave 1)**: Contract, request caps and World Voice rules -- Add the stats and place fields to the World Voice JSON contract, accept and cap the new state in the world-engine request, render it in the per-turn block, and teach WORLD_SYSTEM_PROMPT the rules plus five MUST NOT additions, with the cached-prefix token count re-derived.
- **Plan 15-02 (Wave 2)**: Game state, save v2 migration and guard rails -- Give GameState condition, attributes, places, currentPlaceId and growthLog; seed them from race baselines; migrate v1 saves to v2; and apply the World Voice's stat, growth, setback and place updates through clamped, capped guard rails with clamp telemetry.
- **Plan 15-03 (Wave 3)**: Condition strip, kingdom map and mobile Map tab -- Show HP/MP/SP and attributes in the Soul Codex, a schematic six-kingdom map with discovered places and a you-are-here marker, a third mobile Map tab and compact meters above the ActionBar, all accessible.
- **Plan 15-04 (Wave 4)**: Adversarial re-run, live smoke run and design log -- Prove against the live model that the narrator emits deltas, keeps growth rare, never kills the character, never honours stat requests and reuses place IDs; record the evidence and the phase's decisions.
