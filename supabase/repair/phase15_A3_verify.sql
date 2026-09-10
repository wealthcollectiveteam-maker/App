-- =============================================================================
-- PHASE 15 / A3 — VERIFICATION, after the repair has run against the fixture.
--
-- Every check raises on failure. A clean run means the repair did what it says.
-- Run with ON_ERROR_STOP=1, autocommit, in the same session/database as the
-- fixture (it reads the fx table the fixture left behind).
-- =============================================================================

\set QUIET on
\pset pager off

-- =============================================================================
-- PROOF 1 — the archive is live again, on the right day, with the right books
-- =============================================================================
do $$
declare
  v_uid uuid; v_a public.challenges; v_n integer; v_day_now integer;
begin
  select v::uuid into v_uid from fx where k = 'uid';
  select * into v_a from public.challenges where id = (select v::uuid from fx where k='archive');

  if v_a.ended_at is not null or v_a.ended_reason is not null or v_a.ended_on_day is not null then
    raise exception 'FAIL: archive is still ended (% / % / %)',
      v_a.ended_at, v_a.ended_reason, v_a.ended_on_day;
  end if;
  if v_a.missed_notice_day is not null then
    raise exception 'FAIL: missed_notice_day survived (%)', v_a.missed_notice_day;
  end if;

  v_day_now := ((now() at time zone v_a.timezone)::date - v_a.start_date) + 1;
  if v_day_now <> 8 then raise exception 'FAIL: archive is on day %, expected 8', v_day_now; end if;

  if v_a.last_evaluated_day <> 7 then
    raise exception 'FAIL: cursor is %, expected 7', v_a.last_evaluated_day;
  end if;
  if v_a.flame <> 7 then raise exception 'FAIL: flame is %, expected 7', v_a.flame; end if;
  if v_a.best_flame <> 7 then raise exception 'FAIL: best_flame is %, expected 7', v_a.best_flame; end if;

  select count(*) into v_n from public.challenges where owner = v_uid;
  if v_n <> 1 then raise exception 'FAIL: % challenges left, expected 1', v_n; end if;

  raise notice 'PASS: archive live again — day 8, cursor 7, flame 7, best_flame 7, one challenge';
end $$;

-- =============================================================================
-- PROOF 2 — days 1-7 all met; day 8 was NOT created; day 6 is genuinely done
-- =============================================================================
do $$
declare
  v_a uuid; d integer; v_n integer; v_total integer;
begin
  select v::uuid into v_a from fx where k = 'archive';

  for d in 1..7 loop
    if not public.day_is_met(v_a, d) then
      raise exception 'FAIL: day % is not met', d;
    end if;
    select count(*) into v_n from public.challenge_days
     where challenge_id = v_a and day = d and sealed_at is not null;
    if v_n <> 1 then raise exception 'FAIL: day % is not sealed', d; end if;
  end loop;

  if exists (select 1 from public.challenge_days where challenge_id = v_a and day = 8) then
    raise exception 'FAIL: day 8 was created; today must be left for the app to freeze';
  end if;

  select jsonb_array_length(task_snapshot),
         (select count(*) from public.task_completions tc
           where tc.challenge_id = v_a and tc.day = 6)
    into v_total, v_n
    from public.challenge_days where challenge_id = v_a and day = 6;
  if v_total <> 11 or v_n <> 11 then
    raise exception 'FAIL: day 6 is %/%, expected 11/11', v_n, v_total;
  end if;
  if not exists (select 1 from public.challenge_days
                  where challenge_id = v_a and day = 6 and outcome = 'met') then
    raise exception 'FAIL: day 6 is not scored met';
  end if;

  -- Perfect days = sealed days, which is exactly what api.ts counts.
  select count(*) into v_n from public.challenge_days
   where challenge_id = v_a and sealed_at is not null;
  if v_n <> 7 then raise exception 'FAIL: % perfect days, expected 7', v_n; end if;

  raise notice 'PASS: days 1-7 met and sealed, day 6 is 11/11 met, day 8 untouched, 7 perfect days';
end $$;

-- =============================================================================
-- PROOF 3 — day 7 was composed from the ARCHIVE, not copied. Its custom keys
--           belong to the archive's custom_tasks and resolve to real rows.
-- =============================================================================
do $$
declare
  v_a uuid; v_snap jsonb; v_bad text;
begin
  select v::uuid into v_a from fx where k = 'archive';
  select task_snapshot into v_snap from public.challenge_days
   where challenge_id = v_a and day = 7;

  if v_snap is null then raise exception 'FAIL: day 7 has no snapshot'; end if;
  if jsonb_array_length(v_snap) <> 11 then
    raise exception 'FAIL: day 7 has % tasks, expected 11', jsonb_array_length(v_snap);
  end if;
  if v_snap is distinct from public.compose_task_set(v_a, 7) then
    raise exception 'FAIL: day 7 snapshot is not what the archive composes for day 7';
  end if;

  -- Every custom key on day 7 must point at a custom_task OWNED BY THE ARCHIVE.
  select string_agg(t->>'key', ', ') into v_bad
  from jsonb_array_elements(v_snap) t
  where t->>'key' like 'custom-%'
    and not exists (
      select 1 from public.custom_tasks ct
       where ct.challenge_id = v_a
         and ('custom-' || ct.id) = t->>'key');
  if v_bad is not null then
    raise exception 'FAIL: day 7 references keys that are not the archive''s: %', v_bad;
  end if;

  -- ...and every one of them has a completion, re-keyed from the replacement.
  select string_agg(t->>'key', ', ') into v_bad
  from jsonb_array_elements(v_snap) t
  where not exists (
    select 1 from public.task_completions tc
     where tc.challenge_id = v_a and tc.day = 7 and tc.task_key = t->>'key');
  if v_bad is not null then
    raise exception 'FAIL: day 7 keys with no completion: %', v_bad;
  end if;

  raise notice 'PASS: day 7 composed from the archive, 11 tasks, all custom keys the archive''s own, all completed';
