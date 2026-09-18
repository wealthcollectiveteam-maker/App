-- =============================================================================
-- 0008 — CHALLENGE LENGTH (30 / 45 / 75) AND SETUP-TIME CUSTOM TASKS
-- =============================================================================
--
-- Two changes that meet in the same place: the day-1 snapshot.
--
-- LENGTH. 75 stopped being a constant and became a per-challenge value.
-- Before this, the only executable 75 in the whole schema was
-- challenge_length(), an immutable zero-argument function; every other 75 in
-- these files is prose. That single function is why this migration is small:
-- there was exactly one number to replace, not a dozen scattered literals.
--
-- THE FINISH LINE MOVED FROM NOWHERE TO SOMEWHERE. `ended_reason` has
-- allowed 'completed' since 0007 and nothing ever wrote it. A challenge that
-- reached its last day stayed open indefinitely — the evaluator clamped at
-- the length and then simply stopped finding work. Completion is now a real
-- transition, in evaluate_challenge() below.
--
-- SETUP CUSTOM TASKS. compose_task_set() has always folded custom_tasks into
-- the snapshot, so nothing about the snapshot needed changing. What was
-- missing is a way to create one that is live on day 1: add_custom_task()
-- hardcodes `active_from_day = challenge_day + 1`, because mid-run edits
-- start tomorrow. Setup is not a mid-run edit — day 1 has not been frozen
-- yet — so it gets its own entry point with its own precondition, rather
-- than a flag on the existing one that could be passed at any time.
--
-- WHAT IS NOT TOUCHED: the day-snapshot immutability trigger, RLS on any
-- table, and every existing challenge_days row. Changing a length moves
-- where the run stops. It never rewrites what already happened.

-- =============================================================================
-- 1. THE COLUMN
-- =============================================================================

alter table public.challenges
  add column if not exists duration_days integer not null default 75,
  -- Both of these exist so that a length change is visible after the fact
  -- rather than silent: the app can say "shortened from 75 on 3 May" instead
  -- of quietly showing a different finish line than the user remembers.
  add column if not exists duration_previous   integer,
  add column if not exists duration_changed_at timestamptz;

alter table public.challenges
  drop constraint if exists challenges_duration_days_check;
alter table public.challenges
  add  constraint challenges_duration_days_check
  check (duration_days in (30, 45, 75));

-- Existing rows take the default and keep 75. COUNTED, not assumed — the
-- notice prints the real distribution, and an out-of-set value aborts the
-- migration rather than leaving a row the check constraint would have
-- rejected on its next update.
do $$
declare
  v_total integer;
  v_75    integer;
  v_other integer;
  v_bad   integer;
begin
  select count(*),
         count(*) filter (where duration_days = 75),
         count(*) filter (where duration_days in (30, 45)),
         count(*) filter (where duration_days is null
                             or duration_days not in (30, 45, 75))
    into v_total, v_75, v_other, v_bad
  from public.challenges;

  raise notice '0008: challenges rows=%  duration_days 75=%  30/45=%  invalid=%',
    v_total, v_75, v_other, v_bad;

  if v_bad > 0 then
    raise exception '0008: % challenge row(s) carry an invalid duration_days', v_bad;
  end if;
  if v_total <> v_75 + v_other then
    raise exception '0008: row counts do not add up (% <> % + %)',
      v_total, v_75, v_other;
  end if;
end $$;

-- =============================================================================
-- 2. LENGTH HELPERS
-- =============================================================================

-- The length of ONE challenge. Every bound in the engine reads this value
-- (or c.duration_days directly, where the row is already in hand).
create or replace function public.challenge_length(p_challenge uuid)
returns integer
language sql stable security definer set search_path = public
as $$ select duration_days from public.challenges where id = p_challenge $$;

-- The zero-argument form kept its name and signature so the grant lists and
-- the simulation helpers did not all have to change at once, but it is no
-- longer a constant: it answers for the CALLER's active challenge. It stops
-- being `immutable` for the same reason — the answer now depends on a row.
create or replace function public.challenge_length()
returns integer
language sql stable security definer set search_path = public
as $$ select duration_days from public.my_active_challenge() $$;

