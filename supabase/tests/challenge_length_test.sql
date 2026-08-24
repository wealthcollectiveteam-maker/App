-- =============================================================================
-- PHASE 10A PROOFS — challenge length, and custom tasks that start on day 1
-- =============================================================================
--
-- Run after the migrations, like the other two suites. Everything here is
-- asserted at the DATABASE boundary: no screen is consulted, and the only
-- privileges used are the ones a signed-in user actually holds.
--
-- The two features meet at the same place — day 1's snapshot — which is why
-- they are proved together.

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000e001', 'len-a@test.dev'),
  ('00000000-0000-0000-0000-00000000e002', 'len-b@test.dev'),
  ('00000000-0000-0000-0000-00000000e003', 'len-c@test.dev'),
  ('00000000-0000-0000-0000-00000000e004', 'len-d@test.dev')
on conflict do nothing;

-- Complete every task in a day's snapshot, without sealing.
create or replace procedure l_do_day(p_challenge uuid, p_day integer)
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

create or replace procedure l_set_day(p_challenge uuid, p_day integer)
language plpgsql as $$
begin
  update public.challenges
     set start_date = current_date - (p_day - 1),
         last_evaluated_day = 1
   where id = p_challenge;
end $$;

create or replace procedure l_login(p_uid uuid)
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
end $$;

-- =============================================================================
-- PROOF 1 — the column: default, constraint, and a length that is chosen
-- =============================================================================
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-00000000e001';
  v_ch  uuid;
  v_bad boolean := false;
begin
  call l_login(v_uid);
  insert into public.profiles (id, name) values (v_uid, 'Len A') on conflict do nothing;

  -- No length argument: the pre-0008 shape of the call, still valid, still 75.
  v_ch := public.create_challenge('hard', current_date, 'UTC');
  if (select duration_days from public.challenges where id = v_ch) <> 75 then
    raise exception 'FAIL: a challenge created without a length is not 75';
  end if;

  -- The check constraint is the real boundary, not the RPC's own guard.
  begin
    update public.challenges set duration_days = 60 where id = v_ch;
    v_bad := true;
  exception when check_violation then
    null;
  end;
  if v_bad then
    raise exception 'FAIL: duration_days accepted 60';
  end if;

  -- And the RPC refuses it before the constraint ever sees it.
  v_bad := false;
  begin
    perform public.set_challenge_duration(v_ch, 60);
    v_bad := true;
  exception when others then
    null;
  end;
  if v_bad then
    raise exception 'FAIL: set_challenge_duration accepted 60';
  end if;

  raise notice 'PASS: 75 by default, and only 30/45/75 are reachable';
end $$;

-- =============================================================================
-- PROOF 2 — LENGTHENING: the run continues, and no day is touched
-- =============================================================================
do $$
declare
  v_uid  uuid := '00000000-0000-0000-0000-00000000e002';
  v_ch   uuid;
  v_days jsonb;
  v_res  record;
begin
  call l_login(v_uid);
  insert into public.profiles (id, name) values (v_uid, 'Len B') on conflict do nothing;

  v_ch := public.create_challenge('medium', current_date, 'UTC', 30);
  call l_set_day(v_ch, 10);
  call l_do_day(v_ch, 1);
  call l_do_day(v_ch, 2);

  -- Fingerprint every existing day so "nothing was rewritten" is a
  -- comparison rather than an assurance.
  select jsonb_agg(jsonb_build_object('d', day, 's', task_snapshot) order by day)
    into v_days
  from public.challenge_days where challenge_id = v_ch;

  select * into v_res from public.set_challenge_duration(v_ch, 75);

  if v_res.completed then
    raise exception 'FAIL: lengthening ended the challenge';
  end if;
  if (select duration_days from public.challenges where id = v_ch) <> 75 then
    raise exception 'FAIL: the new length was not stored';
  end if;
  if (select ended_at from public.challenges where id = v_ch) is not null then
    raise exception 'FAIL: the challenge ended when it was lengthened';
  end if;
  if (select duration_previous from public.challenges where id = v_ch) <> 30 then
    raise exception 'FAIL: duration_previous did not record the old length';
  end if;
  if (select duration_changed_at from public.challenges where id = v_ch) is null then
    raise exception 'FAIL: duration_changed_at was not stamped';
  end if;
  if (select jsonb_agg(jsonb_build_object('d', day, 's', task_snapshot) order by day)
        from public.challenge_days where challenge_id = v_ch) is distinct from v_days then
    raise exception 'FAIL: a challenge_days row changed when the length did';
  end if;

  raise notice 'PASS: lengthening moves the finish line and rewrites no day';
