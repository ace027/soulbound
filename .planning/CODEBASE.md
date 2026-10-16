# Codebase Map

**Analyzed:** 2026-10-16
**Generated At:** 2026-10-16T03:56:00Z
**Map Schema Version:** 2.0
**Analyzed Commit:** f8b846e
**Source File Count:** 124
**Source Fingerprint:** 4052132c96b0642a
**Scope:** project-root
**Root:** /home/user/soulbound
**Confidence:** MEDIUM. The helper read 14 key files directly. The rest of the map comes from the tool's computed facts and file headers.

```yaml
map_schema_version: "2.0"
generated_at: "2026-10-16T03:56:00Z"
analyzed_commit: f8b846e
source_file_count: 124
source_fingerprint: "4052132c96b0642a"
source_fingerprint_kind: content
scope: project-root
```

## Architecture Overview
- Browser (React 19 + Vite, `frontend/`) calls only relative `/api/*` through `frontend/src/lib/api.ts`. It never holds the Anthropic key.
- Express backend (`backend/src/server.ts`, `buildApp()`) runs the Host allow-list, rate limiter and access gate, then JSON parsing, then the routers. Self-host uses `accessGate.ts` (passphrase). Hosted (`SOULBOUND_MODE=hosted`) uses the pinned chain in `hostedGate.ts`.
- Routers in `backend/src/routes/` (uniqueSkill, introScene, worldEngine, prologue) all send model calls through one chokepoint, `callWorldVoice()` in `backend/src/anthropic.ts`.
- `backend/src/config.ts` holds `MODELS` and `EFFORT`, and reads the key once at load. Secrets sit behind a redacting `Secret` wrapper.
- `shared/src/worldVoice.ts` is the Zod response contract, used for both runtime parsing and the JSON schema. `shared/src/gameState.ts` holds the shared state types.
- Frontend flow: `api.ts` parses the response, `game/applyWorldUpdate.ts` (pure) folds it into state, `App.tsx` owns the state graph, and `lib/saves.ts` persists to localStorage.

## Language Distribution
| Extension | File Count | % of Codebase |
|-----------|------------|---------------|
| .ts | 95 | 77% |
| .tsx | 28 | 23% |

## Detected Stack
| Layer | Technology | Evidence |
|-------|------------|----------|
| Runtime | Node.js | package.json |
| Framework | Vanilla Node | no framework dependency |

## Conventions Detected
- **File naming**: camelCase
- **Module structure**: Monorepo
- **Config location**: .env files, *.config files
- **Test approach**: separate test directories (70 test files)
- **Import style**: barrel files (index)
- **Linting/formatting**: none detected

## Entry Points
_None detected_

