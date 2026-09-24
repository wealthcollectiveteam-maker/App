-- =============================================================================
-- Phase 38F (F1 + F2): "start tomorrow" at setup, and day 1 pays what it earned.
--
-- ASSUMED STARTING STATE (rule 6): 0016 is fully applied — evaluate_challenge
-- is the 0016 body (dormancy), restart_challenge is the 0015 body,
-- create_challenge is the 0016 body (best_flame carried), get_or_freeze_today
-- is the 0011 body. This file adds ONE column, replaces create_challenge's
-- signature, adds ONE read RPC, and recreates three functions. No existing
-- row's history changes.
--
-- WHY, in the production read of 2026-09-24: nine of eleven people signed up
-- between 20:38 and 23:52. Nine people tried the app and not one completed a
-- full day. Signing up at 9pm with eleven tasks already impossible is the
-- most plausible mechanical reason a first day ends at four ticks, and the
-- first day is where everything dies.
--
-- F1 — START TOMORROW.
--   challenges.start_date already exists and every boundary derives from it
--   (challenge_day 0001:250-256, day_closes_at 0011:75-81). What was missing
--   was a way to choose it and a defined state for the day before it.
--   - create_challenge no longer takes p_start_date from the client. The
--     server computes it: today in the challenge's zone, plus one when
--     p_start_tomorrow. The server owns the clock; a phone with a wrong date
--     can no longer create a challenge on it. The old signature is DROPPED
--     (the 0011 lesson: a surviving arity resolves silently).
--   - get_or_freeze_today raises a NAMED error, 'challenge not started', on
--     the day before the start, instead of get_or_freeze_day's 'day 0 is
--     closed'. The client classifies exactly that string; anything else is
--     still an error, so an existing account can never be read as new and
--     sent to create a second challenge.
--   - my_challenge_status() is the one read the waiting screen needs.
--
-- F2 — THE FLOOR WAS DOING TWO JOBS. The judge-as-missed floor (2 fresh, 1
--   restart) protects the 23:50 signup and is unchanged in meaning. But it
--   also kept the evaluator's retroactive seal away from day 1, so a person
--   who ticked all eleven tasks on day 1 and did not tap seal lost that flame
--   permanently — the only day in the challenge where forgetting to seal
--   costs anything. All three sealed-with-null-outcome rows on production
--   are day 1. Now:
--     judge-as-missed floor:      challenges.first_judged_day (2 fresh, 1 restart)
--     seal-and-pay-if-met floor:  1, always
--   The cursor starts at 0 for every challenge created after this file, so
--   the evaluator VISITS day 1: a met day 1 is sealed and paid once, an
--   untouched day 1 on a fresh challenge is passed over with nothing written.
--   Existing fresh rows hold cursor 1 and are never revisited — no backfill,
--   by construction, not by exception.
--
--   PAY ONCE holds because the two payers work on disjoint windows: seal_day
--   seals only an OPEN day (0011:289), the evaluator only a CLOSED one
--   (v_last = last_closed_day), and both key on sealed_at. Proved in
--   missed_day_test.sql PROOF 13.
--
-- first_judged_day REPLACES 0015's CASE. Existing restarted rows are set to 1
-- so their behaviour is exactly what the CASE gave them; the default 2 is
-- what every fresh row already had. A challenge that starts tomorrow gets a
-- whole day 1 and could fairly be judged on it; it is NOT, on purpose: the
-- brief's F2 table reads "2 fresh, 1 restart, unchanged", the Phase 38D line
-- ("Day 1 is never counted as a miss") stays true for every fresh challenge
-- without a client change, and this phase exists to make the first day
-- survivable, not stricter. The column is where that decision lives if it
-- ever changes.
--
-- NOTE FOR 0015's AND 0016's GRIDS: both assert the CASE text is present in
-- evaluate_challenge. Read them BEFORE pasting this file; after it the CASE
-- is gone and its meaning lives in the column. This file's grid re-asserts
-- the 0014 and 0016 markers that must survive.
--
-- Every statement below is independently re-runnable (rule 4). The last
-- statement is the verification grid (rule 5): read it.
-- =============================================================================

-- ---- 1. the column that replaces the CASE ------------------------------------
alter table public.challenges
  add column if not exists first_judged_day integer not null default 2;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.challenges'::regclass
                    and conname  = 'challenges_first_judged_day_check') then
    alter table public.challenges
      add constraint challenges_first_judged_day_check
      check (first_judged_day in (1, 2));
  end if;
end $$;

-- What the CASE said about them, written down. Restarts are judged from day
-- 1 (0015); everything else from day 2. A new column taking the value the
-- code already gave the row is not a change of history.
update public.challenges
   set first_judged_day = 1
 where restarted_from is not null
   and first_judged_day <> 1;

