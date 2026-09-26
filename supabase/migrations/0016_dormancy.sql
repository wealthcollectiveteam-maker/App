-- =============================================================================
-- Phase 38E (E1): a person can stop. The evaluator learns the word "dormant".
--
-- ASSUMED STARTING STATE (rule 6): 0015 is fully applied — evaluate_challenge
-- is the 0015 body (grace window, dormant-feed condition, restart-aware
-- floor), restart_challenge is the 0015 body (cursor 0 on the replacement),
-- create_challenge is the 0008 body. This file adds ONE constraint value, ONE
-- helper, and recreates evaluate_challenge with ONE new branch and
-- create_challenge with ONE new line. Nothing else moves: no table, no
-- policy, no existing row.
--
-- WHY. Production on 2026-09-24: the ten most recent challenges ALL had
-- restarted_from set. A Hard challenge whose owner has stopped lives exactly
-- as long as the grace window and then spawns another, at 16:05, 17:05 and
-- 19:05 UTC — noon in New York, Chicago and Los Angeles — forever. 0014
-- taught the FEED that a person can stop. Nothing taught the EVALUATOR; it
-- only knew how to restart them. 0015 did not cause this and is not touched:
-- it made a restart's day 1 judgeable, which is right, and the stalled chain
-- began to run.
--
-- THE RULE. When a challenge is about to restart, and this is the SECOND
-- consecutive run on which the person never completed a single day, no
-- replacement is created. The challenge ends with ended_reason = 'dormant'
-- and waits. When the person comes back they choose to start again; the app
-- does not choose for them.
--
-- THE SIGNAL. "Completed a day" is challenge_days.sealed_at IS NOT NULL on
-- the challenge's OWN rows, written by seal_day() (0011:316) and by the
-- evaluator's met branch (0015:161-163), and by nothing else.
--   NOT best_flame: restart_challenge carries it across (0015:74), so it
--   describes the person, not the run. Row 573dabe6, 2026-09-24: flame 0,
--   best_flame 29, created yesterday, nothing done on it.
--   NOT flame: it does reset on restart (restart_challenge inserts 0,
--   0015:71), but Medium and Soft also reset it to 0 on a miss WITH sealed
--   days behind it (0015:220-223), so flame = 0 does not mean "empty run".
--
-- WHERE THE RULE LIVES. In evaluate_challenge, in the missed branch, before
-- the feed insert and before the call to restart_challenge — beside the
-- other two judgements made there (which penalty, whether the squad hears).
-- restart_challenge keeps its one job, "make the replacement", and its 0015
-- body is untouched, so 0015's own verification still holds. The rule has
-- to be decided BEFORE the feed insert, because a dormant ending posts
-- nothing to the feed and a person can be "active" by 0014's measure (a
-- tick this week) while never having completed a day.
--
-- THE COUNTER IS THE CHAIN. "Second consecutive empty run" needs no new
-- column: this challenge has no sealed day, AND it is a restart, AND the
-- challenge it restarted from has no sealed day. A run with even one sealed
-- day resets the count by being the parent that has one. A fresh challenge
-- (restarted_from null) is run one, empty or not, so a person who never
-- completed anything since signup reaches dormant at the same point as
-- everyone else: at the end of their second run.
--
-- WHAT THIS DOES NOT DO.
--   - It does not touch the rows already on production. The alive restarts
--     reach this rule on their own, the next time they would restart. The
--     ended ones are a true record of what the app did.
--   - It does not post to the feed. 0014 silenced the dormant; this agrees.
--   - It does not touch best_flame on the dormant row. The person's history
--     is theirs — and section 4 makes create_challenge carry it into the
--     challenge they start when they come back, exactly as restart_challenge
--     carries it into a restart.
--
-- Every statement below is independently re-runnable (rule 4). The last
-- statement is the verification grid (rule 5): read it.
-- =============================================================================

