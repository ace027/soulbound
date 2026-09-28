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

3. Set an access passphrase in `.env`:
   ```bash
   SOULBOUND_PASSPHRASE=correct horse battery staple
   ```

   This is a phrase **you** choose and give to your players. It is not your Anthropic key and
   never reaches Anthropic. Every `/api` call must carry it, so reaching the port is not enough
   to spend your credits. It must be at least 12 characters of printable ASCII (a browser cannot
   send accented letters or emoji in the header it travels in). The backend refuses to boot
   without a valid one. The browser asks for it once per device and remembers it.

4. Restrict the file to your own account:
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

## Self-hosting

The published image runs the whole game from one container on one port: the backend serves the
built frontend itself, so there is no second service and no proxy to configure.

**The first image is published by a manual release after merge — see [First
release](#first-release) below.** Until then, `ghcr.io/ace027/soulbound` does not exist
yet. Build it locally instead:

```bash
DOCKER_BUILDKIT=1 docker build -f backend/Dockerfile -t ghcr.io/ace027/soulbound:local .
```

then set `SOULBOUND_VERSION=local` in your `.env` (or `SOULBOUND_VERSION=local docker compose ...`)
so compose runs that local tag instead of pulling. Both `linux/amd64` and `linux/arm64` are built
by the release workflow once it has run, but only `amd64` is ever executed in CI or locally in this
project's sandbox — `arm64` has not been run.

1. Download [`compose.selfhost.yml`](compose.selfhost.yml) and create a `.env` beside it:
   ```bash
   SOULBOUND_ANTHROPIC_KEY=sk-ant-...     # your Anthropic Console key
   SOULBOUND_PASSPHRASE=...               # 12+ printable ASCII characters
   ```
   Then `chmod 600 .env`.
2. Start it:
   ```bash
   docker compose -f compose.selfhost.yml up -d
   ```
3. Open `http://localhost:3001` and enter the passphrase.

| Variable | Required | What it does |
|---|---|---|
| `SOULBOUND_ANTHROPIC_KEY` | Yes | Your Anthropic API key. It stays inside the container and never reaches the browser. `ANTHROPIC_API_KEY` also works. |
| `SOULBOUND_PASSPHRASE` | Yes | A passphrase you choose and give to your players. Every `/api` call needs it. It is not your Anthropic key. |
| `SOULBOUND_VERSION` | No | Image tag to run. Default `latest`. Pin a version (for example `0.1.0`) to control upgrades. |
| `SOULBOUND_PORT` | No | Host port. Default `3001`. `ALLOWED_HOSTS` and `FRONTEND_ORIGIN` follow it automatically. |
| `SOULBOUND_BIND` | No | Host address to bind. Default `127.0.0.1` (this machine only). |
| `ALLOWED_HOSTS` | No | Override only if players reach the server by a name other than `localhost`, for example `ALLOWED_HOSTS=myhost.lan:3001,localhost:3001`. Any override must still include `localhost:3001` — the compose healthcheck runs inside the container and always calls `localhost:3001` (the container's own port), regardless of `SOULBOUND_PORT`; without it the container never reports healthy. |
| `RATE_LIMIT_PER_MINUTE` | No | Per-client `/api` limit. Default `30`, allowed range 1-600. |
| `TRUST_PROXY` | No | Set only behind a real reverse proxy. See below. |

Setting `SOULBOUND_BIND=0.0.0.0` exposes the game to your network. The passphrase and rate limit
still gate every paid call, but traffic is plain HTTP. Put TLS in front before exposing it beyond
a network you trust.

**Plain `docker run`.** Nothing loads `.env` for you, and the backend reads the key as
`ANTHROPIC_API_KEY`. With both variables exported in your shell:

```bash
docker run -d --name soulbound -p 127.0.0.1:8080:3001 \
  -e ANTHROPIC_API_KEY="$SOULBOUND_ANTHROPIC_KEY" \
  -e SOULBOUND_PASSPHRASE \
  -e ALLOWED_HOSTS=localhost:8080,127.0.0.1:8080,localhost:3001 \
  ghcr.io/ace027/soulbound:latest
```

Set `ALLOWED_HOSTS` to match the host names and port browsers use — leave out `localhost:8080`
here and a browser at `http://localhost:8080` gets 403 (the check is on the request's `Host`
header, so each name you reach the server by needs its own entry). `localhost:3001` is included too, harmlessly and for
future-proofing: the image has no built-in `HEALTHCHECK` (a plain `docker run` gets none unless you
add `--health-cmd` yourself), but if you do add one, or front this with an orchestrator that
health-checks it from inside the container, it will always call `localhost:3001` regardless of the
published port — and without that entry, only the health check would fail, not the app. The
compose file sets both entries for you.

**If the pull is denied.** GHCR packages can be private on first push. The repository owner makes
the package public in its package settings on GitHub.

### First release

The release workflow (`.github/workflows/release.yml`) only ever runs by hand — there is no tag
push or schedule that triggers it.

1. **Dispatch it.** On GitHub, go to Actions → Release → Run workflow, and run it **on `main`**.
   The `publish` job refuses to run on any other branch, since `:latest` is what
   `compose.selfhost.yml` pulls by default and only reviewed `main` may move it.
2. **If the existence check fails closed on a brand-new package,** read the printed `stderr` in
   the "Refuse to overwrite an existing version" step. It fails closed (refuses to publish) unless
   GHCR's response matches a known "genuinely absent" pattern (`not found`, `manifest unknown`,
   `name unknown`). If the real wording for a brand-new package under `GITHUB_TOKEN` turns out to
   be something else, widen the `grep -qiE` pattern in that step in a reviewed PR — never add a
   bypass or treat an unrecognized response as "absent" to unblock a dispatch.
3. **An org package-creation policy can block the first push.** Some GitHub organizations restrict
   which actors or workflows may create new packages. If the push step itself fails (not the
   existence check), check the organization's package settings (Settings → Packages) for a policy
   blocking `GITHUB_TOKEN`-created packages, and adjust it there rather than in this workflow.
4. **Make the package public afterwards.** A first GHCR push is often private by default; without
   this step, self-hosters get "pull denied" (see above). Package settings on GitHub → Change
   visibility → Public.

**Behind a reverse proxy.** Set `TRUST_PROXY` (`loopback`, `uniquelocal`, or a hop count 1-5) only
when a real reverse proxy (nginx, Caddy, a cloud load balancer) overwrites `X-Forwarded-For` on
every request. Without it, every player behind the proxy shares one rate-limit bucket. Docker's
own port publishing is **not** such a proxy: setting `TRUST_PROXY` there lets any caller spoof
`X-Forwarded-For` and bypass the rate limit. `.env.example` has the full explanation.

**Upgrading.** With a pinned version, change `SOULBOUND_VERSION` and run `up -d` again. On
`latest`, pull first:

```bash
docker compose -f compose.selfhost.yml pull
docker compose -f compose.selfhost.yml up -d
```

## Hosted mode

The same image has a second mode, `SOULBOUND_MODE=hosted`, for running one public instance with player
accounts in place of the passphrase:
- invite-only sign-up, with sign-in by email magic link (Resend), Google or Discord;
- account deletion with a 7-day grace period;
- Postgres for accounts.

The backend still holds the operator's Anthropic key, and players never see it. Self-host (the default)
is unchanged, and none of the above applies to it.

Hosted mode is deployed to Render from [`render.yaml`](render.yaml). Follow
[`docs/runbooks/phase-6-hosted-setup.md`](docs/runbooks/phase-6-hosted-setup.md) step by step. Each step
ends with a check, including `scripts/verify-hosted.sh <url>`. The variables are listed, commented, at
the end of [`.env.example`](.env.example).

## Expose the frontend on your LAN

This section is about the development stack (`docker compose up`). For the published image, see
`SOULBOUND_BIND` under [Self-hosting](#self-hosting).

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
as `backend:3001`, so it needs no LAN exposure. It holds the API key, so keep it off the network
even though it now requires the passphrase.

Players on the other device enter the passphrase once, as on the host. Beyond that, each link in
the chain already lines up:

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

The passphrase is what restricts who can play. It gates every `/api` call, so anyone who reaches
port 5173 also needs it before they can spend your Anthropic credits. Two limits remain:

- **One shared rate-limit bucket.** Every LAN player arrives via the Vite container, so the
  backend sees one client address for all of them. They share one `RATE_LIMIT_PER_MINUTE`
  allowance (default 30). To raise it, add `RATE_LIMIT_PER_MINUTE` to the backend's
  `environment:` list in `docker-compose.yml`; the dev compose does not pass it through today.
- **Plain HTTP.** The passphrase and all game traffic cross the network unencrypted. That is a
  reasonable trade on a home network you control. Restricting by source needs a host firewall
  rule; exposing any of this to the public internet needs TLS in front first.

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
