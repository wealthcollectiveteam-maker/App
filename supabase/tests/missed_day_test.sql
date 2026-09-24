-- =============================================================================
-- Executable proofs for the missed-day engine (0007).
--
-- Run after setup_local.sql + every migration, as the postgres superuser:
--   psql -v ON_ERROR_STOP=1 -f missed_day_test.sql
--
-- Time is moved by moving start_date, which is the only lever the engine
-- reads: challenge_day() is (now() at tz)::date - start_date + 1. Setting
-- start_date to current_date - 4 makes today genuinely day 5, with days 1..4
-- genuinely in the past — no clock stubbing, no frozen `now()`, and the same
-- arithmetic the scheduled job will run against.
--
-- Every check raises on failure. A clean exit means all proofs hold.
-- =============================================================================

\set QUIET on
\pset pager off

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'hard-miss@test.dev'),
  ('00000000-0000-0000-0000-0000000000d2', 'unsealed@test.dev'),
  ('00000000-0000-0000-0000-0000000000d3', 'medium@test.dev'),
  ('00000000-0000-0000-0000-0000000000d4', 'gap@test.dev'),
  ('00000000-0000-0000-0000-0000000000d5', 'day1@test.dev'),
  ('00000000-0000-0000-0000-0000000000d6', 'finished@test.dev'),
  ('00000000-0000-0000-0000-0000000000d7', 'watcher@test.dev'),
  ('00000000-0000-0000-0000-0000000000d8', 'sim@test.dev'),
  ('00000000-0000-0000-0000-0000000000d9', 'dormant@test.dev'),
  ('00000000-0000-0000-0000-0000000000da', 'active@test.dev'),
  ('00000000-0000-0000-0000-0000000000db', 'restart-untouched@test.dev'),
  ('00000000-0000-0000-0000-0000000000dc', 'restart-done@test.dev'),
  ('00000000-0000-0000-0000-0000000000dd', 'dormant-second-empty@test.dev'),
  ('00000000-0000-0000-0000-0000000000de', 'dormant-counter-reset@test.dev'),
  ('00000000-0000-0000-0000-0000000000df', 'dormant-never@test.dev'),
  ('00000000-0000-0000-0000-0000000000e0', 'dormant-control@test.dev'),
  ('00000000-0000-0000-0000-0000000000e1', 'day1-unsealed@test.dev'),
  ('00000000-0000-0000-0000-0000000000e2', 'day1-sealed-by-hand@test.dev'),
  ('00000000-0000-0000-0000-0000000000e3', 'day1-untouched@test.dev'),
  ('00000000-0000-0000-0000-0000000000e4', 'restore-continues@test.dev'),
  ('00000000-0000-0000-0000-0000000000e5', 'restore-unsealed@test.dev'),
  ('00000000-0000-0000-0000-0000000000e6', 'restore-late@test.dev'),
  ('00000000-0000-0000-0000-0000000000e7', 'restore-stranger@test.dev')
on conflict do nothing;

-- Complete every task in a day's snapshot, without sealing. The engine's
-- whole point is that this is enough.
create or replace procedure t_do_day(p_challenge uuid, p_day integer)
language plpgsql as $$
declare
  d public.challenge_days;
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

-- Put a challenge at day N by moving its start date back, and wind the
-- evaluator's cursor to 0 — "nothing visited yet", the state a real
-- challenge is in the moment it is created (0017; it was 1 before, when day
-- 1 was never visited at all).
create or replace procedure t_set_day(p_challenge uuid, p_day integer)
language plpgsql as $$
declare
  v_shift integer;
  v_tz text;
