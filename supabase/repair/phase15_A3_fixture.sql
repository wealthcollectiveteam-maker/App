-- =============================================================================
-- PHASE 15 / A3 — THE FIXTURE
--
-- Reproduces the situation the A1 grid described, on a local stack, using the
-- SAME ABSOLUTE DATES the repair is pinned to, so the repair file can be
-- rehearsed byte-for-byte with nothing edited or stubbed.
--
-- WHAT IT REPRODUCES
--   * hard tier, 75 days, a NON-server timezone, 11 tasks a day (6 tier + 5
--     custom), archive start_date 2026-08-24, replacement start_date 2026-08-30
--   * day 1 completed and sealed through the app's own complete_task/seal_day
--     — so it ends up sealed with outcome NULL and evaluated_at NULL, exactly
--     like the real row, because the evaluator never judges day 1
--   * days 2-5 completed
--   * day 6 left two tasks short — "did every task but forgot to tap some of
--     them before midnight"
--   * evaluate_all_challenges(), THE REAL SCHEDULED PROCEDURE, judges day 6 a
--     miss and archives the attempt at flame 5
--   * the replacement's day 1 completed and sealed through the app path, with
--     a journal entry, a meal and a workout log written against it
--   * the clock then advances one day, so the archive is on day 8 and the
--     replacement on day 2
--
-- TIME IS MOVED BY MOVING start_date, never by stubbing now(), and always
-- anchored on the CHALLENGE's timezone rather than the server's current_date —
-- the Phase 12 bug. The challenge runs on America/New_York while the container
-- runs on UTC, so that arithmetic is genuinely exercised rather than hidden by
-- the two zones agreeing.
--
-- IT ONLY RUNS ON THE DAY THE SITUATION IS ABOUT. The archive must be on day 8
-- for the rehearsal to mean anything, so the fixture asserts the date up front
-- and stops with an explanation otherwise. The repair itself has the same
-- validity window, for the same reason.
--
-- Run as the postgres superuser, autocommit, after setup_local.sql and every
-- migration. Not part of the app. Not a migration.
-- =============================================================================

\set QUIET on
\pset pager off

drop table if exists fx;
create table fx (k text primary key, v text);

-- =============================================================================
-- 0. THE DAY THIS REHEARSAL IS ABOUT
-- =============================================================================
do $$
declare
  v_tz    constant text := 'America/New_York';
  v_today date := (now() at time zone v_tz)::date;
begin
  if v_today <> date '2026-08-31' then
    raise exception
      'REHEARSAL WINDOW: today is % in %, but this fixture reproduces a dated '
      'situation in which 2026-08-31 is day 8 of a challenge that started '
      '2026-08-24. Rebuild the fixture dates, or re-run the A1 diagnostic — '
      'the repair is pinned to the same dates and would refuse too.',
      v_today, v_tz;
  end if;
  raise notice 'FIXTURE: % is 2026-08-31 — archive day 8, replacement day 2', v_tz;
end $$;

-- =============================================================================
-- 1. THE ORIGINAL RUN, UP TO THE MISS
-- =============================================================================
do $$
declare
  v_uid constant uuid := '11111111-1111-4111-8111-111111111111';
  v_tz  constant text := 'America/New_York';
  v_a   uuid;
  v_sq  uuid;
  v_d   integer;
  r     record;
