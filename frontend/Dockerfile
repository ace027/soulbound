# Build context is the repo root: docker build -f frontend/Dockerfile .
#
# This file now exists only for the dev compose's `builder` target
# (docker-compose.yml runs `target: builder` to get Vite's dev server with
# HMR). There is no runtime/published stage here any more: the published
# image is `backend/Dockerfile`'s `runtime` stage, which builds this same
# frontend on $BUILDPLATFORM and serves the resulting bundle itself,
# same-origin, alongside the API (Phase 5, R20). The Anthropic API key is
# never referenced here and never reaches this image — the frontend only
# ever talks to the backend's `/api` routes.

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
