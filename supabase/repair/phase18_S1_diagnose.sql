-- =============================================================================
-- PHASE 18 / S1 — READ-ONLY DIAGNOSTIC: "I did the work, I forgot to tap"
--
-- Reports one account's day-by-day truth so a human can decide which days, if
-- any, are candidates for an operator repair. It decides NOTHING itself.
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
--   function call. Every function it calls is declared stable or immutable
--   (challenge_day, effective_tier, day_is_met, day_closes_at,
--   earliest_open_day, last_closed_day). Safe to run as many times as you like.
--
-- WHAT TO SEND BACK
--   The whole grid. Section 4 is the one that matters; section 5 is section 4
--   filtered down to the days worth talking about.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS CHANGED FROM phase15_A1_diagnose.sql, AND WHY
--
--   phase15_A1 answered a different question — "an archived challenge and the
--   restart that replaced it, what would a repair have to touch" — and it
--   assumed the archive existed. Four things had to change.
--
--   1. IT NO LONGER ASSUMES A RESTART HAPPENED. A15's `ended` CTE picked the
--      most recent ended attempt even when `restarted_from` was null, so on a
--      still-live challenge it would have reported an archive that has nothing
--      to do with anything. Here every challenge the account owns is reported
--      and section 3 states plainly which case we are in. On Hard,
--      tier_rules.restarts_challenge is TRUE, so a miss archives and restarts;
--      on Medium and Soft it only zeroes the flame. Both shapes are live
--      possibilities and the report must not presuppose either.
--
--   2. EVERY DAY, NOT EVERY ROW. A15 listed the rows in challenge_days. A day
--      nobody ever opened has NO row — and that is precisely the shape of
--      "I did it and forgot to tap", so the interesting days were the ones it
--      could not print. Section 4 generates the day series from the challenge
--      and LEFT JOINs the rows onto it, so a missing day appears as a day.
--
--   3. THE GRACE WINDOW. 0011 made a day completable until noon the following
--      local day. A day still inside that window needs no repair at all — it
--      needs the app opened. A15 predates the question being asked and never
--      reported it. Section 6 answers it on its own.
--
--   4. AN EVIDENCE CLASS PER DAY. The brief is explicit that 6-of-7 ticked and
--      0-of-7 ticked are different cases. Section 4 labels every day and
--      section 5 ranks the candidates by it. The labels describe what the
--      database can see; they are NOT a recommendation, and nothing here
--      proposes a day for repair.
--
--   Dropped from A15 as irrelevant here: section 6 (what a DELETE of the
--   replacement would cascade) and section 7 (day-numbered private rows
--   stranded by a restart). Both existed because A15 was contemplating
--   deleting a challenge row. This repair deletes nothing.
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

-- Every challenge this account owns. Selected straight from the base table in
-- the CTEs below wherever a `public.challenges` composite has to be passed to
-- one of the engine's helpers — day_closes_at() and earliest_open_day() take
-- the row, not the id, and calling the real function is the point: a
-- diagnostic that re-derives the noon boundary itself would be reporting its
-- own arithmetic rather than the engine's.
ch as (
  select c.id, c.owner, c.base_tier, c.start_date, c.timezone, c.duration_days,
         c.flame, c.best_flame, c.ended_at, c.ended_reason, c.ended_on_day,
         c.restarted_from, c.last_evaluated_day, c.missed_notice_day,
         c.created_at,
         public.challenge_day(c)          as day_now,
         public.challenge_local_now(c)    as local_now,
         public.earliest_open_day(c)      as earliest_open_day,
         public.last_closed_day(c)        as last_closed_day,
         -- The highest day this attempt can meaningfully be asked about: for a
         -- live challenge that is today, for an archived one the day it
         -- stopped. Capped at its own length either way.
         greatest(1, least(
           coalesce(c.ended_on_day, public.challenge_day(c)),
           c.duration_days))              as top_day
  from public.challenges c
  where c.owner in (select uid from me)
),

live    as (select * from ch where ended_at is null),
archive as (select * from ch where ended_at is not null),