begin
  insert into auth.users (id, email)
  values (v_uid, 'repair-fixture@example.invalid') on conflict do nothing;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Fixture User') on conflict do nothing;

  -- Day 1 has to be today for the setup path to be reachable at all.
  v_a := public.create_challenge('hard', (now() at time zone v_tz)::date, v_tz, 75);

  -- Five setup customs -> 6 tier tasks + 5 = 11 a day, and 5 is the cap.
  perform public.add_setup_custom_task('Cold shower', null);
  perform public.add_setup_custom_task('Journal', null);
  perform public.add_setup_custom_task('Stretch', 10);
  perform public.add_setup_custom_task('No alcohol', null);
  perform public.add_setup_custom_task('Supplements', null);

  -- A squad, so the miss posts a real feed row.
  select id into v_sq from public.create_squad('The Grind');

  -- DAY 1 THROUGH THE APP'S OWN PATH: complete every task, then seal.
  -- seal_day() sets sealed_at and pays the flame; it does not write outcome,
  -- which is why the real day 1 has outcome NULL.
  for r in
    select t->>'key' as k
    from jsonb_array_elements((public.get_or_freeze_today()).task_snapshot) t
  loop
    perform public.complete_task(r.k);
  end loop;
  perform public.seal_day();

  -- Wind the clock to the eve of the miss: 2026-08-31 is day 7, so days 1-6
  -- are behind and day 6 is the last one that has ended.
  update public.challenges set start_date = date '2026-08-25' where id = v_a;

  -- Days 2-6 as the app would have frozen and filled them.
  for v_d in 2..6 loop
    insert into public.challenge_days (challenge_id, day, task_snapshot)
    values (v_a, v_d, public.compose_task_set(v_a, v_d))
    on conflict (challenge_id, day) do nothing;

    insert into public.task_completions (challenge_id, day, task_key)
    select v_a, v_d, t->>'key'
    from public.challenge_days cd, lateral jsonb_array_elements(cd.task_snapshot) t
    where cd.challenge_id = v_a and cd.day = v_d
    on conflict do nothing;
  end loop;

  -- THE MISS. The work was done; two boxes were never tapped.
  delete from public.task_completions
   where challenge_id = v_a and day = 6 and task_key in ('water', 'read');

  insert into fx values ('uid', v_uid::text), ('archive', v_a::text),
                        ('squad', v_sq::text);
end $$;

-- =============================================================================
-- 2. THE REAL SCHEDULED EVALUATOR ARCHIVES IT.
--    A procedure with COMMIT inside; it runs outside a transaction block.
-- =============================================================================
call public.evaluate_all_challenges();

-- =============================================================================
-- 3. THE DAY ON THE REPLACEMENT — through the app path, then private rows
-- =============================================================================
do $$
declare
  v_uid uuid;
  v_r   uuid;
  r     record;
begin
  select v::uuid into v_uid from fx where k = 'uid';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, false);

  select id into v_r from public.challenges where owner = v_uid and ended_at is null;
  if v_r is null then
    raise exception 'FIXTURE: the evaluator did not create a replacement';
  end if;

  for r in
    select t->>'key' as k
    from jsonb_array_elements((public.get_or_freeze_today()).task_snapshot) t
  loop
    perform public.complete_task(r.k);
  end loop;
  perform public.seal_day();

  -- Day-numbered private rows, written under the REPLACEMENT's numbering.
  -- journal_entries and meals carry no challenge_id at all.
  insert into public.journal_entries (owner, day, text)
  values (v_uid, 1, 'Restarted. Furious about it.');
  insert into public.meals (owner, day, text)
  values (v_uid, 1, 'Chicken, rice, broccoli');
  insert into public.workout_logs
    (owner, challenge_id, day, task_key, activity_type, duration_seconds)
  values (v_uid, v_r, 1, 'workout1', 'Run', 2700);

  insert into fx values ('replacement', v_r::text);
end $$;

-- =============================================================================
-- 4. A DAY PASSES. Both challenges shift together — that is what "a day
--    passed" means — landing on the exact dates the A1 grid reported.
--    The miss feed row is given the id the grid reported, so the repair's
--    assertion on it is exercised for real.
-- =============================================================================
do $$
declare
  v_uid uuid; v_a uuid; v_r uuid;
begin
  select v::uuid into v_uid from fx where k = 'uid';
  select v::uuid into v_a   from fx where k = 'archive';
  select v::uuid into v_r   from fx where k = 'replacement';

  update public.challenges set start_date = date '2026-08-24' where id = v_a;
  update public.challenges set start_date = date '2026-08-30' where id = v_r;
  update public.challenges set ended_at   = ended_at   - interval '1 day' where id = v_a;
  update public.challenges set created_at = created_at - interval '1 day' where id = v_r;

  update public.feed_items
     set created_at = created_at - interval '1 day',
         id         = '1f44feac-0000-4000-8000-000000000000'
   where author = v_uid and kind = 'miss';
end $$;

