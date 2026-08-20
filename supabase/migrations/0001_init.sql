-- =============================================================================
-- Ranked Fitness — Phase 8 (B1 + B3): schema, RLS, server-owned day snapshots
--
-- PRIVACY MODEL (the promise these policies must keep):
--   Squadmates see COMPLETION STATUS ONLY — counts, feed entries, XP, tier
--   label. They can never read another member's journal entries, meals or
--   meal nutrition, metric check-ins (weight/mood), "why I started", custom
--   task details, or timed-session detail. HealthKit data has NO tables here
--   by design: it never leaves the device.
--
-- IMMUTABILITY MODEL (the Phase 6 cheat test, server-side):
--   A day's task set is frozen server-side the first time that day is
--   touched, using the SERVER clock in the challenge's timezone. Clients
--   cannot insert, update, or delete challenge_days or task_completions
--   directly — only SECURITY DEFINER RPCs can, and they only ever operate
--   on the server-computed CURRENT day. Edits (targets, custom tasks, tier)
--   are recorded with effective_from_day = current server day + 1, so a
--   lying client cannot rescue today or rewrite the past.
-- =============================================================================

-- ---------- reference data ----------

create table public.tier_standards (
  tier        text not null check (tier in ('hard','medium','soft')),
  task_key    text not null,
  short_name  text not null,
  unit        text check (unit in ('pages','minutes','gallons','litres','count')),
  standard_value integer,
  proof       boolean not null default false,
  sort        integer not null,
  primary key (tier, task_key)
);

insert into public.tier_standards (tier, task_key, short_name, unit, standard_value, proof, sort) values
  ('hard','workout1','Workout 1','minutes',45,true,1),
  ('hard','workout2','Workout 2','minutes',45,true,2),
  ('hard','water','Water','gallons',1,false,3),
  ('hard','read','Read','pages',10,false,4),
  ('hard','diet','Diet',null,null,false,5),
  ('hard','photo','Progress photo',null,null,true,6),
  ('medium','workout1','Workout','minutes',45,true,1),
  ('medium','water','Water','gallons',1,false,2),
  ('medium','read','Read','pages',10,false,3),
  ('medium','diet','Diet',null,null,false,4),
  ('medium','photo','Progress photo',null,null,true,5),
  ('soft','workout1','Workout','minutes',45,true,1),
  ('soft','water','Water','gallons',1,false,2),
  ('soft','read','Read','pages',10,false,3),
  ('soft','diet','Diet',null,null,false,4);

alter table public.tier_standards enable row level security;
create policy tier_standards_read on public.tier_standards
  for select to authenticated using (true);

-- ---------- profiles ----------

-- Squad-visible profile surface: name and xp only.
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null default 'You',
  xp         integer not null default 0,
  created_at timestamptz not null default now()
);

-- Owner-only personal fields ("why I started" is not for squadmates).
create table public.profile_private (
  id  uuid primary key references auth.users (id) on delete cascade,
  why text not null default ''
);

-- ---------- challenge ----------

create table public.challenges (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null unique references auth.users (id) on delete cascade,
  base_tier  text not null check (base_tier in ('hard','medium','soft')),
  start_date date not null,
  timezone   text not null default 'UTC',
  flame      integer not null default 0,
  best_flame integer not null default 0,
  created_at timestamptz not null default now()
);

-- Tier changes are append-only history; effective tier for a day is the
-- latest entry with from_day <= day. Rules (missed-day penalty) follow it.
create table public.tier_history (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  tier         text not null check (tier in ('hard','medium','soft')),
  from_day     integer not null,
  created_at   timestamptz not null default now(),
  primary key (challenge_id, from_day)
);

create table public.custom_tasks (
  id               uuid primary key default gen_random_uuid(),
  challenge_id     uuid not null references public.challenges (id) on delete cascade,
  name             text not null,
  sub              text not null default '',
  proof            boolean not null default false,
  timer_minutes    integer,
  active_from_day  integer not null,
  removed_from_day integer,
  created_at       timestamptz not null default now()
);

create table public.target_overrides (
  challenge_id       uuid not null references public.challenges (id) on delete cascade,
  task_key           text not null,
  value              integer not null check (value >= 1),
  effective_from_day integer not null,
  primary key (challenge_id, task_key)
);

