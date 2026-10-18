# Design Exploration — Narrator Structure & Skill Validator

## Initial Ask
> I feel like the narrator has too much free reign. There should be some sort of structure and there should be a system that remembers actions, derives skills from the players actions, remember locations. Then there should be a skill validator. Whenever the narrator generates a new skill, it should go through the validator to make sure it's not too overpowered for the current world with the current skills active in the world.

## Research Summary

### Facts
- **The narrator's skill output is taken as-is.**
  - `frontend/src/game/applyWorldUpdate.ts` (~134-213) applies `new_skills_granted`, `skill_evolutions`, `skill_mastery_changes` and `unique_sub_ability_unlocked` exactly as the model emits them.
  - The only code-side checks are dedupe by name and the Soul Rewrite (Unique→Unique) path.
  - Nothing in code enforces tier, the Extra prerequisite (Common at 80+), the Ultimate path, the 25/60/100 sub-ability thresholds or the mastery range. Mastery is stored unclamped.
- **The balance rules are prompt-only.** They are the MUST NOT list in `backend/src/data/worldSystemPrompt.ts` (~104-120).
- **Phase 15 stats already have code guard rails** (delta caps, clamps, one growth per turn). That is the precedent for code overruling the model.
- **The narrator's memory is short:**
  - Only the last 5 actions are sent per turn (`backend/src/routes/worldEngine.ts:310`).
  - Narrative notes are capped at 40.
  - Entities are uncapped on the client, while the backend request schema caps them at 500 entities and 2,000-character notes (`worldEngine.ts:109-117`). A long game would 400 on every turn: a latent bug.
- **Places:** capped at 200, and the 40 most recent are sent each turn (Phase 15).
- **No power data:** skills have name, tier, description and mastery, and nothing describing power or cost.
- **No judge or validator** exists in code or docs, and none was ever considered and rejected.
- **No shared-world or multiplayer phase** is on the roadmap.
- **Constraints any new contract field must respect:**
  - Structured outputs fail with "compiled grammar is too large" when a schema has too many nullable unions, so new fields use non-null sentinels (design log, Phase 15).
  - World-engine and intro-scene are the only routes sending system blocks, and they must share a model.
  - The cached prefix (17,538 tokens) moves whenever `WORLD_SYSTEM_PROMPT` or `WORLD_LORE` changes.
  - `max_tokens` must be 2000 or more.
  - The MUST NOT list only grows.
  - The prompt and the parser change together.

### Inferences
- **The narrator is the only authority over skills,** so balance rests entirely on the prompt's wording. Stats show that code guard rails work without hurting the fiction.
- **A 5-action window can't support "derive skills from actions".** Derivation needs durable, compact action memory such as tallies, not a longer raw log.
- **Lore has no structured power bands.** The tier list is prose, so a judge rubric must be extracted from it or written fresh.

### Assumptions
- Skill grants and evolutions happen on roughly 1 in 5-10 turns. This needs measuring.
- A Sonnet 5.5 judge at `low` effort is consistent enough on a fixed rubric. This needs measuring with an adversarial set.

## Product Definition
- **Target users:** the developer and playtesters, single player, self-host and hosted.
- **Primary outcome:**
  - Skills feel earned and stay within the world's balance.
  - The narrator can't hand out skills from nothing or out of tier.
  - The world remembers what you've done.