begin
  -- THE HOUR IS NOW LOAD-BEARING (0011). A day closes at NOON the following
  -- day in the challenge's own timezone, not at midnight, so "yesterday has
  -- closed and is judgeable" is no longer true at every hour — these proofs
  -- would pass all afternoon and fail all morning.
  --
  -- So the zone is chosen to put the challenge at 13:00 local, whatever time
  -- the suite runs, and start_date is then anchored on that same zone. It is
  -- still deliberately NOT the server's zone, which is what the Phase 12
  -- regression (t_set_day on the server's current_date, challenge_day() on
  -- the challenge's) needs to stay caught. The grace window's own behaviour
  -- is proved in grace_window_test.sql, which moves the hour on purpose.
  v_shift := 13 - extract(hour from (now() at time zone 'UTC'))::integer;
  while v_shift < -11 loop v_shift := v_shift + 24; end loop;
  while v_shift >  14 loop v_shift := v_shift - 24; end loop;
  v_tz := case when v_shift >= 0 then 'Etc/GMT-' || v_shift
                                 else 'Etc/GMT+' || (-v_shift) end;
  update public.challenges
     set timezone = v_tz,
         start_date = (now() at time zone v_tz)::date - (p_day - 1),
         last_evaluated_day = 0
   where id = p_challenge;
end $$;

create or replace function t_challenge(p_owner uuid) returns uuid
language sql stable as $$
  select id from public.challenges
   where owner = p_owner and ended_at is null
   order by start_date desc, created_at desc limit 1;
$$;

-- =============================================================================
-- PROOF 1 — HARD: a miss archives the attempt and starts a genuinely new one
-- =============================================================================
do $$
declare
  v_uid   uuid := '00000000-0000-0000-0000-0000000000d1';
  v_old   uuid;
  v_new   uuid;
  v_squad uuid;
  old_c   public.challenges;
  new_c   public.challenges;
  v_custom integer;
  v_ov     integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Hard') on conflict do nothing;
  v_old := public.create_challenge('hard', 'America/Toronto');
  select id into v_squad from public.create_squad('Proof squad');

  -- A custom task and a lowered target: both must survive into the restart.
  perform public.add_custom_task('Cold shower', 'Two minutes.', false, null);
  perform public.set_target_override('read', 25);

  -- Day 5 today. Days 1-3 done, day 4 missed.
  call t_set_day(v_old, 5);
  update public.custom_tasks set active_from_day = 1 where challenge_id = v_old;
  update public.target_overrides set effective_from_day = 1 where challenge_id = v_old;
  call t_do_day(v_old, 2);
  call t_do_day(v_old, 3);
  call t_do_day(v_old, 4);
  -- ...but day 4 is one task short.
  delete from public.task_completions
   where challenge_id = v_old and day = 4 and task_key = 'water';

  perform public.evaluate_challenge(v_old);

  select * into old_c from public.challenges where id = v_old;
  if old_c.ended_at is null then
    raise exception 'FAIL: hard miss did not end the challenge';
  end if;
  if old_c.ended_reason <> 'missed_day' or old_c.ended_on_day <> 4 then
    raise exception 'FAIL: wrong ended_reason/ended_on_day (% / %)',
      old_c.ended_reason, old_c.ended_on_day;
  end if;

  -- Days 2 and 3 were met and are sealed; day 4 is recorded as the miss.
  if (select outcome from public.challenge_days where challenge_id = v_old and day = 3) <> 'met' then
    raise exception 'FAIL: day 3 was not judged met';
  end if;
  if (select outcome from public.challenge_days where challenge_id = v_old and day = 4) <> 'missed' then
    raise exception 'FAIL: day 4 was not judged missed';
  end if;

  -- ARCHIVE, DON'T WIPE: the failed attempt keeps every row it owned.
  if (select count(*) from public.challenge_days where challenge_id = v_old) < 3 then
    raise exception 'FAIL: archived challenge lost its days';
  end if;
  if (select count(*) from public.task_completions where challenge_id = v_old) = 0 then
    raise exception 'FAIL: archived challenge lost its completions';
  end if;

  v_new := t_challenge(v_uid);
  if v_new is null or v_new = v_old then
    raise exception 'FAIL: no new challenge was created';
  end if;
  select * into new_c from public.challenges where id = v_new;
  if new_c.start_date <> (now() at time zone new_c.timezone)::date then
    raise exception 'FAIL: new challenge does not start today';
  end if;
  if public.challenge_day(new_c) <> 1 then
    raise exception 'FAIL: new challenge is not on day 1';
  end if;
  if new_c.flame <> 0 then
    raise exception 'FAIL: new challenge did not start at flame 0';
  end if;
  if new_c.base_tier <> 'hard' then
    raise exception 'FAIL: new challenge lost the tier';
  end if;
  if new_c.restarted_from <> v_old then
    raise exception 'FAIL: new challenge does not point back at the old one';
  end if;
  if new_c.missed_notice_day <> 1 then
    raise exception 'FAIL: the restart carries no missed-day notice';
  end if;

  -- The person's own configuration came with them.
  select count(*) into v_custom from public.custom_tasks
    where challenge_id = v_new and active_from_day = 1;
  if v_custom <> 1 then
    raise exception 'FAIL: custom task did not carry into the restart (% found)', v_custom;
  end if;
  select count(*) into v_ov from public.target_overrides
    where challenge_id = v_new and task_key = 'read' and value = 25
      and effective_from_day = 1;
  if v_ov <> 1 then
    raise exception 'FAIL: target override did not carry into the restart';
  end if;

  -- Day 1 of the new challenge is already frozen.
  if not exists (select 1 from public.challenge_days where challenge_id = v_new and day = 1) then
    raise exception 'FAIL: the restart did not freeze its own day 1';
  end if;

  -- SQUAD MEMBERSHIP SURVIVES. The attempt ended; the person did not leave.
  if not exists (select 1 from public.squad_members where user_id = v_uid and squad_id = v_squad) then
    raise exception 'FAIL: the restart ejected the user from their squad';
  end if;

  -- The squad can see it happened.
  if not exists (
    select 1 from public.feed_items
    where squad_id = v_squad and author = v_uid and kind = 'miss'
      and text = 'missed Day 4. Hard rules — the challenge restarts at Day 1.'
  ) then
    raise exception 'FAIL: no miss reached the feed';
  end if;

  raise notice 'PASS: hard miss archives the attempt, restarts at day 1, keeps the squad and the config';
end $$;

-- =============================================================================
-- PROOF 2 — a finished-but-never-sealed day is MET, and gets its flame
--
-- The most likely way this engine could hurt someone who did the work: seal
-- is an explicit tap, so ticking the last box and closing the app leaves a
-- complete day unsealed. That must count, and must pay the streak.
-- =============================================================================
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000d2';
  v_ch  uuid;
  c     public.challenges;
  v_sealed timestamptz;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Unsealed') on conflict do nothing;
  v_ch := public.create_challenge('hard', 'UTC');

  call t_set_day(v_ch, 4);
  call t_do_day(v_ch, 2);   -- every task done
  call t_do_day(v_ch, 3);   -- every task done
  -- Neither day was ever sealed: seal_day() was never called.
  if exists (select 1 from public.challenge_days
              where challenge_id = v_ch and day in (2,3) and sealed_at is not null) then
    raise exception 'FAIL: fixture is wrong — a day is already sealed';
  end if;

  perform public.evaluate_challenge(v_ch);

  select * into c from public.challenges where id = v_ch;
  if c.ended_at is not null then
    raise exception 'FAIL: a complete-but-unsealed day was penalised as a miss';
  end if;

  select sealed_at into v_sealed from public.challenge_days
    where challenge_id = v_ch and day = 2;
  if v_sealed is null then
    raise exception 'FAIL: day 2 was not sealed retroactively';
  end if;

  if c.flame <> 2 then
    raise exception 'FAIL: retroactive seal did not award the flame (flame = %)', c.flame;
  end if;
  if c.best_flame <> 2 then
    raise exception 'FAIL: best_flame did not follow (best = %)', c.best_flame;
  end if;

  raise notice 'PASS: a day whose every box was ticked counts, sealed or not, and pays the streak';
end $$;

-- =============================================================================
-- PROOF 3 — IDEMPOTENCY: running twice never double-penalises
-- =============================================================================
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000d3';
  v_ch  uuid;
  c     public.challenges;
  v_feed integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Medium') on conflict do nothing;
  v_ch := public.create_challenge('medium', 'Europe/London');
  perform id from public.create_squad('Medium squad');

  call t_set_day(v_ch, 4);
  call t_do_day(v_ch, 2);
  update public.challenge_days set sealed_at = now()
    where challenge_id = v_ch and day = 2;
  update public.challenges set flame = 1, best_flame = 1 where id = v_ch;
  -- day 3 untouched: a miss.

  perform public.evaluate_challenge(v_ch);
  perform public.evaluate_challenge(v_ch);
  perform public.evaluate_challenge(v_ch);

  select * into c from public.challenges where id = v_ch;

  -- MEDIUM: flame to 0, day count continues, challenge untouched otherwise.
  if c.ended_at is not null then
    raise exception 'FAIL: medium restarted the challenge';
  end if;
  if c.flame <> 0 then
    raise exception 'FAIL: medium did not reset the streak (flame = %)', c.flame;
  end if;
  if public.challenge_day(c) <> 4 then
    raise exception 'FAIL: medium moved the day count (day = %)', public.challenge_day(c);
  end if;
  if c.best_flame <> 1 then
    raise exception 'FAIL: a reset streak erased the personal best';
  end if;
  if c.missed_notice_day <> 4 then
    raise exception 'FAIL: the miss notice is not current for today';
  end if;
  if c.last_evaluated_day <> 3 then
    raise exception 'FAIL: cursor did not land on the judged day (%)', c.last_evaluated_day;
  end if;

  select count(*) into v_feed from public.feed_items
    where author = v_uid and kind = 'miss';
  if v_feed <> 1 then
    raise exception 'FAIL: three runs produced % feed items, not 1', v_feed;
  end if;

  raise notice 'PASS: medium resets the streak only, and three runs penalise exactly once';
end $$;

-- =============================================================================
-- PROOF 4 — CATCH-UP: three missed days on Hard is ONE restart, not three
-- =============================================================================
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000d4';
  v_ch  uuid;
  v_ended integer;
  v_active integer;
  v_feed integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Gap') on conflict do nothing;
  v_ch := public.create_challenge('hard', 'Australia/Sydney');
  perform id from public.create_squad('Gap squad');

  -- Today is day 6. The user was offline for days 3, 4 and 5 — no snapshot
  -- rows exist for them at all, which is what "never opened the app" means.
  call t_set_day(v_ch, 6);
  call t_do_day(v_ch, 2);

  perform public.evaluate_challenge(v_ch);

  select count(*) into v_ended from public.challenges
    where owner = v_uid and ended_at is not null;
  select count(*) into v_active from public.challenges
    where owner = v_uid and ended_at is null;
  if v_ended <> 1 or v_active <> 1 then
    raise exception 'FAIL: expected 1 ended + 1 active, got % + %', v_ended, v_active;
  end if;

  if (select ended_on_day from public.challenges where id = v_ch) <> 3 then
    raise exception 'FAIL: the restart should be pinned to the FIRST missed day';
  end if;

  select count(*) into v_feed from public.feed_items
    where author = v_uid and kind = 'miss';
  if v_feed <> 1 then
    raise exception 'FAIL: three missed days produced % feed items, not 1', v_feed;
  end if;

  -- Day 3 was frozen retroactively so the history has no hole in it.
  if not exists (
    select 1 from public.challenge_days
    where challenge_id = v_ch and day = 3
      and jsonb_array_length(task_snapshot) > 0
      and outcome = 'missed'
  ) then
    raise exception 'FAIL: the unopened missed day was not frozen and judged';
  end if;

  -- Days 4 and 5 belong to an attempt that ended on day 3. They are not
  -- judged, because they never happened to anything.
  if exists (select 1 from public.challenge_days
              where challenge_id = v_ch and day in (4,5) and evaluated_at is not null) then
    raise exception 'FAIL: days after the restart were still judged';
  end if;

  raise notice 'PASS: a three-day gap is one restart, pinned to the first missed day';
end $$;

-- =============================================================================
-- PROOF 5 — day 1 is never a miss, and nothing past day 75 is judged
-- =============================================================================
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000d5';
  v_ch  uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Day1') on conflict do nothing;
  v_ch := public.create_challenge('hard', 'UTC');

  -- Signed up yesterday at 23:50 and did nothing. Today is day 2.
  call t_set_day(v_ch, 2);
  perform public.get_or_freeze_today();
  perform public.evaluate_challenge(v_ch);

  if (select ended_at from public.challenges where id = v_ch) is not null then
    raise exception 'FAIL: day 1 was judged as a miss';
  end if;
  if exists (select 1 from public.challenge_days
              where challenge_id = v_ch and day = 1 and evaluated_at is not null) then
    raise exception 'FAIL: day 1 was evaluated at all';
  end if;

  raise notice 'PASS: the creation day is never judged';
end $$;

do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000d6';
  v_ch  uuid;
  i     integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Finished') on conflict do nothing;
  v_ch := public.create_challenge('hard', 'UTC');

  -- A completed run: 75 days done, then the user stopped opening the app.
  -- Today is day 78.
  call t_set_day(v_ch, 78);
  for i in 2 .. 75 loop
    call t_do_day(v_ch, i);
  end loop;

  perform public.evaluate_challenge(v_ch);

  -- Until 0008 this asserted `ended_at is null`, because ending a challenge
  -- meant only one thing: it had been abandoned or restarted. 0008 gives the
  -- word a second meaning, so the assertion gets SHARPER rather than looser —
  -- it is no longer enough that the run did not end, it now has to have
  -- ended for the right reason, and the run must not have been replaced.
  if (select ended_reason from public.challenges where id = v_ch)
     is distinct from 'completed' then
    raise exception 'FAIL: a COMPLETED 75-day run ended as %, not completed',
      coalesce((select ended_reason from public.challenges where id = v_ch),
               '(still running)');
  end if;
  if (select ended_on_day from public.challenges where id = v_ch) <> 75 then
    raise exception 'FAIL: the run completed on the wrong day';
  end if;
  -- The distinction the old assertion was really protecting: a finished run
  -- must not be scored as abandoned, and abandonment is what creates a
  -- replacement challenge for the same owner.
  if (select count(*) from public.challenges where owner = v_uid) <> 1 then
    raise exception 'FAIL: a COMPLETED run was restarted';
  end if;
  if exists (select 1 from public.challenge_days
              where challenge_id = v_ch and day > 75 and evaluated_at is not null) then
    raise exception 'FAIL: a day past the end of the challenge was judged';
  end if;
  if exists (select 1 from public.challenge_days
              where challenge_id = v_ch and day > 75) then
    raise exception 'FAIL: a snapshot was frozen past the final day';
  end if;
  if (select last_evaluated_day from public.challenges where id = v_ch) <> 75 then
    raise exception 'FAIL: the cursor ran past the final day';
  end if;

  raise notice 'PASS: a finished run completes — judged to day 75, nothing beyond it, no restart';
end $$;

-- =============================================================================
-- PROOF 6 — an archived challenge is readable by its owner and NOBODY else
-- =============================================================================
do $$
declare
  v_owner uuid := '00000000-0000-0000-0000-0000000000d1';
  v_other uuid := '00000000-0000-0000-0000-0000000000d7';
  v_seen  integer;
begin
  insert into public.profiles (id, name) values (v_other, 'Watcher') on conflict do nothing;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other, 'role','authenticated')::text, false);
  -- Same squad as the owner, so `same_squad` is true and this is the
  -- strongest form of the question.
  perform public.join_squad(
    (select invite_code from public.squads where name = 'Proof squad'));
