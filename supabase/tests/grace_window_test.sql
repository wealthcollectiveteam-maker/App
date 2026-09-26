-- =============================================================================
-- Executable proofs for the grace window (0011).
--
-- Run after setup_local.sql + every migration, as the postgres superuser:
--   psql -v ON_ERROR_STOP=1 -f grace_window_test.sql
--
-- HOW THE CLOCK IS MOVED — and why it is moved this way.
--
--   The window turns on the TIME OF DAY in the challenge's own timezone, so
--   moving start_date (the lever every other suite here uses) cannot reach
--   it: that moves the date, not the hour. now() is not stubbed either — the
--   engine must be proved against the real clock or the proof is about a
--   fixture.
--
--   So the TIMEZONE is the lever. For a fixed instant, choosing the zone
--   chooses the local hour, and Etc/GMT±N gives a whole-hour offset for every
--   hour of the day. t_set_clock() below puts a challenge at "day N, 11am
--   local" or "day N, 1pm local" whatever time it happens to be when the
--   suite runs — and it does it by making the challenge sit in a zone the
--   SERVER is not in, which is exactly the arrangement the Phase 12 bug hid
--   in.
--
-- Every check raises on failure. A clean exit means all proofs hold.
-- =============================================================================

\set QUIET on
\pset pager off

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000e0f1', 'grace-late@test.dev'),
  ('00000000-0000-0000-0000-00000000e0f2', 'grace-miss@test.dev'),
  ('00000000-0000-0000-0000-00000000e0f3', 'grace-jwt@test.dev'),
  ('00000000-0000-0000-0000-00000000e0f4', 'grace-mate@test.dev'),
  ('00000000-0000-0000-0000-00000000e0f5', 'grace-finish@test.dev')
on conflict do nothing;

create or replace procedure test_login(p_user uuid)
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
end $$;

-- Put a challenge at "day p_day, p_hour o'clock, local" — by moving it into a
-- timezone in which right now IS p_hour, then anchoring start_date on that
-- same zone. Anchoring on the CHALLENGE's zone rather than the server's date
-- is the Phase 12 lesson; getting it wrong here would make the suite disagree
-- with the engine for an hour a day and blame the engine.
create or replace procedure t_set_clock(
  p_challenge uuid, p_day integer, p_hour integer)
language plpgsql as $$
declare
  v_utc_hour integer := extract(hour from (now() at time zone 'UTC'))::integer;
  v_shift    integer;
  v_tz       text;
begin
  v_shift := p_hour - v_utc_hour;
  while v_shift < -11 loop v_shift := v_shift + 24; end loop;
  while v_shift >  14 loop v_shift := v_shift - 24; end loop;
  -- Etc/GMT carries the POSIX sign convention: Etc/GMT+5 is UTC-5.
  if v_shift >= 0 then v_tz := 'Etc/GMT-' || v_shift;
  else                 v_tz := 'Etc/GMT+' || (-v_shift);
  end if;

  update public.challenges set timezone = v_tz where id = p_challenge;
  update public.challenges
     set start_date = (now() at time zone v_tz)::date - (p_day - 1)
   where id = p_challenge;

  -- Prove the lever actually moved what it claims to have moved.
  if (select extract(hour from public.challenge_local_now(c))::integer
        from public.challenges c where c.id = p_challenge) <> p_hour then
    raise exception 't_set_clock: local hour is not %', p_hour;
  end if;
  if (select public.challenge_day(c) from public.challenges c
       where c.id = p_challenge) <> p_day then
    raise exception 't_set_clock: challenge day is not %', p_day;
  end if;
end $$;

-- Complete every task in a day's snapshot, server-side, without sealing.
create or replace procedure t_do_day(p_challenge uuid, p_day integer)
language plpgsql as $$
declare d public.challenge_days;
begin
  select * into d from public.challenge_days
    where challenge_id = p_challenge and day = p_day;
  if d.id is null then
    insert into public.challenge_days (challenge_id, day, task_snapshot)
    values (p_challenge, p_day, public.compose_task_set(p_challenge, p_day))
    returning * into d;
  end if;
  insert into public.task_completions (challenge_id, day, task_key)
  select p_challenge, p_day, t->>'key'
  from jsonb_array_elements(d.task_snapshot) t
  on conflict do nothing;