-- ---- 2. create_challenge — the server computes the start date -------------
-- DROP, not REPLACE: the parameter list changes, so a replace would leave the
-- old arity beside the new one and a positional call would keep resolving to
-- it. The 0007 three-argument form is dropped too in case it survived.
drop function if exists public.create_challenge(text, date, text);
drop function if exists public.create_challenge(text, date, text, integer);

create or replace function public.create_challenge(
  p_base_tier      text,
  p_timezone       text    default 'UTC',
  p_duration_days  integer default 75,
  p_start_tomorrow boolean default false)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  new_id  uuid;
  v_tz    text := coalesce(nullif(trim(p_timezone), ''), 'UTC');
  v_best  integer;
  v_start date;
begin
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'unknown timezone: %', v_tz;
  end if;
  if p_duration_days not in (30, 45, 75) then
    raise exception 'duration must be 30, 45 or 75';
  end if;
  -- PHASE 38F: the server's clock, in the challenge's zone. Day 1 is today,
  -- or tomorrow if the person asked for a whole first day.
  v_start := (now() at time zone v_tz)::date
           + case when coalesce(p_start_tomorrow, false) then 1 else 0 end;
  -- PHASE 38E: the person's history is theirs.
  select coalesce(max(best_flame), 0) into v_best
    from public.challenges where owner = auth.uid();
  insert into public.challenges
    (owner, base_tier, start_date, timezone, last_evaluated_day, duration_days,
     best_flame, first_judged_day)
  values (auth.uid(), p_base_tier, v_start, v_tz,
          -- PHASE 38F: cursor 0, so the evaluator VISITS day 1 and can seal
          -- and pay it if it was met. It is still not judged as a miss:
          -- first_judged_day is 2.
          0,
          p_duration_days, v_best, 2)
  returning id into new_id;
  insert into public.tier_history (challenge_id, tier, from_day)
  values (new_id, p_base_tier, 1);
  return new_id;
end;
$$;

revoke all on function public.create_challenge(text, text, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.create_challenge(text, text, integer, boolean)
  to authenticated;

-- ---- 3. restart_challenge — the 0015 body, first_judged_day 1 -------------
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
     duration_days, first_judged_day)
  values
    (old_c.owner, v_tier, v_today, old_c.timezone, 0,
     -- best_flame is the longest streak this person has ever run. A restart
     -- ends an attempt; it does not un-happen the 40 days they did.
     old_c.best_flame,
     -- PHASE 38B-RIDER: BELOW day 1, so the evaluator's floor for a restart
     -- (1, see evaluate_challenge) reaches day 1. A fresh challenge still
     -- starts at 1 in create_challenge, and its floor is still 2.
     0,
     case when p_reason = 'missed_day' then 1 else null end,
     old_c.id,
     -- The attempt ended; the challenge they signed up for did not
     -- change. A 30-day run restarts as a 30-day run.
     old_c.duration_days,
     -- PHASE 38F: a restart's day 1 IS judged (0015). Written explicitly,
     -- never inherited from the column default.
     1)
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

-- ---- 4. evaluate_challenge — the 0016 body, the floor split in two ---------
create or replace function public.evaluate_challenge(p_challenge uuid)
returns integer
language plpgsql volatile security definer set search_path = public
as $$
declare
  c          public.challenges;
  v_last     integer;
  v_day      integer;
  v_snapshot public.challenge_days;
  v_tier     text;
  v_rules    public.tier_rules;
  v_squad    uuid;
  v_text     text;
  v_dormant  boolean;
  v_judged   integer := 0;
