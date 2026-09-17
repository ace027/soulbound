# Project State

## Current Position
- **Phase**: 2 of 4 (executed, pending review)
- **Status**: Phase 2 complete — all 5 plans executed. Prompt caching verified against real API responses.
- **Last Activity**: Phase 2 wave 4 executed — plan 02-05 live verification (2026-09-17)

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

**Phase 2 is done — 5/5 plans complete.** Plan 02-05 ran live against the real API on
2026-09-17 and spent about $0.26.

1. `/legion:review` for Phase 2
2. then `/legion:plan 3` — the frontend port, which is the real regression risk (run plan
   critique before it; Phase 1 skipped it deliberately and Phase 3 should not)

### What 02-05 proved (see 02-05-SUMMARY.md for evidence)
- **Caching engages.** world-engine wrote 15,132 cached tokens; the next call read all 15,132 back.
- **The two Opus routes genuinely share a cache namespace** — `intro-scene` read the cache
  `world-engine` wrote. The Opus 5 intro-scene decision is now validated on measurement, not argument.
- `unique-skill` shows zero cache activity, as CLAUDE.md #8 requires.
- **Opus 5 holds the MUST NOT list.** An adversarial turn demanding an Ultimate Skill, a Soul
  Rewrite, Plundering and Ithren's true nature was refused on every count.

### ⚠️ Carry into Phase 3/4 planning — the cost estimate was low
- System blocks are **15,132 tokens, not ~9,600** (58% larger than the figure the estimate used).
- A cached world-engine turn costs **$0.0499**, not $0.04. A 50-turn session is **~$2.65, not $2.10** (26% over).
- **Output tokens dominate** (~77% of a cached turn) at `effort: 'high'` — caching is working; the gap is output spend.
- The 5-minute cache TTL means a >5-min pause between turns costs **+$0.087** on the next call.
  Ten such pauses take a session to ~$3.52. If cost bites, tune `effort` before touching the model
  split, and consider `cache_control: {ttl: '1h'}`.

### Still untested after Phase 2 — do not record these as passing
- **Containerized runtime**: no Docker daemon in the build sandbox. 02-05 ran the backend directly
  on the host. `docker compose config` resolves correctly and `USER node` is present in both
  Dockerfiles, but nothing was actually containerized, and non-root was not runtime-confirmed.
- **Live non-2xx error paths**: every live call succeeded, so the structured-error path is still
  only covered by 02-04's mocked tests.
- `/proc/<pid>/environ` retains the key for the process lifetime (the kernel does not update that
  region on `unsetenv`). Outside R2 as written, but `config.ts`'s comment does not mention the limit.

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
