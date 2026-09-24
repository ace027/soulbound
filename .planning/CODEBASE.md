# Codebase Map — The Soulbound Chronicles

```yaml
map_schema_version: 1
generated_at: "2026-09-24"
analyzed_commit: 35ac80904b435a4002ab6bba91735b6f7f7e27ad
source_file_count: 63
source_fingerprint: 76035132f82dfdd9
source_fingerprint_kind: sha256(sorted git blob hashes of tracked .ts/.tsx outside .planning/)[:16]
scope: full-project
symbol_count: 150
chunk_count: 63
```

> **Refreshed after Phase 5 and the 2026-09-24 playtest fixes.** The previous map (`1506c3a`,
> fingerprint `9ff2babb3c9f807f`) predated the access gate, the rate limiter, single-image serving,
> the frontend passphrase screen, the narration-length and Unique Skill legibility prompt changes,
> and the polish pass. 7 files are new (3 modules, 1 component, 3 tests). All counts below are
> derived; each carries its command.

---

## Architecture

A TypeScript monorepo in three npm workspaces, migrated from a single 1,440-line React artifact.
The migration is complete (Phases 1-4 shipped, the artifact is gone), and Phase 5 made it
publishable: one image, gated by a deployer-set passphrase.

```
shared/     ← the contract. Zod schemas + derived JSON Schema + game-state types.
  ↑     ↑
backend/  frontend/
```

`shared/` is imported by both sides and imports neither. That is the whole architectural idea:
the World Voice JSON field names exist once, so prompt/parser drift becomes a compile error rather
than a runtime surprise. This repo's historical failure mode was drift *between* the three API call
sites, not any one of them being wrong.

**Request path**: `frontend/src/lib/api.ts` (adds `Authorization: Bearer <passphrase>`) → relative
`/api/*` → Vite proxy (dev) or the same origin (single image) → Express: Host allow-list → CORS →
`/api/health` → rate limiter → passphrase gate → `express.json` → `backend/src/routes/*` → one shared
`callWorldVoice()` helper → Anthropic SDK. The order is load-bearing and pinned by tests: the limiter
and gate run **before** body parsing, so an unauthenticated 1 MB body gets 401, not 413.

**Serving**: with `STATIC_DIR` set, the backend also serves the built frontend (`backend/Dockerfile`
`runtime` stage). `/api/*` can never return `index.html`: the `/api` JSON 404 is mounted before the
static block, and the SPA fallback only answers paths without a file extension.

The frontend never talks to `api.anthropic.com`. A test asserts this rather than a convention
requesting it.

## Module structure

