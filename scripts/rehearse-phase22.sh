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
# Scenarios (2026-09-13 re-aim — the carry is now TWO days):
#   A  day 1 complete+sealed, day 2 row exists EMPTY      sealed inside the window
#   B  day 1 complete+sealed, day 2 row ABSENT            the app not opened today
#   C  day 1 complete, CLOSED, day 2 EMPTY                day 1 is left UNSEALED: the
#                                                         fixture's seal_day(1) is refused
#                                                         because the day has closed
#                                                         (0011:289). Not asserted here.
#   D  day 1 PARTIAL and still open                        carried open, no seal
#   E  day 1 PARTIAL and CLOSED                            REFUSED: a fresh miss
#   F  REFUSED: the empty day named in P_REPAIR_DAYS
#   G  REFUSED: the feed item id names a row that is not the one described
#   H  the ordering constraint, proved directly
#   I  P_FEED_DISPOSITION = rewrite, the Phase 15 behaviour, still works
#   J  REFUSED: run on any local date but the one it is written for
#   K  PRODUCTION AS CHECKED 2026-09-13 PM: day 1 complete, CLOSED, sealed_at,
#      evaluated_at and outcome all NULL; day 2 row EMPTY. The shape is
#      asserted before the repair, the result after it, and then the real
#      engine and app RPCs run over it to prove no flame is paid twice.
#      supabase/repair/phase22_K_check.sql.
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
PROD_LOCAL_DATE=2026-09-13

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
      -e "s/date '$PROD_LOCAL_DATE'/date '$(fx local_date)'/g" \
      "$@" \
      supabase/repair/streak_repair.sql > "$TMP/$out"
}

run_sql() { psql_run -v ON_ERROR_STOP=1 -d "$DB" -P pager=off -f "$1" 2>&1 | sed 's/^psql:[^ ]* //'; }
# Deliberately WITHOUT ON_ERROR_STOP, for the scenarios that must raise.
run_sql_expect_error() { psql_run -d "$DB" -P pager=off -f "$1" 2>&1 | sed 's/^psql:[^ ]* //'; }

# seed <ticks d1:d2> <grace open|closed>
seed() {
  build_db
  psql_run -v ON_ERROR_STOP=1 -d "$DB" -P pager=off -v ticks="$1" -v grace="$2"     -f "$(sql_path supabase/repair/phase22_fixture.sql)" 2>&1     | sed 's/^psql:[^ ]* //' | grep -vE "^(SET|DO| set_config|-+$|\(1 row\)|$)"
}

carry_check() {
  psql_run -X -d "$DB" -P pager=off -v uid="$(fx owner)"     -f "$(sql_path supabase/repair/phase22_carry_check.sql)"
}

state() {
  psql_run -X -d "$DB" -P pager=off -c "
    select day, jsonb_array_length(task_snapshot) as tasks,
           (select count(*) from public.task_completions tc
             where tc.challenge_id = d.challenge_id and tc.day = d.day) as ticks,
           coalesce(outcome,'-') as outcome, (sealed_at is not null) as sealed,
           public.day_is_met(d.challenge_id, d.day) as met
      from public.challenge_days d
     where d.challenge_id = '$(fx archive)' and d.day >= $(fx end_day) order by d.day;
    select flame, best_flame, last_evaluated_day,
           public.challenge_day(c.*) as today_is_day,
           public.earliest_open_day(c.*) as earliest_open,
           public.last_closed_day(c.*) as last_closed
      from public.challenges c where c.owner = '$(fx owner)' and c.ended_at is null;
    select 'journal' as t, day::text as day, text from public.journal_entries where owner = '$(fx owner)'
    union all select 'meal', day::text, text from public.meals where owner = '$(fx owner)'
    union all select 'milestone', hit_on_day::text, title from public.milestones where owner = '$(fx owner)'
    union all select 'workout', day::text, activity_type from public.workout_logs where owner = '$(fx owner)'
    order by 1, 2;"
}


sync_sql

banner() {
  echo
  echo "############################################################"
  echo "# $1"
  [ -n "${2:-}" ] && echo "# $2"
  echo "############################################################"
}

# ---------------------------------------------------------------- A ---------
banner "SCENARIO A — the live shape: carried day 1 COMPLETE and sealed" \
       "              by the app, carried day 2 EXISTS and is EMPTY"
seed "all:none" open
rehearsal_copy A_repair.sql
echo
echo "----- what this rehearsal changed in the shipped script -----"
diff -u supabase/repair/streak_repair.sql "$TMP/A_repair.sql" | grep -E '^[-+][^-+]' || true
sync_sql
echo
echo "----- BEFORE -----"
psql_run -X -d "$DB" -P pager=off -c "
  select left(id::text,8) as id,
         case when ended_at is null then 'LIVE' else 'ended' end as state,
         start_date, flame, best_flame, last_evaluated_day, ended_reason, ended_on_day
    from public.challenges where owner = '$(fx owner)' order by start_date, ended_at nulls last;
  select day, (select count(*) from public.task_completions tc
                where tc.challenge_id = d.challenge_id and tc.day = d.day) as ticks,
         (sealed_at is not null) as sealed
    from public.challenge_days d where d.challenge_id = '$(fx replacement)' order by day;"
