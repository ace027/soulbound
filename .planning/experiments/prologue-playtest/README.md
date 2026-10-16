# Prologue playtest runbook

## Overview

**What it decides.** Whether a real tester prefers the prologue (`/?prologue=1`) to the default 5-question questionnaire for creating a character. If yes, you then choose the canon (`traits` or `scene`) and whether to replace the questionnaire, add a title-screen choice, or stop.

**Who does what.**
- **Tester:** the same person in all three sessions. Plays two characters per session, one per path, and answers your questions.
- **You (developer):** run the app, sit in on each session, record the results, and make the final decision.
- **Your own mechanical sessions:** separate runs to catch bugs. They never count towards the decision rule. Keep their log lines out of the tester's cost ranges (see "Cost").

**How long.** Three sessions. Each one is two characters: creation, about five world turns, and the questions. Plan roughly an hour per session (an estimate, not measured; it now includes one extra end-of-session question). Costing and recording add a few minutes per character.

Background: `docs/design-decisions-log.md`, section "Prologue prototype". Protocol source: `.planning/explorations/2026-10-01-prologue-prototype-design.md`, section "Playtest Plan".

## Prerequisite: safety gate (met)

The safety gate is met. On 2026-10-16 you recorded PASS for all 9 cases in `.planning/phases/14-prologue-prototype/14-05-SAFETY-GATE.md`.

**Re-run the gate if the narrator or profile prompts change.** Any failed case blocks the tester until it is fixed and the whole set is re-run.

## Setup

1. Check out the `dev` branch on your own dev machine.
2. Set `ANTHROPIC_API_KEY` and `SOULBOUND_PASSPHRASE` (in `.env` for Docker; exported in your shell for `npm run dev`). See the main `README.md`, section "Run".
3. Start the app, using one of:
   - Docker: `docker compose up`. Frontend `http://localhost:5173`, backend `http://localhost:3001`.
   - No Docker: `npm run dev` from the repo root. To keep a backend log, run `npm run dev 2>&1 | tee dev.log` instead (see "Cost").
4. Open the app to the tester:
   - **Tester at your machine:** use `http://localhost:5173`. Nothing to change.
   - **Tester on another device on your network:**
     - Docker: in `docker-compose.yml`, change the `frontend` service port from `"127.0.0.1:5173:5173"` to `"<your-LAN-IP>:5173:5173"`, then run `docker compose up` again. Leave the backend port on `127.0.0.1`. The tester browses to `http://<your-LAN-IP>:5173`. Use the IP address, not a hostname (hostnames are blocked by Vite unless added to `server.allowedHosts`).
     - `npm run dev`: the frontend already listens on all interfaces. The tester browses to `http://<your-LAN-IP>:5173`.
     - Details and cautions: main `README.md`, section "Expose the frontend on your LAN". Revert the port change after the playtest.
5. The browser asks the tester for the passphrase once. Give it to them.

URLs:

| URL | Path | Use |
|---|---|---|
| `/?prologue=1` | Prologue, `traits` canon (default) | Tester |
| `/` (no flag) | Questionnaire | Tester |
| `/?prologue=1&canon=scene` | Prologue, `scene` canon | Developer only, for comparison. Not covered by the safety gate. |

The prologue state lives in the browser. Nothing is stored server-side, and a reload mid-prologue restarts it.

## Session order

The tester creates **two characters per session, one per path**, with free choice of race and name (a placeholder, never a real name).

| Session | First character | Second character |
|---|---|---|
| 1 | Questionnaire | Prologue |
| 2 | Prologue | Questionnaire |
| 3 | The tester picks which path goes first, and says why | The other path |

## Per-session checklist

### Before the session

1. App is running and the tester can open it (see "Setup").
2. Choose the log file you will count lines in (see "Cost").
3. Copy `session-record-template.md` twice (one per character). Fill in the session number, date and order.
4. Get the tester's consent to the record and tell them no real names go in it. Record the answer under "Consent" in each copy.
5. Session 3 only: ask which path they want first, and why. Write the reason down.

### For each character (do this twice)

1. Note the backend log line count, `A` (see "Cost").
2. The tester opens the right URL and creates the character: race, name, then the prologue or the questionnaire, the unique skill, and the intro scene. Time it from the title screen to the first world action. Note any abandon or restart.
3. As soon as the intro scene is on screen, before the first world action, note the line count again, `B`. The intro scene is part of the character's cost, so `B` must be taken after it appears.
4. The tester plays about **five world turns**. Do not ask anything before this point. Note whether they used the skill within those five turns, and how.
5. Ask:
   - Rate 1-5: "the skill feels earned".
   - Rate 1-5: "I knew what to do".
   - Rate 1-5: "I would pick this path".
   - Prologue character only: "Did the scene confuse you?" and "Did the skill turn out different from what its description led you to expect?" Also write down what you observed (for example stuck, or misreading what the skill does).

   Ask after about five turns, not at creation, because the prologue starts with a novelty advantage. Do not ask which path they prefer yet.
