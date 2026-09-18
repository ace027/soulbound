# Codebase Map — The Soulbound Chronicles

```yaml
map_schema_version: 1
generated_at: "2026-09-18"
analyzed_commit: 32882234ac659e7fa19cb91cbb6ddf3057477315
source_file_count: 54
source_fingerprint: 29353e65f863b7d1
scope: full-project
symbol_count: 125
chunk_count: 54
```

> **Refreshed after Phase 4.** The previous map (`8a9f165`, fingerprint `55cdb963eeca5ba7`) indexed
> `legacy/souldbound-world.jsx`, which Phase 4 deleted. It also predates the Playwright harness and
> two new constraint guards. All counts below are derived; each carries its command.

---

## Architecture

A TypeScript monorepo in three npm workspaces, migrated from a single 1,440-line React artifact.
The migration is complete: all four phases shipped, and the artifact is gone.

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
| `shared/src/worldVoice.ts` (387) | contract | Zod schemas, derived JSON Schemas, `assertWorldVoiceContract` |
| `shared/src/gameState.ts` (202) | contract | Race/Skill/GameState/LogEntry/SaveSlot, save keys, `TIER_STYLE` |
| `backend/src/anthropic.ts` (497) | backend | `buildSystemBlocks()`, `callWorldVoice()`, typed error taxonomy |
| `backend/src/config.ts` (226) | backend | `MODELS`, key loading + `redact()`, port/origin/host config |
| `backend/src/server.ts` (297) | backend | `buildApp()`, Host allow-list, CORS, error handler |
| `backend/src/routes/*.ts` (138–254) | backend | Three World Voice routes on one helper |
| `backend/src/data/*.ts` (85, 158) | prompt-data | `WORLD_LORE`, `WORLD_SYSTEM_PROMPT` |
| `backend/src/untrustedText.ts` (81) | backend | Player-text delimiting; prompt-injection guard |
| `frontend/src/App.tsx` (368) | frontend-app | 16 `useState` + 1 `useRef`; all handlers; renders by phase |
| `frontend/src/game/applyWorldUpdate.ts` (214) | game-logic | The pure turn logic (R10) |
| `frontend/src/lib/api.ts` (342) | frontend-io | Backend client; status + content-type gates |
| `frontend/src/lib/saves.ts` (167) | frontend-io | `localStorage` saves on byte-identical keys |
| `frontend/src/screens/*.tsx` (27–180) | frontend-screens | Five phase screens |
| `frontend/src/components/*.tsx` (50–125) | frontend-components | Four presentational components |
| `frontend/e2e/smoke.spec.ts` (549) | frontend-e2e | **New.** Real-layout guard — the only place with a layout engine |

## Dependency graph

`shared/` is the hub: **18 of 33** non-test modules import `@soulbound/shared`, and it imports
nothing internal. High fan-in by design.

```bash
grep -rl '@soulbound/shared' --include=*.ts --include=*.tsx frontend/src backend/src shared/src \
  | grep -vE '\.(test|spec)\.' | wc -l          # -> 18
git ls-files '*.ts' '*.tsx' | grep -v '^\.planning/' | grep -vE '\.(test|spec)\.' \
  | grep -v '^shared/' | wc -l                  # -> 33
```

**One cycle exists and it is type-only**: `App.tsx` → `SimulationScreen.tsx` → `App.tsx`, and
`App.tsx` → `SoulCodexContents.tsx` → `App.tsx`. Both back-edges are `import type { Phase }`, which
TypeScript erases, so there is no runtime cycle. It was introduced during Phase 3's review when
`setPhase` was narrowed from `string` to the `Phase` union — a real improvement that made a typo'd
phase a compile error. If `Phase` ever needs to move, `shared/src/gameState.ts` is the natural home
and would remove the cycle entirely.

## Route surface

| Route | Model | System blocks | Notes |
|---|---|---|---|
| `POST /api/unique-skill` | `claude-sonnet-5` | **none** | CLAUDE.md #8 — sends no `system` param at all |
| `POST /api/world-engine` | `claude-opus-5` | `buildSystemBlocks()` | Shares one cache namespace with intro-scene |
| `POST /api/intro-scene` | `claude-opus-5` | `buildSystemBlocks()` | Same namespace — either may write, the other reads |
| `GET /api/health` | — | — | Liveness only; does **not** prove reachability through the proxy |

