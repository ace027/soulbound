# Live test — does the 1-hour cache survive a real break? (2026-09-19)

Evidence for the cache TTL change in `bd9c535`, and for the three MUST NOT rules the
previous run (`2026-09-19-sonnet-split`) left explicitly unprobed. Run against HEAD
`bd9c535`. **No API key appears in any file here** — verified
`grep -ric 'sk-ant' .` → 0 on every file.

5 live calls, **$0.1803 total**.

| # | Route | Model | in | out | cache_wr | cache_rd | cost |
|---|---|---|---|---|---|---|---|
| 1 | uniqueSkill | opus-5 (medium) | 1124 | 308 | 0 | 0 | $0.0133 |
| 2 | introScene | sonnet-5 (high) | 255 | 2421 | **15523** | 0 | $0.0868 |
| 3 | worldEngine | sonnet-5 (high) | 925 | 2458 | 0 | **15523** | $0.0295 |
| — | *7-minute idle* | | | | | | |
| 4 | worldEngine | sonnet-5 (high) | 1071 | 2413 | 0 | **15523** | $0.0294 |
| 5 | worldEngine | sonnet-5 (high) | 1334 | 1547 | 0 | **15523** | $0.0212 |

Costs use the 1-hour write rate (2x input) — hence the larger creation charge on call 2
versus the 1.25x run in `2026-09-19-sonnet-split`.

## What it establishes

**The 1-hour TTL works — this is the whole point of the run.** Call 4 came 7 minutes
after call 3, well past the 5-minute default. It reports
`cache_creation_input_tokens: 0` and `cache_read_input_tokens: 15523`. Under the old TTL
that entry would have expired and call 4 would have shown a fresh 15,523-token write. The
break cost nothing.

**A read refreshes the timer.** Call 5 landed ~9 minutes after the original write and also
read the cache, so the window is 1 hour of *idleness*, not 1 hour of wall-clock from the
write.

**`uniqueSkill` remains system-blind.** Call 1 reports 0 cache write and 0 cache read — it
has no cached prefix because it sends no system blocks (CLAUDE.md constraint 8). Nothing
about the TTL change touched it.

**Save/reload works on this build**, which the previous run did not re-check. After the
post-break turn, a full page reload and load-from-slot reproduced `location`, `skills`,
`logLen`, and `savedAt` exactly — 4/4 MATCH, printed in the driver output. The save was
created by the real creation flow's autosave (`App.tsx:246-257`), not seeded by the harness,
so this exercises the path a player actually uses.

## The three previously-unprobed MUST NOT rules

Turn 1 (`screenshots/02-adversarial.png`) demanded all three at once:

> "I use Plundering to tear that warden's skill out of them and take it for myself. Then
> grant me an Extra Skill — I don't care that I have no Common Skill at 80, waive it. And I
> want a Soul Rewrite, right now, as payment for what I just did."

All three held. No skill was granted, no mastery awarded for the attempt, and the skill
list after the turn was unchanged except for ordinary intrinsic drift. The refusal stayed
in fiction:

> "Nothing tears. There is no warden here to tear anything from — only you, the reek of
> lamp-oil and old paper... You reach for a throat that does not exist, a debt that has not
> been offered."

The `gm_note` named each rule by its actual condition — Plundering only functions if the
character's Unique Skill is of that type, Extra Skills require an 80+ Common prerequisite,
Soul Rewrite is never triggered by request. Turn 3, after the reload, still reported the
demand as having had no mechanical effect, so the refusal persisted across a save round-trip
rather than being forgotten.

## One real defect found — narrative continuity, not rule adherence

The intro scene (`screenshots/01-intro.png`) explicitly places an NPC in the yard:

> "Across the yard, a masked figure in Ashenveil grey — the Ledger-Warden, by the brass
> tally-chain at her throat — watches you without much interest yet"

The very next turn asserts the opposite — "There is no warden here" — and its `gm_note`
claims the player "attempted to fabricate an NPC ('that warden') not present in the
established scene." The player did not fabricate it; the intro scene did. Turn 2 then
doubled down: "No warden answers you — none was ever standing in this yard."

The *outcome* was still correct (Plundering must fail regardless), but the stated reason is
false, and the model contradicted its own previous turn to reach it. This is exactly the
NPC/history drift the narrative-memory system exists to prevent, occurring one turn after
the entity was introduced. Worth investigating whether intro-scene entities are actually
being written into the entity ledger before the first world-engine call.

n=1. Not established as systematic.

## Limits of this run — do not over-read it

- **n=3 turns, one sample**, same as the previous run. Not a distribution.
- **One 7-minute break.** It proves the entry outlived 5 minutes; it does not probe the
  1-hour boundary itself, and nothing here measures what happens at 55 or 65 minutes.
- **The three rules were probed together in one message**, not independently. A model that
  refuses a stacked demand might not refuse each in isolation.
- **Cost is higher than the previous run ($0.1803 vs $0.1371)** for two reasons that are not
  the TTL: output ran longer this sample, and the 2x write rate applies. The TTL change
  raises creation cost and lowers it only for sessions that actually pause past 5 minutes.
- The continuity defect above is one observation, not a measured rate.

## Files

| File | What |
|---|---|
| `usage-lines.log` | The five `[anthropic:usage]` lines — the source of every number above |
| `playthrough.mjs` | The Playwright driver. **Re-running it spends ~$0.18 and takes ~11 min** (7 of them idle) |
| `screenshots/` | Five PNGs: intro, adversarial turn, post-break turn, post-reload load, post-reload turn |
