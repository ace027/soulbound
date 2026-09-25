# 06-06 SUMMARY: Frontend ModeGate, SignIn, AccountPanel

**Status:** Complete. Hosted players get a sign-in screen and an account menu. The self-host frontend renders
exactly what it did before, and `App.tsx`, `AccessGate.tsx` and `checkAccess()` are untouched.

## Commits
| Commit | What |
|---|---|
| `c9795ad` | API layer, auth client, `ModeGate` / `SignIn` / `AccountPanel`, `main.tsx`, the two new unit-test files |
| `be578c5` | `e2e/hosted.spec.ts`; `main.tsx` hashchange reload; AccountPanel moved top-right; SignIn focus fix; evidence screenshots |
| this commit | this SUMMARY |

## Files touched (all in `files_modified`, plus the evidence directory the plan names)
| File | Change |
|---|---|
| `frontend/src/lib/api.ts` | New `getAccessState()`, `redeemInvite()`, `deleteAccount()`, `onSignInRequired` / `emitSignInRequired`; one `SIGN_IN_REQUIRED` branch in `postJson`'s error path. `checkAccess` byte-identical (sha256 of the function equal at `7c737a6` and now) |
| `frontend/src/lib/authClient.ts` | New. Better Auth client, **dynamically imported** (self-host never downloads it); `signInWithEmail`, `signInWithProvider`, `signOut`, `refreshSession`, `getAuthClient`; `takeSignInParams()` (fragment invite + query error, stripped with `replaceState`) |
| `frontend/src/components/ModeGate.tsx` | New. Outside `AccessGate`; pending background; `signin` → `SignIn`; hosted → children + `AccountPanel`; self-host → `children` only. Rolling-session refresh; mid-game sign-in overlay |
| `frontend/src/components/SignIn.tsx` | New. Invite redeem (once), email/Google/Discord, check-email state, fixed messages for known codes only, "Send me a new link" |
| `frontend/src/components/AccountPanel.tsx` | New. Sign out; delete with inline arm → Confirm/Cancel |
| `frontend/src/main.tsx` | `takeSignInParams()` before render; hashchange reload for a pasted invite; `<ModeGate><AccessGate><App/></AccessGate></ModeGate>`; comment extended |
| `frontend/package.json`, `package-lock.json` | `"better-auth": "1.7.6"` (exact, same as `backend/package.json`); the lockfile gains only that one line (the package was already hoisted) |
| `frontend/src/lib/__tests__/hostedApi.test.ts` | New, 28 tests |
| `frontend/src/components/__tests__/modeGate.test.tsx` | New, 26 tests |
| `frontend/e2e/hosted.spec.ts` | New, 8 tests |
| `.planning/phases/06-hosted-mode-accounts/evidence/*.png` | 10 screenshots |

Better Auth import paths, confirmed in `node_modules/better-auth/package.json` `exports` (installed 1.7.6):
`./client` → `dist/client/index.mjs` (exports `createAuthClient`), `./client/plugins` →
`dist/client/plugins/index.mjs` (exports `magicLinkClient`). The vanilla client is used, not `better-auth/react`:
no hooks are needed. `vite build` puts it in separate lazy chunks (`client-*.js` 23.41 kB, `plugins-*.js`
25.44 kB, `url-*.js` 8.72 kB); the main chunk does not include it.

## Verification (runner output)
Unit, frontend: after task 1 `Tests  218 passed (218)`; after task 2 and at the end:
```
 Test Files  15 passed (15)
      Tests  244 passed (244)
```
244 = 190 existing (unedited) + 28 `hostedApi.test.ts` + 26 `modeGate.test.tsx`.

Root `npm run build` → exit 0, then `npm test`:
```
> @soulbound/backend@0.1.0 test
      Tests  284 passed (284)
> @soulbound/frontend@0.1.0 test
      Tests  244 passed (244)
```
Backend 284 is 06-05's number, unchanged (no backend file touched).

Hosted (`scripts/test-db.sh`, then `TEST_DATABASE_URL=… npm run test:hosted -w @soulbound/backend`):
```
      Tests  150 passed (150)
[assert-no-skips] OK: 150 tests, 0 skipped, 0 todo
```

