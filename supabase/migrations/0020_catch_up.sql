-- =============================================================================
-- Phase 38Q: CATCH-UP. A run of unlogged days reopens in one go, up to
-- fourteen days back. Every line below serves the property 0018 set:
--
--     RESTORING CHANGES NO FLAME. ONLY SEALING THE DAY DOES.
--
-- ASSUMED STARTING STATE: 0019 is fully applied — challenge_restores exists
-- with its trigger and RLS, restore_missed_day() and my_restorable_miss()
-- refuse by ending (challenge id + ended_at), restored_at / restored_day
-- are on challenges, and day_is_open / get_day_window / evaluate_challenge
-- are the 0018 bodies. This file adds one column to each of the two tables,
-- widens the window, teaches day_is_open and get_day_window a RANGE of
-- reopened days, recreates restore_missed_day() with two additions, and adds
-- the catch-up RPC and the offer that succeeds my_restorable_miss(). The
-- evaluator, the clock helpers, task_snapshot, forbid_snapshot_mutation()
-- and forbid_restore_mutation() are untouched.
--
-- WHY. The owner's run was sealed and met through day 42. Day 43 was done
-- and never logged; at noon on day 44 the evaluator ended the run. Nothing
-- was ticked anywhere afterwards: an empty restart missed its day 1, its
-- restart ended dormant, a fresh challenge started by hand missed its day
-- 2, and its restart ended dormant. On day 51 nothing is alive and 0019 can
-- offer nothing: day 43 is eight days old against a seven-day window, no
-- alive challenge is a direct replacement, and a dormant link and an
-- unlinked fresh start sit in the chain. He did the challenge on those days.
--
-- THE OWNER'S DECISION, for every user: a person whose run ended can reopen
-- ALL the unlogged days since it ended, in one go, if the first of them is
-- no more than fourteen days old. They tick and lock in each day they did.
-- The run continues at today's day number. The squad sees a correction.
--
-- THE RULE.
--   WINDOW   restore_window_days() is 14, one function, single restores
--            and catch-up alike, measured from the FIRST missed day.
--   ANCHOR   the caller's most recent challenge that has a sealed day,
--            ended by 'missed_day' or 'dormant', whose current ending
--            (challenge id + ended_at, 0019) has not been reversed. Nothing
--            can be faked: ended_at is written only by SECURITY DEFINER
--            functions, no client role holds UPDATE on challenges or any
--            write on challenge_restores, and the unique index on
--            (challenge_id, ended_at) refuses a second record of one ending
--            whatever the predicate says.
--   GAP      from the anchor's first missed day (ended_on_day: the evaluator
--            ends a run at its FIRST miss, 0007 PROOF 4) through yesterday
--            in the anchor's zone, capped at the run's length.
--   AFTER IT every challenge created at or after the anchor's ending must
--            have ZERO sealed days — dormant, missed, unlinked fresh starts
--            and restarts all qualify. Any sealed day refuses the catch-up
--            and leaves 0019's one-day path as the way back. An ALIVE later
--            challenge is ended 'superseded' first, in the same transaction,
--            so one-alive-per-owner never breaks; its ticks carry over to the
--            anchor by CALENDAR DATE, onto days whose snapshot names the
--            task. Ended challenges are left exactly as they are.
--   SNAPSHOT every gap day never frozen gets the task set in effect for its
--            own day number: compose_task_set(id, day), which is exactly what
--            get_or_freeze_day() writes when the app freezes a day
--            (0011:151-152) — a custom task's active_from_day and
--            removed_from_day, a target override's effective_from_day and
--            the tier in force are all read per day. The missed day's own
--            row keeps the snapshot it was judged from; only sealed_at,
--            outcome and evaluated_at go back to null, the three columns
--            forbid_snapshot_mutation() permits (0007:299-320).
--   CLOCK    every reopened day stays open until noon the day after the
--            catch-up, in the anchor's zone: 0018's restored_day_is_open()
--            and restored_day_closes_at() unchanged, applied to the range
--            restored_day .. restored_last_day. After that the evaluator
--            judges the reopened days in order exactly as it always has —
--            the cursor sits at first − 1 — and the first day that is not
--            met ends the run again. Nothing is manufactured.
--   PAY ONCE 0011:308-310: "The flame is a COUNT of met days, so it does not
--            matter whether today or yesterday is sealed first: each met day
--            pays exactly once, here or in the evaluator's retroactive seal,
--            never both." Catch-up seals nothing and pays nothing; each day
--            the person locks in pays at seal_day(), and a day they finish
--            but do not seal pays once when the evaluator reaches it.
--            best_flame never decreases.
--   HISTORY  one challenge_restores row per catch-up: the anchor, the ending
--            reversed, first and last reopened day (last_day is the new
--            column; a single-day restore writes last_day = missed_day), the
--            challenge superseded if any. Same append-only trigger, same RLS.
--   FEED     one 'change' item, "reopened Days 43–50. …". The misses stay.
--
-- ATOMICITY (../migrations/README.md): each statement commits on its own.
-- Columns are added first, each IF NOT EXISTS; every function is a single
-- CREATE OR REPLACE, so nothing is ever dropped without its replacement;
-- the two new RPCs are created and then their client grants settled — in
-- between, a call from anon reaches auth.uid() null and does nothing; no
-- temp tables; safe to paste twice. The last statement is the verification
-- grid: read it, every row OK.
-- =============================================================================

