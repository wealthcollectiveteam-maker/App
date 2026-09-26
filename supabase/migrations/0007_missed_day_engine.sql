-- =============================================================================
-- 0007 — the missed-day engine.
--
-- WHAT WAS MISSING
--
--   challenges.flame only ever incremented. Nothing anywhere asked whether
--   yesterday was finished. A user who skipped a day kept their streak, and a
--   Hard challenge never restarted — so the consequence every tier card
--   promises ("Miss a task, restart at day one") was copy the server could
--   not deliver. This migration makes it true.
--
-- THE THREE DECISIONS THIS ENCODES
--
--   ARCHIVE, DON'T WIPE   A failed Hard attempt keeps its row, its days, its
--                         completions, its journal, meals, milestones and
--                         workout logs. `ended_at` marks it finished; a
--                         genuinely new challenge starts alongside it.
--   NO GRACE              A miss is a miss. There is no free pass and no undo.
--   MIDNIGHT, AUTOMATIC   Evaluated on a schedule at each challenge's own
--                         local midnight, not lazily when the user next opens
--                         the app. A squadmate who stops opening the app stops
--                         appearing to keep their streak.
--
-- WHAT COUNTS AS A MISS
--
--   A day is MET when every task in that day's frozen snapshot has a
--   completion row — WHETHER OR NOT seal_day() was ever called. Sealing is an
--   explicit user action today (the celebration screen calls it on mount, and
--   the only routes there are two "lock in the day" buttons), so ticking your
--   last box and closing the app leaves a finished day unsealed. The evaluator
--   seals those retroactively and awards the flame the user earned. Getting
--   this wrong is the single most likely way this engine hurts someone who did
--   the work.
--
--   A day is MISSED when it has ended in the challenge's timezone and any
--   snapshot task has no completion. A day the user never opened the app on
--   has no snapshot row at all; the evaluator freezes it retroactively from
--   the config in force on that day, so history stays complete and the Wall
--   and the Day 75 figures have real rows to count.
--
--   Day 1 is never evaluated as missed. Day 1 is the creation day of every
--   challenge this schema can produce — a fresh signup, and the replacement a
--   Hard restart creates — and someone who signs up at 23:50 must not lose
--   the challenge ten minutes later.
--
--   Nothing past day 75 is evaluated either. Without that clamp, a user who
--   finished the challenge and stopped opening the app would have day 76
--   scored as a miss and their COMPLETED Hard run replaced.
--
-- NOBODY IS PENALISED FOR THE PAST
--
--   The backfill in section 9 sets every existing challenge's cursor to
--   "everything before today is already evaluated". A user who is on day 40
--   with three ragged days behind them keeps their streak. The engine's
--   jurisdiction starts at the first local midnight after this migration is
--   applied, and never reaches backwards.
--
-- APPLY ORDER: after 0006. See the report for the exact statements to run.
-- =============================================================================

begin;

-- =============================================================================
-- 1. SCHEMA
-- =============================================================================

alter table public.challenges
  -- Set when a challenge stops being the live one. NULL = active. This is
  -- the column the partial unique index in section 2 keys off, and the one
  -- every owner-scoped RPC now filters on.
  add column if not exists ended_at     timestamptz,
  add column if not exists ended_reason text
    check (ended_reason is null or ended_reason in
      ('missed_day', 'completed', 'restarted')),
  -- The day the attempt reached. Read straight off the row rather than
  -- recomputed from start_date, because start_date stops meaning anything
  -- once the clock has stopped.
  add column if not exists ended_on_day integer,
  -- The archived attempt this challenge replaced. Lets the app offer "your
  -- previous attempt" without a second query shape.
  add column if not exists restarted_from uuid
    references public.challenges (id) on delete set null,
  -- The evaluator's cursor: the highest day already judged. Checked and
  -- advanced inside the same transaction as the penalty, which is what makes
  -- a scheduler that fires twice boring instead of destructive.
  add column if not exists last_evaluated_day integer not null default 0,
  -- The day number on which "you missed a day" is current news for THIS
  -- challenge. Medium/Soft: the day after the miss. Hard: day 1 of the
  -- replacement. The banner shows while it equals today and clears itself at
  -- the next rollover — no second piece of client state to get out of step.
  add column if not exists missed_notice_day integer;

alter table public.challenge_days
  -- When the evaluator judged this day, and what it decided. sealed_at is
  -- not enough on its own: an unsealed day is either "not finished" or
  -- "finished but never tapped", and only the evaluator can tell them apart.
  add column if not exists evaluated_at timestamptz,
  add column if not exists outcome text
    check (outcome is null or outcome in ('met', 'missed'));

create index if not exists challenges_active_idx
  on public.challenges (ended_at) where ended_at is null;

-- ---------- the tier's missed-day rules, server-side ----------
-- Mirrors TIERS[tier].missedDay in src/constants/tiers.ts. The evaluator
-- READS these; it does not carry a branch per tier. Adding a fourth tier is
-- a row here and a row there, not an edit to the engine.
create table if not exists public.tier_rules (
  tier               text primary key
                     check (tier in ('hard', 'medium', 'soft')),
  restarts_challenge boolean not null,
  resets_streak      boolean not null
);

insert into public.tier_rules (tier, restarts_challenge, resets_streak) values
  ('hard',   true,  true),
  ('medium', false, true),
  ('soft',   false, true)
on conflict (tier) do update set
  restarts_challenge = excluded.restarts_challenge,
  resets_streak      = excluded.resets_streak;

alter table public.tier_rules enable row level security;
drop policy if exists tier_rules_read on public.tier_rules;
create policy tier_rules_read on public.tier_rules
  for select to authenticated using (true);