| Path | Domain | Role |
|---|---|---|
| `shared/src/worldVoice.ts` (386) | contract | Zod schemas, derived JSON Schemas, `assertWorldVoiceContract` |
| `shared/src/gameState.ts` (201) | contract | Race/Skill/GameState/LogEntry/SaveSlot, save keys, `TIER_STYLE` |
| `shared/src/accessGate.ts` (33) | contract | **New (Phase 5).** Header, scheme, storage key, error codes, check path, min length |
| `backend/src/anthropic.ts` (529) | backend | `buildSystemBlocks()` (1h TTL), per-route `EFFORT`, `callWorldVoice()`, typed error taxonomy |
| `backend/src/config.ts` (488) | backend | `MODELS`, key + passphrase loading (both deleted from `process.env` before validation), `redact()`, port/origin/host/limit/static config |
| `backend/src/accessGate.ts` (209) | backend | **New (Phase 5).** `createRateLimiter` (fixed window, 10k-key cap) and `createAccessGate` (SHA-256 + `timingSafeEqual`) |
| `backend/src/server.ts` (421) | backend | `buildApp()`: the middleware order above, `/api/access`, static serving, error handler |
| `backend/src/routes/*.ts` (144–257) | backend | Three World Voice routes on one helper |
| `backend/src/data/*.ts` (84, 157) | prompt-data | `WORLD_LORE`, `WORLD_SYSTEM_PROMPT` |
| `backend/src/untrustedText.ts` (80) | backend | Player-text delimiting; prompt-injection guard |
| `frontend/src/main.tsx` | frontend-app | Wraps `<App/>` in `<AccessGate>` |
| `frontend/src/App.tsx` (375) | frontend-app | 16 `useState` + 1 `useRef`; all handlers; renders by phase. **Byte-identical to `7856b7d`** |
| `frontend/src/components/AccessGate.tsx` (285) | frontend-components | **New (Phase 5).** Inline passphrase form before the title screen; fails open on an unreachable server |
| `frontend/src/lib/passphrase.ts` (84) | frontend-io | **New (Phase 5).** `localStorage` store (`sbc-access-passphrase`), printable-ASCII guard, required-event bus |
| `frontend/src/game/applyWorldUpdate.ts` (211) | game-logic | The pure turn logic (R10) |
| `frontend/src/game/narrativeMemory.ts` (89) | game-logic | `mergeNarrativeMemory` — the ONE entity-ledger/notes merge |
| `frontend/src/lib/api.ts` (413) | frontend-io | Backend client; Bearer header, status + content-type gates, `checkAccess()` |
| `frontend/src/lib/saves.ts` (166) | frontend-io | `localStorage` saves on byte-identical keys |
| `frontend/src/screens/*.tsx` | frontend-screens | Five phase screens |
| `frontend/src/components/*.tsx` (49–124) | frontend-components | Four presentational components (plus `AccessGate`) |
| `frontend/e2e/smoke.spec.ts` (663) | frontend-e2e | Real-layout guard, plus the passphrase form — the only place with a layout engine |

Line counts are `wc -l`. Outside TypeScript: `backend/Dockerfile` (builder → frontend-build → api →
runtime), `scripts/smoke-image.sh` (7 checks against a built image), `.github/workflows/ci.yml`
(build, test, smoke-image), `.github/workflows/release.yml` (dispatch-only GHCR publish),
`compose.selfhost.yml`.

## Dependency graph

`shared/` is the hub: **22 of 37** non-test modules import `@soulbound/shared`, and it imports
nothing internal. High fan-in by design.

