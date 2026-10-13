-- =============================================================================
-- PHASE 28 — SCENARIO M ASSERTIONS (LOCAL STUB ONLY, NEVER PRODUCTION)
--
-- M is production's shape as read on 2026-09-17 at 03:09 EDT:
--
--   archive             ended 'missed_day' on day 23 (Tue 2026-09-15), which
--                       has a full snapshot and ZERO completions; days 1-22
--                       all met; flame 22 = best_flame 22; last_evaluated_day 23
--   replacement         started 2026-09-16, live, flame 0, ZERO completions of
--                       any kind. Its day 1 is yesterday, its day 2 is today.
--                       Both carried days are EMPTY.
--
-- L had ONE empty carried day. A and B had TWO with the first COMPLETE. Here
-- there are TWO and BOTH are empty. The first of them, archive day 24, is
-- yesterday — it is still open ONLY because the noon grace window has not
-- closed. That is why this scenario seeds `grace open`: run after local noon
-- the same shape is a fresh miss on day 24 and the repair must refuse it
-- (scenario E proves that refusal for a partial day; the empty case takes the
-- same branch).
--
-- Run by scripts/rehearse-phase22.sh with
--   -v stage=before|after|payonce  -v prod_day=<production's missed day>
--
-- Every expected value is DERIVED from the fixture's own ids (public.fx22),
-- never typed in. prod_day is used for LABELS only: fixture day end_day is
-- production day 23, end_day+1 is 24, end_day+2 is 25.
--
-- Output is one PASS or FAIL line per check, then a stage verdict. Any FAIL
-- raises, so the runner stops there.
--
-- `before` and `after` only read. `payonce` WRITES — it drives the real engine
-- and the real app RPCs over the repaired challenge — and the guard below
-- refuses any database but the rehearsal stub.
-- =============================================================================

\set QUIET on
\pset pager off

select set_config('m.stage', :'stage', false)       as m_stage,
       set_config('m.prod_day', :'prod_day', false) as m_prod_day \gset

do $$
begin
  if current_database() <> 'ranked_phase22' then
    raise exception
      'REFUSED: phase28_M_check.sql may only run against the local '
      'ranked_phase22 stub. Current database is %.', current_database();
  end if;
end $$;

create temp table if not exists m_results (stage text, ok boolean, label text);

create or replace function pg_temp.m_chk(p_ok boolean, p_label text)
returns void
language plpgsql
as $f$
begin
  -- A NULL condition is a FAIL, never a silent pass.
  insert into pg_temp.m_results
  values (current_setting('m.stage'), coalesce(p_ok, false), p_label);
  raise notice '%', case when coalesce(p_ok, false) then 'PASS  ' else 'FAIL  ' end
                    || p_label;
end
$f$;

do $$
declare
  v_stage text    := current_setting('m.stage');
  v_prod  integer := current_setting('m.prod_day')::integer;
  v_owner uuid    := (select v::uuid    from public.fx22 where k = 'owner');
  v_arch  uuid    := (select v::uuid    from public.fx22 where k = 'archive');
  v_repl  uuid    := (select v::uuid    from public.fx22 where k = 'replacement');
  v_e     integer := (select v::integer from public.fx22 where k = 'end_day');
  v_c1    integer := (select v::integer from public.fx22 where k = 'carry1');
  v_c2    integer := (select v::integer from public.fx22 where k = 'carry2');
  v_days  integer := (select v::integer from public.fx22 where k = 'days');
  v_grace text    := (select v          from public.fx22 where k = 'grace');
  v_p1    integer;
  v_p2    integer;
  v_a     public.challenges;
  v_r     public.challenges;
  v_d     public.challenge_days;
  v_n     integer;
  v_t     integer;
  v_all   integer;
  v_fail  integer;
  v_msg   text;
  v_k     text;
  v_day   integer;