echo
echo "----- THE REPAIR -----"
run_sql "$(tmp_path A_repair.sql)"
echo
echo "----- STATE AFTER -----"
state
echo
echo "----- THE CARRY, DAY BY DAY AND KEY BY KEY -----"
carry_check
echo
echo "----- THE REPAIR A SECOND TIME — must be a NO-OP -----"
run_sql "$(tmp_path A_repair.sql)" | grep -E "NOTICE|ERROR"
echo
echo "----- SURVIVAL: the ordinary engine over the restored challenge -----"
psql_run -v ON_ERROR_STOP=1 -d "$DB" -P pager=off -c "
do \$\$
declare v_n integer; v_ch uuid;
begin
  select id into v_ch from public.challenges where owner = '$(fx owner)' and ended_at is null;
  select public.evaluate_challenge(v_ch) into v_n;
  raise notice 'evaluate_challenge judged % day(s); flame %, cursor %', v_n,
    (select flame from public.challenges where id = v_ch),
    (select last_evaluated_day from public.challenges where id = v_ch);
end \$\$;"

# ---------------------------------------------------------------- B ---------
banner "SCENARIO B — carried day 1 COMPLETE, carried day 2 ABSENT" \
       "              (the app has not been opened today at all)"
seed "all:absent" open
rehearsal_copy B_repair.sql
sync_sql
run_sql "$(tmp_path B_repair.sql)" | grep -E "NOTICE|ERROR"
echo
state
echo
carry_check

# ---------------------------------------------------------------- C ---------
banner "SCENARIO C — the first carried day has already CLOSED (run after" \
       "              local noon); seal_day(1) is refused, so day 1 is UNSEALED"
seed "all:none" closed
rehearsal_copy C_repair.sql
sync_sql
run_sql "$(tmp_path C_repair.sql)" | grep -E "NOTICE|ERROR"
echo
state

# ---------------------------------------------------------------- D ---------
banner "SCENARIO D — carried day 1 PARTIAL and still OPEN" \
       "              carried open, unsealed, outside the flame"
seed "7:none" open
rehearsal_copy D_repair.sql
sync_sql
run_sql "$(tmp_path D_repair.sql)" | grep -E "NOTICE|ERROR"
echo
state
echo "----- then the account holder finishes it in the app -----"
psql_run -v ON_ERROR_STOP=1 -d "$DB" -P pager=off -c "
do \$\$
declare v_ch uuid; v_d integer; v_k text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '$(fx owner)', 'role', 'authenticated')::text, false);
  select id into v_ch from public.challenges where owner = '$(fx owner)' and ended_at is null;
  v_d := $(fx carry1);
  for v_k in select t->>'key' from public.challenge_days d,
                    lateral jsonb_array_elements(d.task_snapshot) t
              where d.challenge_id = v_ch and d.day = v_d loop
    perform public.complete_task(v_k, null, v_d);
  end loop;
  perform public.seal_day(v_d);
  raise notice 'day % finished in the app; flame is now %', v_d,
    (select flame from public.challenges where id = v_ch);
end \$\$;"

# ---------------------------------------------------------------- E ---------
banner "SCENARIO E — carried day 1 PARTIAL and already CLOSED" \
       "              REFUSED: that is a fresh miss, not a forgotten tap"
seed "7:none" closed
rehearsal_copy E_repair.sql
sync_sql
run_sql_expect_error "$(tmp_path E_repair.sql)" | grep -E "NOTICE|ERROR" | head -8
echo "----- and nothing was written -----"
psql_run -X -d "$DB" -P pager=off -c "
  select left(id::text,8) as id,
         case when ended_at is null then 'LIVE' else 'ended' end as state,
         ended_reason, ended_on_day, flame
    from public.challenges where owner = '$(fx owner)' order by start_date, ended_at nulls last;
  select (select count(*) from public.task_completions
           where challenge_id = '$(fx archive)' and day = $(fx end_day))
           as completions_on_the_empty_day,
         (select count(*) from public.challenge_days
           where challenge_id = '$(fx archive)' and day > $(fx end_day))
           as archive_days_above_the_miss;"

# ---------------------------------------------------------------- F ---------
banner "SCENARIO F — the empty day named in P_REPAIR_DAYS: REFUSED"
seed "all:none" open >/dev/null
ED=$(fx end_day)
rehearsal_copy F_repair.sql \
  -e "s/P_REPAIR_DAYS integer\[\] := array\[\]::integer\[\];/P_REPAIR_DAYS integer[] := array[$ED];/" \
  -e "s/P_NO_RECORD_DAYS integer\[\] := array\[$PROD_DAY\];/P_NO_RECORD_DAYS integer[] := array[]::integer[];/"
