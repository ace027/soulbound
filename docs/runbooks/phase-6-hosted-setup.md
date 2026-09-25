# Runbook: Phase 6 hosted setup (Render)

This takes hosted mode (`SOULBOUND_MODE=hosted`) live on Render. Self-host is not affected and needs
none of this.

**How to use it.** Work through the numbered steps in order. Each step has three parts:
- **Do:** what you click or type, with exact values.
- **Check:** what the agent runs (or reads) once you report back, and what passing looks like. Paste the
  output it asks for. Never paste a secret, a cookie, an email address or an invite link into chat.
- **Status:** "awaiting developer" until the Check has actually passed. Then it becomes
  "PASSED on <date>", naming the evidence file. Nothing in this runbook has run on a real Render
  account yet.

What has been proven locally (2026-09-24, `.planning/phases/06-hosted-mode-accounts/evidence/`):
- `render.yaml` validates against Render's published Blueprint schema (`render-yaml-validation.txt`).
- The image, the migrate command, `scripts/verify-hosted.sh` (7/7, and 8/8 with a session), the invite
  command and the account-count command all work against a local hosted container
  (`verify-hosted-local.txt`).

Throughout, `<svc>` means your service's `onrender.com` subdomain. The Blueprint names the service
`soulbound`, so it is usually `soulbound`, but Render adds a suffix if the name is taken. Use whatever
the dashboard shows.

**Before you start**
- `render.yaml` pins the service to the **`main`** branch, and deploys only after CI passes there
  (`autoDeployTrigger: checksPass`). So merge the Phase 6 branch into `main` before step 2.
- Have a password manager open. Steps 1, 6, 7, 8 and 10 each produce a secret.

> **WARNING: Never change a `render.yaml`-declared variable in the dashboard.**
> Any variable `render.yaml` gives a `value:`, `fromService` or `fromDatabase` (today: `SOULBOUND_MODE`,
> `NODE_ENV`, `DATABASE_URL`, `ALLOWED_HOSTS`, `TRUST_PROXY`) belongs to the file. A dashboard edit to
> one of them looks like it worked, and then the next Blueprint sync silently puts the file's value back
> (Render: "the next Blueprint sync _overwrites_ them"). To change one: edit `render.yaml`, merge to
> `main`, and let the Blueprint sync apply it. If the Blueprint's page doesn't show the new sync, click
> **Manual Sync** there. Only the `sync: false` variables (step 3), and variables `render.yaml` doesn't
> mention at all (`DEBUG_PROXY_HOPS`, `USER_RATE_LIMIT_PER_MINUTE`), are edited in the dashboard.

---

## 1. Generate `BETTER_AUTH_SECRET`

**Do:**
1. On your own machine, run:
   ```bash
   openssl rand -base64 48
   ```
2. Save the output in your password manager as "Soulbound BETTER_AUTH_SECRET". You'll paste it in step 3.

Don't generate a new one later. Changing it signs every player out and voids every unused invite
cookie. That's why `render.yaml` doesn't use `generateValue` for it.

**Check:** The agent can't see the value, and doesn't need to. Paste only its length:
```bash
printf %s '<the secret>' | wc -c
```
Passing: **64** (the hosted config needs at least 32). Step 4's boot log also shows no
`Invalid BETTER_AUTH_SECRET` line.

**Status:** UNTESTED — awaiting developer

## 2. Render: create the Blueprint, and record the plan IDs

**Do:**
1. In Render, open **New → Blueprint**. Connect GitHub if asked, then pick this repository and the
   `main` branch.
2. Render reads `render.yaml` and lists what it will create:
   - a web service `soulbound`: Docker, plan `0.5c-512mb` (0.5 CPU / 512 MB, shown as Starter);
   - a Postgres database `soulbound-db`: version 16, plan `0.1c-256mb` (shown as Basic-256mb).
   Both are in `oregon`.
3. Keep those plans. The free web plan can't run the pre-deploy migration, and free Postgres is deleted
   30 days after creation.
4. Before you continue, note the **plan IDs the dashboard shows** for both (spec Open Question 4). If
   either differs from the IDs above, say so: `render.yaml` then gets the dashboard's ID.

