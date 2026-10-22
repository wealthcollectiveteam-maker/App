-- =============================================================================
-- PHASE 38S (S5b) — what a REVIEW DEMO ACCOUNT can and cannot read
-- =============================================================================
--
-- Before either demo account exists. Apple's reviewer signs into demo A; demo
-- B is in A's squad so the squad screens have something in them. Both are
-- ordinary accounts under ordinary RLS — nothing in the app or the database
-- special-cases them — so this proves the policy for exactly that shape:
--
--   demo squad : D1 (reviewer), D2 (squadmate)
--   real squad : R1, R2 (the friends), with private data of every kind
--
-- and asserts, at the database boundary with impersonated JWTs:
--
--   1. D1 sees D2 as a squadmate: name, xp, counts — the roster RPC.
--   2. D1 cannot read ANY row of R1's: profile, private profile, challenge,
--      days, completions, journal, meals, check-ins, milestones, workouts,
--      feed, squad, membership, pings. Not one row.
--   3. D1 cannot read D2's PRIVATE rows either: being a squadmate shows the
--      roster and nothing behind it.
--   4. D1 cannot write anything of R1's or D2's, cannot ping R1, and cannot
--      reach the real squad without its code.
--   5. The roster RPC for the real squad answers D1 with nothing.
--
-- The one thing this CANNOT prove is the procedural rule: never put a demo
-- account in a real squad. With the invite code, join_squad() admits anyone,
-- which is the feature. docs/testflight-external.md, D2, has the check to run
-- against the real project once the accounts exist.
-- =============================================================================

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000de001', 'demo-a@test.dev'),
  ('00000000-0000-0000-0000-0000000de002', 'demo-b@test.dev'),
  ('00000000-0000-0000-0000-0000000de0a1', 'real-a@test.dev'),
  ('00000000-0000-0000-0000-0000000de0a2', 'real-b@test.dev')
on conflict do nothing;

insert into public.profiles (id, name) values
  ('00000000-0000-0000-0000-0000000de001', 'Demo Reviewer'),
  ('00000000-0000-0000-0000-0000000de002', 'Demo Squadmate'),
  ('00000000-0000-0000-0000-0000000de0a1', 'Real One'),
  ('00000000-0000-0000-0000-0000000de0a2', 'Real Two')
on conflict do nothing;

create or replace procedure dm_login(p_uid uuid)
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  set local role authenticated;
end $$;

create or replace procedure dm_admin()
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', false);
  reset role;
end $$;

-- Build both squads through the real RPCs, and give every account a
-- challenge with a frozen, partly completed day 1.
do $$
declare
  v_d1 uuid := '00000000-0000-0000-0000-0000000de001';
  v_d2 uuid := '00000000-0000-0000-0000-0000000de002';
  v_r1 uuid := '00000000-0000-0000-0000-0000000de0a1';
  v_r2 uuid := '00000000-0000-0000-0000-0000000de0a2';
  v_uid uuid;
  v_code text;
begin
  foreach v_uid in array array[v_d1, v_d2, v_r1, v_r2] loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text, false);
    perform public.create_challenge('hard', 'UTC', 75);
    perform public.get_or_freeze_today();
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', v_d1, 'role', 'authenticated')::text, false);
  select code into v_code from public.create_squad('Demo Squad');
  perform set_config('request.jwt.claims', json_build_object('sub', v_d2, 'role', 'authenticated')::text, false);
  perform public.join_squad(v_code);

  perform set_config('request.jwt.claims', json_build_object('sub', v_r1, 'role', 'authenticated')::text, false);
  select code into v_code from public.create_squad('Real Squad');
  perform set_config('request.jwt.claims', json_build_object('sub', v_r2, 'role', 'authenticated')::text, false);
  perform public.join_squad(v_code);
  -- R1 pings R2, so there is a ping row in the real squad.
  perform public.send_ping(v_r1, 'real ping',
    (select squad_id from public.squad_members where user_id = v_r1));
  perform set_config('request.jwt.claims', '', false);

  -- Private data of every kind, for R1 and D2, written as the observer.
  foreach v_uid in array array[v_r1, v_d2] loop
    insert into public.profile_private (id, why) values (v_uid, 'private why')
      on conflict (id) do update set why = 'private why';
    insert into public.journal_entries (owner, day, text) values (v_uid, 1, 'private journal');
    insert into public.meals (owner, day, text) values (v_uid, 1, 'private meal');
    insert into public.metric_checkins (owner, weight_kg, mood) values (v_uid, 80.5, 3);
    insert into public.milestones (owner, title) values (v_uid, 'private milestone');
    insert into public.workout_logs (owner, challenge_id, day, task_key, activity_type, duration_seconds)
      values (v_uid, (select id from public.challenges where owner = v_uid and ended_at is null), 1, 'workout1', 'Run', 1800);
    insert into public.task_completions (challenge_id, day, task_key)
      values ((select id from public.challenges where owner = v_uid and ended_at is null), 1, 'water');
  end loop;
  insert into public.feed_items (squad_id, author, kind, text)
    values ((select squad_id from public.squad_members where user_id = v_r1), v_r1, 'change', 'real feed');

  raise notice 'demo_account_test: two squads, four accounts, private rows written';