-- ---- 1. ended_reason admits 'dormant' ---------------------------------------
-- 0007:72-74 declared the check inline and unnamed, so its name is whatever
-- Postgres chose. Found by definition, not by name, so this is safe on a
-- database where the auto-name differs; then re-added under a fixed name so
-- a second run of this file drops exactly the one it made.
do $$
declare r record;
begin
  for r in
    select conname
      from pg_constraint
     where conrelid = 'public.challenges'::regclass
       and contype  = 'c'
       and pg_get_constraintdef(oid) like '%ended_reason%'
  loop
    execute format('alter table public.challenges drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.challenges
  add constraint challenges_ended_reason_check
  check (ended_reason is null
         or ended_reason in ('missed_day', 'completed', 'restarted', 'dormant'));

-- ---- 2. the signal, as one named question ----------------------------------
create or replace function public.challenge_has_sealed_day(p_challenge uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.challenge_days
     where challenge_id = p_challenge and sealed_at is not null
  );
$$;

-- Takes a challenge id, so a grant would let any user ask whether somebody
-- else's challenge ever sealed a day. Read by the evaluator alone.
revoke all on function public.challenge_has_sealed_day(uuid) from public, anon, authenticated;

-- ---- 3. evaluate_challenge — the 0015 body, plus the dormancy branch --------
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
  -- PHASE 38B-RIDER. The floor protects the CREATION day of a fresh
  -- challenge, which begins at whatever hour someone signed up. A restart's
  -- day 1 begins when the evaluator judged the miss, with the whole grace
  -- window ahead of it, and is judged like any other day.
  v_day  := greatest(c.last_evaluated_day + 1,
                     case when c.restarted_from is null then 2 else 1 end);

  while v_day <= v_last loop
    select * into v_snapshot from public.challenge_days
      where challenge_id = c.id and day = v_day;

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
        -- The miss is judged and written like any other; what differs is
        -- only that nothing is created after it. best_flame stays on the
        -- row untouched.
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

-- ---- 4. create_challenge — the 0008 body, best_flame carried in -------------
-- "best_flame survives dormancy, exactly as it survives a restart." A restart
-- carries it in restart_challenge (0015:74). The challenge a returning person
-- starts by hand goes through create_challenge, which until now started every
-- challenge at 0 — so the number would have survived on the dormant row and
-- vanished from every screen. Seeded from the owner's own rows, which is the
-- only place it can come from, and 0 for a first challenge as before.
-- CREATE OR REPLACE keeps the existing ACL; the signature does not change.
create or replace function public.create_challenge(
  p_base_tier text, p_start_date date, p_timezone text default 'UTC',
  p_duration_days integer default 75)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  new_id uuid;
  v_tz   text := coalesce(nullif(trim(p_timezone), ''), 'UTC');
  v_best integer;
begin
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'unknown timezone: %', v_tz;
  end if;
  if p_duration_days not in (30, 45, 75) then
    raise exception 'duration must be 30, 45 or 75';
  end if;
  -- PHASE 38E: the person's history is theirs.
  select coalesce(max(best_flame), 0) into v_best
    from public.challenges where owner = auth.uid();
  insert into public.challenges
    (owner, base_tier, start_date, timezone, last_evaluated_day, duration_days,
     best_flame)
  values (auth.uid(), p_base_tier, p_start_date, v_tz, 1, p_duration_days,
          v_best)
  returning id into new_id;
  insert into public.tier_history (challenge_id, tier, from_day)
  values (new_id, p_base_tier, 1);
  return new_id;
end;
$$;

-- ---- 5. verification — read this grid --------------------------------------
select * from (
  select 1 as ord, 'ended_reason admits dormant' as item,
         case when exists (select 1 from pg_constraint
                            where conrelid = 'public.challenges'::regclass
                              and pg_get_constraintdef(oid) like '%dormant%')
              then 'yes' else 'NO' end as actual,
         'yes' as expected,
         case when exists (select 1 from pg_constraint
                            where conrelid = 'public.challenges'::regclass
                              and pg_get_constraintdef(oid) like '%dormant%')
              then 'OK' else 'FINDING — the constraint was not replaced' end as verdict
  union all
  select 2, 'exactly one check constraint mentions ended_reason',
         (select count(*) from pg_constraint
           where conrelid = 'public.challenges'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%ended_reason%')::text,
         '1',
         case when (select count(*) from pg_constraint
                     where conrelid = 'public.challenges'::regclass and contype = 'c'
                       and pg_get_constraintdef(oid) like '%ended_reason%') = 1
              then 'OK' else 'FINDING — an old constraint survived and still forbids dormant' end
  union all
  select 3, 'evaluate_challenge decides dormancy from sealed days',
         case when pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure)
                   like '%challenge_has_sealed_day(c.restarted_from)%' then 'yes' else 'NO' end,
         'yes',
         case when pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure)
                   like '%challenge_has_sealed_day(c.restarted_from)%' then 'OK'
              else 'FINDING — the 0015 body is still in force' end
  union all
  select 4, 'evaluate_challenge still carries the 0015 floor and the 0014 feed condition',
         case when pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure)
                   like '%case when c.restarted_from is null then 2 else 1 end%'
               and pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure)
                   like '%owner_is_active(c.owner)%' then 'yes' else 'NO' end,
         'yes',
         case when pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure)
                   like '%case when c.restarted_from is null then 2 else 1 end%'
               and pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure)
                   like '%owner_is_active(c.owner)%' then 'OK'
              else 'FINDING — an earlier phase was overwritten' end
  union all
  select 5, 'create_challenge carries the owner''s best_flame',
         case when pg_get_functiondef('public.create_challenge(text,date,text,integer)'::regprocedure)
                   like '%max(best_flame)%' then 'yes' else 'NO' end,
         'yes',
         case when pg_get_functiondef('public.create_challenge(text,date,text,integer)'::regprocedure)
                   like '%max(best_flame)%' then 'OK' else 'FINDING — the 0008 body is still in force' end
  union all
  select 6, 'the helper and the engine are unreachable from the app',
         case when has_function_privilege('authenticated', 'public.challenge_has_sealed_day(uuid)', 'EXECUTE')
                or has_function_privilege('anon', 'public.challenge_has_sealed_day(uuid)', 'EXECUTE')
                or has_function_privilege('authenticated', 'public.evaluate_challenge(uuid)', 'EXECUTE')
                or has_function_privilege('authenticated', 'public.restart_challenge(uuid,integer,text)', 'EXECUTE')
              then 'a client role holds EXECUTE' else 'no client role holds EXECUTE' end,
         'no client role holds EXECUTE',
         case when has_function_privilege('authenticated', 'public.challenge_has_sealed_day(uuid)', 'EXECUTE')
                or has_function_privilege('anon', 'public.challenge_has_sealed_day(uuid)', 'EXECUTE')
                or has_function_privilege('authenticated', 'public.evaluate_challenge(uuid)', 'EXECUTE')
                or has_function_privilege('authenticated', 'public.restart_challenge(uuid,integer,text)', 'EXECUTE')
              then 'FINDING' else 'OK' end
  union all
  select 7, 'create_challenge still reachable from the app',
         case when has_function_privilege('authenticated', 'public.create_challenge(text,date,text,integer)', 'EXECUTE')
              then 'authenticated can EXECUTE' else 'authenticated cannot' end,
         'authenticated can EXECUTE',
         case when has_function_privilege('authenticated', 'public.create_challenge(text,date,text,integer)', 'EXECUTE')
              then 'OK' else 'FINDING — CREATE OR REPLACE lost the grant' end
  union all
  select 8, 'alive challenges that reach dormancy at their next miss',
         (select count(*)::text
            from public.challenges c
            join public.challenges p on p.id = c.restarted_from
           where c.ended_at is null
             and not public.challenge_has_sealed_day(c.id)
             and not public.challenge_has_sealed_day(p.id)),
         'informational',
         'read it — these end as dormant instead of restarting; nothing is done to them by this file'
  union all
  select 9, 'rows already ended as dormant',
         (select count(*) from public.challenges where ended_reason = 'dormant')::text,
         '0 on first application',
         'informational'
) v order by ord;