end $$;

create or replace function t_challenge(p_owner uuid) returns uuid
language sql stable as $$
  select id from public.challenges
   where owner = p_owner and ended_at is null
   order by start_date desc, created_at desc limit 1;
$$;

-- A clean slate for one owner. challenge_days cannot be deleted directly —
-- the immutability trigger refuses, which is the point of it — so the whole
-- CHALLENGE goes and the cascade takes its days with it. That is the same
-- path delete_account() uses, and the only one the trigger lets through.
create or replace procedure t_fresh(p_owner uuid, p_days integer default 75)
language plpgsql as $$
begin
  delete from public.challenges where owner = p_owner;
  call test_login(p_owner);
  perform public.create_challenge('hard', 'UTC', p_days);
end $$;

-- =============================================================================
-- PROOF 1 — the clock itself: which day is open, and when
-- =============================================================================
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-00000000e0f1';
  v_c   public.challenges;
  v_id  uuid;
begin
  call test_login(v_uid);
  insert into public.profiles (id, name) values (v_uid, 'Late') on conflict do nothing;
  v_id := public.create_challenge('hard', 'UTC', 75);

  call t_set_clock(v_id, 5, 11);
  select * into v_c from public.challenges where id = v_id;
  if public.earliest_open_day(v_c) <> 4 then
    raise exception 'FAIL: at 11am on day 5 the earliest open day is %, expected 4',
      public.earliest_open_day(v_c);
  end if;
  if public.last_closed_day(v_c) <> 3 then
    raise exception 'FAIL: at 11am the last closed day is %, expected 3',
      public.last_closed_day(v_c);
  end if;
  if not public.day_is_open(v_c, 4) or not public.day_is_open(v_c, 5) then
    raise exception 'FAIL: days 4 and 5 should both be open at 11am';
  end if;
  if public.day_is_open(v_c, 3) then
    raise exception 'FAIL: day 3 is open at 11am on day 5';
  end if;
  if public.day_is_open(v_c, 6) then
    raise exception 'FAIL: a future day is open';
  end if;

  call t_set_clock(v_id, 5, 13);
  select * into v_c from public.challenges where id = v_id;
  if public.earliest_open_day(v_c) <> 5 then
    raise exception 'FAIL: at 1pm the earliest open day is %, expected 5',
      public.earliest_open_day(v_c);
  end if;
  if public.last_closed_day(v_c) <> 4 then
    raise exception 'FAIL: at 1pm the last closed day is %, expected 4',
      public.last_closed_day(v_c);
  end if;
  if public.day_is_open(v_c, 4) then
    raise exception 'FAIL: yesterday is still open at 1pm';
  end if;

  -- Day 1 has no yesterday to offer, at any hour.
  call t_set_clock(v_id, 1, 11);
  select * into v_c from public.challenges where id = v_id;
  if public.earliest_open_day(v_c) <> 1 then
    raise exception 'FAIL: day 1 offers day % as open', public.earliest_open_day(v_c);
  end if;

  raise notice 'PASS: before noon two days are open, from noon only today, and day 1 never offers a day 0';
end $$;

-- =============================================================================
-- PROOF 2 (B4a) — a task completed against YESTERDAY at 11am lands on
--                 yesterday's row, not today's
-- =============================================================================
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-00000000e0f1';
  v_id  uuid;
  v_n   integer;
  v_d4  integer;
  v_d5  integer;
begin
  -- Yesterday was never opened: no snapshot row at all. The window has to
  -- freeze it from the config in force then before it can be completed.
  call t_fresh(v_uid);
  v_id := t_challenge(v_uid);
  call t_set_clock(v_id, 5, 11);

  perform public.complete_task('water', null, 4);

  select count(*) into v_n from public.challenge_days
   where challenge_id = v_id and day = 4;
  if v_n <> 1 then raise exception 'FAIL: day 4 was not frozen (% rows)', v_n; end if;

  select count(*) into v_d4 from public.task_completions
   where challenge_id = v_id and day = 4 and task_key = 'water';
  select count(*) into v_d5 from public.task_completions
   where challenge_id = v_id and day = 5;
  if v_d4 <> 1 then
    raise exception 'FAIL: the completion did not land on day 4 (found %)', v_d4;
  end if;
  if v_d5 <> 0 then
    raise exception 'FAIL: % completion(s) leaked onto day 5', v_d5;
  end if;

  raise notice 'PASS (a): at 11am a task completed against yesterday lands on day 4 — day 5 untouched';
