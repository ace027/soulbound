# Plan 01-02 Summary — Shared contract package

**Status**: Complete
**Wave**: 2
**Agent**: orchestrator (claude-opus-5)
**Requirements**: R3

## Files Created
`shared/package.json`, `shared/tsconfig.json`, `shared/src/worldVoice.ts`, `shared/src/gameState.ts`, `shared/src/index.ts`

## Derivation mechanism chosen: Zod 4 → `z.infer` + `z.toJSONSchema`
The Zod schemas are authoritative. TypeScript types are derived via `z.infer`; the JSON Schema for `output_config.format` is derived via `z.toJSONSchema(..., { io: 'input' })`. A field therefore cannot exist in the type but not the schema.

Chosen over build-time type→schema generation because it produces both projections at runtime from one declaration, with no build-ordering to get wrong, and hands Phase 2's backend a runtime validator for free.

## Contract source verification
Cross-checked `CLAUDE.md` constraint #4 against `WORLD_SYSTEM_PROMPT`'s RESPONSE FORMAT block (legacy lines 174–216). **All nine field names present in both; no discrepancy.** The plan's stop-and-report condition did not trigger.

Nullability follows the prompt's own instruction to "always include the full JSON structure" and emit explicit `null` — so `unique_sub_ability_unlocked`, `note`, `gm_note`, and `rewrite_narrative` are required-and-nullable, not optional. That is also what strict structured outputs want.

## Verification

### Gap found and fixed during verification
The first run showed `additionalProperties: false` **absent** from the derived schema — Zod's default object mode doesn't emit it, and strict structured-output validation depends on it. Switched all ten schemas from `z.object` to `z.strictObject`. Re-verified present.

### Drift guard — demonstrated failing, then passing
| Run | State | Result |
|---|---|---|
| 1 | baseline | PASS, but `additionalProperties` missing → fixed |
| 2 | after `strictObject` | PASS, `additionalProperties: false` present |
| 3 | **`gm_note` renamed to `gm_notes` in the schema only** | **FAIL, exit 1** — `MISSING: ['gm_note']`, `UNEXPECTED: ['gm_notes']` |
| 4 | reverted | PASS, exit 0 |

**Run 3 is the load-bearing result.** `npm run build` still exited 0 with the rename in place — `tsc` alone does not catch a contract rename, because the type and schema both moved together. The guard is therefore not redundant with the type checker; it is the only thing standing between a renamed field and a silently broken parser.

### Other checks
- `npm run build -w @soulbound/shared` exits 0, emits `.d.ts` for all three modules
- Unique-skill schema: 5 properties, all in `required`, `additionalProperties: false`
- `TIER_STYLE` keys are exhaustive over `SkillTier` (`Intrinsic, Common, Extra, Unique, Ultimate`), matching legacy lines 525–531
- No `any` in the contract types

## Notes
- `gameState.ts` uses plain TS types rather than Zod: nothing there crosses the model boundary, so there is no prompt to drift against and no schema to derive.
- `SaveSlot.schemaVersion` is optional by design — saves written by the artifact predate it and must still load. Treat missing as version 0.
- `world_events` is modelled permissively (`type` plus nullable `location`/`scene_summary`/`description`). Only `scene_set` is consumed by the frontend; a stricter union risked rejecting valid model output under `additionalProperties: false`.

## Issues
None outstanding.
