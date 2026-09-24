The backend now refuses to boot without `SOULBOUND_PASSPHRASE` (12+ printable ASCII characters). Add it to `.env`, and export it for host-run.

## Status: Complete

## Tasks

### Task 1 — Shared gate contract
Created `shared/src/accessGate.ts` with exactly the seven exports from the spec's "API and Type
Contracts" section (`ACCESS_HEADER`, `ACCESS_SCHEME`, `ACCESS_STORAGE_KEY`, `PASSPHRASE_REQUIRED`,
`TOO_MANY_REQUESTS`, `ACCESS_CHECK_PATH`, `MIN_PASSPHRASE_LENGTH`), re-exported from
`shared/src/index.ts` in the same `export * from './x.js'` style as the existing two lines.

Verify output:
```
$ npm run build -w @soulbound/shared
> @soulbound/shared@0.0.1 build
> tsc -p tsconfig.json
(exit 0)

$ node -e "import('@soulbound/shared').then(m=>console.log(m.PASSPHRASE_REQUIRED, m.MIN_PASSPHRASE_LENGTH))"
PASSPHRASE_REQUIRED 12
```

### Task 2 — Config readers + tests
Added to `backend/src/config.ts`, following the `readApiKey()`/`redact()`/`FRONTEND_ORIGIN`
patterns cited in the plan:
- `readPassphrase()` → `Secret`, reading `SOULBOUND_PASSPHRASE`, deleting it from `process.env`,
  trimming, and throwing on missing/empty, under-12-character, or non-printable-ASCII input.
  None of the three messages echo the value.
- `checkPassphrase(candidate)`: SHA-256 both sides (`node:crypto` `createHash`), then
  `timingSafeEqual` on the two fixed-length digests (hashing first means a wrong-length candidate
  never throws or leaks a length signal).
- `redact()` extended to also strip the passphrase, guarded against an empty string.
- `RATE_LIMIT_PER_MINUTE` (default 30, integer 1–600), `TRUST_PROXY` (`false` default; accepts
  `loopback`, `uniquelocal`, integers 1–5; rejects `true` and anything else), `STATIC_DIR`
  (`undefined` default; must be an absolute path containing `index.html`).

