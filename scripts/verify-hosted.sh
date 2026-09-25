#!/usr/bin/env bash
#
# scripts/verify-hosted.sh <url> [--session]
#
# Proves a running HOSTED Soulbound deployment is configured the way the tests
# pin it (spec R25a, Acceptance Checks "Live deploy" and "Live sign-in x3").
# <url> is the bare public origin, e.g. https://soulbound.onrender.com (the
# same value as BETTER_AUTH_URL). One line per check, PASS or FAIL; the exit
# code is non-zero if any check fails.
#
# It never prints a response body, a cookie, an email or an id: only status
# codes, header names/values the server sets for everyone, and error CODES
# matched inside the body.
#
# Without --session (anyone can run it; no credentials):
#   1. GET  /api/health                  -> 200
#   2. the same response carries X-Frame-Options: DENY,
#      Content-Security-Policy: frame-ancestors 'none', Referrer-Policy: no-referrer
#   3. GET  /                            -> 200 text/html (the built frontend)
#   4. POST /api/invites/redeem, foreign Origin      -> 403 ORIGIN_REJECTED
#   5. GET  /api/access, no cookie       -> 401 SIGN_IN_REQUIRED + Soulbound-Mode: hosted
#   6. POST /api/invites/redeem, own Origin, bad code -> 400 INVITE_INVALID
#   7. GET  /api/debug/ip, no cookie     -> 401 (the DEBUG_PROXY_HOPS probe is off)
#
# With --session, additionally (runbook step 9):
#   8. GET  /api/access with the session cookie -> 204 + Soulbound-Mode: hosted
# The cookie comes from the SB_SESSION_COOKIE environment variable (the value
# of __Secure-better-auth.session_token, copied from the browser's devtools,
# with or without the "name=" prefix). It reaches curl on stdin (--config -),
# never on its command line, so it doesn't show up in `ps`. Sign out in the
# browser afterwards: that revokes the session, and the pasted value with it.
#
# Not checked here (the script can't observe them):
#   - the session cookie's Secure; HttpOnly; SameSite=Lax flags: a devtools
#     screenshot in .planning/phases/06-hosted-mode-accounts/evidence/ attests
#     them (runbook step 9), and hosted/auth.test.ts pins them;
#   - the three account rows by provider: counted in the Render shell, where
#     DATABASE_URL lives and the database accepts connections (runbook step 9).

set -euo pipefail

usage() {
  echo "Usage: scripts/verify-hosted.sh <https://host> [--session]" >&2
  exit 2
}

