-- =============================================================================
-- PHASE 22 — REHEARSAL FIXTURE (LOCAL STUB ONLY, NEVER PRODUCTION)
--
-- Reproduces the SHAPE of the production state, and deliberately NOT its
-- constants.
--
-- WHY THE CONSTANTS DIFFER, WHICH IS THE WHOLE POINT OF THIS FILE.
--   The Phase 18 rehearsal built its fixture from the same numbers the
--   verification asserted — flame 16, day 17, "earliest completion is today" —
--   so check and fixture agreed by construction. Three defects survived a
--   green rehearsal and only surfaced against production a day later.
--
--   So nothing here matches production. Different account, different timezone,
--   different challenge length, different day number, different number of
--   tasks, different custom-task names, different flame, best_flame ABOVE
--   flame rather than equal to it. What is reproduced is the STRUCTURE:
--
--     * an archive ended by the engine with ended_reason 'missed_day'
--     * on a day with ZERO completions whose challenge_days row nonetheless
--       EXISTS, carries a full task_snapshot, outcome 'missed', sealed_at null
--     * a live replacement with TWO days to carry, the first complete and
--       SEALED BY THE APP inside the grace window, the second empty or absent
--     * the replacement's custom-task keys diverging from the archive's, for
--       the same task NAMES, because the real restart_challenge() made them
--     * a SECOND, older retired replacement that also points at the archive —
--       the ff81767a analogue. Production has one; a fixture with only one
--       retired row cannot show what two do to a scalar subquery.
--     * the miss feed item written by the real evaluator, plus an older feed
--       item that must survive untouched
--     * day-numbered private rows in all four tables, including FOUR that
--       must NOT move: two from the archive's genuine days 1 and 2, one from
--       the day the archive ended, and one written on the morning of the miss
--       itself, which already carries the archive day the carry is about to
--       land on
--
-- THE ENGINE DOES THE WORK, NOT THIS FILE. evaluate_challenge() judges the
-- empty day, writes the 'missed' outcome, posts the feed item and calls
-- restart_challenge(). seal_day() — the real app RPC — seals the replacement's
-- day 1. Hand-writing any of that would be rehearsing against an imitation of
-- the thing being repaired.
--
-- PARAMETERS
--   \set ticks   d1:d2   what the replacement's day 1 and day 2 have ticked.
--                        'all' = every task, an integer = that many,
--                        'none' = the row exists with nothing ticked,
--                        'absent' = no challenge_days row for that day at all.
--                        Production's shape right now is  all:absent  or
--                        all:none — we do not yet know which.
--   \set grace   open|closed
--                        Whether the FIRST carried day is still inside its
--                        grace window. The fixture picks a timezone that makes
--                        this true right now, and raises if it cannot find one,
--                        so a rehearsal run at an awkward hour fails loudly
--                        instead of quietly testing the other branch.
--
-- DATES ARE COMPUTED FROM TODAY in the chosen timezone, so the rehearsal
-- reproduces "the miss was judged the day before yesterday, day 1 of the
-- replacement was finished yesterday, and the repair runs today" whenever it
-- is run.
--
-- IT IS DESTRUCTIVE and targets a hardcoded test uuid. The guard refuses any
-- database not named ranked_phase22.
-- =============================================================================

\set QUIET on
\pset pager off

do $$
begin
  if current_database() <> 'ranked_phase22' then
    raise exception
      'REFUSED: phase22_fixture.sql is destructive and may only run against '
      'the local ranked_phase22 stub. Current database is %.', current_database();
  end if;
end $$;

select set_config('fx22.ticks', :'ticks', false),
       set_config('fx22.grace', :'grace', false);

insert into auth.users (id, email) values
  ('c1a7d2e9-63b4-4f08-9d51-8e2fb0a37c46', 'phase22-rehearsal@test.dev')
on conflict (id) do nothing;

delete from public.challenges
 where owner = 'c1a7d2e9-63b4-4f08-9d51-8e2fb0a37c46'::uuid;
delete from public.feed_items
 where author = 'c1a7d2e9-63b4-4f08-9d51-8e2fb0a37c46'::uuid;
delete from public.journal_entries
 where owner = 'c1a7d2e9-63b4-4f08-9d51-8e2fb0a37c46'::uuid;
delete from public.meals
 where owner = 'c1a7d2e9-63b4-4f08-9d51-8e2fb0a37c46'::uuid;
delete from public.milestones
 where owner = 'c1a7d2e9-63b4-4f08-9d51-8e2fb0a37c46'::uuid;

