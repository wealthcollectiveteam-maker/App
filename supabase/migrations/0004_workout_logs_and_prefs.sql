-- =============================================================================
-- B4a: the last schema the backend swap needs.
--
-- 1. workout_logs — the "what did I do yesterday" surface. Composed ONLY of
--    data the app owns: duration from our own timer or typed by the user,
--    plus a user-picked activity type, optional effort, optional note.
--    NO HealthKit-derived value is ever written here. The privacy policy and
--    the submitted App Privacy answers both state that Apple Health data is
--    read on-device and never transmitted; persisting a HealthKit duration or
--    activity type — even with the user tapping confirm — would break that.
--
-- 2. Preference sync columns on profile_private, so a reinstall restores the
--    user's settings. Health PREFERENCES sync (booleans the user set);
--    health DATA never does. profile_private is already owner-only with RLS
--    and grants from 0001, so new columns need no new policies or grants.
--
-- RLS shape for workout_logs is deliberately identical to metric_checkins:
-- owner reads and writes only. Squadmates see that a workout task was
-- completed (via task_completions/feed_items) — never what it was, how long,
-- how hard, or the note.
-- =============================================================================

create table public.workout_logs (
  id               uuid primary key default gen_random_uuid(),
  owner            uuid not null references auth.users (id) on delete cascade,
  challenge_id     uuid not null references public.challenges (id) on delete cascade,
  day              integer not null,
  task_key         text not null,
  -- From the chip picker or free text under "Other". User-authored.
  activity_type    text not null,
  -- From our own timer, or typed by the user on the swipe-completion path.
  duration_seconds integer not null check (duration_seconds >= 0),
  -- Optional 1..5.
  effort           smallint check (effort is null or effort between 1 and 5),
  -- Optional single short line.
  notes            text check (notes is null or char_length(notes) <= 280),
  logged_at        timestamptz not null default now()
);

-- The reading surfaces are "my logs, newest first" and "my logs for a day".
create index workout_logs_owner_day_idx
  on public.workout_logs (owner, day desc, logged_at desc);

alter table public.workout_logs enable row level security;

-- OWNER ONLY, all commands — same policy shape as metric_checkins.
create policy workout_logs_all on public.workout_logs for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

-- ---------- preference sync (health PREFERENCES, not health data) ----------
alter table public.profile_private
  add column health_enabled          boolean not null default false,
  add column diet_prompt_enabled     boolean not null default true,
  add column workout_prompt_enabled  boolean not null default true,
  add column weight_prefill_enabled  boolean not null default true,
  add column notify_timer_alerts     boolean not null default true,
  add column notify_pings            boolean not null default true,
  add column notify_squad_activity   boolean not null default true,
  add column notify_daily_reminder   boolean not null default false,
  add column weekly_checkin_enabled  boolean not null default true;

-- Day 75 completion reflection (owner-only, same table as "why I started").
alter table public.profile_private
  add column completion_feeling text,
  add column completion_text    text;

-- ---------- RPCs B4a needs that 0001 did not define ----------

