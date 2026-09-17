# Phase 2: Backend & World Voice — Review Summary

## Result: PASSED (3 cycles)

**Reviewers**: testing-qa-verification-specialist, engineering-security-engineer, testing-api-tester
(dynamic panel, non-overlapping domain rubrics) · **Completed**: 2026-09-17

| | Found | Resolved |
|---|---|---|
| BLOCKER | 2 | 2 |
| WARNING | 10 | 10 |
| SUGGESTION | 9 | 9 |

**Test suite: 38 tests / 3 files → 108 tests / 7 files.**

## The theme

All three reviewers independently reached the same conclusion in cycle 1: **the code was right;
the net around it wasn't.** Prompts were byte-identical to legacy, error mapping was correct, the
cache prefix was genuinely stable, no key leaked, no secret was committed. Almost every finding
was about what was *unprotected* rather than what was wrong. A 22-mutation sweep made that
concrete — 11 survived, including unregistering all three routes and replacing the entire
15k-token cached prefix with junk, both with the suite fully green.

## The two blockers

**BLOCKER 1 (cycle 1) — `server.ts` was executed by no test.** Routes could be unregistered, the
error handler could return raw stack traces, and the startup contract guard could be deleted,
all 38/38 green. Fixed by extracting `buildApp()` and having the route tests drive the real
pipeline. Re-verified: unregistering the routers now fails 12 tests.

**BLOCKER 2 (cycle 3) — the Host allow-list 403'd every API call under Docker Compose.**
Introduced *by cycle 2's own security fix*. Vite's proxy rewrites `Host` to `backend:3001`, which
wasn't on the list. Critically, **the container still reported healthy**, because the healthcheck
curls localhost from inside the container and never exercises the proxied path — this would have
shipped looking green. Fixed by setting `ALLOWED_HOSTS` in compose; verified live: proxied calls
return 200/400 while `Host: evil.example.com` still gets 403.

## Two findings the orchestrator found by probing the fixes

Both are the reason cycle 3 existed rather than stopping at cycle 2's confident "done" report.

**The prompt-injection guard was bypassable.** `stripDelimiters()` ran its regex once, and a
single pass splices its own neighbours into a fresh tag: `</play</player_action>er_action>`
becomes a live `</player_action>`, putting the payload *outside* the delimiter and addressing the
World Voice directly. 3 of 6 probes escaped. Now runs to a fixed point with a `<`-stripping
fallback; 11 probes, 0 escapes, and an independent reviewer's 300,000 random probes also found 0.

**The delimiter defense was bypassable by waiting one turn.** `actionHistory` was joined raw, so
the same player text carefully wrapped as `<player_action>` on submission was echoed back
*undelimited* on the next turn. Each history entry is now wrapped, and the remaining
client-controlled fields run through `stripDelimiters()`.

## Deviations from reviewer advice, with reasons

- **`PROJECT-BACKGROUND.md` was not rewritten.** Both flagged lines sit under explicitly
  historical headings ("at time of migration", "artifact phase") where Sonnet-uniform was true.
  Following the advice literally would have introduced a falsehood. Annotated instead.
- **The body limit stayed at 512kb**, deliberately larger than the 100kb default, because a
  ~500-turn save is already ~230KB and a tighter cap would 413 legitimate play. But the rationale
  comment was corrected: it wrongly claimed the schemas alone bound the prompt. Three collections
  are interpolated in full and their bounds multiply to ~4.2M chars, so the body limit *is* the
  operative token guard for those.
- **A subagent's "config.ts leaks the key to `process.report`" was a false alarm** — it was the
  probe's own environment (the host exports the same value under a second name). Retracted before
  it reached a fix.

## Verification the orchestrator ran independently

Every blocker and warning was reproduced before being acted on, and every fix was re-checked
after: mutation tests for the two cycle-1 survivors, live container tests for the Compose
blocker, 11 crafted probes against the delimiter stripper, and mutant-kill checks confirming each
new test fails against the code it protects. The 15,132-token cache figure — which one reviewer
called unverifiable — was confirmed for free via `count_tokens`: 13,310 (prompt) + 1,827 (output
schema) = 15,137 vs 15,132 measured. That also established that the output schema sits *inside*
the cached prefix, which is the mechanical reason both Opus routes must send identical
`output_config`.

## Remaining suggestions (not blocking)

Attribute-bearing and unicode-lookalike tag forms aren't matched by the delimiter regex — neither
reconstructs a literal delimiter, so neither permits an escape. Recorded in the module doc.

See `02-05-SUMMARY.md` § "Not covered by automated tests" for the consolidated gap list.
