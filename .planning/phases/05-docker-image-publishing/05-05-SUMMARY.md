# 05-05 Summary — Image smoke test, CI job, release workflow

## Status: Complete

## Tasks

### Task 1 — `scripts/smoke-image.sh` + local evidence
Wrote `scripts/smoke-image.sh` (`set -uo pipefail`, no `-e`): starts the
image detached with the hardened flags (`--read-only --cap-drop ALL
--security-opt no-new-privileges`), a bogus `ANTHROPIC_API_KEY`, a
throwaway ≥12-char passphrase, `RATE_LIMIT_PER_MINUTE=3` and
`ALLOWED_HOSTS` for the picked port. Polls `/api/health` (30s timeout) as
a setup precondition — a setup failure exits immediately, but all 7 checks
run unconditionally once the container is healthy, with a `PASS`/`FAIL`
line per check and a final `N/7 passed` before exiting non-zero if N < 7.
The container is always removed via `trap`.

Worked out the rate-limit accounting rather than guessing: with
`RATE_LIMIT_PER_MINUTE=3`, checks 3 (`/api/access` no header), 4
(`/api/access` with header) and 5 (`/api/x` with header) are themselves
requests 1-3 against the limiter, exhausting the window. So the **first**
of the "four more `/api/access` calls" in check 6 is expected to trip the
429 — confirmed live (`tripped_attempt=1` in every run below).

**Verify:**
```
$ bash scripts/smoke-image.sh soulbound:05-04
[smoke] image=soulbound:05-04 host_port=51285 container=soulbound-smoke-14081
PASS: 1: GET /api/health returns 200 (got 200)
PASS: 2: GET / returns 200 text/html (got code=200 content-type='Content-Type: text/html; charset=utf-8')
PASS: 3: GET /api/access with no header returns 401 PASSPHRASE_REQUIRED (got 401, body={"error":{"message":"Passphrase required","code":"PASSPHRASE_REQUIRED"}})
PASS: 4: GET /api/access with the correct header returns 204 (got 204)
PASS: 5: GET /api/x with header returns 404 application/json (got code=404 content-type='Content-Type: application/json; charset=utf-8')
PASS: 6: request #1 of 4 extra /api/access calls returns 429 TOO_MANY_REQUESTS with a valid Retry-After (tripped=1 retry_after_ok=1)
PASS: 7: docker logs do not contain the passphrase
---
7/7 passed
$ echo $?
0
```

**Negative run** (protocol 4): built `7856b7d` (pre-gate, pre-static-serving)
in a worktree at `<scratchpad>/base`, then ran the same script against it:
```
$ git worktree add <scratchpad>/base 7856b7d
$ DOCKER_BUILDKIT=1 docker build --secret id=npm_ca,src=$NPM_CA_FILE \
    -f backend/Dockerfile -t soulbound:pre-gate-7856b7d .
$ bash scripts/smoke-image.sh soulbound:pre-gate-7856b7d
PASS: 1: GET /api/health returns 200 (got 200)
FAIL: 2: GET / returns 200 text/html (got code=404 content-type='Content-Type: application/json; charset=utf-8')
FAIL: 3: GET /api/access with no header returns 401 PASSPHRASE_REQUIRED (got 404, body={"error":{"message":"Not found","code":"NOT_FOUND"}})
FAIL: 4: GET /api/access with the correct header returns 204 (got 404)
PASS: 5: GET /api/x with header returns 404 application/json (got code=404 content-type='Content-Type: application/json; charset=utf-8')
FAIL: 6: request #0 of 4 extra /api/access calls returns 429 TOO_MANY_REQUESTS with a valid Retry-After (tripped=0 retry_after_ok=0)
PASS: 7: docker logs do not contain the passphrase
---
3/7 passed
$ echo $?
1
```
Check 3 (the passphrase check) itself shows FAIL, not merely an earlier
check stopping the run — the script ran all 7 unconditionally, as
required. Removed the worktree afterward (`git worktree remove
<scratchpad>/base --force`).

Both runs' full output committed to
`.planning/phases/05-docker-image-publishing/evidence/smoke-image-local.txt`
with the image ID and date.

`git ls-files -s scripts/smoke-image.sh` → `100755 1a54c6e8b0d3c38e7829c10f44501b8c7ce9a128 0`.

Committed at `a54ddeb`.

### Task 2 — `ci.yml` smoke job + `release.yml`
`ci.yml` gained a `smoke-image` job (`needs: build-and-test`): checkout,
`docker build -f backend/Dockerfile -t soulbound:ci .`, then
`scripts/smoke-image.sh soulbound:ci`. Comment states it needs no secrets.
The existing `build-and-test` job is untouched.

`release.yml` (new): `on: workflow_dispatch` only, no inputs;
`permissions: contents: read, packages: write`; `concurrency: release`.
Jobs `test` → `smoke` → `publish` (each `needs:` the previous). `publish`:
1. checkout
2. version-agreement check (`node -e`, reads all four `package.json`s,
   fails naming any mismatch)