begin
  v_p1 := v_c1 - v_e + v_prod;
  v_p2 := v_c2 - v_e + v_prod;
  select * into v_a from public.challenges where id = v_arch;
  select * into v_r from public.challenges where id = v_repl;

  -- ===========================================================================
  if v_stage = 'before' then
  -- ===========================================================================
    raise notice 'M preconditions — fixture day % = production day %; % = %; % = %',
      v_e, v_prod, v_c1, v_p1, v_c2, v_p2;

    perform pg_temp.m_chk(v_days = 2 and v_grace = 'open',
      format('the fixture was seeded with TWO replacement days inside the grace window (days = %s, grace %s)',
             v_days, v_grace));

    -- ---- the replacement: live, started yesterday, two empty days ---------
    perform pg_temp.m_chk(v_r.id is not null and v_r.ended_at is null
                          and v_r.restarted_from = v_arch,
      'the replacement is LIVE and points at the archive');
    perform pg_temp.m_chk(v_r.start_date = (now() at time zone v_r.timezone)::date - 1
                          and public.challenge_day(v_r) = 2,
      format('the replacement started YESTERDAY (%s %s) and is on day %s',
             v_r.start_date, v_r.timezone, public.challenge_day(v_r)));

    select count(*) into v_n from public.challenge_days where challenge_id = v_repl;
    perform pg_temp.m_chk(v_n = 2,
      format('the replacement holds exactly TWO challenge_days rows (%s)', v_n));

    select count(*) into v_n from public.task_completions where challenge_id = v_repl;
    perform pg_temp.m_chk(v_n = 0,
      format('the replacement has ZERO completions of any kind (%s) — nothing to carry', v_n));

    for v_day in 1 .. 2 loop
      select * into v_d from public.challenge_days
       where challenge_id = v_repl and day = v_day;
      v_t := jsonb_array_length(v_d.task_snapshot);
      perform pg_temp.m_chk(v_d.id is not null and v_t > 0
                            and v_d.sealed_at is null and v_d.evaluated_at is null
                            and v_d.outcome is null,
        format('replacement day %s row EXISTS with %s task(s), unsealed, unjudged',
               v_day, coalesce(v_t::text, 'NO ROW')));
      perform pg_temp.m_chk(public.day_is_open(v_r, v_day),
        format('replacement day %s is still OPEN (closes %s %s)',
               v_day, public.day_closes_at(v_r, v_day) at time zone v_r.timezone, v_r.timezone));
    end loop;

    perform pg_temp.m_chk(v_r.flame = 0,
      format('replacement flame is 0 (%s)', v_r.flame));

    -- ---- the archive --------------------------------------------------------
    select * into v_d from public.challenge_days
     where challenge_id = v_arch and day = v_e;
    select count(*) into v_n from public.task_completions
     where challenge_id = v_arch and day = v_e;
    perform pg_temp.m_chk(v_d.id is not null and jsonb_array_length(v_d.task_snapshot) > 0
                          and v_n = 0 and v_d.outcome = 'missed' and v_d.sealed_at is null,
      format('archive day %s (production %s) is zero_ticks: row %s, %s task(s), %s completions, outcome %s, sealed_at %s',
             v_e, v_prod, case when v_d.id is null then 'ABSENT' else 'exists' end,
             coalesce(jsonb_array_length(v_d.task_snapshot)::text, '-'),
             v_n, coalesce(v_d.outcome, 'null'), coalesce(v_d.sealed_at::text, 'null')));

    perform pg_temp.m_chk(v_a.ended_at is not null
                          and v_a.ended_reason = 'missed_day' and v_a.ended_on_day = v_e,
      format('archive ended %s, reason %s, on day %s',
             v_a.ended_at at time zone v_a.timezone, v_a.ended_reason, v_a.ended_on_day));
    perform pg_temp.m_chk(v_a.last_evaluated_day = v_e,
      format('archive last_evaluated_day %s (production 23)', v_a.last_evaluated_day));
    perform pg_temp.m_chk(public.challenge_day(v_a) = v_c2,
      format('today is archive day %s (production %s)', public.challenge_day(v_a), v_p2));
    -- The whole point of M: archive day 24 is YESTERDAY and is only still
    -- open because it is inside the grace window.
    perform pg_temp.m_chk(public.earliest_open_day(v_a) = v_c1
                          and now() < public.day_closes_at(v_a, v_c1),
      format('archive day %s (production %s) is yesterday and still inside its grace window, closing %s %s',
             v_c1, v_p1, public.day_closes_at(v_a, v_c1) at time zone v_a.timezone, v_a.timezone));

    perform pg_temp.m_chk(not exists (select 1 from public.challenge_days
                                       where challenge_id = v_arch and day > v_e),
      format('archive has no challenge_days row above day %s — days %s and %s are the repair''s to compose',
             v_e, v_c1, v_c2));

    select count(*) into v_n from generate_series(1, v_e - 1) g
     where not public.day_is_met(v_arch, g);
    perform pg_temp.m_chk(v_n = 0,
      format('archive days 1..%s are ALL met (%s not met) — production days 1-22', v_e - 1, v_n));

    perform pg_temp.m_chk(v_a.flame = v_e - 1 and v_a.best_flame = v_a.flame,
      format('archive flame %s, best_flame %s — equal, as on production (22 / 22)',
             v_a.flame, v_a.best_flame));

  -- ===========================================================================
  elsif v_stage = 'after' then
  -- ===========================================================================
    -- ---- archive day 23: full task set, met, sealed -------------------------
    select * into v_d from public.challenge_days
     where challenge_id = v_arch and day = v_e;
    v_t := jsonb_array_length(v_d.task_snapshot);
    select count(*) into v_n from public.task_completions
     where challenge_id = v_arch and day = v_e;
    perform pg_temp.m_chk(v_t > 0 and v_n = v_t and public.day_is_met(v_arch, v_e),
      format('archive day %s (production %s) holds its FULL task set: %s of %s completions, met',
             v_e, v_prod, v_n, v_t));
    perform pg_temp.m_chk(v_d.sealed_at is not null and v_d.outcome = 'met',
      format('archive day %s (production %s) is SEALED and scored: outcome %s, sealed_at %s',
             v_e, v_prod, coalesce(v_d.outcome, 'null'), coalesce(v_d.sealed_at::text, 'null')));
    perform pg_temp.m_chk(v_d.sealed_at = v_d.evaluated_at
                          and (select count(*) from public.task_completions
                                where challenge_id = v_arch and day = v_e
                                  and completed_at = v_d.sealed_at) = v_t,
      format('archive day %s was written BY THE REPAIR: sealed_at = evaluated_at = every completion''s completed_at',
             v_e));

    -- ---- archive days 24 AND 25: created, OPEN at 0, unsealed, unjudged -----
    for v_day in v_c1 .. v_c2 loop
      select * into v_d from public.challenge_days
       where challenge_id = v_arch and day = v_day;
      select count(*) into v_n from public.task_completions
       where challenge_id = v_arch and day = v_day;
      perform pg_temp.m_chk(v_d.id is not null and jsonb_array_length(v_d.task_snapshot) > 0,
        format('archive day %s (production %s) was CREATED with %s task(s)',
               v_day, v_day - v_e + v_prod,
               coalesce(jsonb_array_length(v_d.task_snapshot)::text, 'NO ROW')));
      perform pg_temp.m_chk(v_n = 0,
        format('archive day %s (production %s) has 0 completions (%s) — nothing was invented',
               v_day, v_day - v_e + v_prod, v_n));
      perform pg_temp.m_chk(v_d.id is not null and v_d.sealed_at is null
                            and v_d.evaluated_at is null and v_d.outcome is null,
        format('archive day %s (production %s) NOT sealed, NOT judged: sealed_at %s, evaluated_at %s, outcome %s',
               v_day, v_day - v_e + v_prod, coalesce(v_d.sealed_at::text, 'null'),
               coalesce(v_d.evaluated_at::text, 'null'), coalesce(v_d.outcome, 'null')));
      perform pg_temp.m_chk(v_d.id is not null and not public.day_is_met(v_arch, v_day),
        format('archive day %s (production %s) is NOT met', v_day, v_day - v_e + v_prod));
      perform pg_temp.m_chk(public.day_is_open(v_a, v_day),
        format('archive day %s (production %s) is still OPEN until %s %s',
               v_day, v_day - v_e + v_prod,
               public.day_closes_at(v_a, v_day) at time zone v_a.timezone, v_a.timezone));
    end loop;
    perform pg_temp.m_chk(not exists (select 1 from public.challenge_days
                                       where challenge_id = v_arch and day > v_c2),
      format('archive has no challenge_days row above day %s', v_c2));

    -- ---- the two challenges -------------------------------------------------
    perform pg_temp.m_chk(v_a.ended_at is null and v_a.ended_reason is null
                          and v_a.ended_on_day is null and v_a.missed_notice_day is null,
      'the archive is LIVE again: ended_at, ended_reason, ended_on_day, missed_notice_day all null');
    perform pg_temp.m_chk(v_r.ended_at is not null and v_r.ended_reason is null
                          and v_r.ended_on_day = 2,
      format('the replacement is retired: ended_reason %s, ended_on_day %s',
             coalesce(v_r.ended_reason, 'null'), coalesce(v_r.ended_on_day::text, 'null')));
    perform pg_temp.m_chk((select count(*) from public.challenges
                            where owner = v_owner and ended_at is null) = 1,
      'exactly one live challenge for the owner');

    -- ---- flame 23, best_flame 23, last_evaluated_day 23 ----------------------
    perform pg_temp.m_chk(v_a.flame = v_e,
      format('flame = %s (expected %s; production %s)', v_a.flame, v_e, v_prod));
    perform pg_temp.m_chk(v_a.best_flame = v_e,
      format('best_flame = %s (expected %s; production %s) — rose from %s', v_a.best_flame, v_e, v_prod, v_e - 1));
    perform pg_temp.m_chk(v_a.last_evaluated_day = v_e,
      format('last_evaluated_day = %s (expected %s; production %s)',
             v_a.last_evaluated_day, v_e, v_prod));

    -- Neither day 24 nor day 25 counts toward the flame: the flame equals the
    -- number of sealed met days, and the highest of those is day 23.
    select count(*), max(day) into v_n, v_t
      from public.challenge_days
     where challenge_id = v_arch and sealed_at is not null
       and public.day_is_met(v_arch, day);
    perform pg_temp.m_chk(v_n = v_e and v_t = v_e and v_a.flame = v_n,
      format('the flame counts %s sealed met days, the highest being day %s — days %s and %s are outside it',
             v_n, v_t, v_c1, v_c2));

    -- THE FLAME/SEAL INVARIANT (streak_repair.sql step 10), checked from
    -- outside and over a wider span than the script checks: every day above
    -- the cursor up to TODAY, not only up to the last sealed or closed day.
    select count(*), string_agg(g::text, ', ')
      into v_n, v_msg
      from generate_series(v_a.last_evaluated_day + 1, public.challenge_day(v_a)) g
     where public.day_is_met(v_arch, g)
       and not exists (select 1 from public.challenge_days x
                        where x.challenge_id = v_arch and x.day = g
                          and x.sealed_at is not null);
    perform pg_temp.m_chk(v_n = 0,
      format('FLAME/SEAL INVARIANT: met-and-unsealed days above cursor %s through today (day %s): %s',
             v_a.last_evaluated_day, public.challenge_day(v_a), coalesce(v_msg, 'none')));
    select count(*) into v_n from public.challenge_days
     where challenge_id = v_arch and sealed_at is not null
       and not public.day_is_met(v_arch, day);
    perform pg_temp.m_chk(v_n = 0,
      format('no sealed day is unmet (%s)', v_n));

    -- The evaluator's cursor sits BELOW day 24, so day 24 WILL be judged at
    -- its close. This is the consequence the operator must act on: finish it
    -- in the app before noon, or the challenge ends again — correctly.
    perform pg_temp.m_chk(v_a.last_evaluated_day < v_c1
                          and public.last_closed_day(v_a) = v_e,
      format('day %s (production %s) is still the evaluator''s to judge at %s %s — it must be finished in the app before then',
             v_c1, v_p1, public.day_closes_at(v_a, v_c1) at time zone v_a.timezone, v_a.timezone));

    -- ---- private rows: day 1 -> 24, day 2 -> 25, the fixed four unmoved ------
    perform pg_temp.m_chk(
      (select count(*) from public.journal_entries
        where owner = v_owner and day = v_c1 and text = 'Starting over. Again.') = 1
      and (select count(*) from public.meals
            where owner = v_owner and day = v_c1 and text = 'Chicken and rice') = 1
      and (select count(*) from public.milestones
            where owner = v_owner and hit_on_day = v_c1 and title = 'First workout back') = 1
      and (select count(*) from public.workout_logs
            where owner = v_owner and challenge_id = v_arch and day = v_c1) = 1
      and (select count(*) from public.workout_logs
            where owner = v_owner and challenge_id = v_repl) = 0,
      format('the replacement''s day-1 journal, meal, milestone and workout log all sit on archive day %s', v_c1));
    perform pg_temp.m_chk(
      (select count(*) from public.journal_entries
        where owner = v_owner and day = v_c2 and text = 'Day two of the restart.') = 1,
      format('the replacement''s day-2 journal entry sits on archive day %s', v_c2));
    perform pg_temp.m_chk(
      (select count(*) from public.journal_entries
        where owner = v_owner and day = 1 and text like 'Day 1 of%') = 1
      and (select count(*) from public.journal_entries
            where owner = v_owner and day = 2 and text like 'Day 2.%') = 1
      and (select count(*) from public.meals
            where owner = v_owner and day = v_e and text like 'Oats%') = 1
      and (select count(*) from public.meals
            where owner = v_owner and day = v_c1 and text like 'Toast%') = 1,
      format('the archive''s own rows did not move: journal days 1 and 2, the meal on day %s, the meal on the morning of day %s',
             v_e, v_c1));

    -- ---- the feed -----------------------------------------------------------
    perform pg_temp.m_chk(
      not exists (select 1 from public.feed_items where author = v_owner and kind = 'miss')
      and (select count(*) from public.feed_items where author = v_owner and kind = 'complete') = 1,
      'the miss feed item is gone and the older feed item survived');

  -- ===========================================================================
  elsif v_stage = 'payonce' then
  -- ===========================================================================
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_owner, 'role', 'authenticated')::text, false);

    select public.evaluate_challenge(v_arch) into v_n;
    select * into v_a from public.challenges where id = v_arch;
    perform pg_temp.m_chk(v_n = 0 and v_a.flame = v_e and v_a.last_evaluated_day = v_e
                          and v_a.ended_at is null,
      format('evaluate_challenge() over the repaired challenge judges %s day(s); flame %s, cursor %s, still live',
             v_n, v_a.flame, v_a.last_evaluated_day));

    begin
      perform public.seal_day(v_e);
      v_msg := 'returned without error';
    exception when others then
      v_msg := 'refused: ' || sqlerrm;
    end;
    select * into v_a from public.challenges where id = v_arch;
    perform pg_temp.m_chk(v_a.flame = v_e,
      format('seal_day(%s) from the app %s; flame still %s', v_e, v_msg, v_a.flame));

    for v_day in v_c1 .. v_c2 loop
      begin
        perform public.seal_day(v_day);
        v_msg := 'returned without error';
      exception when others then
        v_msg := 'refused: ' || sqlerrm;
      end;
      select * into v_a from public.challenges where id = v_arch;
      perform pg_temp.m_chk(v_a.flame = v_e
                            and (select sealed_at is null from public.challenge_days
                                  where challenge_id = v_arch and day = v_day),
        format('seal_day(%s) on the EMPTY open day %s; flame still %s and the day is still unsealed',
               v_day, v_msg, v_a.flame));
    end loop;

    -- Finish yesterday (day 24) inside its grace window, then today.
    for v_day in v_c1 .. v_c2 loop
      for v_k in
        select t->>'key' from public.challenge_days x,
               lateral jsonb_array_elements(x.task_snapshot) t
         where x.challenge_id = v_arch and x.day = v_day
      loop
        perform public.complete_task(v_k, null, v_day);
      end loop;
      perform public.seal_day(v_day);
      select * into v_a from public.challenges where id = v_arch;
      perform pg_temp.m_chk(v_a.flame = v_day and v_a.best_flame = v_day,
        format('finishing archive day %s (production %s) in the app pays ONE flame: %s -> %s, best_flame %s',
               v_day, v_day - v_e + v_prod, v_day - 1, v_a.flame, v_a.best_flame));
    end loop;

    perform public.seal_day(v_c2);
    select * into v_a from public.challenges where id = v_arch;
    perform pg_temp.m_chk(v_a.flame = v_c2,
      format('seal_day(%s) a second time pays nothing: flame %s', v_c2, v_a.flame));

    select public.evaluate_challenge(v_arch) into v_n;
    select * into v_a from public.challenges where id = v_arch;
    perform pg_temp.m_chk(v_n = 0 and v_a.flame = v_c2,
      format('evaluate_challenge() afterwards judges %s day(s); flame %s', v_n, v_a.flame));

  else
    raise exception 'phase28_M_check: unknown stage %', v_stage;
  end if;

  select count(*), count(*) filter (where not ok)
    into v_all, v_fail
    from pg_temp.m_results where stage = v_stage;
  if v_fail > 0 then
    raise exception 'M %: % of % check(s) FAILED', v_stage, v_fail, v_all;
  end if;
  raise notice 'M %: all % check(s) PASS', v_stage, v_all;
end $$;