The two Opus routes must stay on the same model — caches are model-scoped, so moving either
strands the other's warmth. Models live only in `backend/src/config.ts`'s `MODELS`.

**Measured live 2026-09-18** (`.planning/phases/04-parity-verification/evidence/usage-lines.log`):
intro-scene wrote a 15,490-token prefix and all five subsequent world-engine calls read it — a
cross-route cache read, which is the property the split exists for. `unique-skill` shows zero on
both cache counters, which is correct: no system blocks means no prefix to cache.

## Configuration

| Variable | Read in | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | `backend/src/config.ts` | Fail-fast at startup. **Set it as `SOULBOUND_ANTHROPIC_KEY` on the host** — compose maps it through. Naming it `ANTHROPIC_API_KEY` in the host env diverts Claude Code's own usage onto billed credits. Nothing loads `.env` into a host-run Node process; export it or pass `--env-file`. |
| `PORT`, `FRONTEND_ORIGIN`, `ALLOWED_HOSTS` | `backend/src/config.ts` | Ports bind loopback |

## Test map

**254 tests** — 115 backend (7 files), 139 frontend (10 files) — plus **5 Playwright e2e** in a
separate suite. Counts derived by running `npm test` and `npx playwright test --list`, not restated.

Every non-test module in `lib/`, `game/`, `hooks/`, `components/` and `screens/` has a paired
`__tests__/` file. `App.tsx` has no unit test by design — it is covered by
`frontend/src/__tests__/appIntegration.test.tsx`, which drives the real component because the
wiring risk (a closure, not a rule) is structurally invisible to pure-function tests.

Tests are mutation-validated rather than coverage-measured. `applyWorldUpdate.test.ts` carries 14
`// MUTANT:` annotations (`grep -c 'MUTANT'`) naming the exact mutation each test must kill.

**Two suites, two jobs, and the split is deliberate:**

- **jsdom guards the declaration.** It performs no layout, but it *does* expose declared style
  properties — so it catches a removed `flex: 1` or `minHeight: 0`.
- **Playwright guards the consequence.** `frontend/e2e/smoke.spec.ts` asserts real geometry at
  375×800 and 1280×800: genuine overflow, genuine scrolling, action bar on screen, no collapsed
  panel, and the resize breakpoint. It runs under `test:e2e`, **not** `npm test`.

Three constraint guards added in Phase 4, each verified by mutation rather than assertion:

| Guard | File | Catches |
|---|---|---|
| CLAUDE.md #1 / #2 | `frontend/src/__tests__/constraints.test.ts` | `window.confirm/alert/prompt` **and their bare-global forms**, `window.storage` |
| CLAUDE.md #6 | `backend/src/__tests__/prompts.test.ts` | Deletion of any of the six named balance rules; a bullet-count floor |
| CLAUDE.md #4 | `backend/src/__tests__/contract.test.ts` | Prompt/schema drift — the only thing standing between a prompt edit and silent parser drift, since `tsc` cannot see inside a template string |

## Risk areas

