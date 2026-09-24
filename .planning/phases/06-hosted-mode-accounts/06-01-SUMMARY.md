# 06-01 Summary: Mode config, secret hygiene, error tracker

## Status: Complete

Executed by engineering-senior-developer, with engineering-security-engineer's review points (the
critique block) applied. Every count and result below comes from a command run in this plan.
The file:line citations in the plan were re-checked at `c1b59af`, and all of them still matched
(`config.ts:43`, `:81-85`, `:87-88`, `:104`, `:165`, `:194`, `:239-274`, `:361-377`;
`server.ts:346`, `:361-372`).

## Commits
| Commit | What |
|---|---|
| `61382ec` | Task 1 + task 2 tests: `SOULBOUND_MODE`, hosted secrets, generalised `redact()`, shared constants, `setupFiles` harness, `hostedConfig.test.ts`, `redact.test.ts` |
| `a541df5` | Task 3: `errorTracker.ts`, `server.ts` wiring, `tracker:test`, `@sentry/node` 11.0.0, `errorTracker.test.ts` |
| this commit | this SUMMARY |

## Files touched
| File | Change |
|---|---|
| `shared/src/accessGate.ts` | Appended only: `SoulboundMode`, `SIGN_IN_REQUIRED`, `ORIGIN_REJECTED`, `INVITE_REQUIRED`, `INVITE_INVALID`, `INVITE_REDEEM_PATH`, `ACCOUNT_PATH`, `INVITE_CODE_PATTERN`, `MODE_HEADER`. No existing export changed |
| `backend/src/config.ts` | Takes all 7 secrets (and the non-secret hosted variables) first, then reads `MODE`, then validates per mode. Hosted adds `readHostedConfig()`, `getHostedSecrets()`, `HOSTED_PUBLIC_URL`, `EMAIL_FROM`, `GOOGLE_CLIENT_ID`, `DISCORD_CLIENT_ID`, `SENTRY_DSN`, `USER_RATE_LIMIT_PER_MINUTE`. `checkPassphrase` throws in hosted. `redact()` runs over a longest-first list built once at load |
| `backend/src/errorTracker.ts` | New. `initErrorTracker()` and the allow-list event rebuild |
| `backend/src/scripts/trackerTest.ts` | New. The live canary for 06-07's runbook |
| `backend/src/server.ts` | `HostedDeps` stub (`reportError?`), `AppConfig.hosted?`; the error handler reports with the route template; `main()` inits the tracker; both fatal handlers report, then flush (2 s, with a backstop timer), then exit |
| `backend/package.json`, `package-lock.json` | `@sentry/node` `^11.0.0` (runtime dependency); `tracker:test` script |
| `backend/vitest.config.ts` | `setupFiles: ['./src/__tests__/setup/clearHostedEnv.ts']`, with the reason in a comment |
| `backend/src/__tests__/setup/clearHostedEnv.ts` | New harness file |
| `backend/src/__tests__/{hostedConfig,redact,errorTracker}.test.ts` | New tests |

No file outside `files_modified` was touched.

## Test counts
Baseline, at `c1b59af` before any edit (`npm run build && npm test`):
```
      Tests  187 passed (187)      <- backend
      Tests  190 passed (190)      <- frontend
```
After task 1 (no new tests yet; this is the proof that selfhost is unchanged):
```
      Tests  187 passed (187)
      Tests  190 passed (190)
```
The same run with `SOULBOUND_MODE=hosted` and a `DATABASE_URL` exported (`npm test -w @soulbound/backend`), which is the `setupFiles` proof:
```
      Tests  187 passed (187)
```
After task 2 (`npm test -w @soulbound/backend`): `Tests  243 passed (243)`, so 187 + 56.
Final (`npm run build && npm test`):
```
 Test Files  11 passed (11)
      Tests  248 passed (248)      <- backend: 187 + 48 + 8 + 5
 Test Files  13 passed (13)
      Tests  190 passed (190)      <- frontend, unchanged
```
The final run with `SOULBOUND_MODE=hosted` exported also gives `Tests  248 passed (248)`.