-- ---------- who may run the dev simulations ----------
-- The simulation RPCs in section 7 are __DEV__-gated on the client and
-- absent from a production bundle — but the RPCs themselves are not. A
-- __DEV__ constant is a property of the JavaScript bundle; anyone holding
-- the anon key can call a Postgres function directly. Without this table,
-- shipping the simulations would let any user fabricate a sealed 75-day run
-- on their own account.
--
-- Default-deny, and the table starts EMPTY: with no row here every
-- simulation RPC raises, in production and in development alike. Enabling a
-- throwaway account is one INSERT (see the report). Owner-scoped SELECT so a
-- user can see whether their own account is enabled and nobody can enumerate
-- the rest.
create table if not exists public.sim_allowed_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text not null default '',
  created_at timestamptz not null default now()
);

alter table public.sim_allowed_users enable row level security;
drop policy if exists sim_allowed_self on public.sim_allowed_users;
create policy sim_allowed_self on public.sim_allowed_users
  for select to authenticated using (user_id = auth.uid());

-- =============================================================================
-- 2. "ONE CHALLENGE PER OWNER" BECOMES "ONE *ACTIVE* CHALLENGE PER OWNER"
--
-- 0001 declared `owner uuid not null unique`, a COLUMN-level UNIQUE, so
-- Postgres auto-named it challenges_owner_key: a pg_constraint entry of type
-- 'u' over exactly (owner), backed by an index of the same name. Because it
-- is a constraint and not a bare index, `drop index` will not remove it.
--
-- The name is discovered rather than assumed. A database that was ever built
-- by hand, or restored, may carry a different one; dropping the wrong object
-- (or none) would leave the old constraint in place and every archive-and-
-- restart would fail on a duplicate key at the moment the user could least
-- afford it.
-- =============================================================================

do $$
declare
  v_name text;
begin
  select con.conname into v_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'challenges'
    and con.contype = 'u'
    and con.conkey = array[
      (select attnum from pg_attribute
        where attrelid = 'public.challenges'::regclass and attname = 'owner')
    ]::smallint[];

  if v_name is not null then
    execute format('alter table public.challenges drop constraint %I', v_name);
    raise notice '0007: dropped unique constraint % on challenges(owner)', v_name;
  else
    raise notice '0007: no whole-column unique constraint on challenges(owner) — already converted';
  end if;
end $$;

-- The replacement. An owner may hold any number of ENDED challenges and at
-- most one live one.
create unique index if not exists challenges_one_active_owner
  on public.challenges (owner) where ended_at is null;

-- =============================================================================
-- 3. HELPERS
-- =============================================================================

-- The length of the challenge, in days. Mirrors CHALLENGE.days in
-- src/constants/challenge.ts. One place, so the evaluator's upper bound and
-- the finish screen cannot drift apart.
create or replace function public.challenge_length()
returns integer
language sql immutable
as $$ select 75 $$;

-- THE row every owner-scoped RPC now resolves through.
--
-- Before this migration each of them ran `select * into c from
-- public.challenges where owner = auth.uid()` — correct only while the owner
-- column was unique. With archived attempts on the table that is a
-- non-deterministic pick between a live challenge and a dead one, and the
-- app would have gone on completing tasks against a challenge that ended
-- weeks ago. Every call site is rewritten in section 5.
create or replace function public.my_active_challenge()
returns public.challenges
language sql stable security definer set search_path = public
as $$
  select c.* from public.challenges c
  where c.owner = auth.uid() and c.ended_at is null
  order by c.start_date desc, c.created_at desc
  limit 1;
$$;

-- The same lookup for an arbitrary owner, for the squad roster. NOT granted
-- to any client role: it is reachable only from inside the SECURITY DEFINER
-- functions that need it, so it cannot become a way to read a squadmate's
-- challenge row.
create or replace function public.active_challenge_of(p_owner uuid)
returns public.challenges
language sql stable security definer set search_path = public
as $$
  select c.* from public.challenges c
  where c.owner = p_owner and c.ended_at is null
  order by c.start_date desc, c.created_at desc
  limit 1;
$$;

-- Whether a day's frozen snapshot is fully satisfied.
--
-- Counts only completions whose key is actually IN the snapshot. A bare
-- count(*) — which is what seal_day() used — would let a completion for a
-- task that day no longer carries stand in for one it does. complete_task()
-- validates against the snapshot, so this changes no real outcome today; it
-- means the definition of "finished" cannot rot later.
create or replace function public.day_is_met(p_challenge uuid, p_day integer)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_snapshot jsonb;
  v_needed   integer;
  v_done     integer;
begin
  select task_snapshot into v_snapshot from public.challenge_days
    where challenge_id = p_challenge and day = p_day;
  if v_snapshot is null then
    return false;             -- a day never opened is a day never finished
  end if;
  v_needed := jsonb_array_length(v_snapshot);
  if v_needed = 0 then
    return true;              -- nothing to do is not a failure
  end if;
  select count(*) into v_done
  from public.task_completions tc
  where tc.challenge_id = p_challenge
    and tc.day = p_day
    and exists (
      select 1 from jsonb_array_elements(v_snapshot) t
      where t->>'key' = tc.task_key
    );
  return v_done >= v_needed;
end;
$$;

-- =============================================================================
-- 4. SNAPSHOT IMMUTABILITY — the cascade hole
--
-- forbid_snapshot_mutation() raised on EVERY delete, including the ones a
-- cascade performs. `delete from challenges` cascades to challenge_days, the
-- child's BEFORE DELETE row trigger fired, and the whole statement aborted
-- with "day snapshots are immutable".
--
-- That is not hypothetical: delete_account() (0006) does exactly that
-- delete, so in-app account deletion — the Apple 5.1.1(v) requirement — has
-- been raising for any user who has ever had a day frozen, which is every
-- user past their first screen. It also blocks the Fresh start simulation,
-- which is what turned it up.
--
-- The fix keeps the guarantee intact. By the time a cascaded child delete
-- fires its row trigger the parent challenge row is already gone inside this
-- transaction, so "does the parent still exist" separates a cascade from a
-- direct attempt precisely. A client cannot reach either path anyway —
-- `authenticated` holds no DELETE grant on challenge_days — this is the
-- innermost of three walls, and it should stop cheating, not housekeeping.
-- =============================================================================

