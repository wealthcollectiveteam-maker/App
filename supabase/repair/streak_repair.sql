-- =============================================================================
-- STREAK REPAIR — an operator repair for "I did the work, I forgot to tap".
--
-- NOT A FEATURE. No RPC, no grant, no UI, nothing the app can reach. The app
-- must never let anyone undo a miss on their own; this is a script an operator
-- runs by hand, on days the account holder has named, one account at a time.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--   Edit the CONSTANTS block below first. Everything else is derived from the
--   rows themselves, so a database that does not match aborts rather than
--   improvising.
--
-- =============================================================================
-- THE STATE THIS ASSUMES BEFORE IT RUNS
-- =============================================================================
--   * exactly one auth.users row for P_OWNER
--   * exactly one LIVE challenge for that owner
--   * if P_RESTORE_FROM_RESTART: exactly one ENDED challenge, the live one's
--     restarted_from points at it, and its ended_reason is 'missed_day'
--   * every day in P_REPAIR_DAYS exists on the archive, is CLOSED, is not
--     already met, and has at least one completion (the `partial` evidence
--     class from the S1 diagnostic)
--   * every day in P_NO_RECORD_DAYS is CLOSED and has no completions
--   * the replacement's days map onto the archive with no overlap
--
-- Any of these being false aborts the whole thing. See "atomicity" below.
--
-- =============================================================================
-- WHAT IT DOES NOT MEAN
-- =============================================================================
--   It does NOT mean the days were ticked when they happened. Every row it
--   writes is timestamped now(), days after the fact, deliberately. That gap
--   IS the record that a repair happened — it is the only trace, by choice,
--   and it is why nothing here is backdated.
--
--   It does NOT mean the squad never saw the miss. They did, on the day. The
--   feed item is rewritten so it stops asserting something false going
--   forward; it cannot unsend what was already read.
--
--   It does NOT decide which days you did. It repairs the days named in the
--   constants and refuses everything else, including days it can see were
--   nearly complete.
--
-- =============================================================================
-- THE ORDER, AND WHY IT IS THIS ONE
-- =============================================================================
--   challenges_one_active_owner is UNIQUE (owner) WHERE ended_at IS NULL. So
--   the replacement MUST be retired BEFORE the archive is un-ended, or the
--   un-end raises 23505 unique_violation. If you are re-reading this and
--   thinking the un-end belongs earlier: it does not, and that is why.
--
--     1  resolve and assert the whole shape
--     2  insert the missing completions on the named days     (now())
--     3  compose and insert the carried-over day snapshots
--     4  map the replacement's completions on by NAME, not key
--     5  seal and score the carried-over days
--     6  seal and score the named days
--     7  re-point day-numbered private rows
--     8  retire the replacement                <- frees the unique slot
--     9  un-end the archive                    <- only now
--    10  recompute flame and best_flame from the day series
--    11  rewrite the feed item, clear missed_notice_day
--
-- =============================================================================
-- ATOMICITY — and why this file breaks the "no big DO block" habit
-- =============================================================================
--   migrations/README.md rule 1 says assume every statement commits on its own.
--   That rule exists because a half-applied MIGRATION should still leave a
--   coherent database. A half-applied REPAIR cannot: stopping between step 8
--   and step 9 leaves this account with NO live challenge at all.
--
--   Rule 2 gives the way out, and it is exact: "If a group of changes genuinely
--   must be all-or-nothing, put them in a single DO $$ ... $$ block — one
--   statement is one transaction, so a raise inside it discards everything it
--   did. That is the only atomicity available here, and it is real."
--
--   So the mutation is ONE DO block. Every assertion inside it is a real
--   rollback, not the smoke-alarm-in-an-empty-house that rule 5 warns about.
--   No temp tables. No begin/commit. The verification SELECT is the last
--   statement and it is what you read.
--
-- =============================================================================
-- forbid_snapshot_mutation() IS NOT TOUCHED
-- =============================================================================
--   The trigger is `before update or delete on challenge_days`. INSERT is not
--   guarded at all, so composing new day snapshots is unrestricted. On UPDATE
--   it raises only if task_snapshot, day or challenge_id change; sealed_at,
--   evaluated_at and outcome are explicitly permitted, because the evaluator
--   itself writes them. This script changes nothing else on that table, so the
--   guarantee stays armed throughout. Nothing is disabled, relaxed or worked
--   around.
--
-- SAFE TO RUN TWICE. The second run finds the archive already live and the
--   named days already met, logs NO-OP, and changes nothing.
-- =============================================================================


