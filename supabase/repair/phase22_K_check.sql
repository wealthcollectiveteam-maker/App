-- =============================================================================
-- PHASE 22 — SCENARIO K ASSERTIONS (LOCAL STUB ONLY, NEVER PRODUCTION)
--
-- K is production's shape as checked on 2026-09-13 in the afternoon:
--
--   replacement day 1   every task ticked, PAST its local close, and
--                       sealed_at / evaluated_at / outcome all NULL — nothing
--                       ever sealed or judged it
--   replacement day 2   the row exists, full snapshot, zero completions
--
-- Scenarios A and B seed day 1 SEALED by seal_day() inside the window. That is
-- not what production holds, so K asserts the shape BEFORE the repair runs —
-- a precondition that fails stops the rehearsal, because a green result over
-- the wrong shape is the failure this file exists to prevent.
--
-- Run by scripts/rehearse-phase22.sh with
--   -v stage=before|after|payonce  -v prod_day=<production's missed day>
--
-- Every expected value is DERIVED from the fixture's own ids (public.fx22),
-- never typed in. prod_day is used for LABELS only, so each line also says
-- what the number corresponds to on production: fixture day end_day is
-- production day 19, end_day+1 is 20, end_day+2 is 21.
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

select set_config('k.stage', :'stage', false)       as k_stage,
       set_config('k.prod_day', :'prod_day', false) as k_prod_day \gset

do $$
begin
  if current_database() <> 'ranked_phase22' then
    raise exception
      'REFUSED: phase22_K_check.sql may only run against the local '
      'ranked_phase22 stub. Current database is %.', current_database();
  end if;
end $$;

create temp table if not exists k_results (stage text, ok boolean, label text);

create or replace function pg_temp.k_chk(p_ok boolean, p_label text)
returns void
language plpgsql
as $f$
begin
  -- A NULL condition is a FAIL, never a silent pass.
  insert into pg_temp.k_results
  values (current_setting('k.stage'), coalesce(p_ok, false), p_label);
  raise notice '%', case when coalesce(p_ok, false) then 'PASS  ' else 'FAIL  ' end
                    || p_label;
end
$f$;