end $$;

-- =============================================================================
-- PROOF 3 (B4b) — the same attempt at 1pm is refused
-- =============================================================================
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-00000000e0f1';
  v_id  uuid;
  v_msg text;
  v_n   integer;
begin
  call test_login(v_uid);
  v_id := t_challenge(v_uid);
  call t_set_clock(v_id, 5, 13);

  begin
    perform public.complete_task('read', null, 4);
    raise exception 'FAIL: completing yesterday at 1pm was allowed';
  exception when others then
    v_msg := sqlerrm;
    if v_msg like 'FAIL:%' then raise; end if;
  end;

  select count(*) into v_n from public.task_completions
   where challenge_id = v_id and day = 4 and task_key = 'read';
  if v_n <> 0 then raise exception 'FAIL: a row was written anyway'; end if;

  -- Sealing and un-ticking a closed day are refused on the same terms.
  begin
    perform public.seal_day(4);
    raise exception 'FAIL: sealing yesterday at 1pm was allowed';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.uncomplete_task('water', 4);
    raise exception 'FAIL: un-ticking yesterday at 1pm was allowed';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  raise notice 'PASS (b): at 1pm complete/seal/uncomplete against yesterday are all refused — "%"', v_msg;
end $$;

-- =============================================================================
-- PROOF 4 (B4c) — a day finished late, inside the window, scores MET and the
--                 streak continues
-- =============================================================================
do $$
declare
  v_uid   uuid := '00000000-0000-0000-0000-00000000e0f1';
  v_id    uuid;
  v_c     public.challenges;
  v_flame integer;
  v_sealed timestamptz;
  v_out   text;
  v_judged integer;
