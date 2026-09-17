# Plan 02-04 Summary — Route tests against a mocked SDK

**Status**: Complete
**Wave**: 3
**Agent**: QA Verification Specialist (claude-sonnet-5)
**Requirements**: R16, R4, R5, R6, R7

## Files Created
`backend/src/__tests__/anthropic.test.ts` (20 tests) · `backend/src/__tests__/routes.test.ts` (12 tests)

**Suite total: 38 tests across 3 files**, all green with `ANTHROPIC_API_KEY` unset.

## Verification (orchestrator ran its own break test)

I did not accept the agent's demonstrations. I changed the no-system path from a conditional spread to an `undefined` ternary myself:

```
× the no-system path omits the system key from the request entirely
× calls claude-sonnet-5 with the unique-skill schema and no system key
Failed Tests 2
--- restored ---
Tests  38 passed (38)   anthropic.ts byte-identical again
```

Two independent tests caught it. That distinction — `'system' in req === false` vs `system: undefined` — is CLAUDE.md #8, and it is now genuinely protected.

| Check | Result |
|---|---|
| `npm test` with key unset | PASS — 3 files, 38 tests |
| Own break test reproduced | PASS — 2 tests fail, revert restores |
| Verbatim data untouched | PASS |
| No test code in production `dist/` | PASS |

## The agent's six break-and-revert demonstrations
`max_tokens`→2000, added `budget_tokens`, no-system→`[]`, `zodOutputFormat`→raw schema, removed `effort`, hardcoded model string. Each failed the expected test, each reverted clean.

**Bonus finding from break #4.** Swapping `zodOutputFormat` for the raw schema also **silently breaks response validation** — without `.parse`, the SDK falls back to bare `JSON.parse` and a schema-violating response is no longer rejected. Two tests beyond the one the plan named caught it. That is exactly what this net exists for: the plan-critique finding was about the API rejecting a malformed schema, and this surfaced a second consequence nobody had reasoned about.

## Methodology worth recording
- **Read the installed SDK source before writing assertions** rather than assuming: confirmed `parse()` delegates to `create()`, so spying `Messages.prototype.create` captures the request `callWorldVoice` actually builds.
- **Verified the `$schema`/`enum` check isn't vacuous.** Asserted the literal JSON *keys* are absent while confirming the *substrings* still appear (folded into `description`). A substring test would false-fail — it already tripped one agent this phase.
- **Hard network tripwire** on `globalThis.fetch` (the SDK's fallback transport) for the whole routes file, with the test app driven via `node:http` so the tripwire can't self-satisfy. Never fired across 12 tests.
- **Honest about a negative result**: the environment's HTTPS proxy has `api.anthropic.com` in its `noProxy` list, so proxy logs can't corroborate the zero-network claim either way. The agent said so rather than citing it as evidence.

## Flagged, not silently refactored
`routes.test.ts` builds its own minimal Express pipeline instead of importing `server.ts`, because `server.ts`'s `main()` self-invokes at module load and calls `process.exit(1)` on startup failure — importing it would risk killing the test worker. The error handler is mirrored rather than imported, since `server.ts` exports no separable `buildApp()`.

That is a real structural limitation worth fixing eventually: the tests assert against a *copy* of the error-handler shape, so a future change to `server.ts`'s handler would not be caught. Extracting `buildApp()` is the fix. Correctly left alone — it was outside this plan's declared scope.

## Issues
None outstanding. One structural note carried forward (above).
