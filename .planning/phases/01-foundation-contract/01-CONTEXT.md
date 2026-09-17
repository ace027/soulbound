# Phase 1: Foundation & Contract — Context

## Phase Goal
A runnable empty skeleton plus the single contract module every later phase depends on. Nothing game-facing works yet, but `docker compose up` succeeds and the World Voice types exist.

## Requirements Covered
| ID | Summary |
|---|---|
| R1 | TypeScript monorepo (`frontend/`, `backend/`, `shared/`), one Dockerfile per service, `docker compose up` runs both |
| R2 | Backend holds `ANTHROPIC_API_KEY` via `.env`; fail-fast at startup; never logged, bundled, or in stack traces |
| R3 | `shared/` defines the World Voice JSON contract as TS types plus a derived JSON Schema |
| R8 | Static data ported verbatim: `WORLD_SYSTEM_PROMPT`, `WORLD_LORE`, `RACES`, `QUESTIONS` |
| R15 | (docs move only) `docs/` reorganization so `CLAUDE.md`'s existing references resolve |

## Existing Assets
- `souldbound-world.jsx` — 1,440-line legacy artifact. **The parity oracle for this entire migration.** Note the filename typo ("sould"). Moves to `legacy/` in Plan 01; do not delete in this phase.
- `CLAUDE.md` — stays at repo root. Its doc references (`docs/PROJECT-BACKGROUND.md` etc.) are currently broken; Plan 01 fixes them by moving the files, not by editing `CLAUDE.md`.
- `PROJECT-BACKGROUND.md`, `MIGRATION-PLAN.md`, `design-decisions-log.md` — move into `docs/`.
- No `package.json`, no build tooling, no tests exist yet. This is a greenfield scaffold around existing logic.

## Key Line References in the Legacy File
Plans 02 and 05 depend on these. Verify against the file rather than trusting these numbers blindly — read before write.

| Item | Lines |
|---|---|
| `SAVE_INDEX_KEY` / `SAVE_PREFIX` / `MAX_LOG_SAVED` | 5–7 |
| `WORLD_SYSTEM_PROMPT` | 63–216 |
| `WORLD_LORE` | 219–302 |
| `QUESTIONS` | 305–331 |
| `RACES` | 334–380 |
| `buildSystemBlocks()` | 438–443 |
| `TIER_STYLE` | 525–531 |
| `gameState` construction | 890–897 |
| Save-slot payload shape | 815–827 |
| Save index metadata shape | 28–36 |

## Decisions Carried Into This Phase
- **Architecture proposals: skipped.** The committed exploration doc's "Alternatives Considered" table already resolved monorepo shape, Docker shape, and TS-vs-JS.
- **Spec pipeline: skipped.** `.planning/explorations/2026-09-17-soulbound-artifact-to-app-design.md` serves as the spec.
- **npm workspaces** are the mechanism for `shared/` to be importable by both services — chosen so the contract is a real import, not a copied file.
- **Docker: two services**, one Dockerfile each, composed together. A single container serving built static files was considered and deferred to a production build target; it fights Vite HMR during by-feel iteration.
- **`CLAUDE.md` is not edited this phase.** Its stale "auth is an OPEN DECISION" note and the model-split record are Phase 4 work (R15), kept together so the doc changes land with the code they describe.

## Plan Structure

**Wave 1** — establishes the tree every later plan writes into
- **01** Repository reorganization & workspace root — Infrastructure & DevOps (Haiku 4.5)

**Wave 2** — three disjoint directories, no shared write targets, fully parallel
- **02** Shared contract package — orchestrator directly (Opus 5)
- **03** Backend service skeleton — Backend Architect (Sonnet 5)
- **04** Frontend service skeleton — Frontend Developer (Sonnet 5)

**Wave 3** — requires the service directories to exist
- **05** Verbatim static-data extraction — general (Haiku 4.5)
- **06** Compose wiring & end-to-end verification — Infrastructure & DevOps (Sonnet 5)

## Constraints Active In This Phase
1. **Constraint #4 (contract fidelity)** is the whole point of Plan 02. Field names must match `CLAUDE.md` exactly: `narration`, `state_updates.{skill_mastery_changes, new_skills_granted, skill_evolutions, unique_sub_ability_unlocked, world_events}`, `narrative_memory_updates.{new_entities, note}`, `gm_note`.
2. **Constraint #7** — `WORLD_LORE` and `WORLD_SYSTEM_PROMPT` stay separate modules in Plan 05. Do not merge, do not move reveal constraints between them.
3. **Constraint #8** — nothing in this phase may add system-block access to the unique-skill path.
4. **R2** — the API key must not appear in any committed file, any log line, or the frontend bundle. `.env` is gitignored; only `.env.example` with an empty value is committed.
5. **Verbatim means verbatim** (R8/Plan 05) — the prompt text is adversarially tested and balance-load-bearing. Extraction is a copy operation verified by diff, not a retyping or a reformat.

## Harness
Every plan follows: **read-before-write → evidence-before-action → minimal diff → verify-before-report**. No plan reports success without running its verify commands and showing output.
