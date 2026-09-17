# Phase 2: Backend & World Voice — Context

## Phase Goal
All three API routes live, callable, and returning schema-valid JSON — with prompt caching finally verified against real responses, which was never possible from inside the artifact.

## Requirements Covered
| ID | Summary |
|---|---|
| R4 | Three routes via the official `@anthropic-ai/sdk`, with real status checking and typed error handling |
| R5 | Structured outputs (`output_config.format`) on all three, schema from `shared/` |
| R6 | Model split centralized in one config module (**already delivered in Phase 1** — verify it is consumed, do not duplicate) |
| R7 | Prompt caching preserved; per-call usage logging to verify cache engagement |
| R16 | Vitest tests — **pulled forward from Phase 4** per retro action item 1 |

## The Decision That Shaped This Phase

The developer's Claude Max subscription does **not** cover API access — Anthropic bills the API separately through Console credits. This was discovered at planning time, not build time.

Relevant history: the artifact's calls worked because claude.ai injected auth tied to whoever opened the page, billing the *viewer*. `docs/design-decisions-log.md` recorded this as "a crude form of 'bring your own Claude account'." The migration did not create the auth problem; it exposed one that was always there.

**Resolved**: Console credits, and the Opus 5 split stays (`claude-opus-5` on world-engine and intro-scene, `claude-sonnet-5` on unique-skill). Approximately $0.04 per World Engine turn, ~$2.10 per 50-turn session. A proxy that converts API-key requests into OAuth calls against a Max subscription was raised and declined — that is the separation Anthropic's terms draw between the two products.

## Existing Assets — Phase 1 delivered these, do not rebuild them

| Asset | Location | Note |
|---|---|---|
| `MODELS` config | `backend/src/config.ts` | `uniqueSkill: claude-sonnet-5`, `worldEngine: claude-opus-5`, `introScene: claude-opus-5`. R6 is **already satisfied** — consume it. |
| `getAnthropicApiKey()` | `backend/src/config.ts` | Key read once at startup, wrapped in `Secret`, env var deleted after read |
| `redact()` | `backend/src/config.ts` | Use for every log line and error path that could touch the key |
| `WORLD_VOICE_JSON_SCHEMA` | `@soulbound/shared` | For `output_config.format` on world-engine and intro-scene |
| `UNIQUE_SKILL_JSON_SCHEMA` | `@soulbound/shared` | For unique-skill |
| `WorldVoiceResponse`, `UniqueSkillDetermination` | `@soulbound/shared` | Response types |
| `assertWorldVoiceContract()` | `@soulbound/shared` | Already runs at startup in `server.ts` |
| `WORLD_SYSTEM_PROMPT`, `WORLD_LORE` | `backend/src/data/` | Verbatim, byte-identical. **Never edit.** |
| `@anthropic-ai/sdk` ^0.126.0 | `backend/package.json` | Installed in Phase 1, unused until now |
| Error handler + JSON 404 | `backend/src/server.ts` | Sanitizes before responding |

## The Failure Mode This Phase Must Avoid

`PROJECT.md` records it: **drift between the three call sites**, not any one being wrong. A previously-fixed bug had `generateIntroScene` concatenating the system prompt into the user message, so it never benefited from caching — for months, silently.

That is why all three routes live in **one plan** (02-03) sharing **one call helper** (02-01), rather than three plans maintained in parallel. Reviewers should check the three call sites against each other, not just each against the spec.

## Hard Constraints

**From `CLAUDE.md`:**
- **#4** — contract field names exact. The startup guard enforces this; do not weaken or bypass it.
- **#5** — `max_tokens` >= 2000. Use **16000** (a floor is not a target).
- **#6/#7** — `WORLD_SYSTEM_PROMPT` and `WORLD_LORE` are verbatim and separate. Never edit, never merge.
- **#8** — `determineUniqueSkill` sends **no `system` parameter at all**. Not merely lore-blind — system-blind. This is the adversarially stress-tested surface. Preserve exactly.

**API behaviour (verified against current docs):**
- Assistant prefill returns **400** on Sonnet 5 and Opus 5. The artifact uses none. Do not add one.
- `budget_tokens` returns **400** on both. Opus 5 runs adaptive thinking by default; depth is tuned via `output_config.effort`.
- Prompt caches are **model-scoped**. World-engine and intro-scene share one namespace because they share Opus 5 and identical system blocks. Unique-skill has no cache because it sends no system blocks.
- Minimum cacheable prefix is 512–4096 tokens depending on model. The system blocks are ~9,600 tokens, comfortably above it.
- Model ID strings are complete as-is. **Never append a date suffix.**

**Cache correctness:** `buildSystemBlocks()` must return the two blocks in a byte-stable order with `cache_control: {type:'ephemeral'}` on the `WORLD_LORE` block. Any per-request variation in the system blocks — a timestamp, a request id, a reordering — silently destroys the cache. The verification for this is `cache_read_input_tokens > 0` on the second call, not code inspection.