-- The frozen task set per day. task_snapshot stores RESOLVED targets
-- (value + unit + tier standard), never references.
create table public.challenge_days (
  id            uuid primary key default gen_random_uuid(),
  challenge_id  uuid not null references public.challenges (id) on delete cascade,
  day           integer not null check (day >= 1),
  task_snapshot jsonb not null,
  sealed_at     timestamptz,
  created_at    timestamptz not null default now(),
  unique (challenge_id, day)
);

create table public.task_completions (
  id               uuid primary key default gen_random_uuid(),
  challenge_id     uuid not null references public.challenges (id) on delete cascade,
  day              integer not null,
  task_key         text not null,
  completed_at     timestamptz not null default now(),
  duration_seconds integer,
  unique (challenge_id, day, task_key)
);

-- ---------- private journals / meals / metrics / milestones ----------

create table public.journal_entries (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references auth.users (id) on delete cascade,
  day        integer not null,
  text       text not null,
  created_at timestamptz not null default now()
);

create table public.meals (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references auth.users (id) on delete cascade,
  day        integer not null,
  text       text not null,
  nutrition  jsonb,
  created_at timestamptz not null default now()
);

create table public.metric_checkins (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references auth.users (id) on delete cascade,
  weight_kg  numeric(5,1),
  mood       integer check (mood between 1 and 5),
  created_at timestamptz not null default now()
);

create table public.milestones (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references auth.users (id) on delete cascade,
  title      text not null,
  done       boolean not null default false,
  hit_on_day integer,
  created_at timestamptz not null default now()
);

-- ---------- squads ----------

create table public.squads (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text not null unique,
  created_by  uuid not null references auth.users (id),
  created_at  timestamptz not null default now()
);

create table public.squad_members (
  squad_id  uuid not null references public.squads (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (squad_id, user_id)
);

-- One squad per user for now (matches the app model).
create unique index squad_members_one_squad on public.squad_members (user_id);

create table public.feed_items (
  id         uuid primary key default gen_random_uuid(),
  squad_id   uuid not null references public.squads (id) on delete cascade,
  author     uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('complete','proof','change','ping')),
  text       text not null,
  created_at timestamptz not null default now()
);

create table public.pings (
  id         uuid primary key default gen_random_uuid(),
  squad_id   uuid not null references public.squads (id) on delete cascade,
  from_user  uuid not null references auth.users (id) on delete cascade,
  to_user    uuid not null references auth.users (id) on delete cascade,
  message    text not null,
  created_at timestamptz not null default now()
);

create table public.content_reports (
  id           uuid primary key default gen_random_uuid(),
  reporter     uuid not null references auth.users (id) on delete cascade,
  feed_item_id uuid not null references public.feed_items (id) on delete cascade,
  reason       text not null,
  created_at   timestamptz not null default now()
);

create table public.blocked_users (
  blocker    uuid not null references auth.users (id) on delete cascade,
  blocked    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);

-- ---------- helpers ----------

create or replace function public.same_squad(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.squad_members ma
    join public.squad_members mb on ma.squad_id = mb.squad_id
    where ma.user_id = a and mb.user_id = b
  );
$$;

create or replace function public.is_squad_member(p_squad uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.squad_members
    where squad_id = p_squad and user_id = p_user
  );
$$;

-- Server-computed current day of a challenge, in ITS timezone.
create or replace function public.challenge_day(c public.challenges)
returns integer
language sql stable
as $$
  select ((now() at time zone c.timezone)::date - c.start_date) + 1;
$$;

-- Effective tier for a given day (rules + standards follow it).
create or replace function public.effective_tier(p_challenge uuid, p_day integer)
returns text
language sql stable security definer set search_path = public
as $$
  select tier from public.tier_history
  where challenge_id = p_challenge and from_day <= p_day
  order by from_day desc
  limit 1;
$$;