create or replace function public.forbid_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.challenges where id = old.challenge_id
    ) then
      return old;  -- the challenge itself is being deleted; let it cascade
    end if;
    raise exception 'day snapshots are immutable';
  end if;
  if new.task_snapshot is distinct from old.task_snapshot
     or new.day is distinct from old.day
     or new.challenge_id is distinct from old.challenge_id then
    raise exception 'day snapshots are immutable';
  end if;
  -- sealed_at, evaluated_at and outcome are the only permitted changes.
  return new;
end;
$$;

-- =============================================================================
-- 5. EVERY OWNER-SCOPED RPC, RESCOPED TO THE ACTIVE CHALLENGE
--
-- Bodies are otherwise unchanged. The one line that changes in each is how
-- the challenge is found.
-- =============================================================================

create or replace function public.get_or_freeze_today()
returns public.challenge_days
language plpgsql volatile security definer set search_path = public
as $$
declare
  c public.challenges;
  d integer;
  row public.challenge_days;
begin
  c := public.my_active_challenge();
  if c.id is null then
    raise exception 'no challenge for user';
  end if;
  d := public.challenge_day(c);
  if d < 1 then
    raise exception 'challenge has not started yet';
  end if;
  select * into row from public.challenge_days
    where challenge_id = c.id and day = d;
  if row.id is null then
    insert into public.challenge_days (challenge_id, day, task_snapshot)
    values (c.id, d, public.compose_task_set(c.id, d))
    returning * into row;
  end if;
  return row;
end;
$$;

create or replace function public.complete_task(p_task_key text, p_duration_seconds integer default null)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  today public.challenge_days;
  c public.challenges;
begin
  today := public.get_or_freeze_today();
  c := public.my_active_challenge();
  if not exists (
    select 1 from jsonb_array_elements(today.task_snapshot) t
    where t->>'key' = p_task_key
  ) then
    raise exception 'task % is not part of today''s snapshot', p_task_key;
  end if;
  insert into public.task_completions (challenge_id, day, task_key, duration_seconds)
  values (c.id, today.day, p_task_key, p_duration_seconds)
  on conflict (challenge_id, day, task_key) do nothing;
end;
$$;

