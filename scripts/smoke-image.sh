#!/usr/bin/env bash
#
# scripts/smoke-image.sh <image>
#
# Proves a built Soulbound backend image actually works, at the container
# boundary, with zero Anthropic spend: a bogus ANTHROPIC_API_KEY, a
# throwaway passphrase, and RATE_LIMIT_PER_MINUTE=3 so the limiter can be
# exercised in a handful of requests. Run the same way in CI (every push,
# `ci.yml`'s `smoke-image` job) and in `release.yml`'s `publish` job right
# before the multi-platform push — this file is the single definition of
# "the image works" that both share (spec: R21 deliverable table).
#
# `set -uo pipefail`, deliberately WITHOUT `-e`: every one of the 7 checks
# below must run even after an earlier one fails, so a single regression
# doesn't hide the rest. A *setup* failure (the container never starts, or
# never answers /api/health) is different — that exits immediately, because
# none of the 7 checks can mean anything without a running, healthy
# container.
#
# Exit code: 0 if all 7 checks pass, 1 otherwise (or on a setup failure).

set -uo pipefail

IMAGE="${1:?Usage: scripts/smoke-image.sh <image>}"

# ─── Setup ───────────────────────────────────────────────────────────────

# A free-ish ephemeral port. Not perfectly race-free, but good enough for a
# short-lived local/CI container — the same approach `docker run -P` style
# scripts commonly use without a full port-lock protocol.
pick_port() {
  python3 - <<'EOF'
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
EOF
}

HOST_PORT="$(pick_port)"
PASSPHRASE="smoke-$(date +%s)-$$-not-a-real-secret"
CONTAINER_NAME="soulbound-smoke-$$"
FAIL=0
PASS_COUNT=0

log() { echo "[smoke] $*"; }

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "image=$IMAGE host_port=$HOST_PORT container=$CONTAINER_NAME"

# Hardened flags mirror docker-compose.yml's production posture
# (read_only, cap_drop ALL, no-new-privileges) — this smoke run is what
# proves static serving (express.static, read-only) and the gate work under
# that exact posture, not a looser one.
docker run -d \
  --name "$CONTAINER_NAME" \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  -p "127.0.0.1:${HOST_PORT}:3001" \
  -e "ANTHROPIC_API_KEY=sk-ant-smoke-not-a-real-key" \
  -e "SOULBOUND_PASSPHRASE=${PASSPHRASE}" \
  -e "RATE_LIMIT_PER_MINUTE=3" \
  -e "ALLOWED_HOSTS=127.0.0.1:${HOST_PORT},localhost:${HOST_PORT}" \
  "$IMAGE" >/dev/null

if [ $? -ne 0 ]; then
  echo "[smoke] SETUP FAILURE: container failed to start" >&2
  exit 1
fi

BASE="http://127.0.0.1:${HOST_PORT}"

# Poll /api/health until it returns 200, or time out after 30s. This is a
# setup precondition, not one of the 7 checks: without it, none of the
# checks below can mean anything.
HEALTHY=0
for _ in $(seq 1 30); do
  code="$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "${BASE}/api/health" 2>/dev/null || true)"
  if [ "$code" = "200" ]; then
    HEALTHY=1
    break
  fi
  sleep 1
done

if [ "$HEALTHY" -ne 1 ]; then
  echo "[smoke] SETUP FAILURE: /api/health never returned 200 within 30s" >&2
  echo "[smoke] container logs:" >&2
  docker logs "$CONTAINER_NAME" >&2 2>&1 || true
  exit 1
fi

record() {
  # record <ok:0|1> <label>
  if [ "$1" -eq 0 ]; then
    echo "PASS: $2"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "FAIL: $2"
    FAIL=1
  fi
}

# ─── Check 1: health ────────────────────────────────────────────────────
code="$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "${BASE}/api/health")"
[ "$code" = "200" ]
record $? "1: GET /api/health returns 200 (got $code)"

# ─── Check 2: / returns 200 text/html ──────────────────────────────────
resp="$(curl -s --max-time 5 -D - -o /tmp/smoke-root-body.$$ "${BASE}/")"
code="$(printf '%s' "$resp" | head -1 | awk '{print $2}')"
ctype="$(printf '%s' "$resp" | tr -d '\r' | grep -i '^content-type:' | head -1)"
ok=1
if [ "$code" = "200" ] && printf '%s' "$ctype" | grep -qi 'text/html'; then
  ok=0
fi
record $ok "2: GET / returns 200 text/html (got code=$code content-type='$ctype')"
rm -f /tmp/smoke-root-body.$$