end $$;

set role authenticated;
do $$
declare
  v_owner uuid := '00000000-0000-0000-0000-0000000000d1';
  v_other uuid := '00000000-0000-0000-0000-0000000000d7';
  v_seen  integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other, 'role','authenticated')::text, false);

  select count(*) into v_seen from public.challenges where owner = v_owner;
  if v_seen <> 0 then
    raise exception 'FAIL: a squadmate read % challenge rows belonging to someone else', v_seen;
  end if;
  select count(*) into v_seen from public.challenge_days cd
    join public.challenges c on c.id = cd.challenge_id where c.owner = v_owner;
  if v_seen <> 0 then
    raise exception 'FAIL: a squadmate read an archived challenge''s days';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role','authenticated')::text, false);
  select count(*) into v_seen from public.challenges
    where owner = v_owner and ended_at is not null;
  if v_seen <> 1 then
    raise exception 'FAIL: the owner cannot read their own archived attempt';
  end if;

  raise notice 'PASS: an archived attempt is readable by its owner only';
end $$;

-- The roster answers for the ACTIVE challenge. The owner restarted, so their
-- squadmate must see day 1, not a row picked at random from two.
do $$
declare
  v_other uuid := '00000000-0000-0000-0000-0000000000d7';
  v_rows  integer;
  v_tasks integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other, 'role','authenticated')::text, false);
  select count(*) into v_rows from public.get_squad_status(
    (select squad_id from public.squad_members where user_id = v_other limit 1));
  if v_rows <> 2 then
    raise exception 'FAIL: roster returned % rows, expected 2', v_rows;
  end if;
  select tasks_today into v_tasks from public.get_squad_status(
    (select squad_id from public.squad_members where user_id = v_other limit 1))
   where user_id = '00000000-0000-0000-0000-0000000000d1';
  if coalesce(v_tasks, 0) = 0 then
    raise exception 'FAIL: roster shows no task set for a restarted squadmate';
  end if;
  raise notice 'PASS: the squad roster resolves the ACTIVE challenge after a restart';
end $$;
reset role;

-- =============================================================================
-- PROOF 7 — delete_account() survives the cascade into challenge_days
--
-- This is the bug the immutability trigger was hiding: `delete from
-- challenges` cascades into a delete-protected child, so in-app account
-- deletion raised for every user who had ever had a day frozen.
-- =============================================================================
set role authenticated;
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000d5';
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  if not exists (select 1 from public.challenge_days cd
                  join public.challenges c on c.id = cd.challenge_id
                 where c.owner = v_uid) then
    raise exception 'FAIL: fixture is wrong — this user has no frozen day';
  end if;

  perform public.delete_account();

  if exists (select 1 from public.challenges where owner = v_uid) then
    raise exception 'FAIL: delete_account left the challenge behind';
  end if;
  raise notice 'PASS: delete_account cascades through frozen days instead of raising';
end $$;
reset role;

-- ...and the trigger still refuses a direct delete against a LIVE challenge.
do $$
declare
  v_ch uuid := t_challenge('00000000-0000-0000-0000-0000000000d2');
begin
  begin
    delete from public.challenge_days where challenge_id = v_ch;
    raise exception 'FAIL: a frozen day of a live challenge was deleted';
  exception when others then
    if sqlerrm not like '%immutable%' then raise; end if;
  end;
  raise notice 'PASS: frozen days of a live challenge are still undeletable';
end $$;

-- =============================================================================
-- PROOF 8 — the simulations are default-denied, owner-scoped, and clean up
-- =============================================================================
set role authenticated;
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000d8';
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Sim') on conflict do nothing;
  perform public.create_challenge('hard', 'UTC');
  perform public.get_or_freeze_today();

  -- DEFAULT DENY. sim_allowed_users ships empty, so every simulation raises
  -- for every account — in production and in development alike.
  begin
    perform public.sim_jump_to_day(12);
    raise exception 'FAIL: a simulation ran for an account that is not enabled';
  exception when others then
    if sqlerrm not like '%not enabled%' then raise; end if;
  end;
  raise notice 'PASS: simulations are denied by default';
end $$;
reset role;

insert into public.sim_allowed_users (user_id, note)
values ('00000000-0000-0000-0000-0000000000d8', 'proof account');

set role authenticated;
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000d8';
  v_ch  uuid;
  c     public.challenges;
  v_days integer;
  v_comp integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);

  -- JUMP TO DAY 12: today genuinely is day 12, with 11 real days behind it.
  perform public.sim_jump_to_day(12);
  v_ch := t_challenge(v_uid);
  select * into c from public.challenges where id = v_ch;

  if public.challenge_day(c) <> 12 then
    raise exception 'FAIL: jump did not land on day 12 (day = %)', public.challenge_day(c);
  end if;
  if c.flame <> 11 then
    raise exception 'FAIL: jump did not set the flame to match (flame = %)', c.flame;
  end if;
  select count(*) into v_days from public.challenge_days
    where challenge_id = v_ch and sealed_at is not null;
  if v_days <> 11 then
    raise exception 'FAIL: jump sealed % days, expected 11', v_days;
  end if;
  select count(*) into v_comp from public.task_completions where challenge_id = v_ch;
  if v_comp = 0 then
    raise exception 'FAIL: jump left the Wall empty';
  end if;

  raise notice 'PASS: jump to day N builds a real history, not a day counter';
end $$;
reset role;

-- The evaluator — run the way the scheduler runs it, as the owner role, not
-- as the app — must find nothing to punish in a simulated history.
do $$
declare
  v_ch uuid := t_challenge('00000000-0000-0000-0000-0000000000d8');
begin
  perform public.evaluate_challenge(v_ch);
  if (select ended_at from public.challenges where id = v_ch) is not null then
    raise exception 'FAIL: the evaluator penalised a simulated day-12 history';
  end if;
  raise notice 'PASS: a simulated history survives the real evaluator untouched';
end $$;
set role authenticated;

do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000d8';
  v_ch  uuid;
  c     public.challenges;
  v_sealed integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);

  -- DAY 75, COMPLETE: the finish screen genuinely reachable.
  perform public.sim_day75_complete();
  v_ch := t_challenge(v_uid);
  select * into c from public.challenges where id = v_ch;

  if public.challenge_day(c) <> 75 then
    raise exception 'FAIL: not on day 75 (day = %)', public.challenge_day(c);
  end if;
  select count(*) into v_sealed from public.challenge_days
    where challenge_id = v_ch and sealed_at is not null;
  if v_sealed <> 75 then
    raise exception 'FAIL: % of 75 days sealed', v_sealed;
  end if;
  if c.flame <> 75 then
    raise exception 'FAIL: flame is % at day 75', c.flame;
  end if;
  -- What loadFinalResults() reads: real snapshots, real completions.
  if (select count(*) from public.task_completions
       where challenge_id = v_ch and task_key = 'workout1') <> 75 then
    raise exception 'FAIL: the Day 75 figures have nothing to count';
  end if;

  raise notice 'PASS: day 75 complete is reachable, with real rows behind it';
end $$;

do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000d8';
  v_ch  uuid;
  c     public.challenges;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);

  -- MISSED DAY on device: the same evaluation the scheduled job runs.
  perform public.sim_missed_day();

  -- Hard, so the challenge restarted.
  v_ch := t_challenge(v_uid);
  select * into c from public.challenges where id = v_ch;
  if public.challenge_day(c) <> 1 then
    raise exception 'FAIL: simulated miss on Hard did not restart at day 1';
  end if;
  if not exists (select 1 from public.challenges
                  where owner = v_uid and ended_reason = 'missed_day') then
    raise exception 'FAIL: no attempt was archived as a miss';
  end if;

  raise notice 'PASS: the simulated miss runs the real evaluator and applies the real penalty';
end $$;

do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000d8';
  v_ch  uuid;
  c     public.challenges;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);

  insert into public.journal_entries (owner, day, text) values (v_uid, 1, 'simulated');
  insert into public.meals (owner, day, text) values (v_uid, 1, 'simulated');
  insert into public.milestones (owner, title) values (v_uid, 'simulated');
  update public.profiles set xp = 9999 where id = v_uid;

  -- FRESH START: the account must look exactly like a new signup.
  perform public.sim_fresh_start();

  v_ch := t_challenge(v_uid);
  select * into c from public.challenges where id = v_ch;
  if public.challenge_day(c) <> 1 or c.flame <> 0 or c.best_flame <> 0 then
    raise exception 'FAIL: fresh start is not a day-1 challenge at zero';
  end if;
  if (select count(*) from public.challenges where owner = v_uid) <> 1 then
    raise exception 'FAIL: fresh start left archived challenges behind';
  end if;
  if (select count(*) from public.challenge_days where challenge_id = v_ch) <> 1 then
    raise exception 'FAIL: fresh start did not leave exactly one frozen day';
  end if;
  if (select count(*) from public.task_completions where challenge_id = v_ch) <> 0 then
    raise exception 'FAIL: fresh start carried completions over';
  end if;
  if (select count(*) from public.journal_entries where owner = v_uid) <> 0
     or (select count(*) from public.meals where owner = v_uid) <> 0
     or (select count(*) from public.milestones where owner = v_uid) <> 0 then
    raise exception 'FAIL: fresh start left owner-keyed simulated history behind';
  end if;
  if (select count(*) from public.feed_items where author = v_uid) <> 0 then
    raise exception 'FAIL: fresh start left simulated feed items behind';
  end if;
  if (select xp from public.profiles where id = v_uid) <> 0 then
    raise exception 'FAIL: fresh start left XP behind';
  end if;

  raise notice 'PASS: fresh start genuinely cleans up — the account looks like a new signup';
