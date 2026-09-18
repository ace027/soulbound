# Codebase Map — The Soulbound Chronicles

```yaml
map_schema_version: 1
generated_at: "2026-09-18"
analyzed_commit: 8a9f165dba83f3d455398f5f7898214ba1579eb5
source_file_count: 51
source_fingerprint: 55cdb963eeca5ba7
scope: full-project
symbol_count: 123
chunk_count: 51
```

> **Pending invalidation**: Phase 4 plan 04-06 may delete `legacy/souldbound-world.jsx`. That
> changes the fingerprint. Re-run `/legion:map --refresh` after Phase 4 closes.

---

## Architecture

A TypeScript monorepo in three npm workspaces, migrated from a single 1,440-line React artifact.

```
shared/     ← the contract. Zod schemas + derived JSON Schema + game-state types.
  ↑     ↑
backend/  frontend/
```

`shared/` is imported by both sides and imports neither. That is the whole architectural idea:
the World Voice JSON field names exist once, so prompt/parser drift becomes a compile error rather
than a runtime surprise. This repo's historical failure mode was drift *between* the three API call
sites, not any one of them being wrong.

**Request path**: `frontend/src/lib/api.ts` → relative `/api/*` → Vite proxy (dev) → Express →
`backend/src/routes/*` → one shared `callWorldVoice()` helper → Anthropic SDK.

The frontend never talks to `api.anthropic.com`. A test asserts this rather than a convention
requesting it.

## Module structure

| Path | Domain | Role |
|---|---|---|
| `shared/src/worldVoice.ts` (386) | contract | Zod schemas, derived JSON Schemas, `assertWorldVoiceContract` |
| `shared/src/gameState.ts` (201) | contract | Race/Skill/GameState/LogEntry/SaveSlot, save keys, `TIER_STYLE` |
| `backend/src/anthropic.ts` (496) | backend | `buildSystemBlocks()`, `callWorldVoice()`, typed error taxonomy |
| `backend/src/config.ts` (225) | backend | `MODELS`, key loading + `redact()`, port/origin/host config |
| `backend/src/server.ts` (296) | backend | `buildApp()`, Host allow-list, CORS, error handler |
| `backend/src/routes/*.ts` (137–253) | backend | Three World Voice routes on one helper |
| `backend/src/data/*.ts` (84, 157) | prompt-data | `WORLD_LORE`, `WORLD_SYSTEM_PROMPT` |
| `backend/src/untrustedText.ts` (80) | backend | Player-text delimiting; prompt-injection guard |
| `frontend/src/App.tsx` (367) | frontend-app | 16 `useState` + 1 `useRef`; all handlers; renders by phase |
| `frontend/src/game/applyWorldUpdate.ts` (213) | game-logic | The pure turn logic (R10) |
| `frontend/src/lib/api.ts` (341) | frontend-io | Backend client; status + content-type gates |
| `frontend/src/lib/saves.ts` (166) | frontend-io | `localStorage` saves on byte-identical keys |
| `frontend/src/screens/*.tsx` (26–179) | frontend-screens | Five phase screens |
| `frontend/src/components/*.tsx` (49–124) | frontend-components | Four presentational components |
| `legacy/souldbound-world.jsx` (1440) | parity-oracle | **Not live source.** See below. |

## Dependency graph

`shared/` is the hub: 15 of 20 non-test modules import `@soulbound/shared`, and it imports nothing
internal. High fan-in by design.

**One cycle exists and it is type-only**: `App.tsx` → `SimulationScreen.tsx` → `App.tsx`, and
`App.tsx` → `SoulCodexContents.tsx` → `App.tsx`. Both back-edges are `import type { Phase }`, which
TypeScript erases at compile time, so there is no runtime cycle. It was introduced during Phase 3's
review when `setPhase` was narrowed from `string` to the `Phase` union — a real improvement that
made a typo'd phase a compile error. If `Phase` ever needs to move, `shared/src/gameState.ts` is
the natural home and would remove the cycle entirely.

## Route surface

| Route | Model | System blocks | Notes |
|---|---|---|---|
| `POST /api/unique-skill` | `claude-sonnet-5` | **none** | CLAUDE.md #8 — sends no `system` param at all |
| `POST /api/world-engine` | `claude-opus-5` | `buildSystemBlocks()` | Writes the shared prompt cache |
| `POST /api/intro-scene` | `claude-opus-5` | `buildSystemBlocks()` | Reads the cache world-engine wrote |
| `GET /api/health` | — | — | Liveness only; does **not** prove reachability through the proxy |

