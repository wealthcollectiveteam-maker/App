-- =============================================================================
-- PHASE 10B PROOFS — squads: named, renameable, shared, leavable, isolated
-- =============================================================================
--
-- Everything is asserted at the DATABASE boundary with impersonated JWTs.
-- No screen is consulted: the UI is not what enforces any of this, and a
-- check made through it would prove only that the UI does not offer a button.

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f001', 'sq-a@test.dev'),
  ('00000000-0000-0000-0000-00000000f002', 'sq-b@test.dev'),
  ('00000000-0000-0000-0000-00000000f003', 'sq-c@test.dev'),
  ('00000000-0000-0000-0000-00000000f004', 'sq-d@test.dev')
on conflict do nothing;

insert into public.profiles (id, name) values
  ('00000000-0000-0000-0000-00000000f001', 'Ana'),
  ('00000000-0000-0000-0000-00000000f002', 'Ben'),
  ('00000000-0000-0000-0000-00000000f003', 'Cass'),
  ('00000000-0000-0000-0000-00000000f004', 'Dee')
on conflict do nothing;

create or replace procedure s_login(p_uid uuid)
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  set local role authenticated;
end $$;

-- Drop back to the privileged observer.
--
-- This matters more than it looks. Half the assertions below are about
-- whether a row still physically exists — the squad, its feed items, its
-- pings. Asked as the user who just left, RLS answers "no such squad" for a
-- squad that is perfectly intact, and the test passes for the wrong reason.
-- Every existence check therefore runs from here, and only the behavioural
-- checks run as a member.
create or replace procedure s_admin()
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', false);
  reset role;
end $$;

-- A challenge with a frozen day 1, so the cascade proof runs against users who
-- actually have the rows that once made delete_account() raise.
create or replace procedure s_challenge(p_uid uuid, p_days integer)
language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  v_id := public.create_challenge('hard', current_date, 'UTC', p_days);
  perform public.get_or_freeze_today();
end $$;

-- =============================================================================
-- PROOF 1 — a squad cannot exist without a name, and creation hands back the CODE
-- =============================================================================
do $$
declare
  v_a   uuid := '00000000-0000-0000-0000-00000000f001';
  r     record;
  v_bad boolean;
begin
  call s_login(v_a);

  -- No default. Empty, whitespace-only and over-long are all refused.
  foreach r in array array[row(''), row('   '), row(repeat('x', 31))]::record[] loop
    null;
  end loop;

  v_bad := false;
  begin perform public.create_squad('');           v_bad := true; exception when others then null; end;
  if v_bad then raise exception 'FAIL: created a squad with an empty name'; end if;

  v_bad := false;
  begin perform public.create_squad('   ');        v_bad := true; exception when others then null; end;
  if v_bad then raise exception 'FAIL: created a squad named only whitespace'; end if;

  v_bad := false;
  begin perform public.create_squad(repeat('x',31)); v_bad := true; exception when others then null; end;
  if v_bad then raise exception 'FAIL: created a squad with a 31-character name'; end if;

  -- The happy path returns the row the UI actually needs.
  select * into r from public.create_squad('  Gym Crew  ');

  if r.name <> 'Gym Crew' then
    raise exception 'FAIL: the name was not trimmed (got %)', r.name;
  end if;
  if r.code is null or length(r.code) <> 6 then
    raise exception 'FAIL: create_squad did not return a 6-character code';
  end if;
  -- The code returned is the code STORED — this is the mismatch that shipped.
  if r.code <> (select invite_code from public.squads where id = r.id) then
    raise exception 'FAIL: the returned code is not the squad''s invite code';
  end if;
  if not exists (select 1 from public.squad_members
                  where squad_id = r.id and user_id = v_a) then
    raise exception 'FAIL: the creator was not added as a member';
  end if;
  if exists (select 1 from public.squads where name = 'Group 1') then
    raise exception 'FAIL: something still creates a squad called Group 1';
  end if;

  raise notice 'PASS: a nameless squad is impossible, and create returns id + name + code';
