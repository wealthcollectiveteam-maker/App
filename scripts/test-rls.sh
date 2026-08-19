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
  -f supabase/tests/setup_local.sql \
  -f supabase/migrations/0001_init.sql

sudo -u postgres psql -v ON_ERROR_STOP=1 -d ranked_test \
  -f supabase/tests/rls_test.sql 2>&1 | grep -E "PASS|FAIL|ALL PROOFS"
