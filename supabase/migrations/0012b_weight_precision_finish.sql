-- =============================================================================
-- 0012b — FINISHING 0012.
--
-- WHAT THIS FILE ASSUMES ABOUT THE DATABASE BEFORE IT RUNS
--
--   * 0001-0011 applied.
--   * 0012 was run in the Supabase SQL editor and FAILED at its first DO
--     block with 42P01 (relation "w0012_before" does not exist).
--   * Therefore: metric_checkins.weight_kg IS ALREADY numeric(6,2) — the
--     ALTER committed on its own before the failure — and every statement
--     after that DO block never ran.
--
-- WHAT IT DOES: NOTHING. It writes no row, alters no column, grants and
-- revokes nothing.
--
-- That is the finding, not an omission. Of the four statements 0012 skipped,
-- three were a revoke-then-regrant whose end state 0002 and 0010 had already
-- established and which production has been verified to hold; the fourth was
-- an assertion about a type that is already correct. Re-running the skipped
-- REVOKE would open a window in which `authenticated` holds no privileges on
-- metric_checkins at all — and in this editor, if the GRANT after it failed,
-- that window would not close. The safe outstanding work is zero.
--
-- So this file is a SELECT you read with your own eyes. It reports what the
-- skipped statements would have checked, and shows the rows behind each
-- answer rather than raising an exception that could only fire after any
-- damage above it had already committed.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste -> Run. One statement, one
--   grid. Safe to run any number of times; it is read-only.
--
-- READ THE `verdict` COLUMN. Anything that is not OK is a finding.
-- =============================================================================

with
-- The column, as the catalogue actually has it.
col as (
  select format_type(a.atttypid, a.atttypmod) as actual_type
  from pg_attribute a
  where a.attrelid = 'public.metric_checkins'::regclass
    and a.attname = 'weight_kg'
    and not a.attisdropped
),

-- Every stored weight, put through the round trip the app performs: kg is
-- canonical, pounds are a display conversion at one decimal place. A value
-- that does not survive both directions is the defect 0012 existed to fix.
rt as (
  select m.id,
         m.weight_kg,
         to_char(round(m.weight_kg, 1), 'FM9999990.0') as shows_kg,
         to_char(round(m.weight_kg / 0.45359237, 1), 'FM9999990.0') as shows_lb,
         -- Re-derive the kg a user would have to have typed in pounds to
         -- land here, then check it comes back to the same pound figure.
         to_char(
           round(
             round(round(m.weight_kg / 0.45359237, 1) * 0.45359237, 2)
             / 0.45359237, 1),
           'FM9999990.0') as lb_after_a_second_trip
  from public.metric_checkins m
  where m.weight_kg is not null
),

-- Column-level UPDATE. 0010's reasoning: `owner` and `id` must stay
-- unwritable even if the row policy is ever weakened.
colgrants as (
  select a.attname,
         has_column_privilege('authenticated', 'public.metric_checkins', a.attname, 'UPDATE') as upd,
         has_column_privilege('authenticated', 'public.metric_checkins', a.attname, 'SELECT') as sel,
         has_column_privilege('authenticated', 'public.metric_checkins', a.attname, 'INSERT') as ins
  from pg_attribute a
  where a.attrelid = 'public.metric_checkins'::regclass
    and a.attnum > 0 and not a.attisdropped
),

report as (
  -- 1 ------------------------------------------------- the ALTER that ran
  select '1_column_type' as section, 0 as ord,
         'metric_checkins.weight_kg' as item,
         (select actual_type from col) as detail,
         case when (select actual_type from col) = 'numeric(6,2)'
              then 'OK — 0012''s ALTER committed'
              else 'FINDING — expected numeric(6,2)' end as verdict

  -- 2 ---------------- what the DIED statement would have checked: no value moved
  union all
  select '2_stored_weights', row_number() over (order by rt.weight_kg)::int,
         rt.weight_kg::text,
         'shows as ' || rt.shows_kg || ' kg / ' || rt.shows_lb || ' lb',
         case when rt.lb_after_a_second_trip = rt.shows_lb
              then 'OK — round-trips in both units'
              else 'FINDING — moves to ' || rt.lb_after_a_second_trip || ' lb' end
  from rt

  union all
  select '2_stored_weights', 99,
         'rows with a weight',
         (select count(*)::text from rt),
         case when (select count(*) from rt) > 0 then 'OK — history is present'
              else 'FINDING — no weights at all; expected 5' end

  -- 3 --------- what the SKIPPED revoke/grant would have (re)established
  union all
  select '3_column_grants', row_number() over (order by g.attname)::int,
         g.attname,
         'select=' || g.sel || ' insert=' || g.ins || ' update=' || g.upd,
         case
           when g.attname in ('weight_kg', 'mood') and g.upd and g.sel and g.ins
             then 'OK — writable, as 0010 intends'
           when g.attname not in ('weight_kg', 'mood') and not g.upd
             then 'OK — not updatable, as 0010 intends'
           else 'FINDING — grant shape is wrong for this column'
         end
  from colgrants g

  union all
  select '4_table_grants', v.ord, v.priv,
         has_table_privilege('authenticated', 'public.metric_checkins', v.priv)::text,
         case
           when v.priv = 'UPDATE' and not has_table_privilege('authenticated', 'public.metric_checkins', 'UPDATE')
             then 'OK — no table-level UPDATE; the column grant is the only one'
           when v.priv <> 'UPDATE' and has_table_privilege('authenticated', 'public.metric_checkins', v.priv)
             then 'OK'
           else 'FINDING — expected the opposite'
         end
  from (values (1,'SELECT'), (2,'INSERT'), (3,'DELETE'), (4,'UPDATE')) as v(ord, priv)

  union all
  select '4_table_grants', 5, 'anon holds anything',
         (has_table_privilege('anon', 'public.metric_checkins', 'SELECT')
          or has_table_privilege('anon', 'public.metric_checkins', 'INSERT'))::text,
         case when has_table_privilege('anon', 'public.metric_checkins', 'SELECT')
                or has_table_privilege('anon', 'public.metric_checkins', 'INSERT')
              then 'FINDING — anon can reach metric_checkins'
              else 'OK — anon holds nothing' end

  -- 5 ---------------- the row policy the column grant sits on top of
  union all
  select '5_row_policy', row_number() over (order by p.policyname)::int,
         p.policyname,
         'cmd=' || p.cmd || ' using=' || coalesce(p.qual, '-')
           || ' check=' || coalesce(p.with_check, '-'),
         case when coalesce(p.qual, '') like '%auth.uid()%'
              then 'OK — owner-scoped'
              else 'FINDING — read the predicate' end
  from pg_policies p
  where p.schemaname = 'public' and p.tablename = 'metric_checkins'

  -- 6 -------------------------------------------- what is left outstanding
  union all
  select '6_outstanding', 0, 'mutations still owed by 0012',
         'none',
         'OK — the skipped statements were a revoke/regrant whose end state '
         || 'was already established by 0002 and 0010, plus one type '
         || 'assertion that is already true. Nothing here needs re-running.'
)

select section, ord, item, detail, verdict
from report
order by section, ord;