Render then asks for the `sync: false` values. That's step 3.

**Check:** Paste the two plan IDs and the Postgres version shown. The agent writes them to
`evidence/render-plan-ids.txt`. Passing: web `0.5c-512mb` or its dashboard equivalent, a paid Postgres
plan, and Postgres **16**. The purge uses `IS JSON OBJECT`, which needs 16 or later, and
`postgresMajorVersion` can't be changed after creation.

**Status:** UNTESTED — awaiting developer

## 3. Set the `sync: false` variables

**Do:** Render prompts for these once, when the Blueprint is created. Later syncs ignore them, so a
value you add afterwards goes in by hand, under the service's **Environment** tab.

| Variable | Value |
|---|---|
| `BETTER_AUTH_URL` | `https://<svc>.onrender.com`: https, no trailing slash, no path |
| `FRONTEND_ORIGIN` | exactly the same value as `BETTER_AUTH_URL` |
| `ANTHROPIC_API_KEY` | your Anthropic Console key, from the workspace that has the spend limit (step 12). On Render, use this name, not `SOULBOUND_ANTHROPIC_KEY`. |
| `BETTER_AUTH_SECRET` | the value from step 1 |
| `RESEND_API_KEY` | from step 6 (`re_…`) |
| `EMAIL_FROM` | `Soulbound <onboarding@resend.dev>` for now (step 6) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | blank for now; step 7 fills them |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | blank for now; step 8 fills them |
| `SENTRY_DSN` | blank for now; step 10 fills it |

Notes:
- **Do steps 6 and 12 first** if you want to paste real values here rather than come back.
- **You won't know `<svc>` until the service exists.** Enter `https://soulbound.onrender.com`. If Render
  gives the service a different subdomain, correct both URL variables afterwards and redeploy. Check 6
  in step 4 fails with 403 until they match.
- **An OAuth ID and its secret must be set together, or both left blank.** A lone half stops the boot.
  If the form refuses blank values, it's not known yet whether it will; say so, and we'll handle it.
- **Values `render.yaml` sets for you:** `SOULBOUND_MODE=hosted`, `NODE_ENV=production`,
  `TRUST_PROXY=1`, `DATABASE_URL` (from the database) and `ALLOWED_HOSTS` (the service's own
  onrender.com hostname). Change these only in `render.yaml` (see the warning above), never here.
- **Never set `NODE_ENV=test`.** It turns off Better Auth's own origin and callback checks.

**Check:** Screenshot the Environment tab with **values hidden** (Render masks them by default) as
`evidence/render-env-names.png`. The agent checks that every name above is present and that no
`SOULBOUND_PASSPHRASE` is set (hosted mode refuses to boot with one).

**Status:** UNTESTED — awaiting developer

## 4. First deploy: migrations, boot, `verify-hosted.sh`

**Do:**
1. Let the first deploy run (**Apply** on the Blueprint).
2. From the service's **Events** and **Logs**, copy:
   - the pre-deploy lines, which start with `[migrate]`;
   - the first boot lines.

**Check:** The agent runs:
```bash
scripts/verify-hosted.sh https://<svc>.onrender.com
```
Passing looks like this:
- the pre-deploy log ends `[migrate] done: 2 migration(s) applied`;
- the boot log shows `[soulbound-backend] listening on port 10000`. Render's default `PORT` is 10000, and
  the app reads `PORT`;
- the script prints `7/7 passed` and exits 0. Its checks: health 200; the three anti-framing headers;
  `/` serves HTML; a foreign Origin gets 403 `ORIGIN_REJECTED`; `/api/access` gets 401
  `SIGN_IN_REQUIRED` with `Soulbound-Mode: hosted`; a bad invite gets 400 `INVITE_INVALID`;
  `/api/debug/ip` gets 401.

The agent commits the output as `evidence/verify-hosted-live.txt`.

If something fails:
- **Health 403, or the deploy never goes healthy:** `ALLOWED_HOSTS` lacks the host Render's health check
  sends.
- **Check 6 gets 403:** `BETTER_AUTH_URL` differs from `<svc>`.
- **Boot exits with `Invalid DATABASE_URL password: N character(s)`:** Render's generated password is
  shorter than 16. That's unexpected; report it.
