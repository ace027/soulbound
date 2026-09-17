# Plan 01-03 Summary — Backend service skeleton

**Status**: Complete
**Wave**: 2
**Agent**: Backend Architect (claude-sonnet-5), with two orchestrator fixes
**Requirements**: R1, R2

## Files Created
`backend/package.json`, `backend/tsconfig.json`, `backend/src/config.ts`, `backend/src/server.ts`, `backend/Dockerfile`

## Verification (re-run independently by the orchestrator)
| Check | Result |
|---|---|
| Missing key → exit non-zero, actionable message | PASS — names `ANTHROPIC_API_KEY`, points at `.env.example`, exit 1 |
| Present key → starts cleanly | PASS — `[soulbound-backend] listening on port 3001` |
| `GET /api/health` | PASS — `{"status":"ok"}` |
| Unmatched route returns JSON | PASS **after fix** — see below |
| Key absent from server log | PASS — `grep sk-ant-FAKEKEY` → 0 matches |
| `npm run build -w @soulbound/backend` | PASS — exit 0 |
| `docker build -f backend/Dockerfile .` | PASS **after fix** — exit 0 |
| Container runs as non-root | PASS — `whoami` → `node` |
| No key or CA baked into image | PASS — `docker history` → 0 matches |
| No key literal under `backend/` | PASS |

## Two gaps found during orchestrator verification

**1. Unmatched routes returned Express's default HTML error page.** The agent verified a thrown 500 but never tested an unmatched route. `GET /api/does-not-exist` returned `<!DOCTYPE html>...Cannot GET`, which a JSON client cannot parse — Phase 3's fetch wrapper would have failed inside `JSON.parse` instead of surfacing a clean 404. Added a JSON 404 handler ahead of the error handler. Now returns `{"error":{"message":"Not found","code":"NOT_FOUND"}}`, verified both at host level and inside the built image.

**2. `docker build` failed in this sandbox.** Root cause confirmed against `/root/.ccr/README.md`: outbound HTTPS is TLS-intercepted by the session's egress proxy, so anything inside a container must trust `/root/.ccr/ca-bundle.crt`. Not a Dockerfile defect — but it would have blocked Plan 06's `docker compose up`, which is a Phase 1 exit criterion.

Fixed with a BuildKit secret mount declared `required=false`:
```dockerfile
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci
```
On an ordinary deployer's machine the secret is absent and this is a no-op. In a proxied environment the CA is added to the trust set. TLS verification is never disabled (explicitly forbidden by the proxy README), and because it is a secret mount rather than a `COPY`, the certificate never becomes an image layer — confirmed by `docker history`.

The agent had worked around this with a throwaway `Dockerfile.verify-only` and correctly reported it could not claim a clean pass on the committed file. That was the right call, and it surfaced the problem early enough to fix properly rather than discovering it in Plan 06.

## Agent decisions flagged, accepted
- **Express 5** (`^5.2.1`) rather than 4.x — its built-in handling of thrown/rejected errors in route handlers suits the central error handler better. Flagged explicitly by the agent rather than chosen silently.
- **No `cors` package** — CORS implemented as ~10 lines of header middleware scoped to `FRONTEND_ORIGIN` (default `http://localhost:5173`). Correct minimal-diff call; the plan's dependency list didn't include it.
- **`Secret` class** wrapping the key with `toJSON`/`toString`/`util.inspect.custom` all returning `[REDACTED]` and a private `#value`. Goes slightly beyond the plan's redaction helper, in the direction the plan intended.

## Not verified
- The `dev` script (`tsc --watch` + `node --watch`) was not exercised. The plan's verify block doesn't cover it. Worth a manual check when dev-loop iteration starts.

## Models configured (centralized in `config.ts`, per R6)
`uniqueSkill: claude-sonnet-5` · `worldEngine: claude-opus-5` · `introScene: claude-opus-5` — exact strings, no date suffixes. Phase 2 consumes these.