-- Compose the task set for a day: tier standards + overrides + customs.
-- Targets are RESOLVED to values here; the snapshot stores data, not refs.
create or replace function public.compose_task_set(p_challenge uuid, p_day integer)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with tier as (
    select public.effective_tier(p_challenge, p_day) as t
  ),
  tier_tasks as (
    select jsonb_build_object(
      'key', ts.task_key,
      'shortName', ts.short_name,
      'proof', ts.proof,
      'target', case when ts.unit is not null then jsonb_build_object(
        'value', coalesce(
          (select o.value from public.target_overrides o
            where o.challenge_id = p_challenge
              and o.task_key = ts.task_key
              and o.effective_from_day <= p_day),
          ts.standard_value),
        'unit', ts.unit) end,
      'tierStandard', case when ts.unit is not null then jsonb_build_object(
        'value', ts.standard_value, 'unit', ts.unit) end
    ) as task, ts.sort as sort
    from public.tier_standards ts, tier
    where ts.tier = tier.t
  ),
  customs as (
    select jsonb_build_object(
      'key', 'custom-' || c.id,
      'shortName', c.name,
      'proof', c.proof,
      'target', case when c.timer_minutes is not null then jsonb_build_object(
        'value', c.timer_minutes, 'unit', 'minutes') end,
      'tierStandard', null
    ) as task, 100 + row_number() over (order by c.created_at) as sort
    from public.custom_tasks c
    where c.challenge_id = p_challenge
      and c.active_from_day <= p_day
      and (c.removed_from_day is null or c.removed_from_day > p_day)
  )
  select coalesce(jsonb_agg(task order by sort), '[]'::jsonb)
  from (select * from tier_tasks union all select * from customs) all_tasks;
$$;

-- ---------- server-owned day snapshots (B3) ----------

-- Freeze (or fetch) the snapshot for the CURRENT server day only.
create or replace function public.get_or_freeze_today()
returns public.challenge_days
language plpgsql volatile security definer set search_path = public
as $$
declare
  c public.challenges;
  d integer;
  row public.challenge_days;
begin
  select * into c from public.challenges where owner = auth.uid();
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

-- Complete a task — CURRENT server day only, and only tasks in the frozen
-- snapshot. The client cannot choose the day.
create or replace function public.complete_task(p_task_key text, p_duration_seconds integer default null)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  today public.challenge_days;
  c public.challenges;
begin
  today := public.get_or_freeze_today();
  select * into c from public.challenges where owner = auth.uid();
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