-- One cap, read by both the setup path and the mid-run path. It was 4 in
-- add_custom_task() and nowhere else; setup allows 5, and two different
-- ceilings on the same table would mean a user who added 5 at setup could
-- never add another and would be told the limit was 4.
create or replace function public.custom_task_limit()
returns integer
language sql immutable
as $$ select 5 $$;


-- =============================================================================
-- 3. CREATING A CHALLENGE WITH A LENGTH
-- =============================================================================

-- DROP then CREATE, not CREATE OR REPLACE: adding a defaulted parameter makes
-- a new signature, so the old three-argument version would survive alongside
-- it and a three-argument call would silently keep resolving to the old one.
drop function if exists public.create_challenge(text, date, text);

create or replace function public.create_challenge(
  p_base_tier text, p_start_date date, p_timezone text default 'UTC',
  p_duration_days integer default 75)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  new_id uuid;
  v_tz   text := coalesce(nullif(trim(p_timezone), ''), 'UTC');
begin
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'unknown timezone: %', v_tz;
  end if;
  if p_duration_days not in (30, 45, 75) then
    raise exception 'duration must be 30, 45 or 75';
  end if;
  insert into public.challenges
    (owner, base_tier, start_date, timezone, last_evaluated_day, duration_days)
  values (auth.uid(), p_base_tier, p_start_date, v_tz, 1, p_duration_days)
  returning id into new_id;
  insert into public.tier_history (challenge_id, tier, from_day)
  values (new_id, p_base_tier, 1);
  return new_id;
end;
$$;


-- =============================================================================
-- 4. THE ENGINE
-- =============================================================================

-- Recreated from 0007 with two changes: the upper bound is this
-- challenge's own duration_days rather than the global constant, and the
-- loop now has an ending — see THE FINISH LINE below.

create or replace function public.evaluate_challenge(p_challenge uuid)
returns integer
language plpgsql volatile security definer set search_path = public
as $$
declare
  c          public.challenges;
  v_today    integer;
  v_last     integer;
  v_day      integer;
  v_snapshot public.challenge_days;
  v_tier     text;
  v_rules    public.tier_rules;
  v_squad    uuid;
  v_text     text;
  v_judged   integer := 0;
