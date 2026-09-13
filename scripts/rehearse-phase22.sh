#!/usr/bin/env bash
# Rehearsal for the Phase 22 streak repair.
#
#   bash scripts/rehearse-phase22.sh
#
# Builds a throwaway database, applies setup_local.sql and every migration,
# reproduces the production SHAPE with the real engine (supabase/repair/
# phase22_fixture.sql), and runs supabase/repair/streak_repair.sql against it.
#
# THE FIXTURE DOES NOT SHARE CONSTANTS WITH THE SCRIPT. Different account,
# timezone, challenge length, day number, task count and task names. This
# runner rewrites the repair's constants into a TEMPORARY COPY from the ids the
# fixture's database actually assigned; supabase/repair/streak_repair.sql is
# never edited and is what ships. The substitution list is printed so you can
# see exactly what differs between the rehearsed file and the shipped one.
#
# Scenarios:
#   A  every task ticked on the replacement's day 1   (the expected case)
#   B  a partial day 1                                 (3 of 10)
#   C  an untouched day 1                              (0 of 10)
#   D  REFUSED: the empty day named in P_REPAIR_DAYS
#   E  REFUSED: the feed item id names a row that is not the one described
#   F  the ordering constraint, proved directly
#   G  P_FEED_DISPOSITION = rewrite, the Phase 15 behaviour, still works
#
# Same fidelity caveat as test-rls.sh: this is Supabase's shape, not Supabase.
# It proves the repair's logic against real PostgreSQL semantics — triggers,
# cascades, the partial unique index — and nothing about the live project's
# grants.
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER=ranked-pg-test
IMAGE=postgres:16
DB=ranked_phase22
# The rehearsal copies live INSIDE the supabase tree, because that whole tree
# is what gets copied into the container; a separate docker cp of a Git Bash
# /tmp path resolves to C:	mp and fails. Removed on exit.
TMP=supabase/.rehearsal
rm -rf "$TMP"; mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

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
echo "rehearse-phase22 — using the $RUNNER runner"

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
fi

psql_run() {
  case "$RUNNER" in
    explicit) MSYS_NO_PATHCONV=1 $RANKED_TEST_PSQL "$@" ;;
    sudo)     sudo -u postgres psql "$@" ;;
    docker)   MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" psql -U postgres "$@" ;;
  esac
}

# Copy the working tree in, so an edited repair or fixture actually reaches the
# database. MSYS_NO_PATHCONV: under Git Bash the bare /supabase is otherwise
# rewritten to a host path and the delete silently misses.
sync_sql() {
  if [ "$RUNNER" = docker ]; then
    MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" rm -rf /supabase
    docker cp supabase "$CONTAINER":/supabase >/dev/null
  fi
}

sql_path() {
  case "$RUNNER" in
    docker) echo "/$1" ;;
    *)      echo "$1" ;;
  esac
}

tmp_path() {
  case "$RUNNER" in
    docker) echo "/$TMP/$1" ;;
    *)      echo "$TMP/$1" ;;
  esac
}