begin
  select * into c from public.challenges
    where id = p_challenge and ended_at is null
    for update;
  if c.id is null then
    return 0;                       -- already archived, or never existed
  end if;

  -- THE GRACE WINDOW, in one line. A day is judged only once it has CLOSED,
  -- which is noon the following day in this challenge's own timezone. Until
  -- then it is still open, still completable, and must not be scored.
  v_last := least(public.last_closed_day(c), c.duration_days);
  -- PHASE 38F. The seal-and-pay floor is 1, always: every closed day is
  -- VISITED. Whether a visited day can be judged a miss is a separate
  -- question, answered per day by first_judged_day below. Rows created
  -- before this file hold cursor 1 and are never revisited.
  v_day  := greatest(c.last_evaluated_day + 1, 1);

  while v_day <= v_last loop
    select * into v_snapshot from public.challenge_days
      where challenge_id = c.id and day = v_day;

    -- PHASE 38F. A PROTECTED day — day 1 of a fresh challenge, which began
    -- at whatever hour someone signed up. If it was met it is sealed and
    -- paid exactly as any other met day, once. If it was not, nothing is
    -- written: no snapshot manufactured, no outcome, no penalty. The
    -- restart's day 1 (first_judged_day 1) never enters this branch.
    if v_day < c.first_judged_day then
      if v_snapshot.id is not null and public.day_is_met(c.id, v_day) then
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
        v_judged := v_judged + 1;
      end if;
      update public.challenges set last_evaluated_day = v_day where id = c.id;
      c.last_evaluated_day := v_day;
      v_day := v_day + 1;
      continue;
    end if;

    if v_snapshot.id is null then
      insert into public.challenge_days (challenge_id, day, task_snapshot)
      values (c.id, v_day, public.compose_task_set(c.id, v_day))
      returning * into v_snapshot;
    end if;

    if public.day_is_met(c.id, v_day) then
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

      -- PHASE 38E. A restart is refused when this is the SECOND consecutive
      -- run with no sealed day: this run has none, and the run it replaced
      -- had none. A fresh challenge (no parent) is always allowed its one
      -- restart. Decided here, before the feed, because a dormant ending
      -- tells the squad nothing even if the owner ticked something this week.
      v_dormant := v_rules.restarts_challenge
               and c.restarted_from is not null
               and not public.challenge_has_sealed_day(c.id)
               and not public.challenge_has_sealed_day(c.restarted_from);

      if v_rules.restarts_challenge then
        v_text := format(
          'missed Day %s. %s rules — the challenge restarts at Day 1.',
          v_day, initcap(v_tier));
      elsif v_rules.resets_streak then
        v_text := format('missed Day %s. Streak reset to zero.', v_day);
      else
        v_text := format('missed Day %s.', v_day);
      end if;

      -- PHASE 38B. The feed hears about a miss only from someone who is
      -- still running: a completion on any of their challenges inside
      -- feed_activity_window(). A dormant account's miss is judged exactly
      -- as before and told to nobody.
      if v_squad is not null and not v_dormant and public.owner_is_active(c.owner) then
        insert into public.feed_items (squad_id, author, kind, text)
        values (v_squad, c.owner, 'miss', v_text);
      end if;

      update public.challenges set last_evaluated_day = v_day where id = c.id;
      v_judged := v_judged + 1;

      if v_dormant then
        update public.challenges
           set ended_at     = now(),
               ended_reason = 'dormant',
               ended_on_day = v_day
         where id = c.id and ended_at is null;
        return v_judged;
      end if;

      if v_rules.restarts_challenge then
        perform public.restart_challenge(c.id, v_day, 'missed_day');
        return v_judged;
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

-- ---- 5. get_or_freeze_today — the day before the start has a name ---------
-- CREATE OR REPLACE keeps 0011's grant to authenticated.
create or replace function public.get_or_freeze_today()
returns public.challenge_days
language plpgsql volatile security definer set search_path = public
as $$
declare c public.challenges;
begin
  c := public.my_active_challenge();
  if c.id is null then
    raise exception 'no challenge for user';
  end if;
  -- PHASE 38F. The one string the client classifies as "waiting". Every
  -- other failure still reads as a failure, never as "new account".
  if public.challenge_day(c) < 1 then
    raise exception 'challenge not started: day 1 is %', c.start_date;
  end if;
  return public.get_or_freeze_day(public.challenge_day(c));
end;
$$;

-- ---- 6. my_challenge_status — what the waiting screen reads ---------------
-- Owner-scoped through my_active_challenge(); answers only for the caller.
create or replace function public.my_challenge_status()
returns table (
  challenge_id  uuid,
  start_date    date,
  timezone      text,
  day           integer,
  duration_days integer,
  base_tier     text,
  started       boolean
)
language sql stable security definer set search_path = public
as $$
  select c.id, c.start_date, c.timezone, public.challenge_day(c),
         c.duration_days, c.base_tier, public.challenge_day(c) >= 1
    from public.my_active_challenge() c
   where c.id is not null;
$$;

revoke all on function public.my_challenge_status() from public, anon, authenticated;
grant execute on function public.my_challenge_status() to authenticated;