[ $# -ge 1 ] || usage
URL="${1%/}"
SESSION=0
if [ $# -ge 2 ]; then
  [ "$2" = "--session" ] || usage
  SESSION=1
fi
[ $# -le 2 ] || usage

# A bare origin only: scheme, host, optional port. The Origin header this
# script sends as "own Origin" is exactly this string.
if ! [[ "$URL" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] && ! [[ "$URL" =~ ^https?://\[[0-9A-Fa-f:]+\](:[0-9]+)?$ ]]; then
  echo "verify-hosted: <url> must be a bare origin such as https://soulbound.onrender.com (got something else)" >&2
  exit 2
fi
ORIGIN="$URL"
FOREIGN_ORIGIN="https://verify-hosted.invalid"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAIL=0
PASSED=0
TOTAL=0

pass() { TOTAL=$((TOTAL + 1)); PASSED=$((PASSED + 1)); echo "PASS  $1"; }
fail() { TOTAL=$((TOTAL + 1)); FAIL=1; echo "FAIL  $1"; }

# request <name> <curl args...>: writes $WORK/<name>.status, .headers, .body.
# A network failure leaves status 000 rather than aborting the script.
request() {
  local name="$1"
  shift
  local status
  status="$(curl -sS --max-time 20 -o "$WORK/$name.body" -D "$WORK/$name.headers" -w '%{http_code}' "$@" 2>"$WORK/$name.err" || true)"
  [ -n "$status" ] || status="000"
  echo "$status" >"$WORK/$name.status"
}

status_of() { cat "$WORK/$1.status"; }

# header_value <name> <header>: the last value of that header, trimmed, lower-cased name match.
header_value() {
  awk -v h="$(echo "$2" | tr '[:upper:]' '[:lower:]')" '
    {
      line = $0; sub(/\r$/, "", line)
      i = index(line, ":")
      if (i > 0 && tolower(substr(line, 1, i - 1)) == h) { v = substr(line, i + 1); sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v); out = v }
    }
    END { print out }
  ' "$WORK/$1.headers"
}

# body_has_code <name> <CODE>: true when the JSON body carries "code":"<CODE>".
body_has_code() { grep -q "\"code\":\"$2\"" "$WORK/$1.body"; }

echo "[verify-hosted] target $URL"

# 1-2. Health, and the anti-framing headers on it (hosted order step 3 runs on every response).
request health "$URL/api/health"
s="$(status_of health)"
if [ "$s" = "200" ]; then pass "1 GET /api/health -> 200"; else fail "1 GET /api/health -> $s (expected 200; a 403 means ALLOWED_HOSTS lacks this host)"; fi
xfo="$(header_value health X-Frame-Options)"
csp="$(header_value health Content-Security-Policy)"
ref="$(header_value health Referrer-Policy)"
if [ "$xfo" = "DENY" ] && [[ "$csp" == *"frame-ancestors 'none'"* ]] && [ "$ref" = "no-referrer" ]; then
  pass "2 frame headers: X-Frame-Options DENY, frame-ancestors 'none', Referrer-Policy no-referrer"
else
  fail "2 frame headers: X-Frame-Options='${xfo}' CSP has frame-ancestors 'none'=$([[ "$csp" == *"frame-ancestors 'none'"* ]] && echo yes || echo no) Referrer-Policy='${ref}'"
fi

# 3. The built frontend is served same-origin.
request index "$URL/"
s="$(status_of index)"
ct="$(header_value index Content-Type)"
if [ "$s" = "200" ] && [[ "$ct" == text/html* ]]; then pass "3 GET / -> 200 text/html"; else fail "3 GET / -> $s ${ct:-no content-type} (expected 200 text/html)"; fi

# 4. A state-changing request from a foreign Origin is refused before any route (step 8).
request foreign -X POST -H "Origin: $FOREIGN_ORIGIN" -H 'Content-Type: application/json' --data '{"code":"AAAAAAAAAAAAAAAAAAAAAA"}' "$URL/api/invites/redeem"
s="$(status_of foreign)"
if [ "$s" = "403" ] && body_has_code foreign ORIGIN_REJECTED; then pass "4 POST /api/invites/redeem, foreign Origin -> 403 ORIGIN_REJECTED"; else fail "4 POST /api/invites/redeem, foreign Origin -> $s (expected 403 ORIGIN_REJECTED)"; fi

# 5. No session: 401 SIGN_IN_REQUIRED, with the mode header the frontend reads.
request access "$URL/api/access"
s="$(status_of access)"
mode="$(header_value access Soulbound-Mode)"
if [ "$s" = "401" ] && body_has_code access SIGN_IN_REQUIRED && [ "$mode" = "hosted" ]; then
  pass "5 GET /api/access, no cookie -> 401 SIGN_IN_REQUIRED, Soulbound-Mode: hosted"
else
  fail "5 GET /api/access, no cookie -> $s, SIGN_IN_REQUIRED=$(body_has_code access SIGN_IN_REQUIRED && echo yes || echo no), Soulbound-Mode='${mode}' (expected 401, yes, hosted)"
fi

# 6. Own Origin, well-formed but unknown code: the one INVITE_INVALID answer (step 9).
request redeem -X POST -H "Origin: $ORIGIN" -H 'Content-Type: application/json' --data '{"code":"AAAAAAAAAAAAAAAAAAAAAA"}' "$URL/api/invites/redeem"
s="$(status_of redeem)"
if [ "$s" = "400" ] && body_has_code redeem INVITE_INVALID; then pass "6 POST /api/invites/redeem, own Origin, bad code -> 400 INVITE_INVALID"; else fail "6 POST /api/invites/redeem, own Origin, bad code -> $s (expected 400 INVITE_INVALID; 403 means BETTER_AUTH_URL differs from <url>)"; fi

# 7. The proxy-hop probe is off (DEBUG_PROXY_HOPS unset): the path sits behind the session gate.
request debugip "$URL/api/debug/ip"
s="$(status_of debugip)"
if [ "$s" = "401" ]; then pass "7 GET /api/debug/ip, no cookie -> 401 (DEBUG_PROXY_HOPS is off)"; else fail "7 GET /api/debug/ip -> $s (expected 401; 200 means DEBUG_PROXY_HOPS=1 is still set)"; fi

if [ "$SESSION" = "1" ]; then
  raw="${SB_SESSION_COOKIE:-}"
  unset SB_SESSION_COOKIE
  raw="${raw#__Secure-better-auth.session_token=}"
  if [ -z "$raw" ]; then
    fail "8 --session: SB_SESSION_COOKIE is not set"
  elif ! [[ "$raw" =~ ^[A-Za-z0-9._~%+/=-]+$ ]]; then
    fail "8 --session: SB_SESSION_COOKIE has characters a session token never has (not shown)"
  else
    # The cookie goes to curl on stdin as a config file, never on argv.
    status="$(printf 'header = "Cookie: __Secure-better-auth.session_token=%s"\n' "$raw" \
      | curl -sS --max-time 20 --config - -o "$WORK/session.body" -D "$WORK/session.headers" -w '%{http_code}' "$URL/api/access" 2>"$WORK/session.err" || true)"
    [ -n "$status" ] || status="000"
    echo "$status" >"$WORK/session.status"
    mode="$(header_value session Soulbound-Mode)"
    if [ "$status" = "204" ] && [ "$mode" = "hosted" ]; then
      pass "8 GET /api/access with the session cookie -> 204, Soulbound-Mode: hosted"
    else
      fail "8 GET /api/access with the session cookie -> $status, Soulbound-Mode='${mode}' (expected 204, hosted)"
    fi
  fi
  raw=""
  echo "NOTE  cookie flags (Secure; HttpOnly; SameSite=Lax): attested by the devtools screenshot, not by this script"
  echo "NOTE  account rows by provider: counted in the Render shell (runbook step 9)"
  echo "NOTE  sign out in the browser now: it revokes the session you pasted"
fi

echo "[verify-hosted] $PASSED/$TOTAL passed"
[ "$FAIL" -eq 0 ]