```bash
grep -rl '@soulbound/shared' --include=*.ts --include=*.tsx frontend/src backend/src shared/src \
  | grep -vE '\.(test|spec)\.' | wc -l          # -> 22
git ls-files '*.ts' '*.tsx' | grep -v '^\.planning/' | grep -vE '\.(test|spec)\.' \
  | grep -v '^shared/' | wc -l                  # -> 37
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
| `POST /api/unique-skill` | `claude-opus-5`, effort `medium` | **none** | CLAUDE.md #8 — sends no `system` param at all |
| `POST /api/world-engine` | `claude-sonnet-5`, effort `high` | `buildSystemBlocks()` | Shares one cache namespace with intro-scene |
| `POST /api/intro-scene` | `claude-sonnet-5`, effort `high` | `buildSystemBlocks()` | Same namespace — either may write, the other reads |
| `GET /api/access` | — | — | **New (Phase 5).** 204 with the right passphrase, 401 `PASSPHRASE_REQUIRED` without; the frontend's pre-title check |
| `GET /api/health` | — | — | Liveness only; the one `/api` route outside the gate and limiter. Does **not** prove reachability |

Every route except `/api/health` sits behind the limiter (default 30/min per client, 429
`TOO_MANY_REQUESTS` + `Retry-After`) and the gate (401 `PASSPHRASE_REQUIRED`). Upstream Anthropic
failures keep their own codes (401 `AUTHENTICATION_FAILED`, 429 `RATE_LIMITED`), and the frontend
tells them apart: only `PASSPHRASE_REQUIRED` clears the stored passphrase.

**Prompt changes 2026-09-24** (design log → "Narration length", "Unique Skill legibility"): turn
narration is 1-2 short paragraphs, the intro 2 short paragraphs; the Unique Skill `description` is a
concrete effect plus its cost; and that description now reaches the intro prompt and every
world-engine prompt (`UNIQUE SKILL — WHAT IT DOES`). The world-engine skill `description` is optional
in the request schema, so old saves still load.

**PR #4 swapped the split** (it was Opus on the pair, Sonnet on unique-skill). The invariant is
not which model: world-engine and intro-scene must stay on the **same** model *and* the same
`effort`, because caches are model-scoped and `output_config` is part of the matched prefix.
Pinned by `backend/src/__tests__/config.test.ts`. Models live only in `backend/src/config.ts`'s
`MODELS`; effort only in `anthropic.ts`'s per-route `EFFORT`. This arrangement has reversed twice,
deliberately — do not "correct" it back (CLAUDE.md, Model & API pattern).

**Cached prefix: 15,607 tokens**, measured live 2026-09-24
(`.planning/experiments/2026-09-24-narration-length/usage-lines.log`) after the narration-length edit.
It moves whenever `WORLD_SYSTEM_PROMPT` or `WORLD_LORE` changes — re-derive with `count_tokens`
(free) rather than re-measuring. The `WORLD_LORE` block carries `ttl: '1h'`; the break-even
arithmetic is in `buildSystemBlocks()`'s docstring and is workload-specific. `unique-skill` shows
zero on both cache counters, which is correct: no system blocks means no prefix to cache.
(`CLAUDE.md` still quotes 15,523; the design log carries 15,607.)

## Configuration

| Variable | Read in | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | `backend/src/config.ts` | Fail-fast at startup. **Set it as `SOULBOUND_ANTHROPIC_KEY` on the host** — compose maps it through. Naming it `ANTHROPIC_API_KEY` in the host env diverts Claude Code's own usage onto billed credits. Nothing loads `.env` into a host-run Node process; export it or pass `--env-file`. |
| `SOULBOUND_PASSPHRASE` | `backend/src/config.ts` | **Required at boot** (12+ printable ASCII). Deleted from `process.env` once read; never logged (`redact()` strips it) |
| `RATE_LIMIT_PER_MINUTE` | `backend/src/config.ts` | Default 30, range 1-600 |
| `TRUST_PROXY` | `backend/src/config.ts` | Opt-in hop count or subnet; `true` is rejected (every hop spoofable). Docker port publishing is not a proxy |
| `STATIC_DIR` | `backend/src/config.ts` | Set in the `runtime` image (`/app/public`); unset in dev |
| `PORT`, `FRONTEND_ORIGIN`, `ALLOWED_HOSTS` | `backend/src/config.ts` | Ports bind loopback. In `compose.selfhost.yml`, `ALLOWED_HOSTS` always keeps `localhost:3001` so the in-container healthcheck passes on any host port |

## Test map

**377 tests**: 187 backend (8 files) and 190 frontend (13 files), plus **6 Playwright e2e** in a
separate suite. Derived by running `npm test` and `npx playwright test --list`, not restated.

Every non-test module in `lib/`, `game/`, `hooks/`, `components/` and `screens/` has a paired
`__tests__/` file — including the new `game/__tests__/narrativeMemory.test.ts`. The
entity-ledger-seeding fix is also pinned end-to-end in `appIntegration.test.tsx`, because the bug
was a wiring omission in `App.tsx`, not a rule error. `App.tsx` has no unit test by design — it is covered by
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

Phase 5 added guards for the gate itself, each mutation-verified (`05-06-SUMMARY.md` §6): the gate
fails closed (`routes.test.ts`), the passphrase never reaches logs or bodies (`config.test.ts`,
`routes.test.ts`, smoke check 7), and `/api/*` never returns HTML (`routes.test.ts`, smoke check 5).
The one survivor is recorded as behaviourally equivalent: `timingSafeEqual` → `===` changes timing,
not results, so it is guarded by review only.

The three prompt render functions are pinned byte-for-byte by `backend/src/__tests__/fixtures/*.prompt.txt`.
Regenerate a fixture from the render function after an intentional prompt change; never hand-edit
one to make a test pass.

## Risk areas

| Risk | Where | Why |
|---|---|---|
| **Verbatim-port docstrings are load-bearing** | `App.tsx`, `applyWorldUpdate.ts`, components, screens | They record why something that looks like a bug is deliberate — `autoSave` inside a `setLog` updater, `\|\| 5` as a falsy-coalesce, a dead `changed` Set kept for fidelity. An agent "cleaning" these reverses decisions. |
| **69 citations point at a deleted file** | 13 source files across `frontend/src`, `shared/src` | `legacy 787-802` and similar still resolve, but only through git. See "The retired oracle" below. |
| **Inherited closure race, knowingly unfixed** | `App.tsx` `handleAction` / `handleManualSave` | Creating a save slot mid-turn lands that turn's autosave on the old slot. Present identically in the artifact; offered at the Phase 4 planning gate and **declined**. Do not fix without asking. |
| **Nothing runs `test:e2e` in CI** | `.github/workflows/ci.yml` | CI runs build, `npm test` and the image smoke test. The layout guard runs when a human runs it. |
| **Inherited 8px body-margin defect** | `frontend/src/index.css` | No `body` rule, so the UA default survives; every `100vh` screen overflows by 8px and the page gains a scrollbar. Present in the artifact too — invisible there because it rendered in an iframe whose host reset margins. The e2e spec encodes it as `BODY_MARGIN_OVERHANG_PX = 8`, which should drop to 0 when a reset lands. |
| **Constraint 3's chains depend on `index.css` having no `#root` rule** | `frontend/src/index.css` | Add `display: flex` there and both layout roots become flex items inheriting `minHeight: 100vh` rather than `0`. jsdom cannot see it; the e2e spec can, and does. |
| **Middleware order is the security model** | `backend/src/server.ts` `buildApp()` | Moving `express.json` above the limiter/gate, or the static block above the `/api` 404, is caught by tests — but only because mutations proved those tests exist. Read `buildApp()`'s docstring before touching the order. |
| **The first GHCR publish has never run** | `.github/workflows/release.yml` | The push, arm64, the real existence-check response and the post-push layer check can only run after merge. Each fails closed; runbook in README → "First release". |
| **Post-review prompt changes** | `backend/src/data/worldSystemPrompt.ts`, `routes/*.ts` | The 2026-09-24 narration and Unique Skill changes landed after Phase 5's 3-cycle review. Covered by fixtures, live runs and a re-run of the Tier 0 adversarial tests, not by the review panel. |
| **Two callers, one merge** | `game/narrativeMemory.ts` | Character creation once built its ledger inline and dropped the intro scene's entities, so turn 1 denied the NPC it had just been shown. Any new path that constructs a `GameState` must go through `mergeNarrativeMemory`, not a literal. |
| **A green healthcheck ≠ reachable** | `backend/src/server.ts` | The Host allow-list once 403'd every proxied call while the container reported healthy. Check the proxied path, not localhost. |
| **Containers never exercised against live API calls** | `docker-compose.yml`, `compose.selfhost.yml` | Every live run (R14, 2026-09-24) was host-run. The containerized path still needs `NODE_EXTRA_CA_CERTS` mounted here and has never made a real call. |

## Conventions

- **Single quotes** in `.ts` and in new `.tsx` (`AccessGate.tsx`); **double quotes** in ported `.tsx` (legacy style, deliberate).
- **No native dialogs, ever** (CLAUDE.md #1) — the passphrase screen is an inline form, not `window.prompt`.
- **Module headers explain *why***, and cite artifact line numbers. 69 such citations across 13 source files.
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

13 source files still cite its line numbers in docstrings (69 citations —
`git grep -hoE 'legacy [0-9]+(-[0-9]+)?' HEAD -- frontend/src shared/src backend/src | wc -l`). They resolve through git:

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
npm test                             # 377 tests, jsdom only, no browser
npm run test:e2e -w frontend         # 6 Playwright tests, real layout, zero API calls

cd frontend && npx vite              # dev server, proxies /api to the backend
cd backend  && npm run dev            # needs ANTHROPIC_API_KEY and SOULBOUND_PASSPHRASE exported

# single image, as published:
docker build --secret id=npm_ca,src=${NPM_CA_FILE:-/dev/null} -f backend/Dockerfile -t soulbound:local .
scripts/smoke-image.sh soulbound:local     # 7 checks; uses fake keys

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
