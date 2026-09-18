-- =============================================================================
-- 0011 — THE GRACE WINDOW.
--
-- THE RULE
--   Yesterday stays completable until NOON, then locks. Noon in the
--   CHALLENGE's own timezone, never the server's.
--
-- WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT
--
--   CHANGED   The boundary. A day used to close at local midnight and be
--             judged immediately. It now closes at noon the following day and
--             is judged on the first scheduled run after that.
--
--   UNCHANGED The rule itself. A day that is still short at noon is still a
--             miss, still resets the streak, and on Hard still archives the
--             attempt and starts a new one. The window is a wider door, not a
--             removed one. If this migration ever made a miss survivable it
--             would have dismantled the only rule the app rests on.
--
--   UNCHANGED Snapshot immutability. Yesterday's frozen task set cannot be
--             edited during the window — only its completions. The
--             challenge_days trigger is untouched and still armed.
--
--   UNCHANGED The privilege wall. `authenticated` holds SELECT and nothing
--             else on challenge_days and task_completions, so every write
--             still goes through a SECURITY DEFINER RPC that decides for
--             itself which day it will accept.
--
-- ONE CLOCK, ONE DEFINITION
--   Phase 12 shipped a bug in which t_set_day anchored on the server's
--   current_date while challenge_day() read the challenge's timezone, and the
--   two disagreed for about an hour a day in Europe/London. Everything here
--   derives from ONE function, day_closes_at(), which resolves a local wall
--   time in the challenge's zone to an absolute instant. earliest_open_day()
--   is defined in terms of it rather than re-deriving noon a second way, so
--   the two cannot drift.
--
-- THE SCHEDULE IS ALREADY RIGHT. 0007 schedules evaluate_all_challenges()
--   HOURLY at :05, not daily, precisely because every challenge sits in its
--   own timezone. An hourly job catches each local noon within the hour
--   exactly as it caught each local midnight, so no cron change is needed and
--   none is made here.
--
-- APPLY ORDER: after 0010.
-- =============================================================================

begin;

-- =============================================================================
-- 1. THE CLOCK
-- =============================================================================

-- Noon. One number, so "the grace window" is a value and not a literal
-- sprinkled through five function bodies.
create or replace function public.grace_deadline_hour()
returns integer
language sql immutable
as $$ select 12 $$;

-- The wall clock in the CHALLENGE's timezone. Every local-time decision in
-- this file goes through here or through day_closes_at().
create or replace function public.challenge_local_now(c public.challenges)
returns timestamp
language sql stable
as $$ select now() at time zone c.timezone $$;

-- THE BOUNDARY, as an absolute instant: the moment day p_day stops being
-- completable, which is noon on the following local day.
--
-- Day 1 is start_date, so day p_day is start_date + (p_day - 1) and the day
-- after it is start_date + p_day. `timestamp at time zone tz` resolves that
-- local wall time to a timestamptz through the zone's own rules, so this is
-- correct across a DST change rather than 24-hours-from-something.
create or replace function public.day_closes_at(c public.challenges, p_day integer)
returns timestamptz
language sql stable
as $$
  select ((c.start_date + p_day)::timestamp
          + make_interval(hours => public.grace_deadline_hour()))
         at time zone c.timezone;
$$;

-- The earliest day still open for completion.
--
--   before local noon   yesterday and today   (two days open at once)
--   from local noon     today only
--
-- Never below 1: a challenge on its first day has only day 1, and someone who
-- signed up at 23:50 must not be offered a "day 0".
create or replace function public.earliest_open_day(c public.challenges)
returns integer
language sql stable
as $$
  select greatest(1,
    public.challenge_day(c)
      - case when now() < public.day_closes_at(c, public.challenge_day(c) - 1)
             then 1 else 0 end);
$$;

-- The highest day that has CLOSED. This is the evaluator's upper bound and
-- the single place the judging boundary moved.
create or replace function public.last_closed_day(c public.challenges)
returns integer
language sql stable
as $$ select public.earliest_open_day(c) - 1 $$;

-- Whether a day is open for writes right now. The one predicate every write
-- RPC below consults, so "which days may I touch" has exactly one answer.
create or replace function public.day_is_open(c public.challenges, p_day integer)
returns boolean
language sql stable
as $$
  select p_day >= public.earliest_open_day(c)
     and p_day <= public.challenge_day(c);
$$;