-- =============================================================================
-- PART 1 of 2 — THE REPAIR. One statement, one transaction.
-- =============================================================================
do $$
declare
  -- ------------------------------------------------------------- CONSTANTS --
  -- The account. Parameterised rather than hardcoded to one email so the same
  -- file serves a squadmate who reports the same thing — see
  -- docs/streak-repair-runbook.md.
  P_OWNER uuid := '5212e3ec-29ab-4bb0-b048-41088920e433';

  -- Days on the ARCHIVED challenge the account holder has NAMED, and which the
  -- S1 diagnostic classed `partial` — the app was open, some tasks were
  -- ticked. Empty is refused.
  P_REPAIR_DAYS integer[] := array[15];

  -- Days with NO record at all (`never_opened`: no challenge_days row, no
  -- completions). A SEPARATE list on purpose. There is nothing in the database
  -- corroborating these, so putting a day here has to be a deliberate act
  -- rather than one more number in a row of numbers.
  P_NO_RECORD_DAYS integer[] := array[]::integer[];

  -- Fold the replacement challenge back into the archive and make the archive
  -- live again. False = repair the named days only, leave the restart standing.
  P_RESTORE_FROM_RESTART boolean := true;

  -- 'retire' ends the replacement and keeps it. 'delete' removes it and
  -- cascades its days, completions, custom tasks and workout logs.
  -- RETIRE IS THE DEFAULT AND THE RECOMMENDATION — see the report.
  P_REPLACEMENT_DISPOSITION text := 'retire';

  -- The rewritten feed text. Approved wording goes here.
  P_FEED_TEXT text :=
    'Day 15 was completed. The miss recorded here on 8 September was a '
    || 'forgotten tap, not a missed day, and the record has been corrected.';
  P_FEED_KIND text := 'complete';
  -- ---------------------------------------------------------------------------

  v_arch     public.challenges;
  v_repl     public.challenges;
  v_n        integer;
  v_day      integer;
  v_offset   integer;
  v_snapshot jsonb;
  v_total    integer;
  v_mapped   integer;
  v_missing  text;
  v_flame    integer;
  v_maxeval  integer;
  v_feed     integer;
  v_moved    integer := 0;