## Functionality Inventory
| Feature | Entry | Key files |
|---|---|---|
| Character creation: race, questionnaire, Unique Skill, intro scene | POST /api/unique-skill, POST /api/intro-scene | screens/QuestionnaireScreen.tsx, backend/src/routes/uniqueSkill.ts, routes/introScene.ts |
| Live simulation turn | POST /api/world-engine | routes/worldEngine.ts, screens/SimulationScreen.tsx, App.tsx (handleAction), game/applyWorldUpdate.ts |
| Skill tiers, mastery, sub-abilities, Soul Rewrite | World Voice response | game/applyWorldUpdate.ts, shared/src/worldVoice.ts, backend/src/data/worldSystemPrompt.ts |
| Saves (localStorage, self-host) | none (client-side) | frontend/src/lib/saves.ts |
| Prologue (opt-in `?prologue=1`) | POST /api/prologue/beat, /profile | backend/src/routes/prologue.ts, frontend/src/screens/PrologueScreen.tsx |
| Soul Codex sidebar | none (UI) | components/SoulCodexContents.tsx, screens/SimulationScreen.tsx |
| Self-host access gate | every /api/* except /api/health | backend/src/accessGate.ts |
| Hosted accounts, invites, sessions, account deletion | /api/auth/*, invite redeem, DELETE /api/account | backend/src/hostedGate.ts, auth.ts, invites.ts, account.ts, frontend/src/lib/authClient.ts, components/hostedAccount.tsx |
| Health check | GET /api/health | backend/src/server.ts |

## Module Ownership
| Module | Responsibility | Suggested agent |
|---|---|---|
| backend/src/server.ts, routes/* | Express pipeline, routers, error handling | engineering-backend-architect |
| backend/src/anthropic.ts, config.ts MODELS, data/worldSystemPrompt.ts, data/worldLore.ts | Model calls, cache blocks, prompt and lore | engineering-ai-engineer |
| backend/src/hostedGate.ts, accessGate.ts, auth.ts, invites.ts, account.ts | Auth, gates, invites, rate limits | engineering-security-engineer |
| backend/Dockerfile, compose, render.yaml, scripts/ | Build, deploy, test DB | engineering-infrastructure-devops |
| backend/src/__tests__/** | API and gate tests | testing-api-tester |
| shared/src/worldVoice.ts, gameState.ts | Response contract and state types | engineering-senior-developer |
| frontend/src/App.tsx, lib/api.ts, lib/saves.ts, game/applyWorldUpdate.ts | State, API client, saves, game rules | engineering-frontend-developer |
| frontend/src/screens/*, components/*, hooks/* | Layout and screens | design-ui-designer |
| frontend/src/screens/sharedBg.ts, lib/authClient.ts (untested) | Shared background, auth client | engineering-frontend-developer |

## Risk Areas
- `lib/api.ts` has the highest fan-in (12). Its content-type check guards against the 200-HTML trap, so changes ripple widely.
- Untested but critical: `sharedBg.ts` (fan-in 9), `authClient.ts` (6), `QuestionnaireScreen.tsx` (4), `hostedAccount.tsx`, `SoulCodexContents.tsx`.
- Largest files: config.ts (974 lines), server.ts (893), auth.ts (608), anthropic.ts (564), api.ts (562).
- `backend/src/routes/worldEngine.ts` imports `zod` at runtime, but only `shared/package.json` declares it, not `backend/package.json`. It works only because npm hoists it to the root.
- The 18 secret-exposure warnings are all in backend test files (`backend/src/__tests__/`). They are dummy fixture values, not real credentials.
- The prompt cache is byte-sensitive. Any per-request variation in `buildSystemBlocks()` silently destroys caching.
- The hosted middleware order is pinned by `hostedOrder.test.ts`. Moving a step breaks it.
- Two packages are a major version behind (the map tool did not name them).

## Technical Debt Signals
**TODO/FIXME/HACK/XXX density**: 0 per source file — LOW

_None detected_

### Complexity (largest files)
| File | Lines | Level |
|------|-------|-------|
| `backend/src/config.ts` | 974 | HIGH |
| `backend/src/server.ts` | 893 | HIGH |
| `backend/src/auth.ts` | 608 | HIGH |
| `backend/src/anthropic.ts` | 564 | HIGH |
| `frontend/src/lib/api.ts` | 562 | HIGH |

### Git Hotspots (90 days)
_Skipped: fewer than 10 commits in 90 days, or not a git repository._

### Hygiene
_None detected_

## Dependency Risk
**Ecosystem**: Node.js (npm)
**Direct dependencies**: 0 | **Outdated**: 15 (0%)

### Outdated Packages
| Package | Current | Latest | Severity |
|---------|---------|--------|----------|
| @types/node | 22.20.3 | 26.6.5 | major (4 behind, HIGH) |
| typescript | 5.9.3 | 7.0.2 | major (2 behind, HIGH) |
| @anthropic-ai/sdk | 0.126.0 | 0.135.0 | minor (MEDIUM) |
| @playwright/test | 1.56.1 | 1.64.1 | minor (MEDIUM) |
| @sentry/node | 11.0.0 | 11.8.0 | minor (MEDIUM) |
| express | 5.2.1 | 5.3.0 | minor (MEDIUM) |
| @vitejs/plugin-react | 6.1.1 | 6.1.2 | patch (LOW) |
| better-auth | 1.7.6 | 1.7.10 | patch (LOW) |
| jsdom | 30.1.0 | 29.1.1 | patch (LOW) |
| pg | 8.23.0 | 8.23.1 | patch (LOW) |
| react | 19.3.0 | 19.3.1 | patch (LOW) |
| react-dom | 19.3.0 | 19.3.1 | patch (LOW) |
| vite | 8.3.0 | 8.3.4 | patch (LOW) |
| vitest | 5.0.1 | 5.0.5 | patch (LOW) |
| zod | 4.6.5 | 4.6.7 | patch (LOW) |

### Dependency Risk Summary
| Metric | Value | Risk Level |
|--------|-------|------------|
| Outdated packages | 15/0 (0%) | LOW |
| Major version behind | 2 packages (@types/node, typescript) | HIGH |
| Heavy dependencies | not checked (`npm ls --all` is not run) | - |
| Potentially unmaintained | not checked (needs registry publish dates) | - |

## Agent Guidance
- Hard constraints (CLAUDE.md): no window.confirm/alert/prompt (use inline confirm). Saves stay on localStorage in self-host. Flex scroll regions need min-height: 0 on every ancestor, and a Fragment must never be the scroll container.
- World Voice field names (narration, state_updates.*, narrative_memory_updates.*, gm_note) must change in the prompt and the parser together. max_tokens must be 2000 or more.
- The MUST NOT rules are game-balance rules. Additions are fine. Removals or softenings need developer sign-off.
- determineUniqueSkill sends no system block at all. Do not give it one without confirmation.
- World engine and intro scene must share one model, pinned by backend/src/__tests__/config.test.ts. Models live only in config.ts MODELS.
- Lore facts go in WORLD_LORE; behaviour rules go in WORLD_SYSTEM_PROMPT's MUST NOT list.
- Tests sit in `__tests__/` directories (70 files, Vitest). Hosted tests use backend/vitest.hosted.config.ts and need a test DB.
- Do not touch self-host code or tests while doing hosted work, and do not move hosted middleware steps. Flag these instead. Do not paste or log secrets.

## Dependency Graph
**Files analyzed**: 124 | **Internal edges**: 90 | **External deps**: 24

### Fan-out (most imports)
| File | Imports |
|------|---------|
| `frontend/src/App.tsx` | 9 |
| `frontend/src/components/__tests__/modeGate.test.tsx` | 6 |
| `frontend/src/screens/SimulationScreen.tsx` | 6 |
| `frontend/src/components/ModeGate.tsx` | 5 |
| `frontend/src/main.tsx` | 5 |

### Fan-in (most imported)
| File | Imported by |
|------|-------------|
| `frontend/src/lib/api.ts` | 12 |
| `frontend/src/screens/sharedBg.ts` | 9 |
| `frontend/src/App.tsx` | 6 |
| `frontend/src/lib/authClient.ts` | 6 |
| `frontend/src/screens/QuestionnaireScreen.tsx` | 4 |

### Key Dependency Chains
- frontend/src/App.tsx → frontend/src/lib/api.ts → frontend/src/lib/saves.ts
- frontend/src/components/__tests__/modeGate.test.tsx → frontend/src/lib/api.ts → frontend/src/lib/authClient.ts
- frontend/src/screens/SimulationScreen.tsx → frontend/src/components/WorldLog.tsx → frontend/src/components/ActionBar.tsx

## Test Coverage Map
**Test convention**: __tests__/
**Coverage**: 70% of sampled source files have a matching test — MEDIUM
**Source**: file-name matching (no coverage report read)

### Critical Untested Files
| File | Lines | Fan-in | Risk Score | Risk Level |
|------|-------|--------|------------|------------|
| `frontend/src/screens/sharedBg.ts` | 18 | 9 | 90.2 | CRITICAL |
| `frontend/src/lib/authClient.ts` | 151 | 6 | 61.5 | CRITICAL |
| `frontend/src/screens/QuestionnaireScreen.tsx` | 256 | 4 | 42.6 | CRITICAL |
| `frontend/src/components/hostedAccount.tsx` | 27 | 4 | 40.3 | CRITICAL |
| `frontend/src/components/SoulCodexContents.tsx` | 133 | 3 | 31.3 | CRITICAL |

## API Surface
**Framework**: Vanilla Node | **Routes detected**: 10 | **Resources**: 7

| Method | Path | File |
|--------|------|------|
| GET | `/probe` | `backend/src/__tests__/accessGate.test.ts` |
| GET | `/probe` | `backend/src/__tests__/accessGate.test.ts` |
| GET | `/probe` | `backend/src/__tests__/accessGate.test.ts` |
| GET | `/protected` | `backend/src/__tests__/accessGate.test.ts` |
| POST | `/api/intro-scene` | `backend/src/routes/introScene.ts` |
| POST | `/api/prologue/beat` | `backend/src/routes/prologue.ts` |
| POST | `/api/prologue/profile` | `backend/src/routes/prologue.ts` |
| POST | `/api/unique-skill` | `backend/src/routes/uniqueSkill.ts` |
| POST | `/api/world-engine` | `backend/src/routes/worldEngine.ts` |
| GET | `/api/health` | `backend/src/server.ts` |

## Config & Environment
**Config files**: 15 detected | **Env variables**: 27 referenced | **Sensitive vars**: 7

### Config Files
| File |
|------|
| `.env.example` |
| `.github/workflows/ci.yml` |
| `.github/workflows/release.yml` |
| `backend/Dockerfile` |
| `backend/tsconfig.json` |
| `backend/vitest.config.ts` |
| `backend/vitest.hosted.config.ts` |
| `docker-compose.yml` |
| `frontend/Dockerfile` |
| `frontend/playwright.config.ts` |
| `frontend/tsconfig.json` |
| `frontend/vite.config.ts` |
| `frontend/vitest.config.ts` |
| `shared/tsconfig.json` |
| `tsconfig.base.json` |

### Environment Variables
| Variable | Source | Sensitive |
|----------|--------|-----------|
| ALLOWED_HOSTS | `backend/src/__tests__/config.test.ts` | no |
| ANTHROPIC_API_KEY | `backend/src/__tests__/anthropic.test.ts` | yes |
| BACKEND_ORIGIN | `frontend/vite.config.ts` | no |
| BETTER_AUTH_SECRET | `backend/src/__tests__/hostedConfig.test.ts` | yes |
| BETTER_AUTH_URL | `backend/src/__tests__/hosted/invites.test.ts` | yes |
| DATABASE_URL | `backend/src/__tests__/hosted/db.test.ts` | no |
| DEBUG_PROXY_HOPS | `backend/src/server.ts` | no |
| DISCORD_CLIENT_ID | `backend/src/__tests__/hostedConfig.test.ts` | no |
| DISCORD_CLIENT_SECRET | `backend/src/__tests__/hostedConfig.test.ts` | yes |
| EMAIL_FROM | `backend/src/__tests__/hostedConfig.test.ts` | no |
| FRONTEND_ORIGIN | `backend/src/__tests__/config.test.ts` | no |
| GOOGLE_CLIENT_ID | `backend/src/__tests__/hostedConfig.test.ts` | no |
| GOOGLE_CLIENT_SECRET | `backend/src/__tests__/hostedConfig.test.ts` | yes |
| NODE_ENV | `backend/src/__tests__/hostedConfig.test.ts` | no |
| PORT | `backend/src/__tests__/config.test.ts` | no |
| PW_CHROMIUM_PATH | `frontend/playwright.config.ts` | no |
| RATE_LIMIT_PER_MINUTE | `backend/src/__tests__/config.test.ts` | no |
| RESEND_API_KEY | `backend/src/__tests__/hostedConfig.test.ts` | yes |
| SENTRY_DSN | `backend/src/__tests__/hostedConfig.test.ts` | no |
| SOULBOUND_ANTHROPIC_KEY | `.env.example` | yes |
| SOULBOUND_E2E_EVIDENCE | `frontend/e2e/hosted.spec.ts` | no |
| SOULBOUND_MODE | `backend/src/__tests__/hostedConfig.test.ts` | no |
| SOULBOUND_PASSPHRASE | `backend/src/__tests__/anthropic.test.ts` | no |
| STATIC_DIR | `backend/src/__tests__/config.test.ts` | no |
| TEST_DATABASE_URL | `backend/src/__tests__/helpers/withTestDb.ts` | no |
| TRUST_PROXY | `backend/src/__tests__/config.test.ts` | no |
| USER_RATE_LIMIT_PER_MINUTE | `backend/src/__tests__/hostedConfig.test.ts` | no |

### Secret Exposure Warnings
- MEDIUM: backend/src/__tests__/anthropic.test.ts has a long literal assigned to a key/secret/token name (value not shown)
- MEDIUM: backend/src/__tests__/config.test.ts has a long literal assigned to a key/secret/token name (value not shown)
- MEDIUM: backend/src/__tests__/errorTracker.test.ts has a long literal assigned to a key/secret/token name (value not shown)
- MEDIUM: backend/src/__tests__/helpers/hostedApp.ts has a long literal assigned to a key/secret/token name (value not shown)
- MEDIUM: backend/src/__tests__/hosted/alsPropagation.test.ts has a long literal assigned to a key/secret/token name (value not shown)
- MEDIUM: backend/src/__tests__/hosted/auth.test.ts has a long literal assigned to a key/secret/token name (value not shown)
- MEDIUM: backend/src/__tests__/hosted/hostedOrder.test.ts has a long literal assigned to a key/secret/token name (value not shown)
- MEDIUM: backend/src/__tests__/hostedConfig.test.ts has a long literal assigned to a key/secret/token name (value not shown)
- MEDIUM: backend/src/__tests__/inviteCookie.test.ts has a long literal assigned to a key/secret/token name (value not shown)
- MEDIUM: backend/src/__tests__/prologueConfig.test.ts has a long literal assigned to a key/secret/token name (value not shown)
- MEDIUM: backend/src/__tests__/prologueHandoff.test.ts has a long literal assigned to a key/secret/token name (value not shown)
- MEDIUM: backend/src/__tests__/prologueRoutes.test.ts has a long literal assigned to a key/secret/token name (value not shown)
- MEDIUM: backend/src/__tests__/redact.test.ts has a long literal assigned to a key/secret/token name (value not shown)
- MEDIUM: backend/src/__tests__/routes.test.ts has a long literal assigned to a key/secret/token name (value not shown)
- MEDIUM: backend/src/__tests__/selfhostHeaders.test.ts has a long literal assigned to a key/secret/token name (value not shown)
- MEDIUM: backend/src/__tests__/selfhostNoPg.test.ts has a long literal assigned to a key/secret/token name (value not shown)
- MEDIUM: backend/src/__tests__/server.test.ts has a long literal assigned to a key/secret/token name (value not shown)
- MEDIUM: shared/src/accessGate.ts has a long literal assigned to a key/secret/token name (value not shown)

## Setup / Runbook
- Install: `npm ci` (root, workspaces shared, backend, frontend).
- Dev: `npm run dev` (all workspaces). Backend needs ANTHROPIC_API_KEY exported or passed via `--env-file`. Docker: `docker compose up` reads `.env`.
- Test: `npm test` (root). Backend: `npm test -w backend`. Hosted: `npm run test:hosted -w backend`. Frontend: `npm test -w frontend`. Frontend e2e: `npm run test:e2e -w frontend`.
- Build: `npm run build` (root; build shared first when typechecking one workspace alone). Backend is `tsc`. Frontend is `tsc --noEmit && vite build`.
- Run: `npm run start -w backend` (node dist/server.js). Migrate (hosted): `npm run migrate -w backend`.

## Pattern Library
- Single model-call chokepoint: backend/src/anthropic.ts (callWorldVoice, buildSystemBlocks).
- Zod as the shared contract: shared/src/worldVoice.ts.
- Lazy config import so the server can start without a key: backend/src/anthropic.ts (loadConfig).
- Redacting secret wrapper: backend/src/config.ts (Secret, redact).
- Pure game-rule extraction for testability: frontend/src/game/applyWorldUpdate.ts.
- Typed fetch with status and content-type checks: frontend/src/lib/api.ts.
- Import-not-redeclare storage keys: frontend/src/lib/saves.ts.

## Monorepo Structure
| Package | Path |
|---------|------|
| backend | `backend` |
| frontend | `frontend` |
| shared | `shared` |

## Directory Mappings
| Category | Primary Location | Priority | Pattern |
|----------|------------------|----------|---------|
| tests | `backend/src/__tests__` | explicit | `backend/src/__tests__/**` |
| routes | `backend/src/routes` | explicit | `backend/src/routes/**` |
| components | `frontend/src/components` | explicit | `frontend/src/components/**` |
| pages | `frontend/src/screens` | explicit | `frontend/src/screens/**` |
| utils | `frontend/src/lib` | inferred | `frontend/src/lib/**` |
| hooks | `frontend/src/hooks` | inferred | `frontend/src/hooks/**` |
| scripts | `scripts` | inferred | `scripts/**` |
| docs | `docs` | inferred | `docs/**` |

### Path Enforcement Rules
Strictness: warn (writes outside a category's location are reported, not blocked).

## Retrieval Artifacts
- Chunk index: `.planning/codebase/index.jsonl`
- Symbols: `.planning/codebase/symbols.json`
- Search guide: `.planning/codebase/search.md`
