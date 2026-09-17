# Build context is the repo root: docker build -f frontend/Dockerfile .
# Multi-stage: install + compile with devDependencies in `builder`, producing
# a static Vite bundle, then serve that bundle from a slim, non-root runtime
# image. The Anthropic API key is never referenced here and never reaches
# this image — the frontend only ever talks to the backend's `/api` routes.

FROM node:22-slim AS builder
WORKDIR /app

# docker-compose.yml runs THIS stage (target: builder) with Vite's dev server,
# so the runtime stage's USER below does not apply to the container compose
# actually starts — without this the frontend would run as root.
#
# Switching user BEFORE npm ci, and copying with --chown, means node_modules
# and dist are written by `node` in the first place. The alternative — chown -R
# after populating /app — costs a 110MB copy-up layer on overlayfs (measured:
# 541MB -> 683MB) because every file whose ownership changes is duplicated into
# the new layer, and it re-runs on every dependency-triggered rebuild.
RUN chown node:node /app
USER node

# Workspace manifests first (better layer caching on dependency changes).
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node shared/package.json ./shared/package.json
COPY --chown=node:node frontend/package.json ./frontend/package.json

# Optional CA trust for build environments behind a TLS-intercepting proxy
# (e.g. a sandboxed CI runner). The secret is declared `required=false`, so on
# an ordinary machine it is simply absent and this is a no-op. It is a BuildKit
# secret mount, so the certificate never becomes an image layer. TLS
# verification is never disabled — the CA is added to the trust set, not
# bypassed.
#
# uid/gid are required because this stage runs as `node` (see above) and a
# BuildKit secret mounts root-owned 0400 by default. Without them the mount is
# unreadable, the CA is silently skipped ("Ignoring extra certs ... Permission
# denied"), and npm ci then fails on TLS with a misleading npm-internal error.
RUN --mount=type=secret,id=npm_ca,required=false,uid=1000,gid=1000 \
    if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci

# Now bring in source and build the workspaces this image needs.
COPY --chown=node:node tsconfig.base.json ./
COPY --chown=node:node shared ./shared
COPY --chown=node:node frontend ./frontend

RUN npm run build -w @soulbound/shared
RUN npm run build -w @soulbound/frontend


FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# `serve` is a tiny, dependency-free static file server. Installed only in
# the runtime image (not added to frontend/package.json) since it is
# infrastructure for the container, not application code.
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm install --global serve@14

COPY --from=builder /app/frontend/dist ./dist

# node:22-slim already has a non-root `node` user; use it instead of root.
USER node

EXPOSE 5173

CMD ["serve", "-s", "dist", "-l", "5173"]