end $$;

-- =============================================================================
-- PROOF 4 — the replacement and everything that hung off it is gone, and
--           nothing valuable went with it
-- =============================================================================
do $$
declare
  v_uid uuid; v_r uuid; v_a uuid; v_n integer;
begin
  select v::uuid into v_uid from fx where k = 'uid';
  select v::uuid into v_r   from fx where k = 'replacement';
  select v::uuid into v_a   from fx where k = 'archive';

  if exists (select 1 from public.challenges where id = v_r) then
    raise exception 'FAIL: the replacement challenge still exists';
  end if;
  select count(*) into v_n from public.challenge_days   where challenge_id = v_r;
  if v_n <> 0 then raise exception 'FAIL: % orphan challenge_days', v_n; end if;
  select count(*) into v_n from public.task_completions where challenge_id = v_r;
  if v_n <> 0 then raise exception 'FAIL: % orphan task_completions', v_n; end if;
  select count(*) into v_n from public.custom_tasks     where challenge_id = v_r;
  if v_n <> 0 then raise exception 'FAIL: % orphan custom_tasks', v_n; end if;

  -- The workout log was MOVED, not destroyed, and re-numbered day 1 -> day 7.
  select count(*) into v_n from public.workout_logs
   where owner = v_uid and challenge_id = v_a and day = 7;
  if v_n <> 1 then raise exception 'FAIL: the workout log did not survive as day 7 (found %)', v_n; end if;

  -- journal_entries / meals carry no challenge_id; they were re-based by 6.
  select count(*) into v_n from public.journal_entries where owner = v_uid and day = 7;
  if v_n <> 1 then raise exception 'FAIL: journal entry not re-based to day 7 (found %)', v_n; end if;
  select count(*) into v_n from public.meals where owner = v_uid and day = 7;
  if v_n <> 1 then raise exception 'FAIL: meal not re-based to day 7 (found %)', v_n; end if;

  raise notice 'PASS: replacement deleted; workout log, journal and meal survived and re-based to day 7';
end $$;

-- =============================================================================
-- PROOF 5 — the squad feed row is still there, still in place, and now true
-- =============================================================================
do $$
declare v_uid uuid; v_txt text; v_n integer;
begin
  select v::uuid into v_uid from fx where k = 'uid';
  select count(*) into v_n from public.feed_items where author = v_uid and kind = 'miss';
  if v_n <> 1 then raise exception 'FAIL: % miss feed rows, expected 1 (it must not be deleted)', v_n; end if;
  select text into v_txt from public.feed_items
   where id = '1f44feac-0000-4000-8000-000000000000';
  if v_txt is null then raise exception 'FAIL: the feed row lost its id'; end if;
  if v_txt like '%restarts at Day 1%' then
    raise exception 'FAIL: the feed row still claims the challenge restarted';
  end if;
  if v_txt <> 'logged Day 6 late.' then
    raise exception 'FAIL: feed text is "%"', v_txt;
  end if;
  raise notice 'PASS: feed row kept, same id and timestamp, text now "logged Day 6 late."';
end $$;

-- =============================================================================
-- PROOF 6 — snapshots are still immutable. The trigger was never disabled, so
--           it must still refuse a rewrite, right now, on a repaired day.
-- =============================================================================
do $$
declare v_a uuid; v_ok boolean := false;
begin
  select v::uuid into v_a from fx where k = 'archive';
  begin
    update public.challenge_days set task_snapshot = '[]'::jsonb
     where challenge_id = v_a and day = 6;
  exception when others then
    v_ok := (sqlerrm = 'day snapshots are immutable');
  end;
  if not v_ok then
    raise exception 'FAIL: the immutability trigger did not refuse a snapshot rewrite';
  end if;
  raise notice 'PASS: snapshots still immutable after the repair — the trigger was never disabled';
end $$;

-- =============================================================================
-- PROOF 7 — the squad roster resolves the restored challenge, at day 8
-- =============================================================================
do $$
declare v_uid uuid; r record; v_n integer := 0;
begin
  select v::uuid into v_uid from fx where k = 'uid';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, false);
  for r in select * from public.get_squad_status((select v::uuid from fx where k='squad')) loop
    v_n := v_n + 1;
    if r.day <> 8 then raise exception 'FAIL: roster shows day %, expected 8', r.day; end if;
  end loop;
  if v_n = 0 then raise exception 'FAIL: the roster returned no rows'; end if;
  raise notice 'PASS: squad roster resolves the restored challenge at day 8';
end $$;