- **Value proposition:** code holds the facts and checks every change, and the narrator writes prose within those bounds.
- **Non-goals:**
  - quest or story-thread tracking, act or chapter pacing (structure means rules plus memory only)
  - a cross-player or shared-world skill registry
  - judging the creation-time Unique Skill (`determineUniqueSkill` stays system-blind and unjudged, CLAUDE.md #8)
  - regenerating narration when a skill is downgraded

## Recommended Approach
**B: code rules plus a system-blind skill judge, run on the server inside `/api/world-engine`.**

1. **Shared rules module.** `shared/src/skillRules.ts` holds pure functions, and `applyWorldUpdate` stays the final gate. On every turn, at no cost, it:
   - clamps mastery to 0-100 with a per-turn delta cap;
   - checks the tier enum;
   - allows a Common skill only from an eligible action tag;
   - allows an Extra skill only when its prerequisite Common skill is at 80 or more;
   - allows an Ultimate only with a Sevreth-path flag;
   - unlocks sub-abilities only at 25, 60 or 100 and no higher than current mastery. Otherwise the unlock is deferred, not dropped;
   - passes Soul Rewrite through untouched.
2. **Action memory and derivation.**
   - Each turn the narrator returns `state_updates.action_tags`, a string array from a fixed enum of about 15-20 categories. An empty array means none.
   - Code keeps `actionTally` counts.
   - When a tag crosses a threshold, the per-turn user content (not the cached prefix) lists it as `ELIGIBLE_FOR_COMMON`.
   - A Common grant must carry `derived_from_tag`, or code rejects it.
3. **World skill registry (this playthrough).**
   - `state_updates.world_skills_observed[]` records `{holder, name, tier}` for NPC and monster skills.
   - These entries are code-checked only (tier enum, cap of about 150). Sovereign NPCs can legitimately hold high tiers.
   - The registry is seeded from the player's own skills.
4. **Skill judge.**
   - **When it runs:** only when `new_skills_granted` or `skill_evolutions` is non-empty, and before `/api/world-engine` replies. The client can't skip it.
   - **Config:** `MODELS.skillJudge` is Sonnet 5.5, `EFFORT.skillJudge` is `low`, and `max_tokens` is 2000 or more.
   - **No system blocks**, so the two-route cache invariant holds.
   - **Inputs:**
     - the proposal
     - the player's skills
     - the registry (up to about 60 entries, highest tier first)
     - the tier definitions, read as a substring of `WORLD_LORE` at runtime so lore isn't duplicated, pinned by a test
     - the tally evidence
   - **Output:** `{verdict: ok|downgrade, new_tier ('unchanged' sentinel), new_description, reason}`.
   - **On failure or timeout:** fall back to the code rules. Never block the turn.
5. **When a skill is downgraded:**
   - the lesser form is applied;
   - a story-log line says the skill "settled into a lesser form";
   - a `validator_note` goes into the next turn's content so the narrator follows the real state.
6. **Save v3.**
   - `migrateSave` v2→v3 adds `actionTally`, `derivationOffersUsed`, `skillRegistry` and `pendingSubAbilities`.
   - The client caps `actionHistory` (about 200), entities (500) and notes (2,000 characters), which fixes the latent 400.

## Alternatives Considered
| Approach | Strengths | Tradeoffs | Decision |
|---|---|---|---|
| A. Code rules only | Free, deterministic, fully unit-testable | No power judgement: "Erase Any Target" passes as a Common skill | Rejected; it is plan 1 of B |
| **B. Code rules + system-blind server judge** | Meets every decision; keeps the cache invariant and #8; judge model can be changed freely | Narration can disagree with the stored skill for one turn; judge sees a rubric, not full lore | **Chosen** |
| C. Judge before narration (two passes, cached judge) | Story and state never disagree; judge sees full lore | +5-10 s and two narrator calls on grant turns; **reverses CLAUDE.md's two-route system-block invariant**; biggest contract change | Deferred; upgrade path if B's mismatch lines feel bad in play |

## Feature Scope

### MVP
- [ ] `shared/src/skillRules.ts`: mastery clamp, tier, Extra prerequisite, Ultimate flag, deferred sub-abilities; applied in `applyWorldUpdate`
- [ ] Save v3 migration, plus client caps on history, entities and notes (fixes the latent 400)
- [ ] Contract: `action_tags`, `derived_from_tag`, `world_skills_observed`; the per-turn ELIGIBLE line; MUST NOT additions only; prompt and parser in one commit
- [ ] `judgeSkills()` in the world-engine route: `MODELS`/`EFFORT` entries, verdict schema with sentinels, fallback, a test asserting no `system` key and `max_tokens` ≥ 2000
- [ ] Downgrade log line, next-turn `validator_note`, deferred sub-abilities shown in the Codex
- [ ] Measurement:
  - a fixed set of about 20 adversarial proposals, judge verdicts scored
  - a live smoke run: judge latency, cost per grant turn, new cached-prefix size
  - written up under `.planning/experiments/`
- [ ] A design-log entry, plus the CLAUDE.md cached-prefix number updated

### Later
- [ ] Two-pass narration (approach C), if the mismatch log lines feel bad in play, with explicit approval for the invariant change
- [ ] Per-place action memory: notable actions per place, sent with the place cards
- [ ] Structured power bands in `WORLD_LORE`
- [ ] A shared-world registry, if multiplayer is ever planned

## Experience / Workflow
1. The player acts. The narrator responds with narration, state updates and `action_tags`.
2. Code tallies the tags. Once "stealth" reaches the threshold, the next turn's content tells the narrator a Common stealth skill may be offered.
3. The narrator grants "Shadowstep (Common)" with `derived_from_tag: stealth`. The backend runs the judge against the player's skills and the registry, and the verdict is ok.
4. The player gets Shadowstep, and it shows in the Codex as usual.
5. If the narrator instead grants "Void Erasure (Extra)" with no prerequisite:
   - the code rules downgrade it, or the judge returns a narrower form;
   - the log reads "Void Erasure settled into a lesser form: …";
   - next turn the narrator sees the real skill and follows it.
6. If a sub-ability arrives before its threshold, it waits as "pending" in the Codex and unlocks once mastery reaches it.

## Technical Direction
- **Rules:** pure functions in `shared/` (the Phase 15 guard-rail pattern), called from `applyWorldUpdate` (final gate) and by the backend before the judge.
- **Judge call:** goes through the `callWorldVoice` chokepoint in `backend/src/anthropic.ts` with `useSystem: false`, like the prologue routes.
- **Contract:** new fields are non-null sentinels (an empty array, `'unchanged'`), and the response schema grows. The cached prefix moves, so re-derive it with `count_tokens` and take one live read.
- **Save version:** `SAVE_SCHEMA_VERSION` 2 → 3, with migration tests from v0, v1 and v2.
- **Hosted mode:** a judge call does not count as an extra turn against the allowance.
- **Design-log note:** code overruling the narrator's skill output is new for skills, and the 25/60/100 thresholds move from model-side to code-side. Record both in `docs/design-decisions-log.md`.

## Open Questions
| Question | Resolution path |
|---|---|
| Action-tag enum (which 15-20 categories) and the per-tag threshold | Decide in `/triad:plan`, using race baselines and lore skill examples; tune after the playtest |
| How code knows the Sevreth Ultimate path was legitimately triggered | Plan 1: a code flag set by a narrow contract signal, reviewed against the MUST NOT wording |
| Judge consistency at `low` effort | Plan 5 adversarial set; raise effort if more than 2 of 20 verdicts are wrong |
| Tier-definition substring extraction from `WORLD_LORE` | Plan 3: pin it with a test so a lore edit can't silently break the rubric |
| Phase number and position relative to Phase 7 (hosted saves) | Decided when it is added to the roadmap; the v3 save migration must land before server saves copy the schema |

## Start Input
Add a phase, "Narrator Structure & Skill Validator", to the existing Soulbound roadmap.
- **Rules:** code rules in `shared/src/skillRules.ts` enforce the skill tiers, the Extra prerequisite, the Ultimate gate, the 25/60/100 sub-ability thresholds (deferred, not dropped) and mastery clamps in `applyWorldUpdate`.
- **Derivation:** the narrator tags each action (`action_tags`, a fixed enum). Code tallies the tags, and a Common skill may be granted only from a tag past its threshold (`derived_from_tag`).
- **Registry:** the playthrough's skill registry adds NPC and monster skills via `world_skills_observed`.
- **Judge:** a system-blind Sonnet 5.5 call at `low` effort inside `/api/world-engine` checks new skills and evolutions against the registry and the lore tier definitions. It downgrades instead of rejecting, adds a log line plus a next-turn `validator_note`, and falls back to the code rules on failure.
- **Save:** save v3 migration, plus client caps fixing the latent entity/notes 400.
- **Constraints:** MUST NOT additions only; prompt and parser change together; non-null sentinels; the two-route cache invariant is unchanged; re-derive the cached prefix afterwards.
- **Plans (5):** rules + save v3, contract + tags, judge route, downgrade UX, measurement.
- **Non-goals:** quests, pacing, a shared-world registry, judging the creation-time Unique Skill, regenerating narration.
