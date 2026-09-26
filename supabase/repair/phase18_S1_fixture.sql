-- =============================================================================
-- PHASE 18 / S1 — REHEARSAL FIXTURE (LOCAL STUB ONLY, NEVER PRODUCTION)
--
-- Seeds one account whose shape reproduces "I did the work, I forgot to tap",
-- so phase18_S1_diagnose.sql can be RUN and its grid READ before it is pointed
-- at the real database.
--
-- WHY THIS EXISTS. A diagnostic that has never executed is a guess about what
-- Postgres will do with it, and this project has twice shipped a green suite
-- alongside a real defect. The point of the fixture is not that the numbers
-- are realistic — it is that every branch of the evidence classifier gets a
-- day, so the report is seen printing each label rather than assumed to.
--
-- IT IS DESTRUCTIVE and it targets a hardcoded test uuid. It must only ever be
-- run against the throwaway `ranked_test` database that scripts/test-rls.sh
-- builds. There is a guard at the top that refuses any database not named
-- ranked_test.
--
-- THE SHAPE IT BUILDS, on a 75-day HARD challenge sitting at day 12, 09:00
-- local (so the grace window is open and day 11 is still finishable):
--
--   day  1-6   met, sealed, judged           -> already_met
--   day  7     6 of 7 ticked, judged missed  -> partial      (the forgotten tap)
--   day  8     0 of 7 ticked, frozen, missed -> zero_ticks
--   day  9     no challenge_days row at all  -> never_opened
--   day 10     all 7 ticked, NOT yet judged  -> met_unjudged
--   day 11     open (before noon), 3 of 7    -> open_now
--   day 12     today, 0 of 7                 -> open_now
--
-- Day 7 is the case the brief is really about; day 9 is the weakest case and
-- is there so the report is seen refusing to dress it up.
--
-- Hard rules restart the challenge on a miss, so this deliberately does NOT
-- run the evaluator — it writes the outcomes directly, because the point is to
-- exercise the DIAGNOSTIC's reading of a mixed board, not to re-prove the
-- engine (missed_day_test.sql already does that).
-- =============================================================================

\set QUIET on
\pset pager off

do $$
begin
  if current_database() <> 'ranked_test' then
    raise exception
      'REFUSED: phase18_S1_fixture.sql is destructive and may only run against '
      'the local ranked_test stub. Current database is %.', current_database();
  end if;
end $$;

-- ---------------------------------------------------------------- the account
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000f18a1', 'phase18-forgot@test.dev')
on conflict (id) do nothing;

-- Start clean: the fixture is re-runnable, which is the same standard the
-- repair scripts are held to.
delete from public.challenges
 where owner = '00000000-0000-0000-0000-0000000f18a1'::uuid;
delete from public.feed_items
 where author = '00000000-0000-0000-0000-0000000f18a1'::uuid;

do $$
declare
  v_uid       uuid := '00000000-0000-0000-0000-0000000f18a1';
  v_ch        uuid;
  v_squad     uuid;
  v_utc_hour  integer := extract(hour from (now() at time zone 'UTC'))::integer;
  v_shift     integer;
  v_tz        text;
  v_day       integer;
  v_keys      text[];
  v_k         text;
  v_i         integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, false);

  -- Put the challenge in a zone where it is 09:00 right now, so day 12 is
  -- today and day 11 is still inside the grace window. Same trick, and the
  -- same reasoning, as t_set_clock() in grace_window_test.sql: anchor on the
  -- CHALLENGE's zone, never the server's date.
  v_shift := 9 - v_utc_hour;
  while v_shift < -11 loop v_shift := v_shift + 24; end loop;
  while v_shift >  14 loop v_shift := v_shift - 24; end loop;
  v_tz := case when v_shift >= 0 then 'Etc/GMT-' || v_shift
                                 else 'Etc/GMT+' || abs(v_shift) end;

  v_ch := public.create_challenge('hard', current_date, v_tz, 75);

  -- Day 12 today => start_date is 11 days before today IN THAT ZONE.
  update public.challenges
     set start_date = ((now() at time zone v_tz)::date - 11),
         timezone   = v_tz
   where id = v_ch;

  -- A squad, so section 7 has a miss feed item to show.
  perform public.create_squad('Phase 18 rehearsal');
  select squad_id into v_squad from public.squad_members where user_id = v_uid;

  -- Freeze days 1..12 except day 9, which is the "never opened" case.
  for v_day in 1..12 loop
    if v_day <> 9 then
      insert into public.challenge_days (challenge_id, day, task_snapshot)
      values (v_ch, v_day, public.compose_task_set(v_ch, v_day))
      on conflict (challenge_id, day) do nothing;
    end if;
  end loop;

  -- Tick tasks. completed_at is left at its default now() throughout: the
  -- fixture does not backdate either, for the same reason the repair will not.
  for v_day in 1..12 loop
    if v_day = 9 then continue; end if;

    select array_agg(t->>'key' order by t->>'key') into v_keys
      from public.challenge_days d,
           lateral jsonb_array_elements(d.task_snapshot) t
     where d.challenge_id = v_ch and d.day = v_day;

    v_i := 0;
    foreach v_k in array v_keys loop
      v_i := v_i + 1;
      -- how many of this day's tasks get ticked
      if (v_day between 1 and 6)                       -- fully met
         or v_day = 10                                 -- fully met, unjudged
         or (v_day = 7  and v_i < array_length(v_keys, 1))   -- all but one
         or (v_day = 11 and v_i <= 3)                       -- part of an open day
      then
        insert into public.task_completions (challenge_id, day, task_key)
        values (v_ch, v_day, v_k)
        on conflict do nothing;
      end if;
    end loop;
  end loop;

  -- Judge days 1..8 the way the evaluator would have. Written directly rather
  -- than through evaluate_challenge() because Hard restarts on a miss and this
  -- fixture needs the challenge to stay live so the mixed board is visible.
  -- forbid_snapshot_mutation() permits exactly these three columns, which is
  -- also why the repair in S3 will not need to touch that trigger either.
  update public.challenge_days
     set outcome = 'met', evaluated_at = now(),
         sealed_at = coalesce(sealed_at, now())
   where challenge_id = v_ch and day between 1 and 6;

  update public.challenge_days
     set outcome = 'missed', evaluated_at = now()
   where challenge_id = v_ch and day in (7, 8);

  -- Flame: six met days, then day 7 missed zeroes it. best_flame remembers.
  update public.challenges
     set flame = 0, best_flame = 6, last_evaluated_day = 8, missed_notice_day = 8
   where id = v_ch;

  if v_squad is not null then
    insert into public.feed_items (squad_id, author, kind, text)
    values (v_squad, v_uid, 'miss',
            'missed Day 7. Streak reset to zero.');
  end if;
