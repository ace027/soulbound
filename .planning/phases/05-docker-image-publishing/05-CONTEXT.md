# Phase 5: Docker Image Publishing — Context

**Goal**: Publish one Docker image a self-hosting deployer can pull and run, without turning their
Anthropic key into an open proxy for anyone who reaches the port.

**Requirements**: R17 access gate · R18 rate limit · R19 frontend gate · R20 single deployable image ·
R21 release pipeline · R22 self-host package and records

**The spec is the primary source**: `.planning/specs/05-docker-image-publishing-spec.md`. It has every
API/type contract, the middleware order, the error bodies, failure modes and acceptance checks,
critiqued once (REWORK → 12 findings applied, see its Revision History). **Read it before your plan.**
Where this file and the spec disagree, the spec wins. Report the disagreement rather than choosing.

**Phase base commit**: `7856b7d`. `frontend/src/App.tsx` must be byte-identical to it at phase close.

---

## Decisions already made — do not reopen

| Decision | Made by | Where recorded |
|---|---|---|
| Option 2 access gate (deployer-set passphrase + basic rate limit) | developer, 2026-09-23 | `STATE.md` → Next Action 2 |
| GHCR, `workflow_dispatch`-only release, passphrase kept in `localStorage` | developer, planning gate | this file |
| **Architecture: Pragmatic + 2 from Clean.** One image, the backend serves the bundle; gate and limiter before `express.json`; `Authorization: Bearer` | developer, from three read-only proposals (Minimal / Clean / Pragmatic) | spec → Key Decisions |
| Spec pipeline run before planning | developer | spec |

The settled key architecture (the backend holds `ANTHROPIC_API_KEY`, `CLAUDE.md` → Auth
architecture) is **unchanged**. The passphrase is issued by the deployer and never reaches Anthropic.
It is not the rejected paste-per-session BYOK. Anyone who reads this phase as reopening auth has
misread it.

## Three facts derived during the spec's research that shaped the design

1. **The status codes 401 and 429 are already taken.** Upstream Anthropic failures map to
   `401 AUTHENTICATION_FAILED` and `429 RATE_LIMITED` (`backend/src/anthropic.ts:255-266`). The gate
   uses **new codes**, `PASSPHRASE_REQUIRED` and `TOO_MANY_REQUESTS`, and the frontend decides by
   **code, never status**. Otherwise a bad deployer key would wipe a correct passphrase.
2. **A failed creation strands the player.** A thrown error during character creation leaves the
   loading screen showing the error with no retry (`App.tsx:267-269`). So the frontend checks access
   **before the title screen** (`GET /api/access`), not on the first paid 401.
3. **The e2e suite fails any `/api/*` request** (`frontend/e2e/smoke.spec.ts:403-411`). An
   "unmodified e2e" requirement is impossible once the gate checks on mount. The one sanctioned
   change is to stub `/api/access` and exempt only that path. The no-paid-call guard stays for
   everything else.

## Carry-forward rules (retro 2026-09-18 action items, all HIGH unless noted)

- **AI-1: a fix is a claim.** Before committing a fix, re-run the derivation that produced the
  finding (the mutation, the count, the curl).
- **AI-2: re-read your diff against the evidence you just committed**, not against your reasoning.
- **AI-3: derive every fact in a brief.** Cite `file:line`, never plan prose. Every line number in
  these plans was checked at `4319383`; if one has moved, trust the file and say so.
- **AI-4: test durability mechanisms in the target environment before documenting them.** This is
  why the smoke script runs in CI on every push, and why the first GHCR publish is recorded as
  UNTESTED rather than described as working.
- **AI-5: serial execution for any agent that modifies the tree.** All six waves are serial. While
  an agent holds the tree, nothing else writes to it.
- **AI-6 (standing): every plan writes a `SUMMARY.md`.**
- **AI-7 (medium): audit guard coverage at phase start.** This phase adds three new properties: the
  gate fails closed, the passphrase is never logged, and `/api/*` never returns HTML. Each must have
  a **mutation-verified** test by the plan that introduces it, not at review.
- **Standing rule** (`STATE.md`, Phase 3/4 carry-forward): no middleware in `server.ts` without a
  test asserting what it emits.

## Environment facts

- Docker is installed but the daemon isn't running. Start it with
  `setsid nohup dockerd > /tmp/dockerd.log 2>&1 < /dev/null &`, then
  `export NPM_CA_FILE=/root/.ccr/ca-bundle.crt` for builds. Stop it again at the end of your plan
  (`STATE.md` → Known environment limits).
- The sandbox can build and run **amd64** only. Multi-arch and the GHCR push are verified only by the
  first `workflow_dispatch` after merge (spec → Open Question 1).
- Tag pushes fail from here. Nothing in this phase may depend on a git tag.
- **Zero Anthropic spend.** Every smoke run uses a bogus key and exercises only the gate, health,
  static and 404 paths. A plan that needs a real key has left its scope.
- Playwright uses the pre-installed Chromium. **Never run `npx playwright install`.**

## Plan structure

| Plan | Wave | Deliverable | Requirements | Agent |
|---|---|---|---|---|
| 05-01 | 1 | Shared gate contract; config readers (passphrase `Secret`, limits, `TRUST_PROXY`, `STATIC_DIR`); dev env passthrough | R17, R18 (config) | engineering-backend-architect |
| 05-02 | 2 | Rate limiter + gate middleware; pipeline wiring; `/api/access`; mutation-verified tests | R17, R18 | engineering-backend-architect (+ engineering-security-engineer verifies) |
| 05-03 | 3 | Passphrase store; `api.ts` header, 401 and `checkAccess`; `AccessGate` + `main.tsx`; e2e guard narrowed + 1 gate test | R19 | engineering-frontend-developer |
| 05-04 | 4 | Static serving + ordering tests; `$BUILDPLATFORM` frontend stage in `backend/Dockerfile`; frontend `runtime` stage removed; compose comment | R20 | engineering-infrastructure-devops |
| 05-05 | 5 | `scripts/smoke-image.sh` + local evidence; `ci.yml` smoke job; `release.yml` | R21 | engineering-infrastructure-devops |
| 05-06 | 6 | `compose.selfhost.yml` + non-default-port evidence; README; design log; CLAUDE.md; PROJECT/ROADMAP; `0.1.0`; cross-plan re-verification | R22 | orchestrator (+ product-technical-writer for docs) |

**Every requirement is covered.** R17 and R18 are split between 05-01 (config: fail-fast readers)
and 05-02 (behaviour). No circular dependencies: each wave depends only on earlier waves.

Pre-execution gates skipped by the developer: none. Architecture proposals ran; the spec pipeline
ran with one critique cycle. Plan critique is offered after generation.
