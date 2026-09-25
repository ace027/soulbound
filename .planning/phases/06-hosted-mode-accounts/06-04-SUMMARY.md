# 06-04 Summary: Hosted gate, buildApp hosted branch, pinned middleware order

## Status: Complete with Warnings

Executed by engineering-senior-developer, with engineering-security-engineer's review points (the
critique block) applied. Every count below comes from a runner line quoted next to it. The anchors
in the plan (`server.ts:51`, `:197`, `:209`...) had moved after 06-01's tracker wiring. Re-checked at
`12a19e1`: `HostedDeps` `:56`, `buildApp` `:210`, trust proxy `:224`, Host allow-list `:231`, CORS
`:241`, health `:255`, limiter `:262`, gate `:263`, `express.json` `:274`, `/api/access` `:279`,
`main()` `:405`. The order is the same as the plan says.

**Warnings:**
1. **The #3295 premise is stale.** With `better-call` 1.4.0, `express.json` above the auth mount **no
   longer hangs**. `adapters/node/request.mjs:108-113` re-serialises an already-parsed `req.body`.
   Mutation (a) therefore first **survived**. What still differs is **who answers a malformed or
   oversized auth body**:
   - Better Auth: 400 `{"message":"Invalid JSON in request body","code":"BAD_REQUEST"}`;
   - the app's body parser: 400 `INVALID_REQUEST`, and 413 at 100 KB.

   This is probed and recorded below. A test now pins it, and (a) is caught. The spec's "it hangs
   otherwise" wording, and the 2 s timeout as the catching mechanism, should be corrected in the
   06-07 design-log entry. The timeout stays as a backstop.
2. **New finding (concern, not fixed; outside scope): `/api/auth/*` has no body-size limit.** In
   the probe at HEAD, Better Auth accepted a 150 035-byte body to `sign-in/magic-link` (200). The
   per-IP limiter bounds the request rate, not the size of each request. Suggested follow-up: a raw
   byte cap mounted before step 10, e.g. reject `Content-Length > 16 KB` and cap chunked streams.
   It must not parse the body.
3. **Rolling sessions (for 06-06):** the session gate calls `auth.api.getSession` server-side, so
   Better Auth's `updateAge` refresh extends the DB row, **but** any refreshed `Set-Cookie` is
   dropped. The browser cookie's `Max-Age` is only renewed when the client calls
   `/api/auth/get-session` itself (see "For 06-06").

