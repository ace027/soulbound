# Plan 01-05 Summary — Verbatim static-data extraction

**Status**: Complete
**Wave**: 3
**Agent**: general-purpose (claude-haiku-4-5)
**Requirements**: R8

## Files Created
| Constant | Destination |
|---|---|
| `WORLD_SYSTEM_PROMPT` | `backend/src/data/worldSystemPrompt.ts` |
| `WORLD_LORE` | `backend/src/data/worldLore.ts` |
| `QUESTIONS` | `frontend/src/data/questions.ts` |
| `RACES` | `frontend/src/data/races.ts` |

## Verification — independently re-derived by the orchestrator

I did not accept the agent's numbers. I re-extracted all four constants from `legacy/souldbound-world.jsx` myself, by line range, evaluated them as modules, and compared **rendered runtime strings** against the built output. Source-text comparison would not have been sufficient: template-literal escaping differences produce source that looks identical but evaluates differently.

| Check | Result |
|---|---|
| `WORLD_SYSTEM_PROMPT` runtime string | **IDENTICAL** — 14,856 B both sides |
| `WORLD_LORE` runtime string | **IDENTICAL** — 23,529 B both sides |
| `QUESTIONS` deep-equal, length 5 | PASS |
| `RACES` deep-equal, length 9 | PASS |
| Every race has exactly 2 intrinsics | PASS — 0 violations |
| MUST NOT rule count preserved | PASS — 11 in legacy, 11 in extracted |
| Lore and behaviour in separate files | PASS — `worldLore.ts` + `worldSystemPrompt.ts`, unmerged |
| `git diff --exit-code legacy/` | PASS — legacy artifact unmodified |
| Both workspaces build | PASS — exit 0 each |
| World prompts absent from frontend bundle | PASS — `Vaheris`, `Sevreth`, `Korrash`, `MUST NOT` all absent from `dist/` |

My independently derived byte counts match the agent's report exactly. That agreement is the point of re-deriving them: two independent extractions landing on the same figures is evidence, where one report asserting them is not.

## Constraints held
- `CLAUDE.md` #6 — no MUST NOT rule removed, softened, reworded, reordered, or relocated. Count verified at 11 on both sides.
- `CLAUDE.md` #7 — lore facts and behavioural/reveal constraints remain in separate modules. Not merged, nothing moved between them.
- No rewording, re-flowing, re-indentation, or typo "fixes". Trailing newline in `WORLD_LORE` preserved.
- Entry order preserved in both arrays (race-select render order is user-visible).
- `TIER_STYLE` correctly left alone — it already lives in `shared/src/gameState.ts`.

## Notes
- The prompts live backend-side because that is where the Anthropic calls land in Phase 2; `RACES` and `QUESTIONS` live frontend-side because character creation renders them. Bundle isolation confirms the split held.
- One process note: my first extraction attempt over-ran the `RACES` boundary into the API function below it. Caught by inspecting the extracted tail before comparing, not after. Worth remembering that line-range extraction from a single-file artifact needs its boundaries checked, not assumed — the plan's stated ranges were right, my regex was not.

## Issues
None.