Test files updated so every existing suite that imports `config.js` sets a fake
`SOULBOUND_PASSPHRASE` beside its fake key, at the exact placements the plan specified:
`config.test.ts` → inside `resetEnv()` (also deletes the three new optional vars each run so a
`TRUST_PROXY=true` throw-case can't leak into the next test); `server.test.ts` → inside
`setStartupEnv()`, not top level; `routes.test.ts` → top level beside `FAKE_KEY`; `anthropic.test.ts`
→ in each of its three `beforeAll` blocks beside `process.env.ANTHROPIC_API_KEY = FAKE_KEY`.

`config.test.ts` gained six new `describe` blocks: `SOULBOUND_PASSPHRASE`, `checkPassphrase`,
`redact()`, `RATE_LIMIT_PER_MINUTE`, `TRUST_PROXY`, `STATIC_DIR` — covering every failure mode in
the spec's table plus happy paths, the short-passphrase message not containing the passphrase, the
non-ASCII case with both `é` and an emoji, and `redact()` stripping both secrets from one string.

Verify output:
```
$ npm run build && npm test -w @soulbound/backend
(build: 0 errors, three workspaces)
 Test Files  7 passed (7)
      Tests  146 passed (146)
```
Backend test count: **117 → 146** (measured from a clean `git worktree` checkout of the
pre-change commit `f0079b9`, not restated from memory: `Test Files 7 passed (7)` /
`Tests 117 passed (117)`). **+29 new tests.**

Mutation checks (each run serially: mutate → `npm test -w @soulbound/backend` → `git checkout --
backend/src/config.ts` → `git diff --exit-code backend/src/config.ts` confirmed clean before the
next):

| Mutation | Result |
|---|---|
| (a) remove `delete process.env.SOULBOUND_PASSPHRASE` | RED — `SOULBOUND_PASSPHRASE > is removed from process.env once read` |
| (b) make `redact` skip the passphrase | RED — `redact() > strips both the API key and the passphrase from one string` |
| (c) accept `TRUST_PROXY=true` | RED — `TRUST_PROXY > rejects "true" — every hop is spoofable with no proxy in front` |

All three caught on the first pass; no test needed to be added mid-mutation (AI-1 satisfied without
a retry). Restore confirmed clean after each with `git diff --exit-code backend/src/config.ts`.

Committed before the mutation checks (protocol 1): `5c45340` —
`feat(config): require SOULBOUND_PASSPHRASE; add rate-limit, trust-proxy and static-dir readers`.

### Task 3 — Dev env passthrough
- `.env.example`: added a `SOULBOUND_PASSPHRASE=` block (required, 12-char minimum, plain-ASCII
  requirement explained, "not your Anthropic key" framing) right after the key section, plus
  commented `RATE_LIMIT_PER_MINUTE` and `TRUST_PROXY` entries beside `ALLOWED_HOSTS`/`FRONTEND_ORIGIN`
  in the same "refuses to boot on a bad value" voice.
- `docker-compose.yml`: added
  `- SOULBOUND_PASSPHRASE=${SOULBOUND_PASSPHRASE:?Set SOULBOUND_PASSPHRASE in .env — see .env.example}`
  to the backend `environment` block, with a short comment. Left the header comment and every other
  service setting untouched (05-04 owns the header).
- `README.md:36-38` (host-run note): now names `SOULBOUND_PASSPHRASE` beside the key and says the
  backend refuses to boot without it. Nothing else in the README touched (05-06 owns the rest).

Verify output:
```
$ SOULBOUND_PASSPHRASE=placeholder-passphrase docker compose --env-file /dev/null config -q
(exit 0)

$ env -u SOULBOUND_PASSPHRASE docker compose --env-file /dev/null config -q
error while interpolating services.backend.environment.[]: required variable SOULBOUND_PASSPHRASE
is missing a value: Set SOULBOUND_PASSPHRASE in .env — see .env.example
(exit 1)

$ grep -n SOULBOUND_PASSPHRASE .env.example docker-compose.yml
.env.example:29:SOULBOUND_PASSPHRASE=
docker-compose.yml:49:      - SOULBOUND_PASSPHRASE=${SOULBOUND_PASSPHRASE:?Set SOULBOUND_PASSPHRASE in .env — see .env.example}
```
Both worked with the Docker daemon not running, as expected (`docker compose config` needs no
daemon).

Final full-workspace check before closing the plan:
```
$ npm run build   → shared, backend, frontend all build clean (frontend: "✓ built in 582ms")
$ npm test -w @soulbound/backend   → Test Files 7 passed (7), Tests 146 passed (146)
$ npm test -w @soulbound/frontend  → Test Files 11 passed (11), Tests 150 passed (150)
```

## Files modified
- `shared/src/accessGate.ts` (new)
- `shared/src/index.ts`
- `backend/src/config.ts`
- `backend/src/__tests__/config.test.ts`
- `backend/src/__tests__/routes.test.ts`
- `backend/src/__tests__/server.test.ts`
- `backend/src/__tests__/anthropic.test.ts`
- `.env.example`
- `README.md`
- `docker-compose.yml`
- `.planning/phases/05-docker-image-publishing/05-01-SUMMARY.md` (this file)

## Test counts
- Backend: **117 → 146** (+29), measured via `vitest run` output, before-count from a `git worktree`
  checkout of `f0079b9` (the commit this plan started from).
- Frontend: unchanged at **150** (this plan touches no frontend file; run to confirm no regression).
- `@soulbound/shared` has no `test` script (unchanged from before this plan).

## Mutation table
| Mutation | Outcome |
|---|---|
| Remove `delete process.env.SOULBOUND_PASSPHRASE` | FAILED test: `SOULBOUND_PASSPHRASE > is removed from process.env once read` |
| Make `redact` skip the passphrase | FAILED test: `redact() > strips both the API key and the passphrase from one string` |
| Accept `TRUST_PROXY=true` | FAILED test: `TRUST_PROXY > rejects "true" — every hop is spoofable with no proxy in front` |

## Decisions made
- Placed the three new config sections (`RATE_LIMIT_PER_MINUTE`, `TRUST_PROXY`, `STATIC_DIR`) after
  `MODELS` at the end of `config.ts` rather than interleaved with `ANTHROPIC_API_KEY`/
  `FRONTEND_ORIGIN`, since they're a distinct concern (the access gate, not CORS/auth) added in one
  block — easier to review as a unit, and it keeps the diff to the existing sections minimal.
  `readPassphrase()`/`checkPassphrase()` sit directly after `getAnthropicApiKey()`/before `redact()`
  since they follow the exact same secret-handling shape as the key.
- `checkPassphrase` hashes both sides with SHA-256 before `timingSafeEqual` rather than padding to a
  fixed length or requiring equal-length inputs — this avoids `timingSafeEqual` throwing on a
  length mismatch (which the spec's mutation table implies must not happen) and avoids a `===`
  fallback for the mismatched-length case, which would reintroduce exactly the timing leak the gate
  exists to close.
- `TRUST_PROXY`'s literal string `'false'` is accepted (in addition to unset) as an explicit "no,
  really, don't trust a proxy" — matches how the type is described in the spec (`false | 'loopback'
  | 'uniquelocal' | number`) and how an operator would plausibly write it in `.env`.
- Used a `git worktree` (not `git stash`, which the protocol forbids) checked out at `HEAD` (`f0079b9`,
  the phase's starting commit for this plan) to get an authoritative "before" test count from
  `vitest` itself rather than a `grep -c 'it('` estimate.

## Issues / anything left for 05-02
- No route behaviour changed — `RATE_LIMIT_PER_MINUTE`, `TRUST_PROXY`, `checkPassphrase`, and
  `STATIC_DIR` are all read and validated but not yet wired into any middleware or route. That's
  05-02's job (the rate limiter, the gate middleware, `/api/access`, and the mutation-verified
  pipeline tests for them).
- `routes.test.ts` now sets a fake `SOULBOUND_PASSPHRASE` at module scope so `buildApp()` continues
  to construct without throwing, but no request in that file sends a matching `Authorization`
  header yet — there's nothing to gate until 05-02 mounts the middleware. Flagging so 05-02 doesn't
  read the current all-green routes.test.ts as evidence the gate already works.
- `backend/src/server.ts`'s `AppConfig` type is untouched by this plan (per `files_modified`); 05-02
  is where it gains `checkPassphrase, RATE_LIMIT_PER_MINUTE, TRUST_PROXY, STATIC_DIR` and the
  optional injectable `now?: () => number` per the spec.

## Auto-remediated
None — no self-caught mistakes this plan; all three tasks' first-pass verifies and mutation checks
passed as designed.
