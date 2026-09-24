# 06-03 Summary: Better Auth instance, invites, abuse controls

## Status: Complete

Executed by engineering-backend-architect, with engineering-security-engineer's review points (the
critique block) applied. Every count below comes from a runner line quoted next to it. The installed
library is `better-auth` **1.7.6**, with `@better-auth/core` 1.7.6 and `better-call` 1.4.0. The
anchors the plan cites (`routes.test.ts:18-28`, `:82-89`; `accessGate.ts:103-163`) were re-checked,
and all still match.

**ALS verdict: PROPAGATES.** No fallback was needed.

## Commits
| Commit | What |
|---|---|
| `8ee0b4b` | `auth.ts`, `invites.ts`, `scripts/createInvite.ts`, the `invite:create` script, and all four new test files |
| `235eb11` | Test hardening, found while preparing mutation (c): the hosted redeem test decodes the cookie payload and pins its keys |
| this commit | this SUMMARY |

## Files touched
| File | Change |
|---|---|
| `backend/src/auth.ts` | New. `createAuth(deps)` returns `{ auth, handler, withInviteContext, inviteContext, revokeUserSessions, __sendLimiterSizes }`. Also exports `createResendSender`, `allowedAuthPaths`, `DISABLED_PATHS`, the message and limit constants, and `HostedAuth` |
| `backend/src/invites.ts` | New. Codes, hashing, `createInvite`, `redeemInvite` (returns the Set-Cookie), the cookie helpers, `inviteUsable`, `reserveInvite`, `consumeInvite`, `reconcileInvites` |
| `backend/src/scripts/createInvite.ts` | New. `invite:create` CLI (`main`, `parseArgs`) |
| `backend/package.json` | Adds the `invite:create` script. **No new dependency**, so `package-lock.json` is unchanged |
| `backend/src/__tests__/inviteCookie.test.ts` | New, self-host (10 tests) |
| `backend/src/__tests__/hosted/alsPropagation.test.ts` | New (1 test). Kept as the ALS regression pin |
| `backend/src/__tests__/hosted/invites.test.ts` | New (20 tests) |
| `backend/src/__tests__/hosted/auth.test.ts` | New (29 tests) |

`selfhostNoPg.test.ts` is **unchanged**. Every `better-auth` specifier `auth.ts` imports
(`better-auth`, `better-auth/api`, `better-auth/node`, `better-auth/plugins/magic-link`) was already in
`HOSTED_MODULES`, and the scan test passes. `auth.ts` imports `better-auth` **dynamically**, inside
`createAuth`, so importing the module loads nothing hosted. `invites.ts` imports only `node:crypto` and
`@soulbound/shared`, plus `pg` as a type only. No file outside `files_modified` was touched, and
`server.ts` was not touched.

## Task 1: verification table (installed source)
Paths are relative to `node_modules/`: BA = `better-auth/dist/`, CORE = `@better-auth/core/dist/`.

