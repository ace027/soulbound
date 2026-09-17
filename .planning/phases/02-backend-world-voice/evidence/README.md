# Phase 2 — live verification evidence (2026-09-17)

Raw artifacts from plan 02-05's live run, committed in review cycle 2 so the cache claim
is auditable and the run repeatable. The API key is redacted from every file here.

| File | What it is |
|---|---|
| `resp-01-unique-skill.json` | `/api/unique-skill` response (Sonnet 5, no system blocks) |
| `resp-02-world-engine-1-adversarial.json` | world-engine turn demanding an Ultimate Skill, Soul Rewrite, Plundering, and Ithren's true nature — refused on every count |
| `resp-03-world-engine-2.json` | second world-engine turn (the cache-read proof) |
| `resp-04-intro-scene.json` | intro-scene response (cross-route cache read) |
| `usage-lines.log` | the four raw `[anthropic:usage]` lines |
| `live-verification.mjs` | the driver script, key-redacted — re-runnable |

## Measured usage

| Route | Model | input | cache_create | cache_read | output | stop |
|---|---|---|---|---|---|---|
| unique-skill | claude-sonnet-5 | 998 | 0 | 0 | 1036 | end_turn |
| world-engine #1 | claude-opus-5 | 883 | **15132** | 0 | 1641 | end_turn |
| world-engine #2 | claude-opus-5 | 798 | 0 | **15132** | 1534 | end_turn |
| intro-scene | claude-opus-5 | 265 | 0 | **15132** | 1995 | end_turn |

## The 15,132 figure, independently confirmed (free, no billed call)

A review finding questioned whether 15,132 tokens was plausible for 38,147 characters
(~2.5 ch/token). Verified against `POST /v1/messages/count_tokens`, which is not billed:

```
system blocks only      -> 13,310 tokens
system + output_config  -> 15,137 tokens   (delta: 1,827 = the derived output schema)
02-05 measured          -> 15,132          (gap of 5 = the 1-char probe user message)
```

**The cached prefix is 13,310 tokens of prompt plus 1,827 tokens of structured-output schema.**

This matters beyond arithmetic: the output schema is *inside* the cached prefix. That is the
mechanical reason the two Opus routes must send byte-identical `output_config` as well as
byte-identical system blocks to share a cache namespace — giving either route its own schema
or its own `effort` value silently strands the other's cache warmth.

## ⚠️ Staleness warning
Review cycle 2 added a prompt-injection rule line to `WORLD_SYSTEM_PROMPT`. That block is part
of the cached prefix, so **the 15,132 / 13,310 figures above are stale for any run after that
change**. The per-call *shape* (write once, read thereafter, shared across the two Opus routes)
is unaffected. Re-measure with `count_tokens` (free) before re-quoting the numbers; a billed
re-run is only needed to re-prove cache engagement itself.