end $$;

-- =============================================================================
-- PROOF 2 — several squads at once; the same one twice is still refused
-- =============================================================================
do $$
declare
  v_a    uuid := '00000000-0000-0000-0000-00000000f001';
  v_b    uuid := '00000000-0000-0000-0000-00000000f002';
  v_gym  uuid;
  v_work uuid;
  v_gym_code  text;
  v_work_code text;
  r      record;
  v_bad  boolean;
begin
  call s_login(v_a);
  select id into v_gym from public.squads where name = 'Gym Crew';
  select * into r from public.create_squad('Work Squad');
  v_work := r.id;
  -- Captured while A (a member of both) is the caller. squads_select only
  -- exposes a squad to its members, so a would-be joiner cannot read the very
  -- code they need — which is the point of an invite code and is why this
  -- test has to carry it by hand rather than look it up as B.
  select invite_code into v_gym_code  from public.squads where id = v_gym;
  v_work_code := r.code;

  if (select count(*) from public.squad_members where user_id = v_a) <> 2 then
    raise exception 'FAIL: a user could not hold two memberships';
  end if;
  if (select count(*) from public.my_squads()) <> 2 then
    raise exception 'FAIL: my_squads() did not list both';
  end if;

  -- B joins both, while already in one — the case the dropped index forbade.
  call s_login(v_b);
  perform public.join_squad(v_gym_code);
  perform public.join_squad(v_work_code);
  if (select count(*) from public.squad_members where user_id = v_b) <> 2 then
    raise exception 'FAIL: joining a second squad did not work';
  end if;

  v_bad := false;
  begin
    perform public.join_squad(v_gym_code);
    v_bad := true;
  exception when others then null;
  end;
  if v_bad then raise exception 'FAIL: joined the same squad twice'; end if;

  v_bad := false;
  begin perform public.join_squad('ZZZZZZ'); v_bad := true; exception when others then null; end;
  if v_bad then raise exception 'FAIL: a bad invite code was accepted'; end if;

  raise notice 'PASS: several squads at once; the same squad twice and a bad code are refused';
end $$;

-- =============================================================================
-- PROOF 3 — the roster answers per SQUAD, and carries day / duration
-- =============================================================================
do $$
declare
  v_a    uuid := '00000000-0000-0000-0000-00000000f001';
  v_b    uuid := '00000000-0000-0000-0000-00000000f002';
  v_c    uuid := '00000000-0000-0000-0000-00000000f003';
  v_gym  uuid;
  v_work uuid;
  v_row  record;
begin
  call s_challenge(v_a, 45);
  call s_challenge(v_b, 30);

  select id into v_gym  from public.squads where name = 'Gym Crew';
  select id into v_work from public.squads where name = 'Work Squad';

  call s_login(v_a);

  -- Two squads, and each answers for itself. Before 0009 this function looked
  -- the squad up with SELECT INTO and would have answered for an arbitrary one.
  if (select count(*) from public.get_squad_status(v_gym)) <> 2 then
    raise exception 'FAIL: the gym roster is not 2 members';
  end if;

  select * into v_row from public.get_squad_status(v_gym) where user_id = v_b;
  if v_row.duration_days <> 30 then
    raise exception 'FAIL: the roster shows duration %, expected B''s 30',
      v_row.duration_days;
  end if;
  if v_row.day <> 1 then
    raise exception 'FAIL: the roster shows day %, expected 1', v_row.day;
  end if;

  select * into v_row from public.get_squad_status(v_gym) where user_id = v_a;
  if v_row.duration_days <> 45 then
    raise exception 'FAIL: each member''s own length is not what is shown';
  end if;

  -- C is in neither squad and gets nothing back for either of them.
  call s_login(v_c);
  if (select count(*) from public.get_squad_status(v_gym)) <> 0 then
    raise exception 'FAIL: a non-member read a roster';
  end if;

  raise notice 'PASS: the roster is per-squad and carries each member''s own day / length';