| Question | Finding | Where |
|---|---|---|
| **ALS survives into `sendMagicLink`, `user.create.before`/`.after`, `session.create.after`** | **Yes, all four**, on the magic-link path over real HTTP. On the OAuth path (`createOAuthUser` → `runWithTransaction`, `after` queued until commit), `before` and `after` both see it too. Better Auth itself runs on `node:async_hooks` ALS, and the hooks run inside awaited promise chains. A negative control (the handler called outside `als.run`) fails with `expected undefined to be 'request-1'` | test `hosted/alsPropagation.test.ts`; CORE `async_hooks/index.mjs:2-6`; CORE `context/transaction.mjs:37`, `:67` (`als.run`), `:78`, `:112-113` (after-commit queue); BA `db/with-hooks.mjs:8-17` (`before`), `:32-40` (`after`) |
| `session.cookieCache` | `session.cookieCache.enabled` (default false). Set `{ enabled: false }` explicitly | CORE `types/init-options.d.mts:929` (`session`), `:983`, `:993`; read at BA `cookies/index.mjs:77`, `api/routes/session.mjs:39` |
| `session.expiresIn` / `updateAge` | Seconds; defaults 7 d / 1 d. Set to 2 592 000 / 86 400 | CORE `init-options.d.mts:935`, `:942` |
| `rateLimit.enabled` | Exists. **Defaults to `isProduction`** | CORE `init-options.d.mts:202`, `:1252`; default at BA `context/create-context.mjs:172` |
| `advanced.useSecureCookies` | Exists. When unset, it's inferred from the baseURL scheme or `isProduction`; set `true`. The cookie then gets the `__Secure-` prefix and `secure` | CORE `init-options.d.mts:281`; BA `cookies/index.mjs:23`, `:28-39`; prefix constant BA `cookies/cookie-utils.mjs:10` |
| `trustedOrigins` | `string[]` or a function. Validated against Origin/Referer when a cookie is present, or when Fetch-Metadata or Origin headers are | CORE `init-options.d.mts:1248`; BA `api/middlewares/origin-check.mjs:96-118`, `:131-153` |
| `account.accountLinking.trustedProviders` / `allowDifferentEmails` | Under **`account.`** `accountLinking` (not top level). Used when an OAuth identity auto-links to an existing email | CORE `init-options.d.mts:1057`, `:1068`, `:1126`, `:1134`; BA `oauth2/link-account.mjs:43`, `:47`, `:137-139` |
| Magic link `storeToken` | Default `"plain"`. `"hashed"` → SHA-256, base64url, no padding | BA `plugins/magic-link/index.mjs:28`, `:33-35`; `plugins/magic-link/utils.mjs:4-7` |
| `databaseHooks.user.create.before`/`.after`, `session.create.after` | These names exist, with signature `(row, context: GenericEndpointContext \| null)`. `before` may return `false` or throw | CORE `init-options.d.mts:1267-1280`, `:1311-1324` |
| **`verification` row layout (critique 7, for 06-05)** | `identifier` = the **hashed token**; `value` = **JSON `{"email","name"}`**, so the email is inside `value`, not in `identifier`; `expiresAt` = now + 300 s. A test confirms no row holds the raw token | BA `plugins/magic-link/index.mjs:76-84` |
| **Magic-link URL host** | `new URL(ctx.context.baseURL)`. With `baseURL` set it's always that. With it unset, the request's origin is used, which `better-call` builds from **`Host`** (+ `X-Forwarded-Proto`). `X-Forwarded-Host` is honoured only with `advanced.trustedProxyHeaders` (pinned `false`) | BA `plugins/magic-link/index.mjs:85-89`; BA `auth/base.mjs:37-43`; BA `utils/url.mjs:68-80`; `better-call/dist/node.mjs:6` |
| `emailVerified` on the user in `user.create.before` for social sign-ups | **Present**: `emailVerified: userInfo.emailVerified`. Google maps `email_verified`, Discord maps `verified`. The magic link passes `true` | BA `oauth2/link-account.mjs:275-281`; CORE `social-providers/google.mjs:130`, `discord.mjs:64`; BA `plugins/magic-link/index.mjs:164-168` |
| **How a hook error surfaces** | An `APIError` with `body.code` → **302** to the error callback with `?error=<code>&error_description=<message>`. On magic link that's `errorCallbackURL`, else `callbackURL`, else `/`; on OAuth it's the state's `errorURL`, else `onAPIError.errorURL`. A non-`APIError` (e.g. a driver error) is rethrown, giving **500** | BA `plugins/magic-link/index.mjs:148-153`, `:169-171`; BA `api/routes/callback.mjs:78-84`, `:190-193`; BA `oauth2/state.mjs:48`, `:62` |
| Discord `email: null` | Better Auth refuses it **before** any user creation (`email_not_found` redirect). Our `before` hook is defense in depth, and a test pins it | BA `api/routes/callback.mjs:166-169` |
| `disabledPaths` | **Exact**, case-sensitive match on the path after the basePath is stripped and trailing slashes are trimmed. It can't match `/:param` routes | BA `api/index.mjs:166-168`; CORE `utils/url.mjs:18-30` |
| Session revocation | `internalAdapter.deleteUserSessions(userId)`. With no secondary storage it deletes the `session` rows | BA `db/internal-adapter.mjs:503-521` |
| `sendMagicLink` is awaited by Better Auth | Yes. So "don't await Resend" is done inside ours (`void …catch`) | BA `plugins/magic-link/index.mjs:93` |

