-- =============================================================================
-- PHASE 15 / A1 — READ-ONLY DIAGNOSTIC
--
-- Reports the real state of one account's archived challenge, the replacement
-- the restart created, and everything the repair in A2 would have to touch.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> new query -> paste this whole file ->
--   Run. Edit the ONE line marked EDIT ME below first.
--
-- WHY IT IS ONE STATEMENT
--   The SQL editor shows the result of the LAST statement only. Everything is
--   folded into a single SELECT so one "copy as markdown" carries the whole
--   report back.
--
-- IT WRITES NOTHING. No INSERT, UPDATE, DELETE, no DO block, no volatile
--   function call. Safe to run as many times as you like.
--
-- WHAT TO SEND BACK
--   The whole grid. If a section is empty, say so — an empty section is itself
--   a finding (section 5 empty would mean the miss is not where we think).
-- =============================================================================

-- If you are not sure which address the account uses, run this on its own
-- first (it is also read-only):
--
--   select u.id, u.email, u.created_at
--   from auth.users u
--   join public.challenges c on c.owner = u.id
--   group by u.id, u.email, u.created_at
--   order by u.created_at;

with
-- ---------------------------------------------------------------- EDIT ME --
me as (
  select u.id as uid, u.email
  from auth.users u
    where u.id = '5212e3ec-29ab-4bb0-b048-41088920e433'::uuid
  -- Keyed on the account UUID, the way streak_repair.sql's P_OWNER is. The
  -- email is a personal identifier and CLAUDE.md keeps it out of the repo;
  -- the grid still echoes it back at runtime so you can confirm the account.
),
-- ---------------------------------------------------------------------------

-- Every challenge this account owns, with the current day computed in the
-- CHALLENGE's own timezone — the same arithmetic challenge_day() uses.
ch as (
  select c.id, c.base_tier, c.start_date, c.timezone, c.duration_days,
         c.flame, c.best_flame, c.ended_at, c.ended_reason, c.ended_on_day,
         c.restarted_from, c.last_evaluated_day, c.missed_notice_day,
         c.duration_previous, c.duration_changed_at, c.created_at,
         ((now() at time zone c.timezone)::date - c.start_date) + 1 as day_now,
         (now() at time zone c.timezone)                            as local_now
  from public.challenges c
  where c.owner in (select uid from me)
),

-- At most one row: the partial unique index allows a single live challenge.
repl as (select * from ch where ended_at is null),

-- The archive we care about: the one the live challenge says it replaced.
-- Falls back to the most recently ended attempt if restarted_from is null,
-- which would itself be worth knowing.
ended as (
  select * from ch
  where ended_at is not null
    and (id = (select restarted_from from repl limit 1)
         or (select restarted_from from repl limit 1) is null)
  order by ended_at desc
  limit 1
),

scope as (select id from ended union all select id from repl),

-- Per-day truth: what the snapshot asked for, what was actually ticked, and
-- exactly which keys are outstanding.
day_stats as (
  select d.challenge_id,
         d.day,
         d.sealed_at,
         d.evaluated_at,
         d.outcome,
         jsonb_array_length(d.task_snapshot) as tasks_total,
         (select count(*)
            from public.task_completions tc
           where tc.challenge_id = d.challenge_id
             and tc.day = d.day
             and exists (select 1 from jsonb_array_elements(d.task_snapshot) t
                          where t->>'key' = tc.task_key)) as tasks_done,
         (select coalesce(jsonb_agg(jsonb_build_object(
                    'key', t->>'key', 'name', t->>'shortName') order by t->>'key'),
                  '[]'::jsonb)
            from jsonb_array_elements(d.task_snapshot) t
           where not exists (select 1 from public.task_completions tc
                              where tc.challenge_id = d.challenge_id
                                and tc.day = d.day
                                and tc.task_key = t->>'key')) as unticked,
         -- Completion rows whose key is NOT in the snapshot. day_is_met()
         -- ignores these; if any exist the day looks fuller than it is.
         (select coalesce(jsonb_agg(tc.task_key order by tc.task_key), '[]'::jsonb)
            from public.task_completions tc
           where tc.challenge_id = d.challenge_id
             and tc.day = d.day
             and not exists (select 1 from jsonb_array_elements(d.task_snapshot) t
                              where t->>'key' = tc.task_key)) as off_snapshot
  from public.challenge_days d
  where d.challenge_id in (select id from scope)
),

-- Completion rows on a day that has no frozen challenge_days row at all.
orphan_days as (
  select tc.challenge_id, tc.day, count(*) as n
  from public.task_completions tc
  where tc.challenge_id in (select id from scope)
    and not exists (select 1 from public.challenge_days d
                     where d.challenge_id = tc.challenge_id and d.day = tc.day)
  group by tc.challenge_id, tc.day
),

