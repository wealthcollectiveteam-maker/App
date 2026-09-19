-- =============================================================================
-- DEFAULT TASK SET — can a brand-new user with NO customisation complete
-- every task on day 1 through the real RPC? (Phase 36, step 1b)
--
-- Run after setup_local.sql + every migration, as the postgres superuser:
--   psql -v ON_ERROR_STOP=1 -f default_set_test.sql
--
-- WHY THIS FILE EXISTS. Production shows 75 restarted challenges with zero
-- completions on day 1, every one of them a DEFAULT task set, while the one
-- account with a CUSTOM set of eleven completes 11/11. One reading is that
-- six people signed up and never used the app; the other is that a default
-- set's keys do not match the keys frozen into task_snapshot, so
-- complete_task() refuses every tap for everyone but the person who built a
-- custom set. This proves or kills the second reading on the server.
--
-- THE SHAPE. Three brand-new users, one per tier, no custom tasks, no target
-- overrides. Each freezes day 1 through get_or_freeze_today() exactly as the
-- app does, then completes every key in that snapshot through
-- complete_task(key, null, 1) — the named-day form the client sends. Then:
--   * one task_completions row per snapshot key, and no others
--   * day_is_met(challenge, 1) is TRUE
--   * seal_day(1) pays exactly one flame
-- Every check raises on failure; a clean exit means all proofs hold.
-- =============================================================================

\set QUIET on
\pset pager off

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000d5a1', 'default-hard@test.dev'),
  ('00000000-0000-0000-0000-00000000d5a2', 'default-medium@test.dev'),
  ('00000000-0000-0000-0000-00000000d5a3', 'default-soft@test.dev')
on conflict do nothing;

create or replace procedure test_login(p_user uuid)
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
end $$;

create or replace procedure t_default_set(p_user uuid, p_tier text)
language plpgsql as $$
declare
  v_ch       uuid;
  v_snapshot jsonb;
  v_keys     text[];
  v_key      text;
  v_rows     integer;
  v_stray    integer;
  v_flame    integer;
begin
  call test_login(p_user);
  insert into public.profiles (id, name) values (p_user, 'Default ' || p_tier)
  on conflict do nothing;
  delete from public.challenges where owner = p_user;

  -- A default set: the tier's standards and NOTHING else. No custom task,
  -- no override. Day 1 is today in the challenge's own zone.
  v_ch := public.create_challenge(p_tier, current_date, 'UTC', 75);
  if (select count(*) from public.custom_tasks where challenge_id = v_ch) <> 0 then
    raise exception 'FAIL (%): fixture is not a default set — custom tasks exist', p_tier;
  end if;

  -- Day 1 frozen the way the app freezes it: through the RPC, as the user.
  select task_snapshot into v_snapshot from public.get_or_freeze_today();
  select array_agg(t->>'key' order by t->>'key') into v_keys
    from jsonb_array_elements(v_snapshot) t;
  if coalesce(array_length(v_keys, 1), 0) = 0 then
    raise exception 'FAIL (%): day 1 snapshot is EMPTY — nothing to complete', p_tier;
  end if;
  raise notice '(%) day 1 snapshot: % task(s): %', p_tier, array_length(v_keys, 1), array_to_string(v_keys, ', ');

  -- Every key, through complete_task, in the named-day form the client sends.
  foreach v_key in array v_keys loop
    begin
      perform public.complete_task(v_key, null, 1);
    exception when others then
      raise exception 'FAIL (%): complete_task(%, null, 1) REFUSED: % (%)', p_tier, v_key, sqlerrm, sqlstate;
    end;
  end loop;

  -- One row per key, no strays.
  select count(*) into v_rows from public.task_completions
   where challenge_id = v_ch and day = 1 and task_key = any(v_keys);
  select count(*) into v_stray from public.task_completions
   where challenge_id = v_ch and day = 1 and not (task_key = any(v_keys));
  if v_rows <> array_length(v_keys, 1) or v_stray <> 0 then
    raise exception 'FAIL (%): % of % keys landed as rows, % stray row(s)',
      p_tier, v_rows, array_length(v_keys, 1), v_stray;
  end if;

  if not public.day_is_met(v_ch, 1) then
    raise exception 'FAIL (%): every key landed but day_is_met(day 1) is FALSE', p_tier;
  end if;

  -- And the seal pays exactly one flame, as the celebration screen expects.
  perform public.seal_day(1);
  select flame into v_flame from public.challenges where id = v_ch;
  if v_flame <> 1 then
    raise exception 'FAIL (%): seal_day(1) left flame at %, expected 1', p_tier, v_flame;
  end if;

  raise notice 'PASS (%): a brand-new default-set user completes all % day-1 tasks through the RPC, day_is_met is true, seal_day pays 1',
    p_tier, array_length(v_keys, 1);
end $$;

call t_default_set('00000000-0000-0000-0000-00000000d5a1', 'hard');
call t_default_set('00000000-0000-0000-0000-00000000d5a2', 'medium');
call t_default_set('00000000-0000-0000-0000-00000000d5a3', 'soft');

-- The negative, so the file cannot pass for the wrong reason: a key that is
-- NOT in the snapshot must be refused with the snapshot error.
do $$
begin
  call test_login('00000000-0000-0000-0000-00000000d5a1');
  begin
    perform public.complete_task('not-in-any-snapshot', null, 1);
    raise exception 'FAIL: a key outside the snapshot was ACCEPTED';
  exception when others then
    if sqlerrm not like '%not part of day 1%snapshot%' then
      raise exception 'FAIL: wrong refusal for a bad key: %', sqlerrm;
    end if;
  end;
  raise notice 'PASS: a key outside the snapshot is refused with the snapshot error, so the checks above measured the real gate';
end $$;

\echo ' ALL DEFAULT-SET PROOFS PASSED'

drop procedure t_default_set(uuid, text);
