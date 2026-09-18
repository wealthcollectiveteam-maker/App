-- =============================================================================
-- Executable proofs for PREFERENCE SYNC (Phase 17A part 2, fixes #1 and #4).
--
-- Run after setup_local.sql + every migration, as the postgres superuser:
--   psql -v ON_ERROR_STOP=1 -f preference_sync_test.sql
-- Every check raises on failure; a clean exit means all proofs hold.
--
-- WHY THESE, AND NOT A CODE READ.
--
--   Until this phase, units, notification switches, health prompts and the
--   weekly check-in card lived only in the device's AsyncStorage. They are now
--   ACCOUNT state: written by the client, read back on another device. That
--   turns a set of columns nothing had ever touched into a live write surface,
--   and a write surface is where this project has twice found the gap between
--   "the code looks right" and what the database actually permits.
--
--   Two things follow, and both are proved here rather than reasoned about:
--
--     1. The switches are PRIVATE. They sit on profile_private, next to "why
--        I started". A squadmate must not be able to read them and must not be
--        able to write them — and an RLS-filtered UPDATE is not an error, it
--        is a success that touched nothing, so "refused" has to mean the row
--        is unchanged, not that a statement threw.
--
--     2. The unit preference is DELIBERATELY NOT private. It is on `profiles`,
--        which squadmates can already read for name and XP, because knowing
--        someone prefers pounds reveals nothing and it saves a round trip at
--        sign-in. That is a decision, so it is written down as a proof: a
--        squadmate CAN read it, and still cannot change it.
--
--   And one column is deliberately DEAD. `health_enabled` stands for an Apple
--   Health grant, and iOS issues those to a phone, not to an account. A server
--   that recorded one would put an ON switch in front of a device that had
--   never been asked for anything — the same defect as the old client default,
--   arriving by sync. The client therefore writes it pinned `false` and never
--   reads it back, and Proof 2 asserts the value that actually lands.
--
-- Impersonation is the same shape PostgREST uses: `set role authenticated`
-- plus a request.jwt.claims GUC carrying the user's uuid as `sub`, which is
-- what auth.uid() reads. Policies and grants are therefore evaluated exactly
-- as they are for a request arriving with that user's JWT.
-- =============================================================================

\set QUIET on
\pset pager off

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000017a1', 'prefs-ada@test.dev'),
  ('00000000-0000-0000-0000-0000000017a2', 'prefs-ben@test.dev')
on conflict (id) do nothing;

create or replace procedure test_login(p_user uuid)
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
end $$;

-- ---- ADA: a squad, and preferences saved exactly as the client saves them --
set role authenticated;
call test_login('00000000-0000-0000-0000-0000000017a1');

insert into public.profiles (id, name) values (auth.uid(), 'Ada Prefs')
  on conflict (id) do nothing;
select public.create_challenge('hard', current_date, 'UTC');
select public.create_squad('Preference Crew');

-- The invite code, captured while Ada can still read it. The squads policy is
-- member-only, so Ben cannot look his way in — which is the point of an
-- invite code, and is why this is a psql variable rather than a sub-select.
select invite_code as pref_code from public.squads
 where created_by = '00000000-0000-0000-0000-0000000017a1' \gset

-- =====================  PROOF 1 — THE MARKER EXISTS AND STARTS NULL  =======
-- The whole read rule rests on telling a saved choice from a DDL default.
-- Without this column every client would have to guess, and the guess that
-- looks safest — trust the row — is the one that flips an imperial user to
-- metric.
insert into public.profile_private (id, why) values (auth.uid(), 'Because I said I would.')
  on conflict (id) do nothing;

do $$
declare v_marker timestamptz; v_unit text; v_health boolean;
begin
  select prefs_synced_at, health_enabled into v_marker, v_health
    from public.profile_private where id = auth.uid();
  select unit_preference into v_unit from public.profiles where id = auth.uid();
  if v_marker is not null then
    raise exception 'FAIL: a fresh row already claims preferences were saved';
  end if;
  -- The default that disagrees with the app's own, named explicitly so a
  -- future change to it fails here rather than on someone's phone.
  if v_unit <> 'metric' then
    raise exception 'FAIL: profiles.unit_preference no longer defaults to metric (got %)', v_unit;
  end if;
  -- health_enabled is not adopted any more, but false is still the value the
  -- client writes, so a default flipped to true would put this database into
  -- the state 0013's last verification row exists to catch.
  if v_health <> false then
    raise exception 'FAIL: profile_private.health_enabled no longer defaults to false';
  end if;
  raise notice 'PASS 1: an unwritten row is distinguishable — prefs_synced_at is null, and the DDL defaults are metric/health-off';
end $$;

-- =====================  PROOF 2 — THE ROUND TRIP THE CLIENT MAKES  =========
-- Exactly the two statements api.setUnitPreference and api.setPreferences
-- issue, in the order savePreferences() issues them — including the fact that
-- the second one carries ALL NINE preference columns rather than the one that
-- changed. It is an upsert, and a column left out of its INSERT path takes a
-- DDL default the app disagrees with; see lib/serverPrefs.ts.
--
-- health_enabled is `false` here because that is what privateColumnsFor now
-- emits, unconditionally, whatever the device believes. Changing this literal
-- to `true` to "match the device" would be reintroducing the bug.
update public.profiles set unit_preference = 'imperial' where id = auth.uid();

insert into public.profile_private (id,
  notify_pings, notify_squad_activity, notify_daily_reminder, notify_timer_alerts,
  health_enabled, diet_prompt_enabled, workout_prompt_enabled, weight_prefill_enabled,
  weekly_checkin_enabled, prefs_synced_at)
values (auth.uid(), false, true, false, false, false, false, true, true, true, now())
on conflict (id) do update set
  notify_pings           = excluded.notify_pings,
  notify_squad_activity  = excluded.notify_squad_activity,
  notify_daily_reminder  = excluded.notify_daily_reminder,
  notify_timer_alerts    = excluded.notify_timer_alerts,
  health_enabled         = excluded.health_enabled,
  diet_prompt_enabled    = excluded.diet_prompt_enabled,
  workout_prompt_enabled = excluded.workout_prompt_enabled,
  weight_prefill_enabled = excluded.weight_prefill_enabled,
  weekly_checkin_enabled = excluded.weekly_checkin_enabled,
  prefs_synced_at        = excluded.prefs_synced_at;

do $$
declare r record; v_unit text;
begin
  select * into r from public.profile_private where id = auth.uid();
  select unit_preference into v_unit from public.profiles where id = auth.uid();
  if v_unit <> 'imperial' then
    raise exception 'FAIL: the unit preference did not save';
  end if;
  if r.notify_pings <> false or r.notify_timer_alerts <> false then
    raise exception 'FAIL: the notification switches did not save';
  end if;
  if r.prefs_synced_at is null then
    raise exception 'FAIL: saving preferences left the marker null — every other client would still read defaults';
  end if;
  -- The chosen value (diet prompt OFF) survived, rather than the column
  -- default (ON) — which is the whole reason the write carries every
  -- preference column instead of only the one that changed.
  if r.diet_prompt_enabled <> false then
    raise exception 'FAIL: the saved row fell back to the diet_prompt_enabled default';
  end if;
  -- And the dead column stayed dead. A stamped row claiming a Health grant is
  -- the fingerprint of a client built before this fix; 0013's last
  -- verification row looks for exactly this across the whole table.
  if r.health_enabled <> false then
    raise exception 'FAIL: a stamped row claims a Health grant — no fixed client writes that';
  end if;
  -- The upsert names ONLY preference columns, so nothing else on the row may
  -- move. "Why I started" sharing a table with a notification toggle is
  -- exactly the shape that loses someone's answer.
  if r.why <> 'Because I said I would.' then
    raise exception 'FAIL: a notification toggle overwrote "why I started"';
  end if;
  if r.completion_feeling is not null or r.completion_text is not null then
    raise exception 'FAIL: a preference write touched the day-75 reflection';
  end if;
  raise notice 'PASS 2: preferences save whole and are marked as saved; "why" and the reflection are untouched';
end $$;

-- =====================  PROOF 3 — JUNK CANNOT BE STORED  ==================
-- The client only ever sends 'metric' or 'imperial'; the column says so too,
-- so a modified client cannot leave a value no reader knows how to render.
do $$
declare v_bad boolean := false;
begin
  begin
    update public.profiles set unit_preference = 'stones' where id = auth.uid();
    v_bad := true;
  exception when check_violation then null;
  end;
  if v_bad then raise exception 'FAIL: an unknown unit preference was stored'; end if;
  raise notice 'PASS 3: the unit column refuses a value outside metric/imperial';
end $$;

-- ---- BEN: same squad as Ada, and therefore her sanctioned reader ----------
reset role;
set role authenticated;
call test_login('00000000-0000-0000-0000-0000000017a2');
insert into public.profiles (id, name) values (auth.uid(), 'Ben Prefs')
  on conflict (id) do nothing;
select public.create_challenge('hard', current_date, 'UTC');
select public.join_squad(:'pref_code');

-- =====================  PROOF 4 — A SQUADMATE CANNOT READ THE SWITCHES  ====
-- Read as BEN, with his own JWT, so the policy is what answers.
do $$
declare n integer;
begin
  select count(*) into n from public.profile_private
   where id = '00000000-0000-0000-0000-0000000017a1';
  if n <> 0 then
    raise exception 'FAIL: a squadmate can read another member''s preference switches';
  end if;
  raise notice 'PASS 4: a squadmate reads zero rows of another member''s private preferences';
end $$;

-- =====================  PROOF 6a — UNITS ARE READABLE, BY DESIGN  ==========
-- The deliberate asymmetry, and the reason it is written down as a proof
-- rather than left as a comment: profiles is the squad-visible surface, so
-- sign-in reads the unit preference in the same round trip as the name.
do $$
declare v_seen text;
begin
  select unit_preference into v_seen from public.profiles
   where id = '00000000-0000-0000-0000-0000000017a1';
  if v_seen is null then
    raise exception 'FAIL: a squadmate cannot read the unit preference — sign-in expects it alongside the name';
  end if;
  raise notice 'PASS 6a: a squadmate can read the unit preference (%), which carries nothing private', v_seen;
end $$;

-- ---- Ben now tries to CHANGE both of them ---------------------------------
-- TWO SHAPES OF REFUSAL, and they do not look alike, which is exactly why
-- both are exercised:
--
--   UPDATE — RLS's USING clause hides the row, so the statement matches
--            nothing and SUCCEEDS. No error is raised. A client that does not
--            count the affected rows would report a save that never happened.
--   UPSERT — the INSERT path has no row to be hidden, so WITH CHECK refuses
--            it outright with 42501.
--
-- The proof for the first is that Ada's row is unchanged afterwards; the
-- proof for the second is the SQLSTATE.
do $$
declare n integer; v_sqlstate text := 'none';
begin
  update public.profile_private
     set notify_pings = true, health_enabled = true, prefs_synced_at = now()
   where id = '00000000-0000-0000-0000-0000000017a1';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: a squadmate''s UPDATE matched % of another member''s rows', n;
  end if;
  raise notice 'PASS 5a: a squadmate''s UPDATE on another member''s preferences matched 0 rows (no error — the client must count)';

  begin
    insert into public.profile_private (id, notify_pings)
    values ('00000000-0000-0000-0000-0000000017a1', true)
    on conflict (id) do update set notify_pings = excluded.notify_pings;
    raise exception 'FAIL: a squadmate upserted preferences onto another member';
  exception when insufficient_privilege then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
    raise notice 'PASS 5b: the upsert path is refused outright — SQLSTATE %', v_sqlstate;
  end;

  update public.profiles set unit_preference = 'metric'
   where id = '00000000-0000-0000-0000-0000000017a1';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: a squadmate''s UPDATE matched % rows on another member''s profile', n;
  end if;
end $$;

-- =====================  PROOFS 5 AND 6b — NOTHING MOVED  ==================
-- Verified as the superuser, where no policy can hide a change that did land.
reset role;

do $$
declare r record; v_unit text;
begin
  select notify_pings, health_enabled, prefs_synced_at into r
    from public.profile_private where id = '00000000-0000-0000-0000-0000000017a1';
  if r.notify_pings <> false then
    raise exception 'FAIL: a squadmate switched another member''s ping alerts back on';
  end if;
  if r.health_enabled <> false then
    raise exception 'FAIL: a squadmate changed another member''s health column';
  end if;
  raise notice 'PASS 5c: read back as the superuser — the private preferences did not move';

  select unit_preference into v_unit from public.profiles
   where id = '00000000-0000-0000-0000-0000000017a1';
  if v_unit <> 'imperial' then
    raise exception 'FAIL: a squadmate changed another member''s unit preference (now %)', v_unit;
  end if;
  raise notice 'PASS 6b: readable is not writable — the unit preference is still imperial';
end $$;

reset role;

-- =====================  PROOF 7 — NO ACCOUNT CLAIMS A HEALTH GRANT  =======
-- The table-wide invariant, and the same query 0013's last verification row
-- runs. It holds after every write this file made, and it is the one reading
-- that would betray a pre-fix client having touched this database: only a
-- client that still defaults healthEnabled to true can produce a stamped row
-- with health_enabled set.
do $$
declare n integer;
begin
  select count(*) into n from public.profile_private
   where prefs_synced_at is not null and health_enabled;
  if n <> 0 then
    raise exception 'FAIL: % stamped row(s) claim a Health grant — a phone-only permission recorded as account state', n;
  end if;
  raise notice 'PASS 7: no stamped row claims a Health grant — the switch cannot arrive ON on a device that never asked';
end $$;

do $$ begin raise notice ' ALL PREFERENCE-SYNC PROOFS PASSED'; end $$;
