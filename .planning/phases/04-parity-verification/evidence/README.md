# Phase 4 / Plan 04-05 — live run evidence (R14)

Raw artifacts from the paid end-to-end run on 2026-09-18, retained so the run's claims can be
re-checked without re-spending on the API. Added during the Phase 4 review cycle, which found that
the only paid, unrepeatable run in the project had committed prose and no raw evidence — the same
failure retro AI-5 exists for, and which plan 04-03 fixed for layout in this very phase.

**No API key appears in any file here.** Verified: `grep -ric 'sk-ant' . --exclude=README.md` → 0
across the directory. (The `--exclude` is needed because this README quotes the needle — without it
the command reports a match against this very line, which is not a key.)

| File | What it is |
|---|---|
| `usage-lines.log` | The seven `[anthropic:usage]` lines the backend logged, one per live call. This is the source of 04-05's per-call table, including the cross-route cache read. |
| `screenshots/` | Eight PNGs: title, race select, intro scene, the three world-engine turns, and the post-action / after-reload pair behind the restore comparison. |
| `playthrough.mjs` | The Playwright driver for creation → intro → 3 turns. **Re-running it spends money** (~$0.25). |
| `reload.mjs` | The save → live turn → reload → load driver. **Re-running spends ~$0.05.** Its seed is write-once; see below. |
| `counttokens.mjs` | Free `count_tokens` derivation of the expected cached prefix. Re-run this one freely — it is not billed. |

## Reading `usage-lines.log`

The claim R14 turns on is the **cross-route cache read**. Call 2 (`introScene`, Opus) shows
`cache_creation_input_tokens: 15490`; call 3 (`worldEngine`, Opus) shows
`cache_read_input_tokens: 15490` with no prior world-engine call. The write can only have come from
intro-scene, which is a different route on the same model — exactly the property the Opus/Opus split
was chosen for, and the thing mocks cannot produce.

`uniqueSkill` (Sonnet) shows zero on both cache counters. That is correct, not a failure: it sends
no `system` blocks at all (CLAUDE.md constraint 8), so it has no prefix to cache.

## A harness bug worth keeping

`reload.mjs`'s seed is guarded write-once. It was not, on the first attempt: Playwright's
`addInitScript` re-runs on **every navigation, `reload()` included**, so the seed overwrote the app's
own autosave the instant the page reloaded and the restore comparison measured the fixture against
itself. It printed `RESTORE: FAIL`, which is what a real regression looks like. The guard is the two
lines at the top of the init script; do not remove them.
