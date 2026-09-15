#!/usr/bin/env bash
# PR1 Postgres verification: real postgres:16 behind PgBouncer in TRANSACTION pool mode (like Neon's
# pooler host), schema pushed on the direct port, then backend/tests/integration/pg.test.js against the
# PgBouncer port with the real Prisma client. No npm install; containers live on a private network with
# ports bound to 127.0.0.1 only. See docs/bot/pr1-postgres-verification.md.
#
# Usage: backend/scripts/pg-integration.sh [all|up|test|down]
#   all  (default) up + push schema + test passes + down (always, even on failure)
#   up   start containers and push the schema, leave them running
#   test run the test passes against running containers
#   down stop and remove containers and network
# Test passes (PG_PASSES, default "plain tz flag"):
#   plain  the production URL shape: PgBouncer port, sslmode only, no pgbouncer=true
#   tz     same, with the database TimeZone set to Asia/Amman (raw SQL must keep timestamps UTC)
#   flag   same as plain with &pgbouncer=true appended
# Env: PG_PORT (55432), BOUNCER_PORT (56432).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$(cd "$HERE/.." && pwd)"
NET=karambot-pgit
PG=karambot-pgit-postgres
BOUNCER=karambot-pgit-pgbouncer
PG_PORT="${PG_PORT:-55432}"
BOUNCER_PORT="${BOUNCER_PORT:-56432}"
PG_PASSWORD=pgit_local_only
DB=karambot_it
# Production DATABASE_URL carries only sslmode. Local containers have no TLS, so `prefer` keeps the same
# "sslmode only" shape without failing the handshake.
DIRECT_URL="postgresql://postgres:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/${DB}?sslmode=prefer"
POOLED_URL="postgresql://postgres:${PG_PASSWORD}@127.0.0.1:${BOUNCER_PORT}/${DB}?sslmode=prefer"

export PRISMA_HIDE_UPDATE_MESSAGE=1

if ! command -v node >/dev/null 2>&1 && [ -d /usr/local/nvm/versions/node/v24.20.0/bin ]; then
  export PATH="/usr/local/nvm/versions/node/v24.20.0/bin:$PATH"
fi

up() {
  docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
  docker rm -f "$PG" "$BOUNCER" >/dev/null 2>&1 || true
  docker run -d --name "$PG" --network "$NET" -p "127.0.0.1:${PG_PORT}:5432" \
    -e POSTGRES_PASSWORD="$PG_PASSWORD" -e POSTGRES_DB="$DB" \
    postgres:16 -c max_connections=100 >/dev/null
  for _ in $(seq 1 60); do
    docker exec "$PG" pg_isready -U postgres -d "$DB" >/dev/null 2>&1 && break
    sleep 1
  done
  # pg_isready turns true during the init restart; wait for a real query on the final server.
  for _ in $(seq 1 30); do
    docker exec "$PG" psql -U postgres -d "$DB" -tAc 'select 1' >/dev/null 2>&1 && break
    sleep 1
  done
  # Neon's pooler: transaction mode, protocol-level prepared statements tracked (max_prepared_statements),
  # a small server pool so client connections really share server connections.
  docker run -d --name "$BOUNCER" --network "$NET" -p "127.0.0.1:${BOUNCER_PORT}:5432" \
    -e DATABASE_URL="postgres://postgres:${PG_PASSWORD}@${PG}:5432/${DB}" \
    -e AUTH_TYPE=scram-sha-256 -e POOL_MODE=transaction -e MAX_PREPARED_STATEMENTS=1000 \
    -e DEFAULT_POOL_SIZE=4 -e MAX_CLIENT_CONN=200 \
    edoburu/pgbouncer:latest >/dev/null
  for _ in $(seq 1 30); do
    PGPASSWORD="$PG_PASSWORD" psql "postgresql://postgres@127.0.0.1:${BOUNCER_PORT}/${DB}" -tAc 'select 1' >/dev/null 2>&1 && break
    sleep 1
  done
  (cd "$BACKEND" && DATABASE_URL="$DIRECT_URL" npx prisma db push --skip-generate --accept-data-loss >/dev/null)
  echo "postgres  : $DIRECT_URL"
  echo "pgbouncer : $POOLED_URL"
}

run_tests() {
  local url="$1"
  echo "── pass ${2:-plain}: integration suite against ${url}"
  (cd "$BACKEND" && PG_INTEGRATION_URL="$url" npx jest tests/integration --runInBand --forceExit)
}

set_timezone() {
  # ALTER DATABASE applies to new server connections: restart PgBouncer so its pool reconnects.
  docker exec "$PG" psql -U postgres -d "$DB" -qc "ALTER DATABASE ${DB} $1" >/dev/null
  docker restart "$BOUNCER" >/dev/null
  for _ in $(seq 1 30); do
    PGPASSWORD="$PG_PASSWORD" psql "postgresql://postgres@127.0.0.1:${BOUNCER_PORT}/${DB}" -tAc 'select 1' >/dev/null 2>&1 && break
    sleep 1
  done
}

run_passes() {
  for pass in ${PG_PASSES:-plain tz flag}; do
    case "$pass" in
      plain) run_tests "$POOLED_URL" plain ;;
      tz)
        set_timezone "SET timezone = 'Asia/Amman'"
        run_tests "$POOLED_URL" "tz (database TimeZone Asia/Amman)" || { set_timezone "RESET timezone"; return 1; }
        set_timezone "RESET timezone"
        ;;
      flag) run_tests "${POOLED_URL}&pgbouncer=true" flag ;;
      *) echo "unknown pass: $pass" >&2; return 2 ;;
    esac
  done
}

down() {
  docker rm -f "$PG" "$BOUNCER" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}

case "${1:-all}" in
  up) up ;;
  test) run_passes ;;
  down) down ;;
  all)
    trap down EXIT
    up
    run_passes
    ;;
  *) echo "usage: $0 [all|up|test|down]" >&2; exit 2 ;;
esac
