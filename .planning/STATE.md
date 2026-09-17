# Project State

## Current Position
- **Phase**: 2 of 4 (complete)
- **Status**: Phase 2 complete — review passed after 3 cycles. Suite grew 38 → 108 tests.
- **Last Activity**: Phase 2 review passed (2026-09-17)

## Progress
```
[████████████░░░░░░░░] 61% — 11/18 plans complete
```

## Recent Decisions
- **Design source**: `.planning/explorations/2026-09-17-soulbound-artifact-to-app-design.md` (committed `e56f400`)
- **Codebase map**: skipped — this session produced a more detailed structural map of the single legacy file than a generic indexer would, and that file is about to be deleted. Run `/legion:map` after the migration, against `frontend/` + `backend/` + `shared/`.
- **Scope**: full migration to playable, not a scaffold or vertical slice
- **Language**: TypeScript both sides; the World Voice contract lives in `shared/` so prompt/parser drift becomes a compile error
- **JSON contract**: structured outputs (`output_config.format`), field names unchanged
- **Models**: `claude-opus-5` on `callWorldEngine` + `generateIntroScene`, `claude-sonnet-5` on `determineUniqueSkill` — ⚠️ reverses a logged decision; `CLAUDE.md` and `design-decisions-log.md` must be updated in Phase 4 (R15)
- **Execution mode**: Autonomous — report at phase boundaries
- **Planning depth**: Standard — deep analysis already lives in the exploration doc
- **Cost profile**: Balanced — Opus 5 for the contract and the `App.tsx` game-logic port, Sonnet 5 for backend routes and UI extraction, Haiku 4.5 for verbatim data copying

## Next Action

**Phase 2 is complete and review-passed.** Run `/legion:plan 3` for the frontend port.

Run **plan critique** before Phase 3 — Phase 1 skipped it deliberately as a mechanical scaffold,
and Phase 3's `App.tsx` game-logic port is where the real regression risk lives.

### What review changed (see 02-REVIEW.md)
Two blockers, ten warnings, nine suggestions — all resolved. The panel's shared conclusion was
that the code was right but the net around it wasn't: a 22-mutation sweep found 11 survivors,
including unregistering every route and replacing the whole cached prefix with junk, suite green.

- `server.ts` is now exercised by tests (`buildApp()` extracted).
- The cycle-2 security fix itself introduced a blocker: the Host allow-list 403'd every API call
  under Compose while the container still reported **healthy** — the healthcheck curls localhost
  from inside the container and never touches the proxied path. Worth remembering as a pattern:
  **a passing healthcheck does not mean the app is reachable the way users reach it.**
- The prompt-injection guard was bypassable two ways (single-pass regex splicing, and
  `actionHistory` echoing player text back undelimited a turn later). Both closed and pinned.

### ⚠️ Carry into Phase 3/4 planning
- **Cost**: a cached world-engine turn is **$0.0499**, not $0.04; a 50-turn session **~$2.65**,
  not $2.10. Output tokens dominate (~77%). A >5-min pause costs **+$0.087** on the next call.
- **The 15,132-token figure is stale** — cycle 2 added two lines to `WORLD_SYSTEM_PROMPT`.
  Re-derive with `count_tokens` (free). Only re-proving cache engagement costs money.
- **`WORLD_SYSTEM_PROMPT` is no longer byte-identical to the legacy artifact** (two deliberate,
  approved additions). Phase 4's parity audit must compare against the *current* file, not assume
  byte-equality with legacy.
- Phase 3 must not add middleware to `server.ts` without a test asserting what it emits — the
  CORS header value was the one security property that could silently degrade without erroring.

### Docker checks — closed later the same day
All 7 cross-plan checks now pass, plus the live error-path criterion. Docker was never broken:
this sandbox's PID 1 is `process_api` with no service manager, so `dockerd` had simply never been
started. Started by hand it works; a Docker Hub 429 on anonymous pulls then cleared on retry.

Verified in containers: `docker compose up` healthy end to end, Vite proxy forwarding
`:5173/api` → backend, both containers `uid=1000(node)`, frontend env carrying no `ANTHROPIC*`,
and four live non-2xx paths (400 / 404 / 502 / 401) all structured with the key absent from logs.