**Found in source (not in the plan):**
1. **Under `NODE_ENV=test`, Better Auth skips its origin and callbackURL checks** (`skipOriginCheck`
   defaults to `isTest()`, BA `context/create-context.mjs:211`; CORE `env/env-impl.mjs:36`). Vitest sets
   `NODE_ENV=test`, so the callbackURL tests would have passed vacuously. `advanced.disableOriginCheck: false`
   and `disableCSRFCheck: false` are now set explicitly. A test asserts `ctx.skipOriginCheck === false`
   at runtime, and the `https://evil.example`, `//evil.example` and `/\evil.example` cases each get 403.
2. **The verification token is consumed before `createUser`** (BA `plugins/magic-link/index.mjs:156`). A
   refused sign-up (no cookie, used invite) burns that link, so the player requests a new one. The same
   holder's nonce can still retry. 06-06's error UI should say "request a new link".
3. **User `createdAt` is stamped on the app's clock *before* the `before` hook reserves**, which uses the
   DB clock (BA `db/internal-adapter.mjs:140-143` → `:168`). The plan's reconcile window
   (`createdAt` ∈ reservation window) would have **missed real orphans**. A full-suite run exposed this
   as a flake (sub-millisecond ordering). Fixed with `RECONCILE_SLACK_MINUTES = 2` on both sides of the
   window, and on the orphan-deletion threshold (now 12 min). Pinned: with the slack set to 0, 2 tests
   fail (see Mutations).
4. **Better Auth's default error log passes raw error objects** (BA `api/index.mjs` router `onError`;
   CORE `env/logger.mjs:60-69`). A pg constraint error's `detail` carries the inserted row, email
   included. `createAuth` sets a `logger.log` that writes **the message only**, passed through the
   optional `deps.redact`.

