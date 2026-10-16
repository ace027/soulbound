# Design Exploration — World Map and Character Stats

## Initial Ask
"I would like to add a map that tells the player where they are in the world. And add stats like HP, MP, SP, etc." (developer, 2026-10-16)

## Research Summary

### Facts
- `GameState` (`shared/src/gameState.ts:108-115`) is `character`, `skills`, `location` (free-text string), `currentScene`, `actionHistory`, `narrativeMemory`. It has no HP, MP, SP, attributes, region or coordinates. `Skill` carries mastery only.
- Every contract object is `z.strictObject` (`shared/src/worldVoice.ts`). New fields must be required-and-nullable, and the schema, prompt and parser must change together (CLAUDE.md #4).
- `state_updates.world_events` fields are all nullable. Only `scene_set` is consumed: it sets `location` and `currentScene` (`frontend/src/game/applyWorldUpdate.ts:194-199`). The prompt asks for `scene_set` "whenever the player's location or framing situation changes" (`backend/src/data/worldSystemPrompt.ts:137`).
- The backend validates the incoming `gameState` with zod (`backend/src/routes/worldEngine.ts:138`, location ≤ 400 chars). New state fields need request-schema caps there.
- The per-turn "CURRENT CHARACTER STATE" block (`worldEngine.ts:183`) is in the user message, outside the cached `WORLD_SYSTEM_PROMPT` + `WORLD_LORE` prefix (~15,523 tokens).
- Saves: localStorage `sbc-save:<id>`, `SAVE_SCHEMA_VERSION = 1`. `frontend/src/lib/saves.ts:83-105` backfills missing fields on load; there is no versioned migration.
- The prompt has no rules on HP, mana, stamina, death, defeat or travel. Human Grit (`backend/src/data/races.ts:7`) mentions "1 HP" as narrative text only.
- Narrative-memory entities are `{name, description}` with no type, so there is no location type.
- `WORLD_LORE` (`backend/src/data/worldLore.ts:51-61`) names six kingdoms, each tied to a Sovereign. Space is relational only ("Kaldrath sits atop Vaheris"; "Tidemark is a crossing point"). It names no settlements, directions or distances.
- The intro scene chooses a start "somewhere in the world that fits their nature" via `scene_set` (`backend/src/data/introScene.ts:105-107`), with a fallback of "The Crossroads of Vaeltharion" (`App.tsx:254`).
- The design log's only number rules are randomized mastery gains of 3-8 and "not just that a number went up". No rule forbids numeric stats.
- UI:
  - Desktop: a 240px Soul Codex sidebar plus WorldLog/ActionBar (`frontend/src/screens/SimulationScreen.tsx:152-167`).
  - Mobile (< 700px): two hard-coded tabs, World and Codex (`SimulationScreen.tsx:104-120`).
  - The SkillCard mastery bar (`frontend/src/components/SkillCard.tsx:38-45`) is a reusable meter pattern.
  - Styles are inline; there are no SVG or image assets.
- `ROADMAP.md` Phase 12 (Condition & Inventory, R34) requires a design pass on "defeat semantics … what the World Voice may change".

### Inferences
- A map needs stable place identity. Free-text locations fragment ("Ashfall Gate" vs "the gates of Ashfall") unless the game owns the IDs.
- The lore supports a schematic six-kingdom map, not a geographic one, unless new canon is authored.
- Per-turn stats can travel in the uncached per-turn block, so the only cache cost is one prefix invalidation when the new rules land.
- This design takes over the defeat-semantics part of Phase 12's design pass.

### Assumptions
- The narrator can reliably emit numeric deltas when the prompt asks for them on harm, exertion and casting. This is verified live in the last plan.
- A 240px sidebar is too narrow for a readable map, so the map needs its own surface.

## Product Definition
- **Target users:** players of the self-hosted and hosted game (desktop and mobile).
- **Primary outcome:** the player always knows where they are in Vaeltharion and what condition they are in, and both respond to what happens in the story.
- **Value proposition:** consequences become visible and stick. A fight leaves you wounded, a spell drains you, and the map grows as you explore. The game stays narration-first: the World Voice decides, and the game enforces the limits.
- **Non-goals:**
  - dice, formulas or a rules engine;
  - permadeath;
  - inventory and items (they stay in Phase 12);
  - authored towns or geographic coordinates;
  - travel times;
  - status effects;
  - stats that gate or grant skills.

## Recommended Approach
**Approach B — Balanced: narrator-reported stats with game-side guard rails, and a schematic kingdom map with game-owned place IDs.** Run it as a new phase **before Phase 7**, so the save format moves to v2 once, before server saves exist.

### Developer decisions (2026-10-16)
1. **Stat control:** the World Voice reports changes in a new contract field. The frontend clamps them and caps the change per turn.
2. **HP 0:** a narrative setback (captured, woke elsewhere, lost something, rescued). Never death, and the save never ends.
3. **Map:** a region map of the six kingdoms plus discovered places, pinned inside their kingdom as the player visits them.
4. **Phase slot:** a separate new phase. Phase 12 keeps inventory and items.
5. **Stats:** HP, MP and SP (stamina), plus attributes STR, AGI, INT and WIL.
6. **Maximums:** a race baseline, raised rarely by the narrator at real milestones, under a MUST NOT cap.
7. **Recovery:** narrator-driven (rest, healing, meals), with the same guard rails as damage.
8. **Attributes:** sent each turn as context and weighed by the narrator when it narrates outcomes. No dice, no formulas.
9. **Attribute growth:** a rare +1 narrator grant at real milestones, never on request.
10. **Approach and slot:** Approach B, run before Phase 7.

## Alternatives Considered

| Approach | Strengths | Tradeoffs | Decision |
|---|---|---|---|
| A — Conservative: HP/MP/SP meters plus a kingdom tag on `scene_set`; places keyed by normalised name; no attributes or growth | ~3 plans; smallest contract change | Place names fragment; leaves out decisions 5, 6 and 9 | Rejected |
| B — Balanced (below) | Covers all nine decisions; game-owned place IDs; proven patterns (strict nullable fields, per-turn block outside the cache, frontend clamps); one cache invalidation | ~5 plans; first versioned save migration; takes over part of Phase 12's defeat pass | **Chosen** |
| C — Authored atlas: towns and directions in `WORLD_LORE`, SVG map with coordinates, closed place list, travel and status effects | Most stable IDs; most map-like | Large lore authoring; limits the narrator's freedom to invent places; bigger cache change; deeper overlap with Phase 12; 8+ plans | Rejected |

## Feature Scope

### MVP
- [ ] Contract fields (required-nullable, prompt and parser in one change):
  - `state_updates.condition_changes`: `{hp_delta, mp_delta, sp_delta: int|null, reason: string|null}`
  - `state_updates.stat_growth`: `[{stat: "max_hp"|"max_mp"|"max_sp"|"STR"|"AGI"|"INT"|"WIL", amount: int, milestone: string}]`
  - `state_updates.setback`: `{kind: "captured"|"woke_elsewhere"|"lost_something"|"rescued", summary: string} | null`
  - on `world_events.scene_set`: `kingdom` (one of the six kingdoms, `"unknown"` or null) and `place_id` (string or null)
- [ ] `GameState` additions, with request-schema caps in `worldEngine.ts`:
  - `condition {hp, mp, sp, max_hp, max_mp, max_sp}`
  - `attributes {STR, AGI, INT, WIL}`
  - `places: Record<id, {name, kingdom, firstSeenTurn}>`
  - `currentPlaceId`
  - `growthLog`
- [ ] A race baseline table (pools and attributes) in `races.ts`.
- [ ] Guard rails in `applyWorldUpdate`:
  - clamp current values to 0..max;
  - cap the change per turn (draft: ±40% of max);
  - at most one `stat_growth` per turn, at most +5 to a pool and +1 to an attribute;
  - a soft attribute ceiling (draft: 20);
  - a milestone may grant growth only once (checked against `growthLog`);
  - HP 0 without a `setback` is floored at 1 and logged.
- [ ] Place IDs:
  - The per-turn block lists known places (`{id, name, kingdom}`, capped at about 40).
  - The narrator must reuse a listed `place_id` when the player returns somewhere, or send null for a new place.
  - The frontend mints new IDs as `slug(name)-kingdom` and de-duplicates them.
- [ ] Kingdom layout as a frontend asset (`frontend/src/data/kingdomLayout.ts`: six fixed nodes plus adjacency drawn from the relational lore). `WORLD_LORE` is unchanged. Places sit in a grid inside their kingdom in discovery order.
- [ ] Save schema v2: `migrateV1toV2` in `saves.ts` derives the baselines from the race, seeds the current location as an `unknown`-kingdom place, and starts an empty growth log.
- [ ] The per-turn state block carries condition, attributes, the current place and known places.
- [ ] Prompt rules: emit `condition_changes` whenever harm, exertion or casting happens; emit `kingdom` and `place_id` with every `scene_set`. Re-derive the cached-prefix token count with `count_tokens` and update the CLAUDE.md figure.
- [ ] MUST NOT additions (draft wording):
  - "MUST NOT raise any maximum or attribute because the player asks, trains repetitively, or wins a routine fight. `stat_growth` is for real milestones only, at most one per turn, and rare across a playthrough."
  - "MUST NOT kill the player character. HP reaching 0 MUST produce a setback (capture, waking elsewhere, loss, rescue), never death or a game end."
  - "MUST NOT treat stats or attributes as a path to skills. Stat growth never grants, evolves or unlocks a skill, sub-ability or Soul Rewrite, and a Soul Rewrite never resets or rewrites stats."
  - "MUST NOT invent kingdoms. `kingdom` is one of the six or `unknown`, and a place the player returns to MUST reuse its listed `place_id`."
  - "MUST NOT let attributes override narrative judgment or the skill tier rules. They inform outcomes and never guarantee them."
- [ ] UI:
  - Desktop: a Condition strip at the top of the Soul Codex (three meters reusing the SkillCard track, plus a four-cell attribute row). A Map button opens a map overlay over the WorldLog.
  - Mobile: a third tab (World / Codex / Map), and compact HP/MP/SP meters pinned above the ActionBar.
  - CLAUDE.md #3 applies: `min-height: 0` on every flex ancestor, and a real `div` wrapper.
- [ ] Re-run the adversarial turn tests, plus a live run (about 20 turns) that checks deltas actually move, growth stays rare and HP 0 leads to a setback.

### Later
- [ ] Inventory and items (Phase 12, R34).
- [ ] Status effects (poisoned, exhausted).
- [ ] Authored towns and an atlas map (Approach C), if the schematic map feels thin.
- [ ] MP or SP at 0 blocking skill use mechanically.
- [ ] Making Human Grit mechanical, which needs an in-game day clock.
- [ ] The prologue seeding attributes from how the player behaves.

## Experience / Workflow
1. At character creation, the race sets the starting HP/MP/SP maximums and attributes, and the intro scene sets the first place and kingdom.
2. Each turn, the player sees the narration, and the bars move when something happens ("−12 HP: the ogre's club glances off your ribs").
3. Going somewhere new pins it inside its kingdom on the map. Coming back moves the "you are here" marker to the existing pin.
4. At a real milestone the narrator may grant growth ("+1 WIL: you held your ground before the Sovereign's gaze"). This is rare and never happens on request.
5. At HP 0 the story continues through a setback: the player wakes captured, elsewhere, short of something, or rescued.
6. Rest, healing and meals recover the bars as the narrator describes them.

## Technical Direction
- **Contract first:** the zod schemas in `shared/` (strict, required-nullable), the request schema caps in `worldEngine.ts`, the prompt and the frontend parser all change in one plan (CLAUDE.md #4).
- **Lore and behaviour split:** no new lore. Kingdom positions are presentation (a frontend asset), and the new rules go in `WORLD_SYSTEM_PROMPT`'s MUST NOT list (#6, #7).
- **Cache:** per-turn data goes in the uncached user-message block. Changing the prompt invalidates the ~15.5k-token prefix once. World-engine and intro-scene stay on the same model.
- **Limits:** `max_tokens` stays ≥ 2000 (#5). The extra output is a few tokens per turn.
- **Saves:** this is the first real versioned migration (v1 → v2). Phase 7's server-save import then handles only v2.
- **Tests:**
  - clamp, cap and growth-limit unit tests;
  - migration tests on old fixture saves;
  - contract round-trip tests;
  - the adversarial turn suite re-run;
  - a live verification run.
- **Rough plan breakdown (about 5):**
  1. Contract, shared schemas and request schema.
  2. State, migration and guard rails, with tests.
  3. Prompt rules, MUST NOT additions, the per-turn block and `count_tokens`.
  4. UI: meters, attributes, the map and the mobile tab.
  5. Adversarial re-run and live verification.

## Open Questions
1. **Race baselines and caps** (pool sizes, per-turn change cap, attribute ceiling). *Resolution:* draft a table in plan 2, then run about 20 live turns per race and adjust.
2. **Human Grit: mechanical or narrative?** There is no in-game day clock. *Resolution:* keep it narrative for v1 and record that in the design log.
3. **Can MP or SP at 0 block skill use?** *Resolution:* decide in plan 3. The leaning is narrative-only for v1.
4. **Hosted metering:** do stats affect turn counting or the Phase 8 ledger? *Resolution:* check against the Phase 8 design when that phase is planned. Expected answer: no.
5. **Setback kinds vs Phase 12:** `lost_something` overlaps future item loss. *Resolution:* Phase 12's design pass extends the enum, and Phase 12's success criteria are updated to say defeat semantics come from this phase.
6. **Prologue seeding attributes:** *Resolution:* defer until the prologue canon decision (Phase 14).

## Start Input
New phase **"World Map & Character Stats"**, to run **before Phase 7** as a side-track like Phase 14. Approach B:
- The World Voice reports HP/MP/SP changes, rare milestone growth of maximums and attributes (STR/AGI/INT/WIL), and setbacks at HP 0 (never death), through new required-nullable contract fields.
- The frontend clamps and caps all of these and owns stable place IDs.
- A schematic six-kingdom map shows discovered places and a "you are here" marker. The layout is a frontend asset, and `WORLD_LORE` is unchanged.
- Save schema moves to v2 with a migration.
- Five MUST NOT additions.
- UI: desktop Codex strip plus a map overlay; mobile third tab plus meters above the ActionBar.
- About 5 plans.
- Update Phase 12 so its defeat semantics come from this phase; it keeps inventory and items (R34).
