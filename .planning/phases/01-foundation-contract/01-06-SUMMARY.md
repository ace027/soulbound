# Plan 01-06 Summary — Compose wiring & end-to-end verification

**Status**: Complete
**Wave**: 3
**Agent**: orchestrator (claude-opus-5)
**Requirements**: R1, R2

## Files Created
`docker-compose.yml`; `.env.example` extended with an optional `NPM_CA_FILE`

## Design decision made during this plan

**Compose runs the frontend's `builder` stage with Vite's dev server, not the static `runtime` stage.**

The frontend's runtime image serves a pre-built bundle via `serve`, which has **no `/api` proxy**. Running it under compose would leave the browser with no route to the backend, and this plan's own verification — "a request through the frontend's proxy path reaches the backend health route" — could not have passed. The static stage is still built and is what a production deployment would serve.

This also preserves HMR, which is the reason the exploration doc chose two containers over a single container serving static files in the first place: the developer iterates by feel, in the running app.

## Verification (all run against the real stack)
| Check | Result |
|---|---|
| `docker compose config` valid | PASS |
| `ANTHROPIC_API_KEY` on backend service | PASS |
| `ANTHROPIC_API_KEY` **absent** from frontend service | PASS — frontend carries only `BACKEND_ORIGIN` |
| Key in backend container env / frontend container env | PASS — 1 occurrence / **0 occurrences** |
| `docker compose up --build` | PASS — both images built, both containers started |
| Backend reaches `healthy` | PASS — `Up (healthy)` |
| Frontend gated on healthcheck, not container start | PASS — `Container soulbound-backend-1 Waiting → Healthy` before frontend starts |
| Backend direct `/api/health` | PASS — `{"status":"ok"}` |
| Frontend serves | PASS — HTTP 200 |
| `/api/health` **through the Vite proxy, by service name** | PASS — `x-powered-by: Express` proves a real backend round-trip, not a stub |
| Missing-key case legible at compose level | PASS — see below |

### Missing-key failure mode
```
Container soulbound-backend-1 Error dependency backend failed to start
dependency failed to start: container soulbound-backend-1 exited (1)

backend-1  | Missing required environment variable: ANTHROPIC_API_KEY
backend-1  | To fix this:
backend-1  |   1. cp .env.example .env
backend-1  |   2. Add your key to the new .env file
```
Backend exits 1 with the actionable message, compose surfaces the dependency failure, and the frontend never boots. Not an opaque crash loop.

### The optional-CA problem, solved portably
`secrets.npm_ca.file: ${NPM_CA_FILE:-/dev/null}`. On an ordinary machine `NPM_CA_FILE` is unset, the secret resolves to `/dev/null` — which exists everywhere and is empty — so the Dockerfiles' `[ -s /run/secrets/npm_ca ]` test fails and the instruction is a no-op. In a TLS-intercepting environment, pointing `NPM_CA_FILE` at a bundle makes the build trust it. Verification is never disabled, and the cert never enters an image layer.

## Phase 1 exit criteria — independently audited
| # | Criterion | Result |
|---|---|---|
| 1 | `docker compose up` starts both; frontend serves; backend health | **PASS** |
| 2 | Fail-fast without key; clean start with key | **PASS** |
| 3 | `.env.example` empty key; `.env` gitignored; `chmod 600` documented | **PASS** |
| 4 | Contract fields exact + JSON Schema derived | **PASS** — drift guard passes, and was demonstrated failing on an introduced rename |
| 5 | Static data byte-identical, verified by diff | **PASS** — 14,856 B / 23,529 B exact; arrays deep-equal |
| 6 | `docs/` move resolves `CLAUDE.md` refs; legacy under `legacy/` | **PASS** |

No criterion was marked passed on the basis of another plan's report — each was re-run here.

## Known gaps carried forward
- The frontend `dev` script and the backend `dev` watch loop are unexercised. Neither plan's verify block covered them. Worth a manual check when dev-loop iteration starts.
- No tests exist yet. Vitest contract and save round-trip tests are Phase 4 (R16).
- `legacy/souldbound-world.jsx` is retained deliberately as the parity oracle; it is deleted in Phase 4 once a full playthrough confirms parity.