begin
  select * into c from public.challenges
    where id = p_challenge and ended_at is null
    for update;
  if c.id is null then
    return 0;                       -- already archived, or never existed
  end if;

  v_today := public.challenge_day(c);

  -- Day 1 is the creation day and is never judged; nothing past the final
  -- day is judged either, or a finished run would be scored as abandoned.
  v_last := least(v_today - 1, c.duration_days);
  v_day  := greatest(c.last_evaluated_day + 1, 2);

  while v_day <= v_last loop
    select * into v_snapshot from public.challenge_days
      where challenge_id = c.id and day = v_day;

    -- A day the user never opened has no snapshot. Freeze it now from the
    -- config that was in force then, so the miss is recorded against a real
    -- task set and the Wall has no holes in it.
    if v_snapshot.id is null then
      insert into public.challenge_days (challenge_id, day, task_snapshot)
      values (c.id, v_day, public.compose_task_set(c.id, v_day))
      returning * into v_snapshot;
    end if;

    if public.day_is_met(c.id, v_day) then
      -- MET, sealed or not. A day whose every box was ticked counts even if
      -- the user never tapped "lock in the day" — seal it retroactively and
      -- award the flame they earned and did not get.
      if v_snapshot.sealed_at is null then
        update public.challenge_days
           set sealed_at = now(), evaluated_at = now(), outcome = 'met'
         where id = v_snapshot.id;
        update public.challenges
           set flame = flame + 1, best_flame = greatest(best_flame, flame + 1)
         where id = c.id;
        c.flame := c.flame + 1;
      else
        update public.challenge_days
           set evaluated_at = now(), outcome = 'met'
         where id = v_snapshot.id;
      end if;

      update public.challenges set last_evaluated_day = v_day where id = c.id;
      c.last_evaluated_day := v_day;
      v_judged := v_judged + 1;
      v_day := v_day + 1;

    else
      -- MISSED. The penalty comes from the tier that was in force on the day
      -- that was missed, read from tier_rules — not from a branch per tier.
      update public.challenge_days
         set evaluated_at = now(), outcome = 'missed'
       where id = v_snapshot.id;

      v_tier := public.effective_tier(c.id, v_day);
      select * into v_rules from public.tier_rules where tier = v_tier;
      if v_rules.tier is null then
        raise exception 'no missed-day rules for tier %', v_tier;
      end if;

      select squad_id into v_squad from public.squad_members
        where user_id = c.owner;

      if v_rules.restarts_challenge then
        v_text := format(
          'missed Day %s. %s rules — the challenge restarts at Day 1.',
          v_day, initcap(v_tier));
      elsif v_rules.resets_streak then
        v_text := format('missed Day %s. Streak reset to zero.', v_day);
      else
        v_text := format('missed Day %s.', v_day);
      end if;

      -- Completion status is already social; a broken streak is the same
      -- class of fact. Solo users have no squad and get no feed row.
      if v_squad is not null then
        insert into public.feed_items (squad_id, author, kind, text)
        values (v_squad, c.owner, 'miss', v_text);
      end if;

      -- The cursor advances in the SAME transaction as the penalty, so a
      -- second run — an overlap, a retry, a late catch-up — reads a day
      -- already judged and does nothing.
      update public.challenges set last_evaluated_day = v_day where id = c.id;
      v_judged := v_judged + 1;

      if v_rules.restarts_challenge then
        perform public.restart_challenge(c.id, v_day, 'missed_day');
        return v_judged;   -- this challenge is archived; later days are moot
      end if;

      if v_rules.resets_streak then
        update public.challenges
           set flame = 0, missed_notice_day = v_day + 1
         where id = c.id;
        c.flame := 0;
      end if;

      c.last_evaluated_day := v_day;
      v_day := v_day + 1;
    end if;
  end loop;

  -- THE FINISH LINE. Everything above judges days; this is the only place a
  -- challenge ends because it was FINISHED rather than failed, and before
  -- this migration no such place existed at all — `ended_reason = 'completed'`
  -- was permitted by the check constraint and written by nothing, so a run
  -- that reached its last day simply stayed open for ever.
  --
  -- It fires once the cursor has passed the last day the challenge asked
  -- for, read live off the row: a 30-day run ends on day 30 and a 75-day run
  -- on day 75 without either number appearing here. The cursor can only get
  -- there once that day has actually ENDED, because v_last is bounded by
  -- yesterday — so day N+1 is never judged, and never scored as a miss.
  --
  -- Nothing is re-scored. Every challenge_days row keeps the outcome it was
  -- given on the day it was judged; ending the challenge only stops the
  -- clock. A HARD miss never arrives here — restart_challenge() returns out
  -- of the loop above — so what reaches this point ran the full distance,
  -- whether or not every day inside it was met.
  if c.last_evaluated_day >= c.duration_days then
    update public.challenges
       set ended_at     = now(),
           ended_reason = 'completed',
           ended_on_day = c.duration_days
     where id = c.id and ended_at is null;
  end if;

  return v_judged;
end;
$$;


-- Recreated so a restart carries the chosen length forward.

create or replace function public.restart_challenge(
  p_challenge uuid, p_ended_on_day integer, p_reason text)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  old_c  public.challenges;
  new_id uuid;
  v_tier text;
  v_today date;
