# 04-02 — Close R16 with evidence from the existing suite

**Verdict: R16 is MET. No test files were changed. The suite did not grow.**

R16: *"Vitest contract test (fixture parses against the shared type, malformed fails
loudly) and save/load round-trip tests"* (`.planning/PROJECT.md:40`).

This was a verification plan, not a build plan. The requirement was closed by proving the
existing tests constrain something real — each guarantee demonstrated by a mutation that
makes the suite fail — not by adding tests to it.

---

## Baseline, derived

```
$ npm test          # at HEAD 0792fa6, clean tree
backend:   Test Files  7 passed (7)   Tests  108 passed (108)
frontend:  Test Files  9 passed (9)   Tests  129 passed (129)
```

Test-case inventory, derived rather than restated:

```
$ grep -cE "^\s*it\(" backend/src/__tests__/contract.test.ts        # 6
$ grep -cE "^\s*it\(" frontend/src/lib/__tests__/saves.test.ts      # 22
```

`contract.test.ts` holds five numbered cases plus a sixth guard asserting the imported
`WORLD_SYSTEM_PROMPT` constant was never mutated by the five above. `saves.test.ts` holds
an `artifact-era compatibility (R11)` block, a `writeSave / loadSave round trip` block,
and six further blocks (log storage, index behaviour, `deleteSave`, helpers, and two
storage-failure paths).

---

## Mutation results

Eight mutations. Every one asserted applied before any conclusion was drawn (retro P2-3),
via a Python helper that fails hard unless the needle occurs exactly the expected number
of times and the rewrite actually changed the file. Every one restored byte-identically
and proven with `diff`.

| # | Mutation | Applied-proof | What the suite actually did |
|---|---|---|---|
| M1 | `CONTRACT_FIELD_NAMES`: `'gm_note'` → `'gm_noteRENAMED'` (`shared/src/worldVoice.ts`, rebuilt) | needle 1×; `grep -c` in `shared/dist/worldVoice.js` 0 → 1 | **2 failed / 4 passed — of `contract.test.ts`'s 6 tests, not the 108-test backend suite** (rows M2-M8 below report whole-suite counts; this row does not). case 5 failed on the exact diff; case 1 also failed |
| M2 | `"world_events": [],` deleted from the prompt's RESPONSE FORMAT block (`backend/src/data/worldSystemPrompt.ts`) | needle 1×; `grep -c '"world_events"'` 1 → 0 | **4 failed / 104 passed.** case 3, case 1, the untouched-constant guard, **and** `server.test.ts` "boots … on the real, undrifted prompt" |
| M3 | `assertWorldVoiceContract` made a no-op (early `return`) | needle 1×; `grep -c 'MUTATION: no-op'` in dist = 1 | **4 failed / 104 passed.** cases 2, 3, 4 — exactly as predicted — plus `server.test.ts` "exits 1 when WORLD_SYSTEM_PROMPT has drifted" |
| M4 | `SAVE_PREFIX` `'sbc-save:'` → `'sbc-save-v2:'` — **internally consistent**, `saves.ts` imports it | needle 1×; `grep -c` in dist = 1 | **4 failed / 125 passed.** 3 artifact-era tests + "writes under the artifact key" |
| M5 | `SAVE_INDEX_KEY` `'sbc-save-index'` → `'sbc-index'`, likewise internally consistent | needle 1×; `grep -c` in dist = 1 | **1 failed / 128 passed.** "lists an index written by the artifact" |
| M6 | `loadSave` drops the log in transit: `log: Array.isArray(save.log) ? save.log : []` → `log: []` | needle 1× | **5 failed / 124 passed**, across `saves.test.ts`, `appIntegration` and `simulationScreen` |
| M7 | `loadSave` drops the `narrativeMemory` backfill | needle 1× | **1 failed / 128 passed.** "backfills narrativeMemory absent from pre-migration saves" |
| M8 | `postJson` drops runtime validation: `schema.parse(parsed)` → `parsed as T` | needle 1× | **3 failed / 126 passed.** "throws rather than returning data when a 200 body violates the shared schema", once per route |

