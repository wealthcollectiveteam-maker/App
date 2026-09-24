-- =============================================================================
-- Executable proofs for "start tomorrow" (Phase 38F, F1; migration 0017).
--
-- Run after setup_local.sql + every migration, as the postgres superuser:
--   psql -v ON_ERROR_STOP=1 -f start_tomorrow_test.sql
--
-- WHAT THIS PROVES, and why each one exists:
--
--   (a) the day BEFORE the start is a defined state, not an accident:
--       challenge_day is 0, get_day_window returns no rows,
--       get_or_freeze_today raises the NAMED error the client classifies,
--       my_challenge_status says when day 1 is, a second create_challenge
--       is refused by the unique index, and the evaluator judges nothing
--       and creates nothing
--   (b) on the start date it is an ordinary day 1
--   (c) challenge_day still computes from start_date and never created_at
--   (d) the server computes the start date in the CHALLENGE's zone
--   (e) a restart still starts the day it is made, judged from day 1
--
-- Against 0016 this whole file fails at its first statement: the four-
-- argument create_challenge does not exist. That is the failing-first run.
-- Every check raises on failure. A clean exit means all proofs hold.
-- =============================================================================

\set QUIET on
\pset pager off

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'tomorrow@test.dev'),
  ('00000000-0000-0000-0000-0000000000f2', 'created-at@test.dev'),
  ('00000000-0000-0000-0000-0000000000f3', 'far-zone@test.dev'),
  ('00000000-0000-0000-0000-0000000000f4', 'restart-today@test.dev')
on conflict do nothing;

-- ---- (a) the day before the start ------------------------------------------
do $$
declare
  v_uid   uuid := '00000000-0000-0000-0000-0000000000f1';
  v_ch    uuid;
  c       public.challenges;
  v_rows  integer;
  v_msg   text;
  v_st    record;
  v_n     integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Tomorrow') on conflict do nothing;

  v_ch := public.create_challenge('hard', 'America/Toronto', 75, true);
  select * into c from public.challenges where id = v_ch;

  if c.start_date <> (now() at time zone 'America/Toronto')::date + 1 then
    raise exception 'FAIL (a): start_date is %, expected tomorrow in Toronto', c.start_date;
  end if;
  if public.challenge_day(c) <> 0 then
    raise exception 'FAIL (a): challenge_day is %, expected 0 the day before the start', public.challenge_day(c);
  end if;
  if c.first_judged_day <> 2 or c.last_evaluated_day <> 0 then
    raise exception 'FAIL (a): first_judged_day % / cursor %, expected 2 / 0',
      c.first_judged_day, c.last_evaluated_day;
  end if;

  -- The window is empty: there is no open day yet.
  select count(*) into v_rows from public.get_day_window();
  if v_rows <> 0 then
    raise exception 'FAIL (a): get_day_window returned % row(s) the day before the start', v_rows;
  end if;

  -- get_or_freeze_today refuses with the ONE string the client classifies.
  begin
    perform public.get_or_freeze_today();
    raise exception 'FAIL (a): get_or_freeze_today froze a day that has not started';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like 'FAIL%' then raise; end if;
    if v_msg not like 'challenge not started%' then
      raise exception 'FAIL (a): get_or_freeze_today raised "%", expected "challenge not started: …"', v_msg;
    end if;
  end;

  -- The waiting screen's one read.
  select * into v_st from public.my_challenge_status();
  if v_st.challenge_id is null or v_st.started or v_st.start_date <> c.start_date or v_st.day <> 0 then
    raise exception 'FAIL (a): my_challenge_status answered wrongly (id %, started %, start %, day %)',
      v_st.challenge_id, v_st.started, v_st.start_date, v_st.day;
  end if;

  -- No path to a second challenge, whatever the client does.
  begin
    perform public.create_challenge('hard', 'America/Toronto', 75, false);
    raise exception 'FAIL (a): a second live challenge was created while one waits to start';
  exception
    when unique_violation then null;
    when others then
      get stacked diagnostics v_msg = message_text;
      if v_msg like 'FAIL%' then raise; end if;
      raise exception 'FAIL (a): the second create_challenge failed for a reason other than the unique index: %', v_msg;
  end;

  -- The evaluator has nothing to do and does nothing.
  v_n := public.evaluate_challenge(v_ch);
  select * into c from public.challenges where id = v_ch;
  if v_n <> 0 or c.ended_at is not null or c.last_evaluated_day <> 0 then
    raise exception 'FAIL (a): the evaluator touched a challenge that has not started (judged %, ended %, cursor %)',
      v_n, c.ended_at, c.last_evaluated_day;
  end if;
  if exists (select 1 from public.challenge_days where challenge_id = v_ch) then
    raise exception 'FAIL (a): a day was frozen before the start';
  end if;

  raise notice 'PASS (a): the day before the start — empty window, a named refusal, one read, no second challenge, nothing judged';
end $$;