begin
  select * into old_c from public.challenges where id = p_challenge;
  if old_c.id is null then raise exception 'no such challenge'; end if;

  v_tier  := public.effective_tier(old_c.id, p_ended_on_day);
  v_today := (now() at time zone old_c.timezone)::date;

  update public.challenges
     set ended_at     = now(),
         ended_reason = p_reason,
         ended_on_day = p_ended_on_day
   where id = old_c.id;

  insert into public.challenges
    (owner, base_tier, start_date, timezone, flame, best_flame,
     last_evaluated_day, missed_notice_day, restarted_from,
     duration_days)
  values
    (old_c.owner, v_tier, v_today, old_c.timezone, 0,
     -- best_flame is the longest streak this person has ever run. A restart
     -- ends an attempt; it does not un-happen the 40 days they did.
     old_c.best_flame,
     1,
     case when p_reason = 'missed_day' then 1 else null end,
     old_c.id,
     -- The attempt ended; the challenge they signed up for did not
     -- change. A 30-day run restarts as a 30-day run.
     old_c.duration_days)
  returning id into new_id;

  insert into public.tier_history (challenge_id, tier, from_day)
  values (new_id, v_tier, 1);

  -- Custom tasks that were live on the day it ended, re-based to day 1.
  insert into public.custom_tasks
    (challenge_id, name, sub, proof, timer_minutes, active_from_day)
  select new_id, ct.name, ct.sub, ct.proof, ct.timer_minutes, 1
  from public.custom_tasks ct
  where ct.challenge_id = old_c.id
    and ct.active_from_day <= p_ended_on_day
    and (ct.removed_from_day is null or ct.removed_from_day > p_ended_on_day);

  insert into public.target_overrides
    (challenge_id, task_key, value, effective_from_day)
  select new_id, o.task_key, o.value, 1
  from public.target_overrides o
  where o.challenge_id = old_c.id
    and o.effective_from_day <= p_ended_on_day;

  -- Freeze day 1 now rather than waiting for the user's next launch, so the
  -- squad roster and the first screen they see are a real day 1.
  insert into public.challenge_days (challenge_id, day, task_snapshot)
  values (new_id, 1, public.compose_task_set(new_id, 1))
  on conflict (challenge_id, day) do nothing;

  return new_id;
end;
$$;



-- =============================================================================
-- 5. CHANGING THE LENGTH MID-RUN
-- =============================================================================

-- Moves the finish line. That is ALL it does to history: no challenge_days
-- row is rewritten, re-scored or deleted, and the immutability trigger is
-- not consulted because nothing tries to update a snapshot.
--
-- Two outcomes, and the caller needs to know which BEFORE it commits to the
-- change, so the flag comes back in the return:
--
--   p_duration >  today  the run simply continues against a longer target.
--   p_duration <= today  there is no future left to run: the challenge ends
--                        today, as a completion. The app is expected to have
--                        confirmed this with the user first — the returned
--                        flag is what lets it verify afterwards that what it
--                        warned about is what happened.
create or replace function public.set_challenge_duration(
  p_challenge_id uuid, p_duration integer)
returns table (completed boolean, ended_on_day integer, duration integer)
language plpgsql volatile security definer set search_path = public
as $$
declare
  c      public.challenges;
  v_day  integer;
  v_done boolean := false;
begin
  if p_duration not in (30, 45, 75) then
    raise exception 'duration must be 30, 45 or 75';
  end if;

  -- Ownership is the whole authorisation check, and `for update` holds the
  -- row against a concurrent evaluator run deciding the finish line from
  -- underneath us.
  select * into c from public.challenges
    where id = p_challenge_id and owner = auth.uid() and ended_at is null
    for update;
  if c.id is null then
    raise exception 'no such challenge';
  end if;

  v_day := public.challenge_day(c);

  update public.challenges
     set duration_days       = p_duration,
         duration_previous   = c.duration_days,
         duration_changed_at = now()
   where id = c.id;

  if p_duration <= v_day then
    update public.challenges
       set ended_at     = now(),
           ended_reason = 'completed',
           -- The day the attempt actually REACHED, which is today — not the
           -- new target, which today may already be past.
           ended_on_day = v_day
     where id = c.id;
    v_done := true;
  end if;

  return query
    select v_done,
           case when v_done then v_day else null::integer end,
           p_duration;