begin
  -- ---- 0. refuse an empty instruction --------------------------------------
  if coalesce(array_length(P_REPAIR_DAYS, 1), 0)
   + coalesce(array_length(P_NO_RECORD_DAYS, 1), 0) = 0 then
    raise exception
      'REFUSED: no days named. This script repairs only days the account '
      'holder has named; it never decides for itself which days were done.';
  end if;

  if P_REPLACEMENT_DISPOSITION not in ('retire', 'delete') then
    raise exception 'REFUSED: P_REPLACEMENT_DISPOSITION must be retire or delete, got %',
      P_REPLACEMENT_DISPOSITION;
  end if;

  -- ---- 1. resolve and assert the shape -------------------------------------
  select count(*) into v_n from auth.users where id = P_OWNER;
  if v_n <> 1 then
    raise exception 'REFUSED: % auth.users rows for owner %', v_n, P_OWNER;
  end if;

  select * into v_repl from public.challenges
   where owner = P_OWNER and ended_at is null;

  select count(*) into v_n from public.challenges
   where owner = P_OWNER and ended_at is not null;

  -- IDEMPOTENCY, checked before anything is asserted about a restart: if the
  -- archive is already live and every named day is already met, this has
  -- already run.
  if v_repl.id is not null
     and v_repl.restarted_from is null
     and (select bool_and(public.day_is_met(v_repl.id, d))
            from unnest(P_REPAIR_DAYS || P_NO_RECORD_DAYS) d) then
    raise notice 'NO-OP: challenge % is live and every named day is already met.',
      v_repl.id;
    return;
  end if;

  if v_repl.id is null then
    raise exception 'REFUSED: no live challenge for owner %', P_OWNER;
  end if;

  if P_RESTORE_FROM_RESTART then
    if v_repl.restarted_from is null then
      raise exception
        'REFUSED: the live challenge % has restarted_from NULL, so there is no '
        'archive to restore. Set P_RESTORE_FROM_RESTART := false to repair the '
        'named days in place.', v_repl.id;
    end if;
    select * into v_arch from public.challenges where id = v_repl.restarted_from;
    if v_arch.id is null then
      raise exception 'REFUSED: restarted_from % resolves to no row', v_repl.restarted_from;
    end if;
    if v_arch.ended_reason is distinct from 'missed_day' then
      raise exception
        'REFUSED: archive % ended_reason is %, expected missed_day. This script '
        'restores an attempt ended BY A MISS; anything else needs a human.',
        v_arch.id, coalesce(v_arch.ended_reason, 'NULL');
    end if;
    if v_arch.ended_on_day is null then
      raise exception 'REFUSED: archive % has ended_on_day NULL', v_arch.id;
    end if;
    -- Day N of the replacement is day ended_on_day + N of the archive. The
    -- brief's "no overlap to reconcile" is asserted, not assumed.
    v_offset := v_arch.ended_on_day;
    if v_repl.start_date <> v_arch.start_date + v_offset then
      raise exception
        'REFUSED: the replacement starts %, but archive day % is %. The two do '
        'not line up and the carry-over would put days on the wrong dates.',
        v_repl.start_date, v_offset + 1, v_arch.start_date + v_offset;
    end if;
  else
    v_arch := v_repl;
    v_offset := 0;
  end if;

  -- The named days must be on the archive, closed, and not already met.
  foreach v_day in array (P_REPAIR_DAYS || P_NO_RECORD_DAYS) loop
    if v_day < 1 or v_day > v_arch.duration_days then
      raise exception 'REFUSED: day % is outside 1..% for challenge %',
        v_day, v_arch.duration_days, v_arch.id;
    end if;
    if public.day_is_met(v_arch.id, v_day) then
      raise exception
        'REFUSED: day % is ALREADY met. Naming a day that is already met means '
        'a day has been misidentified — check the S1 grid again.', v_day;
    end if;
  end loop;

  -- P_REPAIR_DAYS must genuinely be the `partial` class; P_NO_RECORD_DAYS must
  -- genuinely have no record. Mixing them up is the thing the two-list rule
  -- exists to prevent, so it is checked rather than trusted.
  foreach v_day in array coalesce(P_REPAIR_DAYS, array[]::integer[]) loop
    select count(*) into v_n from public.task_completions
     where challenge_id = v_arch.id and day = v_day;
    if v_n = 0 then
      raise exception
        'REFUSED: day % is in P_REPAIR_DAYS but has NO completions — that is '
        'the never_opened / zero_ticks class. If you mean to repair it anyway, '
        'move it to P_NO_RECORD_DAYS, which is a deliberate act.', v_day;
    end if;
  end loop;

  foreach v_day in array coalesce(P_NO_RECORD_DAYS, array[]::integer[]) loop
    select count(*) into v_n from public.task_completions
     where challenge_id = v_arch.id and day = v_day;
    if v_n > 0 then
      raise exception
        'REFUSED: day % is in P_NO_RECORD_DAYS but HAS % completion(s). It '
        'belongs in P_REPAIR_DAYS.', v_day, v_n;
    end if;
  end loop;

  -- A day still inside the grace window is finishable in the app, and the
  -- operator path must not become the easy road around seal_day().
  foreach v_day in array (P_REPAIR_DAYS || P_NO_RECORD_DAYS) loop
    if v_day >= public.earliest_open_day(v_arch) and v_arch.ended_at is null then
      raise exception
        'REFUSED: day % is still OPEN (earliest open day is %). Finish it in '
        'the app — it does not need a repair.',
        v_day, public.earliest_open_day(v_arch);
    end if;
  end loop;

  raise notice 'BEFORE: archive % day_now(if live) flame=% best=% ended=% on day %',
    v_arch.id, v_arch.flame, v_arch.best_flame,
    coalesce(v_arch.ended_at::text, 'null'), coalesce(v_arch.ended_on_day, -1);

  -- ---- 2. the named days: insert the missing completions -------------------
  -- Timestamped now() by the column default. Nothing backdated, ever.
  foreach v_day in array (P_REPAIR_DAYS || P_NO_RECORD_DAYS) loop
    -- A no-record day may have no snapshot at all; compose the one the
    -- challenge's own config would have produced for that day.
    insert into public.challenge_days (challenge_id, day, task_snapshot)
    select v_arch.id, v_day, public.compose_task_set(v_arch.id, v_day)
    where not exists (select 1 from public.challenge_days
                       where challenge_id = v_arch.id and day = v_day);

    insert into public.task_completions (challenge_id, day, task_key)
    select v_arch.id, v_day, t->>'key'
      from public.challenge_days d, lateral jsonb_array_elements(d.task_snapshot) t
     where d.challenge_id = v_arch.id and d.day = v_day
    on conflict (challenge_id, day, task_key) do nothing;

    if not public.day_is_met(v_arch.id, v_day) then
      raise exception 'ABORT: day % still not met after inserting completions', v_day;
    end if;
  end loop;

  -- ---- 3..5. carry the replacement's days onto the archive -----------------
  if P_RESTORE_FROM_RESTART then
    for v_day in
      select day from public.challenge_days
       where challenge_id = v_repl.id order by day
    loop
      -- 3. the snapshot comes from the ARCHIVE's own config, never copied.
      insert into public.challenge_days (challenge_id, day, task_snapshot)
      select v_arch.id, v_day + v_offset,
             public.compose_task_set(v_arch.id, v_day + v_offset)
      where not exists (select 1 from public.challenge_days
                         where challenge_id = v_arch.id and day = v_day + v_offset);

      -- 4. THE NAME MAPPING. Custom task keys are 'custom-' || custom_tasks.id
      -- and restart_challenge() re-inserted every custom against the new
      -- challenge, so the ids DIFFER while the names match. Copying keys
      -- verbatim would write completions naming tasks that are not in the
      -- archive's snapshot — day_is_met() ignores those, so the day would look
      -- full and score as missed. Map on shortName, which is the same string
      -- on both sides for standard and custom tasks alike.
      insert into public.task_completions (challenge_id, day, task_key)
      select v_arch.id, v_day + v_offset, a.task->>'key'
        from public.challenge_days da,
             lateral jsonb_array_elements(da.task_snapshot) a(task)
       where da.challenge_id = v_arch.id and da.day = v_day + v_offset
         and exists (
           select 1
             from public.challenge_days dr,
                  lateral jsonb_array_elements(dr.task_snapshot) r(task)
             join public.task_completions tc
               on tc.challenge_id = v_repl.id
              and tc.day = v_day
              and tc.task_key = r.task->>'key'
            where dr.challenge_id = v_repl.id and dr.day = v_day
              and r.task->>'shortName' = a.task->>'shortName')
      on conflict (challenge_id, day, task_key) do nothing;

      -- The 5-for-5 + 6 assertion the brief asks for, generalised: every task
      -- the replacement had completed must have landed, and nothing may
      -- reference a key outside the archive's snapshot.
      select count(*) into v_total from public.task_completions
       where challenge_id = v_repl.id and day = v_day;
      select count(*) into v_mapped from public.task_completions tc
       where tc.challenge_id = v_arch.id and tc.day = v_day + v_offset
         and exists (select 1 from public.challenge_days d,
                          lateral jsonb_array_elements(d.task_snapshot) t
                      where d.challenge_id = v_arch.id and d.day = v_day + v_offset
                        and t->>'key' = tc.task_key);

      if v_mapped <> v_total then
        select string_agg(r.task->>'shortName', ', ') into v_missing
          from public.challenge_days dr,
               lateral jsonb_array_elements(dr.task_snapshot) r(task)
          join public.task_completions tc
            on tc.challenge_id = v_repl.id and tc.day = v_day
           and tc.task_key = r.task->>'key'
         where dr.challenge_id = v_repl.id and dr.day = v_day
           and not exists (
             select 1 from public.challenge_days da,
                          lateral jsonb_array_elements(da.task_snapshot) a(task)
              where da.challenge_id = v_arch.id and da.day = v_day + v_offset
                and a.task->>'shortName' = r.task->>'shortName');
        raise exception
          'ABORT: replacement day % had % completion(s); only % mapped onto '
          'archive day %. Unmatched by name: %. The task sets do not '
          'correspond and a partial carry-over would produce a broken day.',
          v_day, v_total, v_mapped, v_day + v_offset, coalesce(v_missing, '(none)');
      end if;

      select count(*) into v_n from public.task_completions tc
       where tc.challenge_id = v_arch.id and tc.day = v_day + v_offset
         and not exists (select 1 from public.challenge_days d,
                              lateral jsonb_array_elements(d.task_snapshot) t
                          where d.challenge_id = v_arch.id and d.day = v_day + v_offset
                            and t->>'key' = tc.task_key);
      if v_n > 0 then
        raise exception
          'ABORT: archive day % has % completion(s) naming keys outside its '
          'own snapshot.', v_day + v_offset, v_n;
      end if;

      -- 5. seal and score, but ONLY a day that is genuinely complete. A
      -- partially-done carried day (today, in progress) is left open on
      -- purpose — that is the day the user finishes in the app.
      if public.day_is_met(v_arch.id, v_day + v_offset) then
        update public.challenge_days
           set sealed_at    = coalesce(sealed_at, now()),
               evaluated_at = now(),
               outcome      = 'met'
         where challenge_id = v_arch.id and day = v_day + v_offset;
      end if;
    end loop;
  end if;

  -- ---- 6. score the named days ---------------------------------------------
  foreach v_day in array (P_REPAIR_DAYS || P_NO_RECORD_DAYS) loop
    update public.challenge_days
       set sealed_at    = coalesce(sealed_at, now()),
           evaluated_at = now(),
           outcome      = 'met'
     where challenge_id = v_arch.id and day = v_day;
  end loop;

  -- ---- 7. re-point day-numbered private rows -------------------------------
  -- NOT IN THE BRIEF, and required by it anyway. journal_entries, meals and
  -- milestones are keyed on (owner, day) with no challenge_id — the Phase 15
  -- lesson — so a journal entry written on 8 September sits at day 1. Restore
  -- the archive and day 1 becomes 24 August, and the app would render that
  -- entry on the wrong date: the UI asserting something that did not happen,
  -- which is the one rule this repair may not break.
  --
  -- The discriminator is created_at against the restart instant, NOT the day
  -- number: the genuine day-1 rows from 24 August share day = 1 and must not
  -- move. Descending order so day 2 -> 17 lands before day 1 -> 16 and the
  -- rows are never renumbered twice.
  if P_RESTORE_FROM_RESTART then
    for v_day in
      select day from public.challenge_days
       where challenge_id = v_repl.id order by day desc
    loop
      update public.journal_entries
         set day = v_day + v_offset
       where owner = P_OWNER and day = v_day
         and created_at >= v_arch.ended_at;
      get diagnostics v_n = row_count; v_moved := v_moved + v_n;

      update public.meals
         set day = v_day + v_offset
       where owner = P_OWNER and day = v_day
         and created_at >= v_arch.ended_at;
      get diagnostics v_n = row_count; v_moved := v_moved + v_n;

      update public.milestones
         set hit_on_day = v_day + v_offset
       where owner = P_OWNER and hit_on_day = v_day
         and created_at >= v_arch.ended_at;
      get diagnostics v_n = row_count; v_moved := v_moved + v_n;

      -- workout_logs carries challenge_id, so it needs both re-pointed. If the
      -- replacement were DELETED these would cascade away entirely, which is
      -- one of the reasons retire is the default.
      update public.workout_logs
         set challenge_id = v_arch.id, day = v_day + v_offset
       where owner = P_OWNER and challenge_id = v_repl.id and day = v_day;
      get diagnostics v_n = row_count; v_moved := v_moved + v_n;
    end loop;
    raise notice 're-pointed % day-numbered private row(s)', v_moved;
  end if;

  -- ---- 8. retire the replacement — FREES THE UNIQUE SLOT --------------------
  if P_RESTORE_FROM_RESTART then
    if P_REPLACEMENT_DISPOSITION = 'delete' then
      delete from public.challenges where id = v_repl.id;
    else
      update public.challenges
         set ended_at     = now(),
             ended_reason = null,
             ended_on_day = (select coalesce(max(day), 1) from public.challenge_days
                              where challenge_id = v_repl.id)
       where id = v_repl.id;
    end if;

    -- ---- 9. un-end the archive — ONLY NOW ----------------------------------
    update public.challenges
       set ended_at          = null,
           ended_reason      = null,
           ended_on_day      = null,
           missed_notice_day = null
     where id = v_arch.id;
  else
    update public.challenges set missed_notice_day = null where id = v_arch.id;
  end if;

  -- ---- 10. recompute flame from the day series -----------------------------
  -- A consequence of the days, never a number typed in. The flame is the
  -- trailing unbroken run of met days, counted over days that have CLOSED or
  -- been sealed — today, still open and half done, must not break it.
  select * into v_arch from public.challenges where id = v_arch.id;

  select greatest(
           coalesce((select max(day) from public.challenge_days
                      where challenge_id = v_arch.id and sealed_at is not null), 0),
           coalesce(public.last_closed_day(v_arch), 0))
    into v_maxeval;

  select count(*) into v_flame from (
    select d.day,
           sum(case when public.day_is_met(v_arch.id, d.day) then 0 else 1 end)
             over (order by d.day desc rows between unbounded preceding and current row)
             as breaks
      from generate_series(1, greatest(v_maxeval, 1)) as d(day)
  ) t where t.breaks = 0;

  update public.challenges
     set flame              = v_flame,
         best_flame         = greatest(best_flame, v_flame),
         last_evaluated_day = greatest(last_evaluated_day, v_maxeval)
   where id = v_arch.id;

  -- ---- 11. the feed, rewritten and never deleted ---------------------------
  -- Phase 15's rule. The squad saw the miss; nothing unsees it. But leaving a
  -- sentence that is now false is the thing that cannot stand.
  update public.feed_items
     set text = P_FEED_TEXT,
         kind = P_FEED_KIND
   where author = P_OWNER
     and kind = 'miss'
     and text like ('%Day ' || P_REPAIR_DAYS[1] || '.%')
     and text not like '%late.%';
  get diagnostics v_feed = row_count;
  raise notice 'rewrote % feed item(s)', v_feed;

  raise notice 'AFTER: challenge % flame=% best=% live=%',
    v_arch.id, v_flame, greatest(v_arch.best_flame, v_flame),
    (select ended_at is null from public.challenges where id = v_arch.id);