-- THE GRID. One row per day per challenge, whether or not a challenge_days
-- row exists for it. This is the join that makes "the day I never opened"
-- visible, which is the whole point of the exercise.
grid as (
  select ch.id                     as challenge_id,
         ch.ended_at is null       as is_live,
         g.day,
         (ch.start_date + (g.day - 1))::date          as local_date,
         to_char((ch.start_date + (g.day - 1))::date, 'Dy') as dow,
         public.day_closes_at(c, g.day)               as closes_at,
         -- Openness is a property of the LIVE challenge only. earliest_open_day
         -- keeps advancing off the wall clock for an archived row too, so a
         -- challenge that ended this morning would otherwise report its last
         -- days as still completable — and they are not: every write RPC goes
         -- through my_active_challenge(), which cannot see an archived row.
         ch.ended_at is null
           and g.day >= ch.earliest_open_day
           and g.day <= ch.day_now                    as is_open,
         d.id is not null                             as has_snapshot,
         d.outcome,
         d.sealed_at,
         d.evaluated_at,
         coalesce(jsonb_array_length(d.task_snapshot), 0) as tasks_total,
         coalesce((
           select count(*) from public.task_completions tc
            where tc.challenge_id = ch.id
              and tc.day = g.day
              and exists (select 1 from jsonb_array_elements(d.task_snapshot) t
                           where t->>'key' = tc.task_key)), 0) as tasks_done,
         -- What the day is still missing, by name, so "one forgotten task" is
         -- readable as which one.
         (select coalesce(jsonb_agg(t->>'key' order by t->>'key'), '[]'::jsonb)
            from jsonb_array_elements(coalesce(d.task_snapshot, '[]'::jsonb)) t
           where not exists (select 1 from public.task_completions tc
                              where tc.challenge_id = ch.id
                                and tc.day = g.day
                                and tc.task_key = t->>'key'))   as unticked,
         -- Completion rows whose key is NOT in the snapshot. day_is_met()
         -- ignores these; if any exist the day looks fuller than it is.
         (select coalesce(jsonb_agg(tc.task_key order by tc.task_key), '[]'::jsonb)
            from public.task_completions tc
           where tc.challenge_id = ch.id
             and tc.day = g.day
             and not exists (select 1 from jsonb_array_elements(
                                          coalesce(d.task_snapshot, '[]'::jsonb)) t
                              where t->>'key' = tc.task_key))   as off_snapshot,
         (select min(tc.completed_at) from public.task_completions tc
           where tc.challenge_id = ch.id and tc.day = g.day)    as first_tick,
         (select max(tc.completed_at) from public.task_completions tc
           where tc.challenge_id = ch.id and tc.day = g.day)    as last_tick,
         public.effective_tier(ch.id, g.day)                    as tier_that_day,
         public.day_is_met(ch.id, g.day)                        as engine_says_met
  from ch
  join public.challenges c on c.id = ch.id
  cross join lateral generate_series(1, ch.top_day) as g(day)
  left join public.challenge_days d
         on d.challenge_id = ch.id and d.day = g.day
),