-- ---- (b) the start date is an ordinary day 1 --------------------------------
do $$
declare
  v_uid  uuid := '00000000-0000-0000-0000-0000000000f1';
  v_ch   uuid;
  c      public.challenges;
  d      public.challenge_days;
  v_rows integer;
  v_st   record;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  select id into v_ch from public.challenges where owner = v_uid and ended_at is null;

  -- Tomorrow arrives.
  update public.challenges
     set start_date = (now() at time zone timezone)::date
   where id = v_ch;
  select * into c from public.challenges where id = v_ch;

  if public.challenge_day(c) <> 1 then
    raise exception 'FAIL (b): on the start date challenge_day is %, expected 1', public.challenge_day(c);
  end if;
  d := public.get_or_freeze_today();
  if d.day <> 1 or jsonb_array_length(d.task_snapshot) = 0 then
    raise exception 'FAIL (b): get_or_freeze_today did not freeze a real day 1';
  end if;
  select count(*) into v_rows from public.get_day_window() w where w.is_today and w.day = 1;
  if v_rows <> 1 then
    raise exception 'FAIL (b): get_day_window does not offer day 1 as today (% row(s))', v_rows;
  end if;
  select * into v_st from public.my_challenge_status();
  if not v_st.started or v_st.day <> 1 then
    raise exception 'FAIL (b): my_challenge_status does not say started on day 1';
  end if;

  raise notice 'PASS (b): on the start date it is day 1, frozen and offered like any other';
end $$;

-- ---- (c) start_date, never created_at ----------------------------------------
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000f2';
  v_ch  uuid;
  c     public.challenges;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Created-at') on conflict do nothing;
  v_ch := public.create_challenge('hard', 'UTC', 75, false);

  -- A row that was CREATED ten days ago and STARTS today. If anything read
  -- created_at, this would be day 11.
  update public.challenges set created_at = now() - interval '10 days' where id = v_ch;
  select * into c from public.challenges where id = v_ch;
  if c.start_date <> (now() at time zone 'UTC')::date then
    raise exception 'FAIL (c): a same-day start did not land on today (%)', c.start_date;
  end if;
  if public.challenge_day(c) <> 1 then
    raise exception 'FAIL (c): challenge_day is % — something read created_at', public.challenge_day(c);
  end if;
  if c.first_judged_day <> 2 or c.last_evaluated_day <> 0 then
    raise exception 'FAIL (c): a fresh same-day challenge holds first_judged_day % / cursor %, expected 2 / 0',
      c.first_judged_day, c.last_evaluated_day;
  end if;

  raise notice 'PASS (c): the day is computed from start_date; created_at is never read';
end $$;

-- ---- (d) the server computes the date in the challenge's zone ---------------
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000f3';
  v_ch  uuid;
  c     public.challenges;
  v_far text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Far-zone') on conflict do nothing;

  -- A zone whose local date differs from the server's for part of every day:
  -- UTC+14 when the server is early in its day, UTC-12 when it is late.
  v_far := case when extract(hour from now() at time zone 'UTC') < 10
                then 'Etc/GMT-14' else 'Etc/GMT+12' end;
  v_ch := public.create_challenge('hard', v_far, 75, true);
  select * into c from public.challenges where id = v_ch;

  if c.start_date <> (now() at time zone v_far)::date + 1 then
    raise exception 'FAIL (d): start_date % is not tomorrow in % (which is %)',
      c.start_date, v_far, (now() at time zone v_far)::date + 1;
  end if;
  if (now() at time zone v_far)::date <> current_date
     and c.start_date = current_date + 1 then
    raise exception 'FAIL (d): the start date followed the server''s date, not the challenge''s zone';
  end if;

  raise notice 'PASS (d): the start date is tomorrow in the challenge''s zone (%), not the server''s', v_far;
end $$;

-- ---- (e) a restart still starts the day it is made -------------------------
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-0000000000f4';
  v_old uuid;
  v_new uuid;
  n     public.challenges;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, false);
  insert into public.profiles (id, name) values (v_uid, 'Restart-today') on conflict do nothing;
  v_old := public.create_challenge('hard', 'Europe/London', 75, false);

  -- Day 3 today at 13:00 local, day 2 untouched: a miss, so a restart.
  update public.challenges
     set timezone   = case when (13 - extract(hour from now() at time zone 'UTC')::integer) >= 0
                           then 'Etc/GMT-' || (13 - extract(hour from now() at time zone 'UTC')::integer)
                           else 'Etc/GMT+' || (extract(hour from now() at time zone 'UTC')::integer - 13) end
   where id = v_old;
  update public.challenges
     set start_date = (now() at time zone timezone)::date - 2
   where id = v_old;
  perform public.evaluate_challenge(v_old);

  select id into v_new from public.challenges
   where owner = v_uid and ended_at is null;
  if v_new is null or v_new = v_old then
    raise exception 'FIXTURE (e): the miss did not restart';
  end if;
  select * into n from public.challenges where id = v_new;
  if n.start_date <> (now() at time zone n.timezone)::date then
    raise exception 'FAIL (e): the restart starts on %, expected today', n.start_date;
  end if;
  if n.first_judged_day <> 1 or n.last_evaluated_day <> 0 then
    raise exception 'FAIL (e): the restart holds first_judged_day % / cursor %, expected 1 / 0',
      n.first_judged_day, n.last_evaluated_day;
  end if;
  if public.challenge_day(n) <> 1 then
    raise exception 'FAIL (e): the restart is not on day 1';
  end if;

  raise notice 'PASS (e): a restart starts the day it is made and is judged from day 1, as 0015 decided';
end $$;

select 'ALL START-TOMORROW PROOFS PASSED' as result;
