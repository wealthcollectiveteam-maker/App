-- =============================================================================
-- Phase 38P: a missed day can be restored EVERY TIME it ends a run, not once
-- per run. Every line below serves one property, unchanged from 0018:
--
--     RESTORING CHANGES NO FLAME. ONLY SEALING THE DAY DOES.
--
-- ASSUMED STARTING STATE: 0018 is fully applied — challenges carries
-- restored_at and restored_day, ended_reason admits 'superseded',
-- restore_missed_day() and my_restorable_miss() are the 0018 bodies, and
-- day_is_open / get_day_window / evaluate_challenge are the 0018 bodies too.
-- This file does not touch those three, the clock helpers, task_snapshot or
-- forbid_snapshot_mutation(). It adds one table, one trigger, recreates the
-- two restore RPCs, and backfills the record of restores made before it.
--
-- WHY. The owner did Day 37 (2026-09-29) and did not log it inside the grace
-- window; at noon on 09-30 the evaluator ended the run and restarted him at
-- Day 1. No restore was offered. The cause is one predicate, in both RPCs:
--
--     0018:421   if o.restored_at is not null then
--     0018:422     raise exception 'already restored: a challenge can be reopened once';
--     0018:536   and o.restored_at is null
--
-- His run had been restored once already (Day 30, on 09-25), and
-- restart_challenge() never clears restored_at, so the second miss was
-- refused by design. The design was wrong for this product. THE OWNER'S
-- DECISION, for every user: any day ended by a miss can be restored within
-- seven days of the missed day, every time it happens. No cap per run.
--
-- THE RULE. Restorable = the caller's most recent challenge ended by
-- 'missed_day', within restore_window_days() of the missed day (unchanged),
-- whose CURRENT ENDING has not already been reopened.
--
-- HOW "THIS ENDING" IS IDENTIFIED, and why it cannot be fooled. An ending is
-- the pair (challenge_id, ended_at): the timestamp the evaluator wrote when
-- it ended the run. Every restore records the ending it reversed in
-- public.challenge_restores, and the RPC refuses an ending that already has
-- a record. Three things make the key sound:
--   1. Both halves are server-written. ended_at is set only inside
--      SECURITY DEFINER functions (the evaluator, restart_challenge, the
--      default-deny simulations) and no client role holds UPDATE on
--      challenges; the history table has no client write grant at all and
--      is written in exactly one place, inside restore_missed_day().
--   2. A later ending can never carry an earlier one's timestamp. A restore
--      sets ended_at to null; for the run to end again the reopened day must
--      first close, which is noon the day after the restore at the earliest.
--      The second ending's now() is therefore strictly after the first's.
--   3. A unique index on (challenge_id, ended_at) refuses a second record of
--      the same ending at the storage layer, whatever the predicate says.
--
-- HISTORY IS APPEND-ONLY. restored_at and restored_day on challenges stay as
-- "latest" — the reopened day's clock (restored_day_closes_at,
-- restored_day_is_open, 0018) reads them and is unchanged. The second restore
-- overwrites them, so the record of the first lives in challenge_restores:
-- challenge, owner, missed day, the ending reversed, the replacement
-- superseded, when. Owner reads their own through RLS; no client writes; a
-- trigger refuses UPDATE and every DELETE that is not the cascade from a
-- deleted challenge (the forbid_snapshot_mutation() shape, 0007). The owner
-- column carries no foreign key on purpose: the only cascade path is through
-- challenge_id, so delete_account() reaches the rows exactly once, after the
-- challenge is gone, and the trigger lets them go.
--
-- EVERYTHING ELSE FROM 38G STAYS: restoring pays no flame; best_flame never
-- decreases; direct replacement only; one alive challenge per owner, never
-- violated even between statements (the replacement ends first, in the same
-- transaction); task_snapshot untouched; the replacement's work carries over
-- unsealed and pays once; the miss stays in the feed and a correction is
-- posted beside it, every time; nothing backdated.
--
-- ATOMICITY (../migrations/README.md). The SQL editor commits each statement
-- on its own, so: the table is created WITH its RLS, policy and grants in one
-- DO block; the trigger function is created and its client grants revoked in
-- one DO block; the trigger is created in one guarded DO block; each RPC is a
-- single CREATE OR REPLACE, so no function is ever dropped without its
-- replacement; no temp tables; every statement is independently re-runnable
-- and the file is safe to paste twice. The last statement is the
-- verification grid: read it, every row OK.
-- =============================================================================