end $$;

-- =============================================================================
-- PROOF 1 — the reviewer sees the demo squadmate on the roster
-- =============================================================================
do $$
declare
  v_d1 uuid := '00000000-0000-0000-0000-0000000de001';
  v_d2 uuid := '00000000-0000-0000-0000-0000000de002';
  v_sq uuid := (select squad_id from public.squad_members where user_id = v_d1);
  n integer;
begin
  call dm_login(v_d1);
  select count(*) into n from public.get_squad_status(v_sq) where user_id = v_d2;
  if n <> 1 then raise exception 'FAIL: the reviewer does not see the demo squadmate (% rows)', n; end if;
  select count(*) into n from public.get_squad_status(v_sq);
  if n <> 2 then raise exception 'FAIL: the demo roster has % rows, expected exactly 2', n; end if;
  select count(*) into n from public.profiles where id = v_d2;
  if n <> 1 then raise exception 'FAIL: the reviewer cannot read the squadmate''s name'; end if;
  call dm_admin();
  raise notice 'PASS: the reviewer sees exactly the demo squad: two members, names and counts';
end $$;

-- =============================================================================
-- PROOF 2 — not one row of a real user's, of any kind
-- =============================================================================
do $$
declare
  v_d1 uuid := '00000000-0000-0000-0000-0000000de001';
  v_r1 uuid := '00000000-0000-0000-0000-0000000de0a1';
  v_real uuid := (select squad_id from public.squad_members where user_id = v_r1);
  v_ch uuid := (select id from public.challenges where owner = v_r1 and ended_at is null);
  n integer;
  t text;
begin
  if v_real is null or v_ch is null then raise exception 'FAIL: setup — the real squad or challenge is missing'; end if;
  call dm_login(v_d1);
  for t, n in
    select 'profiles',          (select count(*) from public.profiles          where id = v_r1)
    union all select 'profile_private', (select count(*) from public.profile_private where id = v_r1)
    union all select 'challenges',      (select count(*) from public.challenges      where owner = v_r1)
    union all select 'challenge_days',  (select count(*) from public.challenge_days  where challenge_id = v_ch)
    union all select 'task_completions',(select count(*) from public.task_completions where challenge_id = v_ch)
    union all select 'journal_entries', (select count(*) from public.journal_entries where owner = v_r1)
    union all select 'meals',           (select count(*) from public.meals           where owner = v_r1)
    union all select 'metric_checkins', (select count(*) from public.metric_checkins where owner = v_r1)
    union all select 'milestones',      (select count(*) from public.milestones      where owner = v_r1)
    union all select 'workout_logs',    (select count(*) from public.workout_logs    where owner = v_r1)
    union all select 'feed_items',      (select count(*) from public.feed_items      where squad_id = v_real)
    union all select 'squads',          (select count(*) from public.squads          where id = v_real)
    union all select 'squad_members',   (select count(*) from public.squad_members   where squad_id = v_real)
    union all select 'pings',           (select count(*) from public.pings           where squad_id = v_real)
  loop
    if n <> 0 then raise exception 'FAIL: the reviewer reads % row(s) of a real user''s %', n, t; end if;
  end loop;
  select count(*) into n from public.get_squad_status(v_real);
  if n <> 0 then raise exception 'FAIL: the real squad''s roster answers the reviewer with % rows', n; end if;
  call dm_admin();
  raise notice 'PASS: the reviewer reads no row of a real user''s, in 14 tables and the roster RPC';
end $$;