end;
$$;


-- =============================================================================
-- 6. CUSTOM TASKS
-- =============================================================================

-- Unchanged except for the cap, which now comes from custom_task_limit().
create or replace function public.add_custom_task(
  p_name text, p_sub text default '', p_proof boolean default false,
  p_timer_minutes integer default null)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  c public.challenges;
  d integer;
  active_count integer;
  new_id uuid;
begin
  c := public.my_active_challenge();
  if c.id is null then raise exception 'no challenge'; end if;
  d := public.challenge_day(c);
  select count(*) into active_count from public.custom_tasks
    where challenge_id = c.id
      and active_from_day <= d + 1
      and (removed_from_day is null or removed_from_day > d + 1);
  if active_count >= public.custom_task_limit() then
    raise exception 'custom task limit reached (%)', public.custom_task_limit();
  end if;
  insert into public.custom_tasks (challenge_id, name, sub, proof, timer_minutes, active_from_day)
  values (c.id, p_name, p_sub, p_proof, p_timer_minutes, d + 1)
  returning id into new_id;
  return new_id;
end;
$$;

-- The setup-time entry point, and the ONLY one that can put a custom task
-- into day 1.
--
-- add_custom_task() above writes `active_from_day = day + 1` because a
-- mid-run edit must not change the day already in progress. Setup is the one
-- moment where that rule does not apply: create_challenge() has run, day 1
-- has NOT been frozen yet, and a task added here is part of the challenge the
-- user is agreeing to rather than an edit to one already under way.
--
-- Both halves of that are enforced rather than trusted. Day must be 1, and
-- challenge_days must hold no row for it — the second is the one that
-- matters, because it is the snapshot's existence, not the calendar, that
-- decides whether day 1 can still change. Once it is frozen this function
-- refuses and the mid-run path is the only way in, which is exactly the
-- "edits start tomorrow" guarantee holding.
create or replace function public.add_setup_custom_task(
  p_name text, p_timer_minutes integer default null)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  c       public.challenges;
  v_name  text := trim(coalesce(p_name, ''));
  v_count integer;
  new_id  uuid;
begin
  c := public.my_active_challenge();
  if c.id is null then raise exception 'no challenge'; end if;

  if public.challenge_day(c) <> 1 then
    raise exception 'setup tasks can only be added on day 1';
  end if;
  if exists (select 1 from public.challenge_days
              where challenge_id = c.id and day = 1) then
    raise exception 'day 1 is already frozen';
  end if;

  if v_name = '' then
    raise exception 'a custom task needs a name';
  end if;
  if length(v_name) > 40 then
    raise exception 'custom task names are limited to 40 characters';
  end if;
  if p_timer_minutes is not null
     and (p_timer_minutes < 1 or p_timer_minutes > 600) then
    raise exception 'timer minutes must be between 1 and 600';
  end if;

  select count(*) into v_count from public.custom_tasks
    where challenge_id = c.id
      and active_from_day <= 1
      and (removed_from_day is null or removed_from_day > 1);
  if v_count >= public.custom_task_limit() then
    raise exception 'custom task limit reached (%)', public.custom_task_limit();
  end if;

  insert into public.custom_tasks
    (challenge_id, name, sub, proof, timer_minutes, active_from_day)
  values (c.id, v_name, '', false, p_timer_minutes, 1)
  returning id into new_id;
  return new_id;
end;
$$;


-- =============================================================================
-- 7. SIMULATIONS
-- =============================================================================

-- Recreated so a simulated fresh start keeps the chosen length.

create or replace function public.sim_fresh_start()
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  c      public.challenges;
  v_uid  uuid;
  v_tier text;
  v_tz   text;
  v_len  integer;
  new_id uuid;
