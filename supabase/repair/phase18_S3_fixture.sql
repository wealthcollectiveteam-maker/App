-- =============================================================================
-- PHASE 18 / S3 — REHEARSAL FIXTURE (LOCAL STUB ONLY, NEVER PRODUCTION)
--
-- Reproduces the REAL shape from the S1 grid, not an approximation:
--
--   ARCHIVE   hard, 75d, start_date 2026-08-24, America/New_York
--             days 1-14  11/11 met   (day 1 outcome NULL — see below)
--             day 15     9/11, workout1 + workout2 unticked, missed, UNSEALED
--             flame 14, best_flame 14, last_evaluated_day 15
--             ended missed_day on day 15
--   LIVE      the replacement restart_challenge() produced
--             day 1  11/11, outcome NULL, unsealed
--             day 2  0/11, open
--             flame 0, best_flame 14, missed_notice_day 1, last_evaluated_day 1
--
-- WHY DAY 1 IS UNJUDGED AND THAT IS NOT A DEFECT. evaluate_challenge() starts
-- its loop at `greatest(last_evaluated_day + 1, 2)` — day 1 is never judged by
-- the evaluator at all. seal_day() sets sealed_at and pays the flame; only the
-- evaluator writes `outcome`. So a sealed day 1 with outcome NULL is the
-- normal, correct end state for every challenge, and the repair must NOT
-- "fix" it.
--
-- THE CUSTOM TASK IDS ARE PRODUCED BY THE REAL restart_challenge(), not
-- hand-written. That function re-inserts each custom task against the new
-- challenge, so the replacement gets FRESH uuids with IDENTICAL names — which
-- is trap 1, reproduced authentically rather than simulated. A fixture that
-- hand-wrote matching ids would have made the repair look correct while the
-- production run silently produced a broken day.
--
-- DATES ARE ANCHORED ON 2026-08-24 and the run is expected on 2026-09-09, so
-- the archive's `challenge_day()` is 17. If you run this on another date the
-- day numbers shift and the repair's assertions will (correctly) refuse.
--
-- IT IS DESTRUCTIVE and targets a hardcoded test uuid. The guard at the top
-- refuses any database not named ranked_test.
-- =============================================================================

\set QUIET on
\pset pager off

do $$
begin
  if current_database() <> 'ranked_test' then
    raise exception
      'REFUSED: phase18_S3_fixture.sql is destructive and may only run against '
      'the local ranked_test stub. Current database is %.', current_database();
  end if;
end $$;

insert into auth.users (id, email) values
  ('5212e3ec-29ab-4bb0-b048-41088920e433', 'phase18-s3@test.dev')
on conflict (id) do nothing;

delete from public.challenges
 where owner = '5212e3ec-29ab-4bb0-b048-41088920e433'::uuid;
delete from public.feed_items
 where author = '5212e3ec-29ab-4bb0-b048-41088920e433'::uuid;
delete from public.journal_entries
 where owner = '5212e3ec-29ab-4bb0-b048-41088920e433'::uuid;
delete from public.meals
 where owner = '5212e3ec-29ab-4bb0-b048-41088920e433'::uuid;

