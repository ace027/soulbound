# The Soulbound Chronicles

A Tensura-inspired text RPG set in the original fantasy world of Vaeltharion, where Claude acts as "The World Voice" — an AI game master narrating an entire living world. This application is a Dockerized migration of the original single-file React artifact, now structured as a TypeScript monorepo with a proper frontend/backend split, a backend that securely holds the Anthropic API key, and a shared World Voice JSON contract enforced as compile-time types.

## Setup

1. Copy the environment template:
   ```bash
   cp .env.example .env
   ```

2. Add your Anthropic API key to `.env`, using the `SOULBOUND_` name:
   ```bash
   # Edit .env and paste your key from https://console.anthropic.com/account/keys
   SOULBOUND_ANTHROPIC_KEY=your-key-here
   ```

   **Prefer `SOULBOUND_ANTHROPIC_KEY` over `ANTHROPIC_API_KEY`.** Claude Code uses an
   `ANTHROPIC_API_KEY` it finds in the environment in preference to a Pro/Max subscription, so
   the plain name would quietly move your own Claude Code usage onto billed API credits.
   `docker-compose.yml` maps the `SOULBOUND_` variable into the container as
   `ANTHROPIC_API_KEY`, which is what the backend reads — only the host-side name differs. Set
   one or the other; `SOULBOUND_ANTHROPIC_KEY` wins if both are present.

   A Claude Pro or Max subscription does **not** include API access. Anthropic bills the API
   separately through Console credits.

3. Restrict the file to your own account:
   ```bash
   chmod 600 .env
   ```

   The key is now readable only by the owner, and reaches the backend container at run time —
   never the browser bundle, and never an image layer.

Running the backend directly on the host rather than through Compose? Nothing loads `.env` into
the Node process, so export both `ANTHROPIC_API_KEY` and `SOULBOUND_PASSPHRASE` yourself
(`export ANTHROPIC_API_KEY=... SOULBOUND_PASSPHRASE=...`) or pass `--env-file .env`. The backend
now refuses to boot without `SOULBOUND_PASSPHRASE` set, same as the key.

## Run

Start the full stack:
```bash
docker compose up
```

- Frontend: http://localhost:5173 (Vite dev server with hot reload)
- Backend: http://localhost:3001 (API server for World Voice calls)

## Expose the frontend on your LAN

Both ports publish to `127.0.0.1` by default, so the stack is reachable only from the machine
running it. To play from a phone or another computer on the same network, publish **only the
frontend** port. In `docker-compose.yml`, on the `frontend` service:

```yaml
    ports:
      - "127.0.0.1:5173:5173"      # before
      - "192.168.1.50:5173:5173"   # after — your server's LAN address
```

Naming the LAN address is preferable to `"5173:5173"`, which publishes on every interface
including any VPN or secondary NIC. Give the host a DHCP reservation so the address is stable;
if it ever does change, the stack fails to start rather than quietly listening somewhere you
did not intend.

Then browse to `http://192.168.1.50:5173` from the other device.

**Leave the backend on `127.0.0.1:3001:3001`.** Vite reaches it over Compose's internal network
as `backend:3001`, so it needs no LAN exposure — and it holds the API key and has no
authentication, so publishing it would put an unmetered Anthropic proxy on the network.

Nothing else needs changing. Each link in the chain already lines up:

- `vite.config.ts` sets `server.host: true`, so Vite listens on all interfaces *inside* the
  container. Without that, publishing the port would forward to nothing.
- Vite validates the `Host` header but allows any IP-address literal unconditionally. Reaching
  the server by **hostname** (`http://gamebox.local:5173`) is blocked unless you add it to
  `server.allowedHosts`. Use the IP and this never comes up.
- The browser calls `/api/*` same-origin; Vite proxies it with `changeOrigin: true`, which
  rewrites the `Host` header to `backend:3001` — already in the backend's `ALLOWED_HOSTS`. So
  the allow-list needs no new entry, and CORS (`FRONTEND_ORIGIN`) is not involved at all.

Running outside Docker needs no changes at all: `npm run dev` already binds every interface via
the same `server.host: true`, and its proxy reaches the backend on `localhost:3001`.

### What this does and does not protect

`ALLOWED_HOSTS` is a **`Host`-header** allow-list, not a source-IP one. It exists to stop DNS
rebinding — a malicious page pointing a hostname it controls at your server and driving it from
your own browser, spending real credits before any CORS header is read. It cannot restrict *who*
connects, because every client sets its own `Host` header. Adding a device's IP there grants
nothing and blocks nothing.

The backend has no authentication. Anything on the network that can reach port 5173 can spend
your Anthropic credits through the proxy. That is a reasonable trade on a home network you
control. Restricting by source needs a host firewall rule; exposing any of this to the public
internet needs a reverse proxy and real authentication first.

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
# The SHA is on the pushed branch, so this works in any clone that has it:
git show 3d01fa5:legacy/souldbound-world.jsx                        # the whole file
git show 3d01fa5:legacy/souldbound-world.jsx | sed -n '1022,1027p'  # a cited range

# Preferred once the tag is pushed (it is local-only today — see the design log):
git show parity-oracle:legacy/souldbound-world.jsx
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
