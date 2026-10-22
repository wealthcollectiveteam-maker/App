-- =============================================================================
-- Phase 38B: a miss reaches the squad feed ONLY while that person is active.
--
-- ASSUMED STARTING STATE (rule 6): 0011 is fully applied — evaluate_challenge
-- is the 0011 body (grace window, last_closed_day upper bound), tier_rules
-- exists, and 0002's allow-list grants are in force. This file adds ONE
-- constant function and recreates evaluate_challenge with ONE new condition.
-- Nothing else moves: no table, no column, no policy, no row.
--
-- WHY. 0011:490-493 posted a miss item whenever the author was in a squad,
-- with no regard to whether they had touched the app since August. Measured
-- on 2026-09-19: 122 miss items in a month, 24 consecutive days for one
-- person, every one of them about an account that had stopped. The app has
-- never once reminded anyone to do the thing, and told their friends every
-- single time they didn't. The feed is for people who are running it.
--
-- THE RULE. A miss is still judged, still written as outcome 'missed', still
-- restarts (Hard) or resets the streak (Medium, Soft). What changes is one
-- line: the feed item is inserted only if the author has at least one
-- task_completions row — on ANY of their challenges, a restart makes a new
-- one — within feed_activity_window() of now. Otherwise the outcome is
-- written and the feed is skipped.
--
-- WHERE THE WINDOW LIVES. public.feed_activity_window(), an immutable
-- function returning an interval, next to grace_deadline_hour() in spirit
-- and in shape: one named constant that the evaluator reads and a test can
-- assert, never a bare 7 inside a CASE. Changing the window is a one-line
-- migration that replaces this function; the evaluator does not move.
--
-- WHAT THIS DOES NOT DO. It does not delete the 122 rows already posted.
-- They happened; a client decision about showing them is another phase.
--
-- Every statement below is independently re-runnable (rule 4). The last
-- statement is the verification grid (rule 5): read it.
-- =============================================================================

-- ---- 1. the window, as a named constant ------------------------------------
create or replace function public.feed_activity_window()
returns interval
language sql immutable
as $$ select interval '7 days' $$;

-- Read by the evaluator (SECURITY DEFINER) only. No client role needs it, and
-- setup_local's default privileges would otherwise hand it to all three.
revoke all on function public.feed_activity_window() from public, anon, authenticated;

-- ---- 2. "active": a completion inside the window, on any of their challenges
create or replace function public.owner_is_active(p_owner uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.task_completions tc
      join public.challenges ch on ch.id = tc.challenge_id
     where ch.owner = p_owner
       and tc.completed_at >= now() - public.feed_activity_window()
  );
$$;

revoke all on function public.owner_is_active(uuid) from public, anon, authenticated;

-- ---- 3. the evaluator — the 0011 body with one condition added ------------
-- Everything below is 0011:408-525 verbatim except the block marked
-- PHASE 38B. The retroactive seal, the tier_rules lookup, the cursor moving
-- inside the same transaction as the penalty, the restart, the finish line:
-- unchanged.
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
  v_day  := greatest(c.last_evaluated_day + 1, 2);

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

-- ---- 4. verification — read this grid --------------------------------------
select * from (
  select 1 as ord, 'feed_activity_window()' as item,
         public.feed_activity_window()::text as actual,
         '7 days' as expected,
         case when public.feed_activity_window() = interval '7 days' then 'OK' else 'FINDING' end as verdict
  union all
  select 2, 'evaluate_challenge reads owner_is_active',
         case when pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%owner_is_active(c.owner)%'
              then 'yes' else 'NO' end,
         'yes',
         case when pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%owner_is_active(c.owner)%'
              then 'OK' else 'FINDING — the 0011 body is still in force' end
  union all
  select 3, 'clients cannot call the window or the activity test',
         case when has_function_privilege('authenticated', 'public.feed_activity_window()', 'EXECUTE')
                or has_function_privilege('anon', 'public.feed_activity_window()', 'EXECUTE')
                or has_function_privilege('authenticated', 'public.owner_is_active(uuid)', 'EXECUTE')
                or has_function_privilege('anon', 'public.owner_is_active(uuid)', 'EXECUTE')
              then 'a client role holds EXECUTE' else 'no client role holds EXECUTE' end,
         'no client role holds EXECUTE',
         case when has_function_privilege('authenticated', 'public.feed_activity_window()', 'EXECUTE')
                or has_function_privilege('anon', 'public.feed_activity_window()', 'EXECUTE')
                or has_function_privilege('authenticated', 'public.owner_is_active(uuid)', 'EXECUTE')
                or has_function_privilege('anon', 'public.owner_is_active(uuid)', 'EXECUTE')
              then 'FINDING' else 'OK' end
  union all
  select 4, 'evaluate_challenge still unreachable from the app',
         case when has_function_privilege('authenticated', 'public.evaluate_challenge(uuid)', 'EXECUTE')
              then 'authenticated can EXECUTE' else 'authenticated cannot' end,
         'authenticated cannot',
         case when has_function_privilege('authenticated', 'public.evaluate_challenge(uuid)', 'EXECUTE')
              then 'FINDING — CREATE OR REPLACE widened the ACL' else 'OK' end
) v order by ord;
