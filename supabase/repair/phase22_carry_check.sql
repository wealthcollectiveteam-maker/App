-- =============================================================================
-- PHASE 22 — THE CARRY-OVER, CHECKED DAY BY DAY AND KEY BY KEY
--
-- Run AFTER streak_repair.sql. Takes one psql variable:  -v uid=<owner uuid>
--
-- The repair's own verification grid proves aggregate invariants: no completion
-- names a key outside its snapshot, no day is scored met that is not met. This
-- file asks the narrower question the two-day carry raises, and asks it per
-- day rather than in total:
--
--   did replacement day N land on archive day N + offset, and did it land as
--   the ARCHIVE's OWN KEYS rather than the replacement's?
--
-- That distinction is invisible to a count. The replacement's custom keys are
-- 'custom-' || <the replacement's uuids>; the archive's are 'custom-' || <the
-- archive's>. A carry that copied keys verbatim would produce the right NUMBER
-- of completions on the right day and a day that scores as missed, because
-- day_is_met() ignores a completion naming a key the snapshot does not have.
-- So the check matches on NAME and then asserts the KEY is the archive's.
--
-- It also pins the thing an empty second day must not do: no completion, no
-- seal, no outcome, no contribution to the flame.
--
-- READ-ONLY. Nothing here writes.
-- =============================================================================

\pset pager off

with me as (select :'uid'::uuid as uid),
live as (select * from public.challenges
          where owner = (select uid from me) and ended_at is null),
-- The replacement this run just retired: the one pointing at the live
-- challenge with the LATEST ended_at. The older retired attempt (the Phase 18
-- analogue) also points here, which is exactly why this cannot be a bare
-- "restarted_from = live" lookup.
repl as (select * from public.challenges
          where owner = (select uid from me)
            and restarted_from = (select id from live)
          order by ended_at desc nulls first
          limit 1),
