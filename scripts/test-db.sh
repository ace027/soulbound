#!/usr/bin/env bash
#
# scripts/test-db.sh [--stop]
#
# Starts a throwaway local PostgreSQL 16 cluster for the hosted test suite
# (`npm run test:hosted -w @soulbound/backend`) and prints its URL — and ONLY
# its URL — on stdout, so it can be captured directly:
#
#   URL=$(scripts/test-db.sh) && TEST_DATABASE_URL=$URL npm run test:hosted -w @soulbound/backend
#   scripts/test-db.sh --stop
#
# Idempotent: re-running it against a cluster that already exists and is
# already running just prints the URL again. The cluster lives in a scratch
# directory owned by the `postgres` system user (`initdb` refuses to run as
# root, and the agent sandbox runs as root — 06-CONTEXT fact 9), listens on
# 127.0.0.1:54329 only, and trusts local connections: it holds nothing but
# test schemas, and is never a deployment database. CI does not use this
# script; it gets a `postgres:16` service container instead (ci.yml).
#
# Every progress message goes to stderr, so stdout stays exactly one line.
#
# Environment (all optional):
#   PG_BIN               PostgreSQL binaries (default /usr/lib/postgresql/16/bin)
#   SOULBOUND_TEST_PGDIR scratch directory for the cluster (default /tmp/soulbound-test-db)

set -euo pipefail

PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
BASE_DIR="${SOULBOUND_TEST_PGDIR:-/tmp/soulbound-test-db}"
DATA_DIR="${BASE_DIR}/data"
LOG_FILE="${BASE_DIR}/postgres.log"
PORT=54329
DB_NAME=soulbound_test
PG_USER=postgres
URL="postgres://${PG_USER}@127.0.0.1:${PORT}/${DB_NAME}"

log() { echo "[test-db] $*" >&2; }

# Runs a command as the `postgres` system user. As root that goes through
# runuser; if this script is already running as `postgres`, directly.
as_pg() {
  if [ "$(id -u)" -eq 0 ]; then
    runuser -u "$PG_USER" -- "$@"
  elif [ "$(id -un)" = "$PG_USER" ]; then
    "$@"
  else
    echo "[test-db] must run as root or as the ${PG_USER} user" >&2
    exit 1
  fi
}

is_running() {
  [ -f "${DATA_DIR}/PG_VERSION" ] && as_pg "${PG_BIN}/pg_ctl" -D "$DATA_DIR" status >/dev/null 2>&1
}

# ─── --stop ──────────────────────────────────────────────────────────────

if [ "${1:-}" = "--stop" ]; then
  if is_running; then
    as_pg "${PG_BIN}/pg_ctl" -D "$DATA_DIR" -m fast -w stop >&2
    log "stopped"
  else
    log "not running"
  fi
  exit 0
fi

if [ $# -gt 0 ]; then
  echo "Usage: scripts/test-db.sh [--stop]" >&2
  exit 2
fi

# ─── Init (once) ─────────────────────────────────────────────────────────

if [ ! -f "${DATA_DIR}/PG_VERSION" ]; then
  log "initialising cluster in ${DATA_DIR}"
  mkdir -p "$BASE_DIR"
  chown "$PG_USER" "$BASE_DIR"
  chmod 700 "$BASE_DIR"
  as_pg "${PG_BIN}/initdb" -D "$DATA_DIR" -U "$PG_USER" --auth=trust \
    --encoding=UTF8 --no-instructions >&2
fi

# ─── Start (if stopped) ──────────────────────────────────────────────────

if ! is_running; then
  log "starting on 127.0.0.1:${PORT}"
  # The socket goes in the cluster's own directory, since the system default
  # (/var/run/postgresql) may not exist or be writable here.
  as_pg "${PG_BIN}/pg_ctl" -D "$DATA_DIR" -l "$LOG_FILE" -w -t 30 \
    -o "-c listen_addresses=127.0.0.1 -p ${PORT} -c unix_socket_directories=${BASE_DIR}" \
    start >&2
fi

# ─── Database (if missing) ───────────────────────────────────────────────

exists="$(as_pg "${PG_BIN}/psql" -h 127.0.0.1 -p "$PORT" -U "$PG_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'")"
if [ "$exists" != "1" ]; then
  log "creating database ${DB_NAME}"
  as_pg "${PG_BIN}/createdb" -h 127.0.0.1 -p "$PORT" -U "$PG_USER" "$DB_NAME" >&2
fi

echo "$URL"
