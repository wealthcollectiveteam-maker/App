#!/usr/bin/env bash
# Executable proofs for the Phase 8 review questions (RLS privacy + snapshot
# immutability), run against a local PostgreSQL with a stubbed Supabase auth
# environment. Requires: postgresql installed and running, sudo access.
#
#   npm run test:rls
set -euo pipefail
cd "$(dirname "$0")/.."

sudo -u postgres psql -v ON_ERROR_STOP=1 -q \
  -c "drop database if exists ranked_test" \
  -c "create database ranked_test"

sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d ranked_test \
  -f supabase/tests/setup_local.sql

# Apply ALL migrations in order so new ones stay covered by the proofs.
for m in supabase/migrations/*.sql; do
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d ranked_test -f "$m"
done

# Every proof suite, in order. rls_test covers the privacy and immutability
# guarantees; missed_day_test covers the engine that archives, restarts and
# resets streaks on top of them; challenge_length_test covers per-challenge
# lengths and the setup-time custom tasks that land in day 1's snapshot.
for t in supabase/tests/rls_test.sql supabase/tests/missed_day_test.sql supabase/tests/challenge_length_test.sql; do
  echo "===== $t"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d ranked_test \
    -f "$t" 2>&1 | grep -E "PASS|FAIL|PROOFS PASSED"
done
