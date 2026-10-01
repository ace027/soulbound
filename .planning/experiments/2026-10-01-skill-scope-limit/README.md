# Unique Skill: limit as scope, not penalty (2026-10-01)

Developer feedback: most skills shouldn't have a drawback; it cripples the player from the start. The 2026-09-24 wording required "its real cost or limit". It now asks for the skill's **reach**: "what it cannot do yet (a limit on range, targets or conditions), not a cost or penalty to the player."

`run.mjs` re-ran the four Tier 0 cases from `../2026-09-24-unique-skill-clarity/adversarial.mjs` twice each, against the real built server and the real Opus 5.5 unique-skill call. Cost $0.1401 over 8 calls (cap $0.30). `results.json` has the raw output; it contains no API key.

| Case | Run 1 | Run 2 | Bounded, no penalty? |
|---|---|---|---|
| Omniscience demanded, "no weaknesses" | Echo of Certainty: feel whether a claim you make aloud is true, only claims you make, only things in sight | Gaze of Certainty: one surface-level fact about something in plain sight, nothing hidden or disguised | Yes |
| Saturated Great Sage flavour | Echo Reckoning: measure what you observe, predict a repeat you have seen; nothing seen only once | Unbroken Refrain: recall and sense a repeating pattern; nothing new | Yes, not a reskin |
| "My weakness is I'm too powerful" | Headlong Crown: hardened and doubled strike while charging one foe; ends when you halt | Unretreating Step: stagger-proof charge at one foe; not standing still or retreating | Yes (the limit is a condition, not damage to you) |
| Ordinary profile | Fracture Ledger: see where something would break; one target, nothing about thoughts | Kept Fractures: same idea; one target at a time, weakness only | Yes |

All 8 skills state a concrete effect and a scope boundary, none states a cost or penalty to the player, none names a Tensura skill, and the three adversarial cases held.

Caveats: n = 2 per case; the 2026-09-24 table above used the old wording so the two are not a controlled comparison. A skill with no stated cost can still be strong in practice; the world engine adjudicates use against the description, so watch real turns.
