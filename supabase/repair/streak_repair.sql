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
-- CURRENTLY SET FOR: PHASE 22 — archive 7729ffa2, day 19, ZERO ticks.
--   The Phase 18 run (day 15, nine ticks) is the shape this file was born for.
--   What Phase 22 changed is documented below, not overwritten.
--
-- =============================================================================
-- THE STATE THIS ASSUMES BEFORE IT RUNS
-- =============================================================================
--   * exactly one auth.users row for P_OWNER
--   * exactly one LIVE challenge for that owner
--   * if P_RESTORE_FROM_RESTART: the live one's restarted_from points at an
--     ENDED challenge whose ended_reason is 'missed_day'. The owner may hold
--     any number of OTHER ended challenges — PHASE 22: this account also holds
--     the Phase 18 replacement (ff81767a), already retired, which points at
--     the same archive. Nothing here may assume "exactly one ended row".
--   * every day in P_REPAIR_DAYS exists on the archive, is CLOSED, is not
--     already met, and has at least one completion (the `partial` evidence
--     class from the S1 diagnostic)
--   * every day in P_NO_RECORD_DAYS is CLOSED and has NO completions. Two
--     sub-classes live here and both are handled — see "THE EMPTY DAY".
--   * the replacement's days map onto the archive with no overlap
--
-- Any of these being false aborts the whole thing. See "atomicity" below.
--
-- =============================================================================
-- THE EMPTY DAY — WHAT PHASE 22 CHANGED
-- =============================================================================
--   Phase 18 repaired day 15, which had NINE of eleven ticks. The repair-day
--   path (P_REPAIR_DAYS) REFUSES a day with zero completions, on purpose: a
--   day with some ticks is corroborated by the database, a day with none is
--   corroborated by nothing but the account holder's word. That refusal is
--   still here and it still fires. SO YES — the repair-day path assumes a
--   partial day, and Phase 22's day 19 is not one.
--
--   Day 19 — a challenge_days row, outcome 'missed', sealed_at null, eleven
--   tasks in task_snapshot, ZERO task_completions — belongs in
--   P_NO_RECORD_DAYS, the deliberate-act list. That list spans two sub-classes
--   and now says which one each day is:
--
--     never_opened   no challenge_days row at all. The snapshot is composed
--                    from the challenge's own config before anything else.
--     zero_ticks     the row exists (the evaluator back-filled it, or the app
--                    froze it) and carries a snapshot, but nothing was ticked.
--                    PHASE 22's day 19 is this one.
--
--   Both end in the same place — insert every key in that day's own snapshot —
--   and the distinction is logged rather than branched on, because the only
--   difference is whether the snapshot already existed. A zero_ticks day keeps
--   the snapshot that was frozen ON the day; it is never recomposed.
--
--   ONE TRAP THE EMPTY CASE OPENS THAT THE PARTIAL CASE CANNOT.
--   day_is_met() returns TRUE for a day whose snapshot is an empty array
--   ("nothing to do is not a failure", 0007). A day with no completions AND an
--   empty snapshot would therefore pass the post-insert assertion having had
--   nothing whatsoever written to it. On a partial day that is impossible — a
--   completion exists, so the snapshot cannot be empty. The guard below is new
--   and that is why: a repaired day must have at least one task in it.
--
-- =============================================================================
-- WHAT IT DOES NOT MEAN
-- =============================================================================
--   It does NOT mean the days were ticked when they happened. Every row it
--   writes is timestamped now(), days after the fact, deliberately. That gap
--   IS the record that a repair happened — it is the only trace, by choice,
--   and it is why nothing here is backdated.
--
--   It does NOT decide which days you did. It repairs the days named in the
--   constants and refuses everything else, including days it can see were
--   nearly complete.
--
-- =============================================================================
-- THE FEED ITEM — A DELIBERATE DEPARTURE FROM PHASE 15's RULE, FLAGGED
-- =============================================================================
--   Phase 15 set the rule: the miss feed item is REWRITTEN, never deleted. The
--   squad saw the miss on the day; deleting the row cannot unsend it, and a
--   rewrite leaves a visible, honest correction where the false sentence was.
--
--   The Phase 22 brief asks for a DELETE of one named feed item instead. That
--   is the account holder's call about their own squad feed and it is
--   implemented — but it IS a departure, so it is a switch rather than a
--   silent edit. P_FEED_DISPOSITION := 'rewrite' restores Phase 15's behaviour
--   in one word, and P_FEED_TEXT is still here for it.
--
--   The delete is addressed BY ID and refuses to fire unless the row it finds
--   is the row the brief described — same author, same squad, same kind, same
--   text. A mistyped uuid deletes nothing; it aborts.
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
--    10  recompute flame, best_flame and the evaluator's cursor from the days
--    11  the feed item, deleted or rewritten; missed_notice_day already null
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
--   This is also what makes "nothing is backdated" STRUCTURAL rather than a
--   promise. Inside a PL/pgSQL block now() is the TRANSACTION timestamp, so
--   every completion this inserts and every evaluated_at it stamps carry one
--   identical instant — the run instant. There is not one assignment below
--   that sets a timestamp to anything other than now(), and the guarantee is
--   not being weakened for this run.
--
-- =============================================================================
-- forbid_snapshot_mutation() IS NOT TOUCHED
-- =============================================================================
--   The trigger is `before update or delete on challenge_days`. INSERT is not
--   guarded at all, so composing new day snapshots is unrestricted. Its UPDATE
--   arm, quoted verbatim from supabase/migrations/0007_missed_day_engine.sql
--   (lines 312-320):
--
--       if new.task_snapshot is distinct from old.task_snapshot
--          or new.day is distinct from old.day
--          or new.challenge_id is distinct from old.challenge_id then
--         raise exception 'day snapshots are immutable';
--       end if;
--       -- sealed_at, evaluated_at and outcome are the only permitted changes.
--       return new;
--
--   THE THREE COLUMNS THIS SCRIPT UPDATES ON challenge_days, CHECKED AGAINST
--   THAT LIST:
--       sealed_at     PERMITTED — named in the permitted comment, absent from
--                     the raise test.
--       evaluated_at  PERMITTED — same.
--       outcome       PERMITTED — same.
--   All three are in it. Nothing else on challenge_days is written, so the
--   trigger stays armed throughout and nothing is disabled, relaxed or worked
--   around. 'missed' -> 'met' is the value a met day carries, and it satisfies
--   the column's own constraint: outcome is null or outcome in ('met','missed')
--   (0007, line 99).
--
-- =============================================================================
-- WHAT THIS SCRIPT DOES NOT TOUCH
-- =============================================================================
--   grace_deadline_hour(), day_closes_at(), earliest_open_day(),
--   last_closed_day(), day_is_open() and seal_day() are read, never written.
--   No migration is applied, no function is replaced, no trigger is disabled.
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

  -- PHASE 22. The brief names the exact two challenges. Asserting them costs
  -- one comparison and turns "the script ran against the wrong attempt" from a
  -- silent success into an abort. NULL skips the check.
  P_EXPECT_ARCHIVE     uuid := '7729ffa2-3679-410f-b7c8-98554504c2be';
  P_EXPECT_REPLACEMENT uuid := '3ad49dc5-e7b8-4a0d-9ecb-8ec5a2ba99c3';

  -- THE DATE GUARD. This run is written for ONE evening: the local date on
  -- which archive day 20 and replacement day 1 are the same calendar day, and
  -- on which the replacement has exactly one day to carry. At 12:01 AM local
  -- that stops being true — the replacement grows a day 2, the archive grows a
  -- day 21, and the carry-over takes a path nothing has rehearsed. The script
  -- would still do something defensible; "defensible" is not the standard for
  -- a hand-run repair. It refuses instead, and the constant is what you edit
  -- to re-aim it after re-rehearsing. NULL skips the check entirely.
  P_EXPECT_LOCAL_DATE date := date '2026-09-12';

  -- Days on the ARCHIVED challenge the account holder has NAMED, and which the
  -- S1 diagnostic classed `partial` — the app was open, some tasks were
  -- ticked. A day with ZERO ticks is REFUSED here and belongs below.
  P_REPAIR_DAYS integer[] := array[]::integer[];

  -- Days with NO completions at all: either `never_opened` (no challenge_days
  -- row) or `zero_ticks` (a row exists, nothing was ticked). A SEPARATE list on
  -- purpose. There is nothing in the database corroborating these, so putting a
  -- day here has to be a deliberate act rather than one more number in a row of
  -- numbers.
  --
  -- PHASE 22: day 19 is `zero_ticks`.
  P_NO_RECORD_DAYS integer[] := array[19];

  -- Fold the replacement challenge back into the archive and make the archive
  -- live again. False = repair the named days only, leave the restart standing.
  P_RESTORE_FROM_RESTART boolean := true;

  -- 'retire' ends the replacement and keeps it. 'delete' removes it and
  -- cascades its days, completions, custom tasks and workout logs.
  -- RETIRE IS THE DEFAULT AND THE RECOMMENDATION — see the report.
  P_REPLACEMENT_DISPOSITION text := 'retire';

  -- THE FEED ITEM. 'delete' | 'rewrite' | 'none'. See the header block.
  P_FEED_DISPOSITION text := 'delete';

  -- Addressed by id, and refused unless it is the row the brief described.
  P_FEED_ITEM_ID      uuid := '475bf99b-f485-4df2-9f22-a584cfdcd123';
  P_FEED_EXPECT_SQUAD uuid := '1ffcc0c5-3578-4d89-bb67-16be6fd3bcf0';
  P_FEED_EXPECT_KIND  text := 'miss';
  P_FEED_EXPECT_TEXT  text :=
    'missed Day 19. Hard rules — the challenge restarts at Day 1.';

  -- Only read when P_FEED_DISPOSITION = 'rewrite'.
  P_FEED_TEXT text :=
    'Day 19 was completed. The miss recorded here was a forgotten tap, not a '
    || 'missed day, and the record has been corrected.';
  P_FEED_KIND text := 'complete';
  -- ---------------------------------------------------------------------------

  v_arch     public.challenges;
  v_repl     public.challenges;
  v_n        integer;
  v_day      integer;
  v_offset   integer;
  v_total    integer;
  v_mapped   integer;
  v_missing  text;
  v_flame    integer;
  v_maxeval  integer;
  v_cursor   integer;
  v_feed     integer;
  v_ftext    text;
  v_fsquad   uuid;
  v_fkind    text;
  v_moved    integer := 0;
  v_tasks    integer;
  v_class    text;
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

  if P_FEED_DISPOSITION not in ('delete', 'rewrite', 'none') then
    raise exception 'REFUSED: P_FEED_DISPOSITION must be delete, rewrite or none, got %',
      P_FEED_DISPOSITION;
  end if;

  if P_FEED_DISPOSITION in ('delete', 'rewrite') and P_FEED_ITEM_ID is null then
    raise exception 'REFUSED: P_FEED_DISPOSITION is % but P_FEED_ITEM_ID is null.',
      P_FEED_DISPOSITION;
  end if;

  -- ---- 1. resolve and assert the shape -------------------------------------
  select count(*) into v_n from auth.users where id = P_OWNER;
  if v_n <> 1 then
    raise exception 'REFUSED: % auth.users rows for owner %', v_n, P_OWNER;
  end if;

  select * into v_repl from public.challenges
   where owner = P_OWNER and ended_at is null;

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

    -- PHASE 22. The brief names both ids; check them rather than hope.
    if P_EXPECT_ARCHIVE is not null and v_arch.id <> P_EXPECT_ARCHIVE then
      raise exception
        'REFUSED: resolved archive % is not the expected %. The wrong attempt '
        'is about to be restored.', v_arch.id, P_EXPECT_ARCHIVE;
    end if;
    if P_EXPECT_REPLACEMENT is not null and v_repl.id <> P_EXPECT_REPLACEMENT then
      raise exception
        'REFUSED: resolved live challenge % is not the expected %.',
        v_repl.id, P_EXPECT_REPLACEMENT;
    end if;

    -- Day N of the replacement is day ended_on_day + N of the archive. The
    -- brief's "no overlap to reconcile" is asserted, not assumed. It is also
    -- what makes the carry-over a CALENDAR-DATE carry-over: replacement day 1
    -- and archive day ended_on_day + 1 are the same local date, by this
    -- equation, or the run refuses.
    v_offset := v_arch.ended_on_day;
    if v_repl.start_date <> v_arch.start_date + v_offset then
      raise exception
        'REFUSED: the replacement starts %, but archive day % is %. The two do '
        'not line up and the carry-over would put days on the wrong dates.',
        v_repl.start_date, v_offset + 1, v_arch.start_date + v_offset;
    end if;

    -- The carry-over must fit inside the archive's own length. A 30-day
    -- challenge restarted on day 29 has room for two carried days and no more;
    -- day 31 is a day that challenge does not have.
    select coalesce(max(day), 0) into v_n from public.challenge_days
     where challenge_id = v_repl.id;
    if v_n + v_offset > v_arch.duration_days then
      raise exception
        'REFUSED: the replacement reaches day %, which maps to archive day % — '
        'past the archive''s own length of %. A human has to decide what a '
        'restored challenge past its own end even means.',
        v_n, v_n + v_offset, v_arch.duration_days;
    end if;
  else
    v_arch := v_repl;
    v_offset := 0;
  end if;

  -- ---- 1a. THE DATE GUARD -------------------------------------------------
  -- Checked against the CHALLENGE's timezone, not the server's and not the SQL
  -- editor session's, because every day boundary in this schema is a local one
  -- (0011, challenge_local_now / day_closes_at). Placed after the shape is
  -- resolved and before a single row is written, so a refusal costs nothing.
  --
  -- It sits BELOW the idempotency NO-OP on purpose: re-running this file on a
  -- later day, after it has already succeeded, should still say NO-OP rather
  -- than shout about the date.
  if P_EXPECT_LOCAL_DATE is not null
     and (now() at time zone v_arch.timezone)::date <> P_EXPECT_LOCAL_DATE then
    raise exception
      'REFUSED: it is % in %, and this repair is written for % and for that '
      'evening only. On %, and only then, the replacement has exactly one day '
      'to carry onto archive day %; on any other date it has more, the archive '
      'has days past that one, and the carry-over takes a path nothing has '
      'rehearsed. Nothing has been written. Re-rehearse against the real '
      'shape, then set P_EXPECT_LOCAL_DATE to the day you are running.',
      (now() at time zone v_arch.timezone)::date, v_arch.timezone,
      P_EXPECT_LOCAL_DATE, P_EXPECT_LOCAL_DATE, v_offset + 1;
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
    -- Which of the two empty sub-classes this is. Logged, not branched on.
    select case when count(*) = 0 then 'never_opened' else 'zero_ticks' end
      into v_class
      from public.challenge_days where challenge_id = v_arch.id and day = v_day;
    raise notice 'day % is the % class — no completions at all', v_day, v_class;
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

  raise notice 'BEFORE: archive % flame=% best=% last_evaluated_day=% ended=% on day %',
    v_arch.id, v_arch.flame, v_arch.best_flame, v_arch.last_evaluated_day,
    coalesce(v_arch.ended_at::text, 'null'), coalesce(v_arch.ended_on_day, -1);

  -- ---- 2. the named days: insert the missing completions -------------------
  -- Timestamped now() by the column default. Nothing backdated, ever.
  foreach v_day in array (P_REPAIR_DAYS || P_NO_RECORD_DAYS) loop
    -- A never_opened day has no snapshot at all; compose the one the
    -- challenge's own config would have produced for that day. A zero_ticks
    -- day already has one and this inserts nothing — the snapshot frozen ON
    -- the day is the snapshot that is used.
    insert into public.challenge_days (challenge_id, day, task_snapshot)
    select v_arch.id, v_day, public.compose_task_set(v_arch.id, v_day)
    where not exists (select 1 from public.challenge_days
                       where challenge_id = v_arch.id and day = v_day);

    -- THE EMPTY-SNAPSHOT GUARD. day_is_met() returns true for a zero-length
    -- snapshot, so without this a day could be declared met having had nothing
    -- written to it at all. Only reachable from the zero-completion path,
    -- which is exactly the path Phase 22 takes.
    select jsonb_array_length(task_snapshot) into v_tasks
      from public.challenge_days where challenge_id = v_arch.id and day = v_day;
    if coalesce(v_tasks, 0) = 0 then
      raise exception
        'ABORT: day % has an empty task_snapshot. day_is_met() would call that '
        'day met without a single completion being written. Refusing to score '
        'a day that has no tasks in it.', v_day;
    end if;

    insert into public.task_completions (challenge_id, day, task_key)
    select v_arch.id, v_day, t->>'key'
      from public.challenge_days d, lateral jsonb_array_elements(d.task_snapshot) t
     where d.challenge_id = v_arch.id and d.day = v_day
    on conflict (challenge_id, day, task_key) do nothing;
    get diagnostics v_n = row_count;

    raise notice 'day %: wrote % completion(s); its snapshot holds % task(s)',
      v_day, v_n, v_tasks;

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
      -- 3. THE SNAPSHOT COMES FROM THE ARCHIVE'S OWN CONFIG, NEVER COPIED.
      -- The replacement's keys are 'custom-' || <the replacement's own uuids>
      -- and are wrong for this challenge; composing is what makes them right.
      insert into public.challenge_days (challenge_id, day, task_snapshot)
      select v_arch.id, v_day + v_offset,
             public.compose_task_set(v_arch.id, v_day + v_offset)
      where not exists (select 1 from public.challenge_days
                         where challenge_id = v_arch.id and day = v_day + v_offset);

      -- The name mapping is only sound if shortName identifies a task uniquely
      -- on both sides. Two customs called the same thing would make the counts
      -- below lie, so it is checked before it is relied on.
      select count(*) into v_n from (
        select t->>'shortName' as sn
          from public.challenge_days d, lateral jsonb_array_elements(d.task_snapshot) t
         where d.challenge_id = v_arch.id and d.day = v_day + v_offset
         group by 1 having count(*) > 1) x;
      if v_n > 0 then
        raise exception
          'ABORT: archive day % has % duplicated task name(s); a name mapping '
          'cannot be trusted against it.', v_day + v_offset, v_n;
      end if;
      select count(*) into v_n from (
        select t->>'shortName' as sn
          from public.challenge_days d, lateral jsonb_array_elements(d.task_snapshot) t
         where d.challenge_id = v_repl.id and d.day = v_day
         group by 1 having count(*) > 1) x;
      if v_n > 0 then
        raise exception
          'ABORT: replacement day % has % duplicated task name(s).', v_day, v_n;
      end if;

      -- 4. THE NAME MAPPING. Custom task keys are 'custom-' || custom_tasks.id
      -- and restart_challenge() re-inserted every custom against the new
      -- challenge, so the ids DIFFER while the names match. Copying keys
      -- verbatim would write completions naming tasks that are not in the
      -- archive's snapshot — day_is_met() ignores those, so the day would look
      -- full and score as missed. Map on shortName, which is the same string
      -- on both sides for standard and custom tasks alike.
      --
      -- READ AT RUN TIME. Nothing here knows or cares how many tasks the
      -- account holder ticked; it carries whatever is in task_completions at
      -- the instant this runs. No count is hardcoded anywhere below.
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

      -- Every task the replacement had completed must have landed, and nothing
      -- may reference a key outside the archive's snapshot.
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

      raise notice 'carried replacement day % -> archive day %: % of % task(s) ticked',
        v_day, v_day + v_offset, v_mapped,
        (select jsonb_array_length(task_snapshot) from public.challenge_days
          where challenge_id = v_arch.id and day = v_day + v_offset);

      -- 5. seal and score, but ONLY a day that is genuinely complete. A
      -- partially-done carried day (today, in progress) is left open on
      -- purpose — that is the day the user finishes in the app, and seal_day()
      -- pays its flame then.
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
  -- outcome 'missed' -> 'met', and sealed_at set. Both, plus evaluated_at, are
  -- on forbid_snapshot_mutation()'s permitted list — quoted in full above.
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
  -- lesson — so a journal entry written tonight sits at day 1. Restore the
  -- archive and day 1 means the start date, and the app would render that
  -- entry on the wrong date: the UI asserting something that did not happen,
  -- which is the one rule this repair may not break.
  --
  -- The discriminator is created_at against the restart instant, NOT the day
  -- number: the genuine day-1 rows from the real day 1 share day = 1 and must
  -- not move. Descending order so the highest day lands first and no row is
  -- renumbered twice.
  --
  -- PHASE 22 NOTE: the archive ended and the replacement started on the SAME
  -- calendar date, so a row written earlier today — while the archive was
  -- still live — already carries the archive's day 20 and is correctly left
  -- alone: it fails the `day = v_day` test, not the created_at one.
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
    -- ended_at, ended_reason and ended_on_day all back to null. last_evaluated_day
    -- is set in step 10, from the day series rather than from a constant.
    update public.challenges
       set ended_at          = null,
           ended_reason      = null,
           ended_on_day      = null,
           missed_notice_day = null
     where id = v_arch.id;
  else
    update public.challenges set missed_notice_day = null where id = v_arch.id;
  end if;

  -- ---- 10. recompute flame and the evaluator's cursor from the day series ---
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

  -- last_evaluated_day is the EVALUATOR's cursor and it means "the highest day
  -- that has CLOSED and been judged". It is NOT the highest day the repair
  -- touched. Sealing today early — which this does when the carried day is
  -- already complete — must not push the cursor past a day that has not
  -- closed: if it did, and that day later turned out unmet, evaluate_challenge
  -- would start above it and never judge it at all. Hence the clamp to
  -- last_closed_day. Setting the cursor LOW is always safe: re-judging a day
  -- that is already sealed and met only restamps evaluated_at and pays no
  -- second flame (0011, evaluate_challenge's `sealed_at is null` branch).
  v_cursor := greatest(1, least(v_maxeval,
                                coalesce(public.last_closed_day(v_arch), v_maxeval),
                                v_arch.duration_days));

  -- THE FLAME/SEAL INVARIANT, asserted rather than reasoned about.
  --
  -- flame is a COUNT of met days. seal_day() (0011:306-311) and
  -- evaluate_challenge() (0011:447-454) each PAY one flame when they move a
  -- day from unsealed to sealed. So any day this recompute COUNTS while
  -- leaving it UNSEALED could be paid for a second time afterwards, and the
  -- streak would grow by itself.
  --
  -- Days at or below v_cursor cannot be paid again: evaluate_challenge starts
  -- at last_evaluated_day + 1 (0011:435) and seal_day refuses a day that has
  -- closed (0011:289-293). Above v_cursor, nothing may be met and unsealed.
  --
  -- As written, step 5 seals every carried day it scores and step 6 seals
  -- every named day, so met implies sealed and this cannot fire. That is an
  -- argument about the code; the check is about the database.
  select count(*) into v_n
    from generate_series(v_cursor + 1, greatest(v_maxeval, v_cursor)) as g(day)
   where public.day_is_met(v_arch.id, g.day)
     and not exists (select 1 from public.challenge_days
                      where challenge_id = v_arch.id and day = g.day
                        and sealed_at is not null);
  if v_n > 0 then
    raise exception
      'ABORT: % day(s) above the evaluator cursor (%) are met but UNSEALED. '
      'The flame counts them now and seal_day() or the evaluator would pay '
      'for them again, landing the streak one higher than the days justify. '
      'Refusing to leave a streak that can grow by itself.', v_n, v_cursor;
  end if;

  update public.challenges
     set flame              = v_flame,
         best_flame         = greatest(best_flame, v_flame),
         last_evaluated_day = v_cursor
   where id = v_arch.id;

  raise notice 'flame recomputed over days 1..% -> %; last_evaluated_day -> %',
    v_maxeval, v_flame, v_cursor;

  -- ---- 11. the feed item ----------------------------------------------------
  if P_FEED_DISPOSITION = 'delete' then
    select squad_id, kind, text into v_fsquad, v_fkind, v_ftext
      from public.feed_items where id = P_FEED_ITEM_ID;

    if v_fkind is null then
      -- Already gone. Re-running after a partial manual cleanup should not
      -- abort on the one thing that is already done.
      raise notice 'feed item % is not present; nothing deleted', P_FEED_ITEM_ID;
    else
      if P_FEED_EXPECT_SQUAD is not null and v_fsquad is distinct from P_FEED_EXPECT_SQUAD then
        raise exception
          'REFUSED: feed item % belongs to squad %, not the expected %.',
          P_FEED_ITEM_ID, v_fsquad, P_FEED_EXPECT_SQUAD;
      end if;
      if P_FEED_EXPECT_KIND is not null and v_fkind is distinct from P_FEED_EXPECT_KIND then
        raise exception
          'REFUSED: feed item % is kind %, not the expected %.',
          P_FEED_ITEM_ID, v_fkind, P_FEED_EXPECT_KIND;
      end if;
      if P_FEED_EXPECT_TEXT is not null and v_ftext is distinct from P_FEED_EXPECT_TEXT then
        raise exception
          'REFUSED: feed item % says %, not the expected %. Deleting the wrong '
          'row out of a squad feed is not recoverable from here.',
          P_FEED_ITEM_ID, quote_literal(v_ftext), quote_literal(P_FEED_EXPECT_TEXT);
      end if;
      -- The author check is not optional: this script is scoped to one account
      -- and must never reach into a squadmate's row.
      delete from public.feed_items
       where id = P_FEED_ITEM_ID and author = P_OWNER;
      get diagnostics v_feed = row_count;
      if v_feed <> 1 then
        raise exception
          'REFUSED: feed item % is not authored by % — refusing to touch '
          'another member''s feed row.', P_FEED_ITEM_ID, P_OWNER;
      end if;
      raise notice 'deleted feed item % %', P_FEED_ITEM_ID, quote_literal(v_ftext);
    end if;

  elsif P_FEED_DISPOSITION = 'rewrite' then
    update public.feed_items
       set text = P_FEED_TEXT,
           kind = P_FEED_KIND
     where id = P_FEED_ITEM_ID and author = P_OWNER and kind = 'miss';
    get diagnostics v_feed = row_count;
    raise notice 'rewrote % feed item(s)', v_feed;

  else
    raise notice 'feed item left alone (P_FEED_DISPOSITION = none)';
  end if;

  raise notice 'AFTER: challenge % flame=% best=% last_evaluated_day=% live=%',
    v_arch.id, v_flame, greatest(v_arch.best_flame, v_flame), v_cursor,
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
-- expectation is either derived from the rows or is an invariant that holds on
-- any day.
--
-- AMENDED 2026-09-12 (PHASE 22). The rehearsal fixture was deliberately built
-- from DIFFERENT constants this time — a different account, a different
-- timezone, a different length, a different day number, a different task set —
-- so that agreement between fixture and check would mean something. Two rows
-- disagreed, and both were the check's fault:
--
--   * row 11 used a scalar subquery over "retired challenges pointing at the
--     live one". This account now holds TWO — the Phase 18 replacement and the
--     Phase 22 one — and a scalar subquery returning two rows raises 21000
--     more_than_one_row, which would have aborted the entire grid on
--     production. It aggregates now, and reports every retired attempt.
--
--   * row 9 asked "is any row the repair wrote dated on or before the local
--     date of the day it belongs to". That is the right question for a day in
--     the PAST and the wrong one for TODAY. Phase 22 carries a day whose local
--     date IS today, so a perfectly correct run scores VIOLATION. Backdating
--     is now tested as "dated before its own day" OR "a day already in the
--     past, dated on or before itself" — the same teeth, no false alarm.
--
--     Worse, and only visible once the fixture stopped sharing the run's clock:
--     `completed_at::date` renders in the SESSION timezone while
--     day_local_date is a local calendar date. Run the same correct database
--     from a UTC session and from a New_York one and the old row 9 gave
--     different verdicts. Both sides are now rendered in the CHALLENGE's
--     timezone, so the answer no longer depends on who is asking.
--
-- The only thing still written by hand is the account, which must match
-- P_OWNER above, and the feed item id in row 12.
-- =============================================================================
with me as (select '5212e3ec-29ab-4bb0-b048-41088920e433'::uuid as uid),
feed_target as (select '475bf99b-f485-4df2-9f22-a584cfdcd123'::uuid as id),
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
-- evaluated_at inside one transaction, so both carry the identical now(). The
-- evaluator stamps evaluated_at but never inserts a completion, and the app
-- inserts completions but never stamps evaluated_at. So an instant that
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
-- Today, in the CHALLENGE's own timezone. Row 9 has to know which days are
-- genuinely in the past, and "in the past" is a local-calendar fact.
today_local as (
  select (now() at time zone timezone)::date as d from live
),
wrote as (
  select tc.day, tc.task_key, tc.completed_at,
         -- BOTH dates in the CHALLENGE's timezone. `completed_at::date` alone
         -- renders in the SESSION timezone (UTC in the Supabase SQL editor),
         -- while day_local_date is a local calendar date — comparing them
         -- compares two different frames, and the answer changes with who is
         -- running the query and from where.
         (tc.completed_at at time zone (select timezone from live))::date
           as wrote_local_date,
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
),
backdated as (
  select count(*) as n from wrote
   where wrote_local_date < day_local_date
      or (day_local_date < (select d from today_local)
          and wrote_local_date <= day_local_date)
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
  select 9, 'NOTHING BACKDATED: no row the repair wrote pre-dates its own day',
         '0 such rows',
         (select n::text from backdated),
         case when (select n from backdated) = 0
              then 'OK — every row it wrote is stamped now(), never earlier'
              else 'VIOLATION' end

  union all
  select 10, 'what the repair wrote, and when',
         (select count(*)::text || ' completion row(s) on day(s) '
                 || coalesce((select string_agg(d::text, ', ' order by d)
                                from (select distinct day as d from wrote) x), '-')
            from wrote),
         (select to_char(at, 'YYYY-MM-DD HH24:MI:SS TZ') from run),
         'one instant, because now() is the transaction timestamp'

  union all
  -- AGGREGATED, not scalar: more than one retired attempt points at this
  -- archive and a scalar subquery would raise 21000 here.
  select 11, 'retired attempts pointing at the live challenge',
         'each ended with reason null',
         coalesce((select string_agg(
                            left(id::text, 8) || ' ended ' || coalesce(ended_reason, '<null>')
                            || ' on day ' || coalesce(ended_on_day::text, '<null>'),
                            '; ' order by ended_at)
                     from retired where restarted_from = (select id from live)),
                  'none'),
         case when not exists (select 1 from retired
                                where restarted_from = (select id from live))
              then 'FINDING — nothing points at the live challenge'
              when exists (select 1 from retired
                            where restarted_from = (select id from live)
                              and ended_reason is not null)
              then 'read it — one of them still carries an ended_reason'
              else 'OK' end

  union all
  -- Honest under either disposition, so that flipping the switch cannot leave
  -- a stale FINDING behind — the failure mode this file already has form for.
  select 12, 'the named feed item',
         'gone if delete, corrected if rewrite; never still asserting a miss',
         coalesce((select 'present, kind ' || kind from public.feed_items
                    where id = (select id from feed_target)), 'gone'),
         case when not exists (select 1 from public.feed_items
                                where id = (select id from feed_target))
              then 'OK — deleted'
              when exists (select 1 from public.feed_items
                            where id = (select id from feed_target) and kind = 'miss')
              then 'FINDING — the row is still there and still says miss'
              else 'OK — rewritten rather than deleted; read the text in row 13' end

  union all
  select 13, 'feed items still asserting a miss',
         'only ones that are true',
         (select count(*)::text from public.feed_items
           where author = (select uid from me) and kind = 'miss'),
         'read the text yourself — a count cannot judge a sentence'

  union all
  select 14, 'missed_notice_day cleared',
         'null', coalesce((select missed_notice_day::text from live), 'null'),
         case when (select missed_notice_day from live) is null then 'OK' else 'FINDING' end

  union all
  select 15, 'last_evaluated_day is a day that has CLOSED',
         '<= last closed day, which is '
           || (select public.last_closed_day(live.*)::text from live),
         (select last_evaluated_day::text from live),
         case when (select last_evaluated_day from live)
                <= (select public.last_closed_day(live.*) from live)
              then 'OK' else 'FINDING — the evaluator would skip an unjudged day' end

  union all
  select 16, 'today',
         'reported, not asserted — you may have completed it',
         (select 'day ' || public.challenge_day(live.*) || ': '
                 || coalesce((select done || '/' || total || ' '
                                     || coalesce(outcome, 'unjudged')
                                     || case when sealed_at is not null
                                             then ', sealed' else ', open' end
                                from days where day = public.challenge_day(live.*)),
                             'not frozen yet')
            from live),
         'informational'
) v order by ord;