end $$;



-- =============================================================================
-- PART 2 of 2 — THE VERIFICATION SELECT. Read this grid with your own eyes.
--
-- REWRITTEN 2026-09-10. The first version pinned its expectations to the
-- target state in the S3 brief: flame = 16, day 17 = 0/11, "earliest
-- completion is today". Every one of those is a fact about ONE DAY, and the
-- rehearsal fixture was built from the same constants, so check and fixture
-- agreed by construction and the staleness could not surface. A day later,
-- with day 17 legitimately completed, three rows read FINDING against a
-- database that was correct.
--
-- So nothing here is pinned to a date, a day number or a flame value. Every
-- expectation is either derived from the rows or is an invariant that holds
-- on any day:
--
--   * flame is compared against the run RECOMPUTED from the day series, so
--     the check says "the stored number agrees with the days" rather than
--     "the stored number is 16".
--   * the repaired days are DERIVED, not listed. Inside a PL/pgSQL block
--     now() is the TRANSACTION timestamp, so every row the repair inserted
--     and every evaluated_at it stamped carry one identical instant. That
--     instant is the run's fingerprint and identifies its own work exactly.
--   * "nothing backdated" is scoped to rows the repair WROTE. The old check
--     took min(completed_at) across the whole repaired day, which includes
--     the original ticks that legitimately pre-date the run — it was asking
--     "is anything on this day old", not "did we write anything old".
--   * days completed since the repair are not expected to be untouched. The
--     invariant is that no day is scored met unless it IS met.
--
-- The only thing still written by hand is the account, which must match
-- P_OWNER above.
-- =============================================================================
with me as (select '5212e3ec-29ab-4bb0-b048-41088920e433'::uuid as uid),
live as (select * from public.challenges
          where owner = (select uid from me) and ended_at is null),