-- ---- 1. the record of every restore, with its walls, in one statement ------
do $$
begin
  create table if not exists public.challenge_restores (
    id                      bigint generated always as identity primary key,
    challenge_id            uuid not null references public.challenges (id) on delete cascade,
    owner                   uuid not null,
    missed_day              integer not null,
    -- The ending this restore reversed: challenges.ended_at as it stood.
    -- Null only on rows backfilled by this file for restores made under
    -- 0018, which did not keep the reversed ending's timestamp.
    ended_at                timestamptz,
    -- The replacement that was superseded. No foreign key: it belongs to the
    -- same owner and leaves with the same delete_account(); a SET NULL here
    -- would be an UPDATE the append-only trigger refuses.
    superseded_challenge_id uuid,
    restored_at             timestamptz not null default now(),
    note                    text
  );
  -- ONE RECORD PER ENDING. The storage-layer half of "this ending cannot
  -- be restored twice".
  create unique index if not exists challenge_restores_one_per_ending
    on public.challenge_restores (challenge_id, ended_at)
    where ended_at is not null;
  create index if not exists challenge_restores_owner_idx
    on public.challenge_restores (owner);

  alter table public.challenge_restores enable row level security;
  drop policy if exists restores_owner_read on public.challenge_restores;
  create policy restores_owner_read on public.challenge_restores
    for select to authenticated using (owner = auth.uid());

  -- Supabase's default privileges hand every client role ALL on a new table
  -- and its sequence. Clawed back here, in the same transaction as the
  -- table: there is no moment at which it exists without its walls.
  revoke all on public.challenge_restores from public, anon, authenticated;
  grant select on public.challenge_restores to authenticated;
  execute format('revoke all on sequence %s from public, anon, authenticated',
                 pg_get_serial_sequence('public.challenge_restores', 'id'));
end $$;

-- ---- 2. append-only: the trigger function, created and sealed together ----
do $$
begin
  execute $fn$
    create or replace function public.forbid_restore_mutation()
    returns trigger
    language plpgsql
    as $body$
    begin
      if tg_op = 'DELETE' then
        if not exists (select 1 from public.challenges where id = old.challenge_id) then
          return old;   -- the challenge itself is being deleted; let it cascade
        end if;
      end if;
      raise exception 'restore history is append-only';
    end;
    $body$
  $fn$;
  revoke all on function public.forbid_restore_mutation() from public, anon, authenticated;
end $$;

-- ---- 3. the trigger, once -------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.challenge_restores'::regclass
       and tgname  = 'challenge_restores_append_only'
       and not tgisinternal
  ) then
    create trigger challenge_restores_append_only
      before update or delete on public.challenge_restores
      for each row execute function public.forbid_restore_mutation();
  end if;
end $$;

-- ---- 4. restores made under 0018, put on the record --------------------------
-- One row per challenge that carries restored_at and has no record at all —
-- 0018 allowed one restore per challenge, so that is exactly the set, and a
-- second paste adds nothing because every such challenge now has its row.
-- The replacement it superseded is the one whose ending is that same instant
-- (0018 ended it in the same transaction). The reversed ending's timestamp
-- was not kept, so ended_at stays null — which can never match a live
-- ending, so these rows block nothing: a challenge restored under 0018 has
-- either no ending now, or a later one.
insert into public.challenge_restores
  (challenge_id, owner, missed_day, ended_at, superseded_challenge_id, restored_at, note)