- **`Pending database migrations`:** the pre-deploy didn't run. Confirm the web plan is paid.

**Status:** UNTESTED — awaiting developer

## 5. Proxy hops: observe, then set `TRUST_PROXY`

Render's proxy hop count isn't documented. The rate limiters key on `req.ip`, so a wrong count either
puts every player in one bucket, or lets a caller choose their own address.

**Do:**
1. Under the service's **Environment**, add `DEBUG_PROXY_HOPS` = `1` and save. Saving redeploys. The boot
   log then says `/api/debug/ip is enabled`.
2. From your own machine, **without** any `X-Forwarded-For`, run:
   ```bash
   curl -sS https://<svc>.onrender.com/api/debug/ip
   curl -sS https://api.ipify.org; echo
   ```
   The probe answers `{"ip":…,"ips":[…],"xffHops":N}`. It echoes only your own request, and logs
   nothing.
3. If **N** is 1, leave `TRUST_PROXY` alone. Otherwise, **don't edit it in the dashboard** (the next
   Blueprint sync would put 1 back; see the warning under "Before you start"). Tell the agent N; it
   changes `TRUST_PROXY` in `render.yaml` to `"N"`, and you merge that to `main`. The Blueprint sync
   applies it and redeploys. Wait for that deploy to go live, and confirm the Environment tab now shows
   `TRUST_PROXY` = N. `DEBUG_PROXY_HOPS` isn't in `render.yaml`, so it survives the sync and the probe
   stays on.
4. Still with the flag on, try to spoof:
   ```bash
   curl -sS -H 'X-Forwarded-For: 203.0.113.9' https://<svc>.onrender.com/api/debug/ip
   ```
   `ip` must still be **your** address (the ipify one), never `203.0.113.9`.
5. **Delete** `DEBUG_PROXY_HOPS` and save.

**Check:** Paste the three outputs, with your IP replaced by `<me>`. The agent confirms:
- `xffHops` equals `TRUST_PROXY` in `render.yaml` on `main` (`git show origin/main:render.yaml`), and
  you've confirmed the Environment tab shows the same value after the sync;
- the spoofed request (sent after that deploy went live) still reports `<me>`.

Then it runs `scripts/verify-hosted.sh https://<svc>.onrender.com`. Check 7 must pass
(`/api/debug/ip` → 401: the probe is gone). The agent records everything in
`evidence/proxy-hops-live.txt`.

**Status:** UNTESTED — awaiting developer

## 6. Resend: the sender

**Do (now, developer-only testing):**
1. Create a Resend account, then an **API key** with sending access. That key is `RESEND_API_KEY`.
2. Keep `EMAIL_FROM=Soulbound <onboarding@resend.dev>`. Resend's shared test sender **delivers only to the
   email address your Resend account uses**, so do step 9's magic-link sign-in with that address. A
   magic link to any other address is refused by Resend. The player still sees "check your email", and
   the log shows only `Resend responded 403`.

**Do (before Phase 9 invites anyone else):**
1. In Resend, open **Domains → Add domain**, and use a subdomain you own (Resend recommends a subdomain,
   e.g. `mail.<yourdomain>`).
2. Add **every** DNS record Resend lists at your DNS host, and wait for the domain to show **Verified**.
3. Set `EMAIL_FROM=Soulbound <noreply@mail.<yourdomain>>` on Render, and save (this redeploys).

**Check:**
- **Now:** step 9's magic-link email arrives, and Resend's **Emails** log shows it delivered. Screenshot
  that log row, with the address blurred, as `evidence/resend-delivered.png`.
- **Later:** a screenshot of the domain page showing **Verified**, as `evidence/resend-domain.png`.

**Status:** UNTESTED — awaiting developer

## 7. Google OAuth app

**Do:**
1. In Google Cloud Console, create or pick a project. Open **APIs & Services → OAuth consent screen**:
   - user type **External**;
   - publishing status **Testing**, with your own Google address as a test user;
   - scopes `openid`, `email`, `profile`.
2. Open **Credentials → Create credentials → OAuth client ID → Web application**:
   - **Authorized JavaScript origins:** `https://<svc>.onrender.com`
   - **Authorized redirect URIs:** `https://<svc>.onrender.com/api/auth/callback/google`
