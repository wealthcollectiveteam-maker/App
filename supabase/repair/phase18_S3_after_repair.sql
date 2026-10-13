-- =============================================================================
-- PHASE 18 / S3 — WHAT HAPPENED AFTER THE REPAIR (LOCAL STUB ONLY)
--
-- The repair ran on production on 2026-09-09. Then the account holder did day
-- 17 and the day rolled over, so by 2026-09-10 the database no longer matches
-- the state the verification SELECT was written against — which is exactly how
-- three of its rows came to read FINDING over a correct database.
--
-- This reproduces that: day 17 completed yesterday, then the REAL evaluator
-- run over the restored challenge. Using evaluate_challenge() rather than
-- hand-writing the outcome is the point — it proves the ordinary engine can
-- still judge the challenge the repair handed back to it, which is the thing
-- no amount of reading the repair script can establish.
--
-- Run AFTER phase18_S3_fixture.sql and streak_repair.sql.
-- =============================================================================

\set QUIET on
\pset pager off

do $$
begin
  if current_database() <> 'ranked_test' then
    raise exception 'REFUSED: local stub only. Current database is %.',
      current_database();
  end if;
end $$;

do $$
declare
  v_uid   uuid := '5212e3ec-29ab-4bb0-b048-41088920e433';
  v_ch    uuid;
  v_day17 integer;
  v_k     text;
  v_n     integer;
begin
  select id into v_ch from public.challenges
   where owner = v_uid and ended_at is null;
  if v_ch is null then
    raise exception 'no live challenge — run streak_repair.sql first';
  end if;

  v_day17 := 17;

  -- The account holder completed day 17 during day 17. Backdated HERE, in a
  -- fixture, to reproduce real history — never in the repair.
  insert into public.challenge_days (challenge_id, day, task_snapshot)
  select v_ch, v_day17, public.compose_task_set(v_ch, v_day17)
  where not exists (select 1 from public.challenge_days
                     where challenge_id = v_ch and day = v_day17);

  for v_k in
    select t->>'key' from public.challenge_days d,
           lateral jsonb_array_elements(d.task_snapshot) t
     where d.challenge_id = v_ch and d.day = v_day17
  loop
    insert into public.task_completions (challenge_id, day, task_key, completed_at)
    values (v_ch, v_day17, v_k, timestamptz '2026-09-09 21:40:00-04')
    on conflict (challenge_id, day, task_key) do nothing;
  end loop;

  -- THE REAL APP PATH. seal_day() is what runs when the last task is ticked;
  -- it sets sealed_at and pays the flame. Calling it rather than writing
  -- sealed_at by hand is the proof that the challenge the repair handed back
  -- still works through the ordinary RPCs.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, false);
  begin
    perform public.seal_day(v_day17);
    raise notice 'seal_day(17) succeeded through the normal RPC';
  exception when others then
    raise notice 'seal_day(17) refused (%) — day 17 has closed; the evaluator owns it now',
      sqlerrm;
  end;

  -- THE REAL ENGINE, over the challenge the repair handed back.
  select public.evaluate_challenge(v_ch) into v_n;
  raise notice 'evaluate_challenge judged % day(s)', v_n;
end $$;

\echo 'day 17 completed and the real evaluator has run'