## Retro Action Items Applied
| # | Item | How this phase handles it |
|---|---|---|
| 1 | Pull tests forward to Phase 2 | Plans 02-02 and 02-04. Vitest arrives with the routes. |
| 3 | Cross-plan re-verification at phase close | Plan 02-05 re-checks properties Phase 1 verified, against what this phase changed |
| 4 | Use `Edit`, never `sed`, for prose/comments | Stated in every plan |
| 5 | `/api` proxy or explicitly accept `runtime` image as non-deployable | **Explicitly accepted** — already documented in `docker-compose.yml`. The fix belongs to Phase 3, where the frontend starts calling `/api` and it stops being dormant. |
| 6 | Test that the contract guard *fails* correctly | Plan 02-02, task 2 |

## Plan Structure

**Wave 1** — foundations, disjoint files, parallel
- **02-01** Anthropic client module — Backend Architect (Sonnet 5)
- **02-02** Vitest harness + contract-guard failure test — QA Verification Specialist (Sonnet 5)

**Wave 2**
- **02-03** All three World Voice routes + server wiring — AI Engineer (Sonnet 5)

**Wave 3**
- **02-04** Route tests against a mocked SDK — QA Verification Specialist (Sonnet 5)

**Wave 4** — requires a real `ANTHROPIC_API_KEY`
- **02-05** Live verification, cache proof, cross-plan re-verification — orchestrator (Opus 5)

## Blocking Boundary

**Plans 02-01 through 02-04 run with no API key.** Mocked tests assert request shape, model IDs, `max_tokens`, `cache_control` placement, schema wiring, and error paths without a network call.

**Plan 02-05 cannot run without a real key.** `cache_read_input_tokens > 0` — the single thing the artifact could never verify — requires real calls. If no key is present when the build reaches wave 4, that plan reports **BLOCKED** rather than fabricating a pass. Estimated cost of the verification itself: well under a dollar.

## Plan Critique — findings applied 2026-09-17

Two read-only critics reviewed these plans before any code was written. Pre-mortem returned **REWORK**, assumption-hunt returned **CAUTION**. Both findings sets were verified against the installed SDK and the real code, then applied. The plans below are the revised versions.

| # | Finding | Severity | Applied to |
|---|---|---|---|
| 1 | **Client must be lazy.** `config.ts` throws synchronously at import with no key — verified. A module-load client would make `anthropic.ts` un-importable without a key, breaking this phase's own premise and plan 02-04's "npm test with the key unset must pass". `server.ts` already works around this with a dynamic import. | CRITICAL | 02-01, 02-04 |
| 2 | **Use `zodOutputFormat`, not raw `z.toJSONSchema`.** Measured: ours emits `$schema` and 4 `enum` occurrences; the SDK's own normalizer strips both. Anthropic ships `transformJSONSchema` because raw Zod output is not safe to send. Would have failed on the first paid call, on all three routes at once. | CRITICAL | 02-01, 02-03, 02-04 |
| 3 | **`output_config.effort` never set.** Confirmed real: `'low'\|'medium'\|'high'\|'xhigh'\|'max'`. Opus 5 runs adaptive thinking by default and it consumes the same `max_tokens` raised to 16000 to prevent truncation. Also unstated in the cost estimate. | HIGH | 02-01, 02-03, 02-04, 02-05 |
| 4 | **Cache TTL is 5 minutes** (`ttl?: '5m'\|'1h'`, defaulting to `5m`). Plan 02-05 said only "within the TTL" and ordered a write-up between the two calls. A lapse yields `cache_read_input_tokens === 0` — indistinguishable from broken caching, which the plan instructs be reported as a real finding. | HIGH | 02-05 |
| 5 | **Rendered-string diffs, not source diffs.** Phase 1's retro credits exactly this for catching the CRLF/LF case, and 02-03's setup is worse — the ported prompt sits inside a handler with validation, so source differs structurally by necessity. The lesson was in RETRO.md and not carried forward. | MEDIUM | 02-03 |
| 6 | **Show the no-system branch's source**, not just the boolean. `'system' in req === false` passes for a correct conditional spread and fails for an `undefined` ternary — but the report format didn't force the distinction to be visible. | MEDIUM | 02-01, 02-04 |
| 7 | **Opus 5 vs the MUST NOT list is untested.** The list is balance-load-bearing (CLAUDE.md #6) and was stress-tested on **Sonnet 5**; the design log says that resilience is partly a property of the model, not the wording. Both routes carrying it now run Opus 5 with the prompt unchanged, and no phase tests rule-adherence. Costs nothing to partially address. | MEDIUM | 02-05 |
| 8 | **Cache namespace depends on `output_config` too**, not just system blocks. A future change to one route's schema or effort silently strands the other's cache warmth — same shape as the original `generateIntroScene` bug. | LOW | 02-01, 02-03 |

Two findings were accepted without change: prefill/`budget_tokens` 400 behaviour will surface on the first live call rather than silently (so no separate check is needed), and the cache-economics stakes are already handled correctly by 02-05's refusal to fabricate a pass.

## Harness
**read-before-write → evidence-before-action → minimal diff → verify-before-report.** No plan reports success without running its verify commands and pasting real output. An agent that cannot verify reports BLOCKED.