end $$;

\echo 'phase18 fixture seeded: phase18-forgot@test.dev'

-- =============================================================================
-- ACCOUNT B — THE HARD RESTART
--
-- Hard rules set tier_rules.restarts_challenge, so a miss ARCHIVES the attempt
-- and opens a replacement at day 1. That is a different report shape and, on a
-- Hard challenge, the likelier one. Without this the whole archive branch of
-- the diagnostic — section 2's "did the miss END a challenge", section 3's
-- second row, section 4's [ARCHIVED CHALLENGE] block — would never have run.
--
-- It goes through the REAL restart_challenge(), not a hand-written archive, so
-- what the report reads is what the engine actually leaves behind.
-- =============================================================================

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000f18b2', 'phase18-restart@test.dev')
on conflict (id) do nothing;

delete from public.challenges
 where owner = '00000000-0000-0000-0000-0000000f18b2'::uuid;
delete from public.feed_items
 where author = '00000000-0000-0000-0000-0000000f18b2'::uuid;

do $$
declare
  v_uid  uuid := '00000000-0000-0000-0000-0000000f18b2';
  v_old  uuid;
  v_new  uuid;
  v_day  integer;
  v_keys text[];
  v_k    text;
  v_i    integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, false);

  v_old := public.create_challenge('hard', current_date, 'UTC', 75);
  -- The archived attempt reached day 5.
  update public.challenges
     set start_date = (current_date - 4) where id = v_old;

  for v_day in 1..5 loop
    insert into public.challenge_days (challenge_id, day, task_snapshot)
    values (v_old, v_day, public.compose_task_set(v_old, v_day))
    on conflict do nothing;

    select array_agg(t->>'key' order by t->>'key') into v_keys
      from public.challenge_days d, lateral jsonb_array_elements(d.task_snapshot) t
     where d.challenge_id = v_old and d.day = v_day;

    v_i := 0;
    foreach v_k in array v_keys loop
      v_i := v_i + 1;
      -- days 1-4 fully done; day 5 all but the last task — the forgotten tap
      if v_day <= 4 or v_i < array_length(v_keys, 1) then
        insert into public.task_completions (challenge_id, day, task_key)
        values (v_old, v_day, v_k) on conflict do nothing;
      end if;
    end loop;
  end loop;

  update public.challenge_days
     set outcome = 'met', evaluated_at = now(), sealed_at = now()
   where challenge_id = v_old and day between 1 and 4;
  update public.challenge_days
     set outcome = 'missed', evaluated_at = now()
   where challenge_id = v_old and day = 5;
  update public.challenges
     set flame = 4, best_flame = 4, last_evaluated_day = 5 where id = v_old;

  -- The real thing.
  v_new := public.restart_challenge(v_old, 5, 'missed_day');
end $$;

\echo 'phase18 fixture seeded: phase18-restart@test.dev (archived + replacement)'