begin
  c := public.require_simulation();
  v_uid  := c.owner;
  v_tier := public.effective_tier(c.id, public.challenge_day(c));
  v_tz   := c.timezone;
  v_len  := c.duration_days;

  -- Cascades to challenge_days, task_completions, tier_history,
  -- custom_tasks, target_overrides and workout_logs.
  delete from public.challenges where owner = v_uid;

  delete from public.journal_entries where owner = v_uid;
  delete from public.meals           where owner = v_uid;
  delete from public.milestones      where owner = v_uid;
  delete from public.metric_checkins where owner = v_uid;
  delete from public.feed_items      where author = v_uid;

  update public.profiles set xp = 0 where id = v_uid;
  update public.profile_private
     set completion_feeling = null, completion_text = null
   where id = v_uid;

  insert into public.challenges
    (owner, base_tier, start_date, timezone, flame, best_flame,
     last_evaluated_day, duration_days)
  values
    (v_uid, v_tier, (now() at time zone v_tz)::date, v_tz, 0, 0, 1, v_len)
  returning id into new_id;

  insert into public.tier_history (challenge_id, tier, from_day)
  values (new_id, v_tier, 1);

  insert into public.challenge_days (challenge_id, day, task_snapshot)
  values (new_id, 1, public.compose_task_set(new_id, 1));

  return new_id;
end;
$$;


-- Recreated so the jump is bounded by this challenge, not by 75.

create or replace function public.sim_jump_to_day(
  p_day integer, p_complete_today boolean default false)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  c       public.challenges;
  v_today date;
  i       integer;
begin
  c := public.require_simulation();

  if p_day < 1 or p_day > c.duration_days then
    raise exception 'day must be between 1 and %', c.duration_days;
  end if;

  if p_day <= public.challenge_day(c) then
    perform public.sim_fresh_start();
    c := public.my_active_challenge();
  end if;

  v_today := (now() at time zone c.timezone)::date;

  update public.challenges
     set start_date         = v_today - (p_day - 1),
         flame              = p_day - 1,
         best_flame         = greatest(best_flame, p_day - 1),
         last_evaluated_day = greatest(p_day - 1, 1),
         missed_notice_day  = null
   where id = c.id;

  for i in 1 .. p_day - 1 loop
    perform public.sim_fill_day(c.id, i);
  end loop;

  -- Today's own snapshot, frozen against the new start date.
  insert into public.challenge_days (challenge_id, day, task_snapshot)
  values (c.id, p_day, public.compose_task_set(c.id, p_day))
  on conflict (challenge_id, day) do nothing;

  if p_complete_today then
    perform public.sim_fill_day(c.id, p_day);
    update public.challenges
       set flame = p_day, best_flame = greatest(best_flame, p_day)
     where id = c.id;
  end if;
end;
$$;



-- The final day, complete. The name is unchanged because devSimulation.ts
-- calls it by name and the dev sheet's label is copy, not contract — but it
-- is no longer about 75: it jumps to whatever this challenge's last day is.
create or replace function public.sim_day75_complete()
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  c public.challenges;
begin
  c := public.require_simulation();
  perform public.sim_jump_to_day(c.duration_days, true);
end;
$$;


-- =============================================================================
-- 8. GRANTS — allow-list, the 0002 pattern
-- =============================================================================
--
-- New functions are created with EXECUTE to PUBLIC. Revoke first, then grant
-- back only what is sanctioned. challenge_length(uuid) is deliberately NOT
-- granted: it takes a challenge id, so a grant would let any user read the
-- length of somebody else's challenge. The zero-argument form is the client's
-- way in and it can only ever answer for the caller.

revoke all on function
  public.challenge_length(uuid),
  public.challenge_length(),
  public.custom_task_limit(),
  public.create_challenge(text, date, text, integer),
  public.set_challenge_duration(uuid, integer),
  public.add_custom_task(text, text, boolean, integer),
  public.add_setup_custom_task(text, integer),
  public.restart_challenge(uuid, integer, text),
  public.evaluate_challenge(uuid),
  public.sim_fresh_start(),
  public.sim_jump_to_day(integer, boolean),
  public.sim_day75_complete()
from public, anon, authenticated;

