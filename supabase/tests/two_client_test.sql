-- =============================================================================
-- Executable proofs for ONE ACCOUNT ON TWO CLIENTS (Phase 17A, A3).
--
-- Run after setup_local.sql + every migration, as the postgres superuser:
--   psql -v ON_ERROR_STOP=1 -f two_client_test.sql
--
-- WHAT "TWO CLIENTS" MEANS HERE, AND WHY THIS FILE IS SQL RATHER THAN A
-- UI TEST.
--
--   A friend mid-challenge will run the web build on a laptop and the native
--   build on a phone, signed into the same email, for weeks. Both are the
--   same auth.uid(), both hold their OWN optimistic mirror, and neither is
--   told when the other writes. So a "second client" is, on the server, an
--   identical caller arriving with STALE beliefs: it thinks the task is not
--   done, the day is not sealed, the flame is one lower.
--
--   Everything that stops that from costing someone their streak lives in
--   the RPCs, not in the app. That is exactly what is provable here and not
--   provable through either UI: a mirror can only be wrong on screen until
--   the next refresh, but if the SERVER double-counted, both clients would
--   agree on a wrong number forever.
--
-- Each proof names the client pair it stands for. Every check raises on
-- failure; a clean exit means all proofs hold.
-- =============================================================================

\set QUIET on
\pset pager off

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000002c1', 'two-client@test.dev'),
  ('00000000-0000-0000-0000-0000000002c2', 'two-mate@test.dev')
on conflict do nothing;

create or replace procedure test_login(p_user uuid)
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
end $$;