**No case survived its own mutation.** There is no finding to report against the tests
themselves.

---

## Why each half of R16 is closed

### "fixture parses against the shared type, malformed fails loudly"

Two distinct layers, both guarded:

- **Prompt ↔ schema field-name agreement** (CLAUDE.md constraint #4). M1, M2 and M3 each
  produced real failures. M2 is the one that matters most: editing the prompt's RESPONSE
  FORMAT block is the drift `tsc` cannot catch, because `WORLD_SYSTEM_PROMPT` is a plain
  template string with no structural tie to the Zod schemas. M2 broke four tests including
  the live startup guard in `server.test.ts`.
- **Runtime fixture parsing.** The happy-path cases in `api.test.ts` parse real fixtures
  through `WorldVoiceResponseSchema` / `UniqueSkillDeterminationSchema`; M8 proves the
  malformed arm fails loudly rather than handing unvalidated data to the UI, for all three
  routes. `anthropic.test.ts:546` covers the same property server-side
  (`INVALID_RESPONSE_SHAPE`, 502, through the real parse path).

### "save/load round-trip tests"

Round-trip tests exist (`saves.test.ts:163`) and M6 proves they constrain fidelity.

**But the stronger claim R16 actually rests on is that a save written by the *artifact's*
key scheme still loads — and that is separately proven.** M4 is the evidence. It renames
`SAVE_PREFIX` *consistently*: writer and reader both import the constant, so every
write-then-read path in the app still works, and the suite still went red. It went red
because three tests in `artifact-era compatibility (R11)` seed `localStorage` under the
hand-written literal `'sbc-save:'` — as a plain object, not through `writeSave` — and then
call `loadSave`. That is a byte-for-byte artifact save being loaded, and it is exactly
what R16 is for.

A pure round-trip test would have stayed green under M4. The hand-written literals are
the reason it did not. M5 shows the same for `SAVE_INDEX_KEY`.

**The literals in `saves.test.ts:16-17` are load-bearing and must not be refactored into
an import of `SAVE_PREFIX`.** That change would make the test follow drift instead of
catching it, and would have turned M4 green. The file's own docstring already says this;
this plan is the measurement that confirms it.

---

## Deliberately not added

- **No new contract tests.** All five cases plus the untouched-constant guard are live.
  Adding more would inflate the suite without adding a guarantee.
- **No new save tests.** Both the round-trip property and the stronger artifact-key
  property are already covered and both are mutation-proven.
- **No refactor of the hand-written key literals** — see above; that is a deliberate design.
- **Constraint-6 gap** (the `WORLD_SYSTEM_PROMPT` MUST NOT rule list is only partially
  asserted in `prompts.test.ts`) — real, found by 04-01, but a constraint-6 concern in a
  file outside this plan's declared set. Routed to phase close, not picked up here.
- **The inherited `currentSlotId` closure race** (`App.tsx:291`) — offered to the developer
  and declined; present identically in legacy 913-1031. Untouched.

---

## Verification gate

```
$ cd backend  && npx tsc --noEmit   # exit 0
$ cd frontend && npx tsc --noEmit   # exit 0
$ npm test
backend:   Test Files  7 passed (7)   Tests  108 passed (108)
frontend:  Test Files  9 passed (9)   Tests  129 passed (129)
$ git diff --exit-code              # clean
$ git status --porcelain            # only 04-02-SUMMARY.md
```

Counts are unchanged from baseline, as they must be: no test was added or removed.

Restoration was verified against a pre-mutation snapshot with `diff -r`, not only with
`git diff`. This matters because `shared/dist/` is gitignored (`.gitignore:5`) and M1,
M3, M4 and M5 required a `npm run build -w @soulbound/shared` to take effect — the shared
package resolves through `node_modules/@soulbound/shared → shared/dist`, not through
source. `git status` alone would not have caught a stray build artifact; the snapshot
diff confirms `shared/dist` is byte-identical to its pre-mutation state.