end $$;

-- =============================================================================
-- PROOF 3 — SHORTENING PAST TODAY: completes today, still rewrites nothing
-- =============================================================================
do $$
declare
  v_uid   uuid := '00000000-0000-0000-0000-00000000e003';
  v_ch    uuid;
  v_days  jsonb;
  v_count integer;
  v_res   record;
begin
  call l_login(v_uid);
  insert into public.profiles (id, name) values (v_uid, 'Len C') on conflict do nothing;

  v_ch := public.create_challenge('soft', current_date, 'UTC', 75);
  call l_set_day(v_ch, 52);
  call l_do_day(v_ch, 1);
  call l_do_day(v_ch, 20);

  select count(*) into v_count from public.challenge_days where challenge_id = v_ch;
  select jsonb_agg(jsonb_build_object('d', day, 's', task_snapshot) order by day)
    into v_days
  from public.challenge_days where challenge_id = v_ch;

  -- Day 52 of a run now asked to be 45 days long: there is no future left.
  select * into v_res from public.set_challenge_duration(v_ch, 45);

  if not v_res.completed then
    raise exception 'FAIL: shortening below the current day did not complete the run';
  end if;
  if v_res.ended_on_day <> 52 then
    raise exception 'FAIL: completed on day %, expected today (52)', v_res.ended_on_day;
  end if;
  if (select ended_reason from public.challenges where id = v_ch) <> 'completed' then
    raise exception 'FAIL: the challenge did not end as completed';
  end if;
  if (select count(*) from public.challenge_days where challenge_id = v_ch) <> v_count then
    raise exception 'FAIL: a challenge_days row was added or deleted';
  end if;
  if (select jsonb_agg(jsonb_build_object('d', day, 's', task_snapshot) order by day)
        from public.challenge_days where challenge_id = v_ch) is distinct from v_days then
    raise exception 'FAIL: a challenge_days row was rewritten';
  end if;

  raise notice 'PASS: shortening past today completes the run and still rewrites no day';
end $$;

-- =============================================================================
-- PROOF 4 — it is MY challenge or nothing
-- =============================================================================
do $$
declare
  v_owner uuid := '00000000-0000-0000-0000-00000000e002';
  v_other uuid := '00000000-0000-0000-0000-00000000e004';
  v_ch    uuid;
  v_bad   boolean := false;
begin
  select id into v_ch from public.challenges
    where owner = v_owner and ended_at is null limit 1;

  call l_login(v_other);
  begin
    perform public.set_challenge_duration(v_ch, 30);
    v_bad := true;
  exception when others then
    null;
  end;
  if v_bad then
    raise exception 'FAIL: another user changed the length of a challenge they do not own';
  end if;
  if (select duration_days from public.challenges where id = v_ch) <> 75 then
    raise exception 'FAIL: the length changed anyway';
  end if;

  raise notice 'PASS: set_challenge_duration is owner-only';
end $$;

-- =============================================================================
-- PROOF 5 — custom tasks at setup are IN day 1, and count like any other
-- =============================================================================
do $$
declare
  v_uid   uuid := '00000000-0000-0000-0000-00000000e004';
  v_ch    uuid;
  v_snap  jsonb;
  v_bad   boolean := false;
  v_id    uuid;