grant execute on function
  public.challenge_length(),
  public.custom_task_limit(),
  public.create_challenge(text, date, text, integer),
  public.set_challenge_duration(uuid, integer),
  public.add_custom_task(text, text, boolean, integer),
  public.add_setup_custom_task(text, integer)
to authenticated;

-- The simulations, same standing as in 0007: callable by `authenticated`,
-- and refused by require_simulation() unless the caller is in
-- sim_allowed_users, which ships empty.
grant execute on function
  public.sim_fresh_start(),
  public.sim_jump_to_day(integer, boolean),
  public.sim_day75_complete()
to authenticated;

-- STILL NOT GRANTED to any client role, unchanged from 0007 and restated
-- here because both were re-created above and a re-created function does not
-- keep a grant it never had:
--   evaluate_challenge(uuid)   drives the penalty machinery by challenge id.
--   restart_challenge(...)     ends a challenge; reachable only from the
--                              evaluator.
--   challenge_length(uuid)     reads any challenge's length by id.

-- =============================================================================
-- 9. THE SCHEDULED JOB HAS NEVER BEEN ABLE TO RUN
-- =============================================================================
--
-- Found while proving the finish line below actually fires. Calling
-- evaluate_all_challenges() raises `invalid transaction termination` at its
-- COMMIT — every time, for every caller, since 0007. It is not permissions
-- and not environmental: PostgreSQL refuses transaction control inside a
-- routine that runs in an atomic context, and 0007 declared the procedure
-- `security definer set search_path = public` while having it COMMIT once per
-- challenge. Those cannot both be true. Each of the two clauses is enough on
-- its own; measured, not guessed:
--
--   language plpgsql                                 commit  -> CALL ok
--   language plpgsql set search_path=public          commit  -> raises
--   language plpgsql security definer                commit  -> raises
--   language plpgsql security definer set search_path commit -> raises
--
-- The consequence is the entire engine. Nothing has ever applied a missed-day
-- penalty, retroactively sealed a met day, restarted a HARD run, or — as of
-- this migration — completed a finished challenge, because the hourly entry
-- point aborts on its first iteration and takes the whole pass with it.
-- evaluate_challenge() itself is fine and always was, which is exactly why
-- this survived: every proof to date called the function directly, and the
-- function is not the broken part.
--
-- So the procedure becomes plain: no SET clause, no SECURITY DEFINER. Neither
-- was doing the work people assume.
--
--   The privileges live in evaluate_challenge(), which is still SECURITY
--   DEFINER with its own pinned search_path — this procedure only chooses ids
--   and loops. Its caller is pg_cron, which runs as the database owner, so
--   invoker rights here are the owner's rights.
--
--   The search_path protection that the SET clause was there for is kept by
--   the body itself: every identifier in it is schema-qualified
--   (public.challenges, public.evaluate_challenge). set_config() is NOT used
--   as a substitute — it was tried, and it makes no difference to the atomic
--   context either way.
--
-- The COMMIT is what is being protected here, and it is worth protecting: it
-- is what stops one unusable challenge row from rolling back the penalties
-- and retroactive seals of every other challenge in the same pass.
create or replace procedure public.evaluate_all_challenges()
language plpgsql
as $$
declare
  r        record;
  v_judged integer;
  v_total  integer := 0;
  v_failed integer := 0;
begin
  for r in
    select id from public.challenges where ended_at is null order by id
  loop
    begin
      v_judged := public.evaluate_challenge(r.id);
      v_total := v_total + v_judged;
    exception when others then
      v_failed := v_failed + 1;
      raise warning 'evaluate_challenge(%) failed: %', r.id, sqlerrm;
    end;
    commit;
  end loop;

  raise notice 'evaluate_all_challenges: % day(s) judged, % challenge(s) failed',
    v_total, v_failed;
end;
$$;

-- Unchanged in intent from 0007, restated because the procedure was
-- re-created: this is the scheduler's entry point and nothing else's. It
-- walks EVERY challenge in the database, so no client role may call it.
revoke all on procedure public.evaluate_all_challenges()
from public, anon, authenticated;
