# Project State

## Current Position
- **Phase**: 2 of 4 (waves 1–3 executed; wave 4 blocked on an API key)
- **Status**: Phase 2 — 4 of 5 plans complete. Only 02-05 (live verification) remains, and it needs a real API key.
- **Last Activity**: Phase 2 waves 1–3 executed (2026-09-17)

## Progress
```
[███████████░░░░░░░░░] 56% — 10/18 plans complete
```

## Recent Decisions
- **Design source**: `.planning/explorations/2026-09-17-soulbound-artifact-to-app-design.md` (committed `7ec3ba2`)
- **Codebase map**: skipped — this session produced a more detailed structural map of the single legacy file than a generic indexer would, and that file is about to be deleted. Run `/legion:map` after the migration, against `frontend/` + `backend/` + `shared/`.
- **Scope**: full migration to playable, not a scaffold or vertical slice
- **Language**: TypeScript both sides; the World Voice contract lives in `shared/` so prompt/parser drift becomes a compile error
- **JSON contract**: structured outputs (`output_config.format`), field names unchanged
- **Models**: `claude-opus-5` on `callWorldEngine` + `generateIntroScene`, `claude-sonnet-5` on `determineUniqueSkill` — ⚠️ reverses a logged decision; `CLAUDE.md` and `design-decisions-log.md` must be updated in Phase 4 (R15)
- **Execution mode**: Autonomous — report at phase boundaries
- **Planning depth**: Standard — deep analysis already lives in the exploration doc
- **Cost profile**: Balanced — Opus 5 for the contract and the `App.tsx` game-logic port, Sonnet 5 for backend routes and UI extraction, Haiku 4.5 for verbatim data copying

## Next Action — READ THIS FIRST IF YOU ARE A FRESH SESSION

**Phase 2 is 4/5 done.** Plans 02-01 through 02-04 are complete, committed, pushed, and independently verified. **Only plan 02-05 remains**, and it is the one plan that requires a real Anthropic API key.

### Step 1 — confirm the key is actually reaching the backend, BEFORE spending anything
```bash
# Is it in the environment under either name?
env | grep -c 'SOULBOUND_ANTHROPIC_KEY\|ANTHROPIC_API_KEY'

# Does compose resolve it into the container?
printf 'SOULBOUND_ANTHROPIC_KEY=%s\n' "$SOULBOUND_ANTHROPIC_KEY" > .env
docker compose config | grep 'ANTHROPIC_API_KEY'   # must show a real sk-ant-... value
```
If neither name is set, **stop**: plan 02-05 reports BLOCKED. That is the designed behaviour, not a failure. Do not stub it, do not mark it passed, and do not reason that the mocked tests are equivalent — they cannot prove `cache_read_input_tokens > 0`, which is the entire point of that plan.

### Step 2 — run it
```bash
/legion:build     # reads this file, sees 02-01..02-04 have summaries, runs 02-05 alone
```

### Step 3 — then
`/legion:review` for Phase 2, then `/legion:plan 3`.

---

## ⚠️ Key naming — do NOT use `ANTHROPIC_API_KEY` as a host/cloud env var

Claude Code uses an `ANTHROPIC_API_KEY` found in the environment **in preference to a Pro/Max subscription**. Naming the host variable that would quietly move the developer's own Claude Code usage onto billed API credits — the exact outcome they are trying to avoid.

Use **`SOULBOUND_ANTHROPIC_KEY`**. `docker-compose.yml` maps it into the container as `ANTHROPIC_API_KEY` (which is what `backend/src/config.ts` reads), with a fallback to `ANTHROPIC_API_KEY` if only that is set. Both paths verified working.

## What plan 02-05 will spend
Roughly 6 calls: three route exercises, a second world-engine call for the cache proof, one adversarial sample. Well under a dollar. The plan forbids exploratory looping and re-running passing checks. A workspace spend limit is a sensible hard stop.

## Auth decision (2026-09-17) — settled, do not re-litigate
A Claude Max subscription does **not** include API access; Anthropic bills the API separately via Console credits. The artifact only worked because claude.ai injected auth tied to whoever opened it — `docs/design-decisions-log.md` records this as "a crude form of bring your own Claude account". Proceeding on Console credits with the Opus 5 split intact (~$0.04/turn, ~$2.10 per 50-turn session, assuming caching engages). A proxy converting API-key requests into OAuth calls against a Max subscription was raised and declined — that is the separation Anthropic's terms draw between the two products.

