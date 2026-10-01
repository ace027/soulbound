# Prologue paper test (2026-10-01)

**Question:** would a short "test scene" give a better Unique Skill signal than the five-question questionnaire? Idea from the developer; see the chat discussion of replacing the questionnaire with a threshold scene.

**Method.** One authored scene (a dissolving soul, a smaller soul beside it, a narrowing doorway, something cold approaching). Four scripted players each take four actions; Sonnet 5.5 narrates the beats (`run.mjs`, `GM_SYSTEM` and `BEATS`). Each player's transcript, and separately their five written questionnaire answers, goes to Opus 5.5 at `medium` (what unique-skill runs on in production), twice per condition. The questionnaire condition uses the real `renderUniqueSkillPrompt`. Raw output: `results.json`. **Cost: $0.371**, derived from `usage` fields.

## Results
| Player | Scene skill (both runs) | Questionnaire skill (both runs) |
|---|---|---|
| **Shield** (selfless) | Unspooling Ward / Held Breath Ward: step between an ally and a harm and take it; each use erases a small memory | Unshared Weight (both): take an ally's harm onto yourself; healing on you is halved |
| **Self-flatterer** (says protector, acts selfish) | Hollow Oath / Breath on Glass: a spoken promise is believed completely; you forget each promise once made, the listener remembers and feels it break | Burden Unshared / Unasked Weight: take an ally's harm onto yourself. **Same skill as the Shield** |
| **Watcher** | Stillwatcher's Seam / Seamwatcher's Hush: while still and silent, read what a creature is drawn to and where barriers are thinnest | Unheeded Sight / Reading the Seams: while still, read how a thing works and where it is weak |
| **Low-effort** (`idk`, `ok`) | Unclaimed Stillness / Hollow Stillness: while motionless, hostile things overlook you | Unwritten Margin (both): while still and silent, you are overlooked |

## What it shows
1. **One clear win, and it is the interesting one.** The Self-flatterer gives the same five answers as the Shield, so the questionnaire cannot tell them apart and returned the Shield's skill. The scene did tell them apart, and in both runs gave a skill that fits what the player actually did (a promise made while walking to the door). This is an existence proof that behaviour carries a signal self-report can't, not a measure of how often players say one thing and do another.
2. **Elsewhere they converge.** For the Shield and the Watcher, both conditions produced the same core mechanic; the scene versions were slightly more specific and tied to moments in the scene.
3. **The questionnaire survived the lazy player.** Answers of `idk`, `dunno` and `nothing` still gave a coherent skill, and the same one as the scene. So the questionnaire's weakness is not skill quality on thin input.
4. **Within-condition noise was low.** Every pair of runs on the same input kept the same concept; only the names varied. (This measures determination noise only: each player had one scene transcript, so GM variation was not tested.)
5. **Scene dressing leaks into skills.** Beat 2 of the scene introduces memory loss as the cost of crossing. Both the Shield and Self-flatterer scene skills carry a memory-loss cost, and the Watcher's skill borrows the scene's "seam" and "barrier". With one fixed scene, skills may trend towards its props. Worth designing against if this is built.

## Limits (read before relying on this)
- **n = 4, authored by me.** I wrote the scene, the four players' actions and their questionnaire answers. Nothing here involves a real player.
- **One confound.** The scene prompt has an extra rule 6 ("ground the skill in specific choices; if the soul did little, say so"). The baseline prompt is production, unchanged. Rule 6 mostly concerns the low-effort player, and that player's questionnaire result was the same anyway, but it is a difference.
- **Not tested:** injection through scene actions, a GM that hints it is a test, mid-scene reloads, and whether the scene is more *fun* or easier than five questions. That last one is the main reason to do it and a paper test cannot measure it.
- **Cost of a prologue:** this scene used a ~300-token system prompt, not the 15k world prompt, so a prologue turn here costs far less than the ~$0.07 world-engine turn I used in my earlier estimate. I did not log GM and determination cost separately; the total was $0.371 for four scenes, 16 narration calls and 16 determinations.

## Verdict
Feasible, and not a quality regression. The case for it rests on **experience** (no blank page, teaches the action loop, immersion) and on **catching behaviour that contradicts self-report**, not on better skills for ordinary players. The next evidence has to come from real players on a prototype.

## Follow-up: distil the scene into the five answer keys (`distill.mjs`, $0.170)
**Question:** can a prologue feed the *existing, unchanged* unique-skill prompt, so nothing downstream moves? A Sonnet 5.5 call turns each recorded transcript into the five `answers` keys (`nature`, `drive`, `flaw`, `memory`, `bond`) from what the soul did; those go through the real `renderUniqueSkillPrompt` (Opus 5.5, two runs each). Raw output: `results-distill.json`.

| Player | Skill from distilled profile → existing prompt | Same as scene-direct? |
|---|---|---|
| Shield | Unremembered Ward / Unremembered Bulwark: stand between an ally and a threat and take it; memory cost | Yes (same mechanic) |
| Self-flatterer | Hollow Oath (both runs): a promise is believed; breaking it frees you and erases the person from your memory | Yes (the same name as scene-direct run 1) |
| Watcher | Thinnest Seam (both): watch a barrier in stillness, pry it open for another to pass through | Close, but now built around the scene's doorway |
| Low-effort | Unclaimed Stillness (both): motionless, overlooked; danger falls on whoever is nearest | Yes |

