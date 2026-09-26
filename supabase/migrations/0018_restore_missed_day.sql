-- =============================================================================
-- Phase 38G (G2): a missed day can be reopened. The first migration that
-- REVERSES something, so every line below serves one property:
--
--     RESTORING CHANGES NO FLAME. ONLY SEALING THE DAY DOES.
--
-- ASSUMED STARTING STATE (rule 6): 0017 is fully applied — evaluate_challenge
-- is the 0017 body, day_is_open and get_day_window are the 0011 bodies,
-- ended_reason admits 'dormant' (0016). This file adds two columns, one
-- constraint value, three server-only clock helpers, one write RPC, one read
-- RPC, and recreates day_is_open, get_day_window and evaluate_challenge with
-- one clause each. Nothing is deleted, anywhere, by anything here.
--
-- WHY. The owner ran 29 days, did the work on 2026-09-22, did not open the
-- app, and at noon on 09-23 the evaluator judged the day missed and Hard
-- rules restarted him at day 1 with best_flame 29 and flame 0. The day was
-- done. There was no way back. This is the way back, for every user, on
-- their own challenge only, once, within seven days.
--
-- WHAT restore_missed_day() DOES, in one transaction:
--   a. the caller's most recent challenge ended by 'missed_day'; refused if
--      none, if the missed day is more than restore_window_days() ago, or if
--      it has been restored before (restored_at is the record)
--   b. refused unless the caller's alive challenge is its DIRECT replacement
--   c. the replacement ends: ended_reason 'superseded', ended_at now
--   d. the original reopens: ended_* cleared, restored_at now, restored_day
--      = the missed day. The reversal is itself a recorded fact.
--   e. its cursor goes to missed day - 1, so the evaluator judges that day
--      AGAIN when it closes — and it closes at noon the day after the
--      restore, not at the noon it already passed
--   f. the missed day's row is reopened: sealed_at, outcome, evaluated_at to
--      null. task_snapshot is not touched: forbid_snapshot_mutation()
--      (0007:299-320) forbids every DELETE and any UPDATE that changes
--      task_snapshot, day or challenge_id, and permits exactly sealed_at,
--      evaluated_at and outcome. That is what this writes, and no more.
--   g. the replacement's days and completions are CARRIED across as new rows
--      on the original, re-based by the difference in start dates. Not
--      moved: the trigger forbids changing challenge_id or day, and the
--      replacement keeps its history intact. The copies arrive UNSEALED,
--      with their completions. See PAY ONCE below.
--   h. where a 'miss' item was published for that day, a correction is
--      posted now, as a 'change' item. The miss stays. It happened.
--
-- PAY ONCE. 0011:308-310: "The flame is a COUNT of met days, so it does not
-- matter whether today or yesterday is sealed first: each met day pays
-- exactly once, here or in the evaluator's retroactive seal, never both."
-- The marker of "paid" is sealed_at, and it means paid INTO THIS ROW'S
-- CHALLENGE. The replacement's sealed day paid the replacement's flame,
-- which is now superseded and dead. Copying sealed_at onto the original
-- would say "paid" to a flame that never received it, and the evaluator
-- would correctly pay nothing — the day would be lost from the streak for
-- ever. Adding it to the original's flame at restore would make the restore
-- pay, which the integrity property forbids. So the copy is unsealed and
-- met — the exact shape PROOF 2 already covers — and it is sealed and paid
-- once on the original by the evaluator after the reopened day closes, or
-- by the person before. The replacement's own row is never touched. This
-- is the one place this file departs from the brief's wording ("a day
-- sealed on the replacement stays sealed on the original"): it stays sealed
-- where it was sealed, and it is paid once where it counts.
--
-- THE REOPENED DAY IS OPEN UNTIL NOON TOMORROW. day_is_open() gains one
-- clause; every write RPC already consults it, so complete_task, seal_day
-- and uncomplete_task work on the reopened day unchanged. get_day_window()
-- returns it, with reopened_until so the screen can count down to the
-- right noon, and the evaluator will not judge it while it is open.
--
-- CONSTRAINTS, held: seven days from the missed day; one restore per
-- challenge; best_flame never decreases; the one-alive-per-owner index is
-- never violated (c before d, one transaction); nothing backdated; this
-- function acts for auth.uid() and nobody else.
--
-- Every statement below is independently re-runnable (rule 4). The last
-- statement is the verification grid (rule 5): read it.
-- =============================================================================