## ⚠️ Unresolved, and a fresh session will not otherwise know to ask
**Five commits use `acedean27@gmail.com` as committer instead of `noreply@anthropic.com`** and show as Unverified on GitHub: `7ec3ba2`, `1821b18`, `224460a`, `fbccbc6`, `5a4089d`. Everything from `5d6e323` onward is correct. All five are pushed, so fixing them means a rebase plus force-push-with-lease. Orchestrator recommendation was to **leave them** — content and authorship are correct, only the verification badge differs — unless branch protection requires verified commits. Two attempts to fix were denied by the permission classifier. **Ask the user before acting.**

**Auth decision (2026-09-17)**: a Claude Max subscription does not include API access — Anthropic bills the API separately via Console credits. The artifact worked only because claude.ai injected auth tied to the viewer. Proceeding on Console credits with the Opus 5 split intact (~$0.04/turn, ~$2.10 per 50-turn session, assuming caching engages). A proxy converting API-key requests into OAuth calls against a Max subscription was raised and declined.

## Phase 2 Plans
| Plan | Wave | Deliverable | Agent | Model | Status |
|---|---|---|---|---|---|
| 01 | 1 | Anthropic client module | Backend Architect | Sonnet 5 | ✅ `2b0f82d` |
| 02 | 1 | Vitest + contract-guard test | QA Verification | Sonnet 5 | ✅ `ca566fc` |
| 03 | 2 | Three World Voice routes | AI Engineer | Sonnet 5 | ✅ `0909109` |
| 04 | 3 | Route tests vs mocked SDK | QA Verification | Sonnet 5 | ✅ `b0b9c50` |
| 05 | 4 | Live verification & cache proof | orchestrator | Opus 5 | ⏸ **BLOCKED — needs API key** |

**Verified so far without a key**: 38 tests green; three routes built on one shared helper; `unique-skill` omits `system` entirely; the two Opus routes send byte-identical system blocks *and* `output_config`, so they share a cache namespace; all three carry `max_tokens: 16000`, `effort: 'high'`, no prefill, no `budget_tokens`; prompts byte-identical to the artifact by rendered-string diff.

**Not yet verified, and only 02-05 can**: that the API accepts the derived schema; that `cache_read_input_tokens > 0`; that Opus 5 honours the MUST NOT list the way Sonnet 5 did.

## Phase 1 Plans
| Plan | Wave | Deliverable | Agent | Model | Status |
|---|---|---|---|---|---|
| 01 | 1 | Repository reorganization & workspace root | Infrastructure & DevOps | Haiku 4.5 | ✅ |
| 02 | 2 | Shared contract package | orchestrator | Opus 5 | ✅ |
| 03 | 2 | Backend service skeleton | Backend Architect | Sonnet 5 | ✅ |
| 04 | 2 | Frontend service skeleton | Frontend Developer | Sonnet 5 | ✅ |
| 05 | 3 | Verbatim static-data extraction | general | Haiku 4.5 | ✅ |
| 06 | 3 | Compose wiring & end-to-end verification | orchestrator | Opus 5 | ✅ |

Planning-gate notes: architecture proposals and the spec pipeline were skipped — the committed exploration doc already carries the competing-approach analysis and serves as the spec. Plan critique was skipped for this phase (mechanical scaffold); run it before Phase 3, where the `App.tsx` game-logic port is the real regression risk. GitHub issue creation skipped — no `gh` CLI in this environment.


## Phase 1 findings carried into later phases
- **Legacy CSS drift** — the six duplicated `<style>` blocks were not identical. `breathe`, `glowPulse`, `etchIn` and the scrollbar thumb width differ between copies; each was resolved by plurality among existing legacy values. During the Phase 3 UI port, if a screen looks subtly off against the artifact, these four rules are the first place to look. There is no single "correct" original to diff against.
- **Seven keyframes, not six** — `cardHover` exists in legacy (as an empty block) and was missed by the plan's prose. Caught by diffing extracted lists.
- **Backend dev watch loop and frontend `dev` script are unexercised** — no plan's verify block covered them. Check manually when dev-loop iteration starts.
- **`runtime` frontend image has no route to the backend** — `serve -s` answers `/api/*` with 200 + index.html. Must gain a reverse proxy or a configurable API base URL before it is ever deployed. Dormant only while the frontend makes no API calls.
- **No auth or rate limiting on the backend** — ports now bind `127.0.0.1` as mitigation. Revisit when Phase 2's paid routes go live.
- **Docker builds need a trusted CA in this sandbox** — outbound HTTPS is TLS-intercepted. Handled via an optional BuildKit secret that no-ops elsewhere; set `NPM_CA_FILE` when building here.