off as (select (select start_date from repl) - (select start_date from live) as n),
-- every task the replacement had ticked, by NAME
repl_ticks as (
  select d.day,
         r.task->>'shortName' as name
    from public.challenge_days d
    join lateral jsonb_array_elements(d.task_snapshot) r(task) on true
    join public.task_completions tc
      on tc.challenge_id = d.challenge_id and tc.day = d.day
     and tc.task_key = r.task->>'key'
   where d.challenge_id = (select id from repl)
),
-- every completion now on the corresponding ARCHIVE day, by NAME, with the
-- key it was written as and the key the archive's own snapshot says it is
arch_ticks as (
  select d.day,
         a.task->>'shortName' as name,
         tc.task_key          as written_key,
         a.task->>'key'       as archive_key
    from public.challenge_days d
    join lateral jsonb_array_elements(d.task_snapshot) a(task) on true
    join public.task_completions tc
      on tc.challenge_id = d.challenge_id and tc.day = d.day
     and tc.task_key = a.task->>'key'
   where d.challenge_id = (select id from live)
     and d.day > (select n from off)
),
pairs as (
  select r.day                         as repl_day,
         r.day + (select n from off)   as arch_day,
         r.name,
         (select count(*) from arch_ticks a
           where a.day = r.day + (select n from off) and a.name = r.name) as landed
    from repl_ticks r
),
strays as (
  select a.day, a.name from arch_ticks a
   where not exists (select 1 from repl_ticks r
                      where r.day + (select n from off) = a.day and r.name = a.name)
)
select * from (
  -- 1. the shape this check is reading
  select 1 as ord,
         'carry offset'::text as item,
         ('replacement day N -> archive day N + ' || (select n from off))::text as detail,
         ('replacement has ' || (select count(*) from public.challenge_days
                                  where challenge_id = (select id from repl))
          || ' day row(s); archive days above the offset: '
          || coalesce((select string_agg(day::text, ', ' order by day)
                         from public.challenge_days
                        where challenge_id = (select id from live)
                          and day > (select n from off)), 'none'))::text as actual,
         'informational'::text as verdict

  -- 2. every ticked task landed on the right day, under the ARCHIVE's key
  union all
  select 2, 'every ticked task landed on its own archive day',
         (select count(*)::text || ' (name, day) pair(s) to place' from pairs),
         coalesce((select string_agg(
                     'repl d' || repl_day || ' "' || name || '" -> arch d' || arch_day
                     || case when landed = 1 then ' ok' else ' MISSING' end,
                     E'\n' order by repl_day, name) from pairs), 'nothing ticked'),
         case when not exists (select 1 from pairs where landed <> 1)
              then 'OK — each one placed exactly once'
              else 'FINDING — a ticked task did not land on its archive day' end

  -- 3. the keys are the ARCHIVE's, not the replacement's
  union all
  select 3, 'the keys written are the archive''s own',
         '0 completions carrying a key the archive''s snapshot does not have',
         (select count(*)::text from arch_ticks where written_key is distinct from archive_key),
         case when not exists (select 1 from arch_ticks
                                where written_key is distinct from archive_key)
              then 'OK — mapped by name, written as the archive'
              else 'FINDING — a replacement key was copied verbatim' end

  -- 4. and the custom keys really did differ, or check 3 proved nothing
  union all
  select 4, 'the two challenges genuinely disagree on custom keys',
         'at least 1 shared name with different uuids',
         (select coalesce(string_agg(a.name || ': ' || left(a.id::text,8)
                                     || ' vs ' || left(r.id::text,8), '; '
                                     order by a.name), 'none')
            from public.custom_tasks a
            join public.custom_tasks r
              on r.name = a.name and r.challenge_id = (select id from repl)
           where a.challenge_id = (select id from live) and a.id <> r.id),
         case when exists (select 1 from public.custom_tasks a
                            join public.custom_tasks r
                              on r.name = a.name and r.challenge_id = (select id from repl)
                           where a.challenge_id = (select id from live) and a.id <> r.id)
              then 'OK — check 3 had something to catch'
              else 'FINDING — the keys match, so check 3 is vacuous' end

  -- 5. nothing appeared on a carried day that was not carried
  union all
  select 5, 'no completion invented on a carried day',
         '0 stray (day, name) pairs',
         (select count(*)::text from strays),
         case when not exists (select 1 from strays) then 'OK'
              else 'FINDING — a carried day has a completion the replacement never had' end

  -- 6. THE EMPTY SECOND DAY. Whether it exists or not, it must carry nothing,
  --    be unsealed, and hold no outcome.
  union all
  select 6, 'carried days with nothing ticked',
         'exist or not, but never sealed, never scored, never completed',
         coalesce((select string_agg(
                     'arch d' || d.day || ': ' || jsonb_array_length(d.task_snapshot)
                     || ' task(s), 0 ticked, sealed=' || (d.sealed_at is not null)::text
                     || ', outcome=' || coalesce(d.outcome, 'null'),
                     '; ' order by d.day)
                     from public.challenge_days d
                    where d.challenge_id = (select id from live)
                      and d.day > (select n from off)
                      and not exists (select 1 from public.task_completions tc
                                       where tc.challenge_id = d.challenge_id
                                         and tc.day = d.day)),
                  'none — every carried day has at least one tick'),
         case when not exists (select 1 from public.challenge_days d
                                where d.challenge_id = (select id from live)
                                  and d.day > (select n from off)
                                  and not exists (select 1 from public.task_completions tc
                                                   where tc.challenge_id = d.challenge_id
                                                     and tc.day = d.day)
                                  and (d.sealed_at is not null or d.outcome is not null))
              then 'OK — an empty carried day is left alone'
              else 'FINDING — an empty day was sealed or scored' end

  -- 7. and it did not touch the streak
  union all
  select 7, 'the flame stops at the last day that is actually met',
         'flame = the trailing met run',
         (select flame::text from live) || ' (highest met day above the offset: '
           || coalesce((select max(d.day)::text from public.challenge_days d
                         where d.challenge_id = (select id from live)
                           and public.day_is_met(d.challenge_id, d.day)), 'none')
           || ')',
         case when (select flame from live) =
                   (select count(*) from (
                      select g.day, sum(case when public.day_is_met((select id from live), g.day)
                                             then 0 else 1 end)
                        over (order by g.day desc rows between unbounded preceding and current row) as b
                        from generate_series(1, greatest(
                               coalesce((select max(day) from public.challenge_days
                                          where challenge_id = (select id from live)
                                            and sealed_at is not null), 0),
                               coalesce((select public.last_closed_day(live.*) from live), 0),
                               1)) as g(day)) t
                     where t.b = 0)
              then 'OK' else 'FINDING — an unmet day is inside the flame' end
) v order by ord;
