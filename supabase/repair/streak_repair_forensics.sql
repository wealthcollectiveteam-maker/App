-- =============================================================================
-- STREAK REPAIR — FORENSICS. What did the repair actually write?
--
-- READ-ONLY. Paste into the SQL editor and run. It answers one question:
-- which completion rows pre-existed, which the repair wrote, and whether any
-- row it wrote carries a timestamp earlier than the run.
--
-- HOW REPAIR-WRITTEN ROWS ARE IDENTIFIED, and why it is exact rather than a
-- guess: inside a PL/pgSQL block `now()` is the TRANSACTION timestamp, not the
-- statement clock. The whole repair is one DO block, so every row it inserted
-- and every evaluated_at it stamped carry the IDENTICAL instant. Rows written
-- at any other time are, by construction, not from that run.
--
-- Section 2 is the one that settles the backdating question.
-- =============================================================================

with me as (select '5212e3ec-29ab-4bb0-b048-41088920e433'::uuid as uid),
live as (select * from public.challenges
          where owner = (select uid from me) and ended_at is null),
-- The exact signature: the repair INSERTED completions and STAMPED
-- evaluated_at in one transaction, so both carry the identical now(). The
-- evaluator stamps evaluated_at but never inserts a completion; the app
-- inserts completions but never stamps evaluated_at. An instant appearing in
-- BOTH columns therefore belongs to a repair and to nothing else.
-- ("most common evaluated_at" was the first attempt and it was wrong — it
-- picked whichever bulk judgement was largest.)
run as (
  select d.evaluated_at as at
    from public.challenge_days d
   where d.challenge_id = (select id from live)
     and d.evaluated_at is not null
     and exists (select 1 from public.task_completions tc
                  where tc.challenge_id = d.challenge_id
                    and tc.completed_at = d.evaluated_at)
   order by d.evaluated_at desc
   limit 1
),
rows_ as (
  select tc.day, tc.task_key, tc.completed_at,
         (select start_date + (tc.day - 1) from live) as day_local_date,
         tc.completed_at = (select at from run) as written_by_the_repair
    from public.task_completions tc
   where tc.challenge_id = (select id from live)
     and tc.day between 15 and 18
)
select * from (
  -- 1 ------------------------------------------- every row, oldest tick first
  select '1_completions'::text as section,
         (row_number() over (order by completed_at, day, task_key))::int as ord,
         'day ' || day || ' | ' || task_key as item,
         to_char(completed_at, 'YYYY-MM-DD HH24:MI:SS TZ') as completed_at,
         case when written_by_the_repair then 'WRITTEN BY THE REPAIR'
              else 'pre-existing' end as origin
    from rows_

  -- 2 --------------------------------------------- THE BACKDATING QUESTION
  union all
  select '2_backdating_verdict', 1,
         'repair-written rows timestamped BEFORE the run',
         (select count(*)::text from rows_
           where written_by_the_repair
             and completed_at < (select at from run)),
         case when (select count(*) from rows_
                     where written_by_the_repair
                       and completed_at < (select at from run)) = 0
              then 'OK — none. Nothing the repair wrote is backdated.'
              else 'VIOLATION — investigate immediately' end

  -- INFORMATIONAL, NOT A VERDICT. This counts repair-written rows whose
  -- timestamp lands on or before their own calendar day, and that is not
  -- backdating. A repair run on day 18 that carries a row BELONGING to day 18
  -- satisfies this predicate unavoidably — the run instant and the day are the
  -- same date — and says nothing at all about whether work was misdated. The
  -- production census hit exactly that case: day 18's two carried rows are
  -- stamped 2026-09-10 05:34:28 and day 18 IS 2026-09-10, so the old label
  -- called a correct database a VIOLATION.
  --
  -- Backdating means claiming work happened EARLIER than it was recorded.
  -- That is row 1, which returned 0. Row 3 below is the calendar-scoped
  -- version of the same question and is the one with teeth.
  union all
  select '2_backdating_verdict', 2,
         'repair-written rows stamped on or before their own day (expected for a same-day carry)',
         (select count(*)::text from rows_
           where written_by_the_repair
             and completed_at::date <= day_local_date),
         'informational — a same-day repair satisfies this by construction; '
           || 'see row 3 for the real test'

  -- THE PROPERTY ROW 2 WAS REACHING FOR, stated so it can actually fail.
  -- Not "on or before" but STRICTLY BEFORE: a repair-written row dated to a
  -- calendar day earlier than the day it belongs to would be a row dressed up
  -- as history, and that is a genuine violation.
  --
  -- The cast is done in the CHALLENGE's timezone, not the session's.
  -- `completed_at::date` alone resolves in whatever timezone the SQL editor
  -- happens to be set to, so the same rows could pass in UTC and fail in
  -- America/New_York. day_local_date is a date in the challenge's own zone;
  -- this puts both sides in that zone.
  union all
  select '2_backdating_verdict', 3,
         'repair-written rows dated STRICTLY BEFORE their own day',
         (select count(*)::text from rows_
           where written_by_the_repair
             and (completed_at at time zone (select timezone from live))::date
                 < day_local_date),
         case when (select count(*) from rows_
                     where written_by_the_repair
                       and (completed_at at time zone (select timezone from live))::date
                           < day_local_date) = 0
              then 'OK — no row is dressed up as history'
              else 'VIOLATION — investigate immediately' end

  union all
  select '2_backdating_verdict', 4, 'the run instant',
         (select to_char(at, 'YYYY-MM-DD HH24:MI:SS TZ') from run),
         'every repair-written row carries exactly this'

  -- 3 ------------------------------------- pre-existing rows, left untouched
  union all
  select '3_pre_existing_untouched', 1,
         'day 15 rows that pre-date the run',
         (select count(*)::text from rows_
           where day = 15 and not written_by_the_repair),
         'these are the original ticks; the repair must not have moved them'

  union all
  select '3_pre_existing_untouched', 2,
         'day 15 earliest / latest pre-existing tick',
         (select to_char(min(completed_at), 'YYYY-MM-DD HH24:MI TZ') || '  ..  '
                 || to_char(max(completed_at), 'YYYY-MM-DD HH24:MI TZ')
            from rows_ where day = 15 and not written_by_the_repair),
         'expected around 2026-09-08 03:10 UTC per the S1 grid'

  -- 4 ------------------------------------------------ per-day summary
  union all
  select '4_per_day', day,
         'day ' || day || ' (' || day_local_date || ')',
         count(*) filter (where written_by_the_repair) || ' written by repair, '
           || count(*) filter (where not written_by_the_repair) || ' pre-existing',
         'total ' || count(*)
    from rows_ group by day, day_local_date
) v
order by section, ord;
