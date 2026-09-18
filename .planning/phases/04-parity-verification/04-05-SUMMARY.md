# 04-05 — Live end-to-end playthrough and cache proof (R14)

**Status: COMPLETE. R14 MET — both criteria observed live, neither inferred.**

Run 2026-09-18 against HEAD `c893f45`, on a real backend and the real models.

## Budget and actual

| | Calls | Note |
|---|---|---|
| Budgeted | 6 | creation (unique-skill + intro-scene + first world-engine turn) + 3 world-engine turns |
| Actual | **7** | one over |

The overrun is one world-engine turn (~$0.05) and it was **my harness bug, not the app's**.
The first reload attempt seeded the save with Playwright's `addInitScript`, which re-runs on
*every* navigation — including `reload()`. The seed therefore overwrote the app's own autosave
the instant the page reloaded, and the restore comparison was measuring the fixture against
itself. Re-run with a write-once guard. The failure is recorded here rather than quietly
re-run, because the first run's `RESTORE: FAIL` is exactly what a real regression would look
like and the distinction matters.

**Estimated spend ≈ $0.31**, derived from this project's own measured `$0.0499` per cached
world-engine turn (`.planning/STATE.md:216`): 5 world-engine turns ≈ $0.25, intro-scene's
cache *write* ≈ $0.05 (writes bill at a premium over reads), unique-skill on Sonnet ≈ $0.01.
Exact billing is Console's to state, not a log line's.

## Stack

**Host-run, not Docker Compose**: Vite on 5173 proxying `/api` to the backend on 3001. The
containerized path needs the CA mount workaround (`NODE_EXTRA_CA_CERTS`) and a hand-started
`dockerd` with known failure modes; on the host the proxy CA is already configured. Compose
remains unverified against live calls — see UNTESTED below.

Reachability was checked **on the proxied path from outside**, not by an internal probe —
Phase 2 recorded a healthcheck that passed while every proxied API call 403'd:

```
GET http://127.0.0.1:5173/api/health -> HTTP 200  {"status":"ok"}   # through Vite's proxy
GET http://127.0.0.1:3001/api/health -> HTTP 200                    # direct
GET http://127.0.0.1:5173/          -> HTTP 200                     # app HTML
```

Startup log: `[soulbound-backend] listening on port 3001`. `grep -ic 'sk-ant'` over the backend
and Vite logs → **0**. The key is absent from both.

## Per-call usage — all seven calls

Derived from `grep 'anthropic:usage' backend.log` (the logging added for R7).

| # | Route | Model | in | out | cache_creation | cache_read |
|---|---|---|---|---|---|---|
| 1 | uniqueSkill | claude-sonnet-5 | 1189 | 362 | 0 | **0** |
| 2 | introScene | claude-opus-5 | 274 | 1727 | **15490** | 0 |
| 3 | worldEngine | claude-opus-5 | 1018 | 2022 | 0 | **15490** |
| 4 | worldEngine | claude-opus-5 | 1288 | 2554 | 0 | **15490** |
| 5 | worldEngine | claude-opus-5 | 1719 | 2103 | 0 | **15490** |
| 6 | worldEngine | claude-opus-5 | 693 | 2744 | 0 | **15490** |
| 7 | worldEngine | claude-opus-5 | 693 | 2311 | 0 | **15490** |

Every call `stop_reason: end_turn` — no truncation at `max_tokens: 16000`.

### What this proves, beyond what R14 asked

R14 asks for `cache_read_input_tokens > 0` **from the second World Engine call onward**. The
observed result is stronger: it is `> 0` from the **first** world-engine call, because
`introScene` wrote the prefix and `worldEngine` read it. **That is a cross-route cache read
between two different routes on the same model** — the exact behaviour the Opus 5 split was
chosen for, and the thing that cannot be tested with mocks. Had intro-scene stayed on Sonnet,
its write would have been stranded in a namespace nothing else reads, and call 3 would have
shown a 15,490-token write instead of a read.

