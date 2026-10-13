-- =============================================================================
-- 0009 — SQUADS: NAMED, RENAMEABLE, SHARED, AND LEAVABLE
-- =============================================================================
--
-- One model change and four defects, all of which meet at the same row:
-- squad_members.
--
-- THE MODEL CHANGE. 0001 shipped
--
--     create unique index squad_members_one_squad on public.squad_members (user_id);
--
-- which is what made "a user has A squad" true. The table itself never
-- required it — the primary key is (squad_id, user_id) and has always allowed
-- a person in several squads — so this index is the entire constraint, and
-- dropping it is the entire model change.
--
-- What dropping it BREAKS is the more interesting half, and it breaks
-- quietly. Five functions resolved the caller's squad with
--
--     select squad_id into my_squad from public.squad_members where user_id = auth.uid();
--
-- SELECT INTO does not raise when a query returns more than one row; it keeps
-- an arbitrary one and carries on. So every one of those call sites would
-- have kept working, and kept being wrong — the roster showing whichever
-- squad Postgres handed back, a ping landing in a squad the user was not
-- looking at. Each is rewritten below to take the squad as an argument, which
-- is why this migration is longer than "drop index".
--
-- WHAT IS NOT TOUCHED: RLS. Every squad policy already reads
-- is_squad_member(squad_id, auth.uid()) and same_squad(a, b), both of which
-- are EXISTS over the join and were multi-squad-correct before this migration
-- existed. Proofs in supabase/tests/squads_test.sql say so rather than
-- assuming it.

-- =============================================================================
-- 1. THE INDEX
-- =============================================================================

-- The whole model change. Nothing replaces it: the composite primary key
-- (squad_id, user_id) already stops a user joining the SAME squad twice,
-- which is the only duplicate that was ever wrong.
drop index if exists public.squad_members_one_squad;

do $$
begin
  if exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'squad_members_one_squad'
  ) then
    raise exception '0009: squad_members_one_squad survived the drop';
  end if;
  raise notice '0009: squad_members_one_squad dropped — a user may hold several memberships';
end $$;

-- =============================================================================
-- 2. NAMING
-- =============================================================================

-- One place decides what a squad may be called, so create and rename cannot
-- drift apart. Trims first: a name of three spaces is not a name.
create or replace function public.clean_squad_name(p_name text)
returns text
language plpgsql immutable
as $$
declare
  v text := trim(coalesce(p_name, ''));
begin
  if v = '' then
    raise exception 'a squad needs a name';
  end if;
  if length(v) > 30 then
    raise exception 'squad names are limited to 30 characters';
  end if;
  return v;
end;
$$;

-- CREATE, and the two things it now gets right.
--
-- 1. There is no default name. The app used to send the literal 'Group 1'
--    for every squad anyone ever made, because nothing asked. A name is now
--    required here, so a nameless squad cannot be created even by a client
--    that forgets to ask.
--
-- 2. It returns the invite CODE. The old signature returned the uuid, which
--    the UI has no use for — the code is the thing a person sends to a
--    friend. That mismatch already shipped once: the screen showed a
--    provisional placeholder while the real code sat unread on the server,
--    and it rendered (and copied) six dots. Returning id, name and code
--    together means the client never has to hold a provisional value or make
--    a second round trip to learn what it just created.
drop function if exists public.create_squad(text);

create or replace function public.create_squad(p_name text)
returns table (id uuid, name text, code text)
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_name text := public.clean_squad_name(p_name);
  v_code text;
  v_id   uuid;
begin
  -- invite_code is UNIQUE, and md5 slices collide eventually. Retry rather
  -- than hand the user an error they can do nothing about.
  for i in 1 .. 10 loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (
      select 1 from public.squads s where s.invite_code = v_code
    );
    v_code := null;
  end loop;
  if v_code is null then
    raise exception 'could not mint an invite code';
  end if;

  insert into public.squads (name, invite_code, created_by)
  values (v_name, v_code, auth.uid())
  returning squads.id into v_id;

  insert into public.squad_members (squad_id, user_id) values (v_id, auth.uid());

  return query select v_id, v_name, v_code;
end;
$$;