build_db() {
  psql_run -v ON_ERROR_STOP=1 -q -d postgres \
    -c "drop database if exists $DB with (force)" \
    -c "create database $DB"
  psql_run -v ON_ERROR_STOP=1 -q -d "$DB" -f "$(sql_path supabase/tests/setup_local.sql)"
  for m in supabase/migrations/*.sql; do
    psql_run -v ON_ERROR_STOP=1 -q -d "$DB" -f "$(sql_path "$m")"
  done
}

fx() { psql_run -X -At -d "$DB" -c "select v from public.fx22 where k = '$1'"; }

# --- the substitution: production constants -> whatever this fixture minted ---
PROD_OWNER=5212e3ec-29ab-4bb0-b048-41088920e433
PROD_ARCH=7729ffa2-3679-410f-b7c8-98554504c2be
PROD_REPL=3ad49dc5-e7b8-4a0d-9ecb-8ec5a2ba99c3
PROD_FEED=475bf99b-f485-4df2-9f22-a584cfdcd123
PROD_SQUAD=1ffcc0c5-3578-4d89-bb67-16be6fd3bcf0
PROD_DAY=19

rehearsal_copy() {
  # $1 = output basename, remaining args = extra sed expressions
  local out="$1"; shift
  sed -e "s/$PROD_OWNER/$(fx owner)/g" \
      -e "s/$PROD_ARCH/$(fx archive)/g" \
      -e "s/$PROD_REPL/$(fx replacement)/g" \
      -e "s/$PROD_FEED/$(fx feed_item)/g" \
      -e "s/$PROD_SQUAD/$(fx squad)/g" \
      -e "s/Day $PROD_DAY/Day $(fx end_day)/g" \
      -e "s/day $PROD_DAY/day $(fx end_day)/g" \
      -e "s/array\[$PROD_DAY\]/array[$(fx end_day)]/g" \
      "$@" \
      supabase/repair/streak_repair.sql > "$TMP/$out"
}

run_sql() { psql_run -v ON_ERROR_STOP=1 -d "$DB" -P pager=off -f "$1" 2>&1 | sed 's/^psql:[^ ]* //'; }
# Deliberately WITHOUT ON_ERROR_STOP, for the scenarios that must raise.
run_sql_expect_error() { psql_run -d "$DB" -P pager=off -f "$1" 2>&1 | sed 's/^psql:[^ ]* //'; }

sync_sql
build_db

echo
echo "############################################################"
echo "# SCENARIO A — the expected case: day 1 of the replacement"
echo "#              fully ticked before the repair runs"
echo "############################################################"
psql_run -v ON_ERROR_STOP=1 -d "$DB" -P pager=off -v ticks=all \
  -f "$(sql_path supabase/repair/phase22_fixture.sql)" 2>&1 | sed 's/^psql:[^ ]* //'

echo
echo "----- the fixture's constants (NOT the script's) -----"
psql_run -X -d "$DB" -P pager=off -c "select k, v from public.fx22 order by k"

echo
echo "----- BEFORE: the archive as the engine left it -----"
psql_run -X -d "$DB" -P pager=off -c "
  select left(id::text,8) as id,
         case when ended_at is null then 'LIVE' else 'ended' end as state,
         start_date, duration_days, flame, best_flame, last_evaluated_day,
         ended_reason, ended_on_day, left(coalesce(restarted_from::text,'-'),8) as restarted_from
    from public.challenges where owner = '$(fx owner)' order by start_date, ended_at nulls last;
  select day, jsonb_array_length(task_snapshot) as tasks,
         (select count(*) from public.task_completions tc
           where tc.challenge_id = d.challenge_id and tc.day = d.day) as ticks,
         outcome, (sealed_at is not null) as sealed
    from public.challenge_days d
   where d.challenge_id = '$(fx archive)' and d.day >= 20 order by d.day;
  select left(id::text,8) as id, kind, text from public.feed_items
   where author = '$(fx owner)' order by created_at;
  select 'journal' as t, day::text as day, text, created_at from public.journal_entries where owner = '$(fx owner)'
  union all select 'meal', day::text, text, created_at from public.meals where owner = '$(fx owner)'
  union all select 'milestone', hit_on_day::text, title, created_at from public.milestones where owner = '$(fx owner)'
  union all select 'workout', day::text, activity_type, logged_at from public.workout_logs where owner = '$(fx owner)'
  order by 1, 2;
"

echo
echo "----- TRAP 1, shown rather than asserted: the SAME task names carry"
echo "----- DIFFERENT keys on the two challenges -----"
psql_run -X -d "$DB" -P pager=off -c "
  select a.name,
         'custom-' || a.id as archive_key,
         'custom-' || r.id as replacement_key,
         (a.id = r.id) as same_key
    from public.custom_tasks a
    join public.custom_tasks r on r.name = a.name and r.challenge_id = '$(fx replacement)'
   where a.challenge_id = '$(fx archive)' order by a.name;"

rehearsal_copy A_repair.sql
echo
echo "----- what this rehearsal changed in the shipped script -----"
diff -u supabase/repair/streak_repair.sql "$TMP/A_repair.sql" | grep -E '^[-+][^-+]' || true
sync_sql

echo
echo "----- THE REPAIR -----"
run_sql "$(tmp_path A_repair.sql)"

echo
echo "----- AFTER: the day grid -----"
psql_run -X -d "$DB" -P pager=off -c "
  select day, jsonb_array_length(task_snapshot) as tasks,
         (select count(*) from public.task_completions tc
           where tc.challenge_id = d.challenge_id and tc.day = d.day) as ticks,
         outcome, (sealed_at is not null) as sealed, public.day_is_met(d.challenge_id, d.day) as met
    from public.challenge_days d
   where d.challenge_id = '$(fx archive)' and d.day >= 21 order by d.day;
  select left(id::text,8) as id,
         case when ended_at is null then 'LIVE' else 'ended' end as state,
         flame, best_flame, last_evaluated_day, ended_reason, ended_on_day
    from public.challenges where owner = '$(fx owner)' order by start_date, ended_at nulls last;
  select left(id::text,8) as id, kind, text from public.feed_items
   where author = '$(fx owner)' order by created_at;
  select 'journal' as t, day::text as day, text from public.journal_entries where owner = '$(fx owner)'
  union all select 'meal', day::text, text from public.meals where owner = '$(fx owner)'
  union all select 'milestone', hit_on_day::text, title from public.milestones where owner = '$(fx owner)'
  union all select 'workout', day::text, activity_type from public.workout_logs where owner = '$(fx owner)'
  order by 1, 2;
"

echo
echo "----- THE REPAIR A SECOND TIME — must be a NO-OP -----"
run_sql "$(tmp_path A_repair.sql)"

echo
echo "----- SURVIVAL: the ordinary engine over the restored challenge -----"
psql_run -v ON_ERROR_STOP=1 -d "$DB" -P pager=off -c "
do \$\$
declare v_n integer; v_ch uuid; v_d integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '$(fx owner)', 'role', 'authenticated')::text, false);
  select id into v_ch from public.challenges where owner = '$(fx owner)' and ended_at is null;
  v_d := public.challenge_day((select c from public.challenges c where c.id = v_ch));
  begin
    perform public.seal_day(v_d);
    raise notice 'seal_day(%) went through the normal RPC', v_d;
  exception when others then
    raise notice 'seal_day(%) said: %', v_d, sqlerrm;
  end;
  select public.evaluate_challenge(v_ch) into v_n;
  raise notice 'evaluate_challenge judged % day(s)', v_n;
  raise notice 'flame is now %', (select flame from public.challenges where id = v_ch);
end \$\$;"

echo
echo "############################################################"
echo "# SCENARIO B — a PARTIAL day 1 (3 of 10) when the repair runs"
echo "############################################################"
build_db
psql_run -v ON_ERROR_STOP=1 -d "$DB" -P pager=off -v ticks=3 \
  -f "$(sql_path supabase/repair/phase22_fixture.sql)" 2>&1 | sed 's/^psql:[^ ]* //'
rehearsal_copy B_repair.sql
sync_sql
run_sql "$(tmp_path B_repair.sql)"
psql_run -X -d "$DB" -P pager=off -c "
  select day, jsonb_array_length(task_snapshot) as tasks,
         (select count(*) from public.task_completions tc
           where tc.challenge_id = d.challenge_id and tc.day = d.day) as ticks,
         outcome, (sealed_at is not null) as sealed
    from public.challenge_days d where d.challenge_id = '$(fx archive)' and d.day >= 22 order by d.day;
  select flame, best_flame, last_evaluated_day from public.challenges
   where owner = '$(fx owner)' and ended_at is null;"
echo "----- then the account holder finishes the day in the app -----"
psql_run -v ON_ERROR_STOP=1 -d "$DB" -P pager=off -c "
do \$\$
declare v_ch uuid; v_d integer; v_k text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '$(fx owner)', 'role', 'authenticated')::text, false);
  select id into v_ch from public.challenges where owner = '$(fx owner)' and ended_at is null;
  v_d := public.challenge_day((select c from public.challenges c where c.id = v_ch));
  for v_k in select t->>'key' from public.challenge_days d,
                    lateral jsonb_array_elements(d.task_snapshot) t
              where d.challenge_id = v_ch and d.day = v_d loop
    perform public.complete_task(v_k, null, v_d);
  end loop;
  perform public.seal_day(v_d);
  raise notice 'day % finished in the app; flame is now %', v_d,
    (select flame from public.challenges where id = v_ch);
end \$\$;"

echo
echo "############################################################"
echo "# SCENARIO C — an UNTOUCHED day 1 (0 of 10)"
echo "############################################################"
build_db
psql_run -v ON_ERROR_STOP=1 -d "$DB" -P pager=off -v ticks=0 \
  -f "$(sql_path supabase/repair/phase22_fixture.sql)" 2>&1 | sed 's/^psql:[^ ]* //'
rehearsal_copy C_repair.sql
sync_sql
run_sql "$(tmp_path C_repair.sql)"
psql_run -X -d "$DB" -P pager=off -c "
  select day, jsonb_array_length(task_snapshot) as tasks,
         (select count(*) from public.task_completions tc
           where tc.challenge_id = d.challenge_id and tc.day = d.day) as ticks,
         outcome, (sealed_at is not null) as sealed
    from public.challenge_days d where d.challenge_id = '$(fx archive)' and d.day >= 22 order by d.day;
  select flame, best_flame, last_evaluated_day from public.challenges
   where owner = '$(fx owner)' and ended_at is null;"

echo
echo "############################################################"
echo "# SCENARIO D — the empty day named in P_REPAIR_DAYS: REFUSED"
echo "############################################################"
build_db
psql_run -v ON_ERROR_STOP=1 -q -d "$DB" -P pager=off -v ticks=all \
  -f "$(sql_path supabase/repair/phase22_fixture.sql)" >/dev/null 2>&1
ED=$(fx end_day)
rehearsal_copy D_repair.sql \
  -e "s/P_REPAIR_DAYS integer\[\] := array\[\]::integer\[\];/P_REPAIR_DAYS integer[] := array[$ED];/" \
  -e "s/P_NO_RECORD_DAYS integer\[\] := array\[$PROD_DAY\];/P_NO_RECORD_DAYS integer[] := array[]::integer[];/"
sync_sql
run_sql_expect_error "$(tmp_path D_repair.sql)" | head -20

echo
echo "############################################################"
echo "# SCENARIO E — a feed item id that is not the row described:"
echo "#              REFUSED, and the whole repair rolls back"
echo "############################################################"
build_db
psql_run -v ON_ERROR_STOP=1 -q -d "$DB" -P pager=off -v ticks=all \
  -f "$(sql_path supabase/repair/phase22_fixture.sql)" >/dev/null 2>&1
OTHER=$(psql_run -X -At -d "$DB" -c "select id from public.feed_items where author='$(fx owner)' and kind='complete' limit 1")
rehearsal_copy E_repair.sql
sed -i "s/P_FEED_ITEM_ID      uuid := '$(fx feed_item)';/P_FEED_ITEM_ID      uuid := '$OTHER';/" "$TMP/E_repair.sql"
sync_sql
run_sql_expect_error "$(tmp_path E_repair.sql)" | head -12
echo "----- and nothing was changed: the archive is still ended -----"
psql_run -X -d "$DB" -P pager=off -c "
  select left(id::text,8) as id,
         case when ended_at is null then 'LIVE' else 'ended' end as state,
         ended_reason, ended_on_day, flame
    from public.challenges where owner = '$(fx owner)' order by start_date, ended_at nulls last;
  select count(*) as completions_on_the_empty_day from public.task_completions
   where challenge_id = '$(fx archive)' and day = $(fx end_day);"

echo
echo "############################################################"
echo "# SCENARIO F — the ordering constraint, proved directly"
echo "############################################################"
psql_run -X -d "$DB" -P pager=off -c "
do \$\$
begin
  update public.challenges set ended_at = null, ended_reason = null, ended_on_day = null
   where id = '$(fx archive)';
  raise notice 'un-ending the archive BEFORE retiring the replacement SUCCEEDED — unexpected';
exception when unique_violation then
  raise notice 'un-ending first raises % (%) — this is why step 8 precedes step 9',
    sqlstate, sqlerrm;
end \$\$;"

echo
echo "############################################################"
echo "# SCENARIO G — P_FEED_DISPOSITION := 'rewrite', the Phase 15"
echo "#              behaviour, reachable in one word"
echo "############################################################"
build_db
psql_run -v ON_ERROR_STOP=1 -q -d "$DB" -P pager=off -v ticks=all   -f "$(sql_path supabase/repair/phase22_fixture.sql)" >/dev/null 2>&1
rehearsal_copy G_repair.sql   -e "s/P_FEED_DISPOSITION text := 'delete';/P_FEED_DISPOSITION text := 'rewrite';/"
sync_sql
run_sql "$(tmp_path G_repair.sql)" | grep -E "NOTICE|ERROR"
psql_run -X -d "$DB" -P pager=off -c "
  select left(id::text,8) as id, kind, text from public.feed_items
   where author = '$(fx owner)' order by created_at;"

echo
echo "rehearse-phase22: done"
