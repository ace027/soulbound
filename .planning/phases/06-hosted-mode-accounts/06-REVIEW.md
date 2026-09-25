# Phase 6: Hosted Mode & Accounts — Review Summary

## Result: PASSED (3 cycles)

- **Completed:** 2026-09-25
- **Panel (dynamic):** Security Engineer (auth, CSRF, invites, secrets), QA Verification Specialist
  (tests, mutations, frozen self-host, evidence), Infrastructure & DevOps Engineer (migrations, CI,
  Render, runbook)
- **Execution protocol:** read-only reviewers ran in parallel. The QA reviewer mutates code, so it
  ran alone, with every mutation restored by `cp` and checked by hash. One fixer ran at a time.
- **Scope note:** this review covers everything that can be verified without the developer's
  accounts. The live deploy checks (Render, Resend, Google, Discord, Sentry, UptimeRobot, the
  Console spend limit) remain **UNTESTED — awaiting developer**
  (`docs/runbooks/phase-6-hosted-setup.md`, 14 steps).

## Findings summary

| Cycle | Blockers | Warnings | Suggestions | Verdicts (Sec / QA / Infra) |
|---|---|---|---|---|
| 1 (a3406d3) | 0 | 10 | 16 | NEEDS WORK / NEEDS WORK / NEEDS WORK |
| 2 (743d87e) | 0 | 4 (QA, low) | 6 | PASS / NEEDS WORK / PASS |
| 3 (9356d36) | 0 | 0 | 3 (all applied or recorded) | PASS / PASS / PASS |

## Findings and fixes

| # | Sev | Finding | Fix | Cycle fixed |
|---|---|---|---|---|
| S1 | WARNING | The session gate used up Better Auth's daily refresh, so the 30-day cookie never actually rolled | The gate reads with `disableRefresh`; only the browser's `get-session` renews | 1 (`d05a186`) |
| S2 | WARNING | The per-invite send cap was keyed on the cookie nonce and reset on every redeem | Keyed on the invite id, plus a 30/h global ceiling and separate per-email maps | 1 |
| S3 | WARNING | Google as a trusted provider skipped `emailVerified`, so an account-takeover link was possible | Developer kept Google trusted; an `account.create.before` hook now requires the ID token's `email_verified: true` | 1 |
| S4 | WARNING | `verification` rows kept typed emails forever | The hourly purge deletes expired rows (injected clock, same transaction) | 1 |
| I1 | WARNING | A 10 s SIGTERM exit cut off turns in flight | 110 s drain, plus `maxShutdownDelaySeconds: 120` on Render | 1 |
| I2 | WARNING | Dashboard edits get reset by the Blueprint sync | Runbook warning box; variable changes go through `render.yaml` and `main` | 1 (`558f259`) |
| I3 | WARNING | `mutate-order.sh` could report PASS without proof, and ignored Ctrl-C | Unmutated baseline first, INT/TERM exits 130, attribution required | 1 (`9b62251`, `8dbcce2`) |
| Q1 | WARNING | No test for a failed sign-out | Test added | 1 (`d4a4940`) |
| Q2 | WARNING | The Codex account slot was guarded only by e2e, which CI didn't run | Unit test added; e2e job added to CI | 1 (`d4a4940`, `263e643`) |
| Q3 | WARNING | STATE frontend count was stale | Corrected | 1 (`743d87e`) |
| F1 | WARNING (low) | The Google check was untested on malformed input | 19 unit tests, plus hosted tests on the ID-token path | 2 (`3ceb9f5`) |
| F2 | WARNING (low) | The pool-size test passed by construction | Spy on the `pg.Pool` options, plus an override test | 2 |
| F3 | WARNING (low) | The binding-map-full path had no test | Test with `maxTrackedKeys: 1` | 2 |
| F4 | WARNING (low) | `mutate-order.sh` counted a file-level FAIL line as a caught mutation | Requires a named-test failure and a failed count above 0 | 2 |

**Suggestions applied:**
- invite bound to the address it was emailed to (closes invite theft via login CSRF);
- OAuth tokens encrypted and IP tracking off;
- ID tokens no longer stored;
- an invite-ceiling log line;
- pool connect timeout;
- exact `node-pg-migrate` pin;
- absolute `preDeployCommand`;
- CI hosted smoke plus e2e jobs;
- migration count derived in CI;
- shutdown drift guard test;
- "expand, then contract" rule;
- `.env.example` wording;
- spec acceptance rows (Revision History rows 22-23);
- ID-token tests assert our own refusal message.

**Recorded rather than fixed:**
- **Accepted risk until Phase 7:** saves live in `localStorage`, unscoped per account, so on a shared device the next player sees the previous player's saves.
- **Carried to Phase 7:** login CSRF into an attacker's *existing* account via the GET magic-link verify. This is now a ROADMAP Phase 7 success criterion.
- **Stale comment:** `backend/Dockerfile:100` still shows the relative migrate path. The file is frozen, and the path resolves to the same file.

## Final verification (cycle 3, QA, independently re-derived)

| Suite | Result |
|---|---|
| Self-host backend | 304 passed (187 pre-phase, unedited) |
| Frontend | 249 passed (190 pre-phase, unedited) |
| Hosted (real Postgres) | 182 passed, 0 skipped |
| E2E | 14 passed (also in CI) |
| `scripts/mutate-order.sh` | 3/3 caught |
| Image smoke | 7/7 |
| CI | green, run 36079718951 (build-and-test, smoke-image incl. hosted smoke, e2e) |

- **Self-host freeze:** `git diff 7c737a6 --diff-filter=M` on test files is empty, and `App.tsx` is identical to `7856b7d`.
- **Mutations:** cycle 1 had 20 reviewer mutations (the 3 real gaps were closed in cycle 2); cycle 3 had 11 of 11 caught.

## Reviewer verdicts (final)
- **Security Engineer: PASS.** The Google check reads the token before nulling it on every create path, the update path can't link a new identity, and the test JWKS stub is scoped to the tests.
- **Infrastructure & DevOps: PASS.** The derived migration count fails closed, the drift test is robust, `mutate-order.sh`'s regexes are correct, and CI is verified green.
- **QA Verification: PASS.** All cycle-2 findings are closed and confirmed by mutation, the counts match, the tree is clean, and nothing blocks completion.

## Post-review polish
Deferred. The code just passed three security-focused cycles, and a polish pass over auth and invite code would reopen what was verified. Run `/legion:polish` separately if wanted.