-- Un-complete — also current day only.
create or replace function public.uncomplete_task(p_task_key text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  today public.challenge_days;
  c public.challenges;
begin
  today := public.get_or_freeze_today();
  select * into c from public.challenges where owner = auth.uid();
  delete from public.task_completions
  where challenge_id = c.id and day = today.day and task_key = p_task_key;
end;
$$;

-- Seal the day (all snapshot tasks complete). Streak math server-side.
create or replace function public.seal_day()
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  today public.challenge_days;
  c public.challenges;
  needed integer;
  done integer;
begin
  today := public.get_or_freeze_today();
  select * into c from public.challenges where owner = auth.uid();
  if today.sealed_at is not null then
    return;
  end if;
  select jsonb_array_length(today.task_snapshot) into needed;
  select count(*) into done from public.task_completions
    where challenge_id = c.id and day = today.day;
  if done < needed then
    raise exception 'day is not complete: % of % tasks done', done, needed;
  end if;
  update public.challenge_days set sealed_at = now() where id = today.id;
  update public.challenges
    set flame = flame + 1, best_flame = greatest(best_flame, flame + 1)
    where id = c.id;
end;
$$;

-- All edits land TOMORROW (server-computed), never today or the past.
create or replace function public.set_target_override(p_task_key text, p_value integer)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  c public.challenges;
  d integer;
  std integer;
begin
  select * into c from public.challenges where owner = auth.uid();
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
  select * into c from public.challenges where owner = auth.uid();
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
  select * into c from public.challenges where owner = auth.uid();
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
  select * into c from public.challenges where owner = auth.uid();
  if c.id is null then raise exception 'no challenge'; end if;
  d := public.challenge_day(c);
  insert into public.tier_history (challenge_id, tier, from_day)
  values (c.id, p_tier, d + 1)
  on conflict (challenge_id, from_day) do update set tier = excluded.tier;
end;
$$;

create or replace function public.create_challenge(
  p_base_tier text, p_start_date date, p_timezone text default 'UTC')
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into public.challenges (owner, base_tier, start_date, timezone)
  values (auth.uid(), p_base_tier, p_start_date, p_timezone)
  returning id into new_id;
  insert into public.tier_history (challenge_id, tier, from_day)
  values (new_id, p_base_tier, 1);
  return new_id;
end;
$$;

-- ---------- squads: join by code, status counts, quota-limited pings ----------

create or replace function public.create_squad(p_name text)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  new_id uuid;
  code text;
begin
  code := upper(substr(md5(random()::text), 1, 6));
  insert into public.squads (name, invite_code, created_by)
  values (p_name, code, auth.uid())
  returning id into new_id;
  insert into public.squad_members (squad_id, user_id) values (new_id, auth.uid());
  return new_id;
end;
$$;

create or replace function public.join_squad(p_code text)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  s public.squads;
begin
  select * into s from public.squads where invite_code = upper(p_code);
  if s.id is null then raise exception 'invalid invite code'; end if;
  insert into public.squad_members (squad_id, user_id)
  values (s.id, auth.uid())
  on conflict do nothing;
  return s.id;
end;
$$;

create or replace function public.leave_squad()
returns void
language sql volatile security definer set search_path = public
as $$
  delete from public.squad_members where user_id = auth.uid();
$$;

-- Squad-visible status: COUNTS ONLY. This is the entire social surface of
-- another member's day — no task detail, no journals, no metrics.
create or replace function public.get_squad_status()
returns table (user_id uuid, name text, xp integer, done_today integer, tasks_today integer, tier_label text)
language plpgsql stable security definer set search_path = public
as $$
declare
  my_squad uuid;
begin
  select squad_id into my_squad from public.squad_members where squad_members.user_id = auth.uid();
  if my_squad is null then return; end if;
  return query
  select m.user_id,
         p.name,
         p.xp,
         coalesce((
           select count(*)::integer from public.task_completions tc
           join public.challenges c2 on c2.id = tc.challenge_id
           where c2.owner = m.user_id and tc.day = public.challenge_day(c2)
         ), 0),
         coalesce((
           select jsonb_array_length(cd.task_snapshot) from public.challenge_days cd
           join public.challenges c3 on c3.id = cd.challenge_id
           where c3.owner = m.user_id and cd.day = public.challenge_day(c3)
         ), 0),
         coalesce((
           select case when exists (
             select 1 from public.challenges c4
             join public.challenge_days cd2 on cd2.challenge_id = c4.id
               and cd2.day = public.challenge_day(c4)
             where c4.owner = m.user_id
               and exists (
                 select 1 from jsonb_array_elements(cd2.task_snapshot) t
                 where (t->'target'->>'value')::integer < (t->'tierStandard'->>'value')::integer
               )
           ) then 'Custom'
           else initcap(public.effective_tier(
             (select c5.id from public.challenges c5 where c5.owner = m.user_id),
             (select public.challenge_day(c6) from public.challenges c6 where c6.owner = m.user_id)))
           end
         ), 'Hard')
  from public.squad_members m
  join public.profiles p on p.id = m.user_id
  where m.squad_id = my_squad;
end;
$$;

-- Pings: quota enforced SERVER-side (5 per sender per UTC day).
create or replace function public.send_ping(p_to uuid, p_message text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  my_squad uuid;
  used integer;
begin
  select squad_id into my_squad from public.squad_members where user_id = auth.uid();
  if my_squad is null or not public.is_squad_member(my_squad, p_to) then
    raise exception 'recipient is not in your squad';
  end if;
  select count(*) into used from public.pings
    where from_user = auth.uid() and created_at >= date_trunc('day', now());
  if used >= 5 then
    raise exception 'out of pings — resets at midnight';
  end if;
  insert into public.pings (squad_id, from_user, to_user, message)
  values (my_squad, auth.uid(), p_to, p_message);
  insert into public.feed_items (squad_id, author, kind, text)
  values (my_squad, auth.uid(), 'ping', p_message);
end;
$$;

-- ---------- RLS (B1) ----------

alter table public.profiles         enable row level security;
alter table public.profile_private  enable row level security;
alter table public.challenges       enable row level security;
alter table public.tier_history     enable row level security;
alter table public.custom_tasks     enable row level security;
alter table public.target_overrides enable row level security;
alter table public.challenge_days   enable row level security;
alter table public.task_completions enable row level security;
alter table public.journal_entries  enable row level security;
alter table public.meals            enable row level security;
alter table public.metric_checkins  enable row level security;
alter table public.milestones       enable row level security;
alter table public.squads           enable row level security;
alter table public.squad_members    enable row level security;
alter table public.feed_items       enable row level security;
alter table public.pings            enable row level security;
alter table public.content_reports  enable row level security;
alter table public.blocked_users    enable row level security;

-- profiles: self, or same-squad members (name + xp only lives here).
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.same_squad(auth.uid(), id));
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- profile_private ("why"): OWNER ONLY, ever.
create policy profile_private_all on public.profile_private for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- challenge config: owner only. Writes flow through RPCs but owner-scoped
-- SELECT is required for the app's own screens.
create policy challenges_select on public.challenges for select to authenticated
  using (owner = auth.uid());
create policy tier_history_select on public.tier_history for select to authenticated
  using (exists (select 1 from public.challenges c where c.id = challenge_id and c.owner = auth.uid()));
create policy custom_tasks_select on public.custom_tasks for select to authenticated
  using (exists (select 1 from public.challenges c where c.id = challenge_id and c.owner = auth.uid()));
create policy target_overrides_select on public.target_overrides for select to authenticated
  using (exists (select 1 from public.challenges c where c.id = challenge_id and c.owner = auth.uid()));
create policy challenge_days_select on public.challenge_days for select to authenticated
  using (exists (select 1 from public.challenges c where c.id = challenge_id and c.owner = auth.uid()));
create policy task_completions_select on public.task_completions for select to authenticated
  using (exists (select 1 from public.challenges c where c.id = challenge_id and c.owner = auth.uid()));

-- journals / meals / metrics / milestones: OWNER ONLY, all commands.
create policy journal_all on public.journal_entries for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
create policy meals_all on public.meals for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
create policy metrics_all on public.metric_checkins for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
create policy milestones_all on public.milestones for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

-- squads: members only. Join happens via join_squad(code), so non-members
-- never enumerate squads or codes.
create policy squads_select on public.squads for select to authenticated
  using (public.is_squad_member(id, auth.uid()));
create policy squad_members_select on public.squad_members for select to authenticated
  using (user_id = auth.uid() or public.is_squad_member(squad_id, auth.uid()));

-- feed: squad members read; authors write their own entries.
create policy feed_select on public.feed_items for select to authenticated
  using (public.is_squad_member(squad_id, auth.uid()));
create policy feed_insert on public.feed_items for insert to authenticated
  with check (author = auth.uid() and public.is_squad_member(squad_id, auth.uid())
              and kind in ('complete','proof','change'));

-- pings: sender or recipient only; INSERT only via send_ping (quota).
create policy pings_select on public.pings for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());