-- ---- 7. verification — read this grid --------------------------------------
select * from (
  select 1 as ord, 'first_judged_day exists, default 2' as item,
         coalesce((select column_default from information_schema.columns
                    where table_schema = 'public' and table_name = 'challenges'
                      and column_name = 'first_judged_day'), 'MISSING') as actual,
         '2' as expected,
         case when (select column_default from information_schema.columns
                     where table_schema = 'public' and table_name = 'challenges'
                       and column_name = 'first_judged_day') = '2'
              then 'OK' else 'FINDING' end as verdict
  union all
  select 2, 'every restarted row holds first_judged_day 1 (what the CASE gave it)',
         (select count(*) from public.challenges
           where restarted_from is not null and first_judged_day <> 1)::text,
         '0',
         case when (select count(*) from public.challenges
                     where restarted_from is not null and first_judged_day <> 1) = 0
              then 'OK' else 'FINDING — a restart would stop being judged from day 1' end
  union all
  select 3, 'the old create_challenge signature is gone',
         (select count(*) from pg_proc
           where proname = 'create_challenge'
             and pronamespace = 'public'::regnamespace
             and pg_get_function_identity_arguments(oid) like '%date%')::text,
         '0',
         case when (select count(*) from pg_proc
                     where proname = 'create_challenge'
                       and pronamespace = 'public'::regnamespace
                       and pg_get_function_identity_arguments(oid) like '%date%') = 0
              then 'OK' else 'FINDING — the 0011 lesson: an old arity survived' end
  union all
  select 4, 'create_challenge(text,text,integer,boolean): authenticated yes, anon no',
         case when has_function_privilege('authenticated', 'public.create_challenge(text,text,integer,boolean)', 'EXECUTE')
               and not has_function_privilege('anon', 'public.create_challenge(text,text,integer,boolean)', 'EXECUTE')
              then 'yes' else 'NO' end,
         'yes',
         case when has_function_privilege('authenticated', 'public.create_challenge(text,text,integer,boolean)', 'EXECUTE')
               and not has_function_privilege('anon', 'public.create_challenge(text,text,integer,boolean)', 'EXECUTE')
              then 'OK' else 'FINDING' end
  union all
  select 5, 'restart_challenge writes first_judged_day explicitly',
         case when pg_get_functiondef('public.restart_challenge(uuid,integer,text)'::regprocedure)
                   like '%first_judged_day)%' then 'yes' else 'NO' end,
         'yes',
         case when pg_get_functiondef('public.restart_challenge(uuid,integer,text)'::regprocedure)
                   like '%first_judged_day)%' then 'OK' else 'FINDING — the 0015 body is still in force' end
  union all
  select 6, 'evaluate_challenge: floor from the column, CASE gone, 0014 and 0016 markers kept',
         case when pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%v_day < c.first_judged_day%'
               and pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) not like '%case when c.restarted_from is null then 2 else 1 end%'
               and pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%owner_is_active(c.owner)%'
               and pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%challenge_has_sealed_day(c.restarted_from)%'
              then 'yes' else 'NO' end,
         'yes',
         case when pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%v_day < c.first_judged_day%'
               and pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) not like '%case when c.restarted_from is null then 2 else 1 end%'
               and pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%owner_is_active(c.owner)%'
               and pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%challenge_has_sealed_day(c.restarted_from)%'
              then 'OK' else 'FINDING — an earlier phase was overwritten or this one did not land' end
  union all
  select 7, 'get_or_freeze_today names the day before the start',
         case when pg_get_functiondef('public.get_or_freeze_today()'::regprocedure)
                   like '%challenge not started%' then 'yes' else 'NO' end,
         'yes',
         case when pg_get_functiondef('public.get_or_freeze_today()'::regprocedure)
                   like '%challenge not started%' then 'OK' else 'FINDING — the 0011 body is still in force' end
  union all
  select 8, 'my_challenge_status(): authenticated yes, anon no',
         case when has_function_privilege('authenticated', 'public.my_challenge_status()', 'EXECUTE')
               and not has_function_privilege('anon', 'public.my_challenge_status()', 'EXECUTE')
              then 'yes' else 'NO' end,
         'yes',
         case when has_function_privilege('authenticated', 'public.my_challenge_status()', 'EXECUTE')
               and not has_function_privilege('anon', 'public.my_challenge_status()', 'EXECUTE')
              then 'OK' else 'FINDING' end
  union all
  select 9, 'the engine is still unreachable from the app',
         case when has_function_privilege('authenticated', 'public.evaluate_challenge(uuid)', 'EXECUTE')
                or has_function_privilege('authenticated', 'public.restart_challenge(uuid,integer,text)', 'EXECUTE')
              then 'authenticated can EXECUTE' else 'authenticated cannot' end,
         'authenticated cannot',
         case when has_function_privilege('authenticated', 'public.evaluate_challenge(uuid)', 'EXECUTE')
                or has_function_privilege('authenticated', 'public.restart_challenge(uuid,integer,text)', 'EXECUTE')
              then 'FINDING — CREATE OR REPLACE widened the ACL' else 'OK' end
  union all
  select 10, 'alive challenges whose start is still ahead',
         (select count(*) from public.challenges c
           where ended_at is null and public.challenge_day(c) < 1)::text,
         '0 on first application',
         'informational — only sign-ups made after the deploy can be here'
  union all
  select 11, 'fresh challenges at cursor 0 (created after this file)',
         (select count(*) from public.challenges
           where restarted_from is null and last_evaluated_day = 0)::text,
         '0 on first application',
         'informational — every pre-existing fresh row holds 1 and is never revisited'
) v order by ord;
