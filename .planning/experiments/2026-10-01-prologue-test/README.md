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
