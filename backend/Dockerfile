# Build context is the repo root: docker build -f backend/Dockerfile .
#
# This is the published image (Phase 5, R20): an untargeted build produces
# `runtime`, the backend serving its own built frontend bundle same-origin —
# one container, one port, no second image and no proxy config to keep in
# sync with it. Four stages:
#   builder         install + compile the backend (and shared) with
#                   devDependencies, native architecture
#   frontend-build  install + compile the frontend, on $BUILDPLATFORM (see
#                   below)
#   api             today's runtime: compiled backend + prod deps, no bundle
#                   — this is what the dev compose targets (`target: api`),
#                   so a dev rebuild never builds or ships a stale frontend
#   runtime         FROM api, adds the frontend-build output as /app/public
#                   and sets STATIC_DIR — this is the untargeted, published
#                   image
#
# The Anthropic API key is never referenced here — it arrives as an
# environment variable at container run time, not build time.

FROM node:22-slim AS builder
WORKDIR /app

# Workspace manifests first (better layer caching on dependency changes).
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/package.json
COPY backend/package.json ./backend/package.json

# Optional CA trust for build environments behind a TLS-intercepting proxy
# (e.g. a sandboxed CI runner). The secret is declared `required=false`, so on
# an ordinary machine it is simply absent and this is a no-op. It is a BuildKit
# secret mount, so the certificate never becomes an image layer. TLS
# verification is never disabled — the CA is added to the trust set, not
# bypassed.
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci

# Now bring in source and build the workspaces this image needs.
COPY tsconfig.base.json ./
COPY shared ./shared
COPY backend ./backend

RUN npm run build -w @soulbound/shared
RUN npm run build -w @soulbound/backend


# Builds the frontend bundle that `runtime` (below) serves. The bundle is
# static HTML/CSS/JS: identical regardless of the architecture it was built
# on. Pinning this stage to $BUILDPLATFORM (the architecture actually running
# the build, e.g. the CI runner's amd64) keeps it out of QEMU entirely on a
# multi-platform build — only the backend's own `npm ci --omit=dev` and `tsc`
# (in `api` below) run emulated for a non-native target platform.
#
# This stage runs as root (unlike frontend/Dockerfile's dev `builder`, which
# runs as `node`): it is a throwaway build stage whose only output is the
# static `dist` directory copied into `runtime` below, so there is no running
# process or writable filesystem in the final image to protect by dropping
# privileges here — that protection lives on the `api`/`runtime` stages' own
# `USER node`, which does apply to what actually ships and runs.
FROM --platform=$BUILDPLATFORM node:22-slim AS frontend-build
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/package.json
COPY frontend/package.json ./frontend/package.json

RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci

COPY tsconfig.base.json ./
COPY shared ./shared
COPY frontend ./frontend

RUN npm run build -w @soulbound/shared
RUN npm run build -w @soulbound/frontend


# Today's runtime: the compiled backend and its production dependencies, no
# frontend bundle. This is what the dev compose builds (`target: api`) — dev
# serves the frontend from Vite's own dev server for HMR, so the backend
# image there must not carry a stale bundle, or pay to build one it will
# never serve.
FROM node:22-slim AS api
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/package.json
COPY backend/package.json ./backend/package.json

RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --omit=dev

COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/backend/dist ./backend/dist

# node:22-slim already has a non-root `node` user; use it instead of root.
USER node

EXPOSE 3001

CMD ["node", "backend/dist/server.js"]


# The published image: `api` plus the built frontend, served same-origin via
# STATIC_DIR. An untargeted `docker build` (no --target) produces this stage,
# since it is the last one declared.
FROM api AS runtime

COPY --chown=node:node --from=frontend-build /app/frontend/dist /app/public
ENV STATIC_DIR=/app/public