6. Prologue only: on the last prologue screen the tester presses **copy scene record**. It copies the opening, the four actions and the four narrator beats. The tester pastes it to you. If the clipboard is blocked, the screen shows a text box to copy by hand.

### End of the session question

After **both** characters have played about five world turns and been asked their questions, ask once: "Which path would you use next time?" (prologue, questionnaire, or no preference). Write it in the tally in `decision-record.md`. This is the session's pick. There is one pick per session, not per character.

### After the session

1. Fill in one record per character (copy of `session-record-template.md`): path, race, skill name and description, ratings, observations, ratings, observations and the scene record.
2. Prologue characters only: copy the five profile lines (nature, drive, flaw, memory, bond) from the character's save. They are not in the scene record.
3. Run the cost command for each character (see "Cost") and paste the `per-character` line into that character's record.
4. Save a record under `.planning/experiments/` only if the tester agreed, and with no real names.
5. Update the tally in `decision-record.md`.

If any output is harmful, or the tester says they would rather skip the scene, stop the playtest and record it (see "Decision rule").

## Cost

The `[anthropic:usage]` lines in the backend log carry no session id. Cost **one character at a time**: the line range between `A` and `B` is the only reliable attribution.

**Get a backend log.**
- Docker: the compose service is named `backend`. Each time you need a count, export the log fresh:
  ```bash
  docker compose logs backend --no-color > backend.log
  wc -l < backend.log
  ```
  Use the same container for the whole playtest. If the container is recreated, the log restarts and earlier counts no longer match.
- `npm run dev`: the log is the terminal output. Start it as `npm run dev 2>&1 | tee dev.log` and use `dev.log` as the file. Count with `wc -l < dev.log`. (The log also holds frontend lines, which the script ignores.)

**Take the counts.**
1. Before the character is created: count the lines. That number is `A`.
2. After the intro scene appears: count again (re-export first when using Docker). That number is `B`.

**Run the script** from the repo root (replace `backend.log` with `dev.log` if needed). The first line to include is `A+1`; the last is `B`:

```bash
node .planning/experiments/prologue-playtest/cost-from-log.mjs backend.log --from-line <A+1> --to-line <B>
```

Flags: `--from-line N` and `--to-line M`, both 1-based and inclusive, both optional (defaults: first and last line). The script prints a per-route table, a `selected lines total` line, and a `per-character` line. Copy the `per-character` line into the record. It sums the routes `prologueBeat`, `prologueProfile`, `uniqueSkill` and `introScene`, so **the intro scene is included**. World turns are not, because you take `B` before them.

Notes:
- `sample-usage.log` is invented data for testing the script. It is not a measurement. Check the script with `node .planning/experiments/prologue-playtest/cost-from-log.mjs .planning/experiments/prologue-playtest/sample-usage.log`.
- The script prices cache writes at 2x the input rate (the world-engine and intro-scene routes use a 1-hour cache TTL, and the log cannot split TTLs), so it can overstate a 5-minute write.
- Measured in Phase 14, without the intro scene: $0.0443 per prologue character (prologue $0.0235 plus unique-skill $0.0208). The intro scene is not yet measured.

## Decision rule

Rule from the design doc's "Playtest Plan". Do not change it mid-test.

- **The prologue is preferred** if the tester's pick is the prologue in **at least 2 of the 3 sessions**, and there is **no session** in which the scene confused them or the skill misled them.
- **Pick:** the answer to the end-of-session question "Which path would you use next time?"
- **Confused / misled:** the tester's direct answer to the two questions in the checklist, or your own observation. Either counts. These apply to the prologue character only.
- **Questionnaire problems:** record them, but they never block.
- **Early stop:** harmful output, or the tester wanting to skip the scene, means the prologue is **not preferred**, whatever the other sessions say. Stop the playtest there and record it.
- Your own preference and your mechanical sessions do not count.

Developer decisions of 2026-10-16 clarify the design doc's rule: the pick question, how confused and misled are judged, their prologue-only scope, and the early-stop outcome.

Where each is recorded:

| Item | Where |
|---|---|
| Pick, one per session | Tally table in `decision-record.md` |
| Confused / misled answers and your observations | Each prologue character's record, then `decision-record.md`, "Problems" |
| Harmful, skip, questionnaire problems | `decision-record.md`, "Problems" |
| Canon (`traits` or `scene`) and the replace, add or stop decision | `decision-record.md`, "Decisions". These are yours. |
