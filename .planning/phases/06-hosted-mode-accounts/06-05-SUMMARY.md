# 06-05 Summary: Account deletion with 7-day grace, hourly purge, auth body cap

## Status: Complete

Executed by engineering-backend-architect. Every count below comes from a runner line quoted next to it.
The 06-04 anchors were re-checked at `ee21a9f`: `HostedDeps.requestAccountDeletion?` at `server.ts:95`,
the step-14 mount at `:403-412`, `buildHostedDeps` at `:565`, `closePoolOnSigterm` at `:614` and the hosted
`main()` block at `:729`. All matched.

## Commits
| Commit | What |
|---|---|
| `66f925c` | `account.ts`, the `auth.ts` hook line, the `server.ts` wiring and body cap, the helper option, `hosted/account.test.ts` and `hosted/purge.test.ts` |
| this commit | this SUMMARY |

## Files touched (all in `files_modified`)
| File | Change |
|---|---|
| `backend/src/account.ts` | New. `requestAccountDeletion`, `cancelAccountDeletion`, `PURGE_LOCK_KEY`, `DELETION_GRACE_MS`, `purgeDeletedAccounts`, `startPurgeSchedule`, `PURGE_INTERVAL_MS`, `PURGE_FIRST_RUN_DELAY_MS`. It imports `pg` as a type only |
| `backend/src/auth.ts` | `session.create.after` now calls `cancelAccountDeletion(db, session.userId)` before the optional `deps.onSessionCreated`. That is the one functional line; the import and the `AuthDeps.onSessionCreated` doc comment changed with it |
| `backend/src/server.ts` | `buildHostedDeps` dynamically imports `account.js` and always sets `requestAccountDeletion`. `authBodyCap` and `AUTH_BODY_LIMIT_BYTES` are new and mounted just before step 10. Hosted `main()` starts `startPurgeSchedule`. The SIGTERM handler stops the purge before `pool.end()` |
| `backend/src/__tests__/helpers/hostedApp.ts` | `requestAccountDeletion` now also accepts `'real'`. When the option is omitted, the helper strips the production function, so 06-04's "absent → 404" pin still tests `buildApp`'s condition |
| `backend/src/__tests__/hosted/account.test.ts` | New, 14 hosted tests |
| `backend/src/__tests__/hosted/purge.test.ts` | New, 10 hosted tests |

The helper was extended rather than extracted: 06-04 had already created it.

## Decisions
- **Revocation mechanism: `hostedAuth.revokeUserSessions(userId)`.** This is 06-03's wrapper over Better Auth's `internalAdapter.deleteUserSessions`, which takes the user id server-side. There is no secondary storage, so it deletes every `session` row. I chose the API over a raw `DELETE FROM session`, because it stays correct if Better Auth ever adds a session store.
  - The `account_deletions` insert runs **first**. If revocation throws, the session gate already refuses the user.
- **Idempotency:** `INSERT … ON CONFLICT (user_id) DO NOTHING`. A repeat keeps the original `requested_at`, so re-deleting never extends the grace period (tested).
- **Cancel wiring is in `auth.ts` itself, not in a `buildHostedDeps` callback.** Every `createAuth` cancels a pending deletion on sign-in, so a future caller can't forget it. `deps.onSessionCreated` still runs after it.
- **`requestAccountDeletion` lives in `buildHostedDeps`**, following 06-04's "where to plug it in". The plan's "set in `main()`" is met because `main()` is the only production caller of `buildHostedDeps`.
- **Purge (`purgeDeletedAccounts(pool, now, { afterLock? })`).** It runs on `pool.connect()`, with `BEGIN` and then `SELECT pg_try_advisory_xact_lock($1::bigint)`.
  - If the lock is held elsewhere, it returns `{ locked: false, purged: 0 }` after a `ROLLBACK`.
  - If it gets the lock, it runs three steps, then `COMMIT`:
    - it deletes `verification` rows whose JSON `value`'s email (lower-cased) belongs to a due user;
    - it deletes due users with `DELETE FROM "user" WHERE id IN (SELECT user_id FROM account_deletions WHERE requested_at < $1)`;
    - it calls `reconcileInvites(client, now)`.
  - The cutoff is `$1 = now − 7 days` from the injected clock. SQL `now()` is never used (critique 2). An added mutation (g) proves this.
  - On any error it runs `ROLLBACK`, and `client.release(err)` destroys the connection.
  - The return value is `{ locked, purged, reconciled? }`: the plan's shape, plus the reconcile counts for the log line.