-- ---- 1. the window: fourteen days, one function -----------------------------
create or replace function public.restore_window_days()
returns integer
language sql immutable
as $$ select 14 $$;

-- ---- 2. the range, on the row; the range, on the record ---------------------
alter table public.challenges
  add column if not exists restored_last_day integer;

alter table public.challenge_restores
  add column if not exists last_day integer;

-- ---- 3. day_is_open — the 0018 body, the reopened day becomes a range -----
-- Every write RPC consults this and nothing else (0011), so every reopened
-- day is writable everywhere at once. A single-day restore has
-- restored_last_day = restored_day, or null from before this file: the
-- coalesce reads both as the one day.
create or replace function public.day_is_open(c public.challenges, p_day integer)
returns boolean
language sql stable
as $$
  select (p_day >= public.earliest_open_day(c)
          and p_day <= public.challenge_day(c))
      or (p_day between c.restored_day and coalesce(c.restored_last_day, c.restored_day)
          and public.restored_day_is_open(c));
$$;

-- ---- 4. get_day_window — every reopened day is a row, with the one close --
-- Same return type as 0018, so CREATE OR REPLACE and the grant stands.
create or replace function public.get_day_window()
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
         case when cd.day between c.restored_day and coalesce(c.restored_last_day, c.restored_day)
               and public.restored_day_is_open(c)
              then public.restored_day_closes_at(c) else null end
  from public.challenge_days cd
  where cd.challenge_id = c.id
    and (   cd.day between greatest(1, v_today - 1) and v_today
         or (cd.day between c.restored_day and coalesce(c.restored_last_day, c.restored_day)
             and public.restored_day_is_open(c)))
  order by cd.day;
end;
$$;