report as (

  -- 1 -------------------------------------------------------------- account
  select '1_account'::text as section, 0 as ord, 'auth.users match'::text as item,
         jsonb_build_object(
           'matches',    (select count(*) from me),
           'user_id',    (select string_agg(uid::text, ', ') from me),
           'email',      (select string_agg(email, ', ') from me),
           'server_now', now(),
           'note',       'matches must be exactly 1'
         ) as detail

  -- 2 ------------------------------------ every challenge this account owns
  union all
  select '2_challenges', (row_number() over (order by created_at))::int,
         case when ended_at is null then 'ACTIVE' else 'ended' end
           || ' | ' || base_tier || ' | ' || duration_days || 'd'
           || ' | day ' || day_now,
         jsonb_build_object(
           'id',                  id,
           'is_the_archive',      (id in (select id from ended)),
           'is_the_replacement',  (ended_at is null),
           'base_tier',           base_tier,
           'duration_days',       duration_days,
           'start_date',          start_date,
           'timezone',            timezone,
           'local_now',           local_now,
           'day_now',             day_now,
           'ended_at',            ended_at,
           'ended_reason',        ended_reason,
           'ended_on_day',        ended_on_day,
           'restarted_from',      restarted_from,
           'last_evaluated_day',  last_evaluated_day,
           'missed_notice_day',   missed_notice_day,
           'flame',               flame,
           'best_flame',          best_flame,
           'duration_previous',   duration_previous,
           'duration_changed_at', duration_changed_at,
           'created_at',          created_at)
  from ch

  -- 3 ----------------------------- every day on the ARCHIVED challenge
  union all
  select '3_days_on_the_archive', s.day,
         'day ' || s.day || ' | ' || s.tasks_done || '/' || s.tasks_total
           || ' | ' || coalesce(s.outcome, 'unjudged')
           || case when s.sealed_at is null then ' | unsealed' else ' | sealed' end,
         jsonb_build_object(
           'day',          s.day,
           'tasks_done',   s.tasks_done,
           'tasks_total',  s.tasks_total,
           'outcome',      s.outcome,
           'sealed_at',    s.sealed_at,
           'evaluated_at', s.evaluated_at,
           'unticked',     s.unticked,
           'off_snapshot', s.off_snapshot)
  from day_stats s
  where s.challenge_id in (select id from ended)

  -- 4 -------------------------- every day on the REPLACEMENT challenge
  union all
  select '4_days_on_the_replacement', s.day,
         'day ' || s.day || ' | ' || s.tasks_done || '/' || s.tasks_total
           || ' | ' || coalesce(s.outcome, 'unjudged')
           || case when s.sealed_at is null then ' | unsealed' else ' | sealed' end,
         jsonb_build_object(
           'day',          s.day,
           'tasks_done',   s.tasks_done,
           'tasks_total',  s.tasks_total,
           'outcome',      s.outcome,
           'sealed_at',    s.sealed_at,
           'evaluated_at', s.evaluated_at,
           'unticked',     s.unticked,
           'off_snapshot', s.off_snapshot)
  from day_stats s
  where s.challenge_id in (select id from repl)

  -- 5 --------------------- the day(s) judged a miss, and what was left unticked
  union all
  select '5_the_miss', s.day,
         'day ' || s.day || ' judged ' || coalesce(s.outcome, 'unjudged')
           || ' | ' || (s.tasks_total - s.tasks_done) || ' task(s) outstanding',
         jsonb_build_object(
           'challenge_id',     s.challenge_id,
           'day',              s.day,
           'outcome',          s.outcome,
           'evaluated_at',     s.evaluated_at,
           'sealed_at',        s.sealed_at,
           'tasks_total',      s.tasks_total,
           'tasks_done',       s.tasks_done,
           'unticked',         s.unticked,
           'tier_on_that_day', public.effective_tier(s.challenge_id, s.day))
  from day_stats s
  where s.challenge_id in (select id from ended)
    and (s.outcome = 'missed' or s.tasks_done < s.tasks_total)

  -- 6 ------------------- what a DELETE of the replacement would take with it
  union all
  select '6_rows_hanging_off_the_replacement', v.ord, v.tbl,
         jsonb_build_object('rows', v.n, 'cascade', 'deleted with the challenge row')
  from (values
    (1, 'challenge_days',   (select count(*) from public.challenge_days   where challenge_id in (select id from repl))),
    (2, 'task_completions', (select count(*) from public.task_completions where challenge_id in (select id from repl))),
    (3, 'tier_history',     (select count(*) from public.tier_history     where challenge_id in (select id from repl))),
    (4, 'custom_tasks',     (select count(*) from public.custom_tasks     where challenge_id in (select id from repl))),
    (5, 'target_overrides', (select count(*) from public.target_overrides where challenge_id in (select id from repl))),
    (6, 'workout_logs',     (select count(*) from public.workout_logs     where challenge_id in (select id from repl)))
  ) as v(ord, tbl, n)

  -- 7 --- day-numbered PRIVATE rows written since the archive. journal_entries,
  --       meals and milestones are keyed on (owner, day) and know nothing about
  --       which challenge they belong to, so the restart silently re-pointed
  --       them at day 1. These are the rows a naive repair strands or destroys.
  union all
  select '7_day_numbered_private_rows_since_the_restart',
         (row_number() over (order by p.kind, p.day))::int,
         p.kind || ' | day ' || p.day || ' | ' || p.n || ' row(s)',
         jsonb_build_object('table', p.kind, 'day', p.day, 'rows', p.n,
                            'first', p.first_at, 'last', p.last_at)
  from (
    select 'journal_entries'::text as kind, j.day, count(*) as n,
           min(j.created_at) as first_at, max(j.created_at) as last_at
      from public.journal_entries j
     where j.owner in (select uid from me)
       and j.created_at >= (select ended_at from ended)
     group by j.day
    union all
    select 'meals', m.day, count(*), min(m.created_at), max(m.created_at)
      from public.meals m
     where m.owner in (select uid from me)
       and m.created_at >= (select ended_at from ended)
     group by m.day
    union all
    select 'milestones', ms.hit_on_day, count(*), min(ms.created_at), max(ms.created_at)
      from public.milestones ms
     where ms.owner in (select uid from me)
       and ms.hit_on_day is not null
       and ms.created_at >= (select ended_at from ended)
     group by ms.hit_on_day
    union all
    select 'workout_logs', w.day, count(*), min(w.logged_at), max(w.logged_at)
      from public.workout_logs w
     where w.challenge_id in (select id from repl)
     group by w.day
  ) p

  -- 8 ---------------------------------- what the squad was told, and when
  union all
  select '8_squad_feed_since_the_miss',
         (row_number() over (order by f.created_at))::int,
         f.kind || ' | ' || to_char(f.created_at, 'YYYY-MM-DD HH24:MI'),
         jsonb_build_object('id', f.id, 'squad_id', f.squad_id, 'kind', f.kind,
                            'text', f.text, 'created_at', f.created_at)
  from public.feed_items f
  where f.author in (select uid from me)
    and f.created_at >= (select ended_at from ended) - interval '2 days'

  -- 9 ------------------------------------------- config on both challenges
  union all
  select '9_config', (row_number() over (order by c.kind, c.sort_a, c.sort_b))::int,
         c.kind, c.detail
  from (
    select 'tier_history'::text as kind, th.challenge_id::text as sort_a,
           th.from_day::text as sort_b,
           jsonb_build_object('challenge_id', th.challenge_id, 'tier', th.tier,
                              'from_day', th.from_day, 'created_at', th.created_at) as detail
      from public.tier_history th where th.challenge_id in (select id from scope)
    union all
    select 'custom_tasks', ct.challenge_id::text, ct.created_at::text,
           jsonb_build_object('challenge_id', ct.challenge_id, 'id', ct.id,
                              'name', ct.name, 'active_from_day', ct.active_from_day,
                              'removed_from_day', ct.removed_from_day,
                              'timer_minutes', ct.timer_minutes)
      from public.custom_tasks ct where ct.challenge_id in (select id from scope)
    union all
    select 'target_overrides', o.challenge_id::text, o.task_key,
           jsonb_build_object('challenge_id', o.challenge_id, 'task_key', o.task_key,
                              'value', o.value, 'effective_from_day', o.effective_from_day)
      from public.target_overrides o where o.challenge_id in (select id from scope)
    union all
    select 'squad_membership', sm.squad_id::text, sm.joined_at::text,
           jsonb_build_object('squad_id', sm.squad_id, 'joined_at', sm.joined_at)
      from public.squad_members sm where sm.user_id in (select uid from me)
  ) c

  -- 10 ------------------------- completions with no frozen day behind them
  union all
  select '10_completions_with_no_day_row', o.day,
         'challenge ' || left(o.challenge_id::text, 8) || ' | day ' || o.day,
         jsonb_build_object('challenge_id', o.challenge_id, 'day', o.day, 'rows', o.n)
  from orphan_days o
)

select section, ord, item, detail
from report
order by section, ord;