create or replace function public.uncomplete_task(p_task_key text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  today public.challenge_days;
  c public.challenges;
begin
  today := public.get_or_freeze_today();
  c := public.my_active_challenge();
  delete from public.task_completions
  where challenge_id = c.id and day = today.day and task_key = p_task_key;
end;
$$;

-- Sealing now delegates "is this day finished?" to day_is_met(), the same
-- predicate the evaluator uses. Two definitions of a finished day is exactly
-- how a user ends up sealed here and penalised there.
create or replace function public.seal_day()
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  today public.challenge_days;
  c public.challenges;
begin
  today := public.get_or_freeze_today();
  c := public.my_active_challenge();
  if today.sealed_at is not null then
    return;
  end if;
  if not public.day_is_met(c.id, today.day) then
    raise exception 'day is not complete: % of % tasks done',
      (select count(*) from public.task_completions
        where challenge_id = c.id and day = today.day),
      jsonb_array_length(today.task_snapshot);
  end if;
  update public.challenge_days set sealed_at = now() where id = today.id;
  update public.challenges
    set flame = flame + 1, best_flame = greatest(best_flame, flame + 1)
    where id = c.id;
end;
$$;

create or replace function public.set_target_override(p_task_key text, p_value integer)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  c public.challenges;
  d integer;
  std integer;
begin
  c := public.my_active_challenge();
  if c.id is null then raise exception 'no challenge'; end if;
  d := public.challenge_day(c);
  select standard_value into std from public.tier_standards
    where tier = public.effective_tier(c.id, d + 1) and task_key = p_task_key;
  if std is null then
    raise exception 'task % has no editable target', p_task_key;
  end if;
  if p_value = std then
    delete from public.target_overrides
      where challenge_id = c.id and task_key = p_task_key;
  else
    insert into public.target_overrides (challenge_id, task_key, value, effective_from_day)
    values (c.id, p_task_key, p_value, d + 1)
    on conflict (challenge_id, task_key)
    do update set value = excluded.value, effective_from_day = excluded.effective_from_day;
  end if;
end;
$$;

create or replace function public.add_custom_task(
  p_name text, p_sub text default '', p_proof boolean default false,
  p_timer_minutes integer default null)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  c public.challenges;
  d integer;
  active_count integer;
  new_id uuid;
begin
  c := public.my_active_challenge();
  if c.id is null then raise exception 'no challenge'; end if;
  d := public.challenge_day(c);
  select count(*) into active_count from public.custom_tasks
    where challenge_id = c.id
      and active_from_day <= d + 1
      and (removed_from_day is null or removed_from_day > d + 1);
  if active_count >= 4 then
    raise exception 'custom task limit reached (4)';
  end if;
  insert into public.custom_tasks (challenge_id, name, sub, proof, timer_minutes, active_from_day)
  values (c.id, p_name, p_sub, p_proof, p_timer_minutes, d + 1)
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.remove_custom_task(p_id uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  c public.challenges;
  d integer;
  t public.custom_tasks;
begin
  c := public.my_active_challenge();
  if c.id is null then raise exception 'no challenge'; end if;
  select * into t from public.custom_tasks where id = p_id and challenge_id = c.id;
  if t.id is null then raise exception 'not your task'; end if;
  d := public.challenge_day(c);
  if t.active_from_day > d then
    -- pending add, never active: no history to preserve
    delete from public.custom_tasks where id = p_id;
  else
    update public.custom_tasks set removed_from_day = d + 1 where id = p_id;
  end if;
end;
$$;

create or replace function public.change_tier(p_tier text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  c public.challenges;
  d integer;
begin
  c := public.my_active_challenge();
  if c.id is null then raise exception 'no challenge'; end if;
  d := public.challenge_day(c);
  insert into public.tier_history (challenge_id, tier, from_day)
  values (c.id, p_tier, d + 1)
  on conflict (challenge_id, from_day) do update set tier = excluded.tier;
end;
$$;

create or replace function public.update_custom_task(
  p_id            uuid,
  p_name          text,
  p_sub           text,
  p_proof         boolean,
  p_timer_minutes integer default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  c public.challenges;
begin
  c := public.my_active_challenge();
  if c.id is null then raise exception 'no challenge'; end if;
  update public.custom_tasks ct
     set name = p_name, sub = p_sub, proof = p_proof, timer_minutes = p_timer_minutes
   where ct.id = p_id and ct.challenge_id = c.id;
  if not found then
    raise exception 'custom task not found for this user';
  end if;
end $$;

create or replace function public.undo_pending_changes()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  c     public.challenges;
  v_day integer;
begin
  c := public.my_active_challenge();
  if c.id is null then
    raise exception 'no challenge for this user';
  end if;
  v_day := public.challenge_day(c);

  delete from public.custom_tasks
   where challenge_id = c.id and active_from_day = v_day + 1;

  update public.custom_tasks
     set removed_from_day = null
   where challenge_id = c.id and removed_from_day = v_day + 1;

  delete from public.target_overrides
   where challenge_id = c.id and effective_from_day = v_day + 1;

  -- tier_history keys the effective day as `from_day`.
  delete from public.tier_history
   where challenge_id = c.id and from_day = v_day + 1;
end $$;

-- The squad roster. Five separate correlated subqueries each picked a
-- challenge by owner; all five now resolve the ACTIVE one, so a squadmate
-- who restarted yesterday shows their new day 1 rather than an arbitrary
-- choice between two rows.
create or replace function public.get_squad_status()
returns table (
  user_id uuid, name text, xp integer, done_today integer,
  tasks_today integer, tier_label text, flame integer
)
language plpgsql stable security definer set search_path = public
as $$
declare
  my_squad uuid;
begin
  select squad_id into my_squad from public.squad_members
    where squad_members.user_id = auth.uid();
  if my_squad is null then return; end if;
  return query
  with roster as (
    select m.user_id as uid, p.name as pname, p.xp as pxp,
           public.active_challenge_of(m.user_id) as ch
    from public.squad_members m
    join public.profiles p on p.id = m.user_id
    where m.squad_id = my_squad
  )
  select r.uid,
         r.pname,
         r.pxp,
         coalesce((
           select count(*)::integer from public.task_completions tc
           where tc.challenge_id = (r.ch).id
             and tc.day = public.challenge_day(r.ch)
         ), 0),
         coalesce((
           select jsonb_array_length(cd.task_snapshot)
           from public.challenge_days cd
           where cd.challenge_id = (r.ch).id
             and cd.day = public.challenge_day(r.ch)
         ), 0),
         coalesce(
           case when exists (
             select 1 from public.challenge_days cd2
             where cd2.challenge_id = (r.ch).id
               and cd2.day = public.challenge_day(r.ch)
               and exists (
                 select 1 from jsonb_array_elements(cd2.task_snapshot) t
                 where (t->'target'->>'value')::integer
                     < (t->'tierStandard'->>'value')::integer
               )
           ) then 'Custom'
           else initcap(public.effective_tier((r.ch).id, public.challenge_day(r.ch)))
           end, 'Hard'),
         coalesce((r.ch).flame, 0)
  from roster r;
end;
$$;

-- create_challenge now validates the timezone and starts the evaluator's
-- cursor at day 1 (the creation day, never judged).
--
-- The validation is not defensive padding. challenge_day() runs
-- `now() at time zone c.timezone`, so a value Postgres does not recognise
-- makes every subsequent read for that user raise — and under an hourly job
-- that walks every challenge, one bad row would take down the run for
-- everybody. Reject it at the only point it can enter.
create or replace function public.create_challenge(
  p_base_tier text, p_start_date date, p_timezone text default 'UTC')
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  new_id uuid;
  v_tz   text := coalesce(nullif(trim(p_timezone), ''), 'UTC');
begin
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'unknown timezone: %', v_tz;
  end if;
  insert into public.challenges
    (owner, base_tier, start_date, timezone, last_evaluated_day)
  values (auth.uid(), p_base_tier, p_start_date, v_tz, 1)
  returning id into new_id;
  insert into public.tier_history (challenge_id, tier, from_day)
  values (new_id, p_base_tier, 1);
  return new_id;
end;
$$;

-- =============================================================================
-- 6. THE ENGINE
-- =============================================================================

-- Archive one challenge and start a fresh one for the same owner.
--
-- The archived row keeps everything it owns. Days, completions, journal,
-- meals, milestones and workout logs are not touched, not moved and not
-- hidden — challenges_select is still `owner = auth.uid()`, so an ended
-- attempt stays readable by its owner and by nobody else.
--
-- The new challenge inherits what the person chose, not what they scored:
-- the tier they were actually running on the day they missed, their active
-- custom tasks, and their target overrides — all re-based to day 1. Squad
-- membership is untouched: squad_members keys on user_id and holds no
-- reference to a challenge, so the person does not leave. Their attempt
-- ended; they did not.
create or replace function public.restart_challenge(
  p_challenge uuid, p_ended_on_day integer, p_reason text)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  old_c  public.challenges;
  new_id uuid;
  v_tier text;
  v_today date;
begin
  select * into old_c from public.challenges where id = p_challenge;
  if old_c.id is null then raise exception 'no such challenge'; end if;

  v_tier  := public.effective_tier(old_c.id, p_ended_on_day);
  v_today := (now() at time zone old_c.timezone)::date;

  update public.challenges
     set ended_at     = now(),
         ended_reason = p_reason,
         ended_on_day = p_ended_on_day
   where id = old_c.id;

  insert into public.challenges
    (owner, base_tier, start_date, timezone, flame, best_flame,
     last_evaluated_day, missed_notice_day, restarted_from)
  values
    (old_c.owner, v_tier, v_today, old_c.timezone, 0,
     -- best_flame is the longest streak this person has ever run. A restart
     -- ends an attempt; it does not un-happen the 40 days they did.
     old_c.best_flame,
     1,
     case when p_reason = 'missed_day' then 1 else null end,
     old_c.id)
  returning id into new_id;

  insert into public.tier_history (challenge_id, tier, from_day)
  values (new_id, v_tier, 1);

  -- Custom tasks that were live on the day it ended, re-based to day 1.
  insert into public.custom_tasks
    (challenge_id, name, sub, proof, timer_minutes, active_from_day)
  select new_id, ct.name, ct.sub, ct.proof, ct.timer_minutes, 1
  from public.custom_tasks ct
  where ct.challenge_id = old_c.id
    and ct.active_from_day <= p_ended_on_day
    and (ct.removed_from_day is null or ct.removed_from_day > p_ended_on_day);

  insert into public.target_overrides
    (challenge_id, task_key, value, effective_from_day)
  select new_id, o.task_key, o.value, 1
  from public.target_overrides o
  where o.challenge_id = old_c.id
    and o.effective_from_day <= p_ended_on_day;

  -- Freeze day 1 now rather than waiting for the user's next launch, so the
  -- squad roster and the first screen they see are a real day 1.
  insert into public.challenge_days (challenge_id, day, task_snapshot)
  values (new_id, 1, public.compose_task_set(new_id, 1))
  on conflict (challenge_id, day) do nothing;

  return new_id;
end;
$$;

-- Evaluate every unjudged, ENDED day of one challenge, in order.
--
-- IDEMPOTENCY. The row lock plus the cursor is the whole mechanism. Two
-- overlapping runs serialise on `for update`; the second reads the cursor
-- the first committed and finds nothing to do. Because the cursor advances
-- in the same transaction as the penalty, "penalised but not marked" is not
-- a state this can be left in.
--
-- CATCH-UP. The loop runs from the cursor to yesterday, so a job that did
-- not fire for six hours, or a user who was offline for three days, is
-- caught up in order on the next run. Three missed days on Hard is ONE
-- restart, not three: the restart ends this challenge and the loop returns,
-- because the days after it belong to an attempt that no longer exists.
create or replace function public.evaluate_challenge(p_challenge uuid)
returns integer
language plpgsql volatile security definer set search_path = public
as $$
declare
  c          public.challenges;
  v_today    integer;
  v_last     integer;
  v_day      integer;
  v_snapshot public.challenge_days;
  v_tier     text;
  v_rules    public.tier_rules;
  v_squad    uuid;
  v_text     text;
  v_judged   integer := 0;
begin
  select * into c from public.challenges
    where id = p_challenge and ended_at is null
    for update;
  if c.id is null then
    return 0;                       -- already archived, or never existed
  end if;

  v_today := public.challenge_day(c);

  -- Day 1 is the creation day and is never judged; nothing past the final
  -- day is judged either, or a finished run would be scored as abandoned.
  v_last := least(v_today - 1, public.challenge_length());
  v_day  := greatest(c.last_evaluated_day + 1, 2);

  while v_day <= v_last loop
    select * into v_snapshot from public.challenge_days
      where challenge_id = c.id and day = v_day;

    -- A day the user never opened has no snapshot. Freeze it now from the
    -- config that was in force then, so the miss is recorded against a real
    -- task set and the Wall has no holes in it.
    if v_snapshot.id is null then
      insert into public.challenge_days (challenge_id, day, task_snapshot)
      values (c.id, v_day, public.compose_task_set(c.id, v_day))
      returning * into v_snapshot;
    end if;

    if public.day_is_met(c.id, v_day) then
      -- MET, sealed or not. A day whose every box was ticked counts even if
      -- the user never tapped "lock in the day" — seal it retroactively and
      -- award the flame they earned and did not get.
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
      -- MISSED. The penalty comes from the tier that was in force on the day
      -- that was missed, read from tier_rules — not from a branch per tier.
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

      if v_rules.restarts_challenge then
        v_text := format(
          'missed Day %s. %s rules — the challenge restarts at Day 1.',
          v_day, initcap(v_tier));
      elsif v_rules.resets_streak then
        v_text := format('missed Day %s. Streak reset to zero.', v_day);
      else
        v_text := format('missed Day %s.', v_day);
      end if;

      -- Completion status is already social; a broken streak is the same
      -- class of fact. Solo users have no squad and get no feed row.
      if v_squad is not null then
        insert into public.feed_items (squad_id, author, kind, text)
        values (v_squad, c.owner, 'miss', v_text);
      end if;

      -- The cursor advances in the SAME transaction as the penalty, so a
      -- second run — an overlap, a retry, a late catch-up — reads a day
      -- already judged and does nothing.
      update public.challenges set last_evaluated_day = v_day where id = c.id;
      v_judged := v_judged + 1;

      if v_rules.restarts_challenge then
        perform public.restart_challenge(c.id, v_day, 'missed_day');
        return v_judged;   -- this challenge is archived; later days are moot
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

  return v_judged;
end;
$$;

-- The scheduled entry point. Hourly, because every challenge sits in its own
-- timezone and a single daily run cannot catch every local midnight.
--
-- A PROCEDURE rather than a function so each challenge commits on its own.
-- One challenge with an unusable row must not roll back the penalties and
-- the retroactive seals of every other challenge in the same pass — and must
-- not stop the run either, so each is wrapped in its own handler and the
-- failure is raised as a warning the Postgres log keeps.
create or replace procedure public.evaluate_all_challenges()
language plpgsql security definer set search_path = public
as $$
declare
  r        record;
  v_judged integer;
  v_total  integer := 0;
  v_failed integer := 0;
begin
  for r in
    select id from public.challenges where ended_at is null order by id
  loop
    begin
      v_judged := public.evaluate_challenge(r.id);
      v_total := v_total + v_judged;
    exception when others then
      v_failed := v_failed + 1;
      raise warning 'evaluate_challenge(%) failed: %', r.id, sqlerrm;
    end;
    commit;
  end loop;

  raise notice 'evaluate_all_challenges: % day(s) judged, % challenge(s) failed',
    v_total, v_failed;
end;
$$;

-- =============================================================================
-- 7. THE DEV SIMULATIONS
--
-- Every scenario in the dev sheet was written against MockDataService and
-- none survived the switch to the real backend: Day 1, Day 12, Day 75 and
-- missed day all did nothing. That is not only inconvenient. The Day 75
-- finish screen is unreachable for eleven weeks, so a bug in it would first
-- surface in October, in front of a real user finishing a real challenge.
--
-- BE CLEAR ABOUT WHAT THESE ARE. They write real rows to the real database.
-- A simulated completion is a row in task_completions and is
-- indistinguishable from one earned by doing the work. Point them at a
-- throwaway account.
--
-- THE GUARD, on every one of them, is the same three things:
--   * sim_allowed_users — default-deny, and the table ships empty
--   * owner-scoped in SQL — none of them takes a user id; they resolve
--     auth.uid()'s own active challenge and can reach nothing else
--   * __DEV__-gated on the client, in a module only a dev build requires
-- =============================================================================

-- The guard, and the caller's own challenge. Every simulation starts here.
create or replace function public.require_simulation()
returns public.challenges
language plpgsql volatile security definer set search_path = public
as $$
declare
  c public.challenges;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.sim_allowed_users where user_id = auth.uid()
  ) then
    raise exception 'simulation is not enabled for this account';
  end if;
  c := public.my_active_challenge();
  if c.id is null then
    raise exception 'no challenge for user';
  end if;
  return c;
end;
$$;

-- Mark one day of a challenge complete: every task in its snapshot ticked,
-- the day sealed, the day judged 'met'. Completions are stamped at local
-- noon on the day in question so the Wall, the history reads and the Day 75
-- totals all see a plausible day rather than 75 days logged in one second.
create or replace function public.sim_fill_day(p_challenge uuid, p_day integer)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  c    public.challenges;
  d    public.challenge_days;
  v_at timestamptz;
begin
  select * into c from public.challenges where id = p_challenge;

  select * into d from public.challenge_days
    where challenge_id = p_challenge and day = p_day;
  if d.id is null then
    insert into public.challenge_days (challenge_id, day, task_snapshot)
    values (p_challenge, p_day, public.compose_task_set(p_challenge, p_day))
    returning * into d;
  end if;

  v_at := ((c.start_date + (p_day - 1)) + time '12:00') at time zone c.timezone;

  insert into public.task_completions (challenge_id, day, task_key, completed_at)
  select p_challenge, p_day, t->>'key', v_at
  from jsonb_array_elements(d.task_snapshot) t
  on conflict (challenge_id, day, task_key) do nothing;

  update public.challenge_days
     set sealed_at    = coalesce(sealed_at, v_at),
         evaluated_at = now(),
         outcome      = 'met'
   where id = d.id;
end;
$$;

-- End the caller's challenge and DELETE the simulated history, so the
-- account looks exactly like a new signup.
--
-- This one deletes rather than archives, deliberately: it is the undo for
-- every other simulation, and an undo that leaves 74 days of invented
-- journal entries and meals attached to the account has not undone anything.
-- journal_entries, meals, milestones and metric_checkins key on `owner` with
-- no challenge_id, so they do not go away with the challenge and have to be
-- cleared by name.
create or replace function public.sim_fresh_start()
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  c      public.challenges;
  v_uid  uuid;
  v_tier text;
  v_tz   text;
  new_id uuid;
begin
  c := public.require_simulation();
  v_uid  := c.owner;
  v_tier := public.effective_tier(c.id, public.challenge_day(c));
  v_tz   := c.timezone;

  -- Cascades to challenge_days, task_completions, tier_history,
  -- custom_tasks, target_overrides and workout_logs.
  delete from public.challenges where owner = v_uid;

  delete from public.journal_entries where owner = v_uid;
  delete from public.meals           where owner = v_uid;
  delete from public.milestones      where owner = v_uid;
  delete from public.metric_checkins where owner = v_uid;
  delete from public.feed_items      where author = v_uid;

  update public.profiles set xp = 0 where id = v_uid;
  update public.profile_private
     set completion_feeling = null, completion_text = null
   where id = v_uid;

  insert into public.challenges
    (owner, base_tier, start_date, timezone, flame, best_flame,
     last_evaluated_day)
  values
    (v_uid, v_tier, (now() at time zone v_tz)::date, v_tz, 0, 0, 1)
  returning id into new_id;

  insert into public.tier_history (challenge_id, tier, from_day)
  values (new_id, v_tier, 1);

  insert into public.challenge_days (challenge_id, day, task_snapshot)
  values (new_id, 1, public.compose_task_set(new_id, 1));

  return new_id;
end;
$$;

-- Move the challenge's start date back so today genuinely IS day N, and
-- backfill days 1..N-1 as sealed with every snapshot task completed.
--
-- A day counter reading 12 over an empty Wall and a zero streak is not a
-- simulation of day 12; it is a lie that hides exactly the bugs this is for.
-- So the flame, the perfect-day count, the history reads and the Day 75
-- arithmetic all see real rows.
--
-- Jumping BACKWARDS is done by starting over. challenge_days is
-- delete-protected on purpose — that trigger is the cheat test — so rather
-- than punching a hole in it, a jump to a day at or before today's runs a
-- fresh start first and builds forward from a clean day 1.
create or replace function public.sim_jump_to_day(
  p_day integer, p_complete_today boolean default false)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  c       public.challenges;
  v_today date;
  i       integer;
begin
  c := public.require_simulation();

  if p_day < 1 or p_day > public.challenge_length() then
    raise exception 'day must be between 1 and %', public.challenge_length();
  end if;

  if p_day <= public.challenge_day(c) then
    perform public.sim_fresh_start();
    c := public.my_active_challenge();
  end if;

  v_today := (now() at time zone c.timezone)::date;

  update public.challenges
     set start_date         = v_today - (p_day - 1),
         flame              = p_day - 1,
         best_flame         = greatest(best_flame, p_day - 1),
         last_evaluated_day = greatest(p_day - 1, 1),
         missed_notice_day  = null
   where id = c.id;

  for i in 1 .. p_day - 1 loop
    perform public.sim_fill_day(c.id, i);
  end loop;

  -- Today's own snapshot, frozen against the new start date.
  insert into public.challenge_days (challenge_id, day, task_snapshot)
  values (c.id, p_day, public.compose_task_set(c.id, p_day))
  on conflict (challenge_id, day) do nothing;

  if p_complete_today then
    perform public.sim_fill_day(c.id, p_day);
    update public.challenges
       set flame = p_day, best_flame = greatest(best_flame, p_day)
     where id = c.id;
  end if;
end;
$$;

-- Day 75, complete: the finish screen genuinely reachable, with
-- loadFinalResults() counting real snapshots and real completions.
create or replace function public.sim_day75_complete()
returns void
language plpgsql volatile security definer set search_path = public
as $$
begin
  perform public.require_simulation();
  perform public.sim_jump_to_day(public.challenge_length(), true);
end;
$$;

-- Run the scheduled job's evaluation, for this challenge, now.
--
-- It calls evaluate_challenge() — the same function pg_cron calls — rather
-- than reimplementing the penalty, so what you see on the device is what the
-- job will do at midnight. What it adds is the PRECONDITION: on its own the
-- evaluator would find nothing, because yesterday is normally either
-- complete or already judged. So it makes yesterday a genuine, unjudged miss
-- first — completions removed, seal lifted, cursor wound back one day, and
-- the flame that the seal awarded taken back with it — and then evaluates.
create or replace function public.sim_missed_day()
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  c            public.challenges;
  v_today      integer;
  v_yesterday  integer;
  v_was_sealed boolean;
begin
  c := public.require_simulation();
  v_today := public.challenge_day(c);

  -- Day 1 is never judged, so a challenge needs a day 2 to miss. Build the
  -- shortest history that can hold one.
  if v_today < 3 then
    perform public.sim_jump_to_day(3, false);
    c := public.my_active_challenge();
    v_today := public.challenge_day(c);
  end if;

  v_yesterday := v_today - 1;

  select sealed_at is not null into v_was_sealed
    from public.challenge_days
   where challenge_id = c.id and day = v_yesterday;

  delete from public.task_completions
   where challenge_id = c.id and day = v_yesterday;

  update public.challenge_days
     set sealed_at = null, evaluated_at = null, outcome = null
   where challenge_id = c.id and day = v_yesterday;

  update public.challenges
     set last_evaluated_day = greatest(v_yesterday - 1, 1),
         flame = case when coalesce(v_was_sealed, false)
                      then greatest(flame - 1, 0) else flame end
   where id = c.id;

  perform public.evaluate_challenge(c.id);
end;
$$;

-- =============================================================================
-- 8. THE FEED CARRIES A MISS
--
-- Squadmates already see when someone completes a day. A broken streak is
-- the same class of fact and belongs in the same place.
--
-- Written only by evaluate_challenge(), which is SECURITY DEFINER. The
-- INSERT policy for `authenticated` is deliberately NOT widened to include
-- 'miss', so a client cannot post a fake one about itself or anybody else.
-- =============================================================================

alter table public.feed_items drop constraint if exists feed_items_kind_check;
alter table public.feed_items add constraint feed_items_kind_check
  check (kind in ('complete', 'proof', 'change', 'ping', 'miss'));

-- =============================================================================
-- 9. BACKFILL — the engine's jurisdiction starts now
--
-- Every existing challenge is marked as already evaluated up to yesterday.
-- Nobody is retroactively penalised for a day that passed before the engine
-- existed: a user who is on day 40 with three ragged days behind them keeps
-- their streak and their challenge, and the first day this can judge is the
-- one that ends at their next local midnight.
--
-- Row by row with a handler, because challenge_day() raises on a timezone
-- Postgres does not recognise. Before create_challenge() validated the
-- string nothing stopped one being stored, and a single bad row must not
-- abort the migration.
-- =============================================================================

do $$
declare
  r     public.challenges;
  v_day integer;
  v_ok  integer := 0;
  v_bad integer := 0;
begin
  for r in select * from public.challenges where ended_at is null loop
    begin
      v_day := public.challenge_day(r);
      update public.challenges
         set last_evaluated_day = greatest(v_day - 1, 1)
       where id = r.id;
      v_ok := v_ok + 1;
    exception when others then
      v_bad := v_bad + 1;
      raise warning '0007 backfill: challenge % has an unusable timezone (%): %',
        r.id, r.timezone, sqlerrm;
    end;
  end loop;
  raise notice '0007 backfill: % challenge(s) marked evaluated to yesterday, % skipped',
    v_ok, v_bad;
end $$;

-- =============================================================================
-- 10. PRIVILEGE LOCKDOWN — the 0002 allow-list pattern
--
-- Supabase re-applies its default privileges (ALL on new tables, EXECUTE on
-- new functions, to anon AND authenticated) to everything a migration
-- creates. Start the client roles at zero on each new object, then grant
-- back exactly what is sanctioned. Scoped to what this file created; the
-- existing allow-list from 0001/0002 already covers the columns added to
-- challenges and challenge_days, because a table-level grant applies to
-- columns added later.
-- =============================================================================

revoke all on public.tier_rules        from public, anon, authenticated;
revoke all on public.sim_allowed_users from public, anon, authenticated;

-- Read-only, both of them. tier_rules is reference data. sim_allowed_users
-- is RLS-scoped to the caller's own row, so a user can tell whether their
-- own account is enabled and can enumerate nothing else. Neither is writable
-- by any client role: enabling a simulation account is a deliberate act
-- performed in the SQL editor, not something the app can do to itself.
grant select on public.tier_rules        to authenticated;
grant select on public.sim_allowed_users to authenticated;

-- ---------- functions ----------

revoke all on function
  public.challenge_length(),
  public.my_active_challenge(),
  public.active_challenge_of(uuid),
  public.day_is_met(uuid, integer),
  public.get_or_freeze_today(),
  public.complete_task(text, integer),
  public.uncomplete_task(text),
  public.seal_day(),
  public.set_target_override(text, integer),
  public.add_custom_task(text, text, boolean, integer),
  public.remove_custom_task(uuid),
  public.change_tier(text),
  public.update_custom_task(uuid, text, text, boolean, integer),
  public.undo_pending_changes(),
  public.get_squad_status(),
  public.create_challenge(text, date, text),
  public.restart_challenge(uuid, integer, text),
  public.evaluate_challenge(uuid),
  public.require_simulation(),
  public.sim_fill_day(uuid, integer),
  public.sim_fresh_start(),
  public.sim_jump_to_day(integer, boolean),
  public.sim_day75_complete(),
  public.sim_missed_day()
from public, anon, authenticated;

revoke all on procedure public.evaluate_all_challenges()
from public, anon, authenticated;

-- The app's own RPCs, restored to `authenticated` only.
grant execute on function
  public.challenge_length(),
  public.my_active_challenge(),
  public.day_is_met(uuid, integer),
  public.get_or_freeze_today(),
  public.complete_task(text, integer),
  public.uncomplete_task(text),
  public.seal_day(),
  public.set_target_override(text, integer),
  public.add_custom_task(text, text, boolean, integer),
  public.remove_custom_task(uuid),
  public.change_tier(text),
  public.update_custom_task(uuid, text, text, boolean, integer),
  public.undo_pending_changes(),
  public.get_squad_status(),
  public.create_challenge(text, date, text)
to authenticated;

-- The simulations. Callable by `authenticated`, and refused by
-- require_simulation() unless the caller's own id is in sim_allowed_users —
-- which ships empty. They are owner-scoped in SQL: none takes a user id.
grant execute on function
  public.require_simulation(),
  public.sim_fresh_start(),
  public.sim_jump_to_day(integer, boolean),
  public.sim_day75_complete(),
  public.sim_missed_day()
to authenticated;

-- DELIBERATELY NOT GRANTED to any client role:
--
--   evaluate_all_challenges()  walks EVERY challenge in the database. It is
--                              the scheduler's entry point and nothing else's.
--   evaluate_challenge(uuid)   takes a challenge id, so a grant would let any
--                              user drive the penalty machinery against
--                              somebody else's challenge.
--   restart_challenge(...)     ends a challenge and starts another. Reachable
--                              only from evaluate_challenge().
--   active_challenge_of(uuid)  reads any owner's challenge row. Reachable only
--                              from get_squad_status(), which returns counts.
--   sim_fill_day(uuid, int)    takes a challenge id.
--
-- All five stay reachable from inside the SECURITY DEFINER functions that
-- call them, because privilege checks there run as the function owner.

commit;

-- =============================================================================
-- 11. THE SCHEDULE — outside the transaction
--
-- HOURLY, not daily. Every challenge sits in its own timezone, so a single
-- daily run cannot catch every local midnight; an hourly run catches each
-- one within the hour. Five past, so it is not competing with everything
-- else in the world that fires on the hour.
--
-- pg_cron rather than a scheduled Edge Function, for one reason that matters
-- more than convenience: pg_cron runs INSIDE the database as `postgres`, so
-- the job needs no key of any kind. An Edge Function would need
-- SUPABASE_SERVICE_ROLE_KEY in its environment, and the rule here is that no
-- service-role key exists anywhere it could leak from. This job's entire
-- work is SQL; sending it out over HTTP to come back in with elevated
-- credentials buys nothing and adds a secret.
--
-- Guarded, so this migration applies cleanly whether or not the extension is
-- available, and says which branch it took. If it reports pg_cron
-- unavailable, the schedule is the ONLY part of this migration that did not
-- land — everything above is applied, and the engine can be run by hand with
--   call public.evaluate_all_challenges();
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;

    -- Idempotent: drop any previous definition before scheduling.
    if exists (select 1 from cron.job where jobname = 'evaluate-missed-days') then
      perform cron.unschedule('evaluate-missed-days');
    end if;

    perform cron.schedule(
      'evaluate-missed-days',
      '5 * * * *',
      'call public.evaluate_all_challenges()'
    );
    raise notice '0007: scheduled evaluate-missed-days hourly at :05 via pg_cron';
  else
    raise warning '0007: pg_cron is NOT available on this database. Every other part of this migration applied. The engine will not run on a schedule until you either enable pg_cron (Dashboard > Database > Extensions) and re-run section 11, or deploy a scheduled Edge Function that calls: call public.evaluate_all_challenges();';
  end if;
end $$;
