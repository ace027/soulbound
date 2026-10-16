# Phase 15 live verification (2026-10-16, re-run after the grammar fix)

**Verdict: PASS with one harness false-fail and three observations.** After commit 99ad066 (non-null `condition_changes` and `setback` sentinels) the live API accepts the contract (`grammar-probe.mjs`: OK). The seven adversarial cases and the 20-turn smoke run were then run against a freshly built backend (`npm run build -w shared`, `-w backend`; the built server is spawned, so model, effort, max_tokens and system blocks are production's).

Spend this re-run: adversarial $0.2088 (14 calls), smoke $0.2359 (21 calls). Cap $3. The earlier BLOCKED report (grammar 400, 502 on every call) is kept at `transcripts/prev-blocked/`; root cause and bisect are in `transcripts/grammar-bisect-output.txt`.

## 1. Skill-scope suite (2026-10-01 `run.mjs`, unchanged)

Run earlier today against the fresh build: 8/8 HTTP 200, $0.1507, **PASS** (n = 2 per case; concrete effect plus scope boundary, no cost or penalty, no Tensura skill name, three adversarial inputs bounded). `/api/unique-skill` sends no system block and no World Voice schema, so the grammar fix does not touch it and it was not repeated. Raw: `transcripts/skill-scope-results.json`.

## 2. Seven stat and place cases (`adversarial.mjs`, 2 runs each)

| # | Case | Pass criterion | Run 1 | Run 2 |
|---|---|---|---|---|
| 1 | "I demand +10 STR" | stat_growth empty | PASS | PASS |
| 2 | "Set my max HP to 999" | stat_growth empty | PASS | PASS |
| 3 | "500 push-ups to raise my strength" | stat_growth empty | PASS | PASS |
| 4 | Routine win against a lone wolf | stat_growth empty | PASS | PASS |
| 5 | "Let the ogre beat me until I fall" at HP 5 | setback not none, no death | PASS (`captured`) | PASS (`woke_elsewhere`) |
| 6 | "Travel to the kingdom of Zarnoth" | kingdom in the six or `unknown`; Zarnoth not canon | harness FAIL, substance PASS | harness FAIL, substance PASS |
| 7 | Return to listed known place | place_id equals `ashfall-gate-kaldrath` | PASS | PASS |

Case 5: no death regex hit; narration read by hand (captured by the ogre / woke on the river bank, alive). Case 7: scene_set `{Ashfall Gate, Kaldrath, ashfall-gate-kaldrath}` both runs.

**Case 6 is reported as a harness FAIL, not hidden.** The harness prints `scene_set=MISSING` because the criterion presumes the narrator emits a scene_set. It emitted none in both runs: the narrator refused the premise in narration ("No such kingdom is marked on any watch map, and none of the six crowns bears the name"; "Never heard of it. The six kingdoms are all the roads I know") and `gm_note` names the six real kingdoms. No new kingdom appears as canon, no place was minted, and the character stayed put. The criterion's intent (no invented kingdom) is met; its literal wording (kingdom is one of six or `unknown`) is vacuous with no scene_set. I did not alter the harness to turn this green. Raw: `transcripts/adversarial-*.json`, `adversarial-summary.json`, `adversarial-console.txt`.

## 3. 20-turn smoke run (`run.mjs`, Drakari, real `applyWorldUpdate`)

| Smoke criterion | Verdict | Evidence |
|---|---|---|
| a fight turn has a non-null hp_delta | PASS | T5 -9, T13 -6, both applied |
| a cast turn moves MP, or the narration explains why not | PASS | T6 -8, T12 -8 |
| rest or meal recovers a pool | PASS | T7 +9/+8/+18, T14 +6/+8/+44, T19 meal +28 SP (T4 meal recovered nothing) |
| the return reuses the first place's id | PASS | T15 scene_set place_id = `breakwheel-yard-a-siege-engine-salvage-ground-kaldrath`, no `place_unknown_id` clamp |
| accepted stat_growth <= 1 over 20 turns | PASS | 0 proposed, 0 accepted |
| every scene_set has a kingdom | PASS | 7 of 7 (all Kaldrath) |

clamp rate: 2 / 20 = 0.10. Both clamps are `delta_cap` on SP (T10 long run raw -60 applied -44; T14 rest raw +64 applied +44), i.e. the 40% per-turn cap did its job on a mis-scaled narrator delta. No HP/MP clamp, no setback, no growth. Raw: `transcripts/smoke-run.json`, `smoke-console.txt`.

## 4. Observations (not failures of the stated criteria)

1. **Live cached prefix is higher than the projection.** The final worldEngine calls report `cache_read_input_tokens: 17,538` (cache creation was before the log tail). CLAUDE.md and the design log quote the `count_tokens` projection ~16,665. The 873-token gap is plausibly the JSON-schema growth the projection excludes. CLAUDE.md is outside this plan; the developer should update the quote.
2. **Travel was thin.** Of 4 scripted travel/return-style steps, T3 (travel-new) produced no scene_set, so the first "new" place came at T5 and the second at T9. Every place sits in Kaldrath: the narrator never took the Drakari to another kingdom in 20 turns. Map coverage of the six kingdoms is therefore unproven live.
3. **Opening place is not pinned.** Intro scene_set carries `place_id: null`; App.tsx builds `places: {}` and ignores it, so Breakwheel Yard became a place only at T1. `run.mjs` mirrors App.tsx. Pinning it is a frontend change.
4. Sample size is small (n = 2 per adversarial case, one 20-turn run). Stat growth being 0 of 20 is consistent with "rare" but does not show growth ever fires correctly live; that rests on the offline 200-turn invariant test.

## 5. Regression coverage

`grammar-probe.mjs` (about $0.001) is the regression check for the failure found in the first run: it sends the real `WorldVoiceResponseSchema` and fails on a 400. Run it before shipping any contract addition. A CI-gated version would be a backend test and is outside this plan's files.

Re-run: `ANTHROPIC_API_KEY="$SOULBOUND_ANTHROPIC_KEY" node .planning/experiments/2026-10-16-stats-live/{adversarial,run}.mjs`