begin
  -- Days 1-3 done and already judged; day 4 left short; it is 11am on day 5.
  call t_fresh(v_uid);
  v_id := t_challenge(v_uid);
  call t_set_clock(v_id, 5, 11);
  call t_do_day(v_id, 1);
  call t_do_day(v_id, 2);
  call t_do_day(v_id, 3);
  call t_do_day(v_id, 4);
  delete from public.task_completions
   where challenge_id = v_id and day = 4 and task_key = 'water';
  update public.challenges set last_evaluated_day = 1, flame = 1 where id = v_id;

  -- 11am: days 2 and 3 have closed and are judged; day 4 has NOT closed and
  -- must not be touched, even though it is currently short.
  v_judged := public.evaluate_challenge(v_id);
  select outcome into v_out from public.challenge_days
   where challenge_id = v_id and day = 4;
  if v_out is not null then
    raise exception 'FAIL: day 4 was judged "%" while still inside its window', v_out;
  end if;
  select * into v_c from public.challenges where id = v_id;
  if v_c.last_evaluated_day <> 3 then
    raise exception 'FAIL: the cursor reached day %, expected 3', v_c.last_evaluated_day;
  end if;
  if v_c.ended_at is not null then
    raise exception 'FAIL: the challenge was archived inside the window';
  end if;

  -- The user finishes yesterday at 11am, through the RPC, and seals it.
  perform public.complete_task('water', null, 4);
  perform public.seal_day(4);
  select flame into v_flame from public.challenges where id = v_id;
  select sealed_at into v_sealed from public.challenge_days
   where challenge_id = v_id and day = 4;
  if v_flame <> 4 or v_sealed is null then
    raise exception 'FAIL: seal_day(4) inside the window did not seal and pay: flame %, sealed_at %',
      v_flame, v_sealed;
  end if;

  -- Noon passes. The evaluator judges the day it has now closed.
  call t_set_clock(v_id, 5, 13);
  perform public.evaluate_challenge(v_id);

  -- PAY-ONCE (0011:308-310), asserted directly rather than by arithmetic on
  -- the final flame (Phase 30, A1): the client's seal paid the flame; the
  -- evaluator's pass over the now-closed day must neither pay it again nor
  -- re-stamp the seal. This is the contract the check-in screen's seal call
  -- relies on when it seals yesterday inside the window.
  if (select flame from public.challenges where id = v_id) <> v_flame then
    raise exception 'FAIL: evaluate_challenge paid day 4 a second time: flame % -> %',
      v_flame, (select flame from public.challenges where id = v_id);
  end if;
  if (select sealed_at from public.challenge_days
       where challenge_id = v_id and day = 4) is distinct from v_sealed then
    raise exception 'FAIL: the evaluator re-stamped sealed_at on a day the client had sealed';
  end if;

  select outcome into v_out from public.challenge_days
   where challenge_id = v_id and day = 4;
  if v_out is distinct from 'met' then
    raise exception 'FAIL: a day finished late scored "%", expected met', v_out;
  end if;
  select * into v_c from public.challenges where id = v_id;
  if v_c.ended_at is not null then
    raise exception 'FAIL: a day finished late still archived the challenge';
  end if;
  if v_c.last_evaluated_day <> 4 then
    raise exception 'FAIL: cursor is %, expected 4', v_c.last_evaluated_day;
  end if;
  if v_c.flame <> 4 then
    raise exception 'FAIL: flame is %, expected 4 (days 1-4 all met)', v_c.flame;
  end if;
  -- Sealed once, not twice. flame above is the real proof: day 4 was sealed
  -- by the USER inside the window and then judged met by the evaluator, and
  -- it paid exactly one flame between them — 5 would mean a double count.
  -- Days 2 and 3 were sealed retroactively by the evaluator; day 1 is
  -- unsealed here because this fixture never sealed it and the evaluator
  -- never judges day 1.
  if (select count(*) from public.challenge_days
       where challenge_id = v_id and sealed_at is not null) <> 3 then
    raise exception 'FAIL: sealed-day count is %, expected 3',
      (select count(*) from public.challenge_days
        where challenge_id = v_id and sealed_at is not null);
  end if;

  raise notice 'PASS (c): day 4 finished at 11am scores met after noon, flame 4, nothing archived, no double-count';
end $$;

-- =============================================================================
-- PROOF 5 (B4d) — a day left short past noon is STILL a miss and STILL
--                 archives. The window must not have disabled the rule.
-- =============================================================================
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-00000000e0f2';
  v_old uuid;
  v_new uuid;
  v_c   public.challenges;
  v_sq  uuid;
begin
  call test_login(v_uid);
  insert into public.profiles (id, name) values (v_uid, 'Miss') on conflict do nothing;
  v_old := public.create_challenge('hard', 'UTC', 75);
  select id into v_sq from public.create_squad('Grace squad');

  call t_set_clock(v_old, 5, 11);
  call t_do_day(v_old, 2);
  call t_do_day(v_old, 3);
  call t_do_day(v_old, 4);
  delete from public.task_completions
   where challenge_id = v_old and day = 4 and task_key = 'photo';

  -- 11am: day 4 is short but still open. NOTHING may happen to it.
  perform public.evaluate_challenge(v_old);
  select * into v_c from public.challenges where id = v_old;
  if v_c.ended_at is not null then
    raise exception 'FAIL: archived at 11am, while day 4 was still finishable';
  end if;
  if (select outcome from public.challenge_days
       where challenge_id = v_old and day = 4) is not null then
    raise exception 'FAIL: day 4 was judged inside its own window';
  end if;

  -- 1pm: the window has closed and nothing was done. The rule applies.
  call t_set_clock(v_old, 5, 13);
  perform public.evaluate_challenge(v_old);

  select * into v_c from public.challenges where id = v_old;
  if v_c.ended_at is null then
    raise exception 'FAIL: a day left short past noon did not archive the attempt';
  end if;
  if v_c.ended_reason <> 'missed_day' or v_c.ended_on_day <> 4 then
    raise exception 'FAIL: ended % on day %', v_c.ended_reason, v_c.ended_on_day;
  end if;
  if (select outcome from public.challenge_days
       where challenge_id = v_old and day = 4) <> 'missed' then
    raise exception 'FAIL: day 4 is not scored missed';
  end if;

  v_new := t_challenge(v_uid);
  if v_new is null or v_new = v_old then
    raise exception 'FAIL: no replacement challenge was started';
  end if;
  if not exists (select 1 from public.feed_items
                  where author = v_uid and kind = 'miss') then
    raise exception 'FAIL: the squad was not told';
  end if;

  raise notice 'PASS (d): the window delays the judgement and changes nothing else — short past noon still archives at day 4';