do $$
declare
  v_stage text    := current_setting('k.stage');
  v_prod  integer := current_setting('k.prod_day')::integer;
  v_owner uuid    := (select v::uuid    from public.fx22 where k = 'owner');
  v_arch  uuid    := (select v::uuid    from public.fx22 where k = 'archive');
  v_repl  uuid    := (select v::uuid    from public.fx22 where k = 'replacement');
  v_e     integer := (select v::integer from public.fx22 where k = 'end_day');
  v_c1    integer := (select v::integer from public.fx22 where k = 'carry1');
  v_c2    integer := (select v::integer from public.fx22 where k = 'carry2');
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
begin
  v_p1 := v_c1 - v_e + v_prod;
  v_p2 := v_c2 - v_e + v_prod;
  select * into v_a from public.challenges where id = v_arch;
  select * into v_r from public.challenges where id = v_repl;

  -- ===========================================================================
  if v_stage = 'before' then
  -- ===========================================================================
    raise notice 'K preconditions — fixture day % = production day %; % = %; % = %',
      v_e, v_prod, v_c1, v_p1, v_c2, v_p2;

    -- ---- replacement day 1: complete, closed, never sealed, never judged ----
    select * into v_d from public.challenge_days
     where challenge_id = v_repl and day = 1;
    v_t := jsonb_array_length(v_d.task_snapshot);
    select count(*) into v_n from public.task_completions
     where challenge_id = v_repl and day = 1;
    perform pg_temp.k_chk(v_d.id is not null and v_t > 0 and v_n = v_t,
      format('replacement day 1 is COMPLETE: %s of %s ticked', v_n, coalesce(v_t::text, 'no row')));

    perform pg_temp.k_chk(now() >= public.day_closes_at(v_r, 1)
                          and not public.day_is_open(v_r, 1),
      format('replacement day 1 is PAST its local close (closed %s %s)',
             public.day_closes_at(v_r, 1) at time zone v_r.timezone, v_r.timezone));

    perform pg_temp.k_chk(v_d.id is not null and v_d.sealed_at is null,
      format('replacement day 1 sealed_at is NULL (%s)', coalesce(v_d.sealed_at::text, 'null')));
    perform pg_temp.k_chk(v_d.id is not null and v_d.evaluated_at is null,
      format('replacement day 1 evaluated_at is NULL (%s)', coalesce(v_d.evaluated_at::text, 'null')));
    perform pg_temp.k_chk(v_d.id is not null and v_d.outcome is null,
      format('replacement day 1 outcome is NULL (%s)', coalesce(v_d.outcome, 'null')));

    perform pg_temp.k_chk(v_r.flame = 0,
      format('replacement flame is 0 — no seal ever paid it (%s)', v_r.flame));

    -- ---- replacement day 2: the row exists and is empty ---------------------
    select * into v_d from public.challenge_days
     where challenge_id = v_repl and day = 2;
    v_t := jsonb_array_length(v_d.task_snapshot);
    select count(*) into v_n from public.task_completions
     where challenge_id = v_repl and day = 2;
    perform pg_temp.k_chk(v_d.id is not null and v_t > 0,
      format('replacement day 2 row EXISTS with %s task(s)', coalesce(v_t::text, 'NO ROW')));
    perform pg_temp.k_chk(v_n = 0,
      format('replacement day 2 has zero completions (%s)', v_n));
    perform pg_temp.k_chk(v_d.id is not null and v_d.sealed_at is null,
      format('replacement day 2 sealed_at is NULL (%s)', coalesce(v_d.sealed_at::text, 'null')));

    -- ---- the archive ----------------------------------------------------------
    select * into v_d from public.challenge_days
     where challenge_id = v_arch and day = v_e;
    select count(*) into v_n from public.task_completions
     where challenge_id = v_arch and day = v_e;
    perform pg_temp.k_chk(v_d.id is not null and v_n = 0
                          and v_d.outcome = 'missed' and v_d.sealed_at is null,
      format('archive day %s (production %s) is zero_ticks: row %s, %s completions, outcome %s, sealed_at %s',
             v_e, v_prod, case when v_d.id is null then 'ABSENT' else 'exists' end,
             v_n, coalesce(v_d.outcome, 'null'), coalesce(v_d.sealed_at::text, 'null')));

    perform pg_temp.k_chk(v_a.ended_reason = 'missed_day' and v_a.ended_on_day = v_e,
      format('archive ended_reason %s, ended_on_day %s', v_a.ended_reason, v_a.ended_on_day));

    perform pg_temp.k_chk(not exists (select 1 from public.challenge_days
                                       where challenge_id = v_arch and day > v_e),
      format('archive has no challenge_days row above day %s — both carried days are the repair''s to compose', v_e));

    perform pg_temp.k_chk(v_a.flame = v_e - 1 and v_a.best_flame = v_a.flame,
      format('archive flame %s, best_flame %s — equal, as on production (production flame 18)',
             v_a.flame, v_a.best_flame));

  -- ===========================================================================
  elsif v_stage = 'after' then
  -- ===========================================================================
    -- ---- archive day 19 -------------------------------------------------------
    select * into v_d from public.challenge_days
     where challenge_id = v_arch and day = v_e;
    v_t := jsonb_array_length(v_d.task_snapshot);
    select count(*) into v_n from public.task_completions
     where challenge_id = v_arch and day = v_e;
    perform pg_temp.k_chk(v_t > 0 and v_n = v_t and public.day_is_met(v_arch, v_e),
      format('archive day %s (production %s) holds %s of %s completions and is met',
             v_e, v_prod, v_n, v_t));
    perform pg_temp.k_chk(v_d.sealed_at is not null and v_d.outcome = 'met',
      format('archive day %s (production %s) sealed and scored: outcome %s, sealed_at %s',
             v_e, v_prod, coalesce(v_d.outcome, 'null'), coalesce(v_d.sealed_at::text, 'null')));

    -- ---- archive day 20: carried, and sealed by the repair ------------------
    select * into v_d from public.challenge_days
     where challenge_id = v_arch and day = v_c1;
    v_t := jsonb_array_length(v_d.task_snapshot);
    select count(*) into v_n from public.task_completions
     where challenge_id = v_arch and day = v_c1;
    perform pg_temp.k_chk(v_d.id is not null and v_t > 0 and v_n = v_t
                          and v_n = (select count(*) from public.task_completions
                                      where challenge_id = v_repl and day = 1),
      format('archive day %s (production %s) holds %s carried completions of %s — replacement day 1 had %s',
             v_c1, v_p1, v_n, coalesce(v_t::text, 'NO ROW'),
             (select count(*) from public.task_completions
               where challenge_id = v_repl and day = 1)));
    perform pg_temp.k_chk(public.day_is_met(v_arch, v_c1),
      format('archive day %s (production %s) is met', v_c1, v_p1));
    perform pg_temp.k_chk(v_d.sealed_at is not null and v_d.outcome = 'met',
      format('archive day %s (production %s) is SEALED and scored: outcome %s, sealed_at %s',
             v_c1, v_p1, coalesce(v_d.outcome, 'null'), coalesce(v_d.sealed_at::text, 'null')));
    -- The repair's signature: one transaction, so its seal, its judgement and
    -- the completions it wrote share a single now(). Nothing else produces that.
    perform pg_temp.k_chk(v_d.sealed_at = v_d.evaluated_at
                          and exists (select 1 from public.task_completions
                                       where challenge_id = v_arch and day = v_c1
                                         and completed_at = v_d.sealed_at),
      format('archive day %s was sealed BY THE REPAIR: sealed_at = evaluated_at = its carried completions'' completed_at',
             v_c1));
    perform pg_temp.k_chk((select sealed_at is null from public.challenge_days
                            where challenge_id = v_repl and day = 1),
      'the source, replacement day 1, is STILL unsealed — no seal existed to copy');

    -- ---- archive day 21: carried open, empty, not counted --------------------
    select * into v_d from public.challenge_days
     where challenge_id = v_arch and day = v_c2;
    select count(*) into v_n from public.task_completions
     where challenge_id = v_arch and day = v_c2;
    perform pg_temp.k_chk(v_d.id is not null and v_n = 0,
      format('archive day %s (production %s) row %s with %s completions',
             v_c2, v_p2, case when v_d.id is null then 'ABSENT' else 'exists' end, v_n));
    perform pg_temp.k_chk(v_d.id is not null and v_d.sealed_at is null
                          and v_d.evaluated_at is null and v_d.outcome is null,
      format('archive day %s (production %s) NOT sealed, NOT judged: sealed_at %s, evaluated_at %s, outcome %s',
             v_c2, v_p2, coalesce(v_d.sealed_at::text, 'null'),
             coalesce(v_d.evaluated_at::text, 'null'), coalesce(v_d.outcome, 'null')));
    perform pg_temp.k_chk(public.day_is_open(v_a, v_c2),
      format('archive day %s (production %s) is still OPEN until %s %s',
             v_c2, v_p2, public.day_closes_at(v_a, v_c2) at time zone v_a.timezone, v_a.timezone));

    -- ---- the challenge ---------------------------------------------------------
    perform pg_temp.k_chk(v_a.ended_at is null and v_a.ended_reason is null
                          and v_a.ended_on_day is null,
      'the archive is LIVE again: ended_at, ended_reason, ended_on_day all null');
    perform pg_temp.k_chk(v_r.ended_at is not null and v_r.ended_reason is null,
      format('the replacement is retired, ended_reason %s', coalesce(v_r.ended_reason, 'null')));

    perform pg_temp.k_chk(v_a.flame = v_c1,
      format('flame = %s (expected %s; production %s)', v_a.flame, v_c1, v_p1));
    perform pg_temp.k_chk(v_a.best_flame = v_c1,
      format('best_flame = %s (expected %s; production %s)', v_a.best_flame, v_c1, v_p1));
    perform pg_temp.k_chk(v_a.last_evaluated_day = v_c1,
      format('last_evaluated_day = %s (expected %s; production %s)',
             v_a.last_evaluated_day, v_c1, v_p1));

    -- THE FLAME/SEAL INVARIANT (streak_repair.sql:832-859), checked from
    -- outside and over a wider span than the script checks: every day above
    -- the cursor up to TODAY, not only up to the last sealed or closed day.
    select count(*), string_agg(g::text, ', ')
      into v_n, v_msg
      from generate_series(v_a.last_evaluated_day + 1, public.challenge_day(v_a)) g
     where public.day_is_met(v_arch, g)
       and not exists (select 1 from public.challenge_days x
                        where x.challenge_id = v_arch and x.day = g
                          and x.sealed_at is not null);
    perform pg_temp.k_chk(v_n = 0,
      format('FLAME/SEAL INVARIANT: met-and-unsealed days above cursor %s through today (day %s): %s',
             v_a.last_evaluated_day, public.challenge_day(v_a), coalesce(v_msg, 'none')));

  -- ===========================================================================
  elsif v_stage = 'payonce' then
  -- ===========================================================================
    -- The invariant's point, proved by consequence: after the repair, neither
    -- the evaluator nor the app may pay a flame for a day already counted, and
    -- the one uncounted day pays exactly once when it is finished.
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_owner, 'role', 'authenticated')::text, false);

    select public.evaluate_challenge(v_arch) into v_n;
    select * into v_a from public.challenges where id = v_arch;
    perform pg_temp.k_chk(v_n = 0 and v_a.flame = v_c1 and v_a.last_evaluated_day = v_c1,
      format('evaluate_challenge() over the repaired challenge judges %s day(s); flame %s, cursor %s',
             v_n, v_a.flame, v_a.last_evaluated_day));

    begin
      perform public.seal_day(v_c1);
      v_msg := 'returned without error';
    exception when others then
      v_msg := 'refused: ' || sqlerrm;
    end;
    select * into v_a from public.challenges where id = v_arch;
    perform pg_temp.k_chk(v_a.flame = v_c1,
      format('seal_day(%s) from the app %s; flame still %s', v_c1, v_msg, v_a.flame));

    for v_k in
      select t->>'key' from public.challenge_days x,
             lateral jsonb_array_elements(x.task_snapshot) t
       where x.challenge_id = v_arch and x.day = v_c2
    loop
      perform public.complete_task(v_k, null, v_c2);
    end loop;
    perform public.seal_day(v_c2);
    select * into v_a from public.challenges where id = v_arch;
    perform pg_temp.k_chk(v_a.flame = v_c1 + 1 and v_a.best_flame = v_c1 + 1,
      format('finishing archive day %s (production %s) in the app pays ONE flame: %s -> %s, best_flame %s',
             v_c2, v_p2, v_c1, v_a.flame, v_a.best_flame));

    perform public.seal_day(v_c2);
    select * into v_a from public.challenges where id = v_arch;
    perform pg_temp.k_chk(v_a.flame = v_c1 + 1,
      format('seal_day(%s) a second time pays nothing: flame %s', v_c2, v_a.flame));

    select public.evaluate_challenge(v_arch) into v_n;
    select * into v_a from public.challenges where id = v_arch;
    perform pg_temp.k_chk(v_n = 0 and v_a.flame = v_c1 + 1,
      format('evaluate_challenge() with day %s still in its window judges %s day(s); flame %s',
             v_c2, v_n, v_a.flame));

  else
    raise exception 'phase22_K_check: unknown stage %', v_stage;
  end if;

  select count(*), count(*) filter (where not ok)
    into v_all, v_fail
    from pg_temp.k_results where stage = v_stage;
  if v_fail > 0 then
    raise exception 'K %: % of % check(s) FAILED', v_stage, v_fail, v_all;
  end if;
  raise notice 'K %: all % check(s) PASS', v_stage, v_all;
end $$;