begin
  call l_login(v_uid);
  insert into public.profiles (id, name) values (v_uid, 'Len D') on conflict do nothing;

  v_ch := public.create_challenge('medium', current_date, 'UTC', 45);

  -- Before the freeze — the one window in which this is allowed.
  perform public.add_setup_custom_task('Cold plunge', 3);
  perform public.add_setup_custom_task('Stretch', null);

  perform public.get_or_freeze_today();

  select task_snapshot into v_snap from public.challenge_days
    where challenge_id = v_ch and day = 1;

  if jsonb_array_length(v_snap) <> 7 then
    raise exception 'FAIL: day 1 holds % tasks, expected 5 medium + 2 custom',
      jsonb_array_length(v_snap);
  end if;
  if (select count(*) from jsonb_array_elements(v_snap) e
       where e->>'key' like 'custom-%') <> 2 then
    raise exception 'FAIL: the custom tasks are not in day 1';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_snap) e
                  where e->>'shortName' = 'Cold plunge'
                    and e->'target'->>'unit' = 'minutes'
                    and (e->'target'->>'value')::int = 3) then
    raise exception 'FAIL: the timer on a setup custom task was lost';
  end if;

  -- ONE class of task: the day is not met until the custom ones are done too.
  insert into public.task_completions (challenge_id, day, task_key)
  select v_ch, 1, e->>'key' from jsonb_array_elements(v_snap) e
  where e->>'key' not like 'custom-%';
  if public.day_is_met(v_ch, 1) then
    raise exception 'FAIL: the day counted as met with the custom tasks outstanding';
  end if;

  insert into public.task_completions (challenge_id, day, task_key)
  select v_ch, 1, e->>'key' from jsonb_array_elements(v_snap) e
  where e->>'key' like 'custom-%';
  if not public.day_is_met(v_ch, 1) then
    raise exception 'FAIL: a fully completed day did not count as met';
  end if;

  -- And once day 1 is frozen, the setup door is shut: an edit is an edit
  -- again, and edits start tomorrow.
  begin
    v_id := public.add_setup_custom_task('Too late', null);
    v_bad := true;
  exception when others then
    null;
  end;
  if v_bad then
    raise exception 'FAIL: a setup task was added after day 1 was frozen';
  end if;

  -- The mid-run path still works, and still starts tomorrow.
  v_id := public.add_custom_task('Tomorrow task', '', false, null);
  if (select active_from_day from public.custom_tasks where id = v_id)
     <> public.challenge_day((select c from public.challenges c where c.id = v_ch)) + 1 then
    raise exception 'FAIL: a mid-run custom task did not start tomorrow';
  end if;
  if jsonb_array_length((select task_snapshot from public.challenge_days
                          where challenge_id = v_ch and day = 1)) <> 7 then
    raise exception 'FAIL: adding a task changed day 1 after the fact';
  end if;

  raise notice 'PASS: setup tasks are in day 1, count like any other, and the door shuts after the freeze';
end $$;

-- =============================================================================
-- PROOF 6 — the cap is one number, and the server owns it
-- =============================================================================
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-00000000e001';
  v_ch  uuid;
  v_bad boolean := false;
  i     integer;
begin
  call l_login(v_uid);
  select id into v_ch from public.challenges
    where owner = v_uid and ended_at is null limit 1;
  delete from public.challenge_days where challenge_id = v_ch and day = 1;
  delete from public.custom_tasks where challenge_id = v_ch;

  for i in 1 .. public.custom_task_limit() loop
    perform public.add_setup_custom_task('Task ' || i, null);
  end loop;
  begin
    perform public.add_setup_custom_task('One too many', null);
    v_bad := true;
  exception when others then
    null;
  end;
  if v_bad then
    raise exception 'FAIL: the custom task cap of % was not enforced',
      public.custom_task_limit();
  end if;

  raise notice 'PASS: the custom task cap (%) is enforced by the server',
    public.custom_task_limit();
end $$;

do $$ begin raise notice ' ALL CHALLENGE-LENGTH PROOFS PASSED'; end $$;
