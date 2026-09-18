# Project State

## Current Position
- **Phase**: 4 of 4 (planned)
- **Status**: Phase 4 planned — 6 plans across 4 waves. Phase 3 shipped (PR #2, open against `main`).
- **Last Activity**: Phase 4 planning (2026-09-18)

## Progress
```
[██████████████████░░] 88% — 21/24 plans complete
```

## Ship record
- **PR #2** — https://github.com/DeanItServices/soulbound/pull/2 (base `main`, head `claude/admiring-wright-hfmugk`)
  Phase 3 — 14 commits, 46 files, +7,653/-28. Pre-ship gate: tests 237/237, shared+backend+frontend
  builds clean, working tree clean, review PASSED (2 cycles).
  ⚠️ **PR #1 was already merged** (`38cb2c9`, head `eed43ec`), so this is a NEW pull request — a
  merged PR cannot track new work. No rebase was done: `eed43ec` is an ancestor of `origin/main`, so
  the branch descends cleanly from merged history with no divergence, and rebasing would have
  rewritten 14 SHAs that STATE.md and 03-REVIEW.md reference by name. This repo already lost a full
  set of SHA references to a history rewrite once (see "Committer email" below).
  ⚠️ **Gate 3a (build completeness) does not hold as literally specified** — this project has never
  produced `SUMMARY.md` files; all three phases recorded plan outcomes in commit messages. Every one
  of the 10 plans has a commit and the plan→commit table below is the evidence. Recorded rather than
  marked green.

- **PR #1** — https://github.com/DeanItServices/soulbound/pull/1 (base `main`, head `claude/admiring-wright-hfmugk`)
  Covers **both** Phase 1 and Phase 2: `main` had not received Phase 1 either.
- Pre-ship gate: 6/6. Tests 108/108, build clean, working tree clean.
- ⚠️ **One gap recorded in the PR rather than hidden**: the containerized verification
  (compose healthy, Vite proxy forwarding, non-root, no key in frontend env) was captured at
  `0f060ea`, one commit behind the shipped HEAD `02ea728`. That commit's only backend change was
  behavior-neutral import reordering, and 108 tests are green — but it was not re-verified in a
  container, because pruning Docker's image store (to repair snapshot corruption) ran into a
  Docker Hub 429 on the base-image pull. Re-run when the limit clears if you want it closed.

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

**Phase 4 is planned** — 6 plans across 4 waves. Run `/legion:build` to execute it.

### Phase 4 Plans
| Plan | Wave | Deliverable | Agent | Cost |
|---|---|---|---|---|
| 01 | 1 | R13 — eight-constraint audit; corrects R13's own "seven" | QA Verification | free |
| 02 | 1 | R16 — close with evidence from the existing suite | Test Results Analyzer | free |
| 03 | 1 | Retro AI-5 — committed Playwright smoke test | Frontend Dev | free |
| 04 | 2 | R15 — CLAUDE.md auth note; design-log model split | Technical Writer | free |
| 05 | 3 | R14 — live playthrough + cache proof | orchestrator | **~$0.25** |
| 06 | 4 | Legacy deletion + 69 citations + cross-plan re-verification | orchestrator | free |

Wave 1's three plans are file-disjoint (verified) and run in parallel. **Only plan 05 spends
money**, isolated so the phase completes without a key — in which case R14 is reported UNTESTED.

### Five facts derived while planning that revised ROADMAP's 3-plan estimate
1. **R16 is already satisfied.** `backend/src/__tests__/contract.test.ts` has all five cases R16
   asks for (valid passes; rename, missing field and unparseable JSON each throw loudly), and save
   round-trip tests exist at `saves.test.ts:163`. R16 became a verification plan, not a build plan.
2. **R13's text is stale**: PROJECT.md:38 says "seven" constraints; CLAUDE.md has **eight**. The
   audit covers 8 and 04-01 corrects the wording.
3. **R15 is half-done and half-wrong**: CLAUDE.md:49-54 already records the model split, but
   CLAUDE.md:63 still says auth is an "OPEN DECISION, resolve before scaffolding a backend" — the
   backend is shipped and merged. And `docs/design-decisions-log.md` has **zero** occurrences of
   "opus" or "sonnet"; the split was never logged there at all.
4. **Deleting legacy breaks 69 citations across 25 files** (`grep -rhoE 'legacy [0-9]+(-[0-9]+)?'`).
   Git history preserves the file; the docstring references stop resolving. 04-06 decides this
   before deleting, not after.
5. **R14's two blockers are already diagnosed** — the `SOULBOUND_ANTHROPIC_KEY` env var and the CA
   mount for containerized calls. Both are written into 04-05 so they are not rediscovered.

### Planning-gate decisions
- **The inherited `currentSlotId` closure race stays unfixed** — offered at the gate and declined.
  It is legacy 913-1031 behaviour, so fixing it would deviate from the artifact. Recorded as a
  decision, not an oversight. A plan that "helpfully" repairs it is reversing a developer call.
- **Every Phase 4 plan writes a `SUMMARY.md`** (retro AI-6). Three phases recorded outcomes only in
  commit messages, which is why the ship gate's build-completeness check could not hold as
  specified. That ends this phase.
- Architecture proposals and the spec pipeline skipped — this is a verification phase against
  already-shipped code, not a design problem.

### Phase 3 execution record
| Plan | Wave | Commit |
|---|---|---|
| 01 | 0 | `2a0786f` test harness |
| 02, 04, 05 | 1 | `9f7f6a0` saves, game logic, viewport hook |
| 03, 07 | 1 | `2ee1faa` API client, creation screens |
| 06 | 2 | `1b8e8f5` presentational components + shared LogEntry |
| 08 | 3 | `bca8dd0` loading/simulation screens, CLAUDE.md #3 fixes |
| 09 | 4 | `963513c` App.tsx wiring |
| 10 | 5 | `61fbb07` integration test + cross-plan re-verification |
| review | — | cycle 1: 4 surviving mutants closed. cycle 2: `deleteSave` gap closed, 129 tests |

### ⚠️ Carried into Phase 4 from the Phase 3 review
1. **Inherited closure race, NOT fixed — developer call needed.** `handleAction`
   closes over `currentSlotId`. Clicking "+ Slot" (`handleManualSave`, which has no
   `isThinking` guard) while a world-engine call is in flight lands that turn's
   autosave on the OLD slot; the new slot stays one turn stale. Reproduced live
   during review. Present identically in legacy 913-1031, so the port did not
   introduce it — flagged rather than changed, per CLAUDE.md's working-style rule.
   Minimal fix if wanted: mirror `currentSlotId` in a `useRef` and read that inside
   the `setLog` updater.
2. **No repeatable visual regression guard.** jsdom performs no layout, so the
   suite asserts declared style properties only. Plan 03-08's screenshot harness was
   deleted after use. Nothing automated would catch a future collapsed panel.
3. **Nothing has touched a live backend.** Every frontend test mocks `fetch`.
   The API wiring's "PASS" has never reached a real Express server — that is R14.
4. **`runtime` Docker image still non-deployable** (`/api/*` answers 200 + HTML).
   Known and deferred; it becomes real the moment the frontend is served from it.

### Process finding from the review — worth not repeating
Three reviewers ran in parallel against one working tree, one of which mutates
source files by design. All three independently observed a "flaky" test and
attributed it to Vitest pool flakiness. It was not flaky: the failures were other
reviewers' live mutations. `|| 5` → `?? 5` produced `expected +0 to be 5`, and
`response.ok` → `if (false)` produced the 9-test api failure. On a clean tree the
suite is 8/8 green. **A mutating reviewer needs its own worktree, or must run
serially.** Cycle 2 ran serially and was clean. A second vector surfaced there: a stop
hook prompted a commit mid-sweep, and the reviewer saw HEAD move under it. Same rule
covers both — **while a reviewer holds the tree, do not write to it.**

### Phase 3 Plans (post-critique)
| Plan | Wave | Deliverable | Agent | Model |
|---|---|---|---|---|
| 01 | 0 | Test harness — jest-dom wiring, scrollIntoView stub, configs frozen | Frontend Dev | Sonnet 5 |
| 02 | 1 | `lib/saves.ts` + tests (R11) | Frontend Dev | Sonnet 5 |
| 03 | 1 | `lib/api.ts` + content-type guard + zero-cost stub (R9, R12) | Frontend Dev | Sonnet 5 |
| 04 | 1 | `game/applyWorldUpdate.ts` (925-1021) + 10 mutants (R10) | orchestrator | Opus 5 |
| 05 | 1 | `hooks/useIsMobile.ts` + tests (R12) | Frontend Dev | Sonnet 5 |
| 07 | 1 | Title / Race / Questionnaire screens (R9) | Frontend Dev | Sonnet 5 |
| 06 | 2 | Four components + `shared` LogEntry extension (R9) | Frontend Dev | Sonnet 5 |
| 08 | 3 | Loading / Simulation screens + CLAUDE.md #3 fixes + screenshots | UX Architect | Sonnet 5 |
| 09 | 4 | `App.tsx` wiring (seeded-save path, zero cost) | orchestrator | Opus 5 |
| 10 | 5 | Integration test + phase-close cross-plan re-verification | orchestrator | Opus 5 |

Wave 1 runs **five** plans in parallel (file-disjointness verified).

### ⚠️ Plan critique ran and returned REWORK — findings applied
Carried forward unaddressed through two retros, it caught five execution-blocking defects:

1. **Four factual errors in the plans**: "17 `useState`" (legacy has 16 + 1 `useRef`) — which would
   have made a *correct* port fail its own verify gate; every component port range off by one at the
   start; "`writeSave` already slices the log" (it has zero slices — the cap is in `autoSave`); and
   a new `game/tierStyle.ts` duplicating a `TIER_STYLE` **already exported by `shared`**.
2. **A fix-induced defect in the prescribed fix**: the CLAUDE.md #3 replacement div omitted `flex: 1`,
   which collapses the mobile layout — and **jsdom does no layout**, so every test would have passed
   on a visibly broken page. Third consecutive phase where a fix introduces the defect.
3. **Wave 0 could not run waves 2-4's tests**: `@testing-library/jest-dom` installed but never
   registered, the exclude glob matching none of this phase's test directories, and no
   `scrollIntoView` stub (jsdom lacks it; legacy 812 calls it on every log change).
4. **Three vacuous verifications**: the `<style>` grep pointed at `components/`, which contains none
   of the six blocks; "17 `useState`" was unsatisfiable; "compare programmatically" is not executable
   against JSX with conditionals and template interpolation.
5. **Three orphaned seams**: the 80-entry cap, the `logEntry` composition (range said 1008, it is
   built at 1014), and `actionHistory` growing past the backend's `max(2000)`.

Also applied: `shared/src/gameState.ts` gained an owner (plan 06) for the missing `LogEntry.etchingSkill`
and `unknown[]` `newSkills`; plan 09 was split so the integration test cannot be absorbed into the
wiring; and the **cross-plan re-verification** the context claimed to apply — but no plan contained —
is now plan 10.

**Rule adopted for this phase: derive every count and range, report the derivation, never restate a
number from prose.** Four of the five blocking defects were that failure.

### Architecture: Pragmatic, chosen from three proposals
Three read-only proposals were generated. **Pragmatic** won: split the five screens into
`screens/*.tsx`, but leave the state graph alone — `App.tsx` keeps all **16** `useState` (plus one
`useRef`) and the
`autoSave`-inside-`setLog` closure exactly as legacy has them. Clean's `useGameSession` hook was
rejected because it rewrites the state graph, which is the most behaviour-load-bearing and
least-tested part of the port. Minimal's single 700-line `App.tsx` was rejected because its own
author called it "unreviewable by diff, with the tests covering none of it".

The one deviation from verbatim is `game/applyWorldUpdate.ts` — extracted purely so R10's rules
become testable.

### Four things verified while planning that changed the plans
1. **`shared/src/gameState.ts` already exports the save keys** (`SAVE_INDEX_KEY`, `SAVE_PREFIX`,
   `MAX_LOG_SAVED`, `SAVE_SCHEMA_VERSION`). `lib/saves.ts` imports them; redeclaring would create a
   second source of truth for the one thing that must stay byte-identical.
2. **The 25/60/100 thresholds are model-side, not client-side** (`WORLD_SYSTEM_PROMPT` 40/55/93/139).
   A frontend test asserting them would have been untestable fiction, and a client-side guard would
   silently swallow legitimate unlocks on an overshooting mastery jump. Plans forbid both.
3. **Legacy violates CLAUDE.md #3 twice on one scroll chain** — `WorldLog`'s root (L659) lacks
   `minHeight: 0`, and a Fragment at L1388 acts as the mobile flex/scroll container with its parent
   also missing it. A literal verbatim port would carry both forward. Plans 06 and 08 fix them.
4. **`frontend/package.json` has no test runner**, which is why wave 0 exists and why the plan count
   went 4 → 10.

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
