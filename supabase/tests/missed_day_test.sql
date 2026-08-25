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
  ('00000000-0000-0000-0000-0000000000d8', 'sim@test.dev')
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
-- evaluator's cursor to "day 1 judged, nothing since" — the state a real
-- challenge is in the moment it is created.
create or replace procedure t_set_day(p_challenge uuid, p_day integer)
language plpgsql as $$
begin
  -- Anchored on the CHALLENGE's timezone, not the server's date.
  --
  -- This read `current_date - (p_day - 1)`, which is the server's own day.
  -- challenge_day() computes `(now() at time zone c.timezone)::date`, so for
  -- any challenge not in the server's zone the two disagreed for exactly as
  -- long as the calendars were on different dates — an hour a day for the
  -- Europe/London fixture below, during which proof 3 failed with "medium
  -- moved the day count (day = 5)" and nothing was wrong with the engine.
  update public.challenges
     set start_date = (now() at time zone timezone)::date - (p_day - 1),
         last_evaluated_day = 1
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
  v_old := public.create_challenge('hard', current_date, 'America/Toronto');
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
  v_ch := public.create_challenge('hard', current_date, 'UTC');

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
  v_ch := public.create_challenge('medium', current_date, 'Europe/London');
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
  v_ch := public.create_challenge('hard', current_date, 'Australia/Sydney');
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
  v_ch := public.create_challenge('hard', current_date, 'UTC');

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
  v_ch := public.create_challenge('hard', current_date, 'UTC');

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
  perform public.create_challenge('hard', current_date, 'UTC');
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
  if not has_function_privilege('authenticated', 'public.seal_day()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_or_freeze_today()', 'EXECUTE') then
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

drop procedure t_do_day(uuid, integer);
drop procedure t_set_day(uuid, integer);
drop function t_challenge(uuid);

select 'ALL MISSED-DAY PROOFS PASSED' as result;