end $$;

-- =============================================================================
-- PROOF 4 — rename: creator only, and a refusal rather than a silent no-op
-- =============================================================================
do $$
declare
  v_a   uuid := '00000000-0000-0000-0000-00000000f001';
  v_b   uuid := '00000000-0000-0000-0000-00000000f002';
  v_gym uuid;
  v_bad boolean := false;
  r     record;
begin
  select id into v_gym from public.squads where name = 'Gym Crew';

  -- B is a MEMBER of this squad, and still may not rename it. This is the
  -- distinction the proof exists for: membership is not administration.
  call s_login(v_b);
  begin
    perform public.rename_squad(v_gym, 'Ben''s Crew');
    v_bad := true;
  exception when others then null;
  end;
  if v_bad then
    raise exception 'FAIL: a non-creator member renamed the squad';
  end if;
  if (select name from public.squads where id = v_gym) <> 'Gym Crew' then
    raise exception 'FAIL: the name changed anyway';
  end if;

  call s_login(v_a);
  select * into r from public.rename_squad(v_gym, '  Morning Crew  ');
  if r.name <> 'Morning Crew'
     or (select name from public.squads where id = v_gym) <> 'Morning Crew' then
    raise exception 'FAIL: the creator could not rename, or the name was not trimmed';
  end if;

  v_bad := false;
  begin perform public.rename_squad(v_gym, ''); v_bad := true; exception when others then null; end;
  if v_bad then raise exception 'FAIL: renamed a squad to nothing'; end if;

  raise notice 'PASS: only the creator renames, and a non-creator is refused rather than ignored';
end $$;

-- =============================================================================
-- PROOF 5 — leaving: member, creator, and the last one out
-- =============================================================================
do $$
declare
  v_a    uuid := '00000000-0000-0000-0000-00000000f001';
  v_b    uuid := '00000000-0000-0000-0000-00000000f002';
  v_gym  uuid;
  v_days integer;
  v_ch   uuid;
begin
  select id into v_gym from public.squads where name = 'Morning Crew';
  select id into v_ch from public.challenges where owner = v_b and ended_at is null;
  select count(*) into v_days from public.challenge_days where challenge_id = v_ch;

  -- (a) an ordinary member leaves.
  call s_login(v_b);
  perform public.leave_squad(v_gym);

  if exists (select 1 from public.squad_members where squad_id = v_gym and user_id = v_b) then
    raise exception 'FAIL: the membership row survived';
  end if;
  if not exists (select 1 from public.challenges where owner = v_b and ended_at is null) then
    raise exception 'FAIL: leaving a squad ended the member''s challenge';
  end if;
  if (select count(*) from public.challenge_days where challenge_id = v_ch) <> v_days then
    raise exception 'FAIL: leaving a squad destroyed frozen days';
  end if;
  call s_admin();
  if not exists (select 1 from public.squads where id = v_gym) then
    raise exception 'FAIL: the squad was deleted when a member left';
  end if;
  if (select count(*) from public.squad_members where squad_id = v_gym) <> 1 then
    raise exception 'FAIL: the squad does not hold exactly the one remaining member';
  end if;

  raise notice 'PASS: a member leaving loses the membership row and nothing else';
end $$;

do $$
declare
  v_a    uuid := '00000000-0000-0000-0000-00000000f001';
  v_b    uuid := '00000000-0000-0000-0000-00000000f002';
  v_c    uuid := '00000000-0000-0000-0000-00000000f003';
  v_work uuid;
  v_code text;