end $$;
reset role;

-- =============================================================================
-- PROOF 9 — the privilege surface of the engine itself
--
-- The scheduler's entry points must be unreachable from the app. A grant on
-- evaluate_challenge(uuid) alone would let any user drive the penalty
-- machinery against somebody else's challenge id.
-- =============================================================================
do $$
declare
  f      text;
  denied text[] := array[
    'public.evaluate_all_challenges()',
    'public.evaluate_challenge(uuid)',
    'public.restart_challenge(uuid, integer, text)',
    'public.active_challenge_of(uuid)',
    'public.sim_fill_day(uuid, integer)'
  ];
begin
  foreach f in array denied loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'FAIL: authenticated can execute %', f;
    end if;
    if has_function_privilege('anon', f, 'EXECUTE') then
      raise exception 'FAIL: anon can execute %', f;
    end if;
  end loop;

  -- ...and the app's own RPCs still work.
  -- 0011 gave seal_day an optional day, so its signature is seal_day(integer)
  -- now. has_function_privilege() resolves a signature literally and does not
  -- apply defaults, so the old zero-argument text no longer names a function
  -- at all — which is the correct answer to "did the old arity survive?" and
  -- exactly the ambiguity 0011's explicit DROP was there to prevent.
  if not has_function_privilege('authenticated', 'public.seal_day(integer)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_or_freeze_today()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_day_window()', 'EXECUTE') then
    raise exception 'FAIL: the lockdown took the app''s own RPCs with it';
  end if;

  -- The new tables: read-only for authenticated, nothing for anon.
  if has_table_privilege('anon', 'public.tier_rules', 'SELECT')
     or has_table_privilege('anon', 'public.sim_allowed_users', 'SELECT') then
    raise exception 'FAIL: anon can read the new tables';
  end if;
  if has_table_privilege('authenticated', 'public.sim_allowed_users', 'INSERT') then
    raise exception 'FAIL: a client can enable simulation for itself';
  end if;

  raise notice 'PASS: the scheduler is unreachable from the app; the new tables are read-only';
end $$;

-- A client cannot forge a miss in the feed, either: the INSERT policy was
-- not widened when the check constraint was.
set role authenticated;
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000d3';
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  begin
    insert into public.feed_items (squad_id, author, kind, text)
    values ((select squad_id from public.squad_members where user_id = v_uid),
            v_uid, 'miss', 'someone else missed a day');
    raise exception 'FAIL: a client posted a miss to the feed';
  exception when insufficient_privilege or check_violation then
    null;
  when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;
  raise notice 'PASS: only the evaluator can post a miss';
end $$;
reset role;

-- =============================================================================
-- PROOF 10 — THE FEED HEARS ONLY FROM THE LIVING (Phase 38B)
--
-- Measured on production, 2026-09-19: 122 miss items in a month, posted
-- about accounts nobody had touched since August. The rule now: a miss is
-- judged exactly as before, but the squad feed gets a row only if the author
-- has a completion inside feed_activity_window() (7 days), on any of their
-- challenges.
--
-- Two accounts, one fixture each — the PROOF 1 shape: Hard, in a squad, day 5
-- today, days 2-3 done, day 4 one task short. The ONLY difference between
-- them is when the completions happened: 30 days ago (dormant) or yesterday
-- (active). Backdating those rows is the fixture describing history, not the
-- app writing it; the evaluator's own rows carry now().
--
-- Against the 0011 evaluator the DORMANT block FAILS (a feed item appears).
-- The ACTIVE block is the regression guard: it passes before and after, and
-- it is here so that "silence the dormant" can never quietly become
-- "silence everyone".
-- =============================================================================
do $$
declare
  v_uid   uuid := '00000000-0000-0000-0000-0000000000d9';
  v_old   uuid;
  v_new   uuid;
  v_squad uuid;
  old_c   public.challenges;
  new_c   public.challenges;
  v_feed  integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Dormant') on conflict do nothing;
  v_old := public.create_challenge('hard', 'America/Toronto');
  select id into v_squad from public.create_squad('Dormant squad');

  call t_set_day(v_old, 5);
  call t_do_day(v_old, 2);
  call t_do_day(v_old, 3);
  call t_do_day(v_old, 4);
  delete from public.task_completions
   where challenge_id = v_old and day = 4 and task_key = 'water';
  -- Nothing touched for 30 days. (0014's verification grid pins the window at
  -- 7 days; this proof does not call it, so it can run against the 0011
  -- evaluator and fail on the feed assertion rather than on a missing function.)
  update public.task_completions
     set completed_at = now() - interval '30 days'
   where challenge_id = v_old;

  perform public.evaluate_challenge(v_old);

  -- Judged exactly as before: day 4 missed, attempt archived, restart on day 1.
  select * into old_c from public.challenges where id = v_old;
  if old_c.ended_reason is distinct from 'missed_day' or old_c.ended_on_day <> 4 then
    raise exception 'FAIL (dormant): the miss was not judged (% / %)',
      old_c.ended_reason, old_c.ended_on_day;
  end if;
  if (select outcome from public.challenge_days where challenge_id = v_old and day = 4) <> 'missed' then
    raise exception 'FAIL (dormant): day 4 was not written as missed';
  end if;
  v_new := t_challenge(v_uid);
  select * into new_c from public.challenges where id = v_new;
  if v_new is null or v_new = v_old or new_c.flame <> 0 or new_c.restarted_from <> v_old then
    raise exception 'FAIL (dormant): the restart did not happen as before';
  end if;

  -- And the squad heard NOTHING.
  select count(*) into v_feed from public.feed_items
   where author = v_uid and kind = 'miss';
  if v_feed <> 0 then
    raise exception 'FAIL (dormant): % miss item(s) reached the feed about an account with no completion in 30 days', v_feed;
  end if;

  raise notice 'PASS (dormant): the miss is judged and restarts, and the feed hears nothing';
end $$;

do $$
declare
  v_uid   uuid := '00000000-0000-0000-0000-0000000000da';
  v_old   uuid;
  v_squad uuid;
  old_c   public.challenges;
  v_feed  integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Active') on conflict do nothing;
  v_old := public.create_challenge('hard', 'America/Toronto');
  select id into v_squad from public.create_squad('Active squad');

  call t_set_day(v_old, 5);
  call t_do_day(v_old, 2);
  call t_do_day(v_old, 3);
  call t_do_day(v_old, 4);
  delete from public.task_completions
   where challenge_id = v_old and day = 4 and task_key = 'water';
  -- Completed yesterday.
  update public.task_completions
     set completed_at = now() - interval '1 day'
   where challenge_id = v_old;

  perform public.evaluate_challenge(v_old);

  select * into old_c from public.challenges where id = v_old;
  if old_c.ended_reason is distinct from 'missed_day' or old_c.ended_on_day <> 4 then
    raise exception 'FAIL (active): the miss was not judged (% / %)',
      old_c.ended_reason, old_c.ended_on_day;
  end if;
  if (select outcome from public.challenge_days where challenge_id = v_old and day = 4) <> 'missed' then
    raise exception 'FAIL (active): day 4 was not written as missed';
  end if;

  -- Exactly one row, with today's text, unchanged.
  select count(*) into v_feed from public.feed_items
   where squad_id = v_squad and author = v_uid and kind = 'miss'
     and text = 'missed Day 4. Hard rules — the challenge restarts at Day 1.';
  if v_feed <> 1 then
    raise exception 'FAIL (active): expected exactly 1 miss item for an account that completed yesterday, found %', v_feed;
  end if;

  raise notice 'PASS (active): the miss is judged and exactly one item reaches the feed, as before';
end $$;

-- =============================================================================
-- PROOF 11 — A RESTART'S DAY 1 IS JUDGED (Phase 38B-RIDER, A2)
--
-- Two accounts. Each misses day 4 on Hard exactly as in PROOF 1 and is
-- restarted by the real evaluator; the restart's day 1 is today. Then the
-- clock is moved so that day 1 has CLOSED (day 2, 13:00 local) — WITHOUT
-- touching the cursor, because what restart_challenge wrote there is part of
-- what is being proved (0 after 0015; 1 before).
--
--   (a) day 1 left untouched  -> judged 'missed', the restart is itself
--                                restarted, and the miss names Day 1
--   (b) day 1 fully ticked,   -> sealed, outcome 'met', flame 1, cursor 1.
--       never sealed             Nobody is one flame short on a restart.
--
-- PROOF 5 above is the control: a FRESH challenge's day 1 is still never
-- judged. PROOF 4 ("one restart, not three") must keep passing.
--
-- Against 0014 both blocks FAIL: the floor of 2 never visits day 1.
-- =============================================================================
create or replace procedure t_move_day(p_challenge uuid, p_day integer)
language plpgsql as $$
declare
  v_shift integer;
  v_tz text;
begin
  -- t_set_day, minus its `last_evaluated_day = 1`: the cursor stays what the
  -- engine wrote.
  v_shift := 13 - extract(hour from (now() at time zone 'UTC'))::integer;
  while v_shift < -11 loop v_shift := v_shift + 24; end loop;
  while v_shift >  14 loop v_shift := v_shift - 24; end loop;
  v_tz := case when v_shift >= 0 then 'Etc/GMT-' || v_shift
                                 else 'Etc/GMT+' || (-v_shift) end;
  update public.challenges
     set timezone = v_tz,
         start_date = (now() at time zone v_tz)::date - (p_day - 1)
   where id = p_challenge;