-- Editing a custom task's DEFINITION. Past and present days are untouched
-- because their snapshots hold frozen copies — this only changes what future
-- compositions pick up.
create or replace function public.update_custom_task(
  p_id            uuid,
  p_name          text,
  p_sub           text,
  p_proof         boolean,
  p_timer_minutes integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.custom_tasks ct
     set name = p_name, sub = p_sub, proof = p_proof, timer_minutes = p_timer_minutes
   where ct.id = p_id
     and exists (
       select 1 from public.challenges c
        where c.id = ct.challenge_id and c.owner = auth.uid()
     );
  if not found then
    raise exception 'custom task not found for this user';
  end if;
end $$;

-- UNDO of today's pending edits, as one server-side transaction: drop
-- pending adds, reinstate pending removals, clear target overrides created
-- today, and clear a pending tier change. Only ever touches rows whose
-- effective_from_day is the server's CURRENT day + 1 — the past is unreachable.
create or replace function public.undo_pending_changes()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge uuid;
  v_day       integer;
begin
  -- challenge_day() takes the challenge ROW, not its id.
  select c.id, public.challenge_day(c) into v_challenge, v_day
    from public.challenges c where c.owner = auth.uid();
  if v_challenge is null then
    raise exception 'no challenge for this user';
  end if;

  delete from public.custom_tasks
   where challenge_id = v_challenge and active_from_day = v_day + 1;

  update public.custom_tasks
     set removed_from_day = null
   where challenge_id = v_challenge and removed_from_day = v_day + 1;

  delete from public.target_overrides
   where challenge_id = v_challenge and effective_from_day = v_day + 1;

  -- tier_history keys the effective day as `from_day`.
  delete from public.tier_history
   where challenge_id = v_challenge and from_day = v_day + 1;
end $$;

create or replace function public.save_completion_feeling(
  p_feeling text,
  p_text    text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profile_private (id, completion_feeling, completion_text)
  values (auth.uid(), p_feeling, p_text)
  on conflict (id) do update
    set completion_feeling = excluded.completion_feeling,
        completion_text    = excluded.completion_text;
end $$;

-- Account deletion. Removes every row this user owns; `on delete cascade`
-- from challenges clears days, completions, custom tasks, overrides and
-- workout logs. NOTE: deleting the auth.users row itself requires the
-- service role, so the client also signs out and the auth record is reaped
-- by an admin job — see PRIVACY_NOTES.md.
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  perform public.leave_squad();
  delete from public.journal_entries where owner = v_uid;
  delete from public.meals           where owner = v_uid;
  delete from public.metric_checkins where owner = v_uid;
  delete from public.milestones      where owner = v_uid;
  delete from public.workout_logs    where owner = v_uid;
  delete from public.blocked_users   where blocker = v_uid;
  delete from public.feed_items      where author = v_uid;
  delete from public.challenges      where owner = v_uid;
  delete from public.profile_private where id = v_uid;
  delete from public.profiles        where id = v_uid;
end $$;

-- Extend the sanctioned squad surface with each member's flame, so the UI can
-- show a squad streak (the weakest link — a squad's streak is only as long as
-- its shortest individual one) without a second query per member. Still
-- counts and labels only: no journals, meals, metrics, or workout detail.
-- `create or replace` cannot change a function's OUT-parameter row type, so
-- adding `flame` to the returned table requires an explicit drop first.
drop function if exists public.get_squad_status();

create function public.get_squad_status()
returns table (
  user_id uuid, name text, xp integer, done_today integer,
  tasks_today integer, tier_label text, flame integer
)
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
         ), 'Hard'),
         coalesce((select c7.flame from public.challenges c7 where c7.owner = m.user_id), 0)
  from public.squad_members m
  join public.profiles p on p.id = m.user_id
  where m.squad_id = my_squad;
end;
$$;

-- ---------- privilege lockdown: same allow-list pattern as 0001/0002 ----------
-- Supabase re-applies its default privileges (ALL on new tables to BOTH
-- `anon` and `authenticated`) to every object a migration creates, so every
-- migration that creates something must re-run the lockdown. Start the client
-- roles at zero, then grant back exactly what is sanctioned.
--
-- Scoped to the object this migration created. The profile_private columns
-- above need nothing: table-level grants from 0001 already cover them.

revoke all on public.workout_logs from public, anon, authenticated;

-- Owner-scoped personal data: the client writes it directly, guarded by the
-- owner-only RLS policy above. No RPC needed, nothing server-computed.
grant select, insert, update, delete on public.workout_logs to authenticated;

-- The four functions this migration created inherit Supabase's default
-- EXECUTE grant to anon + authenticated. Claw it back, then re-grant to
-- authenticated only.
revoke all on function
  public.update_custom_task(uuid, text, text, boolean, integer),
  public.undo_pending_changes(),
  public.save_completion_feeling(text, text),
  public.delete_account(),
  public.get_squad_status()
from public, anon, authenticated;

grant execute on function
  public.update_custom_task(uuid, text, text, boolean, integer),
  public.undo_pending_changes(),
  public.save_completion_feeling(text, text),
  public.delete_account(),
  public.get_squad_status()
to authenticated;