select c.id, c.owner, c.restored_day, null,
       (select r.id from public.challenges r
         where r.restarted_from = c.id and r.ended_reason = 'superseded'
           and r.ended_at = c.restored_at
         limit 1),
       c.restored_at,
       'recorded by 0019 from challenges.restored_at; the reversed ending''s timestamp was not kept before 0019'
  from public.challenges c
 where c.restored_at is not null
   and c.restored_day is not null
   and not exists (select 1 from public.challenge_restores x
                    where x.challenge_id = c.id);

-- ---- 5. restore_missed_day — the 0018 body, one predicate and one insert ---
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
  -- PHASE 38P. THIS ENDING, not this challenge. The ending is identified by
  -- its own timestamp; a run that was restored before and has ended again
  -- carries a later ended_at than any record of it, and is restorable.
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
         last_evaluated_day = o.ended_on_day - 1,
         missed_notice_day  = null,
         best_flame         = greatest(o.best_flame, r.best_flame)
   where id = o.id;

  -- (d') PHASE 38P. The record, appended: this ending, this replacement,
  --      now. The only INSERT into challenge_restores anywhere. o still
  --      holds the row as it was read, so o.ended_at is the ending reversed.
  insert into public.challenge_restores
    (challenge_id, owner, missed_day, ended_at, superseded_challenge_id, restored_at)
  values (o.id, o.owner, o.ended_on_day, o.ended_at, r.id, now());

  -- (f) the missed day is open again. Only the three columns the trigger
  --     permits; the snapshot it was judged from is exactly what it will be
  --     judged from again.
  update public.challenge_days
     set sealed_at = null, outcome = null, evaluated_at = null
   where challenge_id = o.id and day = o.ended_on_day;

  -- (g) the work done on the replacement, carried as NEW rows on the
  --     original, re-based by the gap between the two start dates. Copies
  --     are unsealed (PAY ONCE, 0018) and bring their completions. A day
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

-- ---- 6. my_restorable_miss — what the offer reads, the 0018 body ---------
-- One row when the caller's alive challenge directly replaced a challenge
-- ended by a miss inside the window whose current ending has not been
-- reopened; nothing otherwise.
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
     and o.ended_at is not null
     and o.ended_on_day is not null
     -- PHASE 38P: this ending, not this challenge.
     and not exists (select 1 from public.challenge_restores cr
                      where cr.challenge_id = o.id and cr.ended_at = o.ended_at)
     and (now() at time zone o.timezone)::date
         - (o.start_date + (o.ended_on_day - 1)) <= public.restore_window_days()
   order by o.ended_at desc
   limit 1;
$$;

-- ---- 7. grants: what is missing is granted; only the surplus is revoked ---
-- CREATE OR REPLACE keeps a function's privileges, so on a database that
-- had 0018 these are no-ops. Grant first, revoke second: at no point does
-- `authenticated` lose the RPCs.
grant execute on function public.restore_missed_day() to authenticated;
grant execute on function public.my_restorable_miss() to authenticated;
revoke execute on function public.restore_missed_day() from public, anon;
revoke execute on function public.my_restorable_miss() from public, anon;

-- ---- 8. verification — read this grid --------------------------------------
select * from (
  select 1 as ord, 'challenge_restores exists, RLS on, owner-read policy present' as item,
         case when to_regclass('public.challenge_restores') is null then 'no table'
              else (select case when relrowsecurity then 'RLS on' else 'RLS OFF' end
                      from pg_class where oid = 'public.challenge_restores'::regclass)
                   || ' / '
                   || (select count(*) from pg_policies
                        where schemaname = 'public' and tablename = 'challenge_restores'
                          and policyname = 'restores_owner_read')::text || ' policy' end as actual,
         'RLS on / 1 policy' as expected,
         case when to_regclass('public.challenge_restores') is not null
               and (select relrowsecurity from pg_class where oid = 'public.challenge_restores'::regclass)
               and (select count(*) from pg_policies
                     where schemaname = 'public' and tablename = 'challenge_restores'
                       and policyname = 'restores_owner_read') = 1
              then 'OK' else 'FINDING' end as verdict
  union all
  select 2, 'one record per ending: the unique index',
         (select count(*) from pg_indexes
           where schemaname = 'public' and tablename = 'challenge_restores'
             and indexname = 'challenge_restores_one_per_ending'
             and indexdef like 'CREATE UNIQUE INDEX%')::text,
         '1',
         case when (select count(*) from pg_indexes
                     where schemaname = 'public' and tablename = 'challenge_restores'
                       and indexname = 'challenge_restores_one_per_ending'
                       and indexdef like 'CREATE UNIQUE INDEX%') = 1
              then 'OK' else 'FINDING' end
  union all
  select 3, 'challenge_restores: authenticated SELECT only; anon nothing',
         case when has_table_privilege('authenticated', 'public.challenge_restores', 'SELECT')
               and not has_table_privilege('authenticated', 'public.challenge_restores', 'INSERT')
               and not has_table_privilege('authenticated', 'public.challenge_restores', 'UPDATE')
               and not has_table_privilege('authenticated', 'public.challenge_restores', 'DELETE')
               and not has_table_privilege('anon', 'public.challenge_restores', 'SELECT')
               and not has_table_privilege('anon', 'public.challenge_restores', 'INSERT')
               and not has_table_privilege('anon', 'public.challenge_restores', 'UPDATE')
               and not has_table_privilege('anon', 'public.challenge_restores', 'DELETE')
              then 'yes' else 'NO' end,
         'yes',
         case when has_table_privilege('authenticated', 'public.challenge_restores', 'SELECT')
               and not has_table_privilege('authenticated', 'public.challenge_restores', 'INSERT')
               and not has_table_privilege('authenticated', 'public.challenge_restores', 'UPDATE')
               and not has_table_privilege('authenticated', 'public.challenge_restores', 'DELETE')
               and not has_table_privilege('anon', 'public.challenge_restores', 'SELECT')
               and not has_table_privilege('anon', 'public.challenge_restores', 'INSERT')
               and not has_table_privilege('anon', 'public.challenge_restores', 'UPDATE')
               and not has_table_privilege('anon', 'public.challenge_restores', 'DELETE')
              then 'OK' else 'FINDING' end
  union all
  select 4, 'append-only trigger in place; its function unreachable from the app',
         (select count(*) from pg_trigger
           where tgrelid = 'public.challenge_restores'::regclass
             and tgname = 'challenge_restores_append_only' and not tgisinternal)::text
           || ' trigger / '
           || case when has_function_privilege('authenticated', 'public.forbid_restore_mutation()', 'EXECUTE')
                     or has_function_privilege('anon', 'public.forbid_restore_mutation()', 'EXECUTE')
                   then 'a client role holds EXECUTE' else 'no client EXECUTE' end,
         '1 trigger / no client EXECUTE',
         case when (select count(*) from pg_trigger
                     where tgrelid = 'public.challenge_restores'::regclass
                       and tgname = 'challenge_restores_append_only' and not tgisinternal) = 1
               and not has_function_privilege('authenticated', 'public.forbid_restore_mutation()', 'EXECUTE')
               and not has_function_privilege('anon', 'public.forbid_restore_mutation()', 'EXECUTE')
              then 'OK' else 'FINDING' end
  union all
  select 5, 'restore_missed_day refuses by ending, not by challenge',
         case when pg_get_functiondef('public.restore_missed_day()'::regprocedure) like '%cr.ended_at = o.ended_at%'
               and pg_get_functiondef('public.restore_missed_day()'::regprocedure) like '%insert into public.challenge_restores%'
               and pg_get_functiondef('public.restore_missed_day()'::regprocedure) not like '%if o.restored_at is not null%'
              then 'yes' else 'NO' end,
         'yes',
         case when pg_get_functiondef('public.restore_missed_day()'::regprocedure) like '%cr.ended_at = o.ended_at%'
               and pg_get_functiondef('public.restore_missed_day()'::regprocedure) like '%insert into public.challenge_restores%'
               and pg_get_functiondef('public.restore_missed_day()'::regprocedure) not like '%if o.restored_at is not null%'
              then 'OK' else 'FINDING — the 0018 body is still in force' end
  union all
  select 6, 'my_restorable_miss offers by ending, not by challenge',
         case when pg_get_functiondef('public.my_restorable_miss()'::regprocedure) like '%cr.ended_at = o.ended_at%'
               and pg_get_functiondef('public.my_restorable_miss()'::regprocedure) not like '%o.restored_at is null%'
              then 'yes' else 'NO' end,
         'yes',
         case when pg_get_functiondef('public.my_restorable_miss()'::regprocedure) like '%cr.ended_at = o.ended_at%'
               and pg_get_functiondef('public.my_restorable_miss()'::regprocedure) not like '%o.restored_at is null%'
              then 'OK' else 'FINDING — the 0018 body is still in force' end
  union all
  select 7, 'restore_missed_day and my_restorable_miss: authenticated yes, anon no',
         case when has_function_privilege('authenticated', 'public.restore_missed_day()', 'EXECUTE')
               and has_function_privilege('authenticated', 'public.my_restorable_miss()', 'EXECUTE')
               and not has_function_privilege('anon', 'public.restore_missed_day()', 'EXECUTE')
               and not has_function_privilege('anon', 'public.my_restorable_miss()', 'EXECUTE')
              then 'yes' else 'NO' end,
         'yes',
         case when has_function_privilege('authenticated', 'public.restore_missed_day()', 'EXECUTE')
               and has_function_privilege('authenticated', 'public.my_restorable_miss()', 'EXECUTE')
               and not has_function_privilege('anon', 'public.restore_missed_day()', 'EXECUTE')
               and not has_function_privilege('anon', 'public.my_restorable_miss()', 'EXECUTE')
              then 'OK' else 'FINDING' end
  union all
  select 8, '0018 untouched: the reopened day''s clock still gates day_is_open and the evaluator',
         case when pg_get_functiondef('public.day_is_open(public.challenges,integer)'::regprocedure) like '%restored_day_is_open(c)%'
               and pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%restored_day_is_open(c)%'
               and pg_get_function_result('public.get_day_window()'::regprocedure) like '%reopened_until%'
              then 'yes' else 'NO' end,
         'yes',
         case when pg_get_functiondef('public.day_is_open(public.challenges,integer)'::regprocedure) like '%restored_day_is_open(c)%'
               and pg_get_functiondef('public.evaluate_challenge(uuid)'::regprocedure) like '%restored_day_is_open(c)%'
               and pg_get_function_result('public.get_day_window()'::regprocedure) like '%reopened_until%'
              then 'OK' else 'FINDING — 0018 is not fully applied; stop and apply it first' end
  union all
  select 9, 'every restored challenge has a record',
         (select count(*) from public.challenges c
           where c.restored_at is not null
             and not exists (select 1 from public.challenge_restores x
                              where x.challenge_id = c.id))::text
           || ' unrecorded / '
           || (select count(*) from public.challenge_restores where ended_at is null)::text
           || ' backfilled from 0018',
         '0 unrecorded',
         case when (select count(*) from public.challenges c
                     where c.restored_at is not null
                       and not exists (select 1 from public.challenge_restores x
                                        where x.challenge_id = c.id)) = 0
              then 'OK' else 'FINDING' end
  union all
  select 10, 'challenges restorable right now, across all owners (the new rule)',
         (select count(*) from public.challenges o
            join public.challenges r on r.restarted_from = o.id and r.ended_at is null
           where o.ended_reason = 'missed_day' and o.ended_at is not null
             and o.ended_on_day is not null
             and not exists (select 1 from public.challenge_restores cr
                              where cr.challenge_id = o.id and cr.ended_at = o.ended_at)
             and (now() at time zone o.timezone)::date
                 - (o.start_date + (o.ended_on_day - 1)) <= public.restore_window_days())::text,
         'informational — 1 on 2026-09-30 is the owner; before this file it read 0',
         'read it'
  union all
  select 11, 'restore records in total',
         (select count(*) from public.challenge_restores)::text,
         'informational',
         'read it'
) v order by ord;