-- ---- 5. restore_missed_day — the 0019 body, plus the range and the record --
-- Two additions, marked PHASE 38Q: restored_last_day = the one day, so a
-- later catch-up's range can never linger on the row; last_day on the
-- record. Everything else is 0019, character for character.
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
  v_prior    timestamptz;
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
  if o.ended_at is null or o.ended_on_day is null then
    raise exception 'nothing to restore: the ending is not recorded';
  end if;
  -- PHASE 38P. THIS ENDING, not this challenge.
  select cr.restored_at into v_prior
    from public.challenge_restores cr
   where cr.challenge_id = o.id and cr.ended_at = o.ended_at;
  if v_prior is not null then
    raise exception 'already restored: this ending of day % was reopened on %',
      o.ended_on_day, to_char(v_prior at time zone o.timezone, 'YYYY-MM-DD');
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

  -- (d) (e) the original reopens; the LATEST reversal is on the row; the
  --     cursor sits just below the missed day; best_flame can only go up.
  update public.challenges
     set ended_at           = null,
         ended_reason       = null,
         ended_on_day       = null,
         restored_at        = now(),
         restored_day       = o.ended_on_day,
         restored_last_day  = o.ended_on_day,     -- PHASE 38Q: the one day
         last_evaluated_day = o.ended_on_day - 1,
         missed_notice_day  = null,
         best_flame         = greatest(o.best_flame, r.best_flame)
   where id = o.id;

  -- (d') PHASE 38P. The record, appended: this ending, this replacement,
  --      now. PHASE 38Q: last_day names the one day.
  insert into public.challenge_restores
    (challenge_id, owner, missed_day, last_day, ended_at, superseded_challenge_id, restored_at)
  values (o.id, o.owner, o.ended_on_day, o.ended_on_day, o.ended_at, r.id, now());

  -- (f) the missed day is open again. Only the three columns the trigger
  --     permits; the snapshot it was judged from is exactly what it will be
  --     judged from again.
  update public.challenge_days
     set sealed_at = null, outcome = null, evaluated_at = null
   where challenge_id = o.id and day = o.ended_on_day;

  -- (g) the work done on the replacement, carried as NEW rows on the
  --     original, re-based by the gap between the two start dates. Copies
  --     are unsealed (PAY ONCE, 0018) and bring their completions.
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

  -- (h) the correction, beside the miss. Posted now, every time; the miss
  --     stays.
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

-- ---- 6. catch_up_missed_days — the gap, reopened in one transaction --------
create or replace function public.catch_up_missed_days()
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  a        public.challenges;   -- the anchor: the run that ended
  r        public.challenges;   -- an alive later challenge, if any
  l        record;
  v_today  integer;
  v_first  integer;
  v_last   integer;
  v_age    integer;
  v_prior  timestamptz;
  v_squad  uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  -- (a) THE ANCHOR: my most recent run with a sealed day, ended by a miss or
  --     by dormancy. Locked, so two taps cannot both get past (b).
  select * into a from public.challenges c
   where c.owner = auth.uid()
     and c.ended_reason in ('missed_day', 'dormant')
     and c.ended_at is not null
     and c.ended_on_day is not null
     and public.challenge_has_sealed_day(c.id)
   order by c.ended_at desc
   limit 1
   for update;
  if a.id is null then
    raise exception 'nothing to catch up: no ended run of yours has a sealed day';
  end if;
  -- THIS ENDING (0019): refused if it was already reversed.
  select cr.restored_at into v_prior
    from public.challenge_restores cr
   where cr.challenge_id = a.id and cr.ended_at = a.ended_at;
  if v_prior is not null then
    raise exception 'already restored: this ending of day % was reopened on %',
      a.ended_on_day, to_char(v_prior at time zone a.timezone, 'YYYY-MM-DD');
  end if;

  -- (b) THE GAP: the first missed day through yesterday, in the anchor's
  --     zone, within the run; the window measured from the first day.
  v_today := public.challenge_day(a);
  v_first := a.ended_on_day;
  v_last  := least(v_today - 1, a.duration_days);
  if v_last < v_first then
    raise exception 'nothing to catch up: day % has not closed yet', v_first;
  end if;
  v_age := (now() at time zone a.timezone)::date - (a.start_date + (v_first - 1));
  if v_age > public.restore_window_days() then
    raise exception 'catch-up window closed: day % was % days ago and the window is % days',
      v_first, v_age, public.restore_window_days();
  end if;

  -- (c) WHAT SITS AFTER IT: nothing sealed, or this is not the way back.
  --     `created_at >= ended_at`, not `>`: the restart the evaluator made in
  --     the same transaction as the ending carries the same timestamp.
  for l in
    select c.id from public.challenges c
     where c.owner = auth.uid() and c.id <> a.id and c.created_at >= a.ended_at
  loop
    if public.challenge_has_sealed_day(l.id) then
      raise exception 'not catch-up-able: a challenge after the one that ended has a sealed day; reopen one day at a time';
    end if;
  end loop;

  -- (d) An alive later challenge ends FIRST, so one-alive-per-owner holds
  --     between every statement here.
  select * into r from public.challenges
   where owner = auth.uid() and ended_at is null
   for update;
  if r.id is not null then
    update public.challenges
       set ended_at     = now(),
           ended_reason = 'superseded',
           ended_on_day = greatest(public.challenge_day(r), 1)
     where id = r.id;
  end if;

  -- (e) The anchor reopens with the RANGE on the row; the cursor sits just
  --     below the first missed day; best_flame can only go up.
  update public.challenges
     set ended_at           = null,
         ended_reason       = null,
         ended_on_day       = null,
         restored_at        = now(),
         restored_day       = v_first,
         restored_last_day  = v_last,
         last_evaluated_day = v_first - 1,
         missed_notice_day  = null,
         best_flame         = greatest(a.best_flame, coalesce(r.best_flame, 0))
   where id = a.id;

  -- (f) The record, appended: the anchor, the ending reversed, the range,
  --     the challenge superseded. `a` still holds the row as it was read.
  insert into public.challenge_restores
    (challenge_id, owner, missed_day, last_day, ended_at, superseded_challenge_id, restored_at)
  values (a.id, a.owner, v_first, v_last, a.ended_at, r.id, now());

  -- (g) The missed day's row goes back to open, as 0018 did it: the three
  --     columns the trigger permits, the snapshot it was judged from kept.
  update public.challenge_days
     set sealed_at = null, outcome = null, evaluated_at = null
   where challenge_id = a.id and day = v_first;

  -- (h) Gap days never frozen get the task set in effect for each of them —
  --     the same call get_or_freeze_day() makes (0011:151-152). A day that
  --     already has a row keeps it. Today's row too, so a tick carried onto
  --     today has a snapshot to count against.
  insert into public.challenge_days (challenge_id, day, task_snapshot)
  select a.id, d, public.compose_task_set(a.id, d)
    from generate_series(v_first, least(v_today, a.duration_days)) as d
  on conflict (challenge_id, day) do nothing;

  -- (i) Ticks on the superseded challenge carry over BY CALENDAR DATE, onto
  --     anchor days whose snapshot names the task. Its own rows stay.
  if r.id is not null then
    insert into public.task_completions (challenge_id, day, task_key, completed_at, duration_seconds)
    select a.id,
           ((r.start_date + (tc.day - 1)) - a.start_date) + 1,
           tc.task_key, tc.completed_at, tc.duration_seconds
      from public.task_completions tc
     where tc.challenge_id = r.id
       and ((r.start_date + (tc.day - 1)) - a.start_date) + 1 between v_first and least(v_today, a.duration_days)
       and exists (select 1 from public.challenge_days cd, jsonb_array_elements(cd.task_snapshot) t
                    where cd.challenge_id = a.id
                      and cd.day = ((r.start_date + (tc.day - 1)) - a.start_date) + 1
                      and t->>'key' = tc.task_key)
    on conflict (challenge_id, day, task_key) do nothing;
  end if;

  -- (j) The correction. The misses stay; the squad sees the range.
  select squad_id into v_squad from public.squad_members where user_id = auth.uid();
  if v_squad is not null then
    insert into public.feed_items (squad_id, author, kind, text)
    values (v_squad, auth.uid(), 'change',
            case when v_first = v_last
                 then format('reopened Day %s. The miss stands until the day is completed.', v_first)
                 else format('reopened Days %s–%s. The misses stand until each day is completed.', v_first, v_last)
            end);
  end if;

  return a.id;
end;
$$;

-- ---- 7. my_reopen_offer — what the offer reads; my_restorable_miss's successor
-- One row: the catch-up when the rule allows it, else 0019's single day,
-- else nothing. `kind` says which RPC the tap must call. Single-day rows
-- carry last_day = missed_day, so one shape serves both.
create or replace function public.my_reopen_offer()
returns table (
  challenge_id uuid,
  kind         text,
  missed_day   integer,
  last_day     integer,
  missed_on    date,
  last_on      date,
  restore_by   date,
  days_left    integer
)
language plpgsql stable security definer set search_path = public
as $$
declare
  a       public.challenges;
  v_today integer;
  v_first integer;
  v_last  integer;
  v_age   integer;
begin
  if auth.uid() is null then
    return;
  end if;
  select * into a from public.challenges c
   where c.owner = auth.uid()
     and c.ended_reason in ('missed_day', 'dormant')
     and c.ended_at is not null
     and c.ended_on_day is not null
     and public.challenge_has_sealed_day(c.id)
     and not exists (select 1 from public.challenge_restores cr
                      where cr.challenge_id = c.id and cr.ended_at = c.ended_at)
   order by c.ended_at desc
   limit 1;
  if a.id is not null then
    v_today := public.challenge_day(a);
    v_first := a.ended_on_day;
    v_last  := least(v_today - 1, a.duration_days);
    v_age   := (now() at time zone a.timezone)::date - (a.start_date + (v_first - 1));
    if v_last >= v_first
       and v_age <= public.restore_window_days()
       and not exists (select 1 from public.challenges c
                        where c.owner = auth.uid() and c.id <> a.id
                          and c.created_at >= a.ended_at
                          and public.challenge_has_sealed_day(c.id)) then
      return query
      select a.id, 'catchup'::text, v_first, v_last,
             a.start_date + (v_first - 1),
             a.start_date + (v_last - 1),
             a.start_date + (v_first - 1) + public.restore_window_days(),
             public.restore_window_days() - v_age;
      return;
    end if;
  end if;
  return query
  select m.challenge_id, 'single'::text, m.missed_day, m.missed_day,
         m.missed_on, m.missed_on, m.restore_by, m.days_left
    from public.my_restorable_miss() m;
end;
$$;

-- ---- 8. grants: granted first, the surplus revoked second ------------------
grant execute on function public.catch_up_missed_days() to authenticated;
grant execute on function public.my_reopen_offer() to authenticated;
revoke execute on function public.catch_up_missed_days() from public, anon;
revoke execute on function public.my_reopen_offer() from public, anon;

-- ---- 9. verification — read this grid --------------------------------------
select * from (
  select 1 as ord, 'restore_window_days()' as item,
         public.restore_window_days()::text as actual, '14' as expected,
         case when public.restore_window_days() = 14 then 'OK' else 'FINDING' end as verdict
  union all
  select 2, 'challenges.restored_last_day and challenge_restores.last_day exist',
         (select count(*) from information_schema.columns
           where table_schema = 'public'
             and ((table_name = 'challenges' and column_name = 'restored_last_day')
               or (table_name = 'challenge_restores' and column_name = 'last_day')))::text,
         '2',
         case when (select count(*) from information_schema.columns
                     where table_schema = 'public'
                       and ((table_name = 'challenges' and column_name = 'restored_last_day')
                         or (table_name = 'challenge_restores' and column_name = 'last_day'))) = 2
              then 'OK' else 'FINDING' end
  union all
  select 3, 'day_is_open knows the range',
         case when pg_get_functiondef('public.day_is_open(public.challenges,integer)'::regprocedure)
                   like '%restored_last_day%' then 'yes' else 'NO' end,
         'yes',
         case when pg_get_functiondef('public.day_is_open(public.challenges,integer)'::regprocedure)
                   like '%restored_last_day%' then 'OK' else 'FINDING — the 0018 body is still in force' end
  union all
  select 4, 'get_day_window returns the range, with reopened_until',
         case when pg_get_functiondef('public.get_day_window()'::regprocedure) like '%restored_last_day%'
               and pg_get_function_result('public.get_day_window()'::regprocedure) like '%reopened_until%'
              then 'yes' else 'NO' end,
         'yes',
         case when pg_get_functiondef('public.get_day_window()'::regprocedure) like '%restored_last_day%'
               and pg_get_function_result('public.get_day_window()'::regprocedure) like '%reopened_until%'
              then 'OK' else 'FINDING — the 0018 body is still in force' end
  union all
  select 5, 'catch_up_missed_days and my_reopen_offer: authenticated yes, anon no',
         case when has_function_privilege('authenticated', 'public.catch_up_missed_days()', 'EXECUTE')
               and has_function_privilege('authenticated', 'public.my_reopen_offer()', 'EXECUTE')
               and not has_function_privilege('anon', 'public.catch_up_missed_days()', 'EXECUTE')
               and not has_function_privilege('anon', 'public.my_reopen_offer()', 'EXECUTE')
              then 'yes' else 'NO' end,
         'yes',
         case when has_function_privilege('authenticated', 'public.catch_up_missed_days()', 'EXECUTE')
               and has_function_privilege('authenticated', 'public.my_reopen_offer()', 'EXECUTE')
               and not has_function_privilege('anon', 'public.catch_up_missed_days()', 'EXECUTE')
               and not has_function_privilege('anon', 'public.my_reopen_offer()', 'EXECUTE')
              then 'OK' else 'FINDING' end
  union all
  select 6, 'restore_missed_day keeps 0019''s ending identity and writes the one-day range',
         case when pg_get_functiondef('public.restore_missed_day()'::regprocedure) like '%cr.ended_at = o.ended_at%'
               and pg_get_functiondef('public.restore_missed_day()'::regprocedure) like '%restored_last_day  = o.ended_on_day%'
              then 'yes' else 'NO' end,
         'yes',
         case when pg_get_functiondef('public.restore_missed_day()'::regprocedure) like '%cr.ended_at = o.ended_at%'
               and pg_get_functiondef('public.restore_missed_day()'::regprocedure) like '%restored_last_day  = o.ended_on_day%'
              then 'OK' else 'FINDING — the 0019 body is still in force' end
  union all
  select 7, '0018/0019 untouched: the evaluator waits on the reopened clock; my_restorable_miss refuses by ending',
         case when pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%restored_day_is_open(c)%'
               and pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%v_day < c.first_judged_day%'
               and pg_get_functiondef('public.my_restorable_miss()'::regprocedure) like '%cr.ended_at = o.ended_at%'
               and (select count(*) from pg_trigger
                     where tgrelid = 'public.challenge_restores'::regclass
                       and tgname = 'challenge_restores_append_only' and not tgisinternal) = 1
              then 'yes' else 'NO' end,
         'yes',
         case when pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%restored_day_is_open(c)%'
               and pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%v_day < c.first_judged_day%'
               and pg_get_functiondef('public.my_restorable_miss()'::regprocedure) like '%cr.ended_at = o.ended_at%'
               and (select count(*) from pg_trigger
                     where tgrelid = 'public.challenge_restores'::regclass
                       and tgname = 'challenge_restores_append_only' and not tgisinternal) = 1
              then 'OK' else 'FINDING — an earlier phase is not fully applied; stop and apply it first' end
  union all
  select 8, 'catch-ups restorable right now, across all owners',
         (select count(*) from public.challenges a
           where a.ended_reason in ('missed_day', 'dormant')
             and a.ended_at is not null and a.ended_on_day is not null
             and public.challenge_has_sealed_day(a.id)
             and not exists (select 1 from public.challenge_restores cr
                              where cr.challenge_id = a.id and cr.ended_at = a.ended_at)
             and a.ended_at = (select max(b.ended_at) from public.challenges b
                                where b.owner = a.owner
                                  and b.ended_reason in ('missed_day', 'dormant')
                                  and b.ended_at is not null and b.ended_on_day is not null
                                  and public.challenge_has_sealed_day(b.id)
                                  and not exists (select 1 from public.challenge_restores cr
                                                   where cr.challenge_id = b.id and cr.ended_at = b.ended_at))
             and least(public.challenge_day(a) - 1, a.duration_days) >= a.ended_on_day
             and (now() at time zone a.timezone)::date - (a.start_date + (a.ended_on_day - 1))
                 <= public.restore_window_days()
             and not exists (select 1 from public.challenges c
                              where c.owner = a.owner and c.id <> a.id
                                and c.created_at >= a.ended_at
                                and public.challenge_has_sealed_day(c.id)))::text,
         'informational — 1 on 2026-10-13 is the owner (days 43–50); before this file it read 0',
         'read it'
  union all
  select 9, 'single-day restores offerable right now, across all owners (0019''s rule, 14-day window)',
         (select count(*) from public.challenges o
            join public.challenges r on r.restarted_from = o.id and r.ended_at is null
           where o.ended_reason = 'missed_day' and o.ended_at is not null and o.ended_on_day is not null
             and not exists (select 1 from public.challenge_restores cr
                              where cr.challenge_id = o.id and cr.ended_at = o.ended_at)
             and (now() at time zone o.timezone)::date
                 - (o.start_date + (o.ended_on_day - 1)) <= public.restore_window_days())::text,
         'informational — 0 on 2026-10-13: nothing is alive',
         'read it'
  union all
  select 10, 'restore records in total / with a range',
         (select count(*) from public.challenge_restores)::text || ' / '
           || (select count(*) from public.challenge_restores where last_day is not null)::text,
         'informational — N / 0 on first application',
         'read it'
) v order by ord;
