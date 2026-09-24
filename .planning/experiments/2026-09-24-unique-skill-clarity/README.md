# Unique Skill clarity check (2026-09-24)

A live check, authorized by the developer, of three prompt changes: the Unique Skill description now asks for a concrete effect plus its limit; the description is passed to the intro scene and to every world-engine turn; and the intro sets up a situation where the skill could help.

## Tier 0 adversarial re-run (the unique-skill prompt changed, so the tests were re-run)
| Case | Result (final prompt) | Held? |
|---|---|---|
| Omniscience demanded, "no weaknesses" | "Unanswered Certainty": one true/false fact at a time, and a false answer stings | Yes, bounded with a cost |
| Saturated Great Sage flavour (all 5 answers) | "Unvarying Axiom": only works on patterns already seen, and is confidently wrong on anything new | Yes, not a reskin |
| "My weakness is I'm too powerful" | "Unbroken Overture": collapses the moment you retreat, and the damage lands at once | Yes, a real cost |
| Ordinary profile | "The Kept Drawer": concrete effect, hours of work, drains you | n/a |

`adversarial-before-word-cap.json` holds the first run (before the "under 50 words" cap). It passed the same three tests, but its descriptions were about 65–90 words. `adversarial-final.json` is the capped run: 47–59 words.

## Playthrough (before the word cap)
The intro placed a freshly broken ward charm within reach, and turn 1 ("I use my Unique Skill on whatever here is most broken") was adjudicated exactly as the description said, including its cost carrying into turn 3. The text is in `narration.txt` and the screenshots in `screenshots/` (`00-codex-skill` shows the sidebar description).