-- Put a challenge at "day p_day, p_hour o'clock, LOCAL" by moving it into a
-- zone in which right now IS p_hour, then anchoring start_date on that same
-- zone. Same lever as grace_window_test.sql, kept local to this file so the
-- suite is self-contained and cannot be broken by another file's helper.
create or replace procedure t2_set_clock(
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

  if (select public.challenge_day(c) from public.challenges c
       where c.id = p_challenge) <> p_day then
    raise exception 't2_set_clock: challenge day is not %', p_day;
  end if;
end $$;

-- Complete every task in a day's snapshot without sealing. Server-side, so
-- it stands in for "the other client already did all this".
create or replace procedure t2_do_day(p_challenge uuid, p_day integer)
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

-- The first task key in a day's frozen snapshot. Read rather than hardcoded:
-- the task set is composed from the tier and would drift.
create or replace function t2_first_task(p_challenge uuid, p_day integer)
returns text language sql stable as $$
  select t->>'key'
  from public.challenge_days cd,
       lateral jsonb_array_elements(cd.task_snapshot) t
  where cd.challenge_id = p_challenge and cd.day = p_day
  limit 1;
$$;

create or replace function t2_completions(p_challenge uuid, p_day integer, p_key text)
returns integer language sql stable as $$
  select count(*)::integer from public.task_completions
   where challenge_id = p_challenge and day = p_day and task_key = p_key;
$$;

create or replace function t2_day_of(p_challenge uuid)
returns integer language sql stable as $$
  select public.challenge_day(c) from public.challenges c where c.id = p_challenge;
$$;


-- =============================================================================
-- PROOF 1 — WEB AND NATIVE ARE THE SAME ACCOUNT, AND IT HAS ONE CHALLENGE
--
-- Client pair: a friend installs the native build while the web app is still
-- on their laptop. The native cold start has NO local state — so if "no
-- local state" could ever mean "new user", this is where a second challenge
-- would be born and a day-23 streak would present as day 1.
-- =============================================================================
do $$
declare
  v_uid  uuid := '00000000-0000-0000-0000-0000000002c1';
  v_web  public.challenge_days;
  v_nat  public.challenge_days;
  v_id   uuid;
  v_live integer;
  v_msg  text;
begin
  delete from public.challenges where owner = v_uid;
  call test_login(v_uid);
  insert into public.profiles (id, name) values (v_uid, 'Two Client')
    on conflict (id) do update set name = 'Two Client';

  -- "web", already running: creates the challenge and freezes day 1.
  v_id  := public.create_challenge('hard', 'America/Toronto', 75);
  v_web := public.get_or_freeze_today();

  -- "native", first launch, nothing stored locally. The ONLY question it
  -- asks is get_or_freeze_today(), and the answer is the same row.
  v_nat := public.get_or_freeze_today();

  if v_nat.id is distinct from v_web.id then
    raise exception 'FAIL: the second client got a different day row (% vs %)',
      v_nat.id, v_web.id;
  end if;
  if v_nat.challenge_id is distinct from v_id then
    raise exception 'FAIL: the second client resolved a different challenge';
  end if;
  if v_nat.day is distinct from v_web.day then
    raise exception 'FAIL: the two clients disagree about the day (% vs %)',
      v_nat.day, v_web.day;
  end if;

  -- And there is no path to a second one. checkAccount() routes to setup only
  -- when this call raises "no challenge for user"; it did not. Should a
  -- future client call create_challenge() anyway, the partial unique index
  -- (0007, challenges_one_active_owner) is the wall.
  begin
    perform public.create_challenge('hard', 'Europe/London', 75);
    raise exception 'FAIL: a second live challenge was created for one owner';
  exception
    when unique_violation then null;
    when others then
      get stacked diagnostics v_msg = message_text;
      if v_msg like 'FAIL:%' then raise; end if;
  end;

  select count(*) into v_live from public.challenges
    where owner = v_uid and ended_at is null;
  if v_live <> 1 then
    raise exception 'FAIL: owner holds % live challenges, expected 1', v_live;
  end if;

  raise notice 'PASS: a client with no local state lands on the SAME challenge and day, and cannot create a second one';
end $$;


-- =============================================================================
-- PROOF 2 — THE DAY BOUNDARY DOES NOT MOVE WHEN THE DEVICE DOES
--
-- Client pair: a laptop browser reporting America/Toronto and a phone
-- reporting something else. challenges.timezone defines the day boundary for
-- the whole run; if any client could re-derive and write it, a day could seal
-- early or today's tasks could land on yesterday.
--
-- Two walls, both proved here: `authenticated` holds no UPDATE privilege on
-- public.challenges at all, and create_challenge — the only function in the
-- schema that writes the column — is unreachable for an owner who already has
-- a live challenge (proof 1).
-- =============================================================================
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000002c1';
  v_id  uuid;
  v_tz  text;
  v_key text;
begin
  call test_login(v_uid);
  select id, timezone into v_id, v_tz from public.challenges
    where owner = v_uid and ended_at is null;
  if v_tz <> 'America/Toronto' then
    raise exception 'FAIL: setup timezone is %, expected America/Toronto', v_tz;
  end if;

  if has_table_privilege('authenticated', 'public.challenges', 'UPDATE') then
    raise exception 'FAIL: authenticated can UPDATE public.challenges — timezone is writable';
  end if;
  if has_column_privilege('authenticated', 'public.challenges', 'timezone', 'UPDATE') then
    raise exception 'FAIL: authenticated can UPDATE challenges.timezone';
  end if;

  -- A launch's worth of ordinary client traffic, from both clients. None of
  -- it may move the zone.
  perform public.get_or_freeze_today();
  v_key := t2_first_task(v_id, t2_day_of(v_id));
  perform public.complete_task(v_key);
  perform public.get_day_window();
  perform public.get_or_freeze_today();

  if (select timezone from public.challenges where id = v_id) <> 'America/Toronto' then
    raise exception 'FAIL: the challenge timezone changed to %',
      (select timezone from public.challenges where id = v_id);
  end if;

  raise notice 'PASS: challenges.timezone is not writable by any client, and a launch on a differently-zoned device does not move it';
end $$;


-- =============================================================================
-- PROOF 3 — THE SAME TASK, TICKED ON BOTH CLIENTS, IS ONE COMPLETION
--
-- Client pair: ticked on the phone, then ticked again on the laptop whose
-- mirror had not refreshed. And the squadmate — whichever client THEY are on
-- — reads the same count.
-- =============================================================================
do $$
declare
  v_uid  uuid := '00000000-0000-0000-0000-0000000002c1';
  v_mate uuid := '00000000-0000-0000-0000-0000000002c2';
  v_id   uuid;
  v_day  integer;
  v_key  text;
  v_sq   uuid;
  v_code text;
  v_done integer;
begin
  call test_login(v_uid);
  select id into v_id from public.challenges
    where owner = v_uid and ended_at is null;
  v_day := t2_day_of(v_id);
  v_key := t2_first_task(v_id, v_day);

  -- Client A ticks it (proof 2 already ticked once — this is "A" again).
  perform public.complete_task(v_key);
  -- Client B, stale mirror, ticks the same task.
  perform public.complete_task(v_key);
  -- And once more with the day named explicitly, the grace-window call shape.
  perform public.complete_task(p_task_key => v_key, p_day => v_day);

  if t2_completions(v_id, v_day, v_key) <> 1 then
    raise exception 'FAIL: % completion rows for one task, expected 1',
      t2_completions(v_id, v_day, v_key);
  end if;

  -- The squad sees one account, not one per client.
  delete from public.squad_members where user_id in (v_uid, v_mate);
  select s.id, s.code into v_sq, v_code from public.create_squad('Two Client Test') s;

  call test_login(v_mate);
  insert into public.profiles (id, name) values (v_mate, 'Mate')
    on conflict (id) do update set name = 'Mate';
  perform public.join_squad(v_code);

  select r.done_today into v_done
    from public.get_squad_status(v_sq) r where r.user_id = v_uid;
  if v_done is distinct from 1 then
    raise exception 'FAIL: the roster shows % tasks done for one completion', v_done;
  end if;

  raise notice 'PASS: one task ticked on two clients is one completion row, and the squad roster counts it once';
end $$;


-- =============================================================================
-- PROOF 4 — SEALING THE SAME DAY TWICE PAYS THE FLAME ONCE
--
-- Client pair: the phone finishes the last task and seals. The laptop, whose
-- mirror still says the day is unfinished, seals too when it is next opened.
-- The streak is the single most expensive number in the app to get wrong.
-- =============================================================================
do $$
declare
  v_uid    uuid := '00000000-0000-0000-0000-0000000002c1';
  v_id     uuid;
  v_day    integer;
  v_flame  integer;
  v_sealed timestamptz;
begin
  call test_login(v_uid);
  select id into v_id from public.challenges
    where owner = v_uid and ended_at is null;
  v_day := t2_day_of(v_id);

  call t2_do_day(v_id, v_day);

  -- Client A seals.
  perform public.seal_day();
  select flame into v_flame from public.challenges where id = v_id;
  select sealed_at into v_sealed from public.challenge_days
    where challenge_id = v_id and day = v_day;
  if v_flame <> 1 then
    raise exception 'FAIL: flame is % after one seal, expected 1', v_flame;
  end if;
  if v_sealed is null then
    raise exception 'FAIL: the day was not sealed';
  end if;

  -- Client B seals the same day. Twice, one of them with the day named.
  perform public.seal_day();
  perform public.seal_day(v_day);

  if (select flame from public.challenges where id = v_id) <> 1 then
    raise exception 'FAIL: flame is % after three seals of one day, expected 1',
      (select flame from public.challenges where id = v_id);
  end if;
  if (select best_flame from public.challenges where id = v_id) <> 1 then
    raise exception 'FAIL: best_flame is %, expected 1',
      (select best_flame from public.challenges where id = v_id);
  end if;
  if (select sealed_at from public.challenge_days
       where challenge_id = v_id and day = v_day) <> v_sealed then
    raise exception 'FAIL: the second seal moved sealed_at';
  end if;

  raise notice 'PASS: a day sealed from two clients pays the flame once and keeps its original sealed_at';
end $$;


-- =============================================================================
-- PROOF 5 — NEITHER CLIENT CAN RESURRECT A SEALED DAY
--
-- Client pair: the laptop's stale mirror shows the day unsealed with a task
-- still tickable, and the user un-ticks it. A sealed day is history.
-- =============================================================================
do $$
declare
  v_uid    uuid := '00000000-0000-0000-0000-0000000002c1';
  v_id     uuid;
  v_day    integer;
  v_key    text;
  v_before integer;
  v_sealed timestamptz;
  v_msg    text;
begin
  call test_login(v_uid);
  select id into v_id from public.challenges
    where owner = v_uid and ended_at is null;
  v_day := t2_day_of(v_id);
  v_key := t2_first_task(v_id, v_day);
  select count(*) into v_before from public.task_completions
    where challenge_id = v_id and day = v_day;
  select sealed_at into v_sealed from public.challenge_days
    where challenge_id = v_id and day = v_day;

  begin
    perform public.uncomplete_task(v_key);
    raise exception 'FAIL: a task was un-ticked on a SEALED day';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like 'FAIL:%' then raise; end if;
    if v_msg not like '%sealed%' then
      raise exception 'FAIL: refusal was "%", expected it to name the seal', v_msg;
    end if;
  end;

  if (select count(*) from public.task_completions
       where challenge_id = v_id and day = v_day) <> v_before then
    raise exception 'FAIL: a completion row was removed from a sealed day';
  end if;
  if (select sealed_at from public.challenge_days
       where challenge_id = v_id and day = v_day) <> v_sealed then
    raise exception 'FAIL: sealed_at moved';
  end if;
  if (select flame from public.challenges where id = v_id) <> 1 then
    raise exception 'FAIL: the flame moved on a refused un-tick';
  end if;

  raise notice 'PASS: a sealed day refuses the un-tick, and nothing about it moves';
end $$;


-- =============================================================================
-- PROOF 6 — ONCE THE DAY HAS CLOSED IT IS CLOSED ON BOTH CLIENTS
--
-- Client pair: the phone is left open past local noon the next day while the
-- laptop is opened fresh. The grace window is computed by the server from the
-- CHALLENGE's timezone, so neither client gets its own answer.
-- =============================================================================
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000002c1';
  v_id  uuid;
  v_key text;
  v_c   public.challenges;
  v_msg text;
begin
  call test_login(v_uid);
  select id into v_id from public.challenges
    where owner = v_uid and ended_at is null;
  v_key := t2_first_task(v_id, 1);

  -- 11am on day 2: day 1 is still open to BOTH clients.
  call t2_set_clock(v_id, 2, 11);
  select * into v_c from public.challenges where id = v_id;
  if not public.day_is_open(v_c, 1) then
    raise exception 'FAIL: day 1 is closed at 11am on day 2';
  end if;

  -- 1pm: closed, and every write RPC says so, whichever client asks.
  call t2_set_clock(v_id, 2, 13);
  select * into v_c from public.challenges where id = v_id;
  if public.day_is_open(v_c, 1) then
    raise exception 'FAIL: day 1 is still open at 1pm on day 2';
  end if;

  begin
    perform public.complete_task(p_task_key => v_key, p_day => 1);
    raise exception 'FAIL: a task was completed on a CLOSED day';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like 'FAIL:%' then raise; end if;
    if v_msg not like '%closed%' then
      raise exception 'FAIL: refusal was "%", expected it to name the closure', v_msg;
    end if;
  end;

  begin
    perform public.uncomplete_task(p_task_key => v_key, p_day => 1);
    raise exception 'FAIL: a task was un-ticked on a CLOSED day';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like 'FAIL:%' then raise; end if;
    if v_msg not like '%closed%' then
      raise exception 'FAIL: refusal was "%", expected it to name the closure', v_msg;
    end if;
  end;

  if (select flame from public.challenges where id = v_id) <> 1 then
    raise exception 'FAIL: the flame moved while a closed day was refused';
  end if;

  raise notice 'PASS: a closed day is refused identically on both clients, and the streak does not move';
end $$;

do $$ begin raise notice ' ALL TWO-CLIENT PROOFS PASSED'; end $$;