- **`PURGE_LOCK_KEY = 0x73622d7075726765n`**, the ASCII of "sb-purge". It is documented in the source.
- **Verification rows** are matched with `CASE WHEN value IS JSON OBJECT THEN lower(btrim(value::jsonb->>'email')) END`. `identifier` is never matched (it is the hashed token, per 06-03). A non-JSON `value` from another Better Auth flow is skipped without being cast, so it can't abort the purge (tested). **`IS JSON` needs PostgreSQL 16 or later.** CI and the local DB run 16. **06-07 must provision Postgres ≥ 16 on Render.**
- **`startPurgeSchedule(pool, { intervalMs = 3_600_000, firstRunDelayMs = 30_000, now, log, purge? })`**:
  - it runs once 30 s after boot, then hourly; both timers are `unref`'d (tested with real timers);
  - a tick is skipped while a run is still in progress;
  - log lines carry counts only, and a failure logs `[purge] failed (<SQLSTATE>)`, never the message;
  - it returns an async stop function that clears both timers and waits for a run in progress.
- **SIGTERM (hosted):** `stopPurge()` runs at once, so no purge starts while requests drain. Then `server.close`, then the purge's completion, then `pool.end()`, then exit 0, with the same 10 s backstop. Self-host never reaches this block, so it starts no timer and opens no connection.
- **Auth body cap (build addendum): `authBodyCap(16 KB)`**, mounted as `app.use('/api/auth', …)` directly above step 10.
  - **With a `Content-Length` over 16 384:** it calls `next(err)` with `err.type = 'entity.too.large'`. `mapBodyParserError` turns that into the same `413 {"error":{"message":"request entity too large","code":"PAYLOAD_TOO_LARGE"}}` the JSON parser gives. It also sets `Connection: close`, so the unread body isn't drained.
  - **Without a `Content-Length` (chunked):** it wraps the request's own `push`, which the HTTP parser calls for every body chunk. It counts bytes there, starting from `req.readableLength`. Past 16 KB it drops the chunk and destroys the request on the next tick; the client sees a connection reset.
  - It never reads, parses or re-flows the stream. A `'data'` listener was rejected, because it would switch the stream to flowing mode before Better Auth attaches its reader, and chunks would be lost.
  - A body of exactly 16 384 bytes still reaches Better Auth (200, tested).

## Test counts
Baseline at `ee21a9f`, before any edit (`npm run build && npm test`):
```
 Test Files  16 passed (16)
      Tests  284 passed (284)
 Test Files  13 passed (13)
      Tests  190 passed (190)
```
Hosted baseline: `Tests  126 passed (126)`, `[assert-no-skips] OK: 126 tests, 0 skipped, 0 todo`.

Task 1 verify (after the source changes, before the new tests): `Tests  284 passed (284)` + `Tests  190 passed (190)`. `npx tsc --noEmit -p backend/tsconfig.json` → clean.

Final (`npm run build && npm test`, on `66f925c`, after every mutation was restored):
```
 Test Files  16 passed (16)
      Tests  284 passed (284)      <- backend, unchanged: this plan adds no self-host test
 Test Files  13 passed (13)
      Tests  190 passed (190)      <- frontend, unchanged
```
Hosted (`TEST_DATABASE_URL=$(scripts/test-db.sh) npm run test:hosted -w @soulbound/backend`):
```
 ✓ src/__tests__/hosted/purge.test.ts (10 tests)
 ✓ src/__tests__/hosted/auth.test.ts (29 tests)
 ✓ src/__tests__/hosted/hostedOrder.test.ts (65 tests)
 ✓ src/__tests__/hosted/account.test.ts (14 tests)
 ✓ src/__tests__/hosted/db.test.ts (11 tests)
 ✓ src/__tests__/hosted/invites.test.ts (20 tests)
 ✓ src/__tests__/hosted/alsPropagation.test.ts (1 test)
      Tests  150 passed (150)
[assert-no-skips] OK: 150 tests, 0 skipped, 0 todo
```
That is 126 + 24 new.

**No new self-host tests.** Everything here needs Postgres. Self-host is covered by the unchanged 284, including `selfhostNoPg.test.ts`: its source scan passes, since `account.ts` imports only `pg` types.

