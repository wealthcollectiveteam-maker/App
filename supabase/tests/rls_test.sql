-- =============================================================================
-- Executable proofs for the Phase 8 review questions:
--   1) Can a squadmate read another member's private data through the API?
--   2) Can a client create or alter a snapshot for a past or current day?
-- Run after setup_local.sql + the migration, as the postgres superuser:
--   psql -v ON_ERROR_STOP=1 -f rls_test.sql
-- Every check raises on failure; a clean exit means all proofs hold.
-- =============================================================================

\set QUIET on
\pset pager off

-- ---------------- PROOF 0: the privilege surface itself ----------------
-- RLS is the second wall; this asserts the FIRST wall — the actual grants.
-- Supabase's defaults hand `anon` and `authenticated` ALL on every new
-- table and EXECUTE on every function; the migration must claw that back
-- to an explicit allow-list. Table-driven and two-directional: a table
-- missing its revoke fails, and so does an unexpected new grant.
do $$
declare
  t record;
  f record;
  qualified text;
  -- the sanctioned direct-write surface for `authenticated`
  ins_allow text[] := array['profiles','profile_private','journal_entries',
    'meals','metric_checkins','milestones','feed_items','content_reports',
    'blocked_users','workout_logs'];
  upd_allow text[] := array['profiles','profile_private','meals','milestones',
    'workout_logs'];
  del_allow text[] := array['blocked_users','workout_logs'];
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    qualified := format('public.%I', t.tablename);

    -- anon: ZERO privileges on every table, SELECT included.
    if has_table_privilege('anon', qualified, 'SELECT')
       or has_table_privilege('anon', qualified, 'INSERT')
       or has_table_privilege('anon', qualified, 'UPDATE')
       or has_table_privilege('anon', qualified, 'DELETE') then
      raise exception 'FAIL: anon holds a privilege on %', qualified;
    end if;

    -- authenticated: SELECT everywhere (all RLS-scoped), writes = allow-list.
    if not has_table_privilege('authenticated', qualified, 'SELECT') then
      raise exception 'FAIL: authenticated missing SELECT on %', qualified;
    end if;
    if has_table_privilege('authenticated', qualified, 'INSERT')
       <> (t.tablename = any(ins_allow)) then
      raise exception 'FAIL: authenticated INSERT grant wrong on %', qualified;
    end if;
    if has_table_privilege('authenticated', qualified, 'UPDATE')
       <> (t.tablename = any(upd_allow)) then
      raise exception 'FAIL: authenticated UPDATE grant wrong on %', qualified;
    end if;
    if has_table_privilege('authenticated', qualified, 'DELETE')
       <> (t.tablename = any(del_allow)) then
      raise exception 'FAIL: authenticated DELETE grant wrong on %', qualified;
    end if;
  end loop;

  -- functions: anon can execute NOTHING in public; authenticated everything.
  for f in
    select p.oid from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    if has_function_privilege('anon', f.oid, 'EXECUTE') then
      raise exception 'FAIL: anon can execute %', f.oid::regprocedure;
    end if;
    if not has_function_privilege('authenticated', f.oid, 'EXECUTE') then
      raise exception 'FAIL: authenticated cannot execute %', f.oid::regprocedure;
    end if;
  end loop;

  raise notice 'PASS: privilege surface — anon holds nothing; authenticated writes match the allow-list exactly';
end $$;

-- Runtime probe as anon: the privilege wall fires before RLS ever runs.
set role anon;
do $$
begin
  begin
    perform count(*) from public.journal_entries;
    raise exception 'FAIL: anon read a private table';
  exception when insufficient_privilege then
    raise notice 'PASS: anon SELECT denied at the privilege layer';
  end;
  begin
    insert into public.feed_items (squad_id, author, kind, text)
    values (gen_random_uuid(), gen_random_uuid(), 'complete', 'x');
    raise exception 'FAIL: anon inserted into feed_items';
  exception when insufficient_privilege then
    raise notice 'PASS: anon INSERT denied at the privilege layer';
  end;
  begin
    perform public.complete_task('read');
    raise exception 'FAIL: anon executed a SECURITY DEFINER RPC';
  exception when insufficient_privilege then
    raise notice 'PASS: anon cannot execute RPCs';
  end;
end $$;
reset role;

-- ---- fixtures (as superuser) ----
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'aly@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'cara@test.dev');

-- Helper to run as a given authed user.
create or replace procedure test_login(p_user uuid)
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
end $$;

-- =====================  SETUP AS ALY  =====================
set role authenticated;
call test_login('00000000-0000-0000-0000-00000000000a');

insert into public.profiles (id, name) values (auth.uid(), 'Aly');
insert into public.profile_private (id, why) values (auth.uid(), 'Because I said I would.');
select public.create_challenge('hard', current_date, 'UTC');
select public.create_squad('Group 1');

insert into public.journal_entries (owner, day, text) values (auth.uid(), 1, 'private journal');
insert into public.meals (owner, day, text, nutrition)
  values (auth.uid(), 1, 'chicken and rice', '{"calories": 512}'::jsonb);