end $$;

do $$
declare
  v_uid   uuid := '00000000-0000-0000-0000-0000000000db';
  v_old   uuid;
  v_r1    uuid;
  v_r2    uuid;
  r1      public.challenges;
  d1      public.challenge_days;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Restart-untouched') on conflict do nothing;
  v_old := public.create_challenge('hard', 'America/Toronto');
  call t_set_day(v_old, 5);
  call t_do_day(v_old, 2);
  call t_do_day(v_old, 3);
  perform public.evaluate_challenge(v_old);        -- day 4 missed -> restart
  v_r1 := t_challenge(v_uid);
  if v_r1 is null or v_r1 = v_old then
    raise exception 'FIXTURE (a): no restart was created';
  end if;
  select * into r1 from public.challenges where id = v_r1;
  if r1.last_evaluated_day <> 0 then
    raise exception 'FAIL (a): the restart''s cursor is %, expected 0 — its day 1 is out of the evaluator''s reach',
      r1.last_evaluated_day;
  end if;

  -- Day 1 untouched. Move to day 2, 13:00 local: day 1 has closed.
  call t_move_day(v_r1, 2);
  perform public.evaluate_challenge(v_r1);

  select * into d1 from public.challenge_days where challenge_id = v_r1 and day = 1;
  if d1.outcome is distinct from 'missed' or d1.evaluated_at is null then
    raise exception 'FAIL (a): the restart''s untouched day 1 was not judged (outcome %, evaluated_at %)',
      coalesce(d1.outcome, 'null'), coalesce(d1.evaluated_at::text, 'null');
  end if;
  select * into r1 from public.challenges where id = v_r1;
  if r1.ended_reason is distinct from 'missed_day' or r1.ended_on_day <> 1 then
    raise exception 'FAIL (a): the restart did not end on its day 1 (% / %)',
      coalesce(r1.ended_reason, 'null'), coalesce(r1.ended_on_day::text, 'null');
  end if;
  v_r2 := t_challenge(v_uid);
  if v_r2 is null or v_r2 in (v_old, v_r1)
     or (select restarted_from from public.challenges where id = v_r2) <> v_r1 then
    raise exception 'FAIL (a): the miss on day 1 did not restart again';
  end if;

  raise notice 'PASS (a): a restart''s untouched day 1 is judged missed and restarts again';
end $$;

do $$
declare
  v_uid   uuid := '00000000-0000-0000-0000-0000000000dc';
  v_old   uuid;
  v_r1    uuid;
  r1      public.challenges;
  d1      public.challenge_days;
  v_n     integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Restart-done') on conflict do nothing;
  v_old := public.create_challenge('hard', 'America/Toronto');
  call t_set_day(v_old, 5);
  call t_do_day(v_old, 2);
  call t_do_day(v_old, 3);
  perform public.evaluate_challenge(v_old);        -- day 4 missed -> restart
  v_r1 := t_challenge(v_uid);
  if v_r1 is null or v_r1 = v_old then
    raise exception 'FIXTURE (b): no restart was created';
  end if;

  -- Every task on the restart's day 1 ticked, none sealed — the grace-window
  -- seal gap shape. Then day 1 closes.
  call t_do_day(v_r1, 1);
  call t_move_day(v_r1, 2);
  v_n := public.evaluate_challenge(v_r1);

  select * into d1 from public.challenge_days where challenge_id = v_r1 and day = 1;
  if d1.outcome is distinct from 'met' or d1.sealed_at is null then
    raise exception 'FAIL (b): the restart''s completed day 1 was not sealed and scored (outcome %, sealed_at %)',
      coalesce(d1.outcome, 'null'), coalesce(d1.sealed_at::text, 'null');
  end if;
  select * into r1 from public.challenges where id = v_r1;
  if r1.ended_at is not null then
    raise exception 'FAIL (b): a completed day 1 ended the restart (%)', r1.ended_reason;
  end if;
  if r1.flame <> 1 or r1.last_evaluated_day <> 1 then
    raise exception 'FAIL (b): flame % cursor % after a met day 1, expected 1 and 1',
      r1.flame, r1.last_evaluated_day;
  end if;
  if v_n <> 1 then
    raise exception 'FAIL (b): evaluate_challenge judged % day(s), expected exactly 1', v_n;
  end if;

  -- Pay-once: a second run pays nothing.
  perform public.evaluate_challenge(v_r1);
  if (select flame from public.challenges where id = v_r1) <> 1 then
    raise exception 'FAIL (b): a second evaluation paid day 1 again';
  end if;

  raise notice 'PASS (b): a restart''s completed-but-unsealed day 1 is sealed, scored met and pays flame 1, once';
end $$;

-- =============================================================================
-- PROOF 12 — A PERSON CAN STOP (Phase 38E, E1)
--
-- Production, 2026-09-24: the ten most recent challenges all had
-- restarted_from set. A stopped Hard account restarted every grace window,
-- forever. The rule: when a challenge is about to restart and this is the
-- SECOND consecutive run with no sealed day, it ends as 'dormant' instead
-- and nothing replaces it. The signal is challenge_days.sealed_at on the
-- run's OWN rows — never best_flame, which restarts carry across.
--
--   (a) empty run, then a second empty run  -> dormant; no replacement;
--       nothing in the feed even though the owner ticked something today;
--       best_flame stays; the challenge the person starts when they come
--       back carries it and is a fresh challenge, not a restart
--   (b) empty run, a run with ONE sealed day, an empty run -> restarts,
--       because the sealed day reset the count
--   (c) never completed anything since signup -> dormant at the end of the
--       second run, the same point as (a)
--   (d) control: an active person who misses restarts exactly as today,
--       and their empty restart restarts again (its parent had sealed days)
--
-- Against 0015, (a) and (c) FAIL: the second empty run restarts. (b) and (d)
-- pass before and after — they are here so the rule can never quietly become
-- "two restarts means dormant" or "any empty run means dormant". PROOF 4
-- ("one restart, not three") keeps passing.
-- =============================================================================
do $$
declare
  v_uid   uuid := '00000000-0000-0000-0000-0000000000dd';
  v_old   uuid;
  v_r1    uuid;
  v_back  uuid;
  v_squad uuid;
  r1      public.challenges;
  back_c  public.challenges;
  v_feed  integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Dormant-2') on conflict do nothing;
  v_old := public.create_challenge('hard', 'America/Toronto');
  select id into v_squad from public.create_squad('Dormant-2 squad');
  -- History from an earlier life, the 573dabe6 shape: a best of 29 on a row
  -- with nothing done on it. The fixture describing the past, not the app.
  update public.challenges set best_flame = 29 where id = v_old;

  -- Run one, empty: day 3 today, day 2 untouched -> restart. A fresh
  -- challenge always gets its one restart.
  call t_set_day(v_old, 3);
  perform public.evaluate_challenge(v_old);
  v_r1 := t_challenge(v_uid);
  if v_r1 is null or v_r1 = v_old then
    raise exception 'FIXTURE (a): the first empty run did not restart';
  end if;
  select * into r1 from public.challenges where id = v_r1;
  if r1.best_flame <> 29 or r1.flame <> 0 then
    raise exception 'FIXTURE (a): restart did not carry best 29 / flame 0 (% / %)', r1.best_flame, r1.flame;
  end if;

  -- Run two, ALSO empty — but not silent: one task ticked today on day 1,
  -- which makes the owner "active" by 0014's measure and seals nothing.
  insert into public.task_completions (challenge_id, day, task_key)
  select v_r1, 1, task_snapshot->0->>'key'
    from public.challenge_days where challenge_id = v_r1 and day = 1;
  call t_move_day(v_r1, 2);                       -- day 1 has closed
  perform public.evaluate_challenge(v_r1);

  select * into r1 from public.challenges where id = v_r1;
  if r1.ended_reason is distinct from 'dormant' or r1.ended_on_day <> 1 then
    raise exception 'FAIL (a): the second empty run ended as % on day %, expected dormant on day 1',
      coalesce(r1.ended_reason, '(still running)'), coalesce(r1.ended_on_day::text, 'null');
  end if;
  if t_challenge(v_uid) is not null then
    raise exception 'FAIL (a): a replacement challenge was created for a dormant account';
  end if;
  if (select outcome from public.challenge_days where challenge_id = v_r1 and day = 1) is distinct from 'missed' then
    raise exception 'FAIL (a): the missed day 1 was not written as missed';
  end if;
  if r1.last_evaluated_day <> 1 then
    raise exception 'FAIL (a): cursor is %, expected 1', r1.last_evaluated_day;
  end if;
  select count(*) into v_feed from public.feed_items
   where author = v_uid and kind = 'miss';
  if v_feed <> 0 then
    raise exception 'FAIL (a): % miss item(s) reached the feed for a dormant ending', v_feed;
  end if;
  if r1.best_flame <> 29 then
    raise exception 'FAIL (a): dormancy touched best_flame (%)', r1.best_flame;
  end if;

  -- The person comes back and chooses to start again.
  v_back := public.create_challenge('hard', 'America/Toronto');
  select * into back_c from public.challenges where id = v_back;
  if back_c.restarted_from is not null then
    raise exception 'FAIL (a): the challenge a returning person starts is a restart';
  end if;
  if back_c.best_flame <> 29 or back_c.flame <> 0 then
    raise exception 'FAIL (a): the returning person''s history did not come with them (best %, flame %)',
      back_c.best_flame, back_c.flame;
  end if;
  -- 0017: every new challenge starts at cursor 0 so day 1 is visited (and
  -- paid if met); first_judged_day 2 is what keeps it from being a miss.
  if back_c.last_evaluated_day <> 0 or back_c.first_judged_day <> 2 then
    raise exception 'FAIL (a): a fresh challenge should start at cursor 0 with first_judged_day 2 (% / %)',
      back_c.last_evaluated_day, back_c.first_judged_day;
  end if;

  raise notice 'PASS (a): the second empty run ends dormant — no replacement, no feed item, history kept and carried';