do $$
declare
  v_uid    uuid := '5212e3ec-29ab-4bb0-b048-41088920e433';
  v_arch   uuid;
  v_repl   uuid;
  v_squad  uuid;
  v_day    integer;
  v_keys   text[];
  v_k      text;
  v_name   text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, false);

  v_arch := public.create_challenge('hard', date '2026-08-24', 'America/New_York', 75);
  update public.challenges
     set start_date = date '2026-08-24', timezone = 'America/New_York'
   where id = v_arch;

  perform public.create_squad('Phase 18 rehearsal squad');
  select squad_id into v_squad from public.squad_members where user_id = v_uid;

  -- The five customs, by name. Ids are whatever the database assigns; the
  -- whole point of trap 1 is that they are NOT chosen to match anything.
  foreach v_name in array array[
    'Sleep 6-8 hours a day',
    'Wake up at 6am',
    'Jamatkhana 1x a week',
    'Dua 1x a day',
    '20min podcast time'
  ] loop
    insert into public.custom_tasks (challenge_id, name, sub, proof, active_from_day)
    values (v_arch, v_name, '', false, 1);
  end loop;

  -- Days 1..15. Snapshots composed by the engine, so they carry 6 standard +
  -- 5 custom = 11 tasks each.
  for v_day in 1..15 loop
    insert into public.challenge_days (challenge_id, day, task_snapshot)
    values (v_arch, v_day, public.compose_task_set(v_arch, v_day))
    on conflict (challenge_id, day) do nothing;

    select array_agg(t->>'key' order by t->>'key') into v_keys
      from public.challenge_days d, lateral jsonb_array_elements(d.task_snapshot) t
     where d.challenge_id = v_arch and d.day = v_day;

    foreach v_k in array v_keys loop
      -- Day 15 is the forgotten tap: everything except the two workouts.
      if v_day < 15 or v_k not in ('workout1', 'workout2') then
        insert into public.task_completions (challenge_id, day, task_key)
        values (v_arch, v_day, v_k)
        on conflict do nothing;
      end if;
    end loop;
  end loop;

  -- Days 1-14 sealed. Day 1 keeps outcome NULL, exactly as the engine leaves
  -- it; days 2-14 carry outcome 'met' from the evaluator.
  update public.challenge_days
     set sealed_at = now() where challenge_id = v_arch and day between 1 and 14;
  update public.challenge_days
     set outcome = 'met', evaluated_at = now()
   where challenge_id = v_arch and day between 2 and 14;
  update public.challenge_days
     set outcome = 'missed', evaluated_at = now()
   where challenge_id = v_arch and day = 15;

  -- THE ORIGINAL TICKS ARE BACKDATED HERE, DELIBERATELY, AND ONLY HERE.
  -- Production's day-15 completions carry 2026-09-08T03:10Z — 23:10 local on
  -- day 15 itself. The first version of this fixture let them default to
  -- now(), so every completion in the database was younger than the repair
  -- run and the verification's "nothing backdated" check passed for the wrong
  -- reason. It was measuring min(completed_at) across the whole day, which
  -- only looked correct because the fixture had no genuinely older rows.
  -- A fixture must reproduce the awkward history, not a tidy version of it.
  update public.task_completions
     set completed_at = timestamptz '2026-09-08 03:10:00+00'
   where challenge_id = v_arch and day = 15;
  update public.task_completions
     set completed_at = (select start_date + (day - 1) from public.challenges where id = v_arch)
                        + time '20:00' at time zone 'America/New_York'
   where challenge_id = v_arch and day < 15;

  update public.challenges
     set flame = 14, best_flame = 14, last_evaluated_day = 15
   where id = v_arch;

  -- The two feed items from the real grid.
  insert into public.feed_items (squad_id, author, kind, text, created_at)
  values (v_squad, v_uid, 'miss', 'logged Day 6 late.',
          timestamptz '2026-08-30 04:05:00+00');
  insert into public.feed_items (squad_id, author, kind, text, created_at)
  values (v_squad, v_uid, 'miss',
          'missed Day 15. Hard rules — the challenge restarts at Day 1.',
          timestamptz '2026-09-08 16:05:00.369546+00');

  -- THE REAL RESTART. This is what produces the divergent custom task ids.
  v_repl := public.restart_challenge(v_arch, 15, 'missed_day');
  update public.challenges
     set ended_at = timestamptz '2026-09-08 16:05:00.369546+00'
   where id = v_arch;
  update public.challenges
     set start_date = date '2026-09-08' where id = v_repl;

  -- Replacement day 1 (2026-09-08): all 11 done, never judged.
  insert into public.challenge_days (challenge_id, day, task_snapshot)
  values (v_repl, 1, public.compose_task_set(v_repl, 1))
  on conflict (challenge_id, day) do nothing;

  select array_agg(t->>'key' order by t->>'key') into v_keys
    from public.challenge_days d, lateral jsonb_array_elements(d.task_snapshot) t
   where d.challenge_id = v_repl and d.day = 1;
  foreach v_k in array v_keys loop
    insert into public.task_completions (challenge_id, day, task_key)
    values (v_repl, 1, v_k) on conflict do nothing;
  end loop;

  -- Replacement day 2 (2026-09-09, today): frozen, nothing ticked.
  insert into public.challenge_days (challenge_id, day, task_snapshot)
  values (v_repl, 2, public.compose_task_set(v_repl, 2))
  on conflict (challenge_id, day) do nothing;

  -- DAY-NUMBERED PRIVATE ROWS, the trap the brief does not list. journal_entries
  -- and meals are keyed on (owner, day) and know nothing about which challenge
  -- they belong to, so anything written on 8 September is stored at day 1 — and
  -- after the archive is restored, day 1 means 24 AUGUST. Seeded here so the
  -- repair is seen re-pointing them; if production has none, that step is a
  -- no-op and says so.
  insert into public.journal_entries (owner, day, text, created_at)
  values (v_uid, 1, 'Back at it. Day one again.',
          timestamptz '2026-09-08 23:10:00+00');
  insert into public.meals (owner, day, text, created_at)
  values (v_uid, 1, 'Chicken and rice',
          timestamptz '2026-09-08 18:30:00+00');
  insert into public.meals (owner, day, text, created_at)
  values (v_uid, 2, 'Eggs',
          timestamptz '2026-09-09 12:15:00+00');
  -- And one from the ORIGINAL day 1 (24 August), which must NOT be moved. The
  -- discriminator is created_at against the restart instant, not the day number.
  insert into public.journal_entries (owner, day, text, created_at)
  values (v_uid, 1, 'Day 1 of 75. Here we go.',
          timestamptz '2026-08-24 22:00:00+00');

  insert into public.workout_logs
    (owner, challenge_id, day, task_key, activity_type, duration_seconds)
  values (v_uid, v_repl, 1, 'workout1', 'Run', 2700);
end $$;

\echo 'phase18 S3 fixture seeded: phase18-s3@test.dev (archive + replacement)'
