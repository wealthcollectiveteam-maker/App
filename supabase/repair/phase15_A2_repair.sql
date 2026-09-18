-- =============================================================================
-- PHASE 15 / A2 — THE REPAIR. A one-time script, run by hand, once.
--
-- This is NOT a feature. There is no RPC here, no grant, nothing the app can
-- reach. It is a single DO block: one statement, therefore one transaction.
-- If any assertion fails the whole thing rolls back and nothing changed.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--   Nothing to edit: every value it needs is either pinned in the CONSTANTS
--   block below (from the A1 grid) or derived from the rows themselves.
--
-- WHAT IT DOES, in order — the order matters:
--   1  resolves the account and asserts the shape matches the A1 grid exactly
--   2  logs the BEFORE state
--   3  completes and re-scores the missed day (Day 6) as met
--   4  carries the replacement's completed days onto the archive, re-numbered,
--      against snapshots composed from the ARCHIVE's own config
--   5  re-points day-numbered private rows (journal, meals, workout logs)
--   6  rewrites the squad feed row so it stops saying something untrue
--   7  DELETES the replacement challenge
--   8  un-ends the archive and recomputes the bookkeeping
--   9  logs the AFTER state
--
-- WHY 7 BEFORE 8: challenges_one_active_owner is a partial unique index on
--   (owner) where ended_at is null. Clearing ended_at while the replacement is
--   still live raises 23505. Verified against a real Postgres, not assumed.
--
-- THE IMMUTABILITY TRIGGER IS NOT DISABLED, AND DOES NOT NEED TO BE.
--   forbid_snapshot_mutation() (0007) raises on UPDATE only when
--   task_snapshot, day or challenge_id change. sealed_at, evaluated_at and
--   outcome are explicitly permitted — the evaluator itself writes them. This
--   script never touches a frozen task set, so the guarantee stays armed for
--   the entire transaction. Verified empirically: re-scoring a judged day and
--   updating an already-sealed day are both ALLOWED; rewriting a snapshot is
--   REFUSED with "day snapshots are immutable".
--   The one delete it performs — the replacement challenge — cascades to
--   challenge_days, and the trigger's DELETE branch already lets a cascade
--   through (the parent row is gone by then). That path exists for
--   delete_account(); this script uses it, it does not widen it.
--
-- SAFE TO RUN TWICE. The second run detects that the live challenge no longer
--   points at an archive, logs NO-OP, and changes nothing.
--
-- SAFE IF THE ACCOUNT HAS MOVED ON. Every fact from the grid is asserted. A
--   different start date, a different missed day, a different flame, a second
--   archived attempt, or a day that is not met all abort the transaction with
--   a message naming what it found.
-- =============================================================================

drop table if exists pg_temp.phase15_repair_log;
create temp table phase15_repair_log (
  ord    serial primary key,
  phase  text,
  item   text,
  detail jsonb
);

do $$
declare
  -- =========================================================================
  -- CONSTANTS — the rows the A1 grid showed. Every one is asserted below.
  -- If any of these is wrong the script aborts instead of guessing.
  -- =========================================================================
  -- The account, keyed on its UUID the way streak_repair.sql's P_OWNER is.
  -- Never the email: that is a personal identifier and CLAUDE.md keeps it
  -- out of the repo.
  k_owner          constant uuid    := '5212e3ec-29ab-4bb0-b048-41088920e433';
  k_archive_start  constant date    := date '2026-08-24';  -- archive day 1
  k_replace_start  constant date    := date '2026-08-30';  -- replacement day 1
  k_missed_day     constant integer := 6;                  -- judged missed
  k_flame_at_miss  constant integer := 5;                  -- archive.flame
  k_tasks_per_day  constant integer := 11;                 -- 6 tier + 5 custom
  k_feed_prefix    constant text    := '1f44feac';         -- the miss feed row
  k_owned_expected constant integer := 2;                  -- archive + replacement

  v_uid        uuid;
  v_arch       public.challenges;
  v_repl       public.challenges;
  v_feed       public.feed_items;
  v_offset     integer;      -- archive day number of replacement day 1, minus 1
  v_day_now    integer;      -- today, as an archive day number, in ITS timezone
  v_last       integer;      -- the highest day that has ENDED = day_now - 1
  v_flame      integer := 0;
  v_n          integer;
  v_day        integer;
  v_target     integer;
  v_src_done   integer;
  v_src_total  integer;
  v_bad        integer[];
  v_carried    integer := 0;
  v_r          record;
  v_txt        text;