-- The evidence label. Describes what is on the ground; recommends nothing.
--
-- The order of the branches is the order of certainty, strongest first. Note
-- that `already_met` is checked before `open_now`: a finished day inside the
-- window is finished, and calling it "go and open the app" would be wrong.
classified as (
  select g.*,
         case
           when g.outcome = 'met'                     then 'already_met'
           when g.engine_says_met and g.outcome is null then 'met_unjudged'
           when g.is_open                             then 'open_now'
           when not g.has_snapshot                    then 'never_opened'
           when g.tasks_total = 0                     then 'empty_snapshot'
           when g.tasks_done = 0                      then 'zero_ticks'
           when g.tasks_done < g.tasks_total          then 'partial'
           else 'other'
         end as evidence,
         case
           when g.tasks_total = 0 then null
           else round(100.0 * g.tasks_done / g.tasks_total)
         end as pct_done
  from grid g
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

  -- 2 ---------------------------------------------- the headline answers
  -- The four questions the brief asks first, on four lines, so they do not
  -- have to be reconstructed from section 3.
  union all
  select '2_headline', v.ord, v.item, v.detail
  from (values
    (1, 'is the challenge still LIVE?',
        jsonb_build_object(
          'live_challenges',   (select count(*) from live),
          'ended_challenges',  (select count(*) from archive),
          'answer', case
            when (select count(*) from live) = 0 and (select count(*) from archive) = 0
              then 'NO CHALLENGE AT ALL for this account — check the email above'
            when (select count(*) from live) = 0
              then 'NO — every challenge this account owns has ended'
            when (select count(*) from archive) = 0
              then 'YES — live, and nothing has ever been archived'
            else 'YES — live, and there is also an archived attempt (see 3)'
          end)),
    (2, 'the miss: did it END a challenge?',
        (select jsonb_build_object(
                  'ended_challenge_id', a.id,
                  'ended_at',           a.ended_at,
                  'ended_reason',       a.ended_reason,
                  'ended_on_day',       a.ended_on_day,
                  'replaced_by',        (select l.id from live l
                                          where l.restarted_from = a.id),
                  'note', 'ended_reason = missed_day is the restart the Hard '
                          || 'rules perform; completed is the challenge '
                          || 'finishing normally')
           from archive a order by a.ended_at desc limit 1)),
    (3, 'current day / flame / best flame',
        (select jsonb_build_object(
                  'challenge_id',       l.id,
                  'day_now',            l.day_now,
                  'duration_days',      l.duration_days,
                  'flame',              l.flame,
                  'best_flame',         l.best_flame,
                  'last_evaluated_day', l.last_evaluated_day,
                  'missed_notice_day',  l.missed_notice_day,
                  'local_now',          l.local_now,
                  'timezone',           l.timezone)
           from live l limit 1)),
    (4, 'the grace window right now',
        (select jsonb_build_object(
                  'earliest_open_day', l.earliest_open_day,
                  'day_now',           l.day_now,
                  'open_days',         case when l.earliest_open_day = l.day_now
                                            then l.day_now::text
                                            else l.earliest_open_day || ' and ' || l.day_now
                                       end,
                  'last_closed_day',   l.last_closed_day,
                  'deadline_hour',     public.grace_deadline_hour(),
                  'note', 'a day at or above earliest_open_day needs no repair '
                          || '— it can still be completed in the app')
           from live l limit 1))
  ) as v(ord, item, detail)

  -- 3 ------------------------------------ every challenge this account owns
  union all
  select '3_challenges', (row_number() over (order by created_at))::int,
         case when ended_at is null then 'LIVE' else 'ended' end
           || ' | ' || base_tier || ' | ' || duration_days || 'd'
           || ' | reaches day ' || top_day,
         jsonb_build_object(
           'id',                  id,
           'is_live',             (ended_at is null),
           'base_tier',           base_tier,
           'duration_days',       duration_days,
           'start_date',          start_date,
           'timezone',            timezone,
           'local_now',           local_now,
           'day_now',             day_now,
           'top_day',             top_day,
           'ended_at',            ended_at,
           'ended_reason',        ended_reason,
           'ended_on_day',        ended_on_day,
           'restarted_from',      restarted_from,
           'last_evaluated_day',  last_evaluated_day,
           'missed_notice_day',   missed_notice_day,
           'flame',               flame,
           'best_flame',          best_flame,
           'created_at',          created_at)
  from ch

  -- 4 ---------------------------------- THE GRID: every day, one row each
  -- Read this one. `item` is built to be scannable down the column:
  --   day 12 | Wed | 2026-09-02 | 6/7 | missed | sealed- | partial
  union all
  select '4_every_day',
         -- Archived days sort before live days, then by day number, by giving
         -- the archive a negative block. The SQL editor sorts on (section,ord)
         -- and there is only ever one archive in play.
         case when c.is_live then c.day else c.day - 10000 end,
         'day ' || lpad(c.day::text, 2)
           || ' | ' || c.dow
           || ' | ' || c.local_date
           || ' | ' || c.tasks_done || '/' || c.tasks_total
           || ' | ' || coalesce(c.outcome, 'unjudged')
           || ' | ' || case when c.sealed_at is null then 'unsealed' else 'sealed' end
           || ' | ' || c.evidence
           || case when c.is_live then '' else '  [ARCHIVED CHALLENGE]' end,
         jsonb_build_object(
           'challenge_id',   c.challenge_id,
           'is_live',        c.is_live,
           'day',            c.day,
           'local_date',     c.local_date,
           'outcome',        c.outcome,
           'sealed_at',      c.sealed_at,
           'evaluated_at',   c.evaluated_at,
           'has_snapshot',   c.has_snapshot,
           'tasks_done',     c.tasks_done,
           'tasks_total',    c.tasks_total,
           'pct_done',       c.pct_done,
           'unticked',       c.unticked,
           'off_snapshot',   c.off_snapshot,
           'first_tick',     c.first_tick,
           'last_tick',      c.last_tick,
           'is_open',        c.is_open,
           'closes_at',      c.closes_at,
           'tier_that_day',  c.tier_that_day,
           'engine_says_met', c.engine_says_met,
           'evidence',       c.evidence)
  from classified c

  -- 5 ------------------------------------------------------- the candidates
  -- Every day that is NOT already met and is NOT still open. These are the
  -- only days a repair could apply to. Ordered strongest evidence first.
  --
  -- THIS IS NOT A RECOMMENDATION. It is section 4 with the days that need no
  -- decision removed. Which of these you actually did is a thing only you
  -- know, and S2 is where that gets settled.
  union all
  select '5_candidates',
         (row_number() over (order by
            case c.evidence when 'partial'      then 1
                            when 'met_unjudged' then 2
                            when 'zero_ticks'   then 3
                            when 'never_opened' then 4
                            else 5 end,
            c.tasks_done desc, c.day))::int,
         'day ' || c.day || ' | ' || c.local_date
           || ' | ' || c.tasks_done || '/' || c.tasks_total
           || ' | ' || c.evidence
           || case when c.evidence = 'partial'
                   then ' — ' || (c.tasks_total - c.tasks_done) || ' left: '
                        || (select string_agg(x, ', ')
                              from jsonb_array_elements_text(c.unticked) x)
                   else '' end,
         jsonb_build_object(
           'challenge_id', c.challenge_id,
           'is_live',      c.is_live,
           'day',          c.day,
           'local_date',   c.local_date,
           'evidence',     c.evidence,
           'tasks_done',   c.tasks_done,
           'tasks_total',  c.tasks_total,
           'unticked',     c.unticked,
           'first_tick',   c.first_tick,
           'last_tick',    c.last_tick,
           'outcome',      c.outcome,
           'what_it_means', case c.evidence
             when 'partial' then
               'Some tasks WERE ticked that day, so the app was open and the '
               || 'day was under way. The strongest evidence available.'
             when 'met_unjudged' then
               'Every snapshot task IS ticked but the day carries no outcome. '
               || 'The evaluator has not judged it yet — this may need no '
               || 'repair at all, only a run of evaluate_challenge().'
             when 'zero_ticks' then
               'The day was frozen — the app was opened — but nothing was '
               || 'ever ticked. Weak evidence either way.'
             when 'never_opened' then
               'No challenge_days row at all: the app was never opened on this '
               || 'day. The database has NOTHING to corroborate a claim about '
               || 'it. Weakest case.'
             else 'See section 4.' end)
  from classified c
  where c.evidence not in ('already_met', 'open_now', 'empty_snapshot')

  -- 6 ------------------------------ days that need NO repair, only the app
  -- Asked for explicitly: a day still inside the grace window is finishable
  -- right now and must not be repaired.
  union all
  select '6_still_open_no_repair_needed', c.day,
         'day ' || c.day || ' | ' || c.local_date
           || ' | ' || c.tasks_done || '/' || c.tasks_total
           || ' | OPEN until ' || to_char(c.closes_at, 'YYYY-MM-DD HH24:MI TZ')
           || ' — finish it in the app, do not repair it',
         jsonb_build_object(
           'day',         c.day,
           'local_date',  c.local_date,
           'closes_at',   c.closes_at,
           'tasks_done',  c.tasks_done,
           'tasks_total', c.tasks_total,
           'unticked',    c.unticked)
  from classified c
  where c.is_open and coalesce(c.outcome, '') <> 'met'

  -- 7 -------------------------------- what the squad was told about a miss
  union all
  select '7_miss_feed_items',
         (row_number() over (order by f.created_at))::int,
         f.kind || ' | ' || to_char(f.created_at, 'YYYY-MM-DD HH24:MI')
           || ' | ' || f.text,
         jsonb_build_object('id', f.id, 'squad_id', f.squad_id, 'kind', f.kind,
                            'text', f.text, 'created_at', f.created_at,
                            'note', 'a repair REWRITES these, never deletes them')
  from public.feed_items f
  where f.author in (select uid from me)
    and f.kind = 'miss'

  -- 8 ------------- config that decides what a repaired day would consist of
  -- A repair inserts completion rows for the SNAPSHOT's task keys. These are
  -- the rows that determined those snapshots, and a surprise here changes
  -- what "all tasks" means on a given day.
  union all
  select '8_config', (row_number() over (order by c.kind, c.sort_a, c.sort_b))::int,
         c.kind, c.detail
  from (
    select 'tier_rules'::text as kind, tr.tier as sort_a, ''::text as sort_b,
           jsonb_build_object('tier', tr.tier,
                              'restarts_challenge', tr.restarts_challenge,
                              'resets_streak', tr.resets_streak,
                              'note', 'hard restarts AND resets; medium/soft reset only') as detail
      from public.tier_rules tr
    union all
    select 'tier_history', th.challenge_id::text, lpad(th.from_day::text, 4, '0'),
           jsonb_build_object('challenge_id', th.challenge_id, 'tier', th.tier,
                              'from_day', th.from_day, 'created_at', th.created_at)
      from public.tier_history th where th.challenge_id in (select id from ch)
    union all
    select 'custom_tasks', ct.challenge_id::text, ct.created_at::text,
           jsonb_build_object('challenge_id', ct.challenge_id, 'id', ct.id,
                              'name', ct.name, 'active_from_day', ct.active_from_day,
                              'removed_from_day', ct.removed_from_day,
                              'timer_minutes', ct.timer_minutes)
      from public.custom_tasks ct where ct.challenge_id in (select id from ch)
    union all
    select 'target_overrides', o.challenge_id::text, o.task_key,
           jsonb_build_object('challenge_id', o.challenge_id, 'task_key', o.task_key,
                              'value', o.value, 'effective_from_day', o.effective_from_day)
      from public.target_overrides o where o.challenge_id in (select id from ch)
    union all
    select 'squad_membership', sm.squad_id::text, sm.joined_at::text,
           jsonb_build_object('squad_id', sm.squad_id, 'joined_at', sm.joined_at)
      from public.squad_members sm where sm.user_id in (select uid from me)
  ) c

  -- 9 --------------------------------- arithmetic a repair has to reproduce
  -- The flame is a COUNT of met days, not a stored opinion (seal_day and the
  -- evaluator both do flame + 1 per met day). So it is checkable: if the
  -- stored flame does not equal the trailing run of met days, something has
  -- already drifted and that is worth knowing BEFORE a repair adds to it.
  union all
  select '9_flame_arithmetic', v.ord, v.item, v.detail
  from (
    select 1 as ord, 'stored flame vs met days on the live challenge'::text as item,
           jsonb_build_object(
             'stored_flame',      (select flame from live limit 1),
             'stored_best_flame', (select best_flame from live limit 1),
             'met_days_total',    (select count(*) from classified
                                    where is_live and outcome = 'met'),
             'sealed_days_total', (select count(*) from classified
                                    where is_live and sealed_at is not null),
             'trailing_met_run',  (
               -- Days met in an unbroken run back from the last judged day.
               select count(*) from (
                 select c.day, c.outcome,
                        sum(case when coalesce(c.outcome,'x') <> 'met' then 1 else 0 end)
                          over (order by c.day desc rows between unbounded preceding and current row) as breaks
                 from classified c
                 where c.is_live and c.day <= (select last_evaluated_day from live limit 1)
               ) t where t.breaks = 0),
             'note', 'stored_flame should equal trailing_met_run. A mismatch is '
                     || 'a pre-existing drift, not something a repair caused.') as detail
    union all
    select 2, 'days the evaluator has not reached yet',
           jsonb_build_object(
             'last_evaluated_day', (select last_evaluated_day from live limit 1),
             'last_closed_day',    (select last_closed_day from live limit 1),
             'unjudged_closed_days', (select count(*) from classified
                                       where is_live and outcome is null
                                         and not is_open),
             'note', 'if this is non-zero the evaluator is behind; running it '
                     || 'may resolve some candidates without any repair')
  ) v
)

select section, ord, item, detail
from report
order by section, ord;
