The backend now serves the built frontend itself when `STATIC_DIR` is set, and
`backend/Dockerfile` builds the one image that ships it — a `frontend-build`
stage on `$BUILDPLATFORM`, an `api` stage (today's runtime, no bundle, what
dev builds), and a final `runtime` stage (`FROM api`) that adds the bundle as
`/app/public`. The frontend Dockerfile's dead `runtime`/`serve` stage is gone.

## Status: Complete

## Tasks

### Task 1 — Static serving + SPA fallback in `buildApp`
`backend/src/server.ts`: `AppConfig` gained `STATIC_DIR?: string`. When set,
after the existing `/api`-scoped JSON 404, `buildApp` registers
`express.static(STATIC_DIR)`, then `app.get(/.*/, …)` which calls `next()` for
any path with a file extension (`path.extname(req.path) !== ''`) and
`res.sendFile(index.html)` otherwise. The pre-existing global JSON 404 stays
last, now doing double duty: the only handler when `STATIC_DIR` is unset, and
the catch for an extensioned-but-unrecognized path (a stale chunk) when it is
set. Verified Express 5 route syntax by test rather than memory: `app.get(/.*/,
…)` works on the installed 5.2.1 (all static-mode tests pass with it), matching
what the plan critic had already confirmed.

Added a new `describe('static serving (STATIC_DIR set)', …)` block to
`routes.test.ts` with a `mkdtemp` fixture (`index.html` + `assets/app.js`),
created in `beforeAll`, removed in `afterAll`:
- `GET /` and `GET /some/deep/link` → 200, `text/html`, body contains the
  fixture's `<title>`
- `GET /assets/app.js` → 200, exact file contents
- `GET /assets/missing-chunk.js` → 404, `application/json`, never
  `text/html` (the stale-chunk trap)
- `GET /api/nope` and `POST /api/nope` (valid passphrase) → JSON 404
- `GET /API/nope` (valid passphrase) → JSON 404, never HTML (mixed-case)
- `GET /api/nope` with no passphrase → 401 `PASSPHRASE_REQUIRED` (gated
  before the 404)
- with `STATIC_DIR` unset, `GET /` → JSON 404 (unchanged behaviour)

Verify:
```
$ npm run build -w @soulbound/shared && npm run build -w @soulbound/backend
(clean, 0 errors)
$ npm test -w @soulbound/backend
 Test Files  8 passed (8)
      Tests  187 passed (187)
```
Committed at `b9181de` before the mutation sweep.

Mutation sweep (mutate → test → `git checkout -- backend/src/server.ts` →
`git diff --exit-code`), per protocol:

| # | Mutation | Result |
|---|---|---|
| (a) | Register the static block (and its SPA fallback) BEFORE `app.use('/api', notFound)` instead of after | **RED** — 2 tests failed: `returns a JSON 404 for an unmatched /api path…` and `…mixed-case /api path…` both got 200 (HTML) instead of 404 |
| (b) | Replace the `/api`-scoped 404's `app.use('/api', …)` mount with a hand-written `app.use((req, res, next) => { if (!req.path.startsWith('/api')) { next(); return; } … })` | **RED** — 1 test failed: `…mixed-case /api path with a valid passphrase, never HTML` got 200 (`/API/nope` doesn't start with lowercase `/api`, so the string check let it fall through to the SPA fallback) |

Both mutations caught, confirmed restored clean (`git diff --exit-code`)
before proceeding.

