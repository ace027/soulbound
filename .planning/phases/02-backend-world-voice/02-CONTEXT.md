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

## Harness
**read-before-write → evidence-before-action → minimal diff → verify-before-report.** No plan reports success without running its verify commands and pasting real output. An agent that cannot verify reports BLOCKED.
