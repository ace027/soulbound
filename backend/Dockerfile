# Build context is the repo root: docker build -f backend/Dockerfile .
# Multi-stage: install + compile with devDependencies in `builder`, then copy
# only the built output and production dependencies into a slim, non-root
# runtime image. The Anthropic API key is never referenced here — it arrives
# as an environment variable at container run time, not build time.

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


FROM node:22-slim AS runtime
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
