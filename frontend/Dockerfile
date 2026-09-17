# Build context is the repo root: docker build -f frontend/Dockerfile .
# Multi-stage: install + compile with devDependencies in `builder`, producing
# a static Vite bundle, then serve that bundle from a slim, non-root runtime
# image. The Anthropic API key is never referenced here and never reaches
# this image — the frontend only ever talks to the backend's `/api` routes.

FROM node:22-slim AS builder
WORKDIR /app

# Workspace manifests first (better layer caching on dependency changes).
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/package.json
COPY frontend/package.json ./frontend/package.json

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
COPY frontend ./frontend

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