3. derive `IMAGE` (lowercased owner) and `VERSION` into `$GITHUB_ENV`
4. `docker/setup-qemu-action@v3`, `docker/setup-buildx-action@v3`
5. `docker/login-action@v3` to `ghcr.io` with `github.actor` /
   `secrets.GITHUB_TOKEN`
6. existence check: `if out=$(docker buildx imagetools inspect
   "$IMAGE:$VERSION" 2>&1); then …exit 1; fi` (survives `bash -e` — the
   command runs inside the `if` condition, so its non-zero exit never hits
   `set -e` as a bare top-level failure), then match `$out` against
   `not found|manifest unknown|name unknown` (case-insensitive) to decide
   absent-and-proceed vs. anything-else-and-fail-closed
7. `docker/build-push-action@v6`, `platforms: linux/amd64,linux/arm64`,
   `file: backend/Dockerfile`, `push: true`, tags
   `${{ env.IMAGE }}:${{ env.VERSION }}` and `${{ env.IMAGE }}:latest`
   (never shell `$VAR` inside `with:`), OCI source/revision/version labels

**Verify:**
- Both files parse as valid YAML (`python3 -c "import yaml,sys;[yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/ci.yml .github/workflows/release.yml"` → no error).
- `grep -nE "^on:|push:|tags:" .github/workflows/release.yml`: the `on:`
  block (lines 10-11) has only `workflow_dispatch:`; the other `push:`/
  `tags:` matches are `docker/build-push-action`'s own `with:` inputs, not
  workflow triggers — confirmed by inspection.
- Version-agreement script, run locally: passes today (all four `0.0.1`);
  with `frontend/package.json` temporarily edited to `0.0.2`, fails and
  names the mismatch; restored, `git diff --exit-code` clean.
- Existence-check logic run under `bash -e` with a stubbed `docker`
  function, all four cases:

  | Stub behavior | Expected | Result |
  |---|---|---|
  | exit 0 | fail ("already published") | `::error::…already published…`, exit 1 |
  | exit 1, stderr `manifest unknown` | proceed | `…not yet published — proceeding`, exit 0 |
  | exit 1, stderr `denied` | fail closed | `::error::Unexpected response…`, exit 1 |
  | exit 1, empty stderr | fail closed | `::error::Unexpected response…`, exit 1 |

  All four matched the spec's Overwrite policy exactly.
- `actionlint` is **not available offline** in this sandbox — noted rather
  than skipped silently.

Committed at `af876ca`.

### Task 3 — push, verify CI, write this summary
Pushed `claude/legion-status-uxlaqo` (single attempt succeeded, no retry
needed). Commit: `af876ca`.

Polled GitHub Actions via the MCP tools (`actions_list` /
`get_job_logs`) for run `35820156942` on that exact SHA:
- `build-and-test`: **success** (backend 187 tests, frontend 184 tests,
  all green)
- `smoke-image`: **success** — image built, then
  `scripts/smoke-image.sh soulbound:ci` printed all 7 `PASS` lines and
  `7/7 passed`, matching the local run exactly (including
  `tripped_attempt=1` on the rate-limit check)

CI run URL: https://github.com/DeanItServices/soulbound/actions/runs/35820156942

No fix was needed — CI was green on the first push, so there is no
root-cause/fix/re-push cycle to report here.

## Files modified
- `scripts/smoke-image.sh` (new, `100755`)
- `.github/workflows/ci.yml` (added `smoke-image` job)
- `.github/workflows/release.yml` (new)
- `.planning/phases/05-docker-image-publishing/evidence/smoke-image-local.txt` (new)
- `.planning/phases/05-docker-image-publishing/05-05-SUMMARY.md` (this file)

## Local smoke result
7/7 PASS against `soulbound:05-04`; negative run against a
`7856b7d`-built image (worktree) shows 3/7, with checks 2, 3, 4 and 6
failing on their own merits (never merely because an earlier check
stopped the run). Full output in
`.planning/phases/05-docker-image-publishing/evidence/smoke-image-local.txt`.

## Negative-run result
3/7 (checks 1, 5, 7 pass; checks 2, 3, 4, 6 fail) — expected, since
`7856b7d` predates both the access gate (R17) and single-image static
serving (R20). Exit code 1.

## `bash -e` existence-check results
All four stubbed cases behaved as the spec's Overwrite policy specifies
(table above): exists → fail; genuinely absent → proceed; `denied` → fail
closed; empty stderr → fail closed. Verified with a `docker()` shell
function stub run under `bash -e -c`, matching Actions' default shell.

## Version-agreement script results
Passes today (all four `package.json` files at `0.0.1`). Fails, naming
the mismatch, when one version is edited; restored clean afterward.

## CI run URL and result
https://github.com/DeanItServices/soulbound/actions/runs/35820156942 for
commit `af876ca` — **both jobs green** (`build-and-test`: success,
`smoke-image`: success, 7/7 smoke checks passed).