sync_sql
run_sql_expect_error "$(tmp_path F_repair.sql)" | grep -E "^ERROR" | head -3

# ---------------------------------------------------------------- G ---------
banner "SCENARIO G — a feed item id that is not the row described:" \
       "              REFUSED, and the whole repair rolls back"
seed "all:none" open >/dev/null
OTHER=$(psql_run -X -At -d "$DB" -c "select id from public.feed_items where author='$(fx owner)' and kind='complete' limit 1")
rehearsal_copy G_repair.sql
sed -i "s/P_FEED_ITEM_ID      uuid := '$(fx feed_item)';/P_FEED_ITEM_ID      uuid := '$OTHER';/" "$TMP/G_repair.sql"
sync_sql
run_sql_expect_error "$(tmp_path G_repair.sql)" | grep -E "^ERROR" | head -3
echo "----- and nothing was changed -----"
psql_run -X -d "$DB" -P pager=off -c "
  select left(id::text,8) as id,
         case when ended_at is null then 'LIVE' else 'ended' end as state,
         ended_reason, ended_on_day, flame
    from public.challenges where owner = '$(fx owner)' order by start_date, ended_at nulls last;
  select count(*) as completions_on_the_empty_day from public.task_completions
   where challenge_id = '$(fx archive)' and day = $(fx end_day);"

# ---------------------------------------------------------------- H ---------
banner "SCENARIO H — the ordering constraint, proved directly"
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

# ---------------------------------------------------------------- I ---------
banner "SCENARIO I — P_FEED_DISPOSITION := 'rewrite', reachable in one word"
seed "all:none" open >/dev/null
rehearsal_copy I_repair.sql \
  -e "s/P_FEED_DISPOSITION text := 'delete';/P_FEED_DISPOSITION text := 'rewrite';/"
sync_sql
run_sql "$(tmp_path I_repair.sql)" | grep -E "NOTICE|ERROR"
psql_run -X -d "$DB" -P pager=off -c "
  select left(id::text,8) as id, kind, text from public.feed_items
   where author = '$(fx owner)' order by created_at;"

# ---------------------------------------------------------------- J ---------
banner "SCENARIO J — the date guard: a run on any other local date" \
       "              REFUSES before writing a row"
seed "all:none" open >/dev/null
rehearsal_copy J_repair.sql
TOMORROW=$(psql_run -X -At -d "$DB" -c "select (v::date + 1)::text from public.fx22 where k='local_date'")
sed -i "s/P_EXPECT_LOCAL_DATE date := date '$(fx local_date)';/P_EXPECT_LOCAL_DATE date := date '$TOMORROW';/" "$TMP/J_repair.sql"
sync_sql
run_sql_expect_error "$(tmp_path J_repair.sql)" | grep -E "^ERROR" | head -3
echo "----- and nothing was written -----"
psql_run -X -d "$DB" -P pager=off -c "
  select (select count(*) from public.task_completions
           where challenge_id = '$(fx archive)' and day = $(fx end_day))
           as completions_on_the_empty_day,
         (select count(*) from public.feed_items
           where author = '$(fx owner)' and kind = 'miss') as miss_feed_items,
         (select ended_reason from public.challenges
           where id = '$(fx archive)') as archive_ended_reason;"

# ---------------------------------------------------------------- K ---------
k_check() {
  psql_run -v ON_ERROR_STOP=1 -X -d "$DB" -P pager=off \
    -v stage="$1" -v prod_day="$PROD_DAY" \
    -f "$(sql_path supabase/repair/phase22_K_check.sql)" 2>&1 | sed 's/^psql:[^ ]* //'
}

banner "SCENARIO K — PRODUCTION AS CHECKED 2026-09-13 PM: carried day 1" \
       "              COMPLETE, CLOSED, UNSEALED, UNJUDGED; carried day 2 EMPTY"
seed "all:none" closed
# Production's archive holds best_flame = flame. The fixture puts best_flame
# ABOVE flame on purpose, which would make "best_flame rises to the new flame"
# unprovable; K mirrors production instead.
psql_run -v ON_ERROR_STOP=1 -X -q -d "$DB" \
  -c "update public.challenges set best_flame = flame where id = '$(fx archive)'"
rehearsal_copy K_repair.sql
sync_sql
echo
echo "----- K: PRECONDITIONS — is this production's shape? -----"
k_check before
echo
echo "----- K: THE REPAIR -----"
run_sql "$(tmp_path K_repair.sql)"
echo
echo "----- K: STATE AFTER -----"
state
echo
echo "----- K: ASSERTIONS -----"
k_check after
echo
echo "----- K: THE CARRY, DAY BY DAY AND KEY BY KEY -----"
carry_check
echo
echo "----- K: THE REPAIR A SECOND TIME — must be a NO-OP -----"
run_sql "$(tmp_path K_repair.sql)" | grep -E "NOTICE|ERROR"
echo
echo "----- K: PAY-ONCE — the real engine and app RPCs over the result -----"
k_check payonce

echo
echo "rehearse-phase22: done"