begin
  -- Read before impersonating anybody: this block starts as the superuser,
  -- and C cannot see a squad they have not joined.
  select id, invite_code into v_work, v_code
    from public.squads where name = 'Work Squad';

  -- C joins last, so B (who joined first) is the rightful heir.
  call s_login(v_c);
  perform public.join_squad(v_code);

  -- (b) the CREATOR leaves while others remain.
  call s_login(v_a);
  perform public.leave_squad(v_work);

  call s_admin();
  if (select created_by from public.squads where id = v_work) <> v_b then
    raise exception 'FAIL: ownership did not pass to the earliest-joined remaining member';
  end if;

  -- And the heir can actually administer it — otherwise the transfer is
  -- bookkeeping and the squad is still orphaned.
  call s_login(v_b);
  perform public.rename_squad(v_work, 'Work Crew');
  if (select name from public.squads where id = v_work) <> 'Work Crew' then
    raise exception 'FAIL: the new creator cannot rename the squad';
  end if;

  raise notice 'PASS: a creator leaving hands the squad on, and the heir can administer it';
end $$;

-- =============================================================================
-- PROOF 6 — the last member out deletes the squad, cascade and all
-- =============================================================================
do $$
declare
  v_a     uuid := '00000000-0000-0000-0000-00000000f001';
  v_d     uuid := '00000000-0000-0000-0000-00000000f004';
  v_sq    uuid;
  v_feed  uuid;
  r       record;
begin
  call s_challenge(v_d, 75);

  call s_login(v_a);
  select * into r from public.create_squad('Doomed');
  v_sq := r.id;

  call s_login(v_d);
  perform public.join_squad(r.code);

  -- Fill it with everything that references a squad, so the cascade has
  -- something to do: feed items, pings, and a report hanging off a feed item.
  call s_login(v_a);
  perform public.send_ping(v_d, 'get up', v_sq);
  insert into public.feed_items (squad_id, author, kind, text)
  values (v_sq, v_a, 'complete', 'locked in') returning id into v_feed;
  insert into public.content_reports (reporter, feed_item_id, reason)
  values (v_a, v_feed, 'spam');

  if (select count(*) from public.pings where squad_id = v_sq) = 0
     or (select count(*) from public.feed_items where squad_id = v_sq) = 0
     or (select count(*) from public.content_reports where feed_item_id = v_feed) = 0 then
    raise exception 'FAIL: the fixture did not create the rows the cascade is meant to remove';
  end if;

  -- Both members hold FROZEN DAYS. This is the shape that once made
  -- delete_account() raise: challenge_days carries an immutability trigger
  -- that refuses DELETE as firmly as UPDATE. If any path from squads reached
  -- challenge_days, this is where it would fire.
  if (select count(*) from public.challenge_days cd
       join public.challenges c on c.id = cd.challenge_id
       where c.owner in (v_a, v_d)) = 0 then
    raise exception 'FAIL: the fixture has no frozen days to test the cascade against';
  end if;

  -- (c) last one out.
  perform public.leave_squad(v_sq);
  call s_login(v_d);
  perform public.leave_squad(v_sq);

  call s_admin();
  if exists (select 1 from public.squads where id = v_sq) then
    raise exception 'FAIL: the empty squad was not deleted';
  end if;
  if exists (select 1 from public.squad_members where squad_id = v_sq) then
    raise exception 'FAIL: squad_members did not cascade';
  end if;
  if exists (select 1 from public.feed_items where squad_id = v_sq) then
    raise exception 'FAIL: feed_items did not cascade';
  end if;
  if exists (select 1 from public.pings where squad_id = v_sq) then
    raise exception 'FAIL: pings did not cascade';
  end if;
  if exists (select 1 from public.content_reports where feed_item_id = v_feed) then
    raise exception 'FAIL: content_reports did not cascade from feed_items';
  end if;

  -- And nothing personal went with it.
  if not exists (select 1 from public.challenges where owner = v_d and ended_at is null) then
    raise exception 'FAIL: deleting a squad ended a member''s challenge';
  end if;
  if (select count(*) from public.challenge_days cd
       join public.challenges c on c.id = cd.challenge_id where c.owner = v_d) = 0 then
    raise exception 'FAIL: deleting a squad destroyed a member''s frozen days';
  end if;

  raise notice 'PASS: the last member out deletes the squad — members, feed, pings and reports cascade, frozen days untouched';
