# Migration Plan — Artifact → Dockerized App

Context: the game was previously built and iterated as a single-file React artifact (`soulbound-world.jsx`) running inside a Claude.ai chat, where the Anthropic API calls were authenticated automatically by the Claude.ai runtime. This doc is the plan for turning that into a real, independently-running, Dockerized app.

## The core problem: auth doesn't come for free anymore
Inside the artifact, `fetch("https://api.anthropic.com/v1/messages")` worked with no credentials in the request because Claude.ai injected auth tied to the viewer's account. Outside that sandbox, a raw browser call to Anthropic's API has no credentials and will likely also hit CORS restrictions. **This has to be solved before anything else works** — it's not an incremental feature, it's a prerequisite.

### Decision: backend-held key via `.env`

**Resolved.** Each self-hosted instance is single-tenant — one deployer, one container, their own key, running on their own trusted machine. The backend holds the deployer's Anthropic API key as an environment variable, sourced from a `.env` file. The key never reaches the browser bundle or any client-side `fetch()` call.

Two alternatives were considered and rejected:
- **Hardcoded/baked-in key** — wrong shape for "anybody can deploy their own instance": either the original developer eats everyone's usage cost, or every deployer has to edit and rebuild source to swap in their own key.
- **Session-only, in-memory key (paste-per-session BYOK)** — this was the original plan, matching the artifact's "session-only, in-memory" posture. Superseded: it assumes a threat model (untrusted host, no persistence acceptable) that doesn't match the actual deployment shape, and the added friction (re-paste key every session/restart) wasn't buying protection against anything realistic for a deployer running this on their own box.
- **A proxy converting API-key requests into OAuth calls against a Claude Max subscription** — raised and declined. Max does not include API access; Anthropic bills the API separately via Console credits, which is what this deployment runs on. That is the separation Anthropic's terms draw between the two products. (Decided 2026-09-17.)

Implementation:
- `.env.example` committed with `ANTHROPIC_API_KEY=` empty; real `.env` gitignored
- Setup docs instruct `chmod 600 .env` after creation
- `docker-compose.yml` passes the var through to the backend service: `environment: - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}`
- Backend reads `process.env.ANTHROPIC_API_KEY` once at startup, fails fast with a clear error if absent — not a confusing failure three calls deep into gameplay
- Key must never appear in logs, error responses/stack traces, or the frontend bundle — a code-review checklist item, not just a storage-layer concern

(Docker secrets — file-mounted instead of env var — were considered as a harder alternative. Under plain `docker compose` without Swarm, a secret reduces to the same bind-mounted-file-on-disk reality as `.env`, just referenced differently, so it wasn't adopted as the default. Worth documenting later as an optional hardening path for a deployer targeting a less-trusted host.)

## Suggested scaffold

```
soulbound-chronicles/
├── CLAUDE.md
├── docs/
│   ├── PROJECT-BACKGROUND.md
│   ├── design-decisions-log.md
│   └── MIGRATION-PLAN.md
├── frontend/                  # Vite + React
│   ├── src/
│   │   ├── data/
│   │   │   ├── worldSystemPrompt.js   # WORLD_SYSTEM_PROMPT
│   │   │   ├── worldLore.js           # WORLD_LORE
│   │   │   ├── races.js               # RACES
│   │   │   └── questions.js           # QUESTIONS
│   │   ├── components/
│   │   │   ├── SkillCard.jsx
│   │   │   ├── SoulCodex.jsx
│   │   │   ├── WorldLog.jsx
│   │   │   ├── ActionBar.jsx
│   │   │   └── screens/               # title, race select, questionnaire, loading, simulation
│   │   ├── lib/
│   │   │   ├── saves.js               # localStorage save/load helpers
│   │   │   └── api.js                 # calls to YOUR backend, not Anthropic directly
│   │   └── App.jsx
│   ├── Dockerfile
│   └── package.json
├── backend/                   # Node/Express (or similar)
│   ├── src/
│   │   ├── routes/
│   │   │   ├── uniqueSkill.js         # mirrors determineUniqueSkill()
│   │   │   ├── worldEngine.js         # mirrors callWorldEngine()
│   │   │   └── introScene.js          # mirrors generateIntroScene()
│   │   ├── anthropic.js               # shared fetch-to-Anthropic helper, buildSystemBlocks()
│   │   └── server.js
│   ├── Dockerfile
│   └── package.json
└── docker-compose.yml
```

Splitting the single JSX file into modules is worth doing purely for Claude Code's sake — a real file tree is much easier for an agentic coding tool to navigate and edit safely than one enormous file, independent of the Docker migration itself.

## What ports over unchanged (logic-wise)
- `WORLD_SYSTEM_PROMPT`, `WORLD_LORE`, `RACES`, `QUESTIONS` — copy as-is into their own modules
- The three prompt-construction/parsing functions (`determineUniqueSkill`, `callWorldEngine`, `generateIntroScene`) — logic is unchanged, only the `fetch` target changes (your backend instead of Anthropic directly) and the API key handling moves server-side
- All skill-tier / mastery / Soul Rewrite / sub-ability-emergence game logic in `handleAction`
- The JSON response contract (see `CLAUDE.md`) — must stay identical between backend and frontend
- `localStorage` save system — works identically in a normal deployed browser context, no changes needed
- UI components and styling — port directly, though this is also a natural point to reconsider using a component library or a proper CSS approach instead of inline styles, if desired (not required)

## What needs to change
- Add a backend that owns the Anthropic API key (per the auth decision above) and exposes 2–3 routes mirroring the existing call functions
- Frontend's `fetch` calls point to your backend routes instead of `api.anthropic.com` directly
- Add Docker: one `Dockerfile` per service (frontend, backend), or a single-container setup if you'd rather serve the built frontend as static files from the backend
- Add `docker-compose.yml` to run both together locally; extend later with Postgres once multiplayer work starts (not needed for this phase)
- API key reaches the backend via `.env` file, read as an environment variable at container startup — see auth decision above

## Testing constraints, both old and new
The old artifact-development sandbox could reach `api.anthropic.com` over the network but had no API key, so live testing always required the developer to run the artifact themselves and relay results back. **Once this is a real backend with its own key, that constraint changes** — Claude Code should be able to actually run and test the app end-to-end inside its own sandbox, which is a meaningful capability upgrade worth taking advantage of (e.g., actually exercising the World Engine loop and checking the JSON contract holds, rather than relying on the developer to paste back results).

## Suggested order of operations
1. ~~Resolve the auth-model decision~~ — resolved: `.env`-based, backend-held key
2. Scaffold frontend + backend + Docker as above, with routes stubbed
3. Port static data (`WORLD_SYSTEM_PROMPT`, `WORLD_LORE`, `RACES`, `QUESTIONS`) into modules verbatim
4. Port the three call functions into backend routes; get one (e.g. `determineUniqueSkill`, the simplest) working end-to-end first
5. Port UI components and wire them to the new backend routes via `lib/api.js`
6. Verify save/load still works unchanged
7. Verify prompt caching is actually engaging in real API responses (`cache_creation_input_tokens` / `cache_read_input_tokens`) now that raw responses are inspectable outside the artifact
8. Only after the solo app is solid: begin multiplayer/Postgres work per the roadmap in `PROJECT-BACKGROUND.md`