end $$;

-- =============================================================================
-- PROOF 6 (B4e) — nothing lets a user reach a day older than yesterday.
--                 Through the API, as the user, with their own JWT.
-- =============================================================================
reset role;
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-00000000e0f3';
  v_id  uuid;
begin
  call test_login(v_uid);
  insert into public.profiles (id, name) values (v_uid, 'Jwt') on conflict do nothing;
  v_id := public.create_challenge('hard', 'UTC', 75);
  call t_set_clock(v_id, 5, 11);
  call t_do_day(v_id, 3);
end $$;

set role authenticated;
call test_login('00000000-0000-0000-0000-00000000e0f3');

do $$
declare
  v_id   uuid;
  v_msg  text;
  v_kept integer;
  d      integer;
begin
  select id into v_id from public.challenges
   where owner = auth.uid() and ended_at is null;

  -- Every day older than yesterday, and the future, refused one at a time.
  foreach d in array array[1, 2, 3, 6, 7] loop
    begin
      perform public.complete_task('water', null, d);
      raise exception 'FAIL: day % was completable', d;
    exception when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      v_msg := sqlerrm;
    end;
  end loop;

  -- Day 3 was already three-quarters done; the refusal must not have added
  -- to it, and must not have created day 1 or 2 rows either.
  select count(*) into v_kept from public.challenge_days
   where challenge_id = v_id and day in (1, 2);
  if v_kept <> 0 then
    raise exception 'FAIL: the refusal froze % closed day(s)', v_kept;
  end if;

  -- get_or_freeze_day is the freezing primitive and is granted to the client,
  -- so it has to hold the same line on its own.
  begin
    perform public.get_or_freeze_day(2);
    raise exception 'FAIL: get_or_freeze_day froze a closed day';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- And the privilege wall underneath: no INSERT grant, so a hand-written
  -- statement cannot reach task_completions at all.
  begin
    insert into public.task_completions (challenge_id, day, task_key)
    values (v_id, 1, 'water');
    raise exception 'FAIL: authenticated inserted a completion directly';
  exception when insufficient_privilege then
    null;
  when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  raise notice 'PASS (e): days 1,2,3,6,7 all refused through the RPC with a real JWT — "%", and direct INSERT is denied by privilege', v_msg;
end $$;

-- =============================================================================
-- PROOF 7 (B4f) — snapshots stay immutable. Only completions move.
-- =============================================================================
do $$
declare
  v_id uuid;
  v_before jsonb;
  v_after  jsonb;
begin
  select id into v_id from public.challenges
   where owner = auth.uid() and ended_at is null;
  perform public.complete_task('water', null, 4);   -- freezes day 4
  select task_snapshot into v_before from public.challenge_days
   where challenge_id = v_id and day = 4;

  -- Wall 1: privilege. authenticated holds SELECT on challenge_days, nothing more.
  begin
    update public.challenge_days set task_snapshot = '[]'::jsonb
     where challenge_id = v_id and day = 4;
    raise exception 'FAIL: authenticated rewrote yesterday''s snapshot';
  exception when insufficient_privilege then
    null;
  when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  select task_snapshot into v_after from public.challenge_days
   where challenge_id = v_id and day = 4;
  if v_after is distinct from v_before then
    raise exception 'FAIL: the snapshot changed';
  end if;

  -- ...and the completions on that same open day DO move. The control that
  -- proves the refusal above is about the task set, not about the day.
  perform public.uncomplete_task('water', 4);
  if exists (select 1 from public.task_completions
              where challenge_id = v_id and day = 4 and task_key = 'water') then
    raise exception 'FAIL: the completion did not move';
  end if;
  perform public.complete_task('water', null, 4);

  raise notice 'PASS (f, wall 1 — privilege): yesterday''s task set is unwritable by the client, its completions are not';