-- moderation
create policy reports_insert on public.content_reports for insert to authenticated
  with check (reporter = auth.uid());
create policy reports_select on public.content_reports for select to authenticated
  using (reporter = auth.uid());
create policy blocked_all on public.blocked_users for all to authenticated
  using (blocker = auth.uid()) with check (blocker = auth.uid());

-- Belt and braces: even a definer bug can never rewrite a frozen snapshot.
create or replace function public.forbid_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'day snapshots are immutable';
  end if;
  if new.task_snapshot is distinct from old.task_snapshot
     or new.day is distinct from old.day
     or new.challenge_id is distinct from old.challenge_id then
    raise exception 'day snapshots are immutable';
  end if;
  return new; -- sealing (sealed_at) is the only permitted change
end;
$$;

create trigger challenge_days_immutable
  before update or delete on public.challenge_days
  for each row execute function public.forbid_snapshot_mutation();

-- ---------- privilege lockdown: explicit allow-list ----------
-- Supabase's default privileges grant ALL on new public tables — and
-- EXECUTE on new functions — to BOTH `anon` and `authenticated`. RLS
-- default-deny would still hold without policies, but the privilege layer
-- is a deliberate first wall: start every client role from zero, then
-- grant exactly what the app is sanctioned to do. `anon` gets NOTHING —
-- this app has no unauthenticated surface. Keep this section last so it
-- covers everything the migration created, and repeat the pattern in every
-- future migration (Supabase re-applies defaults to new objects).

revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- Reads: every table is guarded by an owner/member-scoped RLS policy.
grant select on
  public.tier_standards, public.profiles, public.profile_private,
  public.challenges, public.tier_history, public.custom_tasks,
  public.target_overrides, public.challenge_days, public.task_completions,
  public.journal_entries, public.meals, public.metric_checkins,
  public.milestones, public.squads, public.squad_members,
  public.feed_items, public.pings, public.content_reports,
  public.blocked_users
to authenticated;

-- Direct writes: ONLY owner-scoped personal data and moderation. Anything
-- server-owned (challenges, snapshots, completions, tier/target/custom-task
-- config, squads, membership, pings) writes exclusively through the
-- SECURITY DEFINER RPCs.
grant insert on
  public.profiles, public.profile_private, public.journal_entries,
  public.meals, public.metric_checkins, public.milestones,
  public.feed_items, public.content_reports, public.blocked_users
to authenticated;

grant update on
  public.profiles, public.profile_private, public.meals, public.milestones
to authenticated;

grant delete on public.blocked_users to authenticated;

-- RPCs and RLS policy helpers are callable by authenticated users only.
grant execute on all functions in schema public to authenticated;
