# Codebase Map

**Analyzed:** 2026-10-16
**Generated At:** 2026-10-16T03:56:00Z
**Map Schema Version:** 2.0
**Analyzed Commit:** f8b846e
**Source File Count:** 124
**Source Fingerprint:** 4052132c96b0642a
**Scope:** project-root
**Root:** /home/user/soulbound
**Confidence:** MEDIUM

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
_Pending: Architecture Overview is written by the model from the data below (map action narrate)._

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
_Pending: Functionality Inventory is written by the model from the data below (map action narrate)._

## Module Ownership
_Pending: Module Ownership is written by the model from the data below (map action narrate)._

## Risk Areas
_Pending: Risk Areas is written by the model from the data below (map action narrate)._

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
_Pending: Agent Guidance is written by the model from the data below (map action narrate)._

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
_Pending: Setup / Runbook is written by the model from the data below (map action narrate)._

## Pattern Library
_Pending: Pattern Library is written by the model from the data below (map action narrate)._

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
