#!/usr/bin/env bash
#
# scripts/mutate-order.sh
#
# Proves the hosted middleware order is pinned (spec "Hosted middleware
# order", Acceptance Checks → "Order pinned"; plan 06-04 task 3). Each
# mutation below edits backend/src/server.ts, runs the hosted suite, and
# EXPECTS IT TO FAIL. A mutation the suite survives is a gap in the tests.
#
#   a  `app.use('/api', express.json())` inserted immediately above the Better
#      Auth mount (step 10), so the auth handler meets an already-read body
#      (better-auth #3295: it hangs; the tests' 2 s request timeout catches it)
#   b  the Origin check (step 8) moved below the Better Auth mount
#   c  the session gate (step 11) deleted
#
# Safety (06-CONTEXT carry-forward: "mutations never destroy work"):
#  - refuses to run unless server.ts is committed and unchanged;
#  - backs server.ts up with `cp` and restores it with `cp`, never git;
#  - fails loudly if an edit did not apply (the file's sha256 must change),
#    and checks the restore by hash, after every mutation and on any exit.
#
# Needs TEST_DATABASE_URL (e.g. `export TEST_DATABASE_URL=$(scripts/test-db.sh)`).
# Prints PASS/FAIL per mutation. Exit 0 only if every mutation was caught.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$ROOT/backend/src/server.ts"
REL="backend/src/server.ts"

if [ -z "${TEST_DATABASE_URL:-}" ]; then
  echo "mutate-order: TEST_DATABASE_URL is required (export TEST_DATABASE_URL=\$(scripts/test-db.sh))" >&2
  exit 2
fi

cd "$ROOT"
if ! git diff --quiet HEAD -- "$REL" || [ -n "$(git status --porcelain -- "$REL")" ]; then
  echo "mutate-order: $REL has uncommitted changes; commit first (mutations restore from a cp backup)" >&2
  exit 2
fi

WORK="$(mktemp -d)"
BACKUP="$WORK/server.ts.orig"
cp "$TARGET" "$BACKUP"
ORIG_HASH="$(sha256sum "$BACKUP" | cut -d' ' -f1)"

restore() {
  cp "$BACKUP" "$TARGET"
  local now
  now="$(sha256sum "$TARGET" | cut -d' ' -f1)"
  if [ "$now" != "$ORIG_HASH" ]; then
    echo "mutate-order: RESTORE FAILED: $REL hash $now != $ORIG_HASH (backup kept at $BACKUP)" >&2
    exit 3
  fi
}
trap 'restore' EXIT INT TERM

# Applies one scripted edit. Python does exact-line matching and exits
# non-zero unless each anchor line occurs exactly once.
apply() {
  python3 - "$TARGET" "$1" <<'PY'
import sys
path, which = sys.argv[1], sys.argv[2]
src = open(path).read()
AUTH = "    app.all('/api/auth/*splat', hosted.withInviteContext, hosted.handler);\n"
ORIGIN = "    app.use('/api', originCheck(hosted.publicOrigin));\n"
GATE = "    app.use('/api', sessionGate(hosted));\n"
for anchor in (AUTH, ORIGIN, GATE):
    if src.count(anchor) != 1:
        sys.exit(f"anchor not found exactly once: {anchor.strip()}")
if which == "a":
    src = src.replace(AUTH, "    app.use('/api', express.json());\n" + AUTH)
elif which == "b":
    src = src.replace(ORIGIN, "").replace(AUTH, AUTH + ORIGIN)
elif which == "c":
    src = src.replace(GATE, "")
else:
    sys.exit(f"unknown mutation {which}")
open(path, "w").write(src)
PY
}

declare -A NAMES=(
  [a]="express.json above the Better Auth mount"
  [b]="Origin check moved below the Better Auth mount"
  [c]="session gate deleted"
)

survivors=0
for m in a b c; do
  if ! apply "$m"; then
    echo "FAIL  ($m) ${NAMES[$m]}: the edit did not apply"
    survivors=$((survivors + 1))
    restore
    continue
  fi
  if [ "$(sha256sum "$TARGET" | cut -d' ' -f1)" = "$ORIG_HASH" ]; then
    echo "FAIL  ($m) ${NAMES[$m]}: file unchanged after the edit"
    survivors=$((survivors + 1))
    restore
    continue
  fi
  LOG="$WORK/mutation-$m.log"
  start=$(date +%s)
  npm run test:hosted -w @soulbound/backend >"$LOG" 2>&1
  rc=$?
  secs=$(( $(date +%s) - start ))
  restore
  summary="$(grep -E '^ +Tests +[0-9]' "$LOG" | tail -1 | sed 's/^ *//')"
  timeouts="$(grep -c 'timed out after 2000 ms' "$LOG" || true)"
  if [ "$rc" -ne 0 ]; then
    echo "PASS  ($m) ${NAMES[$m]}: suite failed as required (rc=$rc, ${secs}s; ${summary:-no summary}; 2 s timeouts: $timeouts)"
  else
    echo "FAIL  ($m) ${NAMES[$m]}: the suite PASSED with the mutation in place (${summary:-no summary})"
    survivors=$((survivors + 1))
  fi
done

trap - EXIT INT TERM
restore
rm -rf "$WORK"

if [ -n "$(git status --porcelain -- "$REL")" ]; then
  echo "mutate-order: $REL differs from HEAD after restore" >&2
  exit 3
fi

if [ "$survivors" -ne 0 ]; then
  echo "mutate-order: $survivors mutation(s) survived"
  exit 1
fi
echo "mutate-order: all 3 mutations caught; $REL restored (sha256 $ORIG_HASH)"