-- RENAME. Creator only, and a refusal rather than a silent no-op: an UPDATE
-- filtered on created_by would simply match no rows, and the caller could not
-- tell that apart from success.
create or replace function public.rename_squad(p_squad_id uuid, p_name text)
returns table (id uuid, name text, code text)
language plpgsql volatile security definer set search_path = public
as $$
declare
  s      public.squads;
  v_name text := public.clean_squad_name(p_name);
begin
  select * into s from public.squads where squads.id = p_squad_id;
  if s.id is null then
    raise exception 'no such squad';
  end if;
  -- Deliberately distinguishable from "no such squad": a member who is not
  -- the creator has found the squad, they are simply not allowed to do this.
  if s.created_by <> auth.uid() then
    raise exception 'only the squad creator can rename it';
  end if;

  update public.squads set name = v_name where squads.id = p_squad_id;
  return query select s.id, v_name, s.invite_code;
end;
$$;

-- =============================================================================
-- 3. JOINING
-- =============================================================================

-- Joining no longer cares how many squads the caller is already in — that
-- was the unique index's opinion, and it is gone. Two refusals remain, and
-- both are explicit rather than an `on conflict do nothing` that reports
-- success for doing nothing:
--
--   a bad code          — there is nothing to join
--   the same squad twice — the caller is already there, and silently
--                          "succeeding" would tell the UI it had just joined
--                          something it was already in
-- Return type changes from uuid to a row, so CREATE OR REPLACE cannot do
-- it: the old signature has to go first.
drop function if exists public.join_squad(text);

create or replace function public.join_squad(p_code text)
returns table (id uuid, name text, code text)
language plpgsql volatile security definer set search_path = public
as $$
declare
  s public.squads;
begin
  select * into s from public.squads
    where invite_code = upper(trim(coalesce(p_code, '')));
  if s.id is null then
    raise exception 'invalid invite code';
  end if;
  if public.is_squad_member(s.id, auth.uid()) then
    raise exception 'you are already in this squad';
  end if;

  insert into public.squad_members (squad_id, user_id) values (s.id, auth.uid());
  return query select s.id, s.name, s.invite_code;
end;
$$;

-- The caller's squads, newest membership first. The client needs this to
-- know whether to draw a switcher at all.
create or replace function public.my_squads()
returns table (id uuid, name text, code text, is_creator boolean, member_count integer)
language sql stable security definer set search_path = public
as $$
  select s.id, s.name, s.invite_code, s.created_by = auth.uid(),
         (select count(*)::integer from public.squad_members m2 where m2.squad_id = s.id)
  from public.squad_members m
  join public.squads s on s.id = m.squad_id
  where m.user_id = auth.uid()
  order by m.joined_at, s.name;
$$;

-- =============================================================================
-- 4. LEAVING
-- =============================================================================