3. On Render, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and save.

The redirect URI must match exactly: https, no trailing slash, `/api/auth/callback/google`.

**Check:** Step 9's Google sign-in completes, and the account count shows `account:google 1`.
- **Before** step 9, the agent confirms the provider is live, with an Origin header and no cookie:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'Origin: https://<svc>.onrender.com' \
    -H 'Content-Type: application/json' --data '{"provider":"google"}' \
    https://<svc>.onrender.com/api/auth/sign-in/social
  ```
  Passing: 200, with a JSON body holding `url` (the provider's consent page; the agent doesn't follow
  it). A **404** means the provider isn't configured. Better Auth answers `PROVIDER_NOT_FOUND`, or the
  app answers its own 404 when no provider is configured at all. This was probed locally with Google
  configured and Discord not: 200 and 404.
- The **OAuth callback is untested until this step**: no automated test reaches Google.

**Status:** UNTESTED — awaiting developer

## 8. Discord OAuth app

**Do:**
1. In the Discord Developer Portal, create **New Application → OAuth2**.
2. Under **Redirects**, add `https://<svc>.onrender.com/api/auth/callback/discord`.
3. Copy the **Client ID**, and **Reset Secret** to get the client secret.
4. On Render, set `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`, and save.

Discord is **never a trusted provider** for account linking (`trustedProviders` is `['google']`). A
Discord sign-in joins an existing account only when Discord reports that email as **verified**, and
Better Auth refuses a Discord account with no email. So verify your email in Discord first, and use the
same address as your other sign-ins.

**Check:**
- The same curl as step 7, with `"provider":"discord"`: passing is 200.
- Then step 9's Discord sign-in completes, and the count shows `account:discord 1`.
- The Discord callback is untested until then.

**Status:** UNTESTED — awaiting developer

## 9. Your own invite, three sign-ins, and the session check

**Do:**
1. On Render, open the service's **Shell** tab and run:
   ```bash
   cd /app && node backend/dist/scripts/createInvite.js --days 7
   ```
   It prints the invite link `https://<svc>.onrender.com/#invite=…` **once**; only its hash is stored.
   Don't paste it anywhere but your browser.
2. Open the link, and **sign in with the magic link**, using your Resend account's address (step 6).
   That creates your account and uses up the invite.
   - A refused sign-up (say, the link opened in another browser) **uses up that magic link**. Use
     "Send me a new link".
3. **Sign out** (the Account button). Then **sign in with Google**, using the same address.
4. **Sign out**. Then **sign in with Discord**, using the same, verified address.
5. Still signed in, open devtools → **Application → Cookies → https://<svc>.onrender.com**. Screenshot
   the `__Secure-better-auth.session_token` row, with the Secure, HttpOnly and SameSite columns showing
   and the **value blurred**, as `evidence/session-cookie-devtools.png`.
6. On **your own machine**, copy that cookie's value, and run:
   ```bash
   read -rs SB_SESSION_COOKIE && export SB_SESSION_COOKIE   # paste, then Enter; nothing echoes
   scripts/verify-hosted.sh https://<svc>.onrender.com --session
   unset SB_SESSION_COOKIE
   ```
   The cookie reaches curl on stdin, never on its command line. Paste the script's output: it contains
   no cookie.
7. **Sign out** in the browser. That revokes the session you just used.
8. Back in the Render Shell, count the rows. This prints counts only, never an email or an id:
   ```bash
   cd /app && node -e 'const {Client}=require("pg");const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.query(`select $$users$$ k, count(*)::int n from "user" union all select $$invites_used$$, count(*)::int from invites where used_at is not null union all select $$account:$$||"providerId", count(*)::int from account group by "providerId" order by 1`)).then(r=>{for(const x of r.rows)console.log(x.k,x.n);return c.end()}).catch(e=>{console.error("count failed:",e.code||e.name);process.exit(1)})'
   ```

