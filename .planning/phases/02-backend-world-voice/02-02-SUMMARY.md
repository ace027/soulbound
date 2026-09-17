# Plan 02-02 Summary — Vitest harness & contract-guard failure test

**Status**: Complete
**Wave**: 1
**Agent**: QA Verification Specialist (claude-sonnet-5)
**Requirements**: R16 (pulled forward from Phase 4 per retro action item 1)

## Files Created / Modified
`backend/vitest.config.ts`, `backend/src/__tests__/contract.test.ts` (new) · `backend/package.json`, `backend/tsconfig.json`, `package.json`, `package-lock.json` (modified)

`shared/package.json` was listed in the plan but needed no change — no tests live in `shared/`, and the root script's `--if-present` skips it cleanly. The agent flagged this rather than deviating silently.

## Verification (orchestrator re-ran the gutted-guard demonstration independently)

I did not accept the agent's demonstration. I stubbed `assertWorldVoiceContract` to `return;` myself, rebuilt `shared`, and ran the suite:

```
GUTTED:   × case 2: throws on a prompt-only field rename (gm_note -> gm_notes)
          × case 3: throws on a missing field (world_events removed)
          × case 4: throws a clear parse error when the block is unparseable
          Tests  3 failed | 3 passed (6)

RESTORED: Tests  6 passed (6)
          worldVoice.ts: byte-identical again
```

Cases 1 and 5 correctly kept passing under the stub — they don't exercise the throw path. **The three that matter fail when the guard is removed**, which is what makes this suite real rather than decorative.

| Check | Result |
|---|---|
| `npm test` from repo root | PASS — 1 file, 6 tests, exits 0, no watch mode |
| Gutted-guard: negative cases fail | **PASS — independently reproduced** |
| `shared/src/worldVoice.ts` restored byte-identical | PASS — `git diff --exit-code` clean |
| Guard error message still in built output | PASS |
| Verbatim data files untouched | PASS |
| No test code in production `dist/` | PASS — `find backend/dist -iname "*test*"` empty |
| Both workspaces build | PASS |

## The bug the agent found — real, and it flagged the scope expansion

The first clean `npm test` reported **2 files / 12 tests** instead of 1/6. Root cause: `backend/tsconfig.json` had `"include": ["src/**/*"]` with no exclude, so `tsc` compiled `contract.test.ts` into `dist/__tests__/`. Two consequences:

1. **Test code was shipping into the production bundle** that `node dist/server.js` runs from.
2. **Vitest silently ran every case twice**, picking up both the source test and its compiled copy — which would have made pass/fail counts meaningless as 02-04 adds more tests.

Fixed at root cause (`"exclude": ["src/__tests__/**"]` in tsconfig) rather than by narrowing Vitest's glob, with a `dist`/`node_modules` exclude in `vitest.config.ts` as defence-in-depth. `backend/tsconfig.json` was **not** in the plan's `files_modified`; the agent flagged the expansion explicitly with its justification rather than expanding scope silently. Correct call — leaving it would have shipped test code to production.

## Constraints held
- **No on-disk mutation of the prompt file.** All five prompt mutations operate on `WORLD_SYSTEM_PROMPT.replace(...)` copies, and a sixth test asserts the imported constant still contains every substring the others mutate copies of.
- Tests never import `config.ts` or `anthropic.ts`, so the suite runs with no API key present.
- No `sed` used for any edit.

## Issues
None outstanding.