## Decisions
**Options set (all asserted on `auth.options` in `auth.test.ts` > "every security option is set explicitly"):**
- identity and URLs: `baseURL: publicUrl`, `basePath: '/api/auth'`, `secret`, `trustedOrigins: [publicUrl]`;
- `telemetry.enabled: false`;
- `rateLimit.enabled: false` (runtime `ctx.rateLimit.enabled === false` also asserted);
- `session`: `{ expiresIn: 2592000, updateAge: 86400, cookieCache: { enabled: false } }`;
- `account.accountLinking`: `{ enabled: true, trustedProviders: ['google'], allowDifferentEmails: false }`;
- `advanced`: `{ useSecureCookies: true, disableCSRFCheck: false, disableOriginCheck: false, trustedProxyHeaders: false }`;
- `onAPIError.errorURL: '/'` (critique 5's `errorCallbackURL: '/'`; this is the option-level
  equivalent, and it's what OAuth errors fall back to);
- `magicLink({ storeToken: 'hashed' })`;
- `socialProviders` only for providers whose ID **and** secret are both given.

**`disabledPaths`** (25): `/sign-up/email`, `/sign-in/email`, `/reset-password`, `/verify-password`,
`/verify-email`, `/send-verification-email`, `/change-email`, `/change-password`, `/update-session`,
`/update-user`, `/delete-user`, `/request-password-reset`, `/list-sessions`, `/revoke-session`,
`/revoke-sessions`, `/revoke-other-sessions`, `/link-social`, `/list-accounts`, `/delete-user/callback`,
`/unlink-account`, `/refresh-token`, `/get-access-token`, `/account-info`, `/ok`, `/error`.
These came from enumerating the installed `auth.api` (33 endpoints; `setPassword` has no HTTP path).

**Path allow-list (an addition, stricter than the critique).** `disabledPaths` can't cover the
parameterised `/reset-password/:token` or `/callback/:id`, and it is exact-match. So `handler` answers the app's
JSON 404 for anything outside
`/api/auth/{sign-in/magic-link, magic-link/verify, get-session, sign-out}`,
plus `sign-in/social` and `callback/<provider>` for configured providers only. The check is exact and
case-sensitive, on the WHATWG-normalised pathname. Tests:
- every `auth.api` path, tried with GET and POST, is reachable only in the allowed set;
- case, trailing-slash, `%2F`, `//`, dot-segment and `/API/AUTH` variants all get 404;
- `disabledPaths` holds on its own through `auth.handler` (the web handler);
- an upgrade that adds an endpoint that's neither used nor disabled fails
  "every installed endpoint is either used or disabled".

**Send gating (critique 2).**
- **Eligibility:** a send needs an existing account (`"user".email`, lower-cased and trimmed), **or**
  an invite cookie whose invite `inviteUsable` confirms in the DB (unused, unexpired, not reserved by
  another nonce).
- **Caps:** 3 per email per 15 min, plus 3 per invite nonce on the invite path. Both use the
  `accessGate.ts` sweep and hard-cap pattern (10 000 keys, then a shared overflow bucket).
- **Timing:** the Resend call is **not awaited** (`void sendEmail(...).catch(...)`), and the failure log
  carries only the HTTP status. Both paths run the same user lookup, so answers are identical in body,
  status and headers (tested) and don't wait on Resend. The remaining difference is the invite-path's
  second query, which only a holder of a valid invite cookie can trigger.
- **Storage:** a verification row is still written for ineligible requests (BA writes it before calling
  `sendMagicLink`). It's hashed, expires in 300 s, and is never emailed.

**Resend** goes through `fetch` to `https://api.resend.com/emails` (`createResendSender(apiKey)`), not an SDK.

**Spec SQL deviations (flagged):**
- The reservation also sets `reserved_email` (spec Revision History row 21 requires it; the Key
  Decisions SQL predates the column).
- `redeemInvite` also refuses an invite under a live reservation, so one path covers every "not
  available" case.
- `emailVerified !== true` is refused (not only `=== false`), so a provider that omits the field fails closed.

## Test counts
Gate, `npm run build && npm test` (local DB running, but the default config excludes `hosted/`):
```
 Test Files  14 passed (14)
      Tests  268 passed (268)      <- backend: 258 (after 06-02) + 10 new
 Test Files  13 passed (13)
      Tests  190 passed (190)      <- frontend, unchanged
```
Hosted, `URL=$(scripts/test-db.sh) && TEST_DATABASE_URL=$URL npm run test:hosted -w @soulbound/backend`:
```
 ✓ src/__tests__/hosted/auth.test.ts (29 tests)
       ✓ two concurrent sign-ups with one invite (two redeems) create exactly one user 948ms (repeat x20)
       ✓ two concurrent sign-ups sharing one invite cookie create exactly one user 783ms (repeat x20)
 ✓ src/__tests__/hosted/db.test.ts (11 tests)
 ✓ src/__tests__/hosted/invites.test.ts (20 tests)
 ✓ src/__tests__/hosted/alsPropagation.test.ts (1 test)
      Tests  61 passed (61)
[assert-no-skips] OK: 61 tests, 0 skipped, 0 todo
```
An earlier verbose run shows the reservation race: `✓ two concurrent reservations, one winner 51ms (repeat x20)`.

**10 new self-host tests** (`inviteCookie.test.ts`):
- round trip;
- the key is 32 bytes and depends on the secret;
- each single flipped byte fails;
- expired fails, and so does a cookie expiring exactly now;
- a different secret fails;
- malformed values fail (wrong MAC length, extra parts, bad JSON, bad fields under a valid MAC);
- the payload holds only `inviteId`/`nonce`/`exp`, and extra fields handed to the signer are dropped;
- Set-Cookie carries exactly `Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=900`;
- the clearing cookie;
- raw Cookie-header parsing.

**50 new hosted tests.**
- `invites.test.ts` (20):
  - code shape, hash-only storage, `expiresInDays`;
  - redeem: a fresh nonce each time, and the decoded payload has exact keys and no code;
  - redeem returns one identical `null` for unknown, used, expired, reserved and malformed codes (9 inputs);
  - a malformed code never queries;
  - A blocks B and A retries; `reserved_email` is normalised; after a lapse B reserves; expired or used invites can't be reserved;
  - race ×20; consume needs the nonce, and succeeds once;
  - reconcile: marks the orphan; overlapping windows don't cross-mark; a live reservation is untouched;
    an invite-less user past the window is deleted (one inside the slack isn't); it runs on a client in a transaction;
  - the CLI: argument parsing; the fragment link printed once with the hash stored and both variables cleared;
    the code only when no URL is set; exit 1 with no DB URL.
- `auth.test.ts` (29):
  - options and runtime flags; providers only when complete;
  - surface: every endpoint is used or disabled; the HTTP reachability sweep; 10 path variants get 404;
    `disabledPaths` holds alone; 4 + 3 foreign `callbackURL`s get 403 and nothing is sent;
  - sign-up: the session cookie has `HttpOnly`, `Secure`, `SameSite=Lax`, `Max-Age=2592000` and the name
    `__Secure-better-auth.session_token`; the invite cookie is cleared; the invite is consumed;
    `onSessionCreated` fires; no verification row holds the raw token;
  - races (×20 each): two redeems, and one shared cookie;
  - a forced insert failure (temporary `CHECK`): no user, reservation held, and the invite completes a
    sign-up for a fresh holder after the lapse;
  - cross-device: `error=INVITE_REQUIRED` plus the message;
  - a returning user needs no invite;
  - forced `after` failure: magic link (no user, code unconsumed, no session cookie) and OAuth inside
    Better Auth's transaction (no user, no orphan `account`);
  - OAuth hooks: a verified Google sign-up consumes the invite; `emailVerified: false` is refused with the
    invite row byte-identical; Discord `email: null` gets `EMAIL_REQUIRED` and the message; no invite gets
    `INVITE_REQUIRED`;
  - gating: unknown vs known email give identical answers and only the known one sends; the 4th send per
    address (case-insensitive) isn't sent; 3 per nonce; a used or expired invite cookie sends nothing; a
    forged cookie sends nothing; spoofed `Host` plus `X-Forwarded-Host` still yield a `https://play.example`
    link; a failing sender still gives 200 and logs no address or URL; the limiter window resets and the
    map sweeps;
  - the Resend sender posts the right request, and a failure throws `Resend responded 422` only.
- `alsPropagation.test.ts` (1).

Ad-hoc type check of `src/**`, tests included (throwaway tsconfig, deleted afterwards): **no errors in any
new file**. The only errors are the pre-existing frozen-file ones (`anthropic.test.ts` 11,
`routes.test.ts` 1, `server.test.ts` 3), the same counts 06-01 and 06-02 recorded.

`npm audit --omit=dev -w @soulbound/backend` → `found 0 vulnerabilities`.

## Mutations
Committed first (`8ee0b4b`, then `235eb11`). Each file was backed up with `cp`, its sha256 confirmed
changed, then restored with `cp` and the restore hash-checked. `git status` was clean after all of them.

| # | Mutation | Caught by |
|---|---|---|
| a | `AND reserved_nonce = $2` dropped from consume | 7 failed / 61. **Weak:** it leaves `$2` unreferenced, so Postgres rejects every consume. Replaced by a' |
| a' | The same, keeping `$2` bound (`AND ($2::bytea IS NOT NULL)`) | `invites > consume needs the reserving nonce, and succeeds only once` (1 failed / 61). The e2e races stay green, because `used_at IS NULL` independently enforces single use; the nonce clause matters after a lapse-and-takeover, which the direct test covers |
| b | The `emailVerified` check disabled | `auth > emailVerified: false is refused before any reservation (the invite row is untouched)` (1 failed / 61) |
| c | `redeemInvite` MACs a payload that includes the raw code | `invites > a valid code yields a signed cookie … fresh nonce each time` (1 failed / 61). This is the assertion added in `235eb11`: before it, the test checked only `setCookie` for the literal code, which base64url hides. The self-host suite stayed 10/10 under (c), as expected (it tests the signer, not redeem) |
| d | Send gating removed (`if (!hasAccount && !inviteOk) return;`) | `auth > an unknown email with no invite cookie sends nothing …`, `… used or has expired sends nothing`, `a forged invite cookie counts as no cookie` (3 failed / 61) |
| e | `baseURL` dropped from the options | 10 failed / 61, including the spoofed-host test. Run alone: `expected 'https://evil.example' to be 'https://play.example'`. So the test does exercise the forwarded/spoofed-host path (AI-1) |
| f (added) | `RECONCILE_SLACK_MINUTES = 0` (the plan's strict window) | `invites > marks an expired reservation …` and `… deletes an invite-less user past the window …` (2 failed / 20) |
| g (added, negative control) | ALS test: the handler called outside `als.run` | `expected undefined to be 'request-1'` |

## Gate
1. `npm run build && npm test` → 268 + 190: the 258 before this plan plus the 10 new self-host tests listed above. ✔
2. `test:hosted` → 61 passed, 0 skipped. ✔
3. `git diff 7856b7d -- frontend/src/App.tsx` → 0 lines. ✔
4. `git diff --stat 7c737a6 -- '*.test.ts' '*.test.tsx'` lists only new files, and `--diff-filter=M` shows no test file. ✔
5. Only a script line changed in `package.json`, with no dependency and no Dockerfile change. smoke-image was not
   run: the image content is unchanged except for `dist/` gaining three unreferenced modules. CI's `smoke-image` job covers it.

## For 06-04
**Loading.** Import `auth.ts` **dynamically** behind the hosted-mode check, as with `db.ts`. It is
import-safe, but `createAuth` itself loads `better-auth`. Likewise, the redeem route must `import('./invites.js')`
dynamically (critique 4).

```ts
const { createAuth, createResendSender } = await import('./auth.js');
const secrets = getHostedSecrets();
const hostedAuth = await createAuth({
  pool,                                   // from createPool(secrets.databaseUrl, { redact })
  publicUrl: HOSTED_PUBLIC_URL!,          // bare origin
  secret: secrets.betterAuthSecret,
  emailFrom: EMAIL_FROM!,
  sendEmail: createResendSender(secrets.resendApiKey),
  google: GOOGLE_CLIENT_ID && secrets.googleClientSecret ? { clientId: GOOGLE_CLIENT_ID, clientSecret: secrets.googleClientSecret } : undefined,
  discord: DISCORD_CLIENT_ID && secrets.discordClientSecret ? { clientId: DISCORD_CLIENT_ID, clientSecret: secrets.discordClientSecret } : undefined,
  onSessionCreated: async (userId) => { /* 06-05: DELETE FROM account_deletions WHERE user_id = $1 */ },
  redact,                                 // config.ts's redact()
});
```

**Mount (spec order step 10), before `express.json`:**
```ts
app.all('/api/auth/*splat', hostedAuth.withInviteContext, hostedAuth.handler);
```
- `withInviteContext` must run first, and in the same chain; it's what puts the invite into ALS.
- `handler` ends every request itself (JSON 404 for any path outside the allow-list), so the session
  gate needs no exemption.
- It reads the path from `req.originalUrl`, so it is mount-agnostic.

**Redeem route (step 9).**
```ts
const { redeemInvite, inviteCookieKey } = await import('./invites.js');
const key = inviteCookieKey(secrets.betterAuthSecret);   // derive once at boot
const result = await redeemInvite(pool, req.body?.code, { key });
if (result === null) {
  // 400 { error: { message, code: INVITE_INVALID } }: one response for every failure
} else {
  res.setHeader('Set-Cookie', result.setCookie);         // then 204
}
```
`redeemInvite` validates `INVITE_CODE_PATTERN` itself, and never queries for a malformed code.

**Session cookie name:** `__Secure-better-auth.session_token` (`HttpOnly; Secure; SameSite=Lax; Path=/`;
`Max-Age=2592000`).

**Session gate (step 11):**
```ts
await hostedAuth.auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
```
`fromNodeHeaders` is from `better-auth/node`, which is already in `HOSTED_MODULES`. `cookieCache` is off,
so every call reads the `session` table.

**Session revocation (06-05):** `await hostedAuth.revokeUserSessions(userId)` wraps
`internalAdapter.deleteUserSessions` (BA `db/internal-adapter.mjs:503`), and deletes every `session`
row for the user. To clear the browser cookie on `DELETE /api/account`, send
`__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`.

**Origin check (step 8)** runs in front of `/api/auth` too. Better Auth's own origin check is also on
(pinned), so that's two layers. `GET /api/auth/magic-link/verify` is a GET, so our check doesn't
apply to it (the spec's accepted login-CSRF risk).

**The ALS verdict doesn't change the order.** No fallback hook exists.

## For 06-05
- `reconcileInvites(client, now)` takes any `{ query }`: a checked-out client inside the purge
  transaction works (tested). It returns `{ marked, deleted }`.
- The orphan-deletion threshold is `now − 12 min` (10-minute reservation + 2-minute slack).
- Magic-link `verification` rows: `value` is JSON `{"email":…,"name":…}` and `identifier` is the
  **hashed token**. To purge by email, match on `value::jsonb->>'email'`, never on `identifier`.
- The deletion-cancel hook is `onSessionCreated(userId)` in `createAuth`'s deps.

## For 06-06
- Errors come back as a redirect to `/?error=<CODE>&error_description=<message>`:
  - `INVITE_REQUIRED`, with the cross-device message;
  - `INVITE_INVALID`;
  - `EMAIL_REQUIRED`, `EMAIL_NOT_VERIFIED`;
  - Better Auth's own codes, e.g. `INVALID_TOKEN` or `email_not_found`.
- The link is single-use, and a refused sign-up burns it, so offer "request a new link".
- Invite links are `/#invite=<code>` (critique 8).

## For 06-07
`invite:create` needs `dist/`, then:
`DATABASE_URL=… BETTER_AUTH_URL=https://… npm run invite:create -w @soulbound/backend [-- --days N]`.
It prints the link on stdout once, and the expiry on stderr.

## CI
CI run 120 on `235eb11` (the last code commit): https://github.com/DeanItServices/soulbound/actions/runs/36054191300, conclusion **success**.
- `build-and-test` succeeded. Its `Test (hosted, real Postgres)` log shows each auth race test
  `(repeat x20)`, `Tests  61 passed (61)` and `[assert-no-skips] OK: 61 tests, 0 skipped, 0 todo`.
- `smoke-image` succeeded (`Build image`, `Smoke test image`).
- The SUMMARY commit's own CI run was not re-checked; it changes only this markdown file.

**Two log observations from that run, for 06-07:**
1. Better Auth's module-level default logger still prints one message-only line on some rejections
   (`ERROR [Better Auth]: Invalid callbackURL`) next to ours. It has no arguments and no user data.
2. The **Postgres server's own log** recorded the forced constraint failure with
   `DETAIL: Failing row contains (…, <email>, …)`. That is the database's statement-error logging, not
   the app's. On a managed Postgres, any failed insert into `"user"` can therefore put an email into the
   provider's DB logs. The runbook should record that log's retention alongside Resend and Sentry (spec,
   Deletion flow → processor retention).