-- =============================================================================
-- PROOF 3 — a squadmate's private rows stay private, demo or not
-- =============================================================================
do $$
declare
  v_d1 uuid := '00000000-0000-0000-0000-0000000de001';
  v_d2 uuid := '00000000-0000-0000-0000-0000000de002';
  v_ch uuid := (select id from public.challenges where owner = v_d2 and ended_at is null);
  n integer;
  t text;
begin
  call dm_login(v_d1);
  for t, n in
    select 'profile_private', (select count(*) from public.profile_private where id = v_d2)
    union all select 'challenges',      (select count(*) from public.challenges      where owner = v_d2)
    union all select 'challenge_days',  (select count(*) from public.challenge_days  where challenge_id = v_ch)
    union all select 'task_completions',(select count(*) from public.task_completions where challenge_id = v_ch)
    union all select 'journal_entries', (select count(*) from public.journal_entries where owner = v_d2)
    union all select 'meals',           (select count(*) from public.meals           where owner = v_d2)
    union all select 'metric_checkins', (select count(*) from public.metric_checkins where owner = v_d2)
    union all select 'milestones',      (select count(*) from public.milestones      where owner = v_d2)
    union all select 'workout_logs',    (select count(*) from public.workout_logs    where owner = v_d2)
  loop
    if n <> 0 then raise exception 'FAIL: the reviewer reads % row(s) of the squadmate''s %', n, t; end if;
  end loop;
  call dm_admin();
  raise notice 'PASS: the squadmate''s private rows are invisible to the reviewer, in 9 tables';
end $$;

-- =============================================================================
-- PROOF 4 — no write reaches anyone else, no ping leaves the squad, no squad
--           is reachable without its code
-- =============================================================================
do $$
declare
  v_d1 uuid := '00000000-0000-0000-0000-0000000de001';
  v_d2 uuid := '00000000-0000-0000-0000-0000000de002';
  v_r1 uuid := '00000000-0000-0000-0000-0000000de0a1';
  v_demo uuid := (select squad_id from public.squad_members where user_id = v_d1);
  v_real uuid := (select squad_id from public.squad_members where user_id = v_r1);
  v_bad boolean;
  n integer;
  victim uuid;
begin
  call dm_login(v_d1);
  foreach victim in array array[v_r1, v_d2] loop
    v_bad := false;
    begin insert into public.journal_entries (owner, day, text) values (victim, 1, 'x'); v_bad := true;
    exception when others then null; end;
    if v_bad then raise exception 'FAIL: the reviewer wrote a journal entry as %', victim; end if;

    v_bad := false;
    begin insert into public.feed_items (squad_id, author, kind, text) values (v_real, victim, 'change', 'x'); v_bad := true;
    exception when others then null; end;
    if v_bad then raise exception 'FAIL: the reviewer posted to the real feed as %', victim; end if;

    update public.profiles set name = 'renamed' where id = victim;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: the reviewer renamed %', victim; end if;
  end loop;

  v_bad := false;
  begin insert into public.feed_items (squad_id, author, kind, text) values (v_real, v_d1, 'change', 'x'); v_bad := true;
  exception when others then null; end;
  if v_bad then raise exception 'FAIL: the reviewer posted into the real squad''s feed'; end if;

  v_bad := false;
  begin perform public.send_ping(v_r1, 'hi', v_demo); v_bad := true; exception when others then null; end;
  if v_bad then raise exception 'FAIL: the reviewer pinged a real user through the demo squad'; end if;
  v_bad := false;
  begin perform public.send_ping(v_r1, 'hi', v_real); v_bad := true; exception when others then null; end;
  if v_bad then raise exception 'FAIL: the reviewer pinged a real user through the real squad'; end if;

  v_bad := false;
  begin perform public.join_squad('ZZZZZZ'); v_bad := true; exception when others then null; end;
  if v_bad then raise exception 'FAIL: a made-up code joined a squad'; end if;
  call dm_admin();

  if exists (select 1 from public.squad_members where squad_id = v_real and user_id in (v_d1, v_d2)) then
    raise exception 'FAIL: a demo account ended up in the real squad';
  end if;
  if exists (select 1 from public.profiles where name = 'renamed') then
    raise exception 'FAIL: a rename landed';
  end if;
  raise notice 'PASS: the reviewer writes nothing of anyone else''s, pings nobody real, joins nothing without a code';
end $$;

do $$ begin raise notice 'DEMO ACCOUNT PROOFS PASSED'; end $$;