**If you need Docker again in a fresh session, start it yourself:**
```bash
setsid nohup dockerd > /tmp/dockerd.log 2>&1 < /dev/null &
# if it dies with "timeout waiting for containerd": pkill -9 -x dockerd containerd
#   && rm -f /var/run/docker.sock /run/containerd/containerd.sock, then retry
export NPM_CA_FILE=/root/.ccr/ca-bundle.crt   # required for builds here
```

### ⚠️ Blocker to plan for in Phase 4 (R14)
A containerized World Voice call fails in this sandbox: `self-signed certificate in certificate
chain`. The proxy CA is injected at **build** time for npm only and never reaches the runtime
image's trust store. **Not a product defect** — the developer's machine does not TLS-intercept —
but R14's in-sandbox end-to-end playthrough cannot run without this, no Dockerfile change needed:
```
-e NODE_EXTRA_CA_CERTS=/ca/ca-bundle.crt -v /root/.ccr/ca-bundle.crt:/ca/ca-bundle.crt:ro
```
With it mounted, the container reached the API and a bogus key mapped correctly to
`AUTHENTICATION_FAILED` / 401.

## Auth decision (2026-09-17) — settled, do not re-litigate
A Claude Max subscription does **not** include API access; Anthropic bills the API separately via Console credits. The artifact only worked because claude.ai injected auth tied to whoever opened it — `docs/design-decisions-log.md` records this as "a crude form of bring your own Claude account". Proceeding on Console credits with the Opus 5 split intact (originally estimated ~$0.04/turn, ~$2.10 per 50-turn session assuming caching engages; **measured 2026-09-17: $0.0499/turn, ~$2.65/session** — caching does engage, but output tokens run higher than the estimate assumed). A proxy converting API-key requests into OAuth calls against a Max subscription was raised and declined — that is the separation Anthropic's terms draw between the two products.

## Committer email — resolved
✅ **RESOLVED 2026-09-17.** All 23 commits on this branch now use `noreply@anthropic.com`. Fixed by `git rebase --exec "git commit --amend --no-edit --reset-author" 31f7381` followed by a force-push-with-lease.

Verified the rewrite changed metadata only: the tree hash was byte-identical before and after (`06c8793...`), `git diff` between the old and new HEAD was empty, and the commit count stayed at 23. Tests, builds and the verbatim data files were re-checked after.

**Consequence worth knowing:** rewriting the oldest commit changed every descendant's SHA, so all 23 commits have new IDs. The SHA references in these planning docs were remapped by matching commit subjects and each was confirmed to resolve to a real on-branch commit. Any SHA quoted in an older chat transcript or elsewhere outside this repo is stale — the commit exists, under a different ID.

**Auth decision (2026-09-17)**: a Claude Max subscription does not include API access — Anthropic bills the API separately via Console credits. The artifact worked only because claude.ai injected auth tied to the viewer. Proceeding on Console credits with the Opus 5 split intact (originally estimated ~$0.04/turn, ~$2.10 per 50-turn session assuming caching engages; **measured 2026-09-17: $0.0499/turn, ~$2.65/session** — caching does engage, but output tokens run higher than the estimate assumed). A proxy converting API-key requests into OAuth calls against a Max subscription was raised and declined.

## Phase 2 Plans
| Plan | Wave | Deliverable | Agent | Model | Status |
|---|---|---|---|---|---|
| 01 | 1 | Anthropic client module | Backend Architect | Sonnet 5 | ✅ `f0081fb` |
| 02 | 1 | Vitest + contract-guard test | QA Verification | Sonnet 5 | ✅ `1d18c25` |
| 03 | 2 | Three World Voice routes | AI Engineer | Sonnet 5 | ✅ `9ecb0ae` |
| 04 | 3 | Route tests vs mocked SDK | QA Verification | Sonnet 5 | ✅ `9ca38c2` |
| 05 | 4 | Live verification & cache proof | orchestrator | Opus 5 | ✅ caching proven live |

**Verified so far without a key**: 38 tests green; three routes built on one shared helper; `unique-skill` omits `system` entirely; the two Opus routes send byte-identical system blocks *and* `output_config`, so they share a cache namespace; all three carry `max_tokens: 16000`, `effort: 'high'`, no prefill, no `budget_tokens`; prompts byte-identical to the artifact by rendered-string diff.

**All three now verified by 02-05**: the API accepted the derived schema on every call; `cache_read_input_tokens` hit 15,132 on the second Opus call and again on `intro-scene`; and Opus 5 refused an adversarial Ultimate-Skill / Soul-Rewrite / Plundering / Ithren turn on every count.

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