-- =============================================================================
-- 2. FREEZING A DAY THAT IS NOT TODAY
--
-- get_or_freeze_today() froze the current day and nothing else, which is
-- correct while only one day is ever open. During the window the app needs
-- yesterday's snapshot too — and if the user never opened the app yesterday
-- there is no row to read. Freezing it now, from the config that was in force
-- THEN, is the same thing the evaluator already does when it back-fills a day
-- nobody opened; doing it here just means the user can still finish it.
-- =============================================================================

create or replace function public.get_or_freeze_day(p_day integer)
returns public.challenge_days
language plpgsql volatile security definer set search_path = public
as $$
declare
  c   public.challenges;
  row public.challenge_days;
begin
  c := public.my_active_challenge();
  if c.id is null then
    raise exception 'no challenge for user';
  end if;
  if p_day is null then
    raise exception 'a day is required';
  end if;
  if not public.day_is_open(c, p_day) then
    raise exception 'day % is closed (open: % to %)',
      p_day, public.earliest_open_day(c), public.challenge_day(c);
  end if;

  select * into row from public.challenge_days
   where challenge_id = c.id and day = p_day;
  if row.id is null then
    insert into public.challenge_days (challenge_id, day, task_snapshot)
    values (c.id, p_day, public.compose_task_set(c.id, p_day))
    on conflict (challenge_id, day) do nothing
    returning * into row;
    if row.id is null then
      select * into row from public.challenge_days
       where challenge_id = c.id and day = p_day;
    end if;
  end if;
  return row;
end;
$$;

-- Unchanged in meaning, re-expressed through the new primitive so there is
-- one freeze path rather than two.
create or replace function public.get_or_freeze_today()
returns public.challenge_days
language plpgsql volatile security definer set search_path = public
as $$
declare c public.challenges;
begin
  c := public.my_active_challenge();
  if c.id is null then
    raise exception 'no challenge for user';
  end if;
  return public.get_or_freeze_day(public.challenge_day(c));
end;
$$;

-- =============================================================================
-- 3. THE WRITE RPCs — now day-aware, and still the only way in
--
-- Each takes an OPTIONAL day. Omitted means today, so every existing call
-- site keeps its exact behaviour. Supplied, it is checked against
-- day_is_open() before anything is written — which is what refuses a day
-- older than yesterday, a day in the future, and yesterday after noon.
--
-- DROP then CREATE, not CREATE OR REPLACE: adding a defaulted parameter makes
-- a NEW signature, so the old arities would survive alongside the new ones and
-- a two-argument call would silently keep resolving to the old, day-blind
-- version. That is the 0008 lesson, and it is exactly the shape of bug that
-- would leave the grace window looking implemented and doing nothing.
-- =============================================================================

drop function if exists public.complete_task(text, integer);
drop function if exists public.uncomplete_task(text);
drop function if exists public.seal_day();

create or replace function public.complete_task(
  p_task_key text,
  p_duration_seconds integer default null,
  p_day integer default null)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  c     public.challenges;
  d     public.challenge_days;
  v_day integer;
begin
  c := public.my_active_challenge();
  if c.id is null then
    raise exception 'no challenge for user';
  end if;
  v_day := coalesce(p_day, public.challenge_day(c));

  -- THE DOOR. Everything the grace window widens, it widens here and only
  -- here. A day older than yesterday, or yesterday after noon, is refused
  -- before a row is touched.
  if not public.day_is_open(c, v_day) then
    raise exception 'day % is closed; open days are % to %',
      v_day, public.earliest_open_day(c), public.challenge_day(c);
  end if;

  d := public.get_or_freeze_day(v_day);
  if not exists (
    select 1 from jsonb_array_elements(d.task_snapshot) t
    where t->>'key' = p_task_key
  ) then
    raise exception 'task % is not part of day %''s snapshot', p_task_key, v_day;
  end if;

  insert into public.task_completions
    (challenge_id, day, task_key, duration_seconds)
  values (c.id, v_day, p_task_key, p_duration_seconds)
  on conflict (challenge_id, day, task_key) do nothing;
end;
$$;

create or replace function public.uncomplete_task(
  p_task_key text,
  p_day integer default null)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  c     public.challenges;
  v_day integer;