-- Leave ONE squad. All three outcomes are decided here rather than left to
-- whatever the foreign keys happen to do.
--
--   a) an ordinary member leaves — the membership row goes and nothing else
--      does. The challenge, the streak, the journal, the meals and every
--      frozen day belong to the PERSON, not to the squad; a squad is social
--      only, and leaving one is not an ending.
--
--   b) the creator leaves while others remain — ownership moves to the
--      earliest-joined remaining member. Without this the squad keeps a
--      created_by pointing at someone who is gone, and rename_squad() would
--      refuse everybody for ever: an orphan nobody can administer.
--
--   c) the last member leaves — the squad row is deleted, and the cascade
--      takes the rest. squad_members, feed_items and pings all declare
--      `references public.squads (id) on delete cascade`, and content_reports
--      cascades a second hop from feed_items. Nothing else references squads.
--
-- ON THE CASCADE WARNING. delete_account() once raised for every user with a
-- frozen day, because challenge_days carries an immutability trigger that
-- refuses DELETE as firmly as UPDATE. It cannot happen here: the only trigger
-- in the schema is challenge_days_immutable, and no path from squads reaches
-- challenge_days — challenges belong to owners, not squads. Proved rather
-- than asserted in squads_test.sql, which deletes a squad holding feed items,
-- pings and reports while both its members have frozen days.
create or replace function public.leave_squad(p_squad_id uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  s         public.squads;
  v_heir    uuid;
  v_left    integer;
begin
  select * into s from public.squads where squads.id = p_squad_id;
  if s.id is null then
    raise exception 'no such squad';
  end if;
  if not public.is_squad_member(p_squad_id, auth.uid()) then
    raise exception 'you are not in this squad';
  end if;

  delete from public.squad_members
   where squad_id = p_squad_id and user_id = auth.uid();

  select count(*) into v_left from public.squad_members
   where squad_id = p_squad_id;

  if v_left = 0 then
    delete from public.squads where squads.id = p_squad_id;
    return;
  end if;

  if s.created_by = auth.uid() then
    select user_id into v_heir from public.squad_members
     where squad_id = p_squad_id
     order by joined_at, user_id
     limit 1;
    update public.squads set created_by = v_heir where squads.id = p_squad_id;
  end if;
end;
$$;

-- Leave EVERY squad, applying the same three rules to each. This is the old
-- no-argument leave_squad()'s replacement and exists for exactly one caller:
-- delete_account(), which is removing the person entirely and therefore has
-- no squad to be asked about.
create or replace function public.leave_all_squads()
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  r record;
begin
  for r in
    select squad_id from public.squad_members where user_id = auth.uid()
  loop
    perform public.leave_squad(r.squad_id);
  end loop;
end;
$$;

-- The no-argument form is gone: with several memberships possible, "leave"
-- with nothing to say WHICH is not a question that has an answer. Dropped
-- rather than left in place, so a caller that still expects it fails loudly
-- at deploy time instead of silently emptying every squad the user is in.
drop function if exists public.leave_squad();

-- =============================================================================
-- 5. PINGING A PARTICULAR SQUAD
-- =============================================================================

-- send_ping resolved the squad the same way everything else did, and had the
-- same latent bug. It now takes the squad the sender is actually looking at,
-- and checks BOTH parties against it — being in some shared squad is no
-- longer enough to post into this one.
create or replace function public.send_ping(
  p_to uuid, p_message text, p_squad_id uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  used integer;
begin
  if not public.is_squad_member(p_squad_id, auth.uid())
     or not public.is_squad_member(p_squad_id, p_to) then
    raise exception 'recipient is not in your squad';
  end if;

  -- The quota is per PERSON per day, not per squad. Being in three squads is
  -- not three times the allowance to nag people.
  select count(*) into used from public.pings
    where from_user = auth.uid() and created_at >= date_trunc('day', now());
  if used >= 5 then
    raise exception 'out of pings — resets at midnight';
  end if;

  insert into public.pings (squad_id, from_user, to_user, message)
  values (p_squad_id, auth.uid(), p_to, p_message);
  insert into public.feed_items (squad_id, author, kind, text)
  values (p_squad_id, auth.uid(), 'ping', p_message);
end;
$$;

drop function if exists public.send_ping(uuid, text);


-- =============================================================================
-- 6a. THE ROSTER
-- =============================================================================

-- Recreated from 0007 with two changes: the squad is an argument rather
-- than a lookup, and the roster carries each member's day and length.
drop function if exists public.get_squad_status();

create or replace function public.get_squad_status(p_squad_id uuid)
returns table (
  user_id uuid, name text, xp integer, done_today integer,
  tasks_today integer, tier_label text, flame integer,
  day integer, duration_days integer
)
language plpgsql stable security definer set search_path = public
as $$
declare
  my_squad uuid;
begin
  -- The squad is now an ARGUMENT, not a lookup. It used to be
  -- `select squad_id into my_squad where user_id = auth.uid()`, which
  -- was correct only while a user could belong to exactly one squad.
  -- With that index gone the same query returns several rows and
  -- SELECT INTO silently keeps an arbitrary one — the roster would
  -- have rendered whichever squad Postgres happened to hand back.
  --
  -- Membership is still what authorises the read: a caller asking for
  -- a squad they are not in gets an empty result, not an error, which
  -- is the same answer they got before for having no squad at all.
  if not public.is_squad_member(p_squad_id, auth.uid()) then
    return;
  end if;
  my_squad := p_squad_id;
  return query
  with roster as (
    select m.user_id as uid, p.name as pname, p.xp as pxp,
           public.active_challenge_of(m.user_id) as ch
    from public.squad_members m
    join public.profiles p on p.id = m.user_id
    where m.squad_id = my_squad
  )
  select r.uid,
         r.pname,
         r.pxp,
         coalesce((
           select count(*)::integer from public.task_completions tc
           where tc.challenge_id = (r.ch).id
             and tc.day = public.challenge_day(r.ch)
         ), 0),
         coalesce((
           select jsonb_array_length(cd.task_snapshot)
           from public.challenge_days cd
           where cd.challenge_id = (r.ch).id
             and cd.day = public.challenge_day(r.ch)
         ), 0),
         coalesce(
           case when exists (
             select 1 from public.challenge_days cd2
             where cd2.challenge_id = (r.ch).id
               and cd2.day = public.challenge_day(r.ch)
               and exists (
                 select 1 from jsonb_array_elements(cd2.task_snapshot) t
                 where (t->'target'->>'value')::integer
                     < (t->'tierStandard'->>'value')::integer
               )
           ) then 'Custom'
           else initcap(public.effective_tier((r.ch).id, public.challenge_day(r.ch)))
           end, 'Hard'),
         coalesce((r.ch).flame, 0),
         -- Day N of M, for the roster. Both halves are per-member:
         -- squadmates run their own lengths, and someone who shortens
         -- their challenge should be seen to have shortened it. This
         -- is visibility, not enforcement — nothing reads it back.
         coalesce(public.challenge_day(r.ch), 0),
         coalesce((r.ch).duration_days, 75)
  from roster r;
end;
$$;

-- =============================================================================
-- 6. DELETING AN ACCOUNT THAT IS IN SEVERAL SQUADS
-- =============================================================================
--
-- The old version read ONE squad with SELECT INTO and cleaned up only that
-- one, which was complete while a user could hold a single membership and is
-- not any more: a user in three squads would have left all three (the old
-- no-argument leave_squad deleted every membership row) and orphaned two of
-- them — no members, no owner, and no way for anyone to reach them again.
--
-- leave_all_squads() now does the whole job, because it applies the same
-- three rules per squad: transfer where others remain, delete where nobody
-- does. Everything else in this function is unchanged from 0006.
create or replace function public.delete_account()
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- Squads first, and this single call replaces both the old
  -- `select squad_id into v_squad` and the orphan cleanup at the end: each
  -- squad is either handed on or deleted as the caller leaves it.
  perform public.leave_all_squads();

  delete from public.journal_entries where owner = v_uid;
  delete from public.meals           where owner = v_uid;
  delete from public.metric_checkins where owner = v_uid;
  delete from public.milestones      where owner = v_uid;
  delete from public.workout_logs    where owner = v_uid;
  delete from public.content_reports where reporter = v_uid;
  delete from public.pings           where from_user = v_uid or to_user = v_uid;

  -- Both directions. Deleting only `blocker` left this user's id sitting in
  -- other people's block lists for ever.
  delete from public.blocked_users   where blocker = v_uid or blocked = v_uid;

  delete from public.feed_items      where author = v_uid;
  delete from public.challenges      where owner = v_uid;
  delete from public.profile_private where id = v_uid;
  delete from public.profiles        where id = v_uid;
end;
$$;


-- =============================================================================
-- 8. GRANTS — allow-list, the 0002 pattern
-- =============================================================================
--
-- Re-created and brand new functions alike are created with EXECUTE to
-- PUBLIC. Revoke first, then grant back only what is sanctioned.
--
-- Every function here is owner- or membership-scoped in SQL: none of them
-- takes a user id, and each checks the caller's own membership before it
-- does anything. clean_squad_name() is pure text validation and holds no
-- authority at all.

revoke all on function
  public.clean_squad_name(text),
  public.create_squad(text),
  public.rename_squad(uuid, text),
  public.join_squad(text),
  public.my_squads(),
  public.leave_squad(uuid),
  public.leave_all_squads(),
  public.send_ping(uuid, text, uuid),
  public.get_squad_status(uuid),
  public.delete_account()
from public, anon, authenticated;

grant execute on function
  public.clean_squad_name(text),
  public.create_squad(text),
  public.rename_squad(uuid, text),
  public.join_squad(text),
  public.my_squads(),
  public.leave_squad(uuid),
  public.send_ping(uuid, text, uuid),
  public.get_squad_status(uuid),
  public.delete_account()
to authenticated;

-- NOT granted: leave_all_squads() empties every membership the caller holds
-- in one call. delete_account() is the only thing that should ever want that,
-- and it reaches it as a SECURITY DEFINER whose privilege check runs as the
-- function owner. A grant would put a one-tap "leave everything" on an API
-- no screen asks for.