end $$;

do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000de';
  v_old uuid;
  v_r1  uuid;
  v_r2  uuid;
  v_r3  uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Counter-reset') on conflict do nothing;
  v_old := public.create_challenge('hard', 'UTC');

  -- Run one, empty -> restart.
  call t_set_day(v_old, 3);
  perform public.evaluate_challenge(v_old);
  v_r1 := t_challenge(v_uid);
  if v_r1 is null or v_r1 = v_old then
    raise exception 'FIXTURE (b): the first empty run did not restart';
  end if;

  -- Run two: day 1 fully done (sealed by the evaluator), day 2 missed
  -- -> restart. ONE sealed day.
  call t_do_day(v_r1, 1);
  call t_move_day(v_r1, 3);
  perform public.evaluate_challenge(v_r1);
  v_r2 := t_challenge(v_uid);
  if v_r2 is null or v_r2 in (v_old, v_r1)
     or (select restarted_from from public.challenges where id = v_r2) <> v_r1 then
    raise exception 'FIXTURE (b): the run with a sealed day did not restart on its miss';
  end if;
  if not exists (select 1 from public.challenge_days
                  where challenge_id = v_r1 and day = 1 and sealed_at is not null) then
    raise exception 'FIXTURE (b): run two''s day 1 was not sealed';
  end if;

  -- Run three, empty. Its parent had a sealed day, so the count is 1, not 2.
  call t_move_day(v_r2, 2);
  perform public.evaluate_challenge(v_r2);
  v_r3 := t_challenge(v_uid);
  if (select ended_reason from public.challenges where id = v_r2) is distinct from 'missed_day' then
    raise exception 'FAIL (b): an empty run after a run WITH a sealed day ended as %, expected missed_day (a restart)',
      coalesce((select ended_reason from public.challenges where id = v_r2), '(still running)');
  end if;
  if v_r3 is null or v_r3 in (v_old, v_r1, v_r2)
     or (select restarted_from from public.challenges where id = v_r3) <> v_r2 then
    raise exception 'FAIL (b): the empty run after a sealed-day run did not restart';
  end if;

  raise notice 'PASS (b): one sealed day resets the count — the next empty run still restarts';
end $$;

do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000df';
  v_old uuid;
  v_r1  uuid;
  r1    public.challenges;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Never') on conflict do nothing;
  v_old := public.create_challenge('hard', 'America/Los_Angeles');

  -- Signed up, never ticked anything. Run one (the fresh challenge) is
  -- empty and restarts; run two is empty and does not.
  call t_set_day(v_old, 3);
  perform public.evaluate_challenge(v_old);
  v_r1 := t_challenge(v_uid);
  if v_r1 is null or v_r1 = v_old then
    raise exception 'FIXTURE (c): the fresh empty challenge did not get its one restart';
  end if;

  call t_move_day(v_r1, 2);
  perform public.evaluate_challenge(v_r1);
  select * into r1 from public.challenges where id = v_r1;
  if r1.ended_reason is distinct from 'dormant' then
    raise exception 'FAIL (c): a never-completed account''s second run ended as %, expected dormant',
      coalesce(r1.ended_reason, '(still running)');
  end if;
  if t_challenge(v_uid) is not null then
    raise exception 'FAIL (c): a never-completed account was restarted a second time';
  end if;
  if (select count(*) from public.challenges where owner = v_uid) <> 2 then
    raise exception 'FAIL (c): expected exactly 2 challenges (fresh + one restart), found %',
      (select count(*) from public.challenges where owner = v_uid);
  end if;

  raise notice 'PASS (c): never completed anything — dormant at the end of the second run, like everyone else';
end $$;

do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000e0';
  v_old uuid;
  v_r1  uuid;
  v_r2  uuid;
  old_c public.challenges;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Control') on conflict do nothing;
  v_old := public.create_challenge('hard', 'America/Toronto');

  -- The PROOF 1 shape: days 2 and 3 done, day 4 missed. Restarts exactly as today.
  call t_set_day(v_old, 5);
  call t_do_day(v_old, 2);
  call t_do_day(v_old, 3);
  perform public.evaluate_challenge(v_old);
  select * into old_c from public.challenges where id = v_old;
  if old_c.ended_reason is distinct from 'missed_day' or old_c.ended_on_day <> 4 then
    raise exception 'FAIL (d): an active person''s miss ended as % on day %, expected missed_day on day 4',
      coalesce(old_c.ended_reason, '(still running)'), coalesce(old_c.ended_on_day::text, 'null');
  end if;
  v_r1 := t_challenge(v_uid);
  if v_r1 is null or v_r1 = v_old then
    raise exception 'FAIL (d): an active person''s miss did not restart';
  end if;

  -- Their restart is left empty. Its parent had two sealed days, so this is
  -- the FIRST empty run: it restarts again.
  call t_move_day(v_r1, 2);
  perform public.evaluate_challenge(v_r1);
  v_r2 := t_challenge(v_uid);
  if (select ended_reason from public.challenges where id = v_r1) is distinct from 'missed_day' then
    raise exception 'FAIL (d): the first empty run after an active run ended as %, expected missed_day',
      coalesce((select ended_reason from public.challenges where id = v_r1), '(still running)');
  end if;
  if v_r2 is null or v_r2 in (v_old, v_r1) then
    raise exception 'FAIL (d): the first empty run after an active run did not restart';
  end if;

  raise notice 'PASS (d): an active person''s miss restarts as today, and their first empty run restarts again';
end $$;

-- =============================================================================
-- PROOF 13 — DAY 1 PAYS WHAT IT EARNED, ONCE (Phase 38F, F2)
--
-- Before 0017 the floor of 2 did two jobs: it kept day 1 of a fresh challenge
-- from being judged a miss (right) and it kept the evaluator's retroactive
-- seal away from it (wrong). A person who ticked every task on day 1 and did
-- not tap seal lost that flame permanently. Production: every sealed row
-- with a null outcome is a day 1.
--
-- THE PAY-ONCE QUESTION, answered before the fix was written. seal_day()
-- seals only an OPEN day; the evaluator seals only a CLOSED one; both key on
-- sealed_at. So the two payers never see the same day at the same time.
--
--   (a) day 1 met, never sealed, then it closes -> the evaluator seals it,
--       outcome met, flame 1; a second run pays nothing        FAILS before
--   (b) day 1 met and sealed BY HAND while open -> flame 1 at the tap; the
--       evaluator later writes outcome met and pays nothing     guard
--   (c) after (a), a hand seal of day 1 is refused: the day is closed, and
--       flame stays 1                                            guard
--   (d) day 1 untouched on a fresh challenge -> visited, nothing written,
--       not a miss, cursor advances                              guard
--
-- (b), (c) and (d) pass before and after; they are here so the fix can never
-- become "pay twice" or "judge day 1 after all".
-- =============================================================================
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000e1';
  v_ch  uuid;
  c     public.challenges;
  d1    public.challenge_days;
  v_n   integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Day1-unsealed') on conflict do nothing;
  v_ch := public.create_challenge('hard', 'UTC');

  -- Every task on day 1 ticked; seal never tapped. Then day 1 closes.
  call t_do_day(v_ch, 1);
  call t_move_day(v_ch, 2);
  v_n := public.evaluate_challenge(v_ch);

  select * into d1 from public.challenge_days where challenge_id = v_ch and day = 1;
  select * into c  from public.challenges where id = v_ch;
  if d1.sealed_at is null or d1.outcome is distinct from 'met' then
    raise exception 'FAIL (a): a met, unsealed day 1 was not sealed and scored (sealed_at %, outcome %) — the flame is lost',
      coalesce(d1.sealed_at::text, 'null'), coalesce(d1.outcome, 'null');
  end if;
  if c.flame <> 1 or c.best_flame <> 1 then
    raise exception 'FAIL (a): flame % best % after a met day 1, expected 1 and 1', c.flame, c.best_flame;
  end if;
  if c.ended_at is not null then
    raise exception 'FAIL (a): a met day 1 ended the challenge (%)', c.ended_reason;
  end if;
  if c.last_evaluated_day <> 1 or v_n <> 1 then
    raise exception 'FAIL (a): cursor % / judged %, expected 1 / 1', c.last_evaluated_day, v_n;
  end if;

  -- PAY ONCE: a second run finds it sealed and pays nothing.
  perform public.evaluate_challenge(v_ch);
  if (select flame from public.challenges where id = v_ch) <> 1 then
    raise exception 'FAIL (a): a second evaluation paid day 1 again';
  end if;

  raise notice 'PASS (a): a met, unsealed day 1 is sealed, scored met and pays flame 1, once';
end $$;

