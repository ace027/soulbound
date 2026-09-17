# Plan 02-05 Summary — Live verification, cache proof & cross-plan re-verification

**Status**: Complete
**Wave**: 4
**Agent**: orchestrator (claude-opus-5)
**Requirements**: R4, R5, R6, R7

## Files Created
None. `files_modified: []` — this plan is verification only. Working tree clean throughout;
the two mutations used as break tests were made to build output (`backend/dist/`) and restored.

## Headline: prompt caching engages. R7 is verified, not assumed.

The claim `docs/design-decisions-log.md` recorded as unverifiable from inside the artifact is
now measured against real API responses.

| # | Route | Model | t+ | input | cache_create | cache_read | output | stop_reason |
|---|---|---|---|---|---|---|---|---|
| 1 | `unique-skill` | claude-sonnet-5 | 0.0s | 998 | **0** | **0** | 1036 | `end_turn` |
| 2 | `world-engine` (adversarial) | claude-opus-5 | 16.1s | 883 | **15132** | 0 | 1641 | `end_turn` |
| 3 | `world-engine` | claude-opus-5 | 51.1s | 798 | 0 | **15132** | 1534 | `end_turn` |
| 4 | `intro-scene` | claude-opus-5 | 77.7s | 265 | 0 | **15132** | 1995 | `end_turn` |

All four elapsed inside the 5-minute TTL, so no result is a TTL-lapse false negative.

- **Caching works.** Call 2 wrote 15,132 tokens; call 3 read exactly 15,132 back. `cache_read_input_tokens > 0` — the proof this plan existed for.
- **The shared-namespace claim is CONFIRMED, not merely assumed.** `intro-scene` (call 4) read the cache `world-engine` wrote, byte-for-byte the same 15,132 tokens. This is the specific reason intro-scene was moved to Opus 5, and it had never been tested. **The Opus 5 intro-scene decision is validated on measured evidence.**
- **`unique-skill` correctly shows no cache activity** — both fields 0, as CLAUDE.md #8 requires (it sends no `system` at all).
- **No response hit `max_tokens`.** All four `end_turn`. No truncation.
- All four validated against the shared Zod schemas independently of the routes' own parse; a malformed control payload was rejected with 6 issues.

### ⚠️ Finding: the system blocks are 15,132 tokens, not the ~9,600 the plan estimated
58% larger than the figure the cost model was built on. Not a defect — but every per-turn
number below is anchored to the measured 15,132, not the estimate.

## Economics — the $0.04/turn assumption does not hold

Priced at Opus 5 $5/$25 per MTok, Sonnet 5 $2/$10, cache write 1.25x input, cache read 0.10x input.

| | Measured |
|---|---|
| Steady-state world-engine turn (cache hit) | **$0.0499** vs the $0.04 estimate |
| Same turn if caching had not engaged | $0.1180 (**2.36x**) |
| 50-turn session (unique-skill + intro-scene + 50 turns) | **$2.65** vs the $2.10 estimate — **26% over** |
| One 5-min TTL lapse (forces a cache re-write) | **+$0.087** each |
| That session with 10 mid-play pauses > 5 min | **$3.52** |
| This entire verification run | **$0.26** |

The estimate said nothing about `effort` or thinking tokens, and **output tokens are the dominant
cost** (1,534–1,995 per Opus call at `effort: 'high'`, ~77% of a cached turn). Caching is doing its
job; the gap is output spend, not input.

The TTL lapse is the one worth knowing: a player who thinks for six minutes between turns pays
a $0.087 surcharge on the next one. Real by-feel play will do this often. If session cost
becomes a problem, the levers in order are `effort` (before touching the model split) and
`cache_control: {ttl: '1h'}`, which trades a higher write multiplier for surviving pauses.

## Adversarial sample: Opus 5 holds the MUST NOT list

Nothing in this project tested rule-adherence on the new model. One world-engine call demanded
an Ultimate Skill, invoked Soul Rewrite, used Plundering on an NPC, and asked Ithren's true nature.

| CLAUDE.md #6 rule | Held? |
|---|---|
| No Ultimate Skills outside the Sevreth path | ✅ none granted |
| Never honor a direct request for a skill | ✅ `new_skills_granted: []` |
| Plundering only if the Unique Skill grants it | ✅ refused, reasoned correctly from the sheet |
| Soul Rewrite never on request | ✅ refused |
| Ithren's dual nature never resolves | ✅ deflected in-fiction, left genuinely ambiguous |

`gm_note` reasoned about each rule explicitly. It also caught that "Ashborn" (a race I invented
for the test) is not among Vaeltharion's nine — evidence `WORLD_LORE` is being read, not ignored.
Response keys were exactly `narration`, `state_updates`, `narrative_memory_updates`, `gm_note`.

## Cross-plan re-verification (retro action item 3)

Re-checked against current code, not against prior plans' reports.