**Check:**
- **The screenshot** shows Secure ✓, HttpOnly ✓ and SameSite `Lax`.
- **`--session`** prints `8/8 passed`: check 8 is `/api/access` 204 with `Soulbound-Mode: hosted`.
- **The count** prints `account:discord 1`, `account:google 1`, `invites_used 1` and `users 1`. There
  are **two** account rows, not three. Better Auth creates no `account` row for a magic-link sign-up,
  only the `user` (`better-auth/dist/plugins/magic-link/index.mjs:161-168`). So the magic-link sign-in
  shows up as `users 1` plus `invites_used 1`. With **different** addresses per method, you'd see
  more users, and each new address needs its own invite.

The agent records all of this in `evidence/signin-live.txt`.

**Status:** UNTESTED — awaiting developer

## 10. Sentry: the error tracker, and a canary

**Do:**
1. Create a Sentry project (platform **Node.js**). Copy its **DSN**: Settings → Client Keys.
2. On Render, set `SENTRY_DSN`, and save. The tracker runs only in hosted mode with a DSN.
3. In the Render **Shell**, run:
   ```bash
   cd /app && node backend/dist/scripts/trackerTest.js
   ```
   It sends one canary error stuffed with fake secret-shaped values: a key, the auth secret, a DB URL,
   a session cookie, an invite code, an email and player text.
4. Open the event in Sentry. Screenshot the whole event page as `evidence/sentry-canary.png`.

**Check:**
- **The script** prints `Canary event <id> left the send queue`. **That line alone is not proof of
  delivery:** `flush()` returning true means only that the queue drained, and a network failure drains
  it too. The dashboard is the only confirmation.
- **The screenshot** shows the event, with only:
  - the type `Error`;
  - stack frames;
  - the tags `code=INTERNAL_ERROR`, `route=tracker:test` and `mode=hosted`.

  None of the canary values may appear (`FAKE-canary…`, `canary.player@example.invalid`,
  `slime king`), and there's no server name, request or user.
- The SDK is configured with `dataCollection` and every field off. Sentry 11 has no `sendDefaultPii`.
  The event is rebuilt from an allow-list before it's sent.

**Status:** UNTESTED — awaiting developer

## 11. UptimeRobot on `/api/health`

**Do:** Create an **HTTP(s)** monitor:
- URL: `https://<svc>.onrender.com/api/health`;
- interval: **5 minutes**;
- an alert contact: your email.

The route is unauthenticated and never rate-limited, so the monitor doesn't count against players.
Screenshot the monitor page, showing it Up, as `evidence/uptimerobot.png`.

**Check:** The screenshot shows the exact URL, a 5-minute interval, an alert contact and status Up. The
agent confirms the URL is the health path and not `/`. `/` would pass even when the API is down.

**Status:** UNTESTED — awaiting developer

## 12. Anthropic Console spend limit

**Do:**
1. In the Anthropic Console, open the workspace whose key is `ANTHROPIC_API_KEY` on Render.
2. Set a **monthly spend limit** under that workspace's limits. It's the last of the three spend layers
   in the hosted design. The per-player allowance and the app-wide daily cap come in later phases.
3. Screenshot the limit as `evidence/console-spend-limit.png`, with the key itself not shown.

**Check:** The screenshot shows a spend limit set on the workspace that holds the Render key (spec
R25c). The agent records the limit amount in the evidence notes.

**Status:** UNTESTED — awaiting developer

## 13. After the repo move: re-link and redeploy

The repository is due to move to a personal GitHub account. `render.yaml` names no repo, so the
Blueprint defaults to the repo it came from.

**Do (only once the move has happened):**
1. In Render, check that GitHub access covers the **new** repository: Account settings → GitHub.
2. Under the service's **Settings → Build & Deploy → Repository**, connect the new repository. Keep the
   `main` branch.
3. Do the same for the Blueprint itself, on its own page.
4. Trigger **Manual Deploy → Deploy latest commit**.

**Check:**
- The deploy's commit SHA, shown in **Events**, equals the new repo's `main` HEAD
  (`git ls-remote <new repo> main`).
- `scripts/verify-hosted.sh https://<svc>.onrender.com` prints `7/7 passed`.
- The agent records both in `evidence/repo-move-relink.txt`.

**Status:** UNTESTED — awaiting developer

## 14. Processor retention: what others keep, and for how long