retired as (select * from public.challenges
             where owner = (select uid from me) and ended_at is not null),
-- THE RUN'S FINGERPRINT, and it has to be exact rather than "most recent" or
-- "most common". Picking the commonest evaluated_at grabs whichever bulk
-- judgement happens to be largest — in rehearsal that was days 2-14, and the
-- report confidently described the fixture's work as the repair's.
--
-- The precise signature: the repair INSERTED completions and STAMPED
-- evaluated_at inside one transaction, so both carry the identical now().
-- The evaluator stamps evaluated_at but never inserts a completion, and the
-- app inserts completions but never stamps evaluated_at. So an instant that
-- appears in BOTH columns belongs to a repair and to nothing else.
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
touched as (
  select d.day from public.challenge_days d
   where d.challenge_id = (select id from live)
     and d.evaluated_at = (select at from run)
),
wrote as (
  select tc.day, tc.task_key, tc.completed_at,
         (select start_date + (tc.day - 1) from live) as day_local_date
    from public.task_completions tc
   where tc.challenge_id = (select id from live)
     and tc.completed_at = (select at from run)
),
days as (
  select d.day, d.outcome, d.sealed_at, d.evaluated_at,
         jsonb_array_length(d.task_snapshot) as total,
         (select count(*) from public.task_completions tc
           where tc.challenge_id = d.challenge_id and tc.day = d.day
             and exists (select 1 from jsonb_array_elements(d.task_snapshot) t
                          where t->>'key' = tc.task_key)) as done,
         public.day_is_met(d.challenge_id, d.day) as met
    from public.challenge_days d
   where d.challenge_id = (select id from live)
),
maxeval as (
  select greatest(
           coalesce((select max(day) from days where sealed_at is not null), 0),
           coalesce((select public.last_closed_day(live.*) from live), 0)) as d
),
computed_flame as (
  select count(*) as n from (
    select g.day,
           sum(case when public.day_is_met((select id from live), g.day) then 0 else 1 end)
             over (order by g.day desc rows between unbounded preceding and current row) as breaks
      from generate_series(1, greatest((select d from maxeval), 1)) as g(day)
  ) t where t.breaks = 0
)
select * from (
  select 1 as ord, 'live challenges'::text as item,
         'exactly 1'::text as expected,
         (select count(*)::text from live) as actual,
         case when (select count(*) from live) = 1 then 'OK' else 'FINDING' end as verdict

  union all
  select 2, 'the live challenge is the restored one',
         'restarted_from null, a retired attempt points at it',
         coalesce((select 'start ' || start_date || ', day '
                          || public.challenge_day(live.*) || ' of ' || duration_days
                     from live), 'none'),
         case when (select restarted_from from live) is null
               and exists (select 1 from retired
                            where restarted_from = (select id from live))
              then 'OK' else 'FINDING' end

  union all
  select 3, 'flame agrees with the day series',
         (select n::text from computed_flame) || ' (recomputed from the days)',
         (select flame::text from live),
         case when (select flame from live) = (select n from computed_flame)
              then 'OK' else 'FINDING — stored flame disagrees with the days' end

  union all
  select 4, 'best_flame is at least flame',
         '>= flame', (select best_flame::text from live),
         case when (select best_flame from live) >= (select flame from live)
              then 'OK' else 'FINDING' end

  union all
  select 5, 'days the repair scored',
         'each one met and sealed',
         (select string_agg(day::text, ', ' order by day) from touched),
         case when not exists (select 1 from days d join touched t on t.day = d.day
                                where not d.met or d.sealed_at is null
                                   or d.outcome is distinct from 'met')
              then 'OK' else 'FINDING' end

  union all
  select 6, 'INVARIANT: no day scored met that is not met',
         '0 such days',
         (select count(*)::text from days where outcome = 'met' and not met),
         case when (select count(*) from days where outcome = 'met' and not met) = 0
              then 'OK' else 'FINDING — a day claims a completion it does not have' end

  union all
  select 7, 'INVARIANT: no day sealed that is not met',
         '0 such days',
         (select count(*)::text from days where sealed_at is not null and not met),
         case when (select count(*) from days where sealed_at is not null and not met) = 0
              then 'OK' else 'FINDING' end

  union all
  select 8, 'INVARIANT: no completion names a key outside its own snapshot',
         '0 such rows',
         (select count(*)::text from public.task_completions tc
           where tc.challenge_id = (select id from live)
             and not exists (select 1 from public.challenge_days d,
                                  lateral jsonb_array_elements(d.task_snapshot) t
                              where d.challenge_id = tc.challenge_id and d.day = tc.day
                                and t->>'key' = tc.task_key)),
         case when (select count(*) from public.task_completions tc
                     where tc.challenge_id = (select id from live)
                       and not exists (select 1 from public.challenge_days d,
                                            lateral jsonb_array_elements(d.task_snapshot) t
                                        where d.challenge_id = tc.challenge_id and d.day = tc.day
                                          and t->>'key' = tc.task_key)) = 0
              then 'OK — the name mapping landed' else 'FINDING' end

  union all
  select 9, 'NOTHING BACKDATED: rows the repair wrote, dated on or before their own day',
         '0 such rows',
         (select count(*)::text from wrote where completed_at::date <= day_local_date),
         case when (select count(*) from wrote where completed_at::date <= day_local_date) = 0
              then 'OK — every row it wrote is stamped after the day it belongs to'
              else 'VIOLATION' end

  union all
  select 10, 'what the repair wrote, and when',
         (select count(*)::text || ' completion row(s)' from wrote),
         (select to_char(at, 'YYYY-MM-DD HH24:MI:SS TZ') from run),
         'one instant, because now() is the transaction timestamp'

  union all
  select 11, 'the retired replacement',
         'ended, reason null',
         coalesce((select 'ended ' || coalesce(ended_reason, '<null>')
                          || ' on day ' || ended_on_day
                     from retired where restarted_from = (select id from live)),
                  'DELETED or absent'),
         case when exists (select 1 from retired
                            where restarted_from = (select id from live)
                              and ended_reason is null)
              then 'OK' else 'read it' end

  union all
  select 12, 'feed items still asserting a miss',
         'only ones that are true',
         (select count(*)::text from public.feed_items
           where author = (select uid from me) and kind = 'miss'),
         'read the text yourself — a count cannot judge a sentence'

  union all
  select 13, 'missed_notice_day cleared',
         'null', coalesce((select missed_notice_day::text from live), 'null'),
         case when (select missed_notice_day from live) is null then 'OK' else 'FINDING' end

  union all
  select 14, 'today',
         'reported, not asserted — you may have completed it',
         (select 'day ' || public.challenge_day(live.*) || ': '
                 || coalesce((select done || '/' || total || ' '
                                     || coalesce(outcome, 'unjudged')
                                from days where day = public.challenge_day(live.*)),
                             'not frozen yet')
            from live),
         'informational'
) v order by ord;