do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000e2';
  v_ch  uuid;
  c     public.challenges;
  d1    public.challenge_days;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Day1-by-hand') on conflict do nothing;
  v_ch := public.create_challenge('hard', 'UTC');

  -- Day 1 ticked and sealed by the person, while it is open.
  perform public.get_or_freeze_today();
  call t_do_day(v_ch, 1);
  perform public.seal_day(1);
  select * into c from public.challenges where id = v_ch;
  if c.flame <> 1 then
    raise exception 'FIXTURE (b): seal_day did not pay day 1 (flame %)', c.flame;
  end if;

  -- Then it closes and the evaluator visits it.
  call t_move_day(v_ch, 2);
  perform public.evaluate_challenge(v_ch);
  select * into d1 from public.challenge_days where challenge_id = v_ch and day = 1;
  select * into c  from public.challenges where id = v_ch;
  if c.flame <> 1 then
    raise exception 'FAIL (b): the evaluator paid a day seal_day had already paid (flame %)', c.flame;
  end if;
  if d1.outcome is distinct from 'met' or d1.evaluated_at is null then
    raise exception 'FAIL (b): a hand-sealed day 1 was not scored met by the evaluator';
  end if;

  raise notice 'PASS (b): a day 1 sealed by hand is paid at the tap and only scored, not paid again, by the evaluator';
end $$;

do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000e1';
  v_ch  uuid;
  v_msg text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  v_ch := t_challenge(v_uid);

  -- (a) left day 1 sealed by the evaluator and closed. A hand seal now is
  -- refused, so the two payers cannot meet on one day.
  begin
    perform public.seal_day(1);
    raise exception 'FAIL (c): seal_day accepted a closed day 1';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like 'FAIL%' then raise; end if;
    if v_msg not like '%closed%' then
      raise exception 'FAIL (c): seal_day refused for a reason other than the day being closed: %', v_msg;
    end if;
  end;
  if (select flame from public.challenges where id = v_ch) <> 1 then
    raise exception 'FAIL (c): flame moved on a refused seal';
  end if;

  raise notice 'PASS (c): after the evaluator sealed day 1, a hand seal is refused and flame stays 1';
end $$;

do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000e3';
  v_ch  uuid;
  c     public.challenges;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Day1-untouched') on conflict do nothing;
  v_ch := public.create_challenge('hard', 'UTC');

  -- Day 1 frozen and untouched. It closes. Visited, and nothing written.
  perform public.get_or_freeze_today();
  call t_move_day(v_ch, 2);
  perform public.evaluate_challenge(v_ch);
  select * into c from public.challenges where id = v_ch;
  if c.ended_at is not null then
    raise exception 'FAIL (d): an untouched day 1 on a fresh challenge was judged a miss (%)', c.ended_reason;
  end if;
  if exists (select 1 from public.challenge_days
              where challenge_id = v_ch and day = 1
                and (outcome is not null or evaluated_at is not null or sealed_at is not null)) then
    raise exception 'FAIL (d): something was written on an untouched, protected day 1';
  end if;
  if c.flame <> 0 then
    raise exception 'FAIL (d): flame % on an untouched day 1', c.flame;
  end if;

  raise notice 'PASS (d): an untouched day 1 on a fresh challenge is passed over — not a miss, nothing written';
end $$;

-- =============================================================================
-- PROOF 14 — A MISSED DAY CAN BE REOPENED, AND REOPENING PAYS NOTHING
-- (Phase 38G, G2; migration 0018)
--
-- The owner's shape: 29 met days, day 30 done but never logged, judged
-- missed at noon on day 31, restarted; day 1 of the replacement sealed,
-- now on its day 2. The fixture below builds exactly that, then:
--
--   (a) THE INTEGRITY PROPERTY. restore_missed_day() reopens the original,
--       supersedes the replacement, carries the replacement's day across
--       UNSEALED with its completions, posts one correction — and changes
--       no flame, seals nothing, writes no miss.                FAILS before
--   (b) seal the reopened day -> 30; it closes; the evaluator scores it
--       met and pays the carried day once -> 31, then a second run pays
--       nothing                                                  FAILS before
--   (c) restore and do NOT seal -> the reopened day closes, the evaluator
--       judges it missed again, the run ends again, flame 29, no sealed day
--       manufactured; and a second restore is refused           FAILS before
--   (d) a miss ten days old -> refused, and the offer read is empty
--   (e) a stranger through the real RPC, as `authenticated` -> refused, and
--       the owner's rows are untouched
--
-- Against 0017 every block fails at its first restore_missed_day() call:
-- the function does not exist.
-- =============================================================================

-- The owner's shape, as a procedure so three accounts get the identical
-- fixture. Leaves the original ended on day 30 and the replacement on ITS
-- day 2 with day 1 sealed, both in the same zone, today = original day 32.
create or replace procedure t_restore_fixture(p_uid uuid, p_name text, p_squad text)
language plpgsql as $$
declare
  v_o uuid;
  v_r uuid;
  i   integer;
  o   public.challenges;
  r   public.challenges;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (p_uid, p_name) on conflict do nothing;
  v_o := public.create_challenge('hard', 'America/Toronto');
  perform id from public.create_squad(p_squad);

  -- Day 31 today. Days 1..29 done, day 30 untouched.
  call t_set_day(v_o, 31);
  for i in 1 .. 29 loop
    call t_do_day(v_o, i);
  end loop;
  perform public.evaluate_challenge(v_o);       -- 1..29 met, 30 missed -> restart

  select * into o from public.challenges where id = v_o;
  if o.ended_reason is distinct from 'missed_day' or o.ended_on_day <> 30
     or o.flame <> 29 or o.best_flame <> 29 then
    raise exception 'FIXTURE: original is % on day % with flame % / best %',
      coalesce(o.ended_reason, 'alive'), o.ended_on_day, o.flame, o.best_flame;
  end if;
  v_r := t_challenge(p_uid);
  if v_r is null or v_r = v_o then
    raise exception 'FIXTURE: no replacement was created';
  end if;

  -- The replacement's day 1 fully done; then a day passes for BOTH rows
  -- (same zone, same shift) so it is on day 2 and day 1 has closed.
  call t_do_day(v_r, 1);
  call t_move_day(v_o, 32);
  call t_move_day(v_r, 2);
  perform public.evaluate_challenge(v_r);       -- day 1 met, sealed, flame 1

  select * into r from public.challenges where id = v_r;
  if r.flame <> 1 or r.restarted_from <> v_o
     or not exists (select 1 from public.challenge_days
                     where challenge_id = v_r and day = 1 and sealed_at is not null) then
    raise exception 'FIXTURE: replacement is not on day 2 with day 1 sealed (flame %)', r.flame;
  end if;
end $$;

-- ---- (a) the integrity property ------------------------------------------
do $$
declare
  v_uid  uuid := '00000000-0000-0000-0000-0000000000e4';
  v_o    uuid;
  v_r    uuid;
  o      public.challenges;
  r      public.challenges;
  d30    public.challenge_days;
  v_n    integer;
  v_win  record;
begin
  call t_restore_fixture(v_uid, 'Restore-continues', 'Restore squad');
  select id into v_o from public.challenges where owner = v_uid and ended_reason = 'missed_day';
  v_r := t_challenge(v_uid);
  -- The miss reached the feed (the owner was active), so a correction can
  -- be posted beside it.
  if (select count(*) from public.feed_items where author = v_uid and kind = 'miss') <> 1 then
    raise exception 'FIXTURE (a): expected exactly one miss item before the restore';
  end if;

  perform public.restore_missed_day();

  select * into o from public.challenges where id = v_o;
  select * into r from public.challenges where id = v_r;
  if o.ended_at is not null or o.ended_reason is not null or o.ended_on_day is not null then
    raise exception 'FAIL (a): the original was not reopened (% / %)', o.ended_reason, o.ended_on_day;
  end if;
  if o.restored_at is null or o.restored_day <> 30 or o.last_evaluated_day <> 29 then
    raise exception 'FAIL (a): the reversal is not recorded (restored_at %, day %, cursor %)',
      o.restored_at, o.restored_day, o.last_evaluated_day;
  end if;
  if r.ended_reason is distinct from 'superseded' or r.ended_at is null then
    raise exception 'FAIL (a): the replacement was not superseded (%)', coalesce(r.ended_reason, 'alive');
  end if;
  if (select count(*) from public.challenges where owner = v_uid and ended_at is null) <> 1 then
    raise exception 'FAIL (a): the owner does not hold exactly one alive challenge';
  end if;

  -- RESTORING CHANGES NO FLAME.
  if o.flame <> 29 or o.best_flame <> 29 then
    raise exception 'FAIL (a): the restore touched the flame (% / best %)', o.flame, o.best_flame;
  end if;
  if (select count(*) from public.challenge_days where challenge_id = v_o and sealed_at is not null) <> 29 then
    raise exception 'FAIL (a): the restore sealed something (% sealed, expected 29)',
      (select count(*) from public.challenge_days where challenge_id = v_o and sealed_at is not null);
  end if;

  -- The missed day is open again, judged from the same snapshot.
  select * into d30 from public.challenge_days where challenge_id = v_o and day = 30;
  if d30.sealed_at is not null or d30.outcome is not null or d30.evaluated_at is not null then
    raise exception 'FAIL (a): day 30 was not reopened';
  end if;
  if jsonb_array_length(d30.task_snapshot) = 0 then
    raise exception 'FAIL (a): day 30 lost its snapshot';
  end if;

  -- Carried: the replacement's day 1 is the original's day 31, unsealed,
  -- with every completion; the replacement's own row is untouched.
  if not exists (select 1 from public.challenge_days where challenge_id = v_o and day = 31 and sealed_at is null) then
    raise exception 'FAIL (a): the replacement''s day was not carried across unsealed';
  end if;
  if (select count(*) from public.task_completions where challenge_id = v_o and day = 31)
     <> (select jsonb_array_length(task_snapshot) from public.challenge_days where challenge_id = v_o and day = 31) then
    raise exception 'FAIL (a): the carried day did not bring its completions';
  end if;
  if not exists (select 1 from public.challenge_days where challenge_id = v_r and day = 1 and sealed_at is not null) then
    raise exception 'FAIL (a): the replacement''s own sealed row was touched';
  end if;

  -- The feed: the miss stays, one correction beside it, no new miss.
  if (select count(*) from public.feed_items where author = v_uid and kind = 'miss') <> 1 then
    raise exception 'FAIL (a): the miss item was deleted or duplicated';
  end if;
  if (select count(*) from public.feed_items where author = v_uid and kind = 'change' and text like 'reopened Day 30%') <> 1 then
    raise exception 'FAIL (a): expected exactly one correction beside the miss';
  end if;

  -- The screen can reach it: the window offers day 30, open, with its own close.
  select * into v_win from public.get_day_window() w where w.day = 30;
  if v_win.day is null or not v_win.is_open or v_win.reopened_until is null or v_win.reopened_until <= now() then
    raise exception 'FAIL (a): get_day_window does not offer the reopened day (open %, until %)',
      v_win.is_open, v_win.reopened_until;
  end if;
  if not exists (select 1 from public.get_day_window() w where w.day = 32 and w.is_today) then
    raise exception 'FAIL (a): today (day 32) vanished from the window';
  end if;

  -- And the evaluator, run right now, judges nothing: the reopened day is open.
  v_n := public.evaluate_challenge(v_o);
  select * into o from public.challenges where id = v_o;
  if v_n <> 0 or o.flame <> 29 or o.last_evaluated_day <> 29 or o.ended_at is not null then
    raise exception 'FAIL (a): the evaluator judged the reopened day while it was open (judged %, flame %, cursor %)',
      v_n, o.flame, o.last_evaluated_day;
  end if;

  raise notice 'PASS (a): restore reopens the day, supersedes the replacement, carries the work unsealed, corrects the feed — and pays nothing';