-- =============================================================================
-- 5. TODAY: the app is opened (freezing the replacement's day 2, empty), and
--    the 00:05 scheduled run happens. Neither should judge anything.
-- =============================================================================
do $$
declare v_uid uuid;
begin
  select v::uuid into v_uid from fx where k = 'uid';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, false);
  perform public.get_or_freeze_today();
end $$;

call public.evaluate_all_challenges();

-- =============================================================================
-- 6. ASSERT THE FIXTURE IS THE SITUATION FROM THE GRID, BEFORE ANY REPAIR
-- =============================================================================
do $$
declare
  v_a public.challenges; v_r public.challenges; v_n integer;
begin
  select * into v_a from public.challenges where id = (select v::uuid from fx where k='archive');
  select * into v_r from public.challenges where id = (select v::uuid from fx where k='replacement');

  if v_a.start_date <> date '2026-08-24' then
    raise exception 'FIXTURE: archive starts %, expected 2026-08-24', v_a.start_date;
  end if;
  if v_r.start_date <> date '2026-08-30' then
    raise exception 'FIXTURE: replacement starts %, expected 2026-08-30', v_r.start_date;
  end if;
  if v_a.ended_reason <> 'missed_day' or v_a.ended_on_day <> 6 then
    raise exception 'FIXTURE: archive ended % on day %, expected missed_day / 6',
      v_a.ended_reason, v_a.ended_on_day;
  end if;
  if v_a.flame <> 5 or v_a.best_flame <> 5 then
    raise exception 'FIXTURE: archive flame %/%, expected 5/5', v_a.flame, v_a.best_flame;
  end if;
  if v_r.restarted_from <> v_a.id then
    raise exception 'FIXTURE: replacement does not point at the archive';
  end if;
  if ((now() at time zone v_a.timezone)::date - v_a.start_date) + 1 <> 8 then
    raise exception 'FIXTURE: archive is on day %, expected 8',
      ((now() at time zone v_a.timezone)::date - v_a.start_date) + 1;
  end if;

  if not exists (select 1 from public.challenge_days
                  where challenge_id = v_a.id and day = 1
                    and sealed_at is not null and outcome is null
                    and evaluated_at is null) then
    raise exception 'FIXTURE: day 1 is not "sealed, outcome null, never evaluated"';
  end if;

  select count(*) into v_n from public.challenge_days
   where challenge_id = v_a.id and day = 6 and outcome = 'missed';
  if v_n <> 1 then raise exception 'FIXTURE: day 6 is not scored missed'; end if;

  select jsonb_array_length(task_snapshot) into v_n from public.challenge_days
   where challenge_id = v_a.id and day = 6;
  if v_n <> 11 then raise exception 'FIXTURE: archive day 6 has % tasks, expected 11', v_n; end if;

  select count(*) into v_n from public.task_completions
   where challenge_id = v_a.id and day = 6;
  if v_n <> 9 then raise exception 'FIXTURE: archive day 6 is %/11, expected 9/11', v_n; end if;

  select jsonb_array_length(task_snapshot) into v_n from public.challenge_days
   where challenge_id = v_r.id and day = 1;
  if v_n <> 11 then raise exception 'FIXTURE: replacement day 1 has % tasks, expected 11', v_n; end if;

  select count(*) into v_n from public.task_completions
   where challenge_id = v_r.id and day = 1;
  if v_n <> 11 then raise exception 'FIXTURE: replacement day 1 is %/11', v_n; end if;

  if not exists (select 1 from public.challenge_days where challenge_id = v_r.id and day = 2) then
    raise exception 'FIXTURE: replacement day 2 was not frozen by the app';
  end if;

  -- The two challenges must hold the SAME five custom task names under
  -- DIFFERENT ids — the thing that makes copying a snapshot wrong.
  select count(*) into v_n
    from public.custom_tasks a
    join public.custom_tasks b on b.name = a.name
   where a.challenge_id = v_a.id and b.challenge_id = v_r.id and a.id = b.id;
  if v_n <> 0 then raise exception 'FIXTURE: the two challenges share custom task ids'; end if;

  raise notice 'FIXTURE READY: archive % day 8 (ended day 6, flame 5); replacement % day 2 (day 1 sealed 11/11)',
    left(v_a.id::text, 8), left(v_r.id::text, 8);
end $$;
