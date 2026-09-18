# The Soulbound Chronicles

A Tensura-inspired text RPG set in the original fantasy world of Vaeltharion, where Claude acts as "The World Voice" — an AI game master narrating an entire living world. This application is a Dockerized migration of the original single-file React artifact, now structured as a TypeScript monorepo with a proper frontend/backend split, a backend that securely holds the Anthropic API key, and a shared World Voice JSON contract enforced as compile-time types.

## Setup

1. Copy the environment template:
   ```bash
   cp .env.example .env
   ```

2. Add your Anthropic API key to `.env`:
   ```bash
   # Edit .env and paste your key from https://console.anthropic.com/account/keys
   ANTHROPIC_API_KEY=your-key-here
   chmod 600 .env
   ```

3. The key is now readable only by the owner and passed securely to the backend container.

## Run

Start the full stack:
```bash
docker compose up
```

- Frontend: http://localhost:5173 (Vite dev server with hot reload)
- Backend: http://localhost:3001 (API server for World Voice calls)

## Repository Layout

- **`frontend/`** — React + Vite UI (Phase 1 Plan 4)
- **`backend/`** — Node.js + Express API server; holds the Anthropic API key (Phase 1 Plan 3)
- **`shared/`** — TypeScript types and the World Voice JSON contract (Phase 1 Plan 2)
- **`docs/`** — Project documentation:
  - `PROJECT-BACKGROUND.md` — full vision and roadmap
  - `MIGRATION-PLAN.md` — current migration state
  - `design-decisions-log.md` — detailed rationale for game systems
- **`package.json`** — Monorepo root with workspace declarations
- **`tsconfig.base.json`** — Shared TypeScript configuration

## Legacy Artifact — retired

`legacy/souldbound-world.jsx` was the pre-migration artifact: a complete, playable game in 1,440
lines of React, and the parity oracle for this migration. **It was deleted at the close of Phase 4**,
once parity had been confirmed against a live end-to-end playthrough. The directory no longer exists.

Docstrings across `frontend/src` and `shared/src` still cite it by line number (`legacy 787-802`,
`legacy 1022-1027`, and 67 others). Those citations still resolve — read the file from the tag:

```bash
git show parity-oracle:legacy/souldbound-world.jsx                        # the whole file
git show parity-oracle:legacy/souldbound-world.jsx | sed -n '1022,1027p'  # a cited range
```

See `docs/design-decisions-log.md` → "Legacy artifact retired" for the full reasoning.

No game behavior changes unless explicitly requested; this repo validates that migration produces
identical gameplay under the new architecture.

## Architecture

The application splits concerns into three layers:

- **Frontend** (`frontend/`) consumes the React artifact's components and game logic, communicating with the backend via HTTP
- **Backend** (`backend/`) exposes three API routes mirroring the artifact's World Voice calls, proxies them through the Anthropic SDK, and manages the API key securely
- **Shared** (`shared/`) defines the World Voice JSON contract as TypeScript types and JSON Schema, so any prompt/parser drift becomes a compile error

Environment variables are read once at backend startup with fail-fast validation; the key never appears in logs, error responses, or the frontend bundle.
