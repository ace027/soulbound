# Phase 5: Docker Image Publishing — Review Summary

## Result: PASSED

- **Cycles used:** 3 of 3 (cycle 3 passed with no blockers or warnings)
- **Mode:** a dynamic 3-reviewer panel, read-only, run in parallel. Mutations ran only in throwaway
  worktrees, never in the shared tree (the Phase 3 lesson).
- **Reviewers:** Security Engineer, QA Verification Specialist, Infrastructure & DevOps Engineer
- **Completed:** 2026-09-23

## Findings summary

| | Found | Resolved |
|---|---|---|
| Blockers | 1 | 1 |
| Warnings | 7 (6 in cycle 1, 1 in cycle 2) | 7 |
| Suggestions | 22 across 3 cycles | 17 applied, 5 recorded below as not taken |

## Verdicts by cycle

| Cycle | Security | QA | Infrastructure |
|---|---|---|---|
| 1 | NEEDS WORK | NEEDS WORK | NEEDS WORK (1 blocker) |
| 2 | PASS | PASS | NEEDS WORK (1 warning) |
| 3 | **PASS** | **PASS** | **PASS** |

## Blocker and warnings

| # | Sev | File | Issue | Fix | Cycle fixed |
|---|---|---|---|---|---|
| 1 | BLOCKER | `compose.selfhost.yml` | The in-container healthcheck sends `Host: localhost:3001`, but `ALLOWED_HOSTS` was derived only from `SOULBOUND_PORT`. On any non-default port the container stayed unhealthy forever. The orchestrator's port-3999 evidence curled from the host and never read `.State.Health`, which is how this slipped past the build. | `localhost:3001` is always in the default allow-list. Proved before and after on :3999: `unhealthy` (403) → `healthy` at 11 s (`8e382e0`) | 1 |
| 2 | WARNING | `release.yml` | `packages: write` applied to every job, including `npm ci` install scripts, and `checkout` persisted the token | Workflow default `contents: read`; `packages: write` on `publish` only; `persist-credentials: false` everywhere (`823d5d8`) | 1 |
| 3 | WARNING | `release.yml` | Could publish from any branch and move `:latest` (the self-host default) | `publish` runs only when `github.ref == 'refs/heads/main'` (`823d5d8`) | 1 |
| 4 | WARNING | `release.yml` | The pushed image wasn't the smoke-tested one (a separate rebuild), and arm64 is never run | One amd64 `load: true` build is smoke-tested, then pushed from the `gha` cache (`823d5d8`) | 1, completed in 2 |
| 5 | WARNING | `release.yml` / README | No runbook if the first dispatch fails closed | README "First release" subsection (`f67193d`) | 1 |
| 6 | WARNING | README | Implied the image already existed on GHCR | Unpublished-image note plus a local-build fallback; arm64 marked as never run (`f67193d`) | 1 |
| 7 | WARNING | spec, SUMMARY files | A required spec mutation row was recorded as a survivor | The length-mismatch variant is re-run and caught (4 tests); wording corrected to "closest mutation-testable reading" (`3f64eb3`, `40f638d`) | 1, wording in 2 |
| 8 | WARNING | `release.yml` | The "byte-identical" claim wasn't enforced: the push added labels, and a failed cache import rebuilt silently | Matching labels, plus a post-push amd64 layer diff-ID check that fails closed; the overclaim removed (`fdb1306`) | 2 |

## Suggestions applied
**Cycle 1:**
- AccessGate rejects non-ASCII passphrases and recovers from an unreachable server (`96fa1d1`).
- A real e2e submit, and a test for the "wrong passphrase" message (`365b14f`, `96fa1d1`).
- `curl --max-time` and job `timeout-minutes` values.
- An accurate Dockerfile QEMU comment.
- The `.env.example` pass-through note (`52a500e`).

**Cycle 2:**
- `github.ref` routed through `env:` (removes the script-injection pattern), and `cache-to` on the push (`fdb1306`).
- The README gives the right cause for the 403 (`585330c`).
- A rejected passphrase is cleared, and a stored value that can't be sent is dropped (`efb4829`, each mutation-verified).
- Summary wording corrections (`40f638d`).

**Cycle 3:**
- The release remedy no longer says "re-dispatch", which the overwrite guard blocks; it now says to retag `:latest` and bump the version.
- The config search matches only dicts with `rootfs`, so a label named `architecture` can't fail a good push.
- README 403 wording is per host name.
- A storage-throw test (`3c50def`).

The extracted verify step was run under `bash -e` against six stubbed outputs. Both matches passed. The mismatch, `null` and missing-layers cases failed closed. The label case passed.

## Not taken, for the developer to decide
| Item | Why not taken | Reviewer view |
|---|---|---|
| **Anti-framing header** (`X-Frame-Options: DENY` / `frame-ancestors`) | Not taken this phase; a CSP is listed out of scope in `PROJECT.md`. | Security: raise separately, low priority. One header is cheap and doesn't conflict with "no CSP". Browser storage partitioning limits the damage. |
| Full CSP / other security headers | Out of scope (`PROJECT.md`) | — |
| SHA-pinning the `docker/*` actions | Accepted residual risk: a compromised major tag on `login-action` could push to `:latest`. Pinning plus Dependabot makes it cheap later. | Security: agreed to defer |
| npm cache layer in the `api` stage | Image-size nicety | Infra: suggestion only |
| Pinning `builder` to `$BUILDPLATFORM` (faster arm64) | Performance only; arm64 build viability confirmed from the lockfile | Infra: suggestion only |

## Verified at review close
- Tests: backend **187/187**, frontend **190/190**, e2e **6/6** (the gate test also repeated 15 times, 15/15 passes).
- `git diff --exit-code 7856b7d -- frontend/src/App.tsx`: byte-identical.
- The QA reviewer independently re-derived every headline count in all 3 cycles, and all matched.
- Mutations: the phase-close sweep plus 17 reviewer spot-checks in worktrees, all caught except the
  documented behavioural equivalent (raw `===` in place of `timingSafeEqual`).

## Still UNTESTED (by design; can only run after merge)
- The GHCR push, the arm64 build, GHCR's real response to the existence check, and the
  post-push layer check against a real multi-platform index. Every one of these fails closed,
  so the worst case is a failed dispatch, never an unverified overwrite. Steps are in README →
  "First release".

## Incident recorded during review
While fixing cycle 1, a fix agent's `docker compose config` output printed the sandbox's real
`SOULBOUND_ANTHROPIC_KEY` into that agent's session transcript. It is in **no file or commit**:
an exact-match check over the tree, full history and the pushed branch found 0. The orchestrator's
own port-3999 runs had also passed the real key into local test containers, because shell variables
override `--env-file`. No Anthropic call was made, and the evidence note was corrected (`a010627`).
Rotating the key was recommended to the developer. Future local runs:
`env -u SOULBOUND_ANTHROPIC_KEY -u ANTHROPIC_API_KEY docker compose …`.

## Post-review polish
Not run. Every changed file has already been through three review cycles. A behaviour-neutral
polish pass over security-critical code (the gate, config, the release workflow) after the final
review would put unreviewed changes on exactly the paths the reviewers verified. It's offered to
the developer as an optional `/legion:polish` pass instead.
