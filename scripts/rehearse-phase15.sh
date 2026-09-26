#!/usr/bin/env bash
# Rehearsal for the Phase 15 Part A repair.
#
#   bash scripts/rehearse-phase15.sh
#
# Builds a throwaway database, applies setup_local.sql and every migration,
# reproduces the archived-run situation with the REAL evaluator, prints the A1
# diagnostic against it, runs the A2 repair, verifies the result, and then runs
# the repair a SECOND time to prove it is a no-op.
#
# Same runner discovery as test-rls.sh. Same fidelity caveat: this is
# Supabase's shape, not Supabase. It proves the repair's logic against real
# Postgres semantics — triggers, cascades, the partial unique index — it does
# not prove anything about the live project's grants.
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER=ranked-pg-test
IMAGE=postgres:16
DB=ranked_phase15

if [ -n "${RANKED_TEST_PSQL:-}" ]; then
  RUNNER=explicit
elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  RUNNER=sudo
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  RUNNER=docker
else
  echo "No way to reach a PostgreSQL." >&2
  exit 1
fi
echo "rehearse-phase15 — using the $RUNNER runner"

if [ "$RUNNER" = docker ]; then
  if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres \
      -p 55432:5432 "$IMAGE" >/dev/null
  fi
  for _ in $(seq 1 60); do
    docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
  # MSYS_NO_PATHCONV: under Git Bash on Windows the bare /supabase in the
  # rm is rewritten to a host path, the delete silently misses, and the
  # following cp then nests a SECOND copy at /supabase/supabase while the
  # suite keeps running the stale SQL at /supabase. Edited migrations and
  # tests would simply never reach the database.
  MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" rm -rf /supabase
  docker cp supabase "$CONTAINER":/supabase >/dev/null
fi

psql_run() {
  case "$RUNNER" in
    explicit) MSYS_NO_PATHCONV=1 $RANKED_TEST_PSQL "$@" ;;
    sudo)     sudo -u postgres psql "$@" ;;
    docker)   MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" psql -U postgres "$@" ;;
  esac
}

sql_path() {
  case "$RUNNER" in
    docker) echo "/$1" ;;
    *)      echo "$1" ;;
  esac
}

psql_run -v ON_ERROR_STOP=1 -q -d postgres \
  -c "drop database if exists $DB with (force)" \
  -c "create database $DB"

psql_run -v ON_ERROR_STOP=1 -q -d "$DB" -f "$(sql_path supabase/tests/setup_local.sql)"
for m in supabase/migrations/*.sql; do
  psql_run -v ON_ERROR_STOP=1 -q -d "$DB" -f "$(sql_path "$m")"
done

# The fixture and the repair must share a session: the fixture leaves an fx
# table behind and the repair's temp log is session-scoped. One psql, several
# files, in order.
echo "===== 1. fixture — reproduce the situation with the real evaluator"
psql_run -v ON_ERROR_STOP=1 -d "$DB" -P pager=off \
  -f "$(sql_path supabase/repair/phase15_A3_fixture.sql)" 2>&1 | sed 's/^psql:[^ ]* //'

echo "===== 2. the A1 diagnostic, against the fixture (BEFORE)"
psql_run -v ON_ERROR_STOP=1 -d "$DB" -P pager=off \
  -f "$(sql_path supabase/repair/phase15_A1_diagnose.sql)" 2>&1 | sed 's/^psql:[^ ]* //'

echo "===== 3. the A2 repair"
psql_run -v ON_ERROR_STOP=1 -d "$DB" -P pager=off \
  -f "$(sql_path supabase/repair/phase15_A2_repair.sql)" 2>&1 | sed 's/^psql:[^ ]* //'

echo "===== 4. verification"
psql_run -v ON_ERROR_STOP=1 -d "$DB" -P pager=off \
  -f "$(sql_path supabase/repair/phase15_A3_verify.sql)" 2>&1 | sed 's/^psql:[^ ]* //'

echo "===== 5. the repair a SECOND time — must be a NO-OP"
psql_run -v ON_ERROR_STOP=1 -d "$DB" -P pager=off \
  -f "$(sql_path supabase/repair/phase15_A2_repair.sql)" 2>&1 | sed 's/^psql:[^ ]* //'

echo "===== 6. the A1 diagnostic again (AFTER)"
psql_run -v ON_ERROR_STOP=1 -d "$DB" -P pager=off \
  -f "$(sql_path supabase/repair/phase15_A1_diagnose.sql)" 2>&1 | sed 's/^psql:[^ ]* //'

echo "===== 7. survival — tonight's run, then day 8 completed normally"
psql_run -v ON_ERROR_STOP=1 -d "$DB" -P pager=off \
  -f "$(sql_path supabase/repair/phase15_A3_survive.sql)" 2>&1 | sed 's/^psql:[^ ]* //'