E2E (`SOULBOUND_E2E_EVIDENCE=1 npm run test:e2e --workspace frontend`), final run: `14 passed (28.0s)`. That is
6 existing `smoke.spec.ts` + 8 new `hosted.spec.ts`:
1. invite link: SignIn shows, the code leaves the URL, and it is redeemed once
2. an invite pasted into an already-open tab is still stripped and redeemed
3. email submit shows the check-your-email text
4. once signed in: the game title and the account button; the session is refreshed
5. delete: inline confirm, DELETE exactly once, then back to sign-in
6. an invalid invite says so, and an error redirect never shows its raw text
7. screenshots and placement at 390px
8. screenshots and placement at 1280px

Every `/api/*` request in `hosted.spec.ts` goes through one route handler; an unstubbed method and path pair is
aborted and fails the test in `afterEach` (the no-paid-call guard, widened). The dev server runs StrictMode, so
"redeemed once" and "DELETE once" also hold under doubled mount effects.

Frozen checks:
- `git diff 7856b7d -- frontend/src/App.tsx | wc -c` → `0`
- `git diff c74b523 -- frontend/src/components/AccessGate.tsx | wc -c` → `0`
- `git diff --stat 7c737a6 -- '*.test.ts' '*.test.tsx'`: 17 files, insertions only; none existed at `7c737a6`
  (`git cat-file -e` per file printed nothing). `smoke.spec.ts` is unedited.

## Mutations
Run after committing; backed up and restored with `cp`; each file's sha256 differed after mutating and matched
after restoring. The set was re-run on the final code after the `be578c5` changes (AI-1).
| # | Mutation | Caught by |
|---|---|---|
| M1 | `takeSignInParams` no longer deletes `invite` from the fragment | 4 tests: 3 `takeSignInParams` tests + the real-URL StrictMode test |
| M2 | Unknown error code rendered as the message | "an unknown code is never rendered", "a prototype key is treated as unknown" |
| M3 | "Delete account" deletes on first tap (no arm) | "delete needs two clicks…", "Cancel disarms…", "a failed delete stays put…" |
| M4 | Session refresh also in self-host | "never refreshes the session" |
| M5 | `SIGN_IN_REQUIRED` branch in `postJson` disabled | "a 401 SIGN_IN_REQUIRED mid-game emits sign-in-required…" |
| M6 | `main.tsx` hashchange reload removed | e2e "an invite pasted into an already-open tab…" |
| M7 | `ModeGate` treats `signin` as ready (fails open) | 6+ tests (signin, invite, email tests) |

One note: in the first M4 run, "an email submit shows the check-your-email state" also failed once. It did not
reproduce: M4 alone fails only its target, and the clean file passed 5/5 runs. That test's `toHaveFocus`
assertion was put in `waitFor` in case of a timing race under load.

## Screenshots (`evidence/`, all viewed)
| File | What it shows |
|---|---|
| `signin-390.png` / `signin-1280.png` | SignIn after a valid invite: "Your invite is ready", labelled email field, the (disabled until typed) send button, Google, Discord. Same palette as `AccessGate` |
| `check-email-390.png` / `check-email-1280.png` | "Check your email", "open the link in this browser", "I've signed in — continue", "Use a different email" |
| `invite-error-390.png` / `invite-error-1280.png` | The invalid-invite message in red above the still-usable email form |
| `game-390.png` / `game-1280.png` | The simulation screen (seeded save) with the Account button. At 390 it sits just below the World/Codex tab bar, over the end of the first narration line; at 1280, top-right of the narration column |
| `account-armed-390.png` / `account-armed-1280.png` | The armed delete: the 7-day warning with Confirm / Cancel, opening downward over narration text |

Honest notes from viewing:
- The first capture caught the 0.7 s `fadeIn` mid-animation, which faded SignIn badly. Screenshots now use
  `animations: 'disabled'`. The first run also focused the email field on load (StrictMode ran a
  "skip first step" effect twice); fixed, and the final `signin-*` shots show no focus ring.
- **On a phone the Account button covers about 80 px of narration text** at the top-right of the log. There
  is no free corner (full-width tab bar on top, full-width action bar at the bottom), and `App.tsx` is frozen.
  The e2e asserts it overlaps no button, input or textarea at both widths. Bottom-left was tried first and
  the guard caught it covering the mobile textarea.
