# Plan 02-01 Summary — Anthropic client module

**Status**: Complete
**Wave**: 1
**Agent**: Backend Architect (claude-sonnet-5)
**Requirements**: R4, R5, R7

## Files Created
`backend/src/anthropic.ts`

## The bug the agent caught — one hop deeper than the critique

Plan critique caught that constructing the client at module load would make `anthropic.ts` un-importable without a key. The agent's first draft obeyed that — lazy client — but still **statically imported `config.ts` at the top of the file**, which transitively ran `readApiKey()` on import and reproduced the identical hazard one level removed.

Its own no-key verification caught it immediately. Fixed by making the config import lazy too, mirroring `server.ts`'s `await import('./config.js')`, with `redact` and `getAnthropicApiKey` threaded as parameters rather than imported at module scope.

This is the difference between following a plan's letter and its intent. The critique named the mechanism; the agent found a second instance of it.

## Verification (re-run independently by the orchestrator)
| Check | Result |
|---|---|
| Imports with `ANTHROPIC_API_KEY` unset | **PASS** — the critical check |
| No static `config` import at module scope | PASS — only `await import('./config.js')` at line 61 |
| `buildSystemBlocks()` byte-stable across calls | PASS |
| Two blocks, `cache_control` on [1] only | PASS |
| No-system branch is a conditional spread | PASS — `...(useSystem ? { system: buildSystemBlocks() } : {})` |
| `zodOutputFormat` in the request path | PASS — line 400; raw `WORLD_VOICE_JSON_SCHEMA` explicitly reserved for the drift guard |
| `shared/` still free of the Anthropic SDK | PASS — deps are `zod` only, so the SDK cannot reach the browser bundle |
| No model string literal in this file | PASS — reads `MODELS` |
| Verbatim data files untouched | PASS |
| `npm run build -w @soulbound/backend` | PASS |

## Agent decisions, flagged and accepted
- **`effort: 'high'`**, module-level constant applied uniformly through the one shared helper rather than per-call — deliberately, so the two Opus routes cannot drift into different cache namespaces. Reasoning recorded in source: all three calls need simultaneous adherence to the MUST NOT list and a strict schema, which argues above the default; `xhigh`/`max` spend materially more of a budget the cost estimate didn't allow for. Whether `high` actually delivers that is untested and belongs to 02-05.
- **Five error codes**, not four: `AUTHENTICATION_FAILED`, `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`, `INVALID_RESPONSE_SHAPE`, plus an `UPSTREAM_ERROR` fallback. Each verified to carry no stack frame and no key material.
- **Usage log** is a greppable single line tagged `[anthropic:usage]`, with a separate `[anthropic:usage:truncated]` tag when `stop_reason === 'max_tokens'`.

## Plan error the agent found
My plan specified `zodOutputFormat(schema, '<name>')`. The installed SDK's real signature is single-argument:
```
zodOutputFormat<ZodInput extends z.ZodType>(zodObject: ZodInput)
```
The agent used the real signature and documented the discrepancy in source. Its own `route` tag serves the logging purpose the name parameter was gesturing at.

It also corrected its own verification methodology mid-task: a substring test for `$schema`/`enum` false-failed, because `transformJSONSchema` folds those *values* into a prose `description` rather than deleting them. It switched to testing for the literal JSON **key**, which is the semantically correct check.

## Not verifiable without a live key
- `cache_read_input_tokens > 0` — belongs to 02-05
- Whether `effort: 'high'` delivers the rule-adherence benefit reasoned toward
- Real 400 behaviour for prefill / `budget_tokens` — accepted as surfacing on the first live call

## Issues
None outstanding.