### Task 2 — `backend/Dockerfile` stage split + `$BUILDPLATFORM` frontend build
`backend/Dockerfile` now has four stages:
- `builder` (unchanged) — compiles `shared` + `backend`
- `frontend-build` (new), `FROM --platform=$BUILDPLATFORM node:22-slim` —
  copies root/`shared`/`frontend` manifests, `npm ci` with the `npm_ca`
  secret mount (no uid/gid pin — runs as root, a throwaway build stage with
  no artifact in the final image beyond static files; the comment explains
  why this doesn't need `USER node` the way the dev frontend builder does),
  copies `tsconfig.base.json`/`shared`/`frontend`, builds `shared` then
  `frontend`
- `api` (renamed from the old `runtime`, unchanged content) — the dev
  target, no bundle
- `runtime` (new), `FROM api` — adds
  `COPY --chown=node:node --from=frontend-build /app/frontend/dist /app/public`
  and `ENV STATIC_DIR=/app/public`; last stage declared, so an untargeted
  build produces it

`frontend/Dockerfile`: deleted the `runtime` stage and the `serve@14`
install (`:51-69` at plan-check time); header rewritten to say the file now
exists only for the dev compose's `builder` target.

`docker-compose.yml`: backend service's `build:` gained `target: api` with a
comment explaining why (dev serves the frontend from Vite; a dev rebuild must
neither build nor ship a stale bundle).

Docker daemon: started with
`setsid nohup dockerd > /tmp/dockerd.log 2>&1 < /dev/null &`, polled
`docker version` until ready, `export NPM_CA_FILE=/root/.ccr/ca-bundle.crt`.
Hit `429 Too Many Requests` pulling `node:22-slim` from Docker Hub on the
first two attempts (unrelated to the proxy — an anonymous-pull rate limit);
retried with a short delay and it succeeded, after which the image was
cached locally for the rest of the session.

Build:
```
$ DOCKER_BUILDKIT=1 docker build --secret id=npm_ca,src=${NPM_CA_FILE:-/dev/null} \
    -f backend/Dockerfile -t soulbound:05-04 .
... (all 4 stages build clean; frontend-build's vite build:
     dist/index.html 1.00 kB, dist/assets/index-B3l2FnTO.js 352.74 kB) ...
#27 naming to docker.io/library/soulbound:05-04 done
```
```
$ docker run --rm soulbound:05-04 ls /app/public
assets
index.html
$ docker run --rm soulbound:05-04 id -u
1000
```

Verify (task's own commands):
```
$ DOCKER_BUILDKIT=1 docker build --secret id=npm_ca,src=${NPM_CA_FILE:-/dev/null} \
    -f frontend/Dockerfile --target builder -t soulbound-frontend-builder:05-04 .
... builds clean, vite build succeeds ...
#17 naming to docker.io/library/soulbound-frontend-builder:05-04 done

$ DOCKER_BUILDKIT=1 docker build --secret id=npm_ca,src=${NPM_CA_FILE:-/dev/null} \
    -f backend/Dockerfile --target api -t soulbound-api:05-04 .
... all layers CACHED from the earlier full build, builds clean ...
#19 naming to docker.io/library/soulbound-api:05-04 done

$ docker run --rm soulbound-api:05-04 sh -c 'test ! -e /app/public && echo no-bundle'
no-bundle
```
Committed at `6984d0e`.

### Task 3 — `docker-compose.yml` header comment
Rewrote the header comment (formerly `:9-23`, describing the old
`serve -s dist` SPA-fallback trap, which no longer exists) to say: this file
is dev-only; the published app is one image built untargeted from
`backend/Dockerfile`, the backend serving the bundle same-origin; here the
two halves still run separately (Vite `builder` for HMR, backend `target:
api`) and why; kept the "a healthy container is not proof the app is
reachable" lesson, now pointing at the `ALLOWED_HOSTS` comment as where that
failure mode is documented. Named it "the self-host compose file" since
05-06 (which adds `compose.selfhost.yml`) hasn't landed yet in this
session's history. No service settings changed beyond task 2's `target: api`
line (already committed).

Verify:
```
$ SOULBOUND_PASSPHRASE=placeholder-passphrase docker compose --env-file /dev/null config -q
(exit 0)
$ SOULBOUND_PASSPHRASE=placeholder-passphrase docker compose --env-file /dev/null config \
    | grep -A1 "target:"
      target: api
      ...
      target: builder
      ...
$ grep -n "Dormant\|serve -s" docker-compose.yml
(no matches)
```

Stopped dockerd at the end (`pkill -x dockerd containerd`; confirmed
`docker version` then fails to connect).

## Final `buildApp` tail order (from `backend/src/server.ts`)

```
Host allow-list
  → CORS
  → GET /api/health
  → app.use('/api', rateLimiter)
  → app.use('/api', accessGate)
  → app.use('/api', express.json)
  → GET /api/access
  → uniqueSkillRouter, worldEngineRouter, introSceneRouter
  → app.use('/api', notFound)                       // JSON 404, /api-scoped
  → [only if STATIC_DIR set]
      express.static(STATIC_DIR)
      app.get(/.*/, extensionless-fallback-to-index.html)
  → app.use(globalNotFound)                          // JSON 404, catch-all
  → errorHandler
```

## Files modified
- `backend/src/server.ts`
- `backend/src/__tests__/routes.test.ts`
- `backend/Dockerfile`
- `frontend/Dockerfile`
- `docker-compose.yml`
- `.planning/phases/05-docker-image-publishing/05-04-SUMMARY.md` (this file)

## Test counts
- Backend: **180 → 187** (+7), all in the new `static serving (STATIC_DIR
  set)` describe block in `routes.test.ts`.
- Frontend: unchanged (this plan touches no frontend source).
- `npm run build` clean across `shared`/`backend`/`frontend`.
- `npm test -w @soulbound/backend` → `Test Files 8 passed (8)`,
  `Tests 187 passed (187)`.

## Mutation table (task 1)

| # | Mutation | File | Result |
|---|---|---|---|
| (a) | Register `express.static`/SPA fallback before `app.use('/api', notFound)` | `server.ts` | **RED** — 2 tests failed (unmatched `/api` path and mixed-case `/API` path both fell through to HTML) |
| (b) | Replace the `/api`-scoped 404's `app.use('/api', …)` mount with `req.path.startsWith('/api')` | `server.ts` | **RED** — 1 test failed (`/API/nope`, mixed case, no longer matched the string-prefix check and fell through to HTML) |

Both restored with `git checkout -- backend/src/server.ts`, confirmed clean
with `git diff --exit-code` before the next step. Nothing else wrote to the
tree during the sweep.

## Image facts

```
$ docker image ls soulbound:05-04
IMAGE             ID             DISK USAGE   CONTENT SIZE
soulbound:05-04   9ea5325bf81d   373MB        87.4MB

$ docker run --rm soulbound:05-04 ls /app/public
assets
index.html

$ docker run --rm soulbound:05-04 id -u
1000
```

## Dev-target checks
- `docker build -f backend/Dockerfile --target api .` — builds clean (all
  layers cached from the full build); `docker run --rm <api image> sh -c
  'test ! -e /app/public && echo no-bundle'` → `no-bundle`.
- `docker build -f frontend/Dockerfile --target builder .` — still builds
  clean; the `vite build` step inside it succeeds (this is the dev frontend
  builder stage, unaffected by the `runtime` stage's removal).

## Decisions made
- `frontend-build` runs as root, not `node`, unlike the dev frontend
  Dockerfile's `builder` stage. Justified in a Dockerfile comment: it is a
  throwaway build stage — nothing from it ships except the static `dist`
  output copied into `runtime`, so there is no running process or writable
  filesystem in the final image to protect by dropping privileges in this
  stage. The privilege drop that matters (`USER node`) lives on `api`/
  `runtime`, which do ship and run.
- Kept `frontend-build` as an independent stage (not chained after
  `builder`) since it needs a different `--platform` and copies a different
  manifest set (`frontend/package.json`, not `backend/package.json`);
  BuildKit still parallelizes it with `builder` where possible (visible in
  the build log's interleaved stage output) and skips it entirely for a
  `--target api` build, per the plan's own note that BuildKit skips unused
  stages.
- Named the compose header's forward reference "the self-host compose file"
  rather than "compose.selfhost.yml (05-06)" per the plan's own instruction,
  since 05-06 has not landed in this session.
- Docker Hub's `429` on the first two `node:22-slim` pulls was treated as a
  transient anonymous-pull rate limit and retried with a short delay rather
  than investigated as a proxy misconfiguration — the third attempt
  succeeded outright and every build afterward used the now-cached local
  image with zero further registry calls for that tag.

## Issues / carry-forward notes for 05-05 and 05-06
- **Image tag built in this session:** `soulbound:05-04` (built from the
  repo root with `backend/Dockerfile`, untargeted → the `runtime` stage).
  This tag is local-only (not pushed) and was not deleted at the end of this
  plan, so 05-05's `scripts/smoke-image.sh` can reuse it directly if this
  container's Docker state persists into that session; otherwise rebuild
  with the exact command below.
- **Build command that worked** (repo root as build context):
  ```
  export NPM_CA_FILE=/root/.ccr/ca-bundle.crt
  DOCKER_BUILDKIT=1 docker build --secret id=npm_ca,src=${NPM_CA_FILE:-/dev/null} \
    -f backend/Dockerfile -t soulbound:05-04 .
  ```
  If `node:22-slim` isn't already cached, expect a possible transient `429`
  from Docker Hub on the very first pull in a fresh container — retry once
  or twice with a short delay before concluding the daemon or proxy is
  broken; it is not proxy-related (the CA bundle already covers every host,
  and the pull succeeds on retry with no config change).
- 05-05's `scripts/smoke-image.sh` can now assume: `/app/public/index.html`
  exists in the published image, `GET /` returns the SPA shell, `GET
  /api/<anything-unmatched>` returns JSON (both matching and not matching
  the gate), and the image runs as uid 1000 with `read_only: true`
  compatible filesystem access (express.static only reads) — this plan
  didn't smoke-test `read_only` itself (deferred to 05-05 per the plan's own
  note in `05-CONTEXT.md`), but nothing added here writes to the filesystem
  at runtime.
- No drift from the plan's line-number citations was found: `server.ts`'s
  relevant sections and both Dockerfiles matched the plan's descriptions of
  their content (not necessarily their exact line numbers, which the plan
  itself flagged as possibly stale) at the time of editing.

## Auto-remediated
- None. No self-introduced regression was found or needed fixing during
  this plan — the build, tests and mutation sweep all passed on their first
  run after each edit.
