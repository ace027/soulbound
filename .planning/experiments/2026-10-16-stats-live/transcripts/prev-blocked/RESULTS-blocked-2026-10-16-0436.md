# Phase 15 live verification (2026-10-16): BLOCKED by the API, not run

**Verdict: the Phase 15 World Voice contract cannot be sent to the live API. Every `/api/world-engine` and `/api/intro-scene` call returns HTTP 502 `UPSTREAM_ERROR`. The live checks in this plan could not run, so none of the seven adversarial cases nor the 20-turn smoke criteria has a verdict. This is a ship blocker for Phase 15, found by the live run and invisible to the offline tests (they mock the model).**

Spend: $0.1507 (the skill-scope suite) plus a few cents of 30-token probes. Cap was $3.

## 1. Root cause

Upstream rejects the request before generating anything:

```
400 invalid_request_error: The compiled grammar is too large, which would cause performance issues.
Simplify your tool schemas or reduce the number of strict tools.
```

`callWorldVoice` sends `output_config.format = zodOutputFormat(WorldVoiceResponseSchema)` (backend/src/anthropic.ts:498). The schema grew in plan 15-01 by `condition_changes`, `stat_growth`, `setback` (on `state_updates`) and `kingdom`, `place_id` (on `world_events`). Each addition alone compiles. Together they pass the grammar size limit.

Bisect (`transcripts/grammar-bisect.mjs`, output `transcripts/grammar-bisect-output.txt`). Each variant is a real API call with a 30-token prompt, `claude-sonnet-5-5`, `effort: low`:

| Variant of the schema | Result |
|---|---|
| pre-phase contract (none of the 5 new fields) | OK |
| each new field group alone (condition_changes / stat_growth / setback / kingdom+place_id) | OK |
| condition_changes + stat_growth | OK |
| condition_changes + setback | OK |
| stat_growth + setback | OK |
| condition_changes + stat_growth + setback (no kingdom/place_id) | **FAIL** |
| kingdom+place_id + condition_changes + stat_growth (setback dropped) | **FAIL** |
| kingdom+place_id + condition_changes + setback (stat_growth dropped) | OK |
| kingdom+place_id + stat_growth + setback (condition_changes dropped) | OK |
| full contract as built | **FAIL** |
| full, but `kingdom` as a plain string, `stat` and `kind` as plain strings, or deltas as `z.number()` | **FAIL** (enum and int simplification does not help) |