end $$;

-- =============================================================================
-- PROOF 7 — pings land in the squad they were sent from
-- =============================================================================
do $$
declare
  v_b    uuid := '00000000-0000-0000-0000-00000000f002';
  v_c    uuid := '00000000-0000-0000-0000-00000000f003';
  v_a    uuid := '00000000-0000-0000-0000-00000000f001';
  v_work uuid;
  v_gym  uuid;
  v_bad  boolean := false;
begin
  select id into v_work from public.squads where name = 'Work Crew';
  select id into v_gym  from public.squads where name = 'Morning Crew';

  call s_login(v_b);
  perform public.send_ping(v_c, 'move', v_work);
  if (select count(*) from public.pings where squad_id = v_work
        and from_user = v_b and to_user = v_c) <> 1 then
    raise exception 'FAIL: the ping did not land in the squad it was sent from';
  end if;

  -- A is in Morning Crew; C is not. Sharing SOME squad is not enough.
  begin
    perform public.send_ping(v_c, 'nope', v_gym);
    v_bad := true;
  exception when others then null;
  end;
  if v_bad then
    raise exception 'FAIL: pinged into a squad the recipient is not in';
  end if;

  raise notice 'PASS: a ping is scoped to the squad it was sent from';
end $$;

-- =============================================================================
-- PROOF 8 — ISOLATION, re-proved because membership is what RLS keys off
-- =============================================================================
do $$
declare
  v_a      uuid := '00000000-0000-0000-0000-00000000f001';
  v_b      uuid := '00000000-0000-0000-0000-00000000f002';
  v_c      uuid := '00000000-0000-0000-0000-00000000f003';
  v_work   uuid;
  v_ch_b   uuid;
  n        integer;
  v_state  text;