## Explicit UNTESTED list
- **The GHCR push itself** (both tags, `{version}` and `latest`) — never
  runs until a real `workflow_dispatch`.
- **The arm64 build** — this sandbox can only build/run amd64; QEMU-backed
  arm64 emulation is exercised only by the real dispatch.
- **The existence check's response to a real GHCR request** — what GHCR
  actually returns for a brand-new package under `GITHUB_TOKEN` is
  unverified (the spec already calls this UNVERIFIED); the fail-closed
  design means the worst case is a failed first dispatch, never a silent
  overwrite.
- `actionlint` was not run (not available offline in this sandbox); YAML
  parse-validity was checked instead.
- `workflow_dispatch` itself cannot be exercised at all from this branch —
  it only appears once `release.yml` is on the default branch.

## First-dispatch procedure
After this branch merges to the default branch:
1. GitHub → Actions → **Release** workflow → **Run workflow** (on the
   default branch), **or** a session with the GitHub MCP calls
   `mcp__github__actions_run_trigger` with `method: "run_workflow"`,
   `workflow_id: "release.yml"`, `ref: "<default branch>"`.
2. Watch the `test` → `smoke` → `publish` jobs. `publish`'s "Refuse to
   overwrite an existing version" step should print
   `…not yet published — proceeding"` for a first release of `0.0.1` (the
   current version, unless a version bump lands first — 05-06 or a later
   commit is expected to bump to `0.1.0` per R22, and note that value is
   what the pending version bump will target).
3. On success, confirm at `ghcr.io/deanitservices/soulbound` that both
   `:{version}` and `:latest` exist for `linux/amd64` and `linux/arm64`
   (`docker buildx imagetools inspect ghcr.io/deanitservices/soulbound:{version}`).
4. Record the result (success, or the failure and its cause) in
   `STATE.md`.

## Recovery procedure (if the first dispatch fails at the existence check)
1. Read the raw stderr the "Refuse to overwrite an existing version" step
   printed — it is echoed verbatim before the job fails.
2. If it is a genuine "the tag is absent" response that the current
   pattern (`not found|manifest unknown|name unknown`) didn't match,
   widen the pattern in a **one-line PR** adding the exact string GHCR
   returned, get it reviewed, merge, and re-dispatch.
3. **Never add a bypass input** (e.g. a `force` dispatch input) to skip the
   check — that would remove the very property (can't silently overwrite
   a published version) this step exists to guarantee. The fail-closed
   design is deliberate: a failed dispatch is the acceptable cost of an
   unrecognized response; a silent overwrite is not.
4. If the failure is instead at build-push (e.g. an arm64/QEMU build
   failure), no tag was pushed (a single multi-platform push either
   succeeds for both platforms or pushes nothing) — fix the build issue
   and simply re-dispatch; no cleanup of a partial publish is needed.

## Decisions made
- Kept the smoke script's port-picking (`python3` binding an ephemeral
  socket) rather than a fixed port, matching this sandbox and CI both
  running possibly-concurrent jobs on shared runners.
- Reused the `soulbound:05-04` image already present in the local Docker
  daemon from the prior wave for the positive local run, rather than
  rebuilding, since 05-04-SUMMARY.md recorded that tag as available for
  reuse; this also served as an independent confirmation that the image
  built in the prior wave is still smoke-clean going into this wave.
- Wrote the release existence check exactly per the spec's `if
  out=$(…); then …; fi` idiom (spec, Key Decisions → Overwrite policy;
  Revision History #20) rather than any variant that captures output with
  a bare assignment, specifically because that survives `bash -e`.
- Duplicated the `test` and `smoke` steps in `release.yml` rather than
  trying to factor them into a reusable/called workflow — GitHub Actions'
  reusable-workflow mechanism adds indirection this project doesn't need
  yet, and the plan didn't ask for it.

## Issues / carry-forward notes for 05-06
- The version-bump to `0.1.0` (R22) has **not** happened yet as of this
  plan — all four `package.json` files are still `0.0.1` (confirmed by
  the version-agreement check passing at that value). 05-06 owns the bump;
  until it lands, a real `workflow_dispatch` would publish `0.0.1`, not
  `0.1.0`.
- `compose.selfhost.yml` does not exist yet (05-06's deliverable); nothing
  in this plan depends on it.
- The image tag built and smoke-tested in this session locally:
  `soulbound:05-04` (reused from the prior wave) and, in CI,
  `soulbound:ci` (built fresh in the `smoke-image` job). Neither was
  pushed anywhere.
- Docker daemon was started with `setsid nohup dockerd &`, `NPM_CA_FILE`
  exported, and stopped at the end of this session's work (`pkill -x
  dockerd containerd`); no `docker system prune` was run at any point.
- The worktree at `<scratchpad>/base` (used for the negative run) was
  removed with `git worktree remove --force` before this summary was
  written; `git worktree list` shows only the main tree afterward.

## Auto-remediated
- None. The smoke script, the CI job and the release workflow all worked
  as designed on their first real run (local and in CI); no
  self-introduced regression needed fixing during this plan.