**61 new self-host-runnable tests** (the verbose reporter lists 61 `✓` lines):
- `hostedConfig.test.ts` (48):
  - an invalid mode leaves none of the 7 secrets in the environment;
  - unset defaults to selfhost;
  - selfhost with hosted secrets set still boots and strips them from the environment;
  - 5 missing-variable cases, each naming its variable;
  - `BETTER_AUTH_SECRET` at 31 characters is rejected and at 32 accepted;
  - a short `RESEND_API_KEY` or OAuth secret is rejected;
  - an OAuth ID without its secret is rejected;
  - no OAuth providers at all is valid;
  - a short DB password is rejected, a password-less DB URL is accepted, and a non-postgres URL is rejected;
  - `http://example.com` is rejected; `http://localhost:5173` is accepted in dev and rejected in production; a URL with a path is rejected;
  - hosted with a passphrase is rejected;
  - `FRONTEND_ORIGIN` defaults to the public origin, a trailing slash is accepted, and a mismatch is rejected;
  - `USER_RATE_LIMIT_PER_MINUTE`: default 60, 4 rejections, and undefined in selfhost;
  - the happy path with `getHostedSecrets()`;
  - `getHostedSecrets()` throws in selfhost; `checkPassphrase` throws in hosted;
  - `JSON.stringify(module)` contains no secret;
  - 13 "no thrown message contains a secret" scenarios.
- `redact.test.ts` (8):
  - a fixture guard;
  - 3+ overlapping secrets;
  - the full DB URL, the raw password and the decoded password;
  - unchanged text;
  - empty secrets never match;
  - selfhost ignores hosted secrets.
- `errorTracker.test.ts` (5):
  - (i) no import when off;
  - (ii) the canary;
  - code, route and type mapping;
  - a non-Error becomes a bare `NON_ERROR`;
  - (iii) no breadcrumbs.

