-- =============================================================================
-- Phase 38B-RIDER (A2): a restarted challenge's day 1 is judged.
--
-- ASSUMED STARTING STATE (rule 6): 0014 is fully applied — evaluate_challenge
-- is the 0014 body (the grace window plus the dormant-feed condition) and
-- restart_challenge is the 0008 body. This file recreates both with one line
-- changed in each. Nothing else moves. It is its own file so that 0014 can
-- ship without it.
--
-- THE DEFECT. evaluate_challenge starts at greatest(cursor + 1, 2): day 1 is
-- never judged, for any challenge. That is right for a FRESH challenge —
-- 0007:630-631, "the creation day, never judged": someone who signs up at
-- 23:50 must not be scored a miss ten minutes later. It is wrong for a
-- RESTART. A restart's day 1 begins at the hour the evaluator judged the
-- miss, with the whole noon grace window ahead of it. It is a real day, and
-- it was never judged: an untouched day 1 was never a miss, and a completed
-- but unsealed day 1 was never paid. Production on 2026-09-19: seventy-five
-- restarted challenges with a day 1 nobody ever judged.
--
-- THE TWO LINES.
--   restart_challenge  last_evaluated_day 1 -> 0 on the replacement row
--   evaluate_challenge the floor is 2 for a fresh challenge and 1 for a
--                      restart: greatest(cursor + 1, case when
--                      restarted_from is null then 2 else 1 end)
--
-- SAFE FOR EXISTING ROWS, proved before this was written (Phase 35 read):
-- every restarted challenge on production holds cursor 1, so the new floor
-- still starts them at day 2 and nothing is judged retroactively. Only
-- restarts created AFTER this file get cursor 0 and a judged day 1. A fresh
-- challenge keeps cursor 1 and the floor of 2 — its creation day stays
-- unjudged.
--
-- A CONSEQUENCE, stated. A dormant Hard account now restarts every day
-- instead of every second day: day 1 closes at noon on day 2 and is judged
-- then. 0014 has already silenced the feed for a dormant account, so the
-- only artefact is one archived row per day instead of one per two.
--
-- Every statement below is independently re-runnable (rule 4). The last
-- statement is the verification grid (rule 5): read it.
-- =============================================================================

-- ---- 1. restart_challenge — the 0008 body, cursor 0 on the replacement ---
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
     -- PHASE 38B-RIDER: BELOW day 1, so the evaluator's floor for a restart
     -- (1, see evaluate_challenge) reaches day 1. A fresh challenge still
     -- starts at 1 in create_challenge, and its floor is still 2.
     0,
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

-- ---- 2. evaluate_challenge — the 0014 body, the floor knows about restarts
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
      if v_squad is not null and public.owner_is_active(c.owner) then
        insert into public.feed_items (squad_id, author, kind, text)
        values (v_squad, c.owner, 'miss', v_text);
      end if;

      update public.challenges set last_evaluated_day = v_day where id = c.id;
      v_judged := v_judged + 1;

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

-- ---- 3. verification — read this grid --------------------------------------
select * from (
  select 1 as ord, 'evaluate_challenge floor depends on restarted_from' as item,
         case when pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure)
                   like '%case when c.restarted_from is null then 2 else 1 end%'
              then 'yes' else 'NO' end as actual,
         'yes' as expected,
         case when pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure)
                   like '%case when c.restarted_from is null then 2 else 1 end%'
              then 'OK' else 'FINDING — the 0014 floor is still in force' end as verdict
  union all
  select 2, 'evaluate_challenge still carries the 0014 feed condition',
         case when pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure)
                   like '%owner_is_active(c.owner)%' then 'yes' else 'NO' end,
         'yes',
         case when pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure)
                   like '%owner_is_active(c.owner)%' then 'OK' else 'FINDING — 0014 was overwritten' end
  union all
  select 3, 'restart_challenge starts the replacement at cursor 0',
         case when pg_get_functiondef('public.restart_challenge(uuid,integer,text)'::regprocedure)
                   like '%PHASE 38B-RIDER: BELOW day 1%' then 'yes' else 'NO' end,
         'yes',
         case when pg_get_functiondef('public.restart_challenge(uuid,integer,text)'::regprocedure)
                   like '%PHASE 38B-RIDER: BELOW day 1%' then 'OK' else 'FINDING — the 0008 body is still in force' end
  union all
  select 4, 'existing restarted rows are untouched',
         (select count(*) from public.challenges where restarted_from is not null and last_evaluated_day = 0)::text
           || ' restarted row(s) at cursor 0 (all pre-existing ones hold 1; only restarts made after this file hold 0)',
         'informational',
         'read it — any live row here was created after this file and is meant to be judged from day 1'
  union all
  select 5, 'both functions still unreachable from the app',
         case when has_function_privilege('authenticated', 'public.evaluate_challenge(uuid)', 'EXECUTE')
                or has_function_privilege('authenticated', 'public.restart_challenge(uuid,integer,text)', 'EXECUTE')
              then 'authenticated can EXECUTE' else 'authenticated cannot' end,
         'authenticated cannot',
         case when has_function_privilege('authenticated', 'public.evaluate_challenge(uuid)', 'EXECUTE')
                or has_function_privilege('authenticated', 'public.restart_challenge(uuid,integer,text)', 'EXECUTE')
              then 'FINDING — CREATE OR REPLACE widened the ACL' else 'OK' end
) v order by ord;