| Risk | Where | Why |
|---|---|---|
| **Verbatim-port docstrings are load-bearing** | `App.tsx`, `applyWorldUpdate.ts`, components, screens | They record why something that looks like a bug is deliberate — `autoSave` inside a `setLog` updater, `\|\| 5` as a falsy-coalesce, a dead `changed` Set kept for fidelity. An agent "cleaning" these reverses decisions. |
| **69 citations point at a deleted file** | 25 files across `frontend/src`, `shared/src` | `legacy 787-802` and similar still resolve, but only through git. See "The retired oracle" below. |
| **Inherited closure race, knowingly unfixed** | `App.tsx` `handleAction` / `handleManualSave` | Creating a save slot mid-turn lands that turn's autosave on the old slot. Present identically in the artifact; offered at the Phase 4 planning gate and **declined**. Do not fix without asking. |
| **Nothing runs `test:e2e` in CI** | `.github/workflows/ci.yml` | CI runs `npm ci`, `npm run build`, `npm test` only. The layout guard runs when a human runs it. |
| **Inherited 8px body-margin defect** | `frontend/src/index.css` | No `body` rule, so the UA default survives; every `100vh` screen overflows by 8px and the page gains a scrollbar. Present in the artifact too — invisible there because it rendered in an iframe whose host reset margins. The e2e spec encodes it as `BODY_MARGIN_OVERHANG_PX = 8`, which should drop to 0 when a reset lands. |
| **Constraint 3's chains depend on `index.css` having no `#root` rule** | `frontend/src/index.css` | Add `display: flex` there and both layout roots become flex items inheriting `minHeight: 100vh` rather than `0`. jsdom cannot see it; the e2e spec can, and does. |
| **`runtime` frontend image is non-deployable** | `frontend/Dockerfile` | `serve -s` answers `/api/*` with 200 + HTML. Dormant until something is served from it. |
| **A green healthcheck ≠ reachable** | `backend/src/server.ts` | The Host allow-list once 403'd every proxied call while the container reported healthy. Check the proxied path, not localhost. |
| **Compose never exercised against live API calls** | `docker-compose.yml` | R14 ran host-run. The containerized path still needs `NODE_EXTRA_CA_CERTS` mounted and has never made a real call. |

## Conventions

- **Single quotes** in `.ts`; **double quotes** in ported `.tsx` (legacy style, deliberate).
- **Module headers explain *why***, and cite artifact line numbers. 69 such citations across 25 files.
- **Counts and ranges are derived, never restated.** A number in prose carries its command.
- **A fix is a claim**, and carries the same derivation burden as a finding. Adopted after Phase 4's
  review, where every fix commit seeded a smaller instance of the defect it was closing.
- **Save-key constants are imported from `@soulbound/shared`**, never redeclared — except in
  `saves.test.ts`, which hand-writes them on purpose so an internally-consistent rename is caught.
  This is measured, not argued: renaming `SAVE_PREFIX` consistently still reddens the suite.
- **Inline styles port verbatim.** Styling-system changes are out of scope project-wide.
- `noUnusedLocals` is **not** set in `frontend/tsconfig.json` — `tsc` will not catch dead imports.
  Run `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` to find them.

## The retired oracle

`legacy/souldbound-world.jsx` was the parity oracle — the behavioural reference the port was diffed
against. **It was deleted at the close of Phase 4**, once parity was confirmed against a live
playthrough. Nothing imported it; it was never built, typechecked or tested.

25 files still cite its line numbers in docstrings (69 citations). They resolve through git:

```bash
git show 3d01fa5:legacy/souldbound-world.jsx                        # the whole file
git show 3d01fa5:legacy/souldbound-world.jsx | sed -n '1022,1027p'  # a cited range
```

`3d01fa5` is an ancestor of the shipped branch, so this works in any clone. A `parity-oracle` tag
points at the same commit but is **local-only** — tag pushes fail from the agent environment, so
never assume it exists. **Do not rebase this branch**: nine documents reference that SHA by name,
and a rewrite silently breaks every one of them.

## Runbook

```bash
npm install                          # workspace root
npm run build -w @soulbound/shared   # required before either side typechecks
npm test                             # 254 tests, jsdom only, no browser
cd frontend && npm run test:e2e      # 5 Playwright tests, real layout, zero API calls

cd frontend && npx vite              # dev server, proxies /api to the backend
cd backend  && npm run dev

# Docker in this sandbox needs starting by hand (PID 1 is process_api, no service manager):
setsid nohup dockerd > /tmp/dockerd.log 2>&1 < /dev/null &
export NPM_CA_FILE=/root/.ccr/ca-bundle.crt     # builds need the proxy CA here
# containerized Anthropic calls also need it at runtime:
#   -e NODE_EXTRA_CA_CERTS=/ca/ca-bundle.crt -v /root/.ccr/ca-bundle.crt:/ca/ca-bundle.crt:ro
```

Never `docker system prune` without a re-pull path — Phase 2 lost a verification to a Docker Hub
429 after pruning its cached base image.

Playwright uses the sandbox's prebuilt Chromium; **never run `npx playwright install`**. The path is
resolved, not hardcoded, so the config also works on a normal machine.