`uniqueSkill` shows zero cache activity on both counters. That is the **correct** result, not
a failure: it sends no `system` blocks at all (CLAUDE.md constraint #8), so it has no prefix to
cache and nothing to share.

### The predicted number, derived free before spending

`POST /v1/messages/count_tokens` is not billed, so the expected prefix size was derived before
any paid call: **13,669** tokens for the two system blocks plus a 5-token probe → ~13,664
system-only, plus the ~1,827-token schema ≈ **15,491**.

**Observed: 15,490.** Off by one token.

This also retires the stale figure: the design log's 13,310 system-only / 15,132 total dates
from before two lines were added to `WORLD_SYSTEM_PROMPT`, which sits inside the cached prefix.
The prefix is now 15,490. Re-derive with `count_tokens` (free); do not re-run the live proof to
re-read a number.

Cache reads held at 15,490 across calls spanning roughly six minutes, including a gap between
the playthrough run and the reload run.

## Criterion 1 — the game plays

Race select → questionnaire (5 questions) → Unique Skill → intro scene → 3 World Engine turns,
driven in a real Chromium against the shipped UI, not a test harness.

Character: **Yulen Marr**, Shadeveil. Generated Unique Skill: **Kept Verdict** — "perceives the
true shape of a thing by observing it in stillness, rendering judgments that crystallize into
fixed, nearly unchangeable truths once pronounced."

Screenshots were **viewed, not merely captured** (retro AI-7). Observed across the three turns:

- Soul Codex renders the unique skill with its `soul_resonance` and etching text, the mastery
  bar, locked sub-abilities, and the intrinsic skills from the chosen race.
- Mastery advances per turn and is visible: Kept Verdict 0 → 12 → 19, Umbral Slip 5 → 9 → 10,
  Dark Sense 16 → 19.
- **Sub-abilities stay locked below 25.** At mastery 19 the panel still reads "3 more sleep,
  waiting to be discovered" — the 25/60/100 emergence thresholds are holding against a live
  model rather than only against fixtures.
- Location updates ("Greyhollow, a lampless plaza-town in Ashenveil" → "Greyhollow, sunken
  plaza — Ashenveil").
- `gm_note` renders as the italic parenthetical under the narration.
- The `✓ saved` autosave indicator appears after a turn.

No behaviour differed from the artifact in anything observed.

## Criterion 2 — save, reload, load, state restored

Verified **field by field** against state written by a live model turn, not a fixture:

```
POST-ACTION    stored : skills [Dark Sense=19, Kept Verdict=19, Umbral Slip=10]  log 3  savedAt 1789702426874
                                        ↓ full page reload ↓
AFTER-RELOAD   stored : skills [Dark Sense=19, Kept Verdict=19, Umbral Slip=10]  log 3  savedAt 1789702426874

MATCH  location    "Greyhollow, sunken plaza — Ashenveil"
MATCH  masteries   ["19","10","19"]
MATCH  log length  3
MATCH  skills      [Dark Sense=19, Kept Verdict=19, Umbral Slip=10]
```

The save compared here was written **by the app's own autosave**, carrying real model output —
not the seeded bootstrap slot. After reload the title screen showed the save card, loading it
restored the session, and the restored action bar accepts input and arms its Act button.

**The post-reload liveness check did not spend an eighth call.** It confirms the loaded session
is interactive (textarea accepts input, Act enables); it does not re-prove a model round-trip,
which calls 3-7 already established. Stated rather than implied.

## UNTESTED — carried forward, not reported as passing

1. **Docker Compose against live calls.** This run was host-run. The containerized path still
   needs `-e NODE_EXTRA_CA_CERTS=/ca/ca-bundle.crt -v /root/.ccr/ca-bundle.crt:/ca/ca-bundle.crt:ro`,
   and that combination has never been exercised against a real API call.
2. **The `runtime` Docker image**, which still answers `/api/*` with 200 + HTML. Known since
   Phase 3, dormant only while nothing is served from it.
3. **Long sessions.** Seven calls is not 50. The 80-entry log cap, the 40-note memory cap and
   Soul Rewrite were not reached, and sub-ability emergence at 25/60/100 was observed only as
   *correctly not firing* below 25 — never as firing.
4. **Cache expiry cost.** The measured `+$0.087` penalty on a >5-minute pause was not
   reproduced; reads held at 15,490 throughout.

## Files

- `.planning/phases/04-parity-verification/04-05-SUMMARY.md` (this file)

No source file was modified. The stack was run, not changed.