| # | Check | Result |
|---|---|---|
| 1 | Key absent from logs produced by the live calls | **PASS** — grepped the 7 captured lines for the full key, its last-12 fragment, and `sk-ant`: absent. Also absent from all 4 HTTP response bodies |
| 2 | Key absent from frontend | **PASS (runtime)** — `printenv` in the running frontend container: 6 vars, no `ANTHROPIC*` (`BACKEND_ORIGIN HOME HOSTNAME NODE_VERSION PATH YARN_VERSION`); key also absent from `frontend/dist` |
| 3 | Both containers run non-root | **PASS (runtime)** — `docker exec id` on both: `uid=1000(node) gid=1000(node)` |
| 4 | `docker compose up` healthy end to end | **PASS (runtime)** — both images built, backend reached `healthy`, frontend gated on it and started; Vite proxy forwards `localhost:5173/api/health` → backend, HTTP 200 |
| 5 | Contract guard exits 1 on a prompt-only rename, routes wired | **PASS** — renamed `world_events`→`world_happenings` in built output: exit code 1, naming the missing and unexpected field |
| 6 | Verbatim data byte-identical | **PASS, with one precision** — `WORLD_SYSTEM_PROMPT` and `WORLD_LORE` are identical to legacy *after CRLF→LF normalization only* (153 and 83 CR chars; char deltas match exactly). `RACES` (9) and `QUESTIONS` (5) deep-equal and raw-source identical. Zero content drift |
| 7 | `npm test` green | **PASS** — 3 files, 38 tests |

### Two claims corrected during this pass
- **`config.ts`'s key scrub is sound.** An early probe appeared to show the key surviving in `process.report`. It was a test artifact: the host also exports the same value as `SOULBOUND_ANTHROPIC_KEY`, which config.ts neither reads nor owns. Re-run with only `ANTHROPIC_API_KEY` set (the container's actual shape), the scrub is complete. A canary confirmed the mechanism independently.
- **`/proc/<pid>/environ` still holds the key** for the process lifetime — the kernel does not update that region on `unsetenv`. Outside R2 as written (logs, error responses, stack traces, bundle) and unreachable without local process access, but the scrub is not total, and the comment in `config.ts` does not mention this limit.

## Phase 2 exit criteria

| Criterion | Verdict |
|---|---|
| Three routes return valid responses against the shared schema | **PASS** — all 200, all schema-valid, independently re-validated |
| `unique-skill` Sonnet 5 with no system blocks | **PASS** — measured: zero cache activity |
| `world-engine` + `intro-scene` Opus 5 via `buildSystemBlocks()` | **PASS** — measured: shared cache namespace |
| Models in one config module | **PASS** — `MODELS` in `config.ts`; no literals at call sites |
| `max_tokens: 16000`, no prefill, no `budget_tokens` | **PASS** — enforced by 02-04's tests; no 400s |
| Cache fields logged per call; second call reads cache | **PASS** — the headline table |
| Non-2xx produce diagnosable structured errors | **PASS (live)** — four real paths fired: 400 `INVALID_REQUEST` (naming both bad fields), 404 `NOT_FOUND`, 502 `UPSTREAM_ERROR` (connection failure), 401 `AUTHENTICATION_FAILED` (bogus key). Key absent from logs in every case |
| Key absent from logs/errors/traces — checked not assumed | **PASS for logs and responses**, with the `/proc` caveat above |

## Addendum (same day) — the Docker gaps are now closed

The three items first reported as untested were re-run and now pass on real evidence. The daemon
had simply never been started: this sandbox's PID 1 is `process_api`, with no service manager to
launch `dockerd`. Started manually, it ran fine. The follow-on blocker was a Docker Hub 429 on
anonymous pulls from the shared egress IP, which cleared on retry a few hours later.

All 7 cross-plan checks now pass, and the live error-path criterion passes too.

### ⚠️ New finding for Phase 4 (R14): containers cannot reach the API in this sandbox as built

A containerized World Voice call fails with `Connection error` →
`self-signed certificate in certificate chain`. The proxy CA is injected at **build** time for npm
only (the `npm_ca` BuildKit secret); it never reaches the **runtime** image's trust store, so Node
inside the container rejects the sandbox's TLS interception.

**This is not a product defect** — the developer's own machine does not TLS-intercept, so the
runtime image is correct as shipped. But it is a hard blocker for R14's *in-sandbox* end-to-end
playthrough, and Phase 4 should plan for it rather than discover it.

Verified workaround, no Dockerfile change needed:

```
-e NODE_EXTRA_CA_CERTS=/ca/ca-bundle.crt -v /root/.ccr/ca-bundle.crt:/ca/ca-bundle.crt:ro
```

With that mounted the container reached the API and a bogus key mapped correctly to
`AUTHENTICATION_FAILED` / HTTP 401, with the key absent from the logs.

### One reading corrected mid-pass
The bogus-key call first returned `UPSTREAM_ERROR` / 502, which looked like a misclassified auth
failure. It was not: the 502 came from a *connection* error (the CA problem above), and mapping a
statusless `APIConnectionError` to 502 is correct. Once the CA was mounted and the request actually
reached Anthropic, the `AuthenticationError` branch fired exactly as written.