**Type-checking test files (critique #4).** `npx tsc --noEmit -p backend/tsconfig.json` passes. That
config excludes `src/__tests__/**`, so the build never type-checks tests; a test-file type error only
surfaces when Vitest runs it, and Vitest strips types without checking them. I ran an ad-hoc check with a
throwaway tsconfig that includes the tests (it was deleted afterwards). It reports **no errors in any
new file**. It does report pre-existing errors in the frozen test files: `anthropic.test.ts` (TS2345
`undefined` → `Headers`, TS7006), `routes.test.ts:1000`, and `server.test.ts:93,121,139`. Those are not
from this plan, and I didn't edit them.

## Mutations (each backed up with `cp`, confirmed changed by sha256, restored with `cp`, and the restore hash-checked)
| # | Mutation | Caught by |
|---|---|---|
| a | `MODE = readMode()` moved above the hosted `takeEnv` calls | `hostedConfig > SOULBOUND_MODE > an invalid mode throws … leaves none of the 7 secrets in process.env` (1 failed / 242) |
| b | `hosted.databaseDecodedPassword` dropped from the redaction list | `redact > … removes the URL-decoded DATABASE_URL password on its own` (1 failed) |
| c | hosted passphrase `throw` removed | `hostedConfig > … refuses to boot when SOULBOUND_PASSPHRASE is set …` and `… no thrown message contains a secret > passphrase set` (2 failed) |
| d | `beforeSend` returns the incoming event (the plan's tracker mutation) | canary (ii): `envelope leaked sk_ant_fake_canary_key_…`, plus the mapping, non-Error and breadcrumb cases (4 failed / 244) |
| e (added) | `report()` passes the original error, with no message cut | canary (ii): `envelope leaked FakeCanaryInviteCode01` (a frame forged in the message), plus the non-Error case (2 failed) |
| f (added) | SDK loaded before the mode/DSN check | (i) `… without ever importing the SDK` (1 failed) |
| g (added) | frame filename allow-list bypassed | canary (ii): `not to contain 'outsideTheApp'` (1 failed) |
| h (added, harness) | `setupFiles` line removed, run with `SOULBOUND_MODE=hosted` | `Tests  72 failed | 121 passed (193)`: the harness is load-bearing |

After every restore, the full gate was re-run: 248 + 190 green.

## Sentry option names (Open Question 7), verified in the installed `@sentry/node` 11.0.0 / `@sentry/core` 11.0.0
Paths are under `node_modules/@sentry/`.
| Option / API | Exists? | Where |
|---|---|---|
| `defaultIntegrations?: false \| Integration[]` | yes | `core/build/types/types/options.d.ts:592`; honoured at `node/build/esm/sdk/index.js:95` and `:145` |
| `integrations?` | yes | `core/build/types/types/options.d.ts:598` |
| `beforeSend?(event: ErrorEvent, hint)` | yes, error events only | `options.d.ts:524`; applied in `core/build/esm/client.js:738-751`; the returned event goes straight to `sendEvent` (`client.js:342`) |
| `beforeBreadcrumb?` | yes | `options.d.ts:570`; applied in `core/build/esm/breadcrumbs.js:12-18` |
| `transport?` | yes | `options.d.ts:604`; defaults to `makeNodeTransport` at `node/build/esm/sdk/index.js:133` |
| `sendDefaultPii` | **no**: absent from all v11 types | `grep -rn sendDefaultPii core/build/types` returns nothing |
| `dataCollection?: DataCollection` | **yes**, and every field defaults to *collect* | `options.d.ts:346`; fields at `core/build/types/types/datacollection.d.ts:27-114` |
| `enableRuntimeChannelInjection?` (default **true**: registers module-transform hooks) | yes, set `false` | `node/build/types/types.d.ts:34`; used at `node/build/esm/sdk/client.js:39` |
| `includeServerName?` (hostname otherwise sent) | yes, set `false` | `options.d.ts:62`; `node/build/esm/sdk/client.js:14` |
| `sendClientReports?` (default true) | yes, set `false` | `options.d.ts:169`; default at `node/build/esm/sdk/index.js:132` |
| `debug?` (else `SENTRY_DEBUG`), `spotlight?` (else `SENTRY_SPOTLIGHT`) | yes, both pinned `false` | `options.d.ts:143`, `:53`; env fallbacks at `sdk/index.js:82` and `node/build/esm/utils/spotlight.js` |
| `dsn` falls back to `process.env.SENTRY_DSN` when omitted | note | `sdk/index.js:130`. config.ts deletes it, and the tracker always passes `dsn` explicitly |
| Test transport | `createTransport(options, makeRequest)` from `@sentry/core`, re-exported by `@sentry/node` | `core/build/esm/transports/base.js:8`; export list `node/build/types/index.d.ts:15`. `makeRequest` receives `{ body: serializeEnvelope(...) }` |
| Envelope `trace` header | built only from `event.sdkProcessingMetadata.dynamicSamplingContext` | `core/build/esm/utils/envelope.js:137-147`. The rebuilt event has no `sdkProcessingMetadata`, so no `trace` block (asserted). A probe with a pass-through `beforeSend` showed a `trace` block **is** sent otherwise |
| `Scope.clear()` | **no** in v11 | the tests reset only the fields they set |

**Minimum error-capture integrations: none.** Manual `captureException` gets its frames from the
client's own `eventFromException` → `stackParser` (`core/build/esm/server-runtime-client.js:32-35`), not
from an integration. `integrations: []` is passed explicitly. The SDK's global handlers
(`onUncaughtException` and the like) are deliberately **not** installed: `server.ts`'s own fatal
handlers report and then exit.

## Decisions and deviations
1. **`initErrorTracker` takes an optional `redact`.** The spec's signature is `{dsn, mode, transport?}`,
   and the critique requires `redact()` over frame names and filenames. The tracker can't import
   config (the `tracker:test` script must run without app secrets), so `main()` passes
   `config.redact`. The addition is additive.
2. **`report()` rebuilds the error before the SDK sees it** (not in the plan; stricter). V8's stack
   starts with `name: message`, so a multi-line message can forge `at …` frames that land inside
   `dist/` and pass the filename allow-list. That's how a per-request value could reach a kept
   function name. `report()` cuts the exact `name: message` header off the stack. If the stack doesn't
   start with it, **no** frames are kept (fail closed). The SDK therefore never sees the message,
   the `cause` or the properties. Mutation (e) pins this.
3. **Function pattern `^[\w$.<>]{1,100}$`** (from the critique) turns Express frames such as
   `Layer.handle [as handle_request]` into `?`. That was observed in a probe, and it's accepted as
   fail-closed.
4. **`KNOWN_CODES`** is the shared constants, plus the 5 anthropic.ts codes (with a compile-time
   exhaustiveness guard against `WorldVoiceErrorCode`), plus server.ts's own fixed codes
   (`INVALID_REQUEST`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `INTERNAL_ERROR`, `ERROR`,
   `NON_ERROR`). The server codes go slightly beyond the critique's list; they are fixed strings the
   error handler itself emits.
5. **Every error that reaches the error handler is reported** (not only 5xx), because the plan says
   the handler "calls it, when present". Whether to filter out 4xx noise is left for 06-07 to decide
   once the live error rate is known.
6. **The tracker is enabled only for `mode === 'hosted'` with a DSN.** config.ts also exports
   `SENTRY_DSN` as `undefined` in selfhost, so there are two independent gates.
7. **Hosted config extras beyond the task text** (these add validation only; no new behaviour):
   - OAuth ID and secret must be set together;
   - `BETTER_AUTH_URL` must be a bare origin (no credentials, path, query or fragment);
   - `EMAIL_FROM` must contain `@` and no CR/LF (header injection);
   - a DATABASE_URL must be `postgres:`/`postgresql:`, with valid percent-encoding;
   - no error ever echoes the DATABASE_URL.
8. **Non-secret hosted variables** (`BETTER_AUTH_URL`, `EMAIL_FROM`, the OAuth client IDs,
   `SENTRY_DSN`) are also read with `takeEnv`, so Better Auth can't pick them up from the environment
   (R24a). `SOULBOUND_MODE` itself is read, not deleted.
9. **Selfhost** takes the hosted secrets and ignores them, with no throw (comment in config.ts). Its
   `redact()` list is exactly the Phase 5 pair; ties keep the key first, as before.
10. **`tracker:test` wording.** `Sentry.flush()` resolved `true` when the fake DSN's host was
    unresolvable. It means "queue drained", not "delivered", so the script says delivery is confirmed
    only on the dashboard.

End-to-end boot check (built server, fake values, `env -i`):
- hosted with no `DATABASE_URL` → `Missing required environment variable: DATABASE_URL …`, `exit=1`;
- `SOULBOUND_MODE=hostd` → `Invalid SOULBOUND_MODE: "hostd". … 'selfhost' … 'hosted'`, `exit=1`.

## Gate
1. `npm run build && npm test` → 187 + 190 still pass, and the 61 new tests are listed above. ✔
2. (DB gate starts with 06-02.)
3. `git diff 7856b7d -- frontend/src/App.tsx` → 0 lines. ✔
4. `git diff --stat 7c737a6 -- '*.test.ts' '*.test.tsx'` lists only the three new files
   (`errorTracker`, `hostedConfig`, `redact`). ✔
5. No Dockerfile change. `package.json` changed, but smoke-image is a gate only from 06-02. Not run here.

`grep -n "@sentry/node" backend/src/*.ts` finds one line, the dynamic loader at `errorTracker.ts:48`.
The built `dist/` likewise has only `dist/errorTracker.js:37 const loadSentry = () => import('@sentry/node')`.

## Left for later plans
- **06-02:** add `@sentry/node` to `selfhostNoPg.test.ts`'s `vi.doMock` list, as the CONTEXT guard
  table says. (errorTracker.test.ts (i) already proves the tracker never imports it when off.)
- **06-04:** widen `HostedDeps` (`server.ts`) into the full hosted branch. Until then, a hosted
  `main()` builds the **selfhost** pipeline, and `checkPassphrase` throws on it, so every gated `/api`
  request fails closed with 500. Don't deploy hosted before 06-04.
- **06-04:** use `USER_RATE_LIMIT_PER_MINUTE` (exported; `undefined` in selfhost) and `HOSTED_PUBLIC_URL`.
- **06-07:** runbook step for `npm run tracker:test -w @soulbound/backend` after build (it needs
  `dist/`). Decide on 4xx reporting (decision 5). Record the processor retention.