begin
  c := public.my_active_challenge();
  if c.id is null then
    raise exception 'no challenge for user';
  end if;
  v_day := coalesce(p_day, public.challenge_day(c));

  if not public.day_is_open(c, v_day) then
    raise exception 'day % is closed; open days are % to %',
      v_day, public.earliest_open_day(c), public.challenge_day(c);
  end if;

  -- Un-ticking a task un-finishes the day. A day that has been sealed has
  -- already paid its flame, so letting it be hollowed out would leave a
  -- streak standing on a day that is no longer met.
  if exists (select 1 from public.challenge_days
              where challenge_id = c.id and day = v_day and sealed_at is not null) then
    raise exception 'day % is sealed', v_day;
  end if;

  delete from public.task_completions
  where challenge_id = c.id and day = v_day and task_key = p_task_key;
end;
$$;

create or replace function public.seal_day(p_day integer default null)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  c     public.challenges;
  d     public.challenge_days;
  v_day integer;
begin
  c := public.my_active_challenge();
  if c.id is null then
    raise exception 'no challenge for user';
  end if;
  v_day := coalesce(p_day, public.challenge_day(c));

  if not public.day_is_open(c, v_day) then
    raise exception 'day % is closed; open days are % to %',
      v_day, public.earliest_open_day(c), public.challenge_day(c);
  end if;

  d := public.get_or_freeze_day(v_day);
  if d.sealed_at is not null then
    return;
  end if;
  if not public.day_is_met(c.id, v_day) then
    raise exception 'day % is not complete: % of % tasks done',
      v_day,
      (select count(*) from public.task_completions
        where challenge_id = c.id and day = v_day),
      jsonb_array_length(d.task_snapshot);
  end if;

  update public.challenge_days set sealed_at = now() where id = d.id;

  -- The flame is a COUNT of met days, so it does not matter whether today or
  -- yesterday is sealed first: each met day pays exactly once, here or in the
  -- evaluator's retroactive seal, never both.
  update public.challenges
    set flame = flame + 1, best_flame = greatest(best_flame, flame + 1)
    where id = c.id;
end;
$$;

-- =============================================================================
-- 4. WHAT THE APP READS — one call, every open day, plus the one that closed
--
-- The check-in screen has to render two days at once for part of every
-- morning, and it must be able to say "Day 7 closed at 12:00" rather than
-- silently dropping the option. One read answers all three cases:
--
--   is_open = true,  is_today = false   yesterday, still finishable
--   is_open = false, is_today = false   yesterday, closed — say so
--   is_open = true,  is_today = true    today
--
-- Yesterday is FROZEN only while it is open. Once closed, this returns the
-- row if one exists and creates nothing: back-filling a closed day is the
-- evaluator's job, and doing it here would let a read manufacture history.
-- =============================================================================