**24 new hosted tests.**
- `account.test.ts` (14):
  - DELETE with the right Origin → 204, `Set-Cookie` equals the exact clear string, and the row is recorded;
  - the same old cookie on `/api/access` → 401 `SIGN_IN_REQUIRED`;
  - a second session made before the delete also gets 401, and **0 `session` rows** remain;
  - revocation stands alone: with the deletion row removed by hand, both old cookies still get 401;
  - signing in again (magic link, existing email, no invite) removes the row, and `/api/access` → 204;
  - a repeated DELETE after signing in again → 204, one row, sessions revoked;
  - `requestAccountDeletion` twice keeps one row and the original `requested_at`;
  - no session → 401, and nothing is recorded;
  - a foreign Origin → 403 `ORIGIN_REJECTED`, and the account is untouched;
  - body cap (5 tests):
    - the limit is 16 KB;
    - 17 KB with a `Content-Length` → 413 `PAYLOAD_TOO_LARGE`, and nothing is sent;
    - exactly 16 384 bytes → 200;
    - chunked over 16 KB → reset, while small chunked → 200 and health still answers;
    - a normal sign-in works end to end.
- `purge.test.ts` (10):
  - grace: at 6 d 23 h the user, verification rows and deletion row stay; at 7 d 1 min the user is purged;
  - cascade: `user`, `session`, `account` and `account_deletions` are gone, the **real** magic-link `verification` rows (from a `/api/auth/sign-in/magic-link` call) are gone, and `invites.used_by` is null with `used_at` unchanged; a bystander's user and verification rows are untouched;
  - a non-JSON verification row neither aborts the purge nor is deleted;
  - the reconciliation orphan (as in 06-03's setup) gets marked, and its user is kept;
  - concurrency:
    - (a) while a third client holds the lock, both purges → `{locked:false, purged:0}` and nothing is deleted;
    - (b) `repeats: 10`, with a 150 ms pause after the lock → exactly one `locked: true`;
    - no advisory lock remains after a commit (`pg_locks`);
  - schedule:
    - fake timers: 2 timers, the first run at 30 s, then hourly, count-only lines, and `stop()` → `vi.getTimerCount() === 0` with no later runs;
    - a skipped run and a failure logged without the message, a tick skipped mid-run, and `stop()` waits for the run;
    - real timers: both handles have `hasRef() === false`, and the default job really purges a due user.

The 06-04 pins still pass unchanged: the malformed-JSON step-10 pin (`hostedOrder.test.ts`), and "DELETE /api/account is not mounted while requestAccountDeletion is absent".

Ad-hoc type check of `src/**`, tests included (a throwaway tsconfig, deleted afterwards): errors only in the frozen files: `anthropic.test.ts` 11, `routes.test.ts` 1, `server.test.ts` 3. Those are the same counts 06-01 to 06-04 recorded, with none in any new file.

## Mutations
All ran after committing `66f925c`. Each file was backed up with `cp`, the sha256 confirmed changed, the file restored with `cp`, and the restore hash-checked (`restored OK` every time). `git status` was clean afterwards.

| # | Mutation | Result (`test:hosted`) |
|---|---|---|
| a | `requestAccountDeletion` deletes only the newest session (the one making the request) instead of `revokeUserSessions` | `Tests  3 failed \| 147 passed (150)`: `every session is revoked: a second session …`, `revocation stands on its own …`, `requestAccountDeletion twice …` |
| b | `pg_try_advisory_xact_lock` → blocking `pg_advisory_xact_lock` (`SELECT true AS locked FROM pg_advisory_xact_lock($1::bigint)`) | Full suite: `Tests  4 failed \| 146 passed (150)`. Concurrency (a) **timed out** (`Test timed out in 10000ms`: both purges block behind the holder), and that cascades to the rest of the describe. Run alone (`-t "exactly one locked"`), concurrency (b) gets **two `locked: true`**: `expected [ …(2) ] to have a length of 1 but got 2` |
| c | the `verification` DELETE turned into a SELECT | `1 failed \| 149 passed`: `a purge removes the user, session, account, account_deletions and verification rows …` |
| d | the `cancelAccountDeletion` line removed from `session.create.after` | `2 failed \| 148 passed`: `signing in again … cancels the deletion …`, `a repeated DELETE after signing in again …` |
| e (added) | body-cap mount removed | `2 failed`: `a 17 KB magic-link POST … → 413 …`, `a chunked body past 16 KB is cut off …` |
| f (added) | chunked branch disabled (`next(); return;`) | `1 failed`: `a chunked body past 16 KB is cut off …` |
| g (added) | user delete uses SQL `now() - interval '7 days'` (critique 2) | `4 failed`, including `6 days 23 hours after the request: not purged; 7 days 1 minute after: purged` |

**`scripts/mutate-order.sh`** (after committing the `server.ts` changes):
```
PASS  (a) express.json above the Better Auth mount: suite failed as required (rc=1, 15s; Tests  1 failed | 149 passed (150); 2 s timeouts: 0)
PASS  (b) Origin check moved below the Better Auth mount: suite failed as required (rc=1, 13s; Tests  11 failed | 139 passed (150); 2 s timeouts: 0)
PASS  (c) session gate deleted: suite failed as required (rc=1, 14s; Tests  20 failed | 130 passed (150); 2 s timeouts: 0)
mutate-order: all 3 mutations caught; backend/src/server.ts restored (sha256 54f48ff391e6ebbe8f765dd83da10ede0c0f42ece80f7d3eb9a3bd8e70f110d4)
```

## Gate
1. `npm run build && npm test` → 284 + 190, unedited. This plan adds no self-host tests. ✔
2. `test:hosted` → 150 passed, 0 skipped. ✔
3. `git diff 7856b7d -- frontend/src/App.tsx` → 0 lines. ✔
4. `git diff --stat --diff-filter=M 7c737a6 -- '*.test.ts' '*.test.tsx'` → empty. Every changed test or helper file fails `git cat-file -e 7c737a6:<path>`, so all of them are new this phase. ✔
5. No Dockerfile or `package.json` change, so smoke-image doesn't apply.

## For 06-06
**`DELETE /api/account`** (hosted only; self-host answers 404):
- It needs a same-origin request. The browser's `fetch` sends `Origin` on DELETE automatically, and the session cookie goes with `credentials: 'same-origin'` (the default).
- **Success:** `204`, no body, and exactly this header:
  `Set-Cookie: __Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`
  - Every session of the user is revoked server-side, not only this browser's.
  - The very next `GET /api/access` from **any** of the player's devices → `401 SIGN_IN_REQUIRED` with `Soulbound-Mode: hosted`. After a 204, send `ModeGate` straight to its sign-in state; don't retry the request.
- **Errors:**
  - no or expired session → `401 {"error":{"message":"Sign in required","code":"SIGN_IN_REQUIRED"}}`;
  - missing or foreign Origin → `403 ORIGIN_REJECTED`;
  - per-user limit → `429 TOO_MANY_REQUESTS`;
  - a database failure → `500 INTERNAL_ERROR`.
- **Idempotent:** a pending deletion keeps its original date.
- **Grace period:** signing in again within 7 days (magic link or OAuth, no invite needed, since the account still exists) **cancels the deletion silently**. `AccountPanel`'s confirm copy should say so: e.g. "Your account will be deleted in 7 days. Signing in again before then cancels this." After 7 days, the hourly purge removes the account for good. A later sign-in is then a new sign-up and needs an invite.
- There is no endpoint to query deletion status. While a deletion is pending, the player can't be signed in, so the UI never has to show it.
- Use the inline arm → Confirm/Cancel pattern (CLAUDE.md #1), never `window.confirm`.

## For 06-07
- **Postgres ≥ 16 is required** (the purge uses `IS JSON OBJECT`). Pin it in `render.yaml` or the runbook.
- The purge logs `[purge] purged N account(s); invites reconciled: M marked, K orphan(s) removed` hourly, and 30 s after boot. With two instances, one logs `[purge] skipped: another instance holds the lock`. A failure logs `[purge] failed (<SQLSTATE>)`. It isn't sent to the tracker, so the runbook should mention watching the logs.
- Design-log entries:
  - the 16 KB auth body cap, and why it wraps `push` rather than listening for `data`;
  - revocation through `internalAdapter.deleteUserSessions`;
  - the insert-then-revoke order.
- Processor retention (Resend logs, Sentry, and the Postgres statement log noted by 06-03) remains a runbook item. The purge only covers our own tables.

## CI
Run 127 on `66f925c` (the only code commit): https://github.com/DeanItServices/soulbound/actions/runs/36059182803 →
**success** (`status: completed`, `conclusion: success`). The job log was not pulled, so the CI test count isn't quoted
here; the run's conclusion is. The new tests use no database role beyond `TEST_DATABASE_URL`'s, so CI's
8-character password (06-04's failure) never reaches hosted config. This SUMMARY commit's own run was not
re-checked; it changes only this markdown file.
