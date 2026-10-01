# Design Exploration — The Prologue Prototype

## Initial Ask
Replace (as an experiment) the five-question soul questionnaire with a short **test scene**: the player is put into a threshold situation before rebirth, their behaviour in it determines their Unique Skill, and only then are they dropped into the world. Raised by the developer after a review of the questionnaire's weaknesses (blank-page problem, abstract questions, no behavioural signal, a skill that players don't know how to use).

## Research Summary
**Facts** (each checked in this repo or by a measured run)
- `Character.answers` is `QuestionnaireAnswers = Record<string, string>` (`shared/src/gameState.ts`). The only consumer is the world engine, which renders five fixed keys (`nature`, `drive`, `flaw`, `memory`, `bond`) as the "UNIQUE SKILL SOUL PROFILE" on every turn (`backend/src/routes/worldEngine.ts`). The intro-scene route does not read the answers.
- `POST /api/unique-skill` reads the five answers, is system-blind (CLAUDE.md #8) and is the prompt that survived the Tier 0 adversarial tests.
- The world-engine route rejects a game state without exactly one Unique-tier skill, so a prologue cannot run on it.
- `App.tsx`'s `handleQuestionnaireComplete(answers)` takes an answers object and nothing else from the questionnaire. `QuestionnaireScreen` is handed `onComplete`, `onReturnToTitle`, `answers` and `setAnswers`.
- Paper test (`.planning/experiments/2026-10-01-prologue-test/`, $0.371): a scene told apart a self-flattering player from a selfless one when identical questionnaire answers could not; for the other cases the two matched. The questionnaire handled thin input (`idk`) well.
- Follow-up (same folder, $0.170): distilling the scene transcript into the five answer keys and running the **unchanged** unique-skill prompt kept that separation. The Liar's skill came out as "Hollow Oath" again.
- `UNTRUSTED_TAGS` already includes `player_action`. `callWorldVoice` is the one module every model call passes through; its `WorldVoiceRoute` union and `EFFORT` record are keyed by route.

**Inferences**
- A prologue can be built without touching `App.tsx`, the unique-skill route, the world-engine route or the World Voice contract, if the scene ends by producing a five-key `answers` object.
- A narrator call with a ~300-token prompt and no system blocks costs far less than a world-engine turn; the earlier "$0.3 per character" estimate was too high. Not yet isolated by measurement.

**Assumptions** (to be tested)
- Four typed actions feel easier and more engaging than five written answers.
- Players will not mind that the world reacts to them in a scene they cannot replay.

## Product Definition
- **Target users:** the developer and their playtester, behind an opt-in flag. Not general players yet.
- **Primary outcome:** learn whether a behaviour-based beginning is worth building for real, from a hands-on comparison against the questionnaire.
- **Value proposition (to test):** no blank page, learn the action loop before the world, and a Unique Skill earned by what you did rather than what you wrote.
- **Non-goals:** replacing the questionnaire for everyone; changing the unique-skill, world-engine or intro-scene prompts or routes; per-player generated scenes; multiple scenes; metering or billing; saving mid-prologue; any change to the World Voice contract's field names.

## Recommended Approach (B: reactive scene, existing pipeline)
A fixed four-beat scene narrated reactively by a small route, then a second call distils the transcript into the five `answers` keys, which feed the existing, unchanged unique-skill and intro-scene pipeline. Opt-in via a URL flag; the questionnaire remains the default.

Why: it is the smallest build that actually tests the experience hypothesis (reactivity), and it leaves the validated, adversarially tested prompt and every downstream route untouched.

## Alternatives Considered
| Approach | Strengths | Tradeoffs | Decision |
|----------|-----------|-----------|----------|
| A. Scripted scene, no narrator | Cheapest, deterministic | World does not react, so it cannot test the feeling of consequence | Rejected |
| **B. Reactive scene + distil into answers** | Smallest real test; validated path untouched | Extra lossy step; scene props leak into skills and profile | **Chosen** |
| C. Transcript straight into a new determination route, replace questionnaire for all | Skills can cite specific moments | Reopens the validated prompt (Tier 0 rerun), contract, config pins, hosted metering, saves; a phase on its own | Deferred; revisit if B wins |

Decisions already made by the developer: opt-in flag with the questionnaire as default; one fixed authored scene; behaviour only (no questions kept); success is the playtester preferring it; whether the scene becomes canon is decided after seeing real profiles.

## Feature Scope
### MVP
- [ ] `POST /api/prologue/beat`: stateless; takes name, race name and the history so far, returns the next narration (beats 1-3 end on pressure, beat 4 closes the scene).
- [ ] `POST /api/prologue/profile`: takes the finished transcript, returns the five `answers` keys written from behaviour only. Accepts `canon: 'scene' | 'traits'` (default `scene`) so the open canon question can be answered by comparing real profiles.
- [ ] `PrologueScreen` (frontend): fixed opening text, four action turns with a visible "reading..." state, "← Return to title", ends by calling `onComplete(profile)`.
- [ ] A branch in `QuestionnaireScreen` that renders `PrologueScreen` only when the flag is on; flag off renders exactly the current DOM.
- [ ] `lib/prologueFlag.ts`: `?prologue=1` in the URL (no stored state, no UI).
- [ ] Shared Zod schemas for both routes, outside `WORLD_VOICE_JSON_SCHEMA`.
- [ ] Tests: route validation and wrapping, the narrator sends no `system` key, schema parse failures fail loudly; screen flag-off equals today, flag-on completes with five keys, return-to-title clears state, API error is shown inline.
- [ ] Adversarial check before any tester sees it: action text that tries to name a skill, claims omniscience, or injects instructions must not produce a literal grant (the Tier 0 cases, adapted to scene actions).
- [ ] Live check with usage logging: measured cost per character (narrator ×4 + profile), recorded.

### Later (only if the playtest favours it)
- [ ] Decide canon vs traits-only and delete the switch.
- [ ] Tune the scene: the memory-loss cost showed up in two of four paper-test skills, so make the cost less reusable.
- [ ] Hosted-mode metering for the new routes (Phase 8) before any friend is invited.
- [ ] Replace, or add a title-screen choice for, the questionnaire; or approach C.

## Experience / Workflow
Title → race → name (unchanged) → with `?prologue=1`: the opening text appears; the player types an action, waits for the narration of its consequence, and repeats for four turns. The fourth beat closes the scene and the soul is "taken hold of". The loading screen then runs the existing "reads your soul" path: Unique Skill, intro scene, simulation. A normal URL shows the questionnaire exactly as today.

## Technical Direction
- **Backend:** one new router (`routes/prologue.ts`) with two POST routes, mounted beside the three game routers so it sits behind the existing gates in both modes. Both calls go through `callWorldVoice`. The narrator's instructions go in the user message with no `system` key, which keeps "only world-engine and intro-scene send system blocks" true and does not touch the cache namespace. All player text is wrapped with `wrapUntrusted` (`player_action`, `player_name`); client-supplied narration in the history is treated as untrusted too, because the client holds it.
- **Models and effort:** Sonnet 5.5 at `low` for both, as tested. Models live only in `config.ts`'s `MODELS`; effort only in `anthropic.ts`'s `EFFORT`.
- **Frontend:** `PrologueScreen.tsx`, `lib/prologueFlag.ts`, two functions in `lib/api.ts`. The profile is passed to the existing `onComplete`, so `App.tsx` should need no change (to be confirmed when built; if it does, the developer's consent is needed).
- **Contract:** two new schemas in `shared/`, not part of the World Voice response; constraint #4's field list is unchanged.
- **Persistence:** the prologue state lives in the component. A reload mid-prologue restarts it, as the questionnaire does today.
- **Limits:** history bounded (4 actions × the existing 2,000-character action limit; narration entries bounded); the body limit is already 512 kb.

## Open Questions
- **Adding keys to `MODELS` and `EFFORT` breaks existing pins.** `config.test.ts` asserts `MODELS` equals exactly three keys, and `EFFORT` is typed by the route union. Options: add `prologueBeat` and `prologueProfile` keys and update that one expectation (needs the developer's consent, since pre-Phase-6 tests are treated as frozen), or reuse existing keys' values. Recommendation: add keys, with consent. I have not checked which other tests pin `EFFORT`.
- **Canon vs traits-only** profile: decided after reading real profiles (the switch above).
- **Scene tuning:** reusable memory cost; what the narrator does with a "do nothing" player (the paper test's profile called that player passive and credited them with the small soul's death, which may feel harsh); and whether the ending should name any consequence beyond the crossing.
- **Playtest design:** how many sessions, and in which order players try the two paths. The recommendation is three sessions, each player doing both, order alternated.
- **Hosted cost exposure:** the new routes are not metered by Phase 8's creation allowance, which counts at `/api/unique-skill`. Fine while the flag is opt-in and hosted is developer-only; must be resolved before friends are invited.
- **Per-character cost** is unmeasured (see Inferences); the first live run records it.
- **Whether four typed actions feel easier than five answers** is the central unknown and can only be answered by players.

## Start Input
Add an opt-in "prologue" character-creation path to The Soulbound Chronicles behind `?prologue=1`, leaving the questionnaire as the default. A fixed four-beat threshold scene is narrated reactively by a new system-free route (`/api/prologue/beat`, Sonnet 5.5 low); a second route (`/api/prologue/profile`) distils the transcript into the five `answers` keys from behaviour only; the existing unique-skill (system-blind, unchanged), intro-scene and world-engine paths run as today. Frontend: `PrologueScreen`, a flag helper, and a flagged branch inside `QuestionnaireScreen`; no `App.tsx` change expected. Evidence: `.planning/experiments/2026-10-01-prologue-test/`. Constraints to respect: CLAUDE.md #1-#8, no edits to pre-Phase-6 tests without consent (notably the `MODELS` pin), `wrapUntrusted` on all player text. Success: the playtester prefers it over the questionnaire. Costs real API money in tests; get approval before live runs.