-- The runner reads the ids the database assigned back out of here, because
-- create_challenge() and restart_challenge() mint their own and the whole
-- divergent-key trap depends on not choosing them.
create table if not exists public.fx22 (k text primary key, v text not null);
truncate public.fx22;

do $$
declare
  v_uid      uuid := 'c1a7d2e9-63b4-4f08-9d51-8e2fb0a37c46';
  v_len      integer := 45;                    -- NOT production's 75
  v_endday   integer := 23;                    -- NOT production's 19
  v_grace    text := coalesce(current_setting('fx22.grace', true), 'open');
  v_ticks    text := coalesce(current_setting('fx22.ticks', true), 'all:absent');
  v_tz       text;
  v_cand     text;
  v_arch     uuid;
  v_repl     uuid;
  v_old      uuid;
  v_squad    uuid;
  v_today    date;
  v_start    date;
  v_day      integer;
  v_k        text;
  v_name     text;
  v_keys     text[];
  v_want     integer;
  v_i        integer;
  v_n        integer;
  v_d1       text := split_part(v_ticks, ':', 1);
  v_d2       text := split_part(v_ticks, ':', 2);
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, false);

  -- ---- pick a timezone that puts the first carried day on the requested
  -- ---- side of its noon deadline, RIGHT NOW. America/New_York is excluded:
  -- ---- it is production's, and the fixture shares no constants with it.
  foreach v_cand in array array[
    'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Anchorage', 'Pacific/Honolulu', 'America/Halifax',
    'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin',
    'Europe/Moscow', 'Asia/Kolkata', 'Asia/Tokyo'
  ] loop
    if (v_grace = 'open'   and (now() at time zone v_cand)::time <  time '12:00')
    or (v_grace = 'closed' and (now() at time zone v_cand)::time >= time '12:00') then
      v_tz := v_cand;
      exit;
    end if;
  end loop;
  if v_tz is null then
    raise exception
      'fixture: no candidate timezone currently has the first carried day % '
      '(it is % UTC). Re-run when one does; refusing to seed a fixture that '
      'silently tests the other branch.', v_grace, now() at time zone 'UTC';
  end if;

  v_today := (now() at time zone v_tz)::date;
  -- endday + 2 so that today is challenge_day(archive) = endday + 2, giving
  -- the replacement TWO days: yesterday and today.
  v_start := v_today - (v_endday + 1);

  v_arch := public.create_challenge('hard', v_start, v_tz, v_len);
  update public.challenges set start_date = v_start, timezone = v_tz
   where id = v_arch;

  perform public.create_squad('Phase 22 rehearsal squad');
  select squad_id into v_squad from public.squad_members where user_id = v_uid;

  -- FOUR customs, not five, with names that appear nowhere in production. Ids
  -- are whatever the database assigns — never chosen to match anything.
  foreach v_name in array array[
    'Cold shower',
    'Stretch 10 min',
    'Call a friend',
    'No screens after 10'
  ] loop
    insert into public.custom_tasks (challenge_id, name, sub, proof, active_from_day)
    values (v_arch, v_name, '', false, 1);
  end loop;

  -- Days 1 .. v_endday-1 : complete, sealed, judged. 6 standard + 4 custom = 10.
  for v_day in 1 .. v_endday - 1 loop
    insert into public.challenge_days (challenge_id, day, task_snapshot)
    values (v_arch, v_day, public.compose_task_set(v_arch, v_day))
    on conflict (challenge_id, day) do nothing;

    select array_agg(t->>'key' order by t->>'key') into v_keys
      from public.challenge_days d, lateral jsonb_array_elements(d.task_snapshot) t
     where d.challenge_id = v_arch and d.day = v_day;

    foreach v_k in array v_keys loop
      insert into public.task_completions (challenge_id, day, task_key)
      values (v_arch, v_day, v_k) on conflict do nothing;
    end loop;
  end loop;

  -- THE DAY WITH NOTHING ON IT. The row exists and carries a full snapshot —
  -- the app froze it that morning — and not one task was ticked. This is the
  -- `zero_ticks` class and it is the state Phase 18's repair path refuses.
  insert into public.challenge_days (challenge_id, day, task_snapshot)
  values (v_arch, v_endday, public.compose_task_set(v_arch, v_endday))
  on conflict (challenge_id, day) do nothing;

  update public.challenge_days
     set sealed_at = now() where challenge_id = v_arch and day < v_endday;
  update public.challenge_days
     set outcome = 'met', evaluated_at = now()
   where challenge_id = v_arch and day between 2 and v_endday - 1;

  -- THE ORIGINAL TICKS ARE BACKDATED HERE, DELIBERATELY, AND ONLY HERE. Real
  -- history is older than the repair; a fixture where every row is younger
  -- than the run lets a "nothing backdated" check pass for the wrong reason.
  update public.task_completions
     set completed_at = ((select start_date + (day - 1) from public.challenges where id = v_arch)
                         + time '20:40') at time zone v_tz
   where challenge_id = v_arch;

  -- best_flame ABOVE flame, so `greatest(best_flame, flame)` is actually
  -- exercised rather than trivially satisfied. Production has them equal.
  update public.challenges
     set flame = v_endday - 1, best_flame = 29, last_evaluated_day = v_endday - 1
   where id = v_arch;

  -- An older feed item that must survive the repair untouched.
  insert into public.feed_items (squad_id, author, kind, text, created_at)
  values (v_squad, v_uid, 'complete', 'finished Day 12.',
          (v_start + 11)::timestamp at time zone v_tz);

  -- Journal entries from the archive's GENUINE days 1 and 2. They share their
  -- day numbers with the replacement's rows and must NOT be re-pointed. Day 2
  -- matters now that the carry is two days deep: a one-day carry could never
  -- have caught a bug that renumbers the wrong day 2.
  insert into public.journal_entries (owner, day, text, created_at)
  values (v_uid, 1, 'Day 1 of 45. Here we go.',
          (v_start::timestamp + time '22:00') at time zone v_tz);
  insert into public.journal_entries (owner, day, text, created_at)
  values (v_uid, 2, 'Day 2. Legs hurt.',
          ((v_start + 1)::timestamp + time '21:15') at time zone v_tz);

  -- A meal logged while the archive was still live, on the day it ended — so
  -- it already carries the archive's own day number and must not move either.
  insert into public.meals (owner, day, text, created_at)
  values (v_uid, v_endday, 'Oats, before it all went wrong',
          ((v_today - 2)::timestamp + time '07:30') at time zone v_tz);

  -- And one written YESTERDAY MORNING, before the miss was judged at local
  -- noon. The archive was still live, so it already carries the archive's day
  -- number for that date — the same day the replacement's day 1 is about to be
  -- carried onto. It must not move, and it must not be renumbered twice.
  insert into public.meals (owner, day, text, created_at)
  values (v_uid, v_endday + 1, 'Toast, the morning it ended',
          ((v_today - 1)::timestamp + time '07:30') at time zone v_tz);

  -- ---- THE ENGINE JUDGES THE EMPTY DAY -------------------------------------
  -- Not hand-written. evaluate_challenge() sets outcome 'missed', leaves
  -- sealed_at null, posts the miss feed item and calls restart_challenge().
  select public.evaluate_challenge(v_arch) into v_n;
  raise notice 'fixture: tz % (%), evaluate_challenge judged % day(s)',
    v_tz, v_grace, v_n;

  select id into v_repl from public.challenges
   where owner = v_uid and ended_at is null;
  if v_repl is null then
    raise exception
      'fixture: the engine did not restart the challenge. Day % has probably '
      'not closed yet in %.', v_endday, v_tz;
  end if;
  -- THE TIMELINE, PUT BACK WHERE IT BELONGS.
  --
  -- evaluate_challenge() ran a second ago, so it stamped ended_at = now() and
  -- restart_challenge() started the replacement on ITS today. Production's
  -- history is a day older than that: the miss was judged YESTERDAY at local
  -- noon and the replacement has been running since yesterday.
  --
  -- This is not cosmetic. The repair decides which day-numbered private rows
  -- belong to the replacement by comparing created_at against the archive's
  -- ended_at. Leave ended_at at now() and every row written during the
  -- replacement's day 1 looks OLDER than the restart, so the re-pointing step
  -- silently skips them — which is exactly what the first run of this fixture
  -- showed: 2 rows moved where 5 should have. The defect was here, not in the
  -- repair, and a fixture whose clock is wrong quietly tests the wrong thing.
  update public.challenges
     set ended_at = ((v_today - 1)::timestamp + time '12:05') at time zone v_tz
   where id = v_arch;
  update public.challenges set start_date = v_today - 1 where id = v_repl;

  -- ---- THE SECOND RETIRED REPLACEMENT --------------------------------------
  -- The ff81767a analogue: an earlier attempt, already retired by an earlier
  -- repair, still pointing at the same archive. ended_reason null is exactly
  -- what this script's own 'retire' branch leaves behind.
  insert into public.challenges
    (owner, base_tier, start_date, timezone, duration_days, restarted_from,
     ended_at, ended_reason, ended_on_day, flame, best_flame, last_evaluated_day)
  values
    (v_uid, 'hard', v_start + 10, v_tz, v_len, v_arch,
     ((v_start + 12)::timestamp + time '16:05') at time zone v_tz,
     null, 2, 0, 29, 1)
  returning id into v_old;

  -- ---- WHAT THE ACCOUNT HOLDER ACTUALLY DID --------------------------------
  -- restart_challenge() already froze the replacement's day 1. Day 2 is
  -- frozen here only if the parameter says the app has been opened today.
  for v_day in 1 .. 2 loop
    if (case when v_day = 1 then v_d1 else v_d2 end) = 'absent' then
      delete from public.challenge_days
       where challenge_id = v_repl and day = v_day;
      raise notice 'fixture: replacement day % has NO challenge_days row', v_day;
      continue;
    end if;

    insert into public.challenge_days (challenge_id, day, task_snapshot)
    values (v_repl, v_day, public.compose_task_set(v_repl, v_day))
    on conflict (challenge_id, day) do nothing;

    select array_agg(t->>'key' order by t->>'key') into v_keys
      from public.challenge_days d, lateral jsonb_array_elements(d.task_snapshot) t
     where d.challenge_id = v_repl and d.day = v_day;

    v_want := case (case when v_day = 1 then v_d1 else v_d2 end)
                when 'all'  then array_length(v_keys, 1)
                when 'none' then 0
                else least((case when v_day = 1 then v_d1 else v_d2 end)::integer,
                           array_length(v_keys, 1))
              end;

    for v_i in 1 .. v_want loop
      insert into public.task_completions (challenge_id, day, task_key)
      values (v_repl, v_day, v_keys[v_i]) on conflict do nothing;
    end loop;
    raise notice 'fixture: replacement day % has % of % task(s) ticked',
      v_day, v_want, array_length(v_keys, 1);
  end loop;

  -- DAY 1 WAS SEALED BY THE APP, through the real RPC, inside the grace
  -- window — which is what production says happened at 09:35. seal_day() pays
  -- a flame on the REPLACEMENT; the repair must recompute over the archive's
  -- day series and not inherit that number.
  if public.day_is_met(v_repl, 1) then
    begin
      perform public.seal_day(1);
      raise notice 'fixture: seal_day(1) sealed the replacement''s day 1 (flame %)',
        (select flame from public.challenges where id = v_repl);
    exception when others then
      raise notice 'fixture: seal_day(1) refused: %', sqlerrm;
    end;
  end if;

  -- Day-numbered private rows written on the replacement's day 1 and day 2.
  -- Every one of these must come across to the matching archive day.
  insert into public.journal_entries (owner, day, text, created_at)
  values (v_uid, 1, 'Starting over. Again.',
          ((v_today - 1)::timestamp + time '21:00') at time zone v_tz);
  insert into public.meals (owner, day, text, created_at)
  values (v_uid, 1, 'Chicken and rice',
          ((v_today - 1)::timestamp + time '19:00') at time zone v_tz);
  insert into public.milestones (owner, title, done, hit_on_day, created_at)
  values (v_uid, 'First workout back', true, 1,
          ((v_today - 1)::timestamp + time '18:00') at time zone v_tz);
  insert into public.workout_logs
    (owner, challenge_id, day, task_key, activity_type, duration_seconds)
  values (v_uid, v_repl, 1, 'workout1', 'Row', 2700);
  -- And one on day 2, today, which must land on the SECOND carried archive day
  -- even when that day has nothing ticked on it.
  insert into public.journal_entries (owner, day, text, created_at)
  values (v_uid, 2, 'Day two of the restart.', now());

  insert into public.fx22 (k, v) values
    ('owner',       v_uid::text),
    ('archive',     v_arch::text),
    ('replacement', v_repl::text),
    ('old_repl',    v_old::text),
    ('squad',       v_squad::text),
    ('end_day',     v_endday::text),
    ('timezone',    v_tz),
    ('grace',       v_grace),
    ('local_date',  v_today::text),
    ('carry1',      (v_endday + 1)::text),
    ('carry2',      (v_endday + 2)::text),
    ('feed_item',   (select id::text from public.feed_items
                      where author = v_uid and kind = 'miss'
                      order by created_at desc limit 1)),
    ('feed_text',   (select text from public.feed_items
                      where author = v_uid and kind = 'miss'
                      order by created_at desc limit 1));
end $$;

\echo 'phase22 fixture seeded'
select k, v from public.fx22 order by k;