Account deletion purges **our** tables after 7 days: `user`, `session`, `account`, `verification`,
`account_deletions`, and it nulls `invites.used_by`. Copies held by the services below follow **their**
retention, not ours. Figures are from each provider's documentation on 2026-09-24. Confirm them against
your plan when you do this step.

| Where | What it can hold | Retention | Source |
|---|---|---|---|
| Resend | each sent email: recipient address, subject, and the magic-link email (whose link has already expired) | 30 days on Free (the pricing page lists "30-day data retention") | https://resend.com/pricing |
| Sentry | the rebuilt error events: type, frames, code, route and mode. **No** email, message or request | Developer (free) plan 30 days, paid plans 90 days | https://docs.sentry.io/security-legal-pii/security/data-retention-periods |
| Render logs (service and Postgres) | our log lines carry no email, but **the Postgres server's own statement-error log can**. A failed insert into `"user"` logs `DETAIL: Failing row contains (…, <email>, …)` (seen in CI, 06-03) | by workspace plan: Hobby 7 days, Pro 14, Scale/Enterprise 30 | https://render.com/docs/logging |
| Render Postgres backups | a purged account is still in backups until they age out | point-in-time recovery: Hobby 3 days, Pro+ 7 days; logical exports 7 days | https://render.com/docs/postgresql-backups |

**Do:**
1. Confirm your Resend and Sentry plans and your Render workspace plan, and the retention each shows.
2. Don't stream logs anywhere longer-lived without adding it to this table.

**Check:** Paste the three plan names. The agent adds the confirmed figures to
`evidence/processor-retention.txt`. The longest window after a deletion is then known: 7 days of grace,
then the longest of the rows above.

**Status:** UNTESTED — awaiting developer

---

## Operating notes (no action, but read once)

- **The purge only logs.** Hourly (and 30 s after each boot), the log shows
  `[purge] purged N account(s); invites reconciled: M marked, K orphan(s) removed`. A failure logs
  `[purge] failed (<SQLSTATE>)` and is **not** sent to Sentry. Search the logs for `[purge] failed`
  now and then, or set a Render log alert on it.
- **Harmless line:** `ERROR [Better Auth]: Invalid callbackURL` is Better Auth's own message-only log
  when a foreign callback is refused. It carries no user data.
- **Every error that reaches the error handler is reported to Sentry, 4xx included** (06-01, decision
  5). If the 4xx volume turns out noisy, filtering it is a later decision.
- **One instance.** `numInstances: 1` is deliberate: the per-email magic-link cap (3 per 15 minutes)
  lives in memory. The invite-to-email link bindings (review cycle 1) also live in memory, so a
  restart invalidates sign-in links that are still pending, and the player asks for a new one. The
  purge is safe with more instances (an advisory lock), but neither of those is shared.
- **Custom domain later.** After adding one, Render's health check sends the custom domain as `Host`.
  So before you add it, change `ALLOWED_HOSTS` **in `render.yaml`** from the `fromService` entry to a
  plain `value:` listing both hosts, merge to `main`, and let the Blueprint sync apply it (never in the
  dashboard; see the warning under "Before you start"). Then run
  `scripts/verify-hosted.sh https://<svc>.onrender.com`: check 1 (health 200) proves the onrender.com
  host is still allowed. Also update `BETTER_AUTH_URL`, `FRONTEND_ORIGIN` (both `sync: false`, so in the
  dashboard) and both OAuth redirect URIs.
- **Migrations are expand, then contract.** The pre-deploy runs `migrate.js` while the **old** version
  is still serving traffic, and a failed deploy leaves the old version running on the new schema. So a
  migration must never break the version before it: never drop or rename a column (or table) in the
  same deploy that stops using it. Add the new shape first, ship code that uses it, and drop the old
  shape in a later deploy.
- **Shutdown drain.** `maxShutdownDelaySeconds: 120` in `render.yaml` is tied to
  `SHUTDOWN_TIMEOUT_MS` (110 s) in `backend/src/server.ts`. Change them together, and keep the Render
  value above the drain.
- **Rotating `BETTER_AUTH_SECRET` signs everyone out** and voids every pending invite cookie.
- **`release.yml` is not part of this.** Render builds from the repository; nothing is published to
  GHCR.