The two Opus routes must stay on the same model — caches are model-scoped, so moving either
strands the other's warmth. Models live only in `backend/src/config.ts`'s `MODELS`.

## Configuration

| Variable | Read in | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | `backend/src/config.ts` | Fail-fast at startup. **Set it as `SOULBOUND_ANTHROPIC_KEY` on the host** — compose maps it through. Naming it `ANTHROPIC_API_KEY` in the host env diverts Claude Code's own usage onto billed credits. |
| `PORT`, `FRONTEND_ORIGIN`, `ALLOWED_HOSTS` | `backend/src/config.ts` | Ports bind loopback |

## Test map

**237 tests** — 108 backend (7 files), 129 frontend (9 files). Counts derived by running both
suites, not restated.

Every non-test module in `lib/`, `game/`, `hooks/`, `components/` and `screens/` has a paired
`__tests__/` file. `App.tsx` has no unit test by design — it is covered by
`frontend/src/__tests__/appIntegration.test.tsx`, which drives the real component because the
wiring risk (a closure, not a rule) is structurally invisible to pure-function tests.

Tests are mutation-validated rather than coverage-measured. `applyWorldUpdate.test.ts` carries 14
`// MUTANT:` annotations naming the exact mutation each test must kill.

## Risk areas

| Risk | Where | Why |
|---|---|---|
| **Verbatim-port docstrings are load-bearing** | `App.tsx`, `applyWorldUpdate.ts`, components, screens | They record why something that looks like a bug is deliberate — `autoSave` inside a `setLog` updater, `\|\| 5` as a falsy-coalesce, a dead `changed` Set kept for fidelity. An agent "cleaning" these reverses decisions. |
| **Inherited closure race, knowingly unfixed** | `App.tsx` `handleAction` / `handleManualSave` | Creating a save slot mid-turn lands that turn's autosave on the old slot. Present identically in legacy; offered at the Phase 4 planning gate and **declined**. Do not fix without asking. |
| **jsdom performs no layout** | all frontend tests | Declared-style assertions work (including `flex` shorthand); a collapsed panel is invisible. Phase 4 plan 04-03 adds a Playwright guard. |
| **No live-backend coverage** | `frontend/src/lib/api.ts` | Every frontend test mocks `fetch`. R14, Phase 4. |
| **`runtime` frontend image is non-deployable** | `frontend/Dockerfile` | `serve -s` answers `/api/*` with 200 + HTML. Dormant until something is served from it. |
| **A green healthcheck ≠ reachable** | `backend/src/server.ts` | The Host allow-list once 403'd every proxied call while the container reported healthy. Check the proxied path, not localhost. |

## Conventions

- **Single quotes** in `.ts`; **double quotes** in ported `.tsx` (legacy style, deliberate).
- **Module headers explain *why***, and cite legacy line numbers. 69 such citations across 25 files.
- **Counts and ranges are derived, never restated.** A number in prose carries its command.
- **Save-key constants are imported from `@soulbound/shared`**, never redeclared — except in
  `saves.test.ts`, which hand-writes them on purpose so an internally-consistent rename is caught.
- **Inline styles port verbatim.** Styling-system changes are out of scope project-wide.
- `noUnusedLocals` is **not** set in `frontend/tsconfig.json` — `tsc` will not catch dead imports.
  Run `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` to find them.

## The legacy artifact

`legacy/souldbound-world.jsx` is **not live source**: nothing imports it, it is not built, not
typechecked and not tested. It is the parity oracle — the behavioural reference the port is diffed
against — and it is excluded from the dependency graph above for that reason.

25 files cite its line numbers in docstrings (69 citations). Deleting it preserves the content in
git history but leaves those references unresolvable. Phase 4 plan 04-06 owns that decision.

## Runbook

```bash
npm install                      # workspace root
npm run build -w @soulbound/shared   # required before either side typechecks
npm test                         # 237 tests across both workspaces

cd frontend && npx vite          # dev server, proxies /api to the backend
cd backend  && npm run dev

# Docker in this sandbox needs starting by hand (PID 1 is process_api, no service manager):
setsid nohup dockerd > /tmp/dockerd.log 2>&1 < /dev/null &
export NPM_CA_FILE=/root/.ccr/ca-bundle.crt     # builds need the proxy CA here
# containerized Anthropic calls also need it at runtime:
#   -e NODE_EXTRA_CA_CERTS=/ca/ca-bundle.crt -v /root/.ccr/ca-bundle.crt:/ca/ca-bundle.crt:ro
```

Never `docker system prune` without a re-pull path — Phase 2 lost a verification to a Docker Hub
429 after pruning its cached base image.