end $$;

-- ---- (b) seal it, and the run continues at 30, then 31 -------------------
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000e4';
  v_o   uuid;
  o     public.challenges;
  d31   public.challenge_days;
  v_n   integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  v_o := t_challenge(v_uid);

  -- The person completes and seals the reopened day. seal_day sees it open.
  call t_do_day(v_o, 30);
  perform public.seal_day(30);
  select * into o from public.challenges where id = v_o;
  if o.flame <> 30 or o.best_flame <> 30 then
    raise exception 'FAIL (b): sealing the reopened day paid % (best %), expected 30', o.flame, o.best_flame;
  end if;

  -- The reopened window closes (the restore was two days ago) and the
  -- evaluator runs: day 30 met (already paid), day 31 carried and met ->
  -- sealed and paid ONCE. The run continues.
  update public.challenges set restored_at = now() - interval '2 days' where id = v_o;
  v_n := public.evaluate_challenge(v_o);
  select * into o from public.challenges where id = v_o;
  select * into d31 from public.challenge_days where challenge_id = v_o and day = 31;
  if o.ended_at is not null then
    raise exception 'FAIL (b): the run ended after the day was sealed (%)', o.ended_reason;
  end if;
  if (select outcome from public.challenge_days where challenge_id = v_o and day = 30) is distinct from 'met' then
    raise exception 'FAIL (b): the reopened day was not scored met';
  end if;
  if d31.sealed_at is null or d31.outcome is distinct from 'met' then
    raise exception 'FAIL (b): the carried day was not sealed and scored met';
  end if;
  if o.flame <> 31 or o.best_flame <> 31 or o.last_evaluated_day <> 31 then
    raise exception 'FAIL (b): after the carried day flame % best % cursor %, expected 31 / 31 / 31',
      o.flame, o.best_flame, o.last_evaluated_day;
  end if;

  -- PAY ONCE: a second run pays nothing.
  perform public.evaluate_challenge(v_o);
  if (select flame from public.challenges where id = v_o) <> 31 then
    raise exception 'FAIL (b): a second evaluation paid the carried day again';
  end if;

  -- And nothing left to restore: the reopened challenge is alive.
  if exists (select 1 from public.my_restorable_miss()) then
    raise exception 'FAIL (b): the offer is still on after a restore';
  end if;

  raise notice 'PASS (b): sealed, the run continues at 30, then 31 for the carried day, paid once';
end $$;

-- ---- (c) restored but never sealed -> ended again, nothing manufactured ---
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000e5';
  v_o   uuid;
  v_r2  uuid;
  o     public.challenges;
  v_msg text;
begin
  call t_restore_fixture(v_uid, 'Restore-unsealed', 'Unsealed squad');
  select id into v_o from public.challenges where owner = v_uid and ended_reason = 'missed_day';
  perform public.restore_missed_day();

  -- Nothing done. The reopened window closes; the evaluator judges day 30
  -- missed again; Hard restarts; flame is exactly what it was.
  update public.challenges set restored_at = now() - interval '2 days' where id = v_o;
  perform public.evaluate_challenge(v_o);
  select * into o from public.challenges where id = v_o;
  if o.ended_reason is distinct from 'missed_day' or o.ended_on_day <> 30 then
    raise exception 'FAIL (c): an unsealed reopened day did not end the run again (% / %)',
      coalesce(o.ended_reason, 'alive'), o.ended_on_day;
  end if;
  if o.flame <> 29 or o.best_flame <> 29 then
    raise exception 'FAIL (c): flame moved on a day that was never completed (% / %)', o.flame, o.best_flame;
  end if;
  if (select count(*) from public.challenge_days where challenge_id = v_o and sealed_at is not null) <> 29 then
    raise exception 'FAIL (c): a sealed day was manufactured';
  end if;
  v_r2 := t_challenge(v_uid);
  if v_r2 is null or (select restarted_from from public.challenges where id = v_r2) <> v_o then
    raise exception 'FAIL (c): the second miss did not restart';
  end if;

  -- ONE RESTORE PER CHALLENGE.
  begin
    perform public.restore_missed_day();
    raise exception 'FAIL (c): a challenge was restored twice';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like 'FAIL%' then raise; end if;
    if v_msg not like 'already restored%' then
      raise exception 'FAIL (c): the second restore was refused for the wrong reason: %', v_msg;
    end if;
  end;
  if exists (select 1 from public.my_restorable_miss()) then
    raise exception 'FAIL (c): the offer is on for a challenge already restored';
  end if;

  raise notice 'PASS (c): restored and not sealed — ended again at the next noon, flame unchanged, nothing manufactured, no second restore';
end $$;

-- ---- (d) ten days dead -> refused ------------------------------------------
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000e6';
  v_o   uuid;
  v_r   uuid;
  v_msg text;
begin
  call t_restore_fixture(v_uid, 'Restore-late', 'Late squad');
  select id into v_o from public.challenges where owner = v_uid and ended_reason = 'missed_day';
  v_r := t_challenge(v_uid);
  -- Eight more days pass for both rows: the missed day is now ten days ago.
  update public.challenges set start_date = start_date - 8 where id in (v_o, v_r);

  if exists (select 1 from public.my_restorable_miss()) then
    raise exception 'FAIL (d): the offer is on for a miss outside the window';
  end if;
  begin
    perform public.restore_missed_day();
    raise exception 'FAIL (d): a ten-day-old miss was restored';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like 'FAIL%' then raise; end if;
    if v_msg not like 'restore window closed%' then
      raise exception 'FAIL (d): refused for the wrong reason: %', v_msg;
    end if;
  end;
  if (select ended_reason from public.challenges where id = v_o) is distinct from 'missed_day' then
    raise exception 'FAIL (d): a refused restore changed the original';
  end if;

  raise notice 'PASS (d): a miss outside the seven-day window is refused, and the offer is off';
end $$;

-- ---- (e) a stranger, through the real RPC, as authenticated ----------------
set role authenticated;
do $$
declare
  v_me     uuid := '00000000-0000-0000-0000-0000000000e7';
  v_victim uuid := '00000000-0000-0000-0000-0000000000e6';
  v_msg    text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_me, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_me, 'Stranger') on conflict do nothing;
  perform public.create_challenge('hard', 'UTC');

  -- The RPC takes no id: it can only ever act for the caller, and this
  -- caller has nothing ended by a miss.
  begin
    perform public.restore_missed_day();
    raise exception 'FAIL (e): a stranger''s restore call succeeded';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like 'FAIL%' then raise; end if;
    if v_msg not like 'nothing to restore%' then
      raise exception 'FAIL (e): refused for the wrong reason: %', v_msg;
    end if;
  end;
  -- The victim's rows, seen through RLS as the stranger: not even readable.
  if (select count(*) from public.challenges where owner = v_victim) <> 0 then
    raise exception 'FAIL (e): a stranger can read somebody else''s challenges';
  end if;
  raise notice 'PASS (e): nobody can restore anyone else''s challenge — the RPC has no one to act for but its caller';
end $$;
reset role;

-- The victim's rows, seen as the superuser: still ended by the miss, untouched.
do $$
begin
  if (select count(*) from public.challenges
       where owner = '00000000-0000-0000-0000-0000000000e6' and ended_reason = 'missed_day') <> 1 then
    raise exception 'FAIL (e): the stranger''s call changed the other owner''s challenge';
  end if;
end $$;

drop procedure t_restore_fixture(uuid, text, text);
drop procedure t_move_day(uuid, integer);
drop procedure t_do_day(uuid, integer);
drop procedure t_set_day(uuid, integer);
drop function t_challenge(uuid);

select 'ALL MISSED-DAY PROOFS PASSED' as result;