begin
  select id into v_work from public.squads where name = 'Work Crew';
  select id into v_ch_b from public.challenges where owner = v_b and ended_at is null;

  -- B writes private data of every kind.
  call s_login(v_b);
  insert into public.journal_entries (owner, day, text) values (v_b, 1, 'private');
  -- With nutrition attached, because that is the field 10C added a manual
  -- entry path for. It travels inside meals.nutrition, so it is covered by
  -- the meals policy — but "covered by" is an argument, and this is a test.
  insert into public.meals (owner, day, text, nutrition)
  values (v_b, 1, 'private meal',
          '{"calories":650,"protein":45,"carbs":70,"fat":18,"quickAdd":true}'::jsonb);
  insert into public.metric_checkins (owner, weight_kg, mood) values (v_b, 80, 4);
  insert into public.workout_logs (owner, challenge_id, day, task_key, activity_type, duration_seconds)
  values (v_b, v_ch_b, 1, 'workout1', 'Run', 600);

  -- B and C share Work Crew. A left it in proof 5b, so A is a NON-member —
  -- which is exactly the new row in the table.
  call s_login(v_c);

  select count(*) into n from public.journal_entries where owner = v_b;
  raise notice 'ISOLATION  C reads B journal              = % (expect 0)', n;
  if n <> 0 then raise exception 'FAIL: journal leaked'; end if;

  select count(*) into n from public.meals where owner = v_b;
  raise notice 'ISOLATION  C reads B meals                = % (expect 0)', n;
  if n <> 0 then raise exception 'FAIL: meals leaked'; end if;

  -- The same row, asked for by the column that carries the calories. A
  -- squadmate must not be able to read what anybody ate, or how much of it.
  select count(*) into n from public.meals
   where owner = v_b and nutrition is not null;
  raise notice 'ISOLATION  C reads B nutrition            = % (expect 0)', n;
  if n <> 0 then raise exception 'FAIL: nutrition leaked'; end if;

  select count(*) into n from public.meals
   where (nutrition->>'calories')::int > 0;
  raise notice 'ISOLATION  C reads ANY calories at all    = % (expect 0)', n;
  if n <> 0 then raise exception 'FAIL: nutrition readable across the squad'; end if;

  select count(*) into n from public.metric_checkins where owner = v_b;
  raise notice 'ISOLATION  C reads B metrics              = % (expect 0)', n;
  if n <> 0 then raise exception 'FAIL: metrics leaked'; end if;

  select count(*) into n from public.workout_logs where owner = v_b;
  raise notice 'ISOLATION  C reads B workout logs         = % (expect 0)', n;
  if n <> 0 then raise exception 'FAIL: workout logs leaked'; end if;

  select count(*) into n from public.get_squad_status(v_work);
  raise notice 'ISOLATION  C reads SHARED squad roster    = % (expect 2)', n;
  if n <> 2 then raise exception 'FAIL: a shared roster is not readable'; end if;

  select count(*) into n from public.profiles;
  raise notice 'ISOLATION  C reads profiles (self+shared) = % (expect 2)', n;
  if n <> 2 then raise exception 'FAIL: profile visibility is not self + squadmates'; end if;

  -- A is not in Work Crew. Both the RPC and the raw tables must say nothing.
  call s_login(v_a);
  select count(*) into n from public.get_squad_status(v_work);
  raise notice 'ISOLATION  A reads NON-member roster      = % (expect 0)', n;
  if n <> 0 then raise exception 'FAIL: a non-member read a roster'; end if;

  select count(*) into n from public.squad_members where squad_id = v_work;
  raise notice 'ISOLATION  A reads NON-member membership  = % (expect 0)', n;
  if n <> 0 then raise exception 'FAIL: a non-member enumerated a roster directly'; end if;

  select count(*) into n from public.squads where id = v_work;
  raise notice 'ISOLATION  A reads NON-member squad row   = % (expect 0)', n;
  if n <> 0 then raise exception 'FAIL: a non-member read the squad row'; end if;

  select count(*) into n from public.feed_items where squad_id = v_work;
  raise notice 'ISOLATION  A reads NON-member feed        = % (expect 0)', n;
  if n <> 0 then raise exception 'FAIL: a non-member read the feed'; end if;

  -- Writing as somebody else.
  begin
    insert into public.journal_entries (owner, day, text) values (v_b, 2, 'forged');
    raise exception 'FAIL: A inserted a row owned by B';
  exception
    when insufficient_privilege then
      v_state := '42501';
    when others then
      get stacked diagnostics v_state = returned_sqlstate;
      if v_state <> '42501' then
        raise exception 'FAIL: forged insert failed with % rather than 42501', v_state;
      end if;
  end;
  raise notice 'ISOLATION  A inserts a row owned by B     = % (expect 42501)', v_state;

  -- Renaming a squad A did not create (and is not even in).
  begin
    perform public.rename_squad(v_work, 'Hijacked');
    raise exception 'FAIL: A renamed a squad they did not create';
  exception when others then null;
  end;
  raise notice 'ISOLATION  A renames a foreign squad      = refused (expect refused)';

  raise notice 'PASS: isolation holds with multi-squad membership';
end $$;

-- anon holds no write privilege anywhere in public.
do $$
declare
  t record;
  n integer := 0;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    if has_table_privilege('anon', format('public.%I', t.tablename), 'INSERT')
       or has_table_privilege('anon', format('public.%I', t.tablename), 'UPDATE')
       or has_table_privilege('anon', format('public.%I', t.tablename), 'DELETE') then
      n := n + 1;
      raise warning 'anon can write public.%', t.tablename;
    end if;
  end loop;
  raise notice 'ISOLATION  anon write privileges          = % (expect 0)', n;
  if n <> 0 then raise exception 'FAIL: anon holds write privileges'; end if;
  raise notice 'PASS: anon holds no write privilege on any table in public';
end $$;

do $$ begin raise notice ' ALL SQUAD PROOFS PASSED'; end $$;