# ─── Check 3: /api/access without a header -> 401 PASSPHRASE_REQUIRED ──
# This is request #1 against the rate limiter (rateLimit runs before the
# gate, and before express.json, per the spec's middleware order).
body="$(curl -s --max-time 5 -o /tmp/smoke-c3-body.$$ -w '%{http_code}' "${BASE}/api/access")"
code="$body"
c3_body="$(cat /tmp/smoke-c3-body.$$)"
ok=1
if [ "$code" = "401" ] && printf '%s' "$c3_body" | grep -q '"code":"PASSPHRASE_REQUIRED"'; then
  ok=0
fi
record $ok "3: GET /api/access with no header returns 401 PASSPHRASE_REQUIRED (got $code, body=$c3_body)"
rm -f /tmp/smoke-c3-body.$$

# ─── Check 4: /api/access with the header -> 204 ───────────────────────
# Request #2 against the limiter.
code="$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${PASSPHRASE}" "${BASE}/api/access")"
[ "$code" = "204" ]
record $? "4: GET /api/access with the correct header returns 204 (got $code)"

# ─── Check 5: /api/x with the header -> 404 application/json ───────────
# Request #3 against the limiter — this exhausts RATE_LIMIT_PER_MINUTE=3.
resp="$(curl -s --max-time 5 -D - -o /tmp/smoke-c5-body.$$ -H "Authorization: Bearer ${PASSPHRASE}" "${BASE}/api/x")"
code="$(printf '%s' "$resp" | head -1 | awk '{print $2}')"
ctype="$(printf '%s' "$resp" | tr -d '\r' | grep -i '^content-type:' | head -1)"
ok=1
if [ "$code" = "404" ] && printf '%s' "$ctype" | grep -qi 'application/json'; then
  ok=0
fi
record $ok "5: GET /api/x with header returns 404 application/json (got code=$code content-type='$ctype')"
rm -f /tmp/smoke-c5-body.$$

# ─── Check 6: four more /api/access calls -> a 429 TOO_MANY_REQUESTS ───
# By this point 3 requests have already landed in the current window
# (checks 3, 4 and 5 above), exhausting RATE_LIMIT_PER_MINUTE=3. So the
# FIRST of these four additional calls (request #4 overall in the window)
# is expected to trip the limiter. We don't guess: we make all four calls
# and assert that at least one of them got 429 with the right code and a
# Retry-After header, recording exactly which attempt first tripped it.
tripped=0
tripped_attempt=0
retry_after_ok=0
for attempt in 1 2 3 4; do
  resp="$(curl -s --max-time 5 -D - -o /tmp/smoke-c6-body.$$ -H "Authorization: Bearer ${PASSPHRASE}" "${BASE}/api/access")"
  code="$(printf '%s' "$resp" | head -1 | awk '{print $2}')"
  body="$(cat /tmp/smoke-c6-body.$$)"
  retry_after="$(printf '%s' "$resp" | tr -d '\r' | grep -i '^retry-after:' | head -1 | sed 's/^[Rr]etry-[Aa]fter: *//')"
  if [ "$code" = "429" ] && printf '%s' "$body" | grep -q '"code":"TOO_MANY_REQUESTS"'; then
    if [ "$tripped" -eq 0 ]; then
      tripped=1
      tripped_attempt="$attempt"
      case "$retry_after" in
        ''|*[!0-9]*) retry_after_ok=0 ;;
        *) [ "$retry_after" -ge 1 ] && retry_after_ok=1 || retry_after_ok=0 ;;
      esac
    fi
  fi
  rm -f /tmp/smoke-c6-body.$$
done
ok=1
if [ "$tripped" -eq 1 ] && [ "$retry_after_ok" -eq 1 ]; then
  ok=0
fi
record $ok "6: request #${tripped_attempt:-?} of 4 extra /api/access calls returns 429 TOO_MANY_REQUESTS with a valid Retry-After (tripped=$tripped retry_after_ok=$retry_after_ok)"

# ─── Check 7: container logs never contain the passphrase ─────────────
logs="$(docker logs "$CONTAINER_NAME" 2>&1 || true)"
ok=1
if ! printf '%s' "$logs" | grep -qF "$PASSPHRASE"; then
  ok=0
fi
record $ok "7: docker logs do not contain the passphrase"

echo "---"
echo "${PASS_COUNT}/7 passed"

if [ "$PASS_COUNT" -lt 7 ] || [ "$FAIL" -ne 0 ]; then
  exit 1
fi
exit 0
