Before the title screen, the browser now asks `GET /api/access` whether it needs a passphrase. If
it does, an inline form (never `window.prompt`) collects it and stores it in `localStorage`; every
API call after that carries it as `Authorization: Bearer <passphrase>`. `App.tsx` never knew any of
this happened.

## Status: Complete

## Tasks

### Task 1 — Passphrase store
Created `frontend/src/lib/passphrase.ts`: `getPassphrase`, `setPassphrase`, `clearPassphrase` (each
wrapped in try/catch, matching `saves.ts` — a blocked store returns null / does nothing, never
throws), and a plain in-module `Set`-based `onPassphraseRequired(fn) → unsubscribe` /
`emitPassphraseRequired()` pair (no new dependency). Storage key comes from
`ACCESS_STORAGE_KEY` in `@soulbound/shared`, never redeclared. Docstring states this is a
deployer-issued passphrase, not an Anthropic key, and names why it is not the rejected BYOK.

Tests (`lib/__tests__/passphrase.test.ts`): round trip, clear, a throwing `Storage.prototype` stub
for each of the three storage functions, subscribe/emit/unsubscribe, multiple subscribers, and a
save written via `writeSave` still loading after the passphrase is set and cleared (proves the two
key spaces don't collide).

Verify:
```
$ npm test -w @soulbound/frontend -- passphrase
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

### Task 2 — `lib/api.ts`: header, 401 handling, `checkAccess`
- New `authHeaders()` helper adds `Authorization: Bearer <p>` to every fetch when
  `getPassphrase()` is non-null (used by all three POST fetchers and by `checkAccess`'s GET).
- In `postJson`'s non-2xx branch: `response.status === 401 && code === PASSPHRASE_REQUIRED` calls
  `clearPassphrase()` and `emitPassphraseRequired()` **before** the existing throw — keyed on
  `code`, never on status alone, so a 401 `AUTHENTICATION_FAILED` (the deployer's own Anthropic key
  is bad) never wipes a correct passphrase (05-CONTEXT.md derived fact 1). The thrown message is
  still whatever the backend's envelope said (`"Passphrase required"` for the gate's own 401), so
  `App`'s existing catch blocks (`App.tsx:268`, `:303`) render it unchanged with zero edits to that
  file.
- New `export async function checkAccess(): Promise<'ok' | 'required' | 'unknown'>`: 204 → `'ok'`;
  401 with a `PASSPHRASE_REQUIRED` envelope → `'required'`; every other outcome — a network
  rejection, a 502 `text/plain` (Vite's dev proxy with no backend), a 401 with no recognisable code,
  a 200 with an HTML body — → `'unknown'`. Never throws.
- Doc comments updated: the `ApiClientErrorCode` header now lists `PASSPHRASE_REQUIRED` and
  `TOO_MANY_REQUESTS` among the backend codes; `postJson`'s gate-order comment gained a line
  explaining the code-keyed 401 branch.

Tests added to `lib/__tests__/api.test.ts` (two new `describe` blocks, `the access-gate header` and
`checkAccess`): header present on all three fetchers when stored / absent when not; 401
`PASSPHRASE_REQUIRED` clears storage, notifies exactly one subscriber, and throws; 401
`AUTHENTICATION_FAILED` does **not** clear storage or notify; 429 `TOO_MANY_REQUESTS` surfaces its
message and leaves storage alone; `checkAccess` mapped for 204, 401+code, 401 without a recognisable
code, 502 text/plain, a network rejection, and 200 HTML; the stored passphrase (or its absence) is
sent correctly on `checkAccess`'s own GET; `checkAccess` GETs `ACCESS_CHECK_PATH` with method `GET`.
Also added `localStorage.clear()` to the file's existing `beforeEach`/`afterEach` so no test's
stored passphrase leaks into another.

Verify:
```
$ npm test -w @soulbound/frontend -- api
 Test Files  1 passed (1)
      Tests  46 passed (46)
```
Count before this task: 32 (the file's pre-existing tests). After: 46 (+14).

### Task 3 — `AccessGate`, `main.tsx`, e2e
Created `frontend/src/components/AccessGate.tsx`. On mount it calls `checkAccess()`:
- `'pending'`: renders only `sharedBg` (no flash of the form before a fast `'ok'`).
- `'ok'` / `'unknown'`: renders `children`. `'unknown'` fails OPEN in the UI per the spec's
  "UI when the check isn't a 401" decision — the backend enforces regardless, and failing closed
  would lock out any dev run started before the backend is up.
- `'required'`: an inline top-aligned `<form>` — title line, a hidden read-only
  `autoComplete="username"` input valued `soulbound` for password managers, a password input with
  `autoComplete="current-password"`, `autoCapitalize="off"`, `autoCorrect="off"`,
  `spellCheck={false}`, `enterKeyHint="go"`, a `type="button"` show/hide toggle, and a submit
  button. Submit (button or Enter) calls `setPassphrase(value.trim())` then re-runs `checkAccess()`;
  a second `'required'` shows an inline "That passphrase didn't work." line.

It also subscribes to `onPassphraseRequired` and, when that fires, renders the form as a `position:
fixed` overlay on top of `children` (kept mounted, so in-progress game state survives a mid-session
passphrase rotation) rather than replacing them.

`main.tsx` now renders `<AccessGate><App /></AccessGate>` inside `StrictMode`, with a comment
naming the two-calls-per-dev-load consequence. `App.tsx` itself was never opened for writing.

Tests (`components/__tests__/accessGate.test.tsx`, `fetch` mocked, 11 tests): form shown on 401;
children shown on 204; children shown on 502 (fails open); submitting stores the passphrase and
renders children; a pasted value with surrounding whitespace is trimmed before storage; pressing
Enter submits; the show/hide toggle switches the input's `type`; a later
`onPassphraseRequired`/`emitPassphraseRequired` event overlays the form while children stay in the
DOM; a full `<AccessGate><App/></AccessGate>` render shows the title screen after a 204; a static
source guard that `AccessGate.tsx` contains neither `localStorage` nor `fetch(`; a "pending" state
shows neither children nor the form until the check resolves.

**e2e** (`frontend/e2e/smoke.spec.ts`): `beforeEach` now registers
`page.route('**/api/access', r => r.fulfill({ status: 204 }))` before anything calls `page.goto`
(the first `page.goto` in any test is inside `loadSave`), and the request recorder now exempts
exactly `/api/access` (`/\/api\/access(\?|$)/`) with a comment on why. One new test, "the passphrase
form is visible, usable and on screen", overrides the route to 401 `PASSPHRASE_REQUIRED` and checks,
**within one test** (not two parametrized ones, to keep the file's test count at 5→6 rather than
5→7): at 375×800 the input and submit button are visible, fully inside the viewport, focusable, and
the input's top edge sits in the upper half of the viewport (the mobile-keyboard margin); then, after
`setViewportSize(DESKTOP)` on the same already-loaded page (no reload, same technique the existing
breakpoint-resize test uses), the same visible/inside-viewport/focusable checks at 1280×800. The 5
existing tests' bodies are byte-for-byte unchanged — confirmed by the diff below.

Verify:
```
$ npm run build
(shared, backend, frontend all build clean)

$ npm test -w @soulbound/frontend
 Test Files  13 passed (13)
      Tests  184 passed (184)
```
Frontend count before this plan: **150**. After: **184** (+34: +9 passphrase, +14 api, +11
accessGate). (46-32=14 net new in api.test.ts; the file's own before/after totals — 32 then 46 —
are also reported above per-task.)

```
$ cd frontend && npm run test:e2e
Running 6 tests using 1 worker
  ✓ world log overflows... — mobile 375x800
  ✓ world log overflows... — desktop 1280x800
  ✓ action bar stays pinned... — mobile 375x800
  ✓ action bar stays pinned... — desktop 1280x800
  ✓ resizing across the 700px breakpoint switches layout without a reload
  ✓ the passphrase form is visible, usable and on screen
  6 passed (14.6s)
```

```
$ git diff --exit-code 7856b7d -- frontend/src/App.tsx
(exit 0 — byte-identical)
```

```
$ git diff 7856b7d -- frontend/e2e/smoke.spec.ts
```
Touches exactly: the `beforeEach` block (adds the `/api/access` stub route and the one exemption
line in the recorder regex; the callback becomes `async` to `await page.route(...)`), and one new
`test(...)` block appended after the last existing test. Nothing inside any of the 5 pre-existing
`test(...)` bodies changed — verified by inspection of the diff hunks (two hunks total: one at the
guard, one purely additive at the end of the file).

```
$ grep -nE "localStorage|fetch\(" frontend/src/components/AccessGate.tsx
(no output, exit 1 — clean)
```
(One early docstring draft did say "reaches neither `localStorage` nor `fetch` directly" in prose;
reworded to "reaches neither browser storage nor the network directly" once this grep — which,
unlike `constraints.test.ts`, does not strip comments — caught it. See Auto-remediated.)

Mutations (each on the committed tree, restored with `git checkout -- frontend/src/lib/api.ts`,
confirmed clean with `git diff --exit-code` before the next):

| # | Mutation | Result |
|---|---|---|
| 1 | `checkAccess`'s final `return 'unknown';` (the 502/non-401/non-204 fallback) changed to `return 'required';` | **RED** — 2 tests failed: `checkAccess > maps a 502 text/plain (Vite proxy, no backend) to unknown` and `checkAccess > maps a 200 HTML body to unknown` |
| 2 | `if (response.status === 401 && code === PASSPHRASE_REQUIRED)` narrowed to `if (response.status === 401)` | **RED** — 1 test failed: `the access-gate header > 401 AUTHENTICATION_FAILED does NOT clear the stored passphrase` (got `null` instead of the preserved passphrase) |

Both caught on the first pass; no test needed adding mid-mutation.

Committed before the mutation sweep (protocol point 1): `4d71e16` —
`feat(frontend): add AccessGate wrapper and e2e gate test`.

## Files modified
- `frontend/src/lib/passphrase.ts` (new)
- `frontend/src/lib/__tests__/passphrase.test.ts` (new)
- `frontend/src/lib/api.ts`
- `frontend/src/lib/__tests__/api.test.ts`
- `frontend/src/components/AccessGate.tsx` (new)
- `frontend/src/components/__tests__/accessGate.test.tsx` (new)
- `frontend/src/main.tsx`
- `frontend/e2e/smoke.spec.ts`
- `.planning/phases/05-docker-image-publishing/05-03-SUMMARY.md` (this file)

## Frontend unit test counts
- Before this plan: **150** (11 test files).
- After: **184** (13 test files). +9 (`passphrase.test.ts`, new file) + 14 (`api.test.ts`, net new
  in that file) + 11 (`accessGate.test.tsx`, new file) = +34.

## e2e result
`cd frontend && npm run test:e2e` → **6 passed** (the 5 pre-existing geometry tests + 1 new gate
test), matching the spec's acceptance check exactly.

## `App.tsx` diff check
`git diff --exit-code 7856b7d -- frontend/src/App.tsx` → **exit 0**. The file was never opened for
writing in this plan.

## `git diff 7856b7d -- frontend/e2e/smoke.spec.ts` scope check
Two hunks: the `beforeEach` guard block (stub route + one exemption line + `async`), and one
appended `test(...)` block at the end of the file. No existing `test(...)` body's contents changed.

## Mutation table
| # | Mutation | File | Result |
|---|---|---|---|
| 1 | `checkAccess`'s 502/unrecognised fallback returns `'required'` instead of `'unknown'` | `frontend/src/lib/api.ts` | RED (2 tests) |
| 2 | The 401 code check drops `&& code === PASSPHRASE_REQUIRED`, so any 401 clears storage | `frontend/src/lib/api.ts` | RED (1 test) |

## Decisions made
- **One e2e test, not two.** The plan's task-3 prose reads as one test asserting both viewports;
  a first draft used the file's usual `for (const [label, viewport] of [...])` parametrized-test
  pattern (matching every other geometry test in the file) and produced 7 passing tests instead of
  the spec's stated 6. Re-read the plan's own verify line ("`npm run test:e2e` gives 6 passed") and
  the spec's acceptance check ("5 existing + 1 gate test") and rewrote it as one test that changes
  viewport size mid-test with `page.setViewportSize` (the same technique the pre-existing
  breakpoint-resize test already uses), asserting both viewports without a reload. Caught before
  committing task 3 (AI-1/AI-2), not left as a two-test drift.
- **`checkAccess`'s network-error path returns `'unknown'` without distinguishing it from other
  non-401/204 outcomes** — a single early `try { … } catch { return 'unknown'; }` around the fetch
  call, then one shared fallthrough `return 'unknown'` at the end for every other status. This
  matches the spec's "Anything else, including a network error... gives 'unknown'" instruction
  literally, and keeps the function to one code path per outcome rather than three near-identical
  branches.
- **`postJson`'s 401-clears-storage branch reads `envelope.code`**, the same variable already
  computed for the thrown error's `code` field, rather than re-parsing the response — no duplicate
  read of the (already-consumed-once, `readErrorEnvelope`-cached-by-await) body.
- **`AccessGate`'s overlay and non-overlay form share one JSX block**, switched only by inline
  `position`/`inset`/`zIndex` values keyed off the `overlay` boolean, rather than two near-duplicate
  form components — the spec's "children stay mounted underneath" requirement is satisfied by the
  same conditional-render logic in both cases (`(state === 'ok' || state === 'unknown' || overlay)
  && children`), so a single component reads more clearly than two.
- **The passphrase-store tests import `ACCESS_STORAGE_KEY` from `@soulbound/shared`** rather than
  hand-writing the literal string the way `saves.test.ts` hand-writes `sbc-save:`/`sbc-save-index`.
  That precedent exists specifically to catch drift against the Claude.ai artifact's saved data,
  which the access gate has no equivalent of — it is a brand-new key with no legacy value to stay
  byte-compatible with, so importing the constant (and thus following it if it's ever renamed
  before ship) is the more useful failure mode here, not a weaker test.

## Issues / carry-forward notes for 05-04 to 05-06
- **For 05-04 (static serving + Dockerfile):** nothing in this plan assumes any particular backend
  serving shape. `checkAccess()`'s `'unknown'` branch already covers "the request never reached a
  real backend" (a 502 from Vite's proxy today; the same code path also covers whatever a
  misconfigured `STATIC_DIR`/SPA-fallback might return in production, since anything that isn't a
  clean 204 or a clean 401-with-code falls into `'unknown'` and fails open in the UI — the backend's
  own gate is what actually enforces access either way).
- **For 05-05/05-06 (smoke script, self-host docs):** the smoke script's `/api/access` checks
  (both the no-header-401 and the with-header-204 cases) exercise the exact same backend contract
  `checkAccess()` depends on; nothing in this plan needs the smoke script to change, but a docs
  writer describing the "ask once, before the title screen" flow can cite this file directly.
- **Standing note on the `'unknown'`-fails-open design:** a deployer whose reverse proxy or CDN
  strips the `Authorization` header before it reaches the backend would see every `checkAccess()`
  call return whatever their proxy answers instead of the backend's own response. If that answer
  happens to be a clean 204 or a JSON 401 with `PASSPHRASE_REQUIRED`, the gate still works; anything
  else reads as `'unknown'` and opens the UI, while the backend (unreached or reached-but-blocked)
  still enforces on every real call. This is the same "fails open in the UI, enforced by the
  backend" property the spec already names for the Vite-dev-with-no-backend case — recording it here
  because it also covers proxy misconfiguration, which is a self-hosting failure mode, not just a
  dev one.

## Auto-remediated
- **Fixed a fixture type error caught by `npm run build`**: `passphrase.test.ts`'s first draft of
  `makeGameState()` gave `race.intrinsic` a single-element array, but the shared `Race` type
  requires exactly `[RaceIntrinsic, RaceIntrinsic]`. `tsc` caught it immediately on the first full
  build; fixed by adding the second element (matching every other fixture in the codebase that
  builds this same shape). Re-ran `npm run build` clean before proceeding.
- **Fixed a jsdom-incompatible file read in `accessGate.test.tsx`**: the first draft of the
  "never touches localStorage/fetch directly" static guard used
  `new URL('../AccessGate.tsx', import.meta.url)` with `readFileSync`, which threw
  `TypeError: The URL must be of scheme file` under this project's Vitest/jsdom config (matching
  `constraints.test.ts`'s own note that `import.meta.url` resolves to a root-relative, not
  file-scheme, URL here). Fixed by switching to `resolve(process.cwd(), 'src/components/...')`,
  the same pattern `constraints.test.ts` already uses for exactly this reason. Re-ran the file's
  suite and confirmed all 11 tests passed before moving on.
- **Fixed my own literal-string false trigger against the plan's verify grep**: `AccessGate.tsx`'s
  original docstring read "...reaches neither `localStorage` nor `fetch` directly..." — the plan's
  verify command is a raw `grep -nE "localStorage|fetch\("` with no comment-stripping (unlike
  `constraints.test.ts`'s scanner), so that prose sentence would have made the plan's own verify
  step fail even though the component's actual code never touches either API. Re-read the verify
  command literally (AI-2) before treating the grep as satisfied, caught the false positive, and
  reworded the sentence to describe the same fact without using either literal word. Confirmed
  `grep -nE "localStorage|fetch\(" frontend/src/components/AccessGate.tsx` now exits 1 (no match).
- **Fixed a test-count mismatch against the plan's own stated e2e outcome**: see "Decisions made"
  above — the first draft's two parametrized e2e tests were replaced with one test before this
  summary was written, once `npm run test:e2e` reported 7 passed against a plan and spec that both
  say 6.