- Every page shows an 8 px frame from the body's default margin. That is the existing game's look (the
  smoke screenshots show it too), not this plan's.

## Decisions
- **`takeSignInParams` lives in `lib/authClient.ts`** and is called from `main.tsx` before `createRoot`. It
  returns `{ invite?, inviteMalformed?, error? }`. A malformed code is never kept or sent. A stray `?invite=` in
  the query is stripped but never used (06-03: links use the fragment). `error_description` is always
  stripped and never read.
- **hashchange reload** (found by e2e, not in the plan): an invite link opened in a tab already on the app
  changes only the fragment, so `main.tsx` would never see it and the code would stay in the bar.
- **Error codes → fixed text:** `INVITE_REQUIRED` (the cross-device message, plus "Send me a new link"),
  `INVALID_TOKEN` (link used or expired, plus "Send me a new link"), `INVITE_INVALID`, `EMAIL_REQUIRED`,
  `EMAIL_NOT_VERIFIED`. **Any other code shows one generic fixed line** ("Sign-in didn't complete. Please try
  again.") and never the code; the lookup uses `Object.hasOwn`, so `toString` etc. are unknown too. The
  cross-device copy is the frontend's own wording of the server's `INVITE_REQUIRED_MESSAGE`; the server text
  is never displayed.
- **Email send shows "sent" whenever the server answered**, and "Couldn't reach the server" only on a network
  failure (no HTTP status).
- **Rolling session:** `refreshSession()` (`client.getSession()`, i.e. `GET /api/auth/get-session`) once when
  hosted + signed in, then `setInterval` 12 h, cleared on unmount. Never in self-host (unit test + M4); signed
  out never calls it (e2e test 1).
- **Mid-game `SIGN_IN_REQUIRED`** shows SignIn as a fixed overlay (`role="dialog"`) over the still-mounted
  game, like `AccessGate`'s passphrase overlay. "I've signed in — continue" re-checks access, so a player who
  signs in from the emailed link in another tab can carry on. After sign-out or delete the game is unmounted.
- **`deleteAccount` 401 `SIGN_IN_REQUIRED`** also emits sign-in-required; after a 204 `ModeGate` goes
  straight to SignIn without another `/api/access` (unit test asserts 1 access call).
- **Self-host now makes two `GET /api/access` per load** (ModeGate + AccessGate; four in dev StrictMode), well
  under the 30/min limit. Recorded in the `main.tsx` comment.
- **The pending div is keyed** so React does not reuse its DOM node for the first child. Without that, the
  "no extra DOM" test found a stray `style=""` on the child.
- **CLAUDE.md #3:** SignIn has no flex scroll region. Full-screen is a normal block; the overlay is its own
  `overflow-y: auto` block. The fragments in ModeGate/SignIn are never containers. **#1:** no native dialogs;
  unit tests spy `confirm`/`alert`/`prompt` in every test's `afterEach`, and e2e fails on any `dialog` event.

## For 06-07
- Design-log entry items: the lazy auth-client chunk; the hashchange reload; the generic-message rule; the
  mobile placement tradeoff above; two access calls per self-host load.
- The OAuth buttons always show. If a provider isn't configured, the click fails and SignIn says "That
  sign-in option isn't available right now." Hiding unconfigured buttons would need a config endpoint; it
  is not built.
- The Better Auth client's own automatic behaviour (focus/online refetch of the session atom) is not
  triggered: nothing subscribes to its atoms. Only the explicit `refreshSession` calls `get-session`.

## CI
Run 130 on `be578c5` (the last code commit): https://github.com/DeanItServices/soulbound/actions/runs/36062010541
→ **success**.
- `build-and-test`: every step succeeded, including `Build (all workspaces)`, `Test` and `Test (hosted, real Postgres)`.
- `smoke-image`: `Build image` and `Smoke test image` both succeeded.
- The job log was not pulled, so no CI test count is quoted here; the step conclusions are. CI runs `npm test`, not
  the e2e suite (playwright.config.ts: e2e is not wired into CI), so the e2e counts above are local only.
- This SUMMARY commit's own run was not re-checked; it changes only this markdown file.