create or replace function public.get_day_window()
returns table (
  challenge_id  uuid,
  day           integer,
  is_today      boolean,
  is_open       boolean,
  closes_at     timestamptz,
  sealed_at     timestamptz,
  outcome       text,
  tasks_total   integer,
  tasks_done    integer,
  task_snapshot jsonb
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

  -- Freeze every OPEN day, oldest first.
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
         cd.task_snapshot
  from public.challenge_days cd
  where cd.challenge_id = c.id
    -- yesterday (open or just closed) and today
    and cd.day between greatest(1, v_today - 1) and v_today
  order by cd.day;
end;
$$;

-- =============================================================================
-- 5. THE EVALUATOR — one line moves, and only one
--
-- Recreated from 0008 with a single change: the upper bound is
-- last_closed_day(c) instead of challenge_day(c) - 1. Everything else — the
-- retroactive seal, the tier_rules lookup, the feed row, the cursor advancing
-- inside the same transaction as the penalty, the finish line — is the 0008
-- body, unchanged.
--
-- CONSEQUENCE, stated rather than discovered later: the cursor now reaches
-- duration_days after noon on the day AFTER the final day, not at the
-- midnight following it. A finished run is therefore marked
-- ended_reason = 'completed' up to twelve hours later than it used to be. The
-- Day-N finish screen does not depend on that write — it renders on
-- `day >= durationDays && dayComplete`, client-side — so what moves is the
-- server-side archival, not what the user sees.
-- =============================================================================

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
  v_day  := greatest(c.last_evaluated_day + 1, 2);

  while v_day <= v_last loop
    select * into v_snapshot from public.challenge_days
      where challenge_id = c.id and day = v_day;

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

      if v_rules.restarts_challenge then
        v_text := format(
          'missed Day %s. %s rules — the challenge restarts at Day 1.',
          v_day, initcap(v_tier));
      elsif v_rules.resets_streak then
        v_text := format('missed Day %s. Streak reset to zero.', v_day);
      else
        v_text := format('missed Day %s.', v_day);
      end if;

      if v_squad is not null then
        insert into public.feed_items (squad_id, author, kind, text)
        values (v_squad, c.owner, 'miss', v_text);
      end if;

      update public.challenges set last_evaluated_day = v_day where id = c.id;
      v_judged := v_judged + 1;

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

-- =============================================================================
-- 6. THE SQUAD ROSTER, MID-WINDOW
--
-- Left alone, the roster would have lied by omission. A squadmate who is up
-- at 8am finishing yesterday shows as Day 8, 0 of 11 — accurate about today
-- and silent about the only thing they are actually doing. Worse, once they
-- finish yesterday the roster still says 0 of 11 and their flame has not
-- moved, so the honest reading of the row is "they have stopped".
--
-- So the roster now carries yesterday as well, for as long as yesterday is
-- open. Three columns, all of them the same class of already-social fact the
-- roster has always shown — a count of completed tasks, never what the tasks
-- were, never anything private.
--
-- DROP then CREATE: the return type changes, and CREATE OR REPLACE cannot
-- change a function's OUT columns.
-- =============================================================================

drop function if exists public.get_squad_status(uuid);

create or replace function public.get_squad_status(p_squad_id uuid)
returns table (
  user_id uuid, name text, xp integer, done_today integer,
  tasks_today integer, tier_label text, flame integer,
  day integer, duration_days integer,
  -- The still-open previous day, or NULL once it has closed.
  grace_day integer, grace_done integer, grace_tasks integer
)
language plpgsql stable security definer set search_path = public
as $$
declare
  my_squad uuid;
begin
  if not public.is_squad_member(p_squad_id, auth.uid()) then
    return;
  end if;
  my_squad := p_squad_id;
  return query
  with roster as (
    select m.user_id as uid, p.name as pname, p.xp as pxp,
           public.active_challenge_of(m.user_id) as ch
    from public.squad_members m
    join public.profiles p on p.id = m.user_id
    where m.squad_id = my_squad
  ),
  -- Each member's own clock. earliest_open_day() reads THEIR challenge's
  -- timezone, so a squad spread across three zones gets three different
  -- answers in the same result set — which is the point.
  windowed as (
    select r.*,
           public.challenge_day(r.ch) as today_day,
           case when public.earliest_open_day(r.ch) < public.challenge_day(r.ch)
                then public.earliest_open_day(r.ch) end as open_prev
    from roster r
  )
  select w.uid,
         w.pname,
         w.pxp,
         coalesce((
           select count(*)::integer from public.task_completions tc
           where tc.challenge_id = (w.ch).id and tc.day = w.today_day
         ), 0),
         coalesce((
           select jsonb_array_length(cd.task_snapshot)
           from public.challenge_days cd
           where cd.challenge_id = (w.ch).id and cd.day = w.today_day
         ), 0),
         coalesce(
           case when exists (
             select 1 from public.challenge_days cd2
             where cd2.challenge_id = (w.ch).id
               and cd2.day = w.today_day
               and exists (
                 select 1 from jsonb_array_elements(cd2.task_snapshot) t
                 where (t->'target'->>'value')::integer
                     < (t->'tierStandard'->>'value')::integer
               )
           ) then 'Custom'
           else initcap(public.effective_tier((w.ch).id, w.today_day))
           end, 'Hard'),
         coalesce((w.ch).flame, 0),
         coalesce(w.today_day, 0),
         coalesce((w.ch).duration_days, 75),
         -- NULL unless the member's own noon is still ahead of them AND
         -- yesterday is genuinely unfinished. A finished yesterday is not
         -- news; showing it would only add noise to every roster all morning.
         case when w.open_prev is not null
                   and not public.day_is_met((w.ch).id, w.open_prev)
              then w.open_prev end,
         case when w.open_prev is not null
                   and not public.day_is_met((w.ch).id, w.open_prev)
              then coalesce((
                select count(*)::integer from public.task_completions tc
                where tc.challenge_id = (w.ch).id and tc.day = w.open_prev
              ), 0) end,
         case when w.open_prev is not null
                   and not public.day_is_met((w.ch).id, w.open_prev)
              then coalesce((
                select jsonb_array_length(cd.task_snapshot)
                from public.challenge_days cd
                where cd.challenge_id = (w.ch).id and cd.day = w.open_prev
              ), 0) end
  from windowed w;
end;
$$;

-- =============================================================================
-- 6b. THE "MISSED DAY" SIMULATION FOLLOWS THE BOUNDARY
--
-- sim_missed_day() emptied YESTERDAY and ran the evaluator. Yesterday is now
-- open until noon, so for the whole morning the simulation would strip a day,
-- judge nothing, and report success — a dev tool that silently stopped
-- simulating the thing it is named after. It now targets the most recent day
-- that has actually CLOSED, and jumps far enough forward that one exists.
-- =============================================================================

create or replace function public.sim_missed_day()
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  c            public.challenges;
  v_gap        integer;
  v_target     integer;
  v_was_sealed boolean;
begin
  c := public.require_simulation();

  -- How far behind today the judging boundary currently sits: 1 after local
  -- noon, 2 before it. Read rather than assumed, so this stays correct if the
  -- deadline ever moves.
  v_gap := public.challenge_day(c) - public.last_closed_day(c);

  -- Day 1 is never judged, so the simulation needs a closed day 2 or later.
  if public.last_closed_day(c) < 2 then
    perform public.sim_jump_to_day(2 + v_gap, false);
    c := public.my_active_challenge();
  end if;

  v_target := public.last_closed_day(c);
  if v_target < 2 then
    raise exception 'cannot simulate a miss: no day has closed yet';
  end if;

  select sealed_at is not null into v_was_sealed
    from public.challenge_days
   where challenge_id = c.id and day = v_target;

  delete from public.task_completions
   where challenge_id = c.id and day = v_target;

  update public.challenge_days
     set sealed_at = null, evaluated_at = null, outcome = null
   where challenge_id = c.id and day = v_target;

  update public.challenges
     set last_evaluated_day = greatest(v_target - 1, 1),
         flame = case when coalesce(v_was_sealed, false)
                      then greatest(flame - 1, 0) else flame end
   where id = c.id;

  perform public.evaluate_challenge(c.id);
end;
$$;

-- =============================================================================
-- 7. PRIVILEGES — the allow-list, repeated for everything this file created
--
-- Supabase re-applies its default grants to NEW objects, so every function
-- above currently carries EXECUTE for anon and authenticated. Start from zero,
-- then grant back exactly what the app is sanctioned to call.
-- =============================================================================

revoke all on function
  public.grace_deadline_hour(),
  public.challenge_local_now(public.challenges),
  public.day_closes_at(public.challenges, integer),
  public.earliest_open_day(public.challenges),
  public.last_closed_day(public.challenges),
  public.day_is_open(public.challenges, integer),
  public.get_or_freeze_day(integer),
  public.get_or_freeze_today(),
  public.complete_task(text, integer, integer),
  public.uncomplete_task(text, integer),
  public.seal_day(integer),
  public.get_day_window(),
  public.evaluate_challenge(uuid),
  public.get_squad_status(uuid),
  public.sim_missed_day()
from public, anon, authenticated;

grant execute on function
  public.grace_deadline_hour(),
  public.get_or_freeze_day(integer),
  public.get_or_freeze_today(),
  public.complete_task(text, integer, integer),
  public.uncomplete_task(text, integer),
  public.seal_day(integer),
  public.get_day_window(),
  public.get_squad_status(uuid),
  -- Guarded by require_simulation(), which refuses unless the caller's own
  -- id is in sim_allowed_users — a table that ships empty.
  public.sim_missed_day()
to authenticated;

-- DELIBERATELY NOT GRANTED, for the reasons 0007 gives:
--
--   evaluate_challenge(uuid)   takes a challenge id; a grant would let any
--                              user drive the penalty machinery against
--                              somebody else's run.
--
-- The five clock helpers take a `challenges` ROW rather than an id. They are
-- reachable from inside the SECURITY DEFINER functions that call them, where
-- privilege checks run as the function owner, and are not granted because
-- nothing in the app needs to call them directly — the app reads
-- get_day_window(), which already carries the answers.

commit;

-- =============================================================================
-- 8. THE SCHEDULE — unchanged, and deliberately so.
--
-- 0007 scheduled evaluate_all_challenges() at '5 * * * *' — every hour at
-- :05 — because challenges sit in every timezone and one daily run cannot
-- catch every local midnight. The same job catches every local NOON on the
-- same terms: a day that closes at 12:00 local is judged by 12:05 local at
-- the latest. Nothing to re-schedule.
--
-- Verify on the live project with:
--   select jobname, schedule, command from cron.job;
-- =============================================================================
