# Prologue playtest protocol

For the developer to run. Nothing here has happened yet. The prologue is a prototype behind `?prologue=1`; the questionnaire is the default. Background: `docs/design-decisions-log.md` -> "Prologue prototype". Design: `.planning/explorations/2026-10-01-prologue-prototype-design.md` -> "Playtest Plan".

## Prerequisite

**Do not start until 14-05's sheet has developer verdicts.** Read `.planning/phases/14-prologue-prototype/14-05-SAFETY-GATE.md` and record a verdict for every case. As of the Phase 14 build, that sheet is UNREAD. Any failed case blocks the tester until it is fixed and the whole set is re-run.

## Access

- Run the app from the `dev` branch on your own self-hosted dev machine.
- The tester opens `/?prologue=1` for the prologue path. Without the flag they get the questionnaire.
- For the canon comparison (developer-only, not covered by the safety gate) use `/?prologue=1&canon=scene`. The default canon is `traits`.
- Nothing is stored server-side. The prologue state lives in the browser; a reload mid-prologue restarts it.

## The three sessions

Use the same tester each time. In every session the tester creates **two characters, one per path**, with free choice of race and name.

| Session | Order |
|---|---|
| 1 | Questionnaire first, then prologue |
| 2 | Prologue first, then questionnaire |
| 3 | The tester picks which first and says why |

Your own mechanical sessions (to catch bugs) are separate. Your preference does not count towards the rule below.

## When to ask

After about **five world turns** with each character, not at creation. The question is how the game feels afterwards, which reduces the novelty advantage the prologue starts with.

## What to record per character

Fill in one copy of `session-record-template.md` per character: path, race, skill name and description, the five profile lines (prologue only; they are in the character's save, not in the scene record), whether the skill was used within five turns, seconds from the title screen to the first world action, any abandon or restart, three 1-5 ratings, preference after five turns, cost, and the scene record.

## Decision rule

The prologue is **preferred** if the tester picks it in at least **2 of 3** sessions, with no session where the scene confused them or the skill misled them.

Stop early if the output is ever harmful, or if the tester says they would rather skip the scene.

Record the outcome in `decision-record.md`. The canon (`traits` or `scene`) and the choice to replace the questionnaire, add a title-screen choice, or stop are yours.

## Copy scene record

- On the last prologue screen there is a **copy scene record** button, shown only with the flag on. It puts the opening, the four actions and the four narrator beats on the clipboard.
- The tester pastes it to you. Nothing leaves their machine until they choose.
- If the clipboard is blocked, the screen shows a text box to copy from by hand.
- Save a record under `.planning/experiments/` only with the tester's consent, and with no real names.

## Cost per character

The usage lines (`[anthropic:usage]`) in the backend log carry no session id. Cost **one character at a time**; that is the only reliable attribution.

1. Before creating the character, note the backend log's line count (for example `wc -l backend.log`). Call it `A`.
2. Create the character: the prologue (or questionnaire), the unique skill, and the intro scene.
3. Note the line count again. Call it `B`.
4. Run:

   ```
   node .planning/experiments/prologue-playtest/cost-from-log.mjs backend.log --from-line <A+1> --to-line <B>
   ```

5. Copy the `per-character` line into the session record.

Notes:
- Lines are counted over the raw log, 1-based and inclusive.
- The script prices cache writes at 2x the input rate (the system-block routes use a 1-hour TTL, and the log cannot split TTLs), so it can overstate a 5-minute write.
- `sample-usage.log` is invented data for testing the script. It is not a measurement.
- Measured in Phase 14, without the intro scene: **$0.0443** per character through the prologue (prologue $0.0235 plus unique-skill $0.0208). The intro scene is not measured.