end $$;

reset role;

do $$
declare
  v_id uuid;
  v_msg text;
begin
  select id into v_id from public.challenges
   where owner = '00000000-0000-0000-0000-00000000e0f3' and ended_at is null;
  -- Wall 2: the trigger, which does not care who you are. This is the wall
  -- that would be load-bearing if the grant above were ever widened.
  begin
    update public.challenge_days set task_snapshot = '[]'::jsonb
     where challenge_id = v_id and day = 4;
    raise exception 'FAIL: a privileged rewrite of an open day''s snapshot succeeded';
  exception when others then
    v_msg := sqlerrm;
    if v_msg like 'FAIL:%' then raise; end if;
    if v_msg <> 'day snapshots are immutable' then
      raise exception 'FAIL: refused with the wrong error: %', v_msg;
    end if;
  end;
  raise notice 'PASS (f, wall 2 — trigger): % — even as postgres, on a day the window has re-opened', v_msg;
end $$;

-- =============================================================================
-- PROOF 8 (B2) — what get_day_window() gives the app, in all three states
-- =============================================================================
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-00000000e0f3';
  v_id  uuid;
  r     record;
  v_n   integer;
begin
  call test_login(v_uid);
  v_id := t_challenge(v_uid);

  -- 11am: two rows, yesterday open.
  call t_set_clock(v_id, 5, 11);
  select count(*) into v_n from public.get_day_window();
  if v_n <> 2 then raise exception 'FAIL: % window row(s) at 11am, expected 2', v_n; end if;
  select * into r from public.get_day_window() where day = 4;
  if not r.is_open or r.is_today then
    raise exception 'FAIL: day 4 reads is_open=% is_today=%', r.is_open, r.is_today;
  end if;
  if r.closes_at <= now() then
    raise exception 'FAIL: yesterday closes_at is in the past while it is open';
  end if;
  select * into r from public.get_day_window() where day = 5;
  if not r.is_today or not r.is_open then
    raise exception 'FAIL: today does not read as today and open';
  end if;

  -- 1pm: yesterday still REPORTED, so the UI can say it closed — but closed.
  call t_set_clock(v_id, 5, 13);
  select * into r from public.get_day_window() where day = 4;
  if r.is_open then raise exception 'FAIL: day 4 still reads open at 1pm'; end if;
  if r.closes_at > now() then
    raise exception 'FAIL: a closed day reports a future deadline';
  end if;

  -- A closed day that was never opened is NOT manufactured by a read.
  call t_fresh(v_uid);
  v_id := t_challenge(v_uid);
  call t_set_clock(v_id, 5, 13);
  select count(*) into v_n from public.get_day_window();
  if v_n <> 1 then
    raise exception 'FAIL: reading the window back-filled a closed day (% rows)', v_n;
  end if;

  raise notice 'PASS: get_day_window reports open/closed/today honestly and never invents a closed day';
end $$;

-- =============================================================================
-- PROOF 9 (B2) — the squad roster mid-window
-- =============================================================================
do $$
declare
  v_a   uuid := '00000000-0000-0000-0000-00000000e0f4';
  v_b   uuid := '00000000-0000-0000-0000-00000000e0f5';
  v_ca  uuid;
  v_cb  uuid;
  v_sq  uuid;
  v_code text;
  r     record;
