#!/usr/bin/env bash
# Applies the HITFAT RUN migrations to a throwaway database and runs the
# permission tests. Needs a local Postgres; set PGHOST/PGPORT/PGUSER as usual.
#   run/db/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${RUN_TEST_DB:-hitfat_run_test}
psql -qX -d postgres -c "drop database if exists $DB" -c "create database $DB"
for f in tests/supabase_stub.sql 001_run_club_phase1.sql 002_seed_programs.sql 001_run_club_phase1.sql tests/rls_test.sql; do
  # 001 runs twice on purpose: the migration must be safe to re-run
  psql -qX -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 | grep -v 'NOTICE\|already exists\|does not exist, skipping' || true
  test "${PIPESTATUS[0]}" -eq 0 || { echo "FAILED in $f"; exit 1; }
done
psql -qX -d postgres -c "drop database $DB"