insert into public.metric_checkins (owner, weight_kg, mood) values (auth.uid(), 82.5, 4);
insert into public.milestones (owner, title) values (auth.uid(), 'Run a 5K');

-- A workout log: user-authored type/effort/note, duration from our timer.
insert into public.workout_logs
  (owner, challenge_id, day, task_key, activity_type, duration_seconds, effort, notes)
values (
  auth.uid(),
  (select id from public.challenges where owner = auth.uid()),
  1, 'workout1', 'Push', 2820, 4, 'Bench PR 185.'
);

-- Freeze today's snapshot and complete one task through the RPC.
select public.get_or_freeze_today();
select public.complete_task('read');

-- Grab the invite code for Ben (as Aly, who may see her own squad).
create temporary table t_ctx as
  select invite_code from public.squads limit 1;

-- =====================  BEN JOINS THE SQUAD  =====================
call test_login('00000000-0000-0000-0000-00000000000b');
insert into public.profiles (id, name) values (auth.uid(), 'Ben');
select public.create_challenge('hard', current_date, 'UTC');
select public.join_squad((select invite_code from t_ctx));

-- ---------------- PROOF 1: squadmate privacy ----------------
do $$
declare n integer;
begin
  -- Ben must see Aly in profiles (name/xp surface only)
  select count(*) into n from public.profiles where name = 'Aly';
  if n <> 1 then raise exception 'FAIL: squadmate cannot see profile name'; end if;

  -- ...and NOTHING below.
  select count(*) into n from public.journal_entries;
  if n <> 0 then raise exception 'FAIL: squadmate can read journal entries'; end if;

  select count(*) into n from public.meals;
  if n <> 0 then raise exception 'FAIL: squadmate can read meals/nutrition'; end if;

  select count(*) into n from public.metric_checkins;
  if n <> 0 then raise exception 'FAIL: squadmate can read metric check-ins'; end if;

  select count(*) into n from public.profile_private;
  if n <> 0 then raise exception 'FAIL: squadmate can read "why I started"'; end if;

  select count(*) into n from public.milestones;
  if n <> 0 then raise exception 'FAIL: squadmate can read milestones'; end if;

  -- Addendum DoD 4: a squadmate knows a workout task was completed, never
  -- what it was, how long, how hard, or the note.
  select count(*) into n from public.workout_logs;
  if n <> 0 then raise exception 'FAIL: squadmate can read workout logs'; end if;

  select count(*) into n from public.challenge_days
    where challenge_id not in (select id from public.challenges where owner = auth.uid());
  if n <> 0 then raise exception 'FAIL: squadmate can read another member''s snapshots'; end if;

  select count(*) into n from public.task_completions
    where challenge_id not in (select id from public.challenges where owner = auth.uid());
  if n <> 0 then raise exception 'FAIL: squadmate can read another member''s completions'; end if;

  select count(*) into n from public.custom_tasks
    where challenge_id not in (select id from public.challenges where owner = auth.uid());
  if n <> 0 then raise exception 'FAIL: squadmate can read another member''s custom tasks'; end if;

  raise notice 'PASS: squadmate sees name only — no journals, meals, metrics, why, milestones, workout logs, snapshots, completions';
end $$;

-- A squadmate cannot forge a log onto someone else's row either.
do $$
begin
  begin
    insert into public.workout_logs
      (owner, challenge_id, day, task_key, activity_type, duration_seconds)
    values ('00000000-0000-0000-0000-00000000000a',
            (select id from public.challenges limit 1), 1, 'workout1', 'Push', 100);
    raise exception 'FAIL: wrote a workout log onto another user';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS: cannot write a workout log onto another user';
  end;
end $$;

-- The sanctioned surface: counts via get_squad_status().
do $$
declare r record; found_aly boolean := false;
begin
  for r in select * from public.get_squad_status() loop
    if r.name = 'Aly' then
      found_aly := true;
      if r.done_today <> 1 or r.tasks_today <> 6 then
        raise exception 'FAIL: squad status counts wrong (% of %)', r.done_today, r.tasks_today;
      end if;
    end if;
  end loop;
  if not found_aly then raise exception 'FAIL: squad status missing member'; end if;
  raise notice 'PASS: squadmate sees completion COUNTS (1 of 6) — the entire sanctioned surface';
end $$;

-- ---------------- PROOF 1b: outsider sees nothing ----------------
call test_login('00000000-0000-0000-0000-00000000000c');
insert into public.profiles (id, name) values (auth.uid(), 'Cara');
do $$
declare n integer;
begin
  select count(*) into n from public.profiles where name in ('Aly','Ben');
  if n <> 0 then raise exception 'FAIL: outsider can see squad member profiles'; end if;
  select count(*) into n from public.squads;
  if n <> 0 then raise exception 'FAIL: outsider can enumerate squads'; end if;
  select count(*) into n from public.feed_items;
  if n <> 0 then raise exception 'FAIL: outsider can read squad feed'; end if;
  raise notice 'PASS: non-member sees no profiles, squads, or feed';
end $$;

-- ---------------- PROOF 2: snapshot immutability ----------------
call test_login('00000000-0000-0000-0000-00000000000a');