begin
  call test_login(v_a);
  insert into public.profiles (id, name) values (v_a, 'Mate') on conflict do nothing;
  v_ca := public.create_challenge('hard', 'UTC', 75);
  select id, code into v_sq, v_code from public.create_squad('Window squad');

  call test_login(v_b);
  insert into public.profiles (id, name) values (v_b, 'Finish') on conflict do nothing;
  v_cb := public.create_challenge('hard', 'UTC', 75);
  perform public.join_squad(v_code);

  -- Two members in DIFFERENT zones at the same instant: one mid-window at
  -- 11am, one past noon at 1pm. One roster, two different answers.
  call t_set_clock(v_ca, 5, 11);
  call t_set_clock(v_cb, 5, 13);
  call t_do_day(v_ca, 4);
  delete from public.task_completions
   where challenge_id = v_ca and day = 4 and task_key in ('water', 'read');
  call t_do_day(v_cb, 4);

  call test_login(v_a);
  select * into r from public.get_squad_status(v_sq) where user_id = v_a;
  if r.grace_day <> 4 then
    raise exception 'FAIL: mid-window member reports grace_day %, expected 4', r.grace_day;
  end if;
  if r.grace_tasks <> 6 or r.grace_done <> 4 then
    raise exception 'FAIL: grace counts are %/%, expected 4/6', r.grace_done, r.grace_tasks;
  end if;
  if r.day <> 5 then raise exception 'FAIL: day is %, expected 5', r.day; end if;

  select * into r from public.get_squad_status(v_sq) where user_id = v_b;
  if r.grace_day is not null then
    raise exception 'FAIL: a member past noon reports grace_day %', r.grace_day;
  end if;

  -- A member who has FINISHED yesterday inside the window is not news.
  call test_login(v_a);
  perform public.complete_task('water', null, 4);
  perform public.complete_task('read', null, 4);
  select * into r from public.get_squad_status(v_sq) where user_id = v_a;
  if r.grace_day is not null then
    raise exception 'FAIL: a finished yesterday is still being advertised';
  end if;

  raise notice 'PASS: the roster carries an unfinished open day per member, in each member''s own timezone, and drops it once finished or closed';
end $$;

-- =============================================================================
-- PROOF 10 (B2) — the finish line moves with the boundary and nothing else
-- =============================================================================
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-00000000e0f5';
  v_id  uuid;
  v_c   public.challenges;
  d     integer;
  r     record;
begin
  -- A 30-day run, every day done, sitting on day 31 at 11am. Day 1 is
  -- completed and sealed through the APP's own path first, while it is
  -- genuinely today — the evaluator never judges day 1, so a day 1 that was
  -- never sealed would leave the flame one short of the run's length and the
  -- numbers below would be about the fixture rather than the engine.
  call t_fresh(v_uid, 30);
  v_id := t_challenge(v_uid);
  for r in select t->>'key' as k
             from jsonb_array_elements((public.get_or_freeze_today()).task_snapshot) t
  loop
    perform public.complete_task(r.k);
  end loop;
  perform public.seal_day();

  call t_set_clock(v_id, 31, 11);
  for d in 2..30 loop
    call t_do_day(v_id, d);
  end loop;

  -- 11am on day 31: day 30 has not closed, so the run is not finished yet.
  perform public.evaluate_challenge(v_id);
  select * into v_c from public.challenges where id = v_id;
  if v_c.ended_at is not null then
    raise exception 'FAIL: the run was completed before its last day closed';
  end if;
  if v_c.last_evaluated_day <> 29 then
    raise exception 'FAIL: cursor is %, expected 29', v_c.last_evaluated_day;
  end if;

  -- 1pm: day 30 has closed, is met, and the run finishes.
  call t_set_clock(v_id, 31, 13);
  perform public.evaluate_challenge(v_id);
  select * into v_c from public.challenges where id = v_id;
  if v_c.ended_reason is distinct from 'completed' then
    raise exception 'FAIL: the run ended as "%"', v_c.ended_reason;
  end if;
  if v_c.ended_on_day <> 30 then
    raise exception 'FAIL: ended on day %, expected 30', v_c.ended_on_day;
  end if;
  if v_c.flame <> 30 then
    raise exception 'FAIL: flame is %, expected 30', v_c.flame;
  end if;
  if (select count(*) from public.challenge_days
       where challenge_id = v_id and sealed_at is not null) <> 30 then
    raise exception 'FAIL: perfect-day count is not 30';
  end if;

  raise notice 'PASS: a finished run completes when its LAST day closes — half a day later, scored identically';
end $$;

do $$ begin raise notice ' ALL GRACE-WINDOW PROOFS PASSED'; end $$;
