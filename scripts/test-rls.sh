#!/usr/bin/env bash
# Executable proofs for the RLS privacy, snapshot-immutability and privilege
# guarantees, run against a real PostgreSQL with a stubbed Supabase auth
# environment.
#
#   npm run test:rls
#
# HOW IT FINDS A DATABASE, in order:
#
#   1. $RANKED_TEST_PSQL   — an explicit `psql ...` command line, if you have
#                            one that can create databases.
#   2. sudo -u postgres    — a local install, the original path.
#   3. docker              — a throwaway postgres:16 container, started and
#                            left running so a re-run is fast. This is what
#                            makes the suite runnable on a machine with no
#                            local Postgres and no sudo, which is where it had
#                            silently stopped running for three phases.
#
# FIDELITY NOTE, unchanged and still important: this is Supabase's SHAPE, not
# Supabase. setup_local.sql reproduces the default-grant surface and auth.uid()
# faithfully enough for the policy and privilege proofs, but a passing run here
# is not a statement about the live project. Run the migrations there and check
# the grants there too.
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER=ranked-pg-test
IMAGE=postgres:16

if [ -n "${RANKED_TEST_PSQL:-}" ]; then
  RUNNER=explicit
elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  RUNNER=sudo
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  RUNNER=docker
else
  echo "No way to reach a PostgreSQL." >&2
  echo "  Install one and use sudo, start Docker Desktop, or set" >&2
  echo "  RANKED_TEST_PSQL to a psql command that can create databases." >&2
  exit 1
fi
echo "test:rls — using the $RUNNER runner"

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
  # A fresh copy of the SQL every run: the container outlives the test.
  # MSYS_NO_PATHCONV: under Git Bash on Windows the bare /supabase in the
  # rm is rewritten to a host path, the delete silently misses, and the
  # following cp then nests a SECOND copy at /supabase/supabase while the
  # suite keeps running the stale SQL at /supabase. Edited migrations and
  # tests would simply never reach the database.
  MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" rm -rf /supabase
  docker cp supabase "$CONTAINER":/supabase >/dev/null
fi

# psql, wherever it lives. $1.. are psql arguments; paths must be the ones
# visible to the runner, which is what sql_path() below is for.
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
  -c "drop database if exists ranked_test with (force)" \
  -c "create database ranked_test"

psql_run -v ON_ERROR_STOP=1 -q -d ranked_test -f "$(sql_path supabase/tests/setup_local.sql)"

# Apply ALL migrations in order so new ones stay covered by the proofs.
for m in supabase/migrations/*.sql; do
  psql_run -v ON_ERROR_STOP=1 -q -d ranked_test -f "$(sql_path "$m")"
done

# Every proof suite, in order. rls_test covers the privacy and immutability
# guarantees and the privilege allow-list; missed_day_test covers the engine
# that archives, restarts and resets streaks on top of them;
# challenge_length_test covers per-challenge lengths and the setup-time custom
# tasks that land in day 1's snapshot; squads_test covers naming, joining
# several, leaving, the cascade, and re-proves isolation now that membership is
# many-to-many; metric_checkins_test (0010) covers correcting and deleting a
# past check-in, and the two walls that stop one being handed to another user;
# grace_window_test (0011) covers the noon boundary — which day is open, what
# is refused once it closes, and that a miss is still a miss;
# weight_precision_test (0012) covers the decimal round trip through the
# column, in both units, and that no existing weight moved;
# two_client_test (17A) covers ONE ACCOUNT ON TWO CLIENTS — the web build and
# the native build signed into the same email at once — and proves that
# nothing double-counts and no sealed day can be resurrected;
# preference_sync_test (17A part 2) covers the columns fixes #1 and #4 turned
# into a live write surface — that the switches stay private and unwritable by
# a squadmate, and that the unit preference is readable by one and still not
# theirs to change.
FAILED=0
for t in supabase/tests/rls_test.sql \
         supabase/tests/missed_day_test.sql \
         supabase/tests/challenge_length_test.sql \
         supabase/tests/squads_test.sql \
         supabase/tests/metric_checkins_test.sql \
         supabase/tests/grace_window_test.sql \
         supabase/tests/weight_precision_test.sql \
         supabase/tests/two_client_test.sql \
         supabase/tests/preference_sync_test.sql; do
  echo "===== $t"
  # Each suite raises on failure, so a non-zero exit is a real failure and
  # must not be swallowed by the pipe into grep.
  if psql_run -v ON_ERROR_STOP=1 -d ranked_test -f "$(sql_path "$t")" 2>&1 \
      | sed 's/^psql:[^ ]* //' | grep -E "PASS|FAIL|PROOFS PASSED|ERROR"; then :; fi
  if [ "${PIPESTATUS[0]}" -ne 0 ]; then
    echo "FAILED: $t"
    FAILED=1
  fi
done

exit "$FAILED"