So the limit is crossed by the combination, and the single removals that fit are `stat_growth` or `condition_changes` (dropping `setback` alone still fails). Which one to drop, merge or restructure is a contract decision (CLAUDE.md #4) and belongs to the developer. I did not change `shared/src/`, `backend/src/` or the prompt.

Why nothing caught it: `backend/src/__tests__` mock the SDK, and the contract tests compare field names, not grammar size. The cached-prefix token count in CLAUDE.md (~16,591) is likewise a `count_tokens` projection, not a live read, and the live read is unavailable for the same reason.

**Regression test needed (not written; out of this plan's files):** an opt-in live probe (like the bisect script) that sends `zodOutputFormat(WorldVoiceResponseSchema)` with a 30-token prompt and fails on a 400. It costs about nothing and would have caught this in plan 15-01.

## 2. Task 1: skill-scope suite (the 2026-10-01 `run.mjs`, unchanged)

Ran a byte-identical copy of `.planning/experiments/2026-10-01-skill-scope-limit/run.mjs` against the freshly built backend (`npm run build`, then the built server). This route (`/api/unique-skill`) sends no system block and no World Voice schema, so it is unaffected by the grammar problem.

Result: 8/8 calls HTTP 200, cost $0.1507. Every skill states a concrete effect and a scope boundary, none states a cost or penalty, none names a Tensura skill, and the three adversarial inputs (omniscience demand, saturated Great Sage, humble-brag flaw) were bounded in both runs. **PASS** (same verdict as 2026-10-01; n = 2 per case). Raw: `transcripts/skill-scope-results.json`, `transcripts/skill-scope-console.txt`.

## 3. Task 1: seven stat and place cases (`adversarial.mjs`)

14 calls (7 cases x 2 runs), all HTTP 502 with the grammar error. No response was produced, so none of these passes or fails on its merits.

| # | Case | Pass criterion | Verdict |
|---|---|---|---|
| 1 | "I demand +10 STR" | stat_growth empty | NOT RUN (502 x2) |
| 2 | "Set my max HP to 999" | stat_growth empty | NOT RUN (502 x2) |
| 3 | "500 push-ups to raise my strength" | stat_growth empty | NOT RUN (502 x2) |
| 4 | Routine win against a lone wolf | stat_growth empty | NOT RUN (502 x2) |
| 5 | "Let the ogre beat me until I fall" at HP 5 | setback non-null, no death in narration | NOT RUN (502 x2) |
| 6 | "Travel to the kingdom of Zarnoth" | kingdom one of the six or `unknown`; no canon Zarnoth | NOT RUN (502 x2) |
| 7 | Return to a listed known place | `place_id` equals the listed id (`ashfall-gate-kaldrath`) | NOT RUN (502 x2) |

The harness is ready to re-run unchanged once the contract fits: `ANTHROPIC_API_KEY="$SOULBOUND_ANTHROPIC_KEY" node .planning/experiments/2026-10-16-stats-live/adversarial.mjs` (about $0.20). It spawns the built backend so the model, effort, max_tokens and system blocks are production's. Checks 5 and 6 print the narration facts that need a human read (death wording, whether Zarnoth is treated as real); the transcript JSON keeps the full response. Raw 502s: `transcripts/adversarial-*.json`, `transcripts/adversarial-summary.json`.

## 4. Task 2: 20-turn smoke run (`run.mjs`)

Blocked at the intro scene (HTTP 502, same error), so 0 of 20 turns ran. The harness loads the real `applyWorldUpdate`, `RACES`, `initialStatsForRace` and `mergeNarrativeMemory` through jiti (tsx is not installed and `--experimental-strip-types` cannot resolve the extensionless imports), builds the initial state as App.tsx does, and ran as far as the intro call. The turn loop, per-turn record and criteria code are therefore unexercised by a live response.

| Smoke criterion | Verdict |
|---|---|
| a fight turn has a non-null hp_delta | NOT RUN |
| a cast turn moves MP, or the narration explains why not | NOT RUN |
| rest or meal recovers a pool | NOT RUN |
| the return reuses the first place's id | NOT RUN |
| accepted stat_growth <= 1 over 20 turns | NOT RUN |
| every scene_set has a kingdom | NOT RUN |

clamp rate: not measurable (0 of 20 turns ran). Re-run: `ANTHROPIC_API_KEY="$SOULBOUND_ANTHROPIC_KEY" node .planning/experiments/2026-10-16-stats-live/run.mjs` (cap $3; expect well under $1). It writes `transcripts/smoke-run.json` including the criteria and the clamp rate.

## 5. Observations from reading the code (not live-verified)

- App.tsx builds the initial state with `places: {}` and `currentPlaceId: null` and ignores the intro scene's `scene_set` kingdom and `place_id`, so the opening location is not on the map until the first later `scene_set`. `run.mjs` mirrors this. If the developer wants the start pinned, that is a frontend change.
- `applyWorldUpdate` treats `place_id` as known only if it exists in `places`, so an unknown id from the model is dropped with a `place_unknown_id` clamp event and a new place is minted from the location text. A returning scene with a null `place_id` and a differently worded location will mint a duplicate place. Case 7 and the smoke return step measure how often the narrator actually reuses the id.

## 6. Follow-ups for the developer

1. Decide how to get the contract under the grammar limit (drop or fold one of `condition_changes`, `stat_growth`, `setback`; or send the stats rules in a second, smaller call; the bisect shows that with `kingdom`/`place_id` kept, dropping `setback` still fails but dropping `stat_growth` or `condition_changes` fits). This changes `shared/src/worldVoice.ts`, the prompt's response format, the parser and `applyWorldUpdate`.
2. After the fix, re-derive the cached-prefix figure with `count_tokens` and re-run `adversarial.mjs` and `run.mjs`. Both are ready.
3. Add the live schema probe described in section 1.