## Commits
| Commit | What |
|---|---|
| `feffecd` | `hostedGate.ts`, the `server.ts` hosted branch + `buildHostedDeps` + hosted `main()`, `accessGate.ts` `keyFor`, all new tests, `helpers/hostedApp.ts`, `scripts/mutate-order.sh` |
| `29e6aed` | Test fix after mutation (a) survived: a malformed auth body must reach Better Auth unparsed |
| `4cee6b3` | CI fix: the `main()` boot test uses its own role (CI's 8-character DB password is correctly refused by hosted config) |
| this commit | this SUMMARY |

## Files touched (all in `files_modified`)
| File | Change |
|---|---|
| `backend/src/hostedGate.ts` | New. `frameHeaders`, `modeHeader`, `exactWebhookPath`, `originCheck`, `sessionGate`, `userLimiter`, `ipv6Slash64`, `ipKey`, `BILLING_WEBHOOK_PATH`, and the `GetSession` / `FromNodeHeaders` / `SessionUser` types. Imports no hosted package; `pg` appears only via `import type { Queryable }` |
| `backend/src/server.ts` | `HostedDeps` widened. `buildApp` gets its hosted branch; `buildHostedDeps()` and `HostedBootOptions` are exported; hosted `main()` wiring; SIGTERM → `server.close` → `pool.end` |
| `backend/src/accessGate.ts` | `createRateLimiter` gains an optional `keyFor(req, res)`. When it is absent, the key is exactly `req.ip ?? 'unknown'`, as before |
| `backend/src/__tests__/hosted/hostedOrder.test.ts` | New, 65 hosted tests |
| `backend/src/__tests__/helpers/hostedApp.ts` | New: the `startHostedApp()` helper |
| `backend/src/__tests__/ipv6.test.ts` | New, 10 self-host tests |
| `backend/src/__tests__/selfhostHeaders.test.ts` | New, 5 self-host tests |
| `backend/src/__tests__/selfhostNoPg.test.ts` | +1 test (sanctioned: new this phase). `HOSTED_MODULES` unchanged: `server.ts` dynamically imports `better-auth/node`, which was already listed, and the scan test passes |
| `scripts/mutate-order.sh` | New |

No other file was touched. The `package.json`, the Dockerfile and `selfhostNoPg.test.ts`'s mock list
are unchanged.

## Decisions
- **Access header choice: a hosted-wide middleware on `/api/access`, mounted at step 3** (right
  after `frameHeaders`, ahead of every limiter and gate):
  `app.use(ACCESS_CHECK_PATH, modeHeader())`. So the 204, the 401 `SIGN_IN_REQUIRED` **and** a 429
  on `/api/access` all carry `Soulbound-Mode: hosted` (the 429 case is tested). The session gate
  itself knows nothing about paths.
- **`HostedDeps` carries `getSession` and `fromNodeHeaders`, not `auth`** (critique 5). `getSession`
  is a narrow adapter over `hostedAuth.auth.api.getSession`, built in `buildHostedDeps`. The session
  gate calls it with `{ headers: fromNodeHeaders(req.headers), query: { disableCookieCache: true } }`.
  The option name was checked in the installed source at `better-auth/dist/api/routes/session.mjs:48`.
- **`redeemInvite` in `HostedDeps` is pre-bound**: `(code) => redeemInvite(pool, code, { key })`.
  The key is derived once at boot, so `server.ts` never imports `invites.ts` statically.
- **Redeem order: the limiter runs before its 1 KB `express.json`.** The plan listed json first. The
  limiter goes first so a throttled request's body is never read, the same rule as self-host's
  limiter-before-json. The tested behaviour is identical: 413, then 429 on the 6th.
- **The webhook slot:** `app.post(BILLING_WEBHOOK_PATH, exactWebhookPath(), express.raw(...), 404)`.
  `exactWebhookPath` calls `next('route')` unless the method is POST and `req.originalUrl` (query
  stripped) is exactly `/api/billing/webhook`. That check runs **before** `express.raw`, so a
  non-exact path never has its body read. The slot answers `404 NOT_FOUND`.
- **The Origin check** is `app.use('/api', originCheck(publicOrigin))`. It compares `Origin` byte for
  byte against `publicOrigin` and also rejects `Sec-Fetch-Site: cross-site` when the Origin
  matches. `X-HTTP-Method-Override` is not honoured.
- **`DELETE /api/account` is mounted only when `requestAccountDeletion` is supplied.** It sits after
  `/api/access` and is tested with a spy (see "For 06-05"). `main()` doesn't supply it yet, so in
  hosted mode the route 404s behind the gate (tested).
- **`buildHostedDeps` has a `schema` test seam.** It validates the name against `^[a-z_][a-z0-9_]*$`
  (tested) and threads it into the pool's `search_path` and `assertNoPendingMigrations`.
  Production never sets it, so both default to `public`.
- **SIGTERM (hosted only):** `server.close`, then `pool.end`, then exit 0, with a 10 s backstop.
  Measured in the image: `stop took 121 ms, exit code 0`.
- **`frameHeaders` also sets `Referrer-Policy: no-referrer`** (critique 4). Its absence in self-host
  is tested too.

## `git diff -w 12a19e1 -- backend/src/server.ts`
Totals: 269 lines added, **5 removed**. All 5 removed lines are **06-01 hosted-stub lines**, not
Phase 5 self-host lines:
```diff
- * Hosted-mode dependencies. A stub for now: 06-01 adds only the error
- * tracker's hook, and 06-04 widens this into the full hosted branch
- * (`auth`, `pool`, ...). Absent in self-host, where nothing below changes.
-    reporter === undefined
-      : { ...config, hosted: { reportError: (err, context) => void reporter.report(err, context) } },
```
- The first three are the stub's doc comment, replaced by the widened interface's comment.
- The last two had to change, and the compiler forced it: the stub `{ reportError }` no longer
  satisfies the widened `HostedDeps` (TS2345). The call is now
  `buildApp(hostedDeps === undefined ? config : { ...config, hosted: hostedDeps })`. In self-host,
  `hostedDeps` and `reporter` are both always undefined, so the argument is `config`, as before.

The self-host gate lines appear as **unchanged context**, now inside `else`:
```diff
+  } else {
     app.use('/api', createRateLimiter({ perMinute: RATE_LIMIT_PER_MINUTE, now }));
     app.use('/api', createAccessGate(checkPassphrase));
+  }
```
The final `return app.listen(PORT, …)` is also unchanged. Hosted returns early from its own
`if (hostedDeps !== undefined)` block, and that block registers SIGTERM. The original
`import type { Server } from 'node:http';` line is kept, and a second type-only import was added.

## The mounted order (`buildApp`, hosted)
| # | Step | Mount |
|---|---|---|
| 1 | trust proxy | `app.set('trust proxy', TRUST_PROXY)` (shared) |
| 2 | Host allow-list | shared |
| 3 | anti-framing + mode header | `app.use(frameHeaders())`; `app.use(ACCESS_CHECK_PATH, modeHeader())` |
| 4 | CORS | shared |
| 5 | health | shared |
| 6 | per-IP limiter | `createRateLimiter({ …, keyFor: ipKey })` |
| 7 | reserved webhook | `app.post('/api/billing/webhook', exactWebhookPath(), express.raw({type:'application/json',limit:'64kb'}), 404)` |
| 8 | Origin check | `app.use('/api', originCheck(publicOrigin))` |
| 9 | redeem | `app.post(INVITE_REDEEM_PATH, limiter 5/min keyFor ipKey, express.json({limit:'1kb'}), handler)` |
| 10 | Better Auth | `app.all('/api/auth/*splat', withInviteContext, handler)` |
| 11 | session gate | `app.use('/api', sessionGate(hosted))` |
| 12 | per-user limiter | `app.use('/api', userLimiter(userRateLimitPerMinute, now))` |
| 13 | `express.json` | shared, unchanged |
| 14 | `/api/access` 204; `DELETE /api/account` | shared line; account route only when supplied |
| 15 | routers, `/api` 404, static, global 404, error handler | shared, unchanged |

## Test counts
Gate, `npm run build && npm test` (final run, after `4cee6b3`):
```
 Test Files  16 passed (16)
      Tests  284 passed (284)      <- backend: 268 + 16 new
 Test Files  13 passed (13)
      Tests  190 passed (190)      <- frontend, unchanged
```
Hosted, `URL=$(scripts/test-db.sh) && TEST_DATABASE_URL=$URL npm run test:hosted -w @soulbound/backend`:
```
 ✓ src/__tests__/hosted/hostedOrder.test.ts (65 tests) 1402ms
 ✓ src/__tests__/hosted/auth.test.ts (29 tests) 2427ms
 ✓ src/__tests__/hosted/db.test.ts (11 tests) 456ms
 ✓ src/__tests__/hosted/invites.test.ts (20 tests) 326ms
 ✓ src/__tests__/hosted/alsPropagation.test.ts (1 test) 309ms
      Tests  126 passed (126)
[assert-no-skips] OK: 126 tests, 0 skipped, 0 todo
```
Baseline before any edit: `Tests  268 passed (268)` + `Tests  190 passed (190)`; hosted `Tests  61 passed (61)`.

**16 new self-host tests:**
- `ipv6.test.ts` (10):
  - every spelling of one /64 is one key;
  - a different /64 gets a different key;
  - the zone is dropped;
  - IPv4-mapped addresses, in dotted and hex form;
  - IPv4 is unchanged;
  - loopback and unspecified addresses;
  - non-IP input is returned unchanged;
  - `ipKey`'s `unknown` bucket;
  - the limiter with `keyFor` shares a bucket;
  - the limiter without `keyFor` keeps a per-address key.
- `selfhostHeaders.test.ts` (5): `/api/health`, `/api/access` 401, `/api/access` 204, a static file,
  and a static 404. None carries `X-Frame-Options`, `frame-ancestors`, `Referrer-Policy` or
  `Soulbound-Mode`.
- `selfhostNoPg.test.ts` (+1), with every hosted package mocked to throw:
  - `/api/access` gives 401 `PASSPHRASE_REQUIRED`, and 204 with the passphrase;
  - POST to the webhook, redeem and auth paths without the passphrase gives 401 `PASSPHRASE_REQUIRED`
    (no Origin check in self-host), and 404 with it;
  - `DELETE /api/account` gives 404.

**65 new hosted tests** (`hostedOrder.test.ts`):
- **step 3:** frame headers plus `Referrer-Policy` on health, a static file, a static 404,
  `/api/access`, `GET /api/auth/get-session`, and a 403 (6 tests).
- **step 8, 4 routes × (4 bad origins + 1 pass):** `POST /api/auth/sign-in/magic-link`,
  `POST /api/invites/redeem`, `DELETE /api/account`, `POST /api/world-engine`. The bad origins are no
  Origin, `null`, a foreign origin, and `Sec-Fetch-Site: cross-site`. The public origin passes to the
  next layer: 200, 400 `INVITE_INVALID`, 401 and 401 respectively (20 tests).
- **critique 2 variants, each giving 403 (6 tests):** `/API/auth/...`, `/api//auth/...`,
  `/api/auth/../invites/redeem`, `X-HTTP-Method-Override: GET`, `PUT /api/access` and `PATCH`.
- **step 8, 2 more:** `same-origin` passes, and 4 look-alike origins are foreign.
- **step 7:**
  - the exact slot with no Origin gives 404;
  - a query string doesn't change that;
  - `webhookx`, `webhook/`, `/API/Billing/Webhook` and `/api/billing/Webhook` each give 403;
  - `PUT` gives 403;
  - `GET` gives 401 `SIGN_IN_REQUIRED`.
- **step 10:**
  - a JSON body answers within 2 s;
  - a malformed body gets Better Auth's own 400;
  - an unknown auth path gets the JSON 404.
- **step 11:**
  - no cookie gives 401 with `Soulbound-Mode: hosted`;
  - a forged cookie gives 401;
  - a session gives 204 with the header;
  - a signed-in POST reaches route validation (400);
  - an `account_deletions` row gives 401;
  - a revoked session gives 401 at once;
  - `DELETE /api/account` without `requestAccountDeletion` gives 404.
- **step 9:**
  - 4 malformed bodies each give 400;
  - a 2 KB body gives 413;
  - requests 1-5 give 400 and the 6th gives 429;
  - a valid code gives 204 with `__Host-sb_invite` (exact attributes, no code in it).
- **step 12:**
  - user A gets 204 ×3, then 429, while user B still gets 204;
  - the 429 is `TOO_MANY_REQUESTS`.
- **step 6:**
  - `2001:db8::1`, `2001:db8:0:0::2` and a full-form address in the same /64 share a bucket (the 3rd
    request gets 429, still with the mode header), while another /64 isn't limited;
  - health is never limited.
- **step 14 with a spy:** 204, the cleared session cookie, and the user id passed; without a
  session, 401 and nothing is requested.
- **boot:**
  - `buildHostedDeps` on an unmigrated schema rejects with `PENDING_MIGRATIONS_MESSAGE`;
  - an unsafe schema name is rejected;
  - **`main()`** on a fresh database (its own role and a 48-character password) gets
    `process.exit(1)`, prints the message, and prints neither the URL nor the password;
    `DATABASE_URL` is deleted from the environment.

Ad-hoc type check of `src/**`, tests included (throwaway tsconfig, deleted afterwards): **no errors
in any new file**. The only errors are the pre-existing frozen-file ones: `anthropic.test.ts` 11,
`routes.test.ts` 1, `server.test.ts` 3. These are the same counts 06-01 to 06-03 recorded.

## Mutations
Every mutation ran after committing, with a `cp` backup, the sha256 confirmed changed, a `cp`
restore, and the restore confirmed by hash. `git status` was clean after each.

**`scripts/mutate-order.sh`, first run (on `feffecd`):**
```
FAIL  (a) express.json above the Better Auth mount: the suite PASSED with the mutation in place (Tests  125 passed (125))
PASS  (b) Origin check moved below the Better Auth mount: suite failed as required (rc=1, 8s; Tests  11 failed | 114 passed (125); 2 s timeouts: 0)
PASS  (c) session gate deleted: suite failed as required (rc=1, 8s; Tests  13 failed | 112 passed (125); 2 s timeouts: 0)
mutate-order: 1 mutation(s) survived
```
**Probe for the root cause** (`POST /api/auth/sign-in/magic-link`, same bodies, before and after mutation a):
```
HEAD:        9 bytes '{"email":'  -> 400 {"message":"Invalid JSON in request body","code":"BAD_REQUEST"}
             150035 bytes           -> 200 {"status":true}
mutation a:  9 bytes '{"email":'  -> 400 {"error":{"message":"Unexpected end of JSON input","code":"INVALID_REQUEST"}}
             150035 bytes           -> 413 {"error":{"message":"request entity too large","code":"PAYLOAD_TOO_LARGE"}}
```
**Final run (after the fix, `4cee6b3`):**
```
PASS  (a) express.json above the Better Auth mount: suite failed as required (rc=1, 8s; Tests  1 failed | 125 passed (126); 2 s timeouts: 0)
PASS  (b) Origin check moved below the Better Auth mount: suite failed as required (rc=1, 9s; Tests  11 failed | 115 passed (126); 2 s timeouts: 0)
PASS  (c) session gate deleted: suite failed as required (rc=1, 8s; Tests  13 failed | 113 passed (126); 2 s timeouts: 0)
mutate-order: all 3 mutations caught; backend/src/server.ts restored (sha256 1c667485cfd1d5177da99c55239b2a537890fea03ddd8a4129f08ebd47aeb70b)
```
The script refuses a dirty `server.ts` (`rc=2`, checked) and a missing `TEST_DATABASE_URL`
(`rc=2`). It exits non-zero if an edit doesn't apply (anchors must match exactly once) or the hash
doesn't change.

**Added mutations (hosted suite unless noted):**
| # | Mutation | Result |
|---|---|---|
| d | `exactWebhookPath` always passes | `Tests  3 failed \| 123 passed (126)`, first `× POST /api/billing/webhook/ → 403 ORIGIN_REJECTED` |
| e | `frameHeaders` unmounted | `6 failed`, first `× GET /api/health` |
| f | `modeHeader` unmounted | `3 failed`, first `× /api/access with no cookie → 401 SIGN_IN_REQUIRED, with Soulbound-Mode: hosted` |
| g | `userLimiter` line deleted | `2 failed`, first `× N+1 requests with one session → 429; …` |
| h | per-IP `keyFor: ipKey` dropped | `1 failed`, `× addresses in one /64 share a bucket; …` |
| i | `Sec-Fetch-Site` check dropped | `4 failed`, first `× POST /api/auth/sign-in/magic-link with Sec-Fetch-Site: cross-site → 403 …` |
| j | `account_deletions` check disabled | `1 failed`, `× a user with an account_deletions row → 401, …` |
| k | `frameHeaders` mounted in self-host too (`npm test`) | `Tests  5 failed \| 279 passed (284)`, first `× /api/health` |
| l | redeem limiter removed | `1 failed`, `× the 6th request in a minute → 429` |
| m | Origin compared with `startsWith` | `1 failed`, `× an Origin that only starts with the public origin is foreign` |
| n | IPv4-mapped handling disabled | hosted suite green (as expected: it's unit-tested in self-host). `npm test`: `1 failed \| 283 passed (284)`, `× IPv4-mapped IPv6 becomes the IPv4 address, in either notation` |

## Image
- The Docker daemon was started for this plan and stopped afterwards, killed by PID.
- The image was built with `--secret id=npm_ca,src=/root/.ccr/ca-bundle.crt`.
- `scripts/smoke-image.sh soulbound:smoke-0604` → **`7/7 passed`**.
- **Hosted boot in the image** (fake secrets, local PG, `--network host`):
  - on an unmigrated database: `Pending database migrations: run \`npm run migrate\``, `exit=1`;
  - after `node backend/dist/migrate.js` (`done: 2 migration(s) applied`):
    - `health 200`;
    - `/api/access` → `401` `SIGN_IN_REQUIRED`, with `X-Frame-Options: DENY`,
      `Content-Security-Policy: frame-ancestors 'none'`, `Referrer-Policy: no-referrer` and
      `Soulbound-Mode: hosted`;
    - redeem with no Origin → `403 ORIGIN_REJECTED`;
    - redeem with the Origin and a bad code → `400 INVITE_INVALID`;
  - `docker stop` → `exit code 0` in 121 ms.
  - Both throwaway databases were dropped.

## Gate
1. `npm run build && npm test` → 284 + 190: the 268 before this plan (the 187 pre-phase tests
   included), unedited, plus the 16 new self-host tests listed above. ✔
2. `test:hosted` → 126 passed, 0 skipped. ✔
3. `git diff 7856b7d -- frontend/src/App.tsx` → 0 lines. ✔
4. `git diff --stat --diff-filter=M 7c737a6 -- '*.test.ts' '*.test.tsx'` → empty. The only file
   modified since 7c737a6 is `selfhostNoPg.test.ts`, which is new this phase and sanctioned
   (`git cat-file -e 7c737a6:…` fails for every changed test file). ✔
5. smoke-image 7/7 locally. ✔

## For 06-05
- **`DELETE /api/account` mounts itself** when `HostedDeps.requestAccountDeletion` is set
  (`server.ts`, step 14, right after `GET /api/access`):
  ```ts
  app.delete(ACCOUNT_PATH, async (_req, res) => {
    const user = res.locals.user as SessionUser;          // set by sessionGate
    await requestAccountDeletion(user.id);
    res.setHeader('Set-Cookie', '__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax');
    res.sendStatus(204);
  });
  ```
  It is already behind the Origin check, the session gate and the per-user limiter. A rejection
  goes to the central error handler (500). The route clears the cookie, so the contract for
  `requestAccountDeletion(userId): Promise<void>` is: insert `account_deletions` **and** revoke every
  session (`hostedAuth.revokeUserSessions(userId)`).
- **Where to plug it in:** `buildHostedDeps()` in `server.ts`. Build it there from `pool` and
  `hostedAuth` and add it to the returned object. Also pass `onSessionCreated` to `createAuth`
  there, which cancels a pending deletion. That's the only place `createAuth` is called in production.
- **The session gate already refuses** a user with an `account_deletions` row: 401 `SIGN_IN_REQUIRED`
  (tested).
- **The purge's `setInterval`** belongs in `main()`'s hosted block. It needs `hostedDeps.pool`, and
  should be cleared in `closePoolOnSigterm` before `pool.end()`.
- **Test helper:** `backend/src/__tests__/helpers/hostedApp.ts`.
  - `startHostedApp(db, { requestAccountDeletion, userRatePerMinute, ratePerMinute, trustProxy, staticDir, now })`
    runs the production `buildHostedDeps` + `buildApp` on the `withTestDb()` schema.
  - It returns `{ port, deps, sent, request, signIn, close }`.
  - `signIn(email?)` creates the user if needed, runs the real magic-link send and verify, and
    returns `{ cookie, userId, email }`. `cookie` is the `Cookie` header value.
  - `request({ method, path, headers, json | raw })` has a 2 s timeout and returns
    `{ status, headers, body, json }`.
  - Also exported: `PUBLIC_URL`, `SESSION_COOKIE`, `setCookies`, `uniqueEmail`.
  - To test with the real deletion function, pass `requestAccountDeletion` through the helper, or
    extend `buildHostedDeps` and let the helper pick it up.

## For 06-06
Exact response shapes and headers (hosted):
| Request | Response |
|---|---|
| any hosted response after the Host check | `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `Referrer-Policy: no-referrer` |
| `GET /api/access`, signed in | `204`, no body, `Soulbound-Mode: hosted` |
| `GET /api/access`, no or invalid session, or deletion pending | `401 {"error":{"message":"Sign in required","code":"SIGN_IN_REQUIRED"}}`, `Soulbound-Mode: hosted` |
| `GET /api/access`, rate-limited | `429 {"error":{"message":"Too many requests — try again shortly","code":"TOO_MANY_REQUESTS"}}`, `Retry-After`, `Soulbound-Mode: hosted` |
| any non-GET/HEAD/OPTIONS `/api/*` without `Origin: <BETTER_AUTH_URL>`, or with `Sec-Fetch-Site: cross-site` | `403 {"error":{"message":"Request rejected: it did not come from this site","code":"ORIGIN_REJECTED"}}` |
| `POST /api/invites/redeem {"code":"<22 chars>"}` (valid) | `204`, `Set-Cookie: __Host-sb_invite=…; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=900` |
| `POST /api/invites/redeem`, any bad, unknown, used or expired code | `400 {"error":{"message":"This invite code is not valid","code":"INVITE_INVALID"}}` |
| `POST /api/invites/redeem`, body > 1 KB | `413 {"error":{"message":"…","code":"PAYLOAD_TOO_LARGE"}}` |
| `POST /api/invites/redeem`, 6th request per minute per IP (/64) | `429 TOO_MANY_REQUESTS` |
| `/api/auth/*` | Better Auth's own shapes (e.g. `{"message","code"}`, not our envelope); error redirects as in 06-03 "For 06-06" |
| `DELETE /api/account` (after 06-05) | `204` plus the session-cookie clear; `401 SIGN_IN_REQUIRED` without a session |
| self-host | never sends `Soulbound-Mode`, the frame headers or `Referrer-Policy` |

The browser `fetch` from the same origin sends `Origin` on POST/DELETE automatically, so no header
code is needed. **Rolling sessions:** our gate does not forward Better Auth's refreshed session
cookie. Calling `authClient.getSession()` (`GET /api/auth/get-session`) on app load renews it once
a day (`updateAge`). That route is a GET, so the Origin check doesn't apply.

## For 06-07
- Design-log entry:
  - the #3295 hang no longer reproduces on better-call 1.4.0 (the evidence above);
  - step 10 is now pinned by "who answers a malformed auth body";
  - record the access-header choice.
- Follow-up concern: there is no body cap on `/api/auth/*` (Warning 2).
- `ALLOWED_HOSTS` and `TRUST_PROXY` for Render as the spec says. The IPv6 /64 keying depends on
  `req.ip` being the real client, i.e. on the trust-proxy hop count.

## CI
- Run 123 on `29e6aed`: https://github.com/DeanItServices/soulbound/actions/runs/36056547083 →
  **failure**.
  - `Test (hosted, real Postgres)`: `Tests  1 failed | 125 passed (126)`.
  - The `main()` boot test got
    `Invalid DATABASE_URL password: 8 character(s) long … Hosted secrets must be at least 16 characters`,
    because it reused CI's 8-character test-DB password.
  - Fixed in `4cee6b3` (a dedicated role with a 48-character password).
- Run 124 on `4cee6b3` (the last code commit): https://github.com/DeanItServices/soulbound/actions/runs/36056811612
  → **success**.
  - `build-and-test`: every step succeeded, including `Test` and `Test (hosted, real Postgres)`.
  - `smoke-image`: `Build image` and `Smoke test image` both succeeded.
  - The job-log tail retrieved holds only the Postgres service log, so the CI test count is not
    quoted here. The step conclusions are.
- This SUMMARY commit's own CI run was not re-checked; it changes only this markdown file.