-- 2a. Direct writes are impossible (privilege revoked, before RLS even runs).
do $$
begin
  begin
    insert into public.challenge_days (challenge_id, day, task_snapshot)
    values ((select id from public.challenges where owner = auth.uid()), 1, '[]'::jsonb);
    raise exception 'FAIL: client inserted a day snapshot directly';
  exception when insufficient_privilege then
    raise notice 'PASS: direct snapshot INSERT denied (insufficient_privilege)';
  end;
  begin
    update public.challenge_days set task_snapshot = '[]'::jsonb;
    raise exception 'FAIL: client updated a day snapshot directly';
  exception when insufficient_privilege then
    raise notice 'PASS: direct snapshot UPDATE denied (insufficient_privilege)';
  end;
  begin
    insert into public.task_completions (challenge_id, day, task_key)
    values ((select id from public.challenges where owner = auth.uid()), 1, 'diet');
    raise exception 'FAIL: client inserted a completion directly';
  exception when insufficient_privilege then
    raise notice 'PASS: direct completion INSERT denied (insufficient_privilege)';
  end;
end $$;

-- 2b. The RPC only completes tasks that exist in TODAY's frozen snapshot.
do $$
begin
  begin
    perform public.complete_task('not-a-real-task');
    raise exception 'FAIL: completed a task outside the snapshot';
  exception when others then
    if sqlerrm like '%not part of today%' then
      raise notice 'PASS: completion restricted to today''s frozen snapshot';
    else raise; end if;
  end;
end $$;

-- 2c. Edits land tomorrow: today's frozen snapshot must not change.
select public.set_target_override('read', 15);
do $$
declare v integer;
begin
  select (t->'target'->>'value')::integer into v
  from public.challenge_days cd
  join public.challenges c on c.id = cd.challenge_id and c.owner = auth.uid(),
  lateral jsonb_array_elements(cd.task_snapshot) t
  where cd.day = 1 and t->>'key' = 'read';
  if v <> 10 then raise exception 'FAIL: today''s frozen snapshot changed (read=%)', v; end if;
  raise notice 'PASS: raising Read to 15 left today''s frozen snapshot at 10';
end $$;

-- 2d. Simulate the next server day (superuser shifts the clock by moving
-- start_date back) — the override applies to the NEW day only.
reset role;
update public.challenges set start_date = start_date - 1
  where owner = '00000000-0000-0000-0000-00000000000a';
set role authenticated;
call test_login('00000000-0000-0000-0000-00000000000a');
select public.get_or_freeze_today();
do $$
declare v_today integer; v_yesterday integer;
begin
  select (t->'target'->>'value')::integer into v_today
  from public.challenge_days cd
  join public.challenges c on c.id = cd.challenge_id and c.owner = auth.uid(),
  lateral jsonb_array_elements(cd.task_snapshot) t
  where cd.day = 2 and t->>'key' = 'read';
  select (t->'target'->>'value')::integer into v_yesterday
  from public.challenge_days cd
  join public.challenges c on c.id = cd.challenge_id and c.owner = auth.uid(),
  lateral jsonb_array_elements(cd.task_snapshot) t
  where cd.day = 1 and t->>'key' = 'read';
  if v_today <> 15 then raise exception 'FAIL: rollover did not apply pending target (read=%)', v_today; end if;
  if v_yesterday <> 10 then raise exception 'FAIL: history rewritten (day-1 read=%)', v_yesterday; end if;
  raise notice 'PASS: rollover applied read=15 to day 2; day 1 stays 10 forever';
end $$;

-- 2e. Belt-and-braces trigger: even the table owner cannot rewrite a snapshot.
reset role;
do $$
begin
  begin
    update public.challenge_days set task_snapshot = '[]'::jsonb where day = 1;
    raise exception 'FAIL: superuser rewrote a frozen snapshot (trigger missing)';
  exception when others then
    if sqlerrm like '%immutable%' then
      raise notice 'PASS: immutability trigger blocks even privileged snapshot rewrites';
    else raise; end if;
  end;
end $$;

-- ---------------- extra: server-side ping quota ----------------
set role authenticated;
call test_login('00000000-0000-0000-0000-00000000000a');
do $$
declare i integer;
begin
  for i in 1..5 loop
    perform public.send_ping('00000000-0000-0000-0000-00000000000b', 'No excuses.');
  end loop;
  begin
    perform public.send_ping('00000000-0000-0000-0000-00000000000b', 'One more.');
    raise exception 'FAIL: ping quota not enforced server-side';
  exception when others then
    if sqlerrm like '%out of pings%' then
      raise notice 'PASS: ping quota enforced server-side (5/day)';
    else raise; end if;
  end;
end $$;

-- ---------------- extra: sealing requires a complete day ----------------
do $$
begin
  begin
    perform public.seal_day();
    raise exception 'FAIL: sealed an incomplete day';
  exception when others then
    if sqlerrm like '%not complete%' then
      raise notice 'PASS: seal_day refuses an incomplete day';
    else raise; end if;
  end;
end $$;

reset role;
select 'ALL PROOFS PASSED' as result;