begin
  -- =========================================================================
  -- 1. THE ACCOUNT, AND EXACTLY ONE OF THEM
  -- =========================================================================
  select count(*) into v_n from auth.users u where u.id = k_owner;
  if v_n <> 1 then
    raise exception 'PHASE15 ABORT: % matches % auth.users row(s); expected exactly 1',
      k_owner, v_n;
  end if;
  select u.id into v_uid from auth.users u where u.id = k_owner;

  -- The live challenge. At most one exists — the partial unique index says so.
  select * into v_repl from public.challenges
   where owner = v_uid and ended_at is null;

  if v_repl.id is null then
    raise exception 'PHASE15 ABORT: this account has no live challenge at all. '
      'That is not the state the A1 grid showed. Re-run A1 and send it to me.';
  end if;

  -- ---- IDEMPOTENCE. The live challenge IS the archive => already repaired.
  if v_repl.start_date = k_archive_start then
    insert into phase15_repair_log (phase, item, detail) values
      ('NO-OP', 'already repaired',
       jsonb_build_object(
         'live_challenge',     v_repl.id,
         'start_date',         v_repl.start_date,
         'ended_at',           v_repl.ended_at,
         'last_evaluated_day', v_repl.last_evaluated_day,
         'flame',              v_repl.flame,
         'best_flame',         v_repl.best_flame,
         'note', 'The live challenge already starts on the archive date. '
              || 'This script has run. Nothing was changed.'));
    raise notice 'PHASE15: already repaired — NO-OP, nothing changed.';
    return;
  end if;

  -- ---- Everything else must match the grid exactly.
  if v_repl.start_date <> k_replace_start then
    raise exception 'PHASE15 ABORT: the live challenge starts %, not %. '
      'The account has moved on since the diagnostic. Re-run A1.',
      v_repl.start_date, k_replace_start;
  end if;
  if v_repl.restarted_from is null then
    raise exception 'PHASE15 ABORT: the live challenge has restarted_from = null, '
      'so it did not come from an archived attempt.';
  end if;

  select count(*) into v_n from public.challenges where owner = v_uid;
  if v_n <> k_owned_expected then
    raise exception 'PHASE15 ABORT: this account owns % challenge(s); the grid '
      'showed %. Send me a fresh A1 grid before running anything.',
      v_n, k_owned_expected;
  end if;

  select count(*) into v_n from public.challenges
   where owner = v_uid and ended_at is not null;
  if v_n <> 1 then
    raise exception 'PHASE15 ABORT: % ended challenge(s) on this account; '
      'this script may only touch exactly 1.', v_n;
  end if;

  select * into v_arch from public.challenges where id = v_repl.restarted_from;
  if v_arch.id is null then
    raise exception 'PHASE15 ABORT: restarted_from points at a challenge that '
      'does not exist.';
  end if;
  if v_arch.owner <> v_uid then
    raise exception 'PHASE15 ABORT: the archive is owned by a different user.';
  end if;
  if v_arch.start_date <> k_archive_start then
    raise exception 'PHASE15 ABORT: archive starts %, expected %.',
      v_arch.start_date, k_archive_start;
  end if;
  if v_arch.ended_reason <> 'missed_day' then
    raise exception 'PHASE15 ABORT: archive ended_reason is %, expected missed_day. '
      'A completed run must never be un-ended by this script.', v_arch.ended_reason;
  end if;
  if v_arch.ended_on_day <> k_missed_day then
    raise exception 'PHASE15 ABORT: archive ended on day %, expected %.',
      v_arch.ended_on_day, k_missed_day;
  end if;
  if v_arch.flame <> k_flame_at_miss then
    raise exception 'PHASE15 ABORT: archive flame is %, expected % at the miss.',
      v_arch.flame, k_flame_at_miss;
  end if;

  -- The day arithmetic, derived from the rows, in the CHALLENGE's timezone —
  -- the same clock challenge_day() reads. Never the server's current_date.
  v_offset  := v_repl.start_date - v_arch.start_date;
  v_day_now := ((now() at time zone v_arch.timezone)::date - v_arch.start_date) + 1;
  v_last    := v_day_now - 1;

  if v_offset <> k_missed_day then
    raise exception 'PHASE15 ABORT: the replacement starts on archive day %, '
      'but the miss was day %. The restart is not the one this repair describes.',
      v_offset + 1, k_missed_day;
  end if;

  -- =========================================================================
  -- 2. BEFORE
  -- =========================================================================
  insert into phase15_repair_log (phase, item, detail) values
    ('BEFORE', 'clock', jsonb_build_object(
       'server_now',        now(),
       'challenge_timezone', v_arch.timezone,
       'local_now',         (now() at time zone v_arch.timezone),
       'archive_day_today', v_day_now,
       'highest_ended_day', v_last)),
    ('BEFORE', 'archive', jsonb_build_object(
       'id', v_arch.id, 'start_date', v_arch.start_date,
       'timezone', v_arch.timezone, 'duration_days', v_arch.duration_days,
       'ended_at', v_arch.ended_at, 'ended_reason', v_arch.ended_reason,
       'ended_on_day', v_arch.ended_on_day,
       'last_evaluated_day', v_arch.last_evaluated_day,
       'missed_notice_day', v_arch.missed_notice_day,
       'flame', v_arch.flame, 'best_flame', v_arch.best_flame)),
    ('BEFORE', 'replacement', jsonb_build_object(
       'id', v_repl.id, 'start_date', v_repl.start_date,
       'restarted_from', v_repl.restarted_from,
       'last_evaluated_day', v_repl.last_evaluated_day,
       'missed_notice_day', v_repl.missed_notice_day,
       'flame', v_repl.flame, 'best_flame', v_repl.best_flame)),
    ('BEFORE', 'day_offset', jsonb_build_object(
       'replacement_day_1_is_archive_day', v_offset + 1,
       'offset', v_offset,
       'derived_from', 'replacement.start_date - archive.start_date'));

  insert into phase15_repair_log (phase, item, detail)
  select 'BEFORE',
         case when d.challenge_id = v_arch.id then 'archive day ' else 'replacement day ' end
           || d.day,
         jsonb_build_object(
           'day', d.day,
           'tasks_total', jsonb_array_length(d.task_snapshot),
           'tasks_done', (select count(*) from public.task_completions tc
                           where tc.challenge_id = d.challenge_id and tc.day = d.day),
           'sealed_at', d.sealed_at, 'evaluated_at', d.evaluated_at,
           'outcome', d.outcome)
  from public.challenge_days d
  where d.challenge_id in (v_arch.id, v_repl.id)
  order by (d.challenge_id = v_repl.id), d.day;

  -- ---- the custom-task key map, and proof that it is total and one-to-one.
  -- The two challenges hold the same five custom tasks under DIFFERENT uuids,
  -- so 'custom-<uuid>' keys do not carry across. They are matched on the
  -- fields restart_challenge() actually copied: name, sub, proof, timer.
  select count(*) into v_src_total
    from public.custom_tasks where challenge_id = v_repl.id;
  select count(*) into v_n from (
    select rc.id
    from public.custom_tasks rc
    join public.custom_tasks ac
      on ac.challenge_id = v_arch.id
     and ac.name  = rc.name
     and ac.sub   = rc.sub
     and ac.proof = rc.proof
     and ac.timer_minutes is not distinct from rc.timer_minutes
    where rc.challenge_id = v_repl.id
    group by rc.id
  ) s;
  if v_n <> v_src_total then
    raise exception 'PHASE15 ABORT: % of % replacement custom tasks have no '
      'unique match on the archive. Completions would be stranded.',
      v_n, v_src_total;
  end if;
  -- injective in the other direction too
  select count(*) into v_n from (
    select ac.id
    from public.custom_tasks rc
    join public.custom_tasks ac
      on ac.challenge_id = v_arch.id
     and ac.name  = rc.name
     and ac.sub   = rc.sub
     and ac.proof = rc.proof
     and ac.timer_minutes is not distinct from rc.timer_minutes
    where rc.challenge_id = v_repl.id
    group by ac.id
  ) s;
  if v_n <> v_src_total then
    raise exception 'PHASE15 ABORT: the custom-task map is not one-to-one '
      '(% archive tasks for % replacement tasks). Two tasks share a name.',
      v_n, v_src_total;
  end if;

  insert into phase15_repair_log (phase, item, detail)
  select 'BEFORE', 'custom task map',
         jsonb_build_object('name', rc.name,
                            'replacement_key', 'custom-' || rc.id,
                            'archive_key',     'custom-' || ac.id)
  from public.custom_tasks rc
  join public.custom_tasks ac
    on ac.challenge_id = v_arch.id
   and ac.name = rc.name and ac.sub = rc.sub and ac.proof = rc.proof
   and ac.timer_minutes is not distinct from rc.timer_minutes
  where rc.challenge_id = v_repl.id
  order by rc.name;

  -- =========================================================================
  -- 3. THE MISSED DAY — complete the outstanding tasks, re-score it met
  -- =========================================================================
  select jsonb_array_length(d.task_snapshot) into v_src_total
    from public.challenge_days d
   where d.challenge_id = v_arch.id and d.day = k_missed_day;
  if v_src_total is null then
    raise exception 'PHASE15 ABORT: the archive has no frozen day %.', k_missed_day;
  end if;
  if v_src_total <> k_tasks_per_day then
    raise exception 'PHASE15 ABORT: archive day % has % tasks, expected %.',
      k_missed_day, v_src_total, k_tasks_per_day;
  end if;

  -- completed_at is now(), not a backdated midnight. The work was done; the
  -- tap was late. The row says when the tap happened, and nothing scores on it.
  insert into public.task_completions (challenge_id, day, task_key)
  select v_arch.id, k_missed_day, t->>'key'
  from public.challenge_days d,
       lateral jsonb_array_elements(d.task_snapshot) t
  where d.challenge_id = v_arch.id and d.day = k_missed_day
  on conflict (challenge_id, day, task_key) do nothing;
  get diagnostics v_n = row_count;

  if not public.day_is_met(v_arch.id, k_missed_day) then
    raise exception 'PHASE15 ABORT: day % is still not met after filling it in.',
      k_missed_day;
  end if;

  update public.challenge_days
     set sealed_at    = now(),
         evaluated_at = now(),
         outcome      = 'met'
   where challenge_id = v_arch.id and day = k_missed_day;

  insert into phase15_repair_log (phase, item, detail) values
    ('CHANGE', 'missed day repaired', jsonb_build_object(
       'day', k_missed_day,
       'completions_inserted', v_n,
       'completed_at', 'now() — logged late, not backdated',
       'sealed_at', 'now()',
       'outcome', 'met',
       'snapshot', 'untouched — the trigger was never disabled'));

  -- =========================================================================
  -- 4. CARRY THE REPLACEMENT'S DAYS ONTO THE ARCHIVE
  --
  -- Replacement day d becomes archive day d + offset. The snapshot for the
  -- target day is COMPOSED FROM THE ARCHIVE (compose_task_set on the archive's
  -- own custom_tasks / target_overrides / tier_history) — never copied from
  -- the replacement, whose custom-task keys are about to cease to exist.
  -- Completions are then re-keyed through the name map proved above.
  -- =========================================================================
  for v_r in
    select * from public.challenge_days
     where challenge_id = v_repl.id order by day
  loop
    v_target := v_r.day + v_offset;

    select count(*) into v_src_done
      from public.task_completions
     where challenge_id = v_repl.id and day = v_r.day;
    v_src_total := jsonb_array_length(v_r.task_snapshot);

    if v_target > v_arch.duration_days then
      raise exception 'PHASE15 ABORT: replacement day % maps to archive day %, '
        'past the finish line (%).', v_r.day, v_target, v_arch.duration_days;
    end if;

    -- Today is still open. If nothing was ticked on it, leave it alone
    -- entirely and let the app freeze it on the next launch, as normal.
    if v_target >= v_day_now and v_src_done = 0 then
      insert into phase15_repair_log (phase, item, detail) values
        ('CHANGE', 'replacement day ' || v_r.day || ' skipped',
         jsonb_build_object('maps_to_archive_day', v_target,
           'reason', 'today, and nothing ticked on it — left for the app to freeze'));
      continue;
    end if;

    insert into public.challenge_days (challenge_id, day, task_snapshot)
    values (v_arch.id, v_target, public.compose_task_set(v_arch.id, v_target))
    on conflict (challenge_id, day) do nothing;

    with keymap as (
      select ('custom-' || rc.id) as repl_key, ('custom-' || ac.id) as arch_key
      from public.custom_tasks rc
      join public.custom_tasks ac
        on ac.challenge_id = v_arch.id
       and ac.name = rc.name and ac.sub = rc.sub and ac.proof = rc.proof
       and ac.timer_minutes is not distinct from rc.timer_minutes
      where rc.challenge_id = v_repl.id
    )
    insert into public.task_completions
      (challenge_id, day, task_key, completed_at, duration_seconds)
    select v_arch.id, v_target,
           coalesce(k.arch_key, tc.task_key),   -- tier keys map to themselves
           tc.completed_at, tc.duration_seconds
    from public.task_completions tc
    left join keymap k on k.repl_key = tc.task_key
    where tc.challenge_id = v_repl.id and tc.day = v_r.day
    on conflict (challenge_id, day, task_key) do nothing;
    get diagnostics v_n = row_count;

    -- If the source day was finished, the destination day must be finished
    -- too. If it is not, a key failed to map and we must not commit.
    if v_src_done >= v_src_total and not public.day_is_met(v_arch.id, v_target) then
      raise exception 'PHASE15 ABORT: replacement day % was complete but archive '
        'day % is not met after re-keying. The custom-task map is wrong.',
        v_r.day, v_target;
    end if;

    if v_target < v_day_now and public.day_is_met(v_arch.id, v_target) then
      -- Carry the real seal time. They sealed it when they sealed it.
      update public.challenge_days
         set sealed_at    = coalesce(v_r.sealed_at, now()),
             evaluated_at = now(),
             outcome      = 'met'
       where challenge_id = v_arch.id and day = v_target;
      v_txt := 'sealed and scored met';
    else
      v_txt := 'carried, left OPEN — this day has not ended yet';
    end if;

    v_carried := v_carried + 1;
    insert into phase15_repair_log (phase, item, detail) values
      ('CHANGE', 'replacement day ' || v_r.day || ' -> archive day ' || v_target,
       jsonb_build_object(
         'source_tasks_done', v_src_done, 'source_tasks_total', v_src_total,
         'completions_copied', v_n,
         'snapshot_source', 'compose_task_set(archive, ' || v_target || ')',
         'snapshot_tasks', (select jsonb_array_length(task_snapshot)
                              from public.challenge_days
                             where challenge_id = v_arch.id and day = v_target),
         'result', v_txt));
  end loop;

  -- =========================================================================
  -- 5. DAY-NUMBERED PRIVATE ROWS
  --
  -- journal_entries / meals / milestones are keyed on (owner, day) and carry
  -- no challenge_id, so the restart silently re-pointed them at day 1.
  -- workout_logs IS challenge-scoped and would be destroyed by the delete in
  -- step 7. Anything written after the restart belongs to the replacement's
  -- numbering and is re-based by the same offset.
  -- =========================================================================
  update public.journal_entries
     set day = day + v_offset
   where owner = v_uid
     and created_at >= v_repl.created_at
     and day + v_offset <= v_arch.duration_days;
  get diagnostics v_n = row_count;
  insert into phase15_repair_log (phase, item, detail) values
    ('CHANGE', 'journal_entries re-based', jsonb_build_object('rows', v_n, 'by_days', v_offset));

  update public.meals
     set day = day + v_offset
   where owner = v_uid
     and created_at >= v_repl.created_at
     and day + v_offset <= v_arch.duration_days;
  get diagnostics v_n = row_count;
  insert into phase15_repair_log (phase, item, detail) values
    ('CHANGE', 'meals re-based', jsonb_build_object('rows', v_n, 'by_days', v_offset));

  update public.milestones
     set hit_on_day = hit_on_day + v_offset
   where owner = v_uid
     and hit_on_day is not null
     and created_at >= v_repl.created_at
     and hit_on_day + v_offset <= v_arch.duration_days;
  get diagnostics v_n = row_count;
  insert into phase15_repair_log (phase, item, detail) values
    ('CHANGE', 'milestones re-based', jsonb_build_object('rows', v_n, 'by_days', v_offset));

  -- A milestone CREATED before the restart but HIT after it cannot be told
  -- apart by created_at. Reported, never guessed at.
  select count(*) into v_n from public.milestones
   where owner = v_uid and hit_on_day is not null
     and created_at < v_repl.created_at and hit_on_day <= v_offset;
  if v_n > 0 then
    insert into phase15_repair_log (phase, item, detail) values
      ('REVIEW', 'milestones needing your eye', jsonb_build_object(
        'rows', v_n,
        'why', 'created before the restart, hit_on_day <= ' || v_offset || '. '
            || 'Could belong to either numbering. Left exactly as they were.'));
  end if;

  update public.workout_logs
     set challenge_id = v_arch.id,
         day          = day + v_offset
   where challenge_id = v_repl.id
     and day + v_offset <= v_arch.duration_days;
  get diagnostics v_n = row_count;
  insert into phase15_repair_log (phase, item, detail) values
    ('CHANGE', 'workout_logs moved to the archive',
     jsonb_build_object('rows', v_n, 'by_days', v_offset));

  select count(*) into v_n from public.workout_logs where challenge_id = v_repl.id;
  if v_n <> 0 then
    raise exception 'PHASE15 ABORT: % workout_log(s) still hang off the '
      'replacement and would be destroyed by the delete.', v_n;
  end if;

  -- =========================================================================
  -- 6. THE SQUAD FEED ROW — rewritten, not deleted
  --
  -- Squadmates saw "missed Day 6. Hard rules — the challenge restarts at Day 1."
  -- After this repair the roster shows Day 8, so that sentence becomes false.
  -- Erasing it would be worse: it happened. It is replaced with what is now
  -- true, and it keeps its original timestamp and position in the feed.
  -- =========================================================================
  select count(*) into v_n from public.feed_items
   where author = v_uid and kind = 'miss'
     and created_at between v_arch.ended_at - interval '5 minutes'
                        and v_arch.ended_at + interval '5 minutes';
  if v_n <> 1 then
    raise exception 'PHASE15 ABORT: found % miss feed row(s) around the archive '
      'time; expected exactly 1.', v_n;
  end if;
  select * into v_feed from public.feed_items
   where author = v_uid and kind = 'miss'
     and created_at between v_arch.ended_at - interval '5 minutes'
                        and v_arch.ended_at + interval '5 minutes';
  if left(v_feed.id::text, 8) <> k_feed_prefix then
    raise exception 'PHASE15 ABORT: the miss feed row is %, not the % the grid '
      'showed.', left(v_feed.id::text, 8), k_feed_prefix;
  end if;

  v_txt := format('logged Day %s late.', k_missed_day);
  update public.feed_items set text = v_txt where id = v_feed.id;

  insert into phase15_repair_log (phase, item, detail) values
    ('CHANGE', 'squad feed row rewritten', jsonb_build_object(
       'id', v_feed.id, 'squad_id', v_feed.squad_id,
       'created_at', v_feed.created_at,
       'was', v_feed.text, 'now', v_txt,
       'note', 'kept, not deleted — your squad saw the original'));

  -- =========================================================================
  -- 7. DELETE THE REPLACEMENT. Must happen BEFORE step 8: the partial unique
  --    index challenges_one_active_owner permits only one live challenge.
  --    Cascades to challenge_days, task_completions, tier_history,
  --    custom_tasks, target_overrides. workout_logs already moved.
  -- =========================================================================
  insert into phase15_repair_log (phase, item, detail)
  select 'CHANGE', 'replacement rows deleted (cascade)', jsonb_build_object(
    'challenge_days',   (select count(*) from public.challenge_days   where challenge_id = v_repl.id),
    'task_completions', (select count(*) from public.task_completions where challenge_id = v_repl.id),
    'tier_history',     (select count(*) from public.tier_history     where challenge_id = v_repl.id),
    'custom_tasks',     (select count(*) from public.custom_tasks     where challenge_id = v_repl.id),
    'target_overrides', (select count(*) from public.target_overrides where challenge_id = v_repl.id),
    'workout_logs',     (select count(*) from public.workout_logs     where challenge_id = v_repl.id),
    'note', 'their content was carried onto the archive in steps 4 and 5 first');

  delete from public.challenges where id = v_repl.id;

  -- =========================================================================
  -- 8. UN-END THE ARCHIVE, AND THE BOOKKEEPING THAT STOPS IT UNDOING ITSELF
  -- =========================================================================

  -- Every day that has ENDED must be met, or tonight's evaluator archives it
  -- again and this whole exercise repeats. This is the assertion that makes
  -- the repair survive the 04:05 UTC run.
  select coalesce(array_agg(g.d order by g.d), '{}') into v_bad
  from generate_series(1, v_last) g(d)
  where not exists (
    select 1 from public.challenge_days cd
     where cd.challenge_id = v_arch.id and cd.day = g.d
       and (cd.outcome = 'met' or cd.sealed_at is not null));
  if array_length(v_bad, 1) is not null then
    raise exception 'PHASE15 ABORT: archive day(s) % are not met, and today is '
      'day %. The evaluator would archive this again tonight. Nothing changed — '
      're-run A1 and send me the grid.', v_bad, v_day_now;
  end if;

  -- The current streak: consecutive met days ending at the last ended day.
  v_flame := 0;
  v_day := v_last;
  while v_day >= 1 loop
    if exists (select 1 from public.challenge_days cd
                where cd.challenge_id = v_arch.id and cd.day = v_day
                  and (cd.outcome = 'met' or cd.sealed_at is not null)) then
      v_flame := v_flame + 1;
      v_day   := v_day - 1;
    else
      exit;
    end if;
  end loop;
  if v_flame <> v_last then
    raise exception 'PHASE15 ABORT: recomputed flame % does not equal the % '
      'ended days, all of which assert as met.', v_flame, v_last;
  end if;

  update public.challenges
     set ended_at           = null,
         ended_reason       = null,
         ended_on_day       = null,
         missed_notice_day  = null,
         last_evaluated_day = v_last,
         flame              = v_flame,
         best_flame         = greatest(best_flame, v_flame)
   where id = v_arch.id;

  -- Exactly one live challenge, and it is the one we restored.
  select count(*) into v_n from public.challenges
   where owner = v_uid and ended_at is null;
  if v_n <> 1 then
    raise exception 'PHASE15 ABORT: % live challenges after the repair.', v_n;
  end if;

  -- =========================================================================
  -- 9. AFTER
  -- =========================================================================
  select * into v_arch from public.challenges where id = v_arch.id;

  insert into phase15_repair_log (phase, item, detail) values
    ('AFTER', 'archive restored', jsonb_build_object(
       'id', v_arch.id, 'start_date', v_arch.start_date,
       'timezone', v_arch.timezone, 'duration_days', v_arch.duration_days,
       'ended_at', v_arch.ended_at, 'ended_reason', v_arch.ended_reason,
       'ended_on_day', v_arch.ended_on_day,
       'last_evaluated_day', v_arch.last_evaluated_day,
       'missed_notice_day', v_arch.missed_notice_day,
       'flame', v_arch.flame, 'best_flame', v_arch.best_flame,
       'today_is_day', v_day_now,
       'days_carried_from_replacement', v_carried)),
    ('AFTER', 'perfect days (sealed)', jsonb_build_object(
       'count', (select count(*) from public.challenge_days
                  where challenge_id = v_arch.id and sealed_at is not null),
       'source', 'challenge_days.sealed_at — the same count api.ts reads')),
    ('AFTER', 'day 1 outcome', jsonb_build_object(
       'outcome', (select outcome from public.challenge_days
                    where challenge_id = v_arch.id and day = 1),
       'sealed_at', (select sealed_at from public.challenge_days
                      where challenge_id = v_arch.id and day = 1),
       'decision', 'LEFT NULL ON PURPOSE. evaluate_challenge() starts at '
                || 'greatest(last_evaluated_day + 1, 2) and create_challenge() '
                || 'sets last_evaluated_day = 1, so day 1 never receives an '
                || 'outcome on ANY challenge. It is sealed, so it already paid '
                || 'its flame and already counts as a perfect day. Writing '
                || '''met'' would invent a state the evaluator cannot produce.')),
    ('AFTER', 'next evaluator run', jsonb_build_object(
       'cursor', v_arch.last_evaluated_day,
       'will_judge_from_day', v_arch.last_evaluated_day + 1,
       'today_is_day', v_day_now,
       'meaning', 'day ' || v_day_now || ' is still open and still yours to '
               || 'finish. Nothing before it is re-judged.'));

  insert into phase15_repair_log (phase, item, detail)
  select 'AFTER', 'archive day ' || d.day,
         jsonb_build_object(
           'day', d.day,
           'tasks_total', jsonb_array_length(d.task_snapshot),
           'tasks_done', (select count(*) from public.task_completions tc
                           where tc.challenge_id = d.challenge_id and tc.day = d.day),
           'met', public.day_is_met(d.challenge_id, d.day),
           'sealed_at', d.sealed_at, 'evaluated_at', d.evaluated_at,
           'outcome', d.outcome)
  from public.challenge_days d
  where d.challenge_id = v_arch.id
  order by d.day;

  raise notice 'PHASE15: repaired. archive now day %, flame %, best_flame %, cursor %.',
    v_day_now, v_arch.flame, v_arch.best_flame, v_arch.last_evaluated_day;
end $$;

select ord, phase, item, detail from phase15_repair_log order by ord;