-- ---- 1. two columns: the reversal, recorded --------------------------------
alter table public.challenges
  add column if not exists restored_at  timestamptz,
  add column if not exists restored_day integer;

-- ---- 2. ended_reason admits 'superseded' (found by definition, as 0016) ----
do $$
declare r record;
begin
  for r in
    select conname
      from pg_constraint
     where conrelid = 'public.challenges'::regclass
       and contype  = 'c'
       and pg_get_constraintdef(oid) like '%ended_reason%'
  loop
    execute format('alter table public.challenges drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.challenges
  add constraint challenges_ended_reason_check
  check (ended_reason is null
         or ended_reason in ('missed_day', 'completed', 'restarted', 'dormant', 'superseded'));

-- ---- 3. the window and the reopened day's clock (server-only) --------------
create or replace function public.restore_window_days()
returns integer
language sql immutable
as $$ select 7 $$;

-- Noon, in the challenge's zone, on the local day after the restore. The
-- same shape as day_closes_at(): a whole day and a grace morning.
create or replace function public.restored_day_closes_at(c public.challenges)
returns timestamptz
language sql stable
as $$
  select (((c.restored_at at time zone c.timezone)::date + 1)::timestamp
          + make_interval(hours => public.grace_deadline_hour()))
         at time zone c.timezone;
$$;

create or replace function public.restored_day_is_open(c public.challenges)
returns boolean
language sql stable
as $$
  select c.restored_day is not null
     and c.restored_at  is not null
     and c.ended_at     is null
     and now() < public.restored_day_closes_at(c);
$$;

revoke all on function
  public.restore_window_days(),
  public.restored_day_closes_at(public.challenges),
  public.restored_day_is_open(public.challenges)
from public, anon, authenticated;

-- ---- 4. day_is_open — the 0011 body, plus the reopened day ----------------
-- Every write RPC consults this and nothing else, so the reopened day is
-- writable everywhere at once.
create or replace function public.day_is_open(c public.challenges, p_day integer)
returns boolean
language sql stable
as $$
  select (p_day >= public.earliest_open_day(c)
          and p_day <= public.challenge_day(c))
      or (p_day = c.restored_day and public.restored_day_is_open(c));
$$;

-- ---- 5. get_day_window — the reopened day is a row, with its own close ----
-- The return type gains a column, so DROP then CREATE, and the grant is
-- re-applied below.
drop function if exists public.get_day_window();

create function public.get_day_window()
returns table (
  challenge_id   uuid,
  day            integer,
  is_today       boolean,
  is_open        boolean,
  closes_at      timestamptz,
  sealed_at      timestamptz,
  outcome        text,
  tasks_total    integer,
  tasks_done     integer,
  task_snapshot  jsonb,
  reopened_until timestamptz
)
language plpgsql volatile security definer set search_path = public
as $$
declare
  c          public.challenges;
  v_today    integer;
  v_earliest integer;
  v_d        integer;
begin
  c := public.my_active_challenge();
  if c.id is null then
    raise exception 'no challenge for user';
  end if;
  v_today    := public.challenge_day(c);
  v_earliest := public.earliest_open_day(c);

  -- Freeze every OPEN day, oldest first. The reopened day already has its
  -- row — it was judged from it — so it needs no freezing.
  for v_d in v_earliest .. v_today loop
    perform public.get_or_freeze_day(v_d);
  end loop;

  return query
  select cd.challenge_id,
         cd.day,
         (cd.day = v_today),
         public.day_is_open(c, cd.day),
         public.day_closes_at(c, cd.day),
         cd.sealed_at,
         cd.outcome,
         jsonb_array_length(cd.task_snapshot)::integer,
         (select count(*)::integer
            from public.task_completions tc
           where tc.challenge_id = cd.challenge_id
             and tc.day = cd.day
             and exists (select 1 from jsonb_array_elements(cd.task_snapshot) t
                          where t->>'key' = tc.task_key)),
         cd.task_snapshot,
         case when cd.day = c.restored_day and public.restored_day_is_open(c)
              then public.restored_day_closes_at(c) else null end
  from public.challenge_days cd
  where cd.challenge_id = c.id
    and (   cd.day between greatest(1, v_today - 1) and v_today
         or (cd.day = c.restored_day and public.restored_day_is_open(c)))
  order by cd.day;
end;
$$;

revoke all on function public.get_day_window() from public, anon, authenticated;
grant execute on function public.get_day_window() to authenticated;

-- ---- 6. evaluate_challenge — the 0017 body, one cap ------------------------
create or replace function public.evaluate_challenge(p_challenge uuid)
returns integer
language plpgsql volatile security definer set search_path = public
as $$
declare
  c          public.challenges;
  v_last     integer;
  v_day      integer;
  v_snapshot public.challenge_days;
  v_tier     text;
  v_rules    public.tier_rules;
  v_squad    uuid;
  v_text     text;
  v_dormant  boolean;
  v_judged   integer := 0;
begin
  select * into c from public.challenges
    where id = p_challenge and ended_at is null
    for update;
  if c.id is null then
    return 0;                       -- already archived, or never existed
  end if;

  -- THE GRACE WINDOW, in one line. A day is judged only once it has CLOSED,
  -- which is noon the following day in this challenge's own timezone. Until
  -- then it is still open, still completable, and must not be scored.
  v_last := least(public.last_closed_day(c), c.duration_days);
  -- PHASE 38G. A reopened day is open until noon the day after the restore.
  -- The cursor sits just below it, so until it closes nothing is judged.
  if public.restored_day_is_open(c) then
    v_last := least(v_last, c.restored_day - 1);
  end if;
  -- PHASE 38F. The seal-and-pay floor is 1, always: every closed day is
  -- VISITED. Whether a visited day can be judged a miss is a separate
  -- question, answered per day by first_judged_day below. Rows created
  -- before this file hold cursor 1 and are never revisited.
  v_day  := greatest(c.last_evaluated_day + 1, 1);

  while v_day <= v_last loop
    select * into v_snapshot from public.challenge_days
      where challenge_id = c.id and day = v_day;

    -- PHASE 38F. A PROTECTED day — day 1 of a fresh challenge, which began
    -- at whatever hour someone signed up. If it was met it is sealed and
    -- paid exactly as any other met day, once. If it was not, nothing is
    -- written: no snapshot manufactured, no outcome, no penalty. The
    -- restart's day 1 (first_judged_day 1) never enters this branch.
    if v_day < c.first_judged_day then
      if v_snapshot.id is not null and public.day_is_met(c.id, v_day) then
        if v_snapshot.sealed_at is null then
          update public.challenge_days
             set sealed_at = now(), evaluated_at = now(), outcome = 'met'
           where id = v_snapshot.id;
          update public.challenges
             set flame = flame + 1, best_flame = greatest(best_flame, flame + 1)
           where id = c.id;
          c.flame := c.flame + 1;
        else
          update public.challenge_days
             set evaluated_at = now(), outcome = 'met'
           where id = v_snapshot.id;
        end if;
        v_judged := v_judged + 1;
      end if;
      update public.challenges set last_evaluated_day = v_day where id = c.id;
      c.last_evaluated_day := v_day;
      v_day := v_day + 1;
      continue;
    end if;

    if v_snapshot.id is null then
      insert into public.challenge_days (challenge_id, day, task_snapshot)
      values (c.id, v_day, public.compose_task_set(c.id, v_day))
      returning * into v_snapshot;
    end if;

    if public.day_is_met(c.id, v_day) then
      if v_snapshot.sealed_at is null then
        update public.challenge_days
           set sealed_at = now(), evaluated_at = now(), outcome = 'met'
         where id = v_snapshot.id;
        update public.challenges
           set flame = flame + 1, best_flame = greatest(best_flame, flame + 1)
         where id = c.id;
        c.flame := c.flame + 1;
      else
        update public.challenge_days
           set evaluated_at = now(), outcome = 'met'
         where id = v_snapshot.id;
      end if;

      update public.challenges set last_evaluated_day = v_day where id = c.id;
      c.last_evaluated_day := v_day;
      v_judged := v_judged + 1;
      v_day := v_day + 1;

    else
      update public.challenge_days
         set evaluated_at = now(), outcome = 'missed'
       where id = v_snapshot.id;

      v_tier := public.effective_tier(c.id, v_day);
      select * into v_rules from public.tier_rules where tier = v_tier;
      if v_rules.tier is null then
        raise exception 'no missed-day rules for tier %', v_tier;
      end if;

      select squad_id into v_squad from public.squad_members
        where user_id = c.owner;

      -- PHASE 38E. A restart is refused when this is the SECOND consecutive
      -- run with no sealed day: this run has none, and the run it replaced
      -- had none. A fresh challenge (no parent) is always allowed its one
      -- restart. Decided here, before the feed, because a dormant ending
      -- tells the squad nothing even if the owner ticked something this week.
      v_dormant := v_rules.restarts_challenge
               and c.restarted_from is not null
               and not public.challenge_has_sealed_day(c.id)
               and not public.challenge_has_sealed_day(c.restarted_from);

      if v_rules.restarts_challenge then
        v_text := format(
          'missed Day %s. %s rules — the challenge restarts at Day 1.',
          v_day, initcap(v_tier));
      elsif v_rules.resets_streak then
        v_text := format('missed Day %s. Streak reset to zero.', v_day);
      else
        v_text := format('missed Day %s.', v_day);
      end if;

      -- PHASE 38B. The feed hears about a miss only from someone who is
      -- still running: a completion on any of their challenges inside
      -- feed_activity_window(). A dormant account's miss is judged exactly
      -- as before and told to nobody.
      if v_squad is not null and not v_dormant and public.owner_is_active(c.owner) then
        insert into public.feed_items (squad_id, author, kind, text)
        values (v_squad, c.owner, 'miss', v_text);
      end if;

      update public.challenges set last_evaluated_day = v_day where id = c.id;
      v_judged := v_judged + 1;

      if v_dormant then
        update public.challenges
           set ended_at     = now(),
               ended_reason = 'dormant',
               ended_on_day = v_day
         where id = c.id and ended_at is null;
        return v_judged;
      end if;

      if v_rules.restarts_challenge then
        perform public.restart_challenge(c.id, v_day, 'missed_day');
        return v_judged;
      end if;

      if v_rules.resets_streak then
        update public.challenges
           set flame = 0, missed_notice_day = v_day + 1
         where id = c.id;
        c.flame := 0;
      end if;

      c.last_evaluated_day := v_day;
      v_day := v_day + 1;
    end if;
  end loop;

  if c.last_evaluated_day >= c.duration_days then
    update public.challenges
       set ended_at     = now(),
           ended_reason = 'completed',
           ended_on_day = c.duration_days
     where id = c.id and ended_at is null;
  end if;

  return v_judged;
end;
$$;

-- ---- 7. restore_missed_day — the reversal, for the caller only -------------
create or replace function public.restore_missed_day()
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  o          public.challenges;   -- the challenge that was ended by the miss
  r          public.challenges;   -- its alive replacement
  v_missed_on date;
  v_age      integer;
  v_offset   integer;
  v_squad    uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  -- (a) the most recent challenge of MINE ended by a missed day
  select * into o from public.challenges
   where owner = auth.uid() and ended_reason = 'missed_day'
   order by ended_at desc
   limit 1
   for update;
  if o.id is null then
    raise exception 'nothing to restore: no challenge of yours was ended by a missed day';
  end if;
  if o.restored_at is not null then
    raise exception 'already restored: a challenge can be reopened once';
  end if;
  if o.ended_on_day is null then
    raise exception 'nothing to restore: the missed day is not recorded';
  end if;
  v_missed_on := o.start_date + (o.ended_on_day - 1);
  v_age := (now() at time zone o.timezone)::date - v_missed_on;
  if v_age > public.restore_window_days() then
    raise exception 'restore window closed: day % was % days ago and the window is % days',
      o.ended_on_day, v_age, public.restore_window_days();
  end if;

  -- (b) my alive challenge must be its DIRECT replacement. No chains.
  select * into r from public.challenges
   where owner = auth.uid() and ended_at is null
   for update;
  if r.id is null or r.restarted_from is distinct from o.id then
    raise exception 'not restorable: the current challenge is not the direct replacement of the one that ended';
  end if;

  -- (c) the replacement ends FIRST, so the one-alive-per-owner index is
  --     never violated, not even between two statements.
  update public.challenges
     set ended_at     = now(),
         ended_reason = 'superseded',
         ended_on_day = greatest(public.challenge_day(r), 1)
   where id = r.id;

  -- (d) (e) the original reopens; the reversal is recorded; the cursor sits
  --     just below the missed day; best_flame can only go up.
  update public.challenges
     set ended_at           = null,
         ended_reason       = null,
         ended_on_day       = null,
         restored_at        = now(),
         restored_day       = o.ended_on_day,
         last_evaluated_day = o.ended_on_day - 1,
         missed_notice_day  = null,
         best_flame         = greatest(o.best_flame, r.best_flame)
   where id = o.id;

  -- (f) the missed day is open again. Only the three columns the trigger
  --     permits; the snapshot it was judged from is exactly what it will be
  --     judged from again.
  update public.challenge_days
     set sealed_at = null, outcome = null, evaluated_at = null
   where challenge_id = o.id and day = o.ended_on_day;

  -- (g) the work done on the replacement, carried as NEW rows on the
  --     original, re-based by the gap between the two start dates. Copies
  --     are unsealed (PAY ONCE, above) and bring their completions. A day
  --     the original already holds keeps its own snapshot and gains the
  --     completions. Nothing beyond the original's finish line.
  v_offset := r.start_date - o.start_date;
  insert into public.challenge_days (challenge_id, day, task_snapshot)
  select o.id, cd.day + v_offset, cd.task_snapshot
    from public.challenge_days cd
   where cd.challenge_id = r.id
     and cd.day + v_offset > o.ended_on_day
     and cd.day + v_offset <= o.duration_days
  on conflict (challenge_id, day) do nothing;

  insert into public.task_completions (challenge_id, day, task_key, completed_at, duration_seconds)
  select o.id, tc.day + v_offset, tc.task_key, tc.completed_at, tc.duration_seconds
    from public.task_completions tc
   where tc.challenge_id = r.id
     and tc.day + v_offset > o.ended_on_day
     and tc.day + v_offset <= o.duration_days
  on conflict (challenge_id, day, task_key) do nothing;

  -- (h) the correction, beside the miss. Posted now; the miss stays.
  select squad_id into v_squad from public.squad_members where user_id = auth.uid();
  if v_squad is not null and exists (
       select 1 from public.feed_items
        where author = auth.uid() and kind = 'miss'
          and text like format('missed Day %s.%%', o.ended_on_day)
          and created_at >= o.ended_at - interval '1 day') then
    insert into public.feed_items (squad_id, author, kind, text)
    values (v_squad, auth.uid(), 'change',
            format('reopened Day %s. The miss stands until the day is completed.', o.ended_on_day));
  end if;

  return o.id;
end;
$$;

revoke all on function public.restore_missed_day() from public, anon, authenticated;
grant execute on function public.restore_missed_day() to authenticated;

-- ---- 8. my_restorable_miss — what the offer reads --------------------------
-- One row when the caller's alive challenge directly replaced a challenge
-- ended by a miss inside the window and not yet restored; nothing otherwise.
create or replace function public.my_restorable_miss()
returns table (
  challenge_id uuid,
  missed_day   integer,
  missed_on    date,
  restore_by   date,
  days_left    integer
)
language sql stable security definer set search_path = public
as $$
  select o.id,
         o.ended_on_day,
         o.start_date + (o.ended_on_day - 1),
         o.start_date + (o.ended_on_day - 1) + public.restore_window_days(),
         (o.start_date + (o.ended_on_day - 1) + public.restore_window_days())
           - (now() at time zone o.timezone)::date
    from public.challenges o
    join public.challenges r
      on r.restarted_from = o.id and r.owner = o.owner and r.ended_at is null
   where o.owner = auth.uid()
     and o.ended_reason = 'missed_day'
     and o.restored_at is null
     and o.ended_on_day is not null
     and (now() at time zone o.timezone)::date
         - (o.start_date + (o.ended_on_day - 1)) <= public.restore_window_days()
   order by o.ended_at desc
   limit 1;
$$;

revoke all on function public.my_restorable_miss() from public, anon, authenticated;
grant execute on function public.my_restorable_miss() to authenticated;

-- ---- 9. verification — read this grid --------------------------------------
select * from (
  select 1 as ord, 'ended_reason admits superseded, in exactly one check' as item,
         (select count(*) from pg_constraint
           where conrelid = 'public.challenges'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%superseded%')::text
           || ' with superseded / '
           || (select count(*) from pg_constraint
                where conrelid = 'public.challenges'::regclass and contype = 'c'
                  and pg_get_constraintdef(oid) like '%ended_reason%')::text
           || ' mentioning ended_reason' as actual,
         '1 with superseded / 1 mentioning ended_reason' as expected,
         case when (select count(*) from pg_constraint
                     where conrelid = 'public.challenges'::regclass and contype = 'c'
                       and pg_get_constraintdef(oid) like '%superseded%') = 1
               and (select count(*) from pg_constraint
                     where conrelid = 'public.challenges'::regclass and contype = 'c'
                       and pg_get_constraintdef(oid) like '%ended_reason%') = 1
              then 'OK' else 'FINDING' end as verdict
  union all
  select 2, 'restored_at and restored_day exist',
         (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'challenges'
             and column_name in ('restored_at', 'restored_day'))::text,
         '2',
         case when (select count(*) from information_schema.columns
                     where table_schema = 'public' and table_name = 'challenges'
                       and column_name in ('restored_at', 'restored_day')) = 2
              then 'OK' else 'FINDING' end
  union all
  select 3, 'restore_window_days()',
         public.restore_window_days()::text, '7',
         case when public.restore_window_days() = 7 then 'OK' else 'FINDING' end
  union all
  select 4, 'day_is_open knows the reopened day',
         case when pg_get_functiondef('public.day_is_open(public.challenges,integer)'::regprocedure)
                   like '%restored_day_is_open(c)%' then 'yes' else 'NO' end,
         'yes',
         case when pg_get_functiondef('public.day_is_open(public.challenges,integer)'::regprocedure)
                   like '%restored_day_is_open(c)%' then 'OK' else 'FINDING — the 0011 body is still in force' end
  union all
  select 5, 'get_day_window returns reopened_until',
         case when pg_get_function_result('public.get_day_window()'::regprocedure)
                   like '%reopened_until%' then 'yes' else 'NO' end,
         'yes',
         case when pg_get_function_result('public.get_day_window()'::regprocedure)
                   like '%reopened_until%' then 'OK' else 'FINDING — the 0011 signature survived' end
  union all
  select 6, 'evaluate_challenge waits for the reopened day and keeps 0014/0016/0017',
         case when pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%restored_day_is_open(c)%'
               and pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%owner_is_active(c.owner)%'
               and pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%challenge_has_sealed_day(c.restarted_from)%'
               and pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%v_day < c.first_judged_day%'
              then 'yes' else 'NO' end,
         'yes',
         case when pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%restored_day_is_open(c)%'
               and pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%owner_is_active(c.owner)%'
               and pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%challenge_has_sealed_day(c.restarted_from)%'
               and pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%v_day < c.first_judged_day%'
              then 'OK' else 'FINDING — an earlier phase was overwritten or this one did not land' end
  union all
  select 7, 'restore_missed_day and my_restorable_miss: authenticated yes, anon no',
         case when has_function_privilege('authenticated', 'public.restore_missed_day()', 'EXECUTE')
               and has_function_privilege('authenticated', 'public.my_restorable_miss()', 'EXECUTE')
               and has_function_privilege('authenticated', 'public.get_day_window()', 'EXECUTE')
               and not has_function_privilege('anon', 'public.restore_missed_day()', 'EXECUTE')
               and not has_function_privilege('anon', 'public.my_restorable_miss()', 'EXECUTE')
               and not has_function_privilege('anon', 'public.get_day_window()', 'EXECUTE')
              then 'yes' else 'NO' end,
         'yes',
         case when has_function_privilege('authenticated', 'public.restore_missed_day()', 'EXECUTE')
               and has_function_privilege('authenticated', 'public.my_restorable_miss()', 'EXECUTE')
               and has_function_privilege('authenticated', 'public.get_day_window()', 'EXECUTE')
               and not has_function_privilege('anon', 'public.restore_missed_day()', 'EXECUTE')
               and not has_function_privilege('anon', 'public.my_restorable_miss()', 'EXECUTE')
               and not has_function_privilege('anon', 'public.get_day_window()', 'EXECUTE')
              then 'OK' else 'FINDING' end
  union all
  select 8, 'the clock helpers and the engine are unreachable from the app',
         case when has_function_privilege('authenticated', 'public.restore_window_days()', 'EXECUTE')
                or has_function_privilege('authenticated', 'public.restored_day_closes_at(public.challenges)', 'EXECUTE')
                or has_function_privilege('authenticated', 'public.restored_day_is_open(public.challenges)', 'EXECUTE')
                or has_function_privilege('authenticated', 'public.evaluate_challenge(uuid)', 'EXECUTE')
                or has_function_privilege('authenticated', 'public.restart_challenge(uuid,integer,text)', 'EXECUTE')
              then 'a client role holds EXECUTE' else 'no client role holds EXECUTE' end,
         'no client role holds EXECUTE',
         case when has_function_privilege('authenticated', 'public.restore_window_days()', 'EXECUTE')
                or has_function_privilege('authenticated', 'public.restored_day_closes_at(public.challenges)', 'EXECUTE')
                or has_function_privilege('authenticated', 'public.restored_day_is_open(public.challenges)', 'EXECUTE')
                or has_function_privilege('authenticated', 'public.evaluate_challenge(uuid)', 'EXECUTE')
                or has_function_privilege('authenticated', 'public.restart_challenge(uuid,integer,text)', 'EXECUTE')
              then 'FINDING' else 'OK' end
  union all
  select 9, 'challenges restorable right now, across all owners',
         (select count(*) from public.challenges o
            join public.challenges r on r.restarted_from = o.id and r.ended_at is null
           where o.ended_reason = 'missed_day' and o.restored_at is null
             and o.ended_on_day is not null
             and (now() at time zone o.timezone)::date
                 - (o.start_date + (o.ended_on_day - 1)) <= public.restore_window_days())::text,
         'informational',
         'read it — each is an owner who could reopen a day today; nothing is done to them by this file'
  union all
  select 10, 'rows already superseded or restored',
         (select count(*) from public.challenges where ended_reason = 'superseded')::text
           || ' superseded / '
           || (select count(*) from public.challenges where restored_at is not null)::text
           || ' restored',
         '0 / 0 on first application',
         'informational'
) v order by ord;