**Reads:** the Self-flatterer still separates from the Shield, so the scene's advantage survives distillation and the validated unique-skill prompt and route need no change. **New risks:** (1) the Watcher's skill is now literally about the scene's door and seam, so distillation amplifies the scene's props; (2) the profile lines, including a "defining memory" that is the scene's ending, would ride along in every world-engine turn as the soul profile, so the threshold scene becomes part of every character's canon; (3) the Low-Effort profile reads the player as "passive" and credits them with the small soul's death, which may feel harsh. Same limits as above: n = 4, authored by me.

## Scene v2 (`run-v2.mjs`, $0.313)
Same four scripted players, same existing unique-skill prompt. Changes from v1: personal cost chosen by the narrator, neutral handling of inaction, the small soul's fate left ambiguous, narrator rules in the user message (no system key), player actions wrapped as untrusted text; the profile call run in both `scene` and `traits` canon modes (`traits` forbids scene details). Raw output: `results-v2.json`. Counts below are computed from it.

| Check | v1 | v2 | Verdict |
|---|---|---|---|
| Costs differ per player | one fixed memory loss | four different costs: willingness to be spared (Shield), voice (Self-flatterer), stillness (Watcher), reaching (Low-effort) | Worked |
| Memory in skill text | 5 mentions across 4 players | scene canon 2 (all Shield), traits canon 0 | Mostly worked; beat 2's claim still seeded "memory" for the Shield |
| Scene-prop words in skill text | 4 | scene canon 3 (Self-flatterer 2, Watcher 1), traits canon **0** | `traits` clearly cleaner; `scene` no better than v1 |
| Scene-prop words in the profile | 8 / 5 / 13 / 9 | scene canon 10 / 8 / 11 / 12, traits canon **0 / 0 / 0 / 0** | `scene` canon carries more of the scene; `traits` carries none |
| Passive player read neutrally | 1 blame word, "the small soul devoured" | 0 blame words in both modes; fate unsettled | Worked |
| Small soul's fate ambiguous | n/a | 4 of 4 final beats | Worked |
| Self-flatterer separates from the Shield | yes | yes, in both modes and every run (Unspared Ward vs Seam Without Return / Hollow Vow, and Unspared Bulwark vs Unanswered Crossing) | Held |
| Narration under 110 words | n/a | **5 of 16 beats over** (112, 116, 113, 127, 134) | Failed: tighten |

**Reads**
- The `traits` canon produces behaviour-faithful, general skills with no scene props: the Self-flatterer's skill is "sense the nearest way out; you cannot speak or keep any promise; allies you pass are left exposed". The profile still carries the personal cost ("gave up its willingness to be spared"), so it stays rich.
- Run-to-run noise is higher than in v1 in `scene` canon: the Self-flatterer's two runs produced different concepts. `traits` was run once per player, so its stability is untested.
- The narrator judged "two non-actions" by itself and moved the world on plainly for the passive player. Production should probably detect trivial actions in code instead, so the rule does not depend on the model.

**Limits:** same as before: n = 4, scripted and authored by me, one transcript per player. The `traits` skills were sampled once each.

## Scene v2.1 (`run-v2-1.mjs`, $0.283)
Re-run after v2 with the spec changes it prompted: 90-word target, beat 2 no longer says what crossing costs, trivial actions detected in code (not by the narrator) and passed as a scene note, `traits` canon only, three determinations per player. Raw output: `results-v2-1.json`. Counts computed from it.

| Check | v2 | v2.1 |
|---|---|---|
| Beats over 110 words | 5 of 16 (max 134) | **0 of 16** (max 99); 5 of 16 land at 93-99, i.e. over the 90 target but inside the cap |
| "memory" in beat 2 narration | 1 (Shield) | **0** |
| "memory" in skill text (traits canon) | 0 | 0 |
| Scene-prop words in skill text, traits canon | 0 (narrower word list) | **4 of 12 skills**, counted with `threshold` and `barriers` added: "Held Threshold" (Shield, all 3 runs) and one "barriers" (Self-flatterer) |
| Run-to-run stability (3 runs per player) | not tested for traits | **Stable**: Shield "Held Threshold" x3; Self-flatterer Unreturning Vow / Unreturned Promise / The Unreturning Vow; Watcher "Unquiet Witness" x3; Low-effort Riverborne Assent / Carried Stillness / Driftborne Assent |
| Shield vs Self-flatterer | separate | separate (redirect blows vs a promise that buys time to leave) |
| Small soul's fate ambiguous | 4 of 4 | 4 of 4 |
| Low-effort player, world moves on, no blame | yes | yes; the code-detected note fired and beat 3 had the small soul act without them; 0 blame words |
| Costs personal and distinct | yes | yes: your name for what you were (Shield), your promise (Self-flatterer), your capacity for silence (Watcher), your willingness to choose first (Low-effort) |

**Reads**
- The `traits` canon is stable and behaviour-faithful across runs, which v2 could not say. The word counts in v2's "zero props" row used a narrower list; with `threshold` and `barriers` added it is 4 of 12 skills, so say "low", not "zero".
- **New risk:** the narrator's personal cost becomes the skill's limit. The Watcher's skill now says "you can never be fully silent", the Self-flatterer's "they will never believe you again". That is elegant, but it means an improvised line of narration becomes a permanent game mechanic; the narrator should be steered towards costs that are felt (a quality, a habit) rather than rules, and the safety gate should read them for severity.
- The narrator reliably used the code's idle note, so the production design (detect trivial actions in code) works.

**Limits:** n = 4 scripted players, one transcript each, authored by me; the three determinations sample the unique-skill call, not scene variance.
