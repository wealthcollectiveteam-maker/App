-- =============================================================================
-- PHASE 15 / A3 — SURVIVAL
--
-- The repair is only worth anything if the restored challenge then behaves
-- like an ordinary live challenge. Run AFTER phase15_A3_verify.sql and after
-- the idempotence re-run, in the same database.
--
--   a) tonight's scheduled run judges nothing — day 8 has not ended yet
--   b) day 8 is finished through the app, a day passes, and the real evaluator
--      scores it met and takes the flame to 8 without archiving anything
--
-- This moves the clock (start_date - 1) and must be the last thing that runs.
-- =============================================================================

\set QUIET on
\pset pager off

-- =============================================================================
-- PROOF 8 — tonight's 04:05 UTC run does not touch it
-- =============================================================================
do $$
declare v_a public.challenges; v_judged integer;
begin
  select * into v_a from public.challenges where id = (select v::uuid from fx where k='archive');
  v_judged := public.evaluate_challenge(v_a.id);
  if v_judged <> 0 then
    raise exception 'FAIL: the evaluator judged % day(s); day 8 has not ended yet', v_judged;
  end if;
  select * into v_a from public.challenges where id = v_a.id;
  if v_a.ended_at is not null then
    raise exception 'FAIL: the evaluator archived the repaired challenge again';
  end if;
  if v_a.last_evaluated_day <> 7 then
    raise exception 'FAIL: the cursor moved to %', v_a.last_evaluated_day;
  end if;
  raise notice 'PASS: tonight''s run judges nothing — day 8 is still open, and still theirs to finish';
end $$;

-- =============================================================================
-- PROOF 9 — day 8 completes normally and the run continues
-- =============================================================================
do $$
declare
  v_uid uuid; v_a uuid; r record; v_c public.challenges; v_judged integer;
begin
  select v::uuid into v_uid from fx where k = 'uid';
  select v::uuid into v_a   from fx where k = 'archive';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, false);

  -- Finish day 8 the way the app would: freeze it, tick it, seal it.
  for r in
    select t->>'key' as k
    from jsonb_array_elements((public.get_or_freeze_today()).task_snapshot) t
  loop
    perform public.complete_task(r.k);
  end loop;
  perform public.seal_day();

  -- A day passes.
  update public.challenges set start_date = start_date - 1 where id = v_a;

  v_judged := public.evaluate_challenge(v_a);
  select * into v_c from public.challenges where id = v_a;

  if v_c.ended_at is not null then
    raise exception 'FAIL: the challenge was archived on the next run (%)', v_c.ended_reason;
  end if;
  if v_c.last_evaluated_day <> 8 then
    raise exception 'FAIL: cursor is %, expected 8', v_c.last_evaluated_day;
  end if;
  if v_c.flame <> 8 then raise exception 'FAIL: flame is %, expected 8', v_c.flame; end if;
  if v_c.best_flame <> 8 then raise exception 'FAIL: best_flame is %, expected 8', v_c.best_flame; end if;
  if not exists (select 1 from public.challenge_days
                  where challenge_id = v_a and day = 8 and outcome = 'met') then
    raise exception 'FAIL: day 8 was not scored met';
  end if;

  raise notice 'PASS: day 8 completed normally, scored met, flame 8 — the run continues';
  raise notice ' ALL PHASE 15 PART A PROOFS PASSED';
end $$;
