-- =============================================================================
-- RUN THIS **AFTER** APPLYING 0013_preference_sync.sql, and again any time you
-- want to know whether a bad client has touched production.
--
-- Supabase SQL editor, on dmlgdqufkrtrjgbofpkd, as the owner.
-- It WRITES NOTHING. Pure SELECT. Safe to run as many times as you like.
--
-- This is the same four-row grid 0013 prints at the end of its own run, split
-- out so it is re-runnable without re-applying a migration. Applying 0013
-- twice is harmless (`add column if not exists`), but a check you are afraid
-- to re-run is a check you will not re-run.
--
-- HOW TO READ IT. Four rows. All four must say OK.
--
--   1  the column exists, and is timestamptz
--   2  every column the client writes is present (10 of 10) — a half-applied
--      0004 would make the preference upsert fail at runtime and nothing else
--      in the project checks for it
--   3  accounts already stamped — expect `0 of N`, with the N you read in
--      0013_before.sql
--   4  stamped rows claiming a Health grant — expect `0`, now and forever
--
-- WHAT TO DO IF ANY IS NOT OK:
--
--   row 1 FINDING   0013 did not apply. Re-run it. Nothing has been deployed
--                   yet, so nothing is at risk; do not deploy until it is OK.
--
--   row 2 FINDING   0003/0004 are not fully applied on this project. STOP.
--                   Do not deploy: every settings toggle would raise "That
--                   change didn't save". Report which count you got.
--
--   row 3 FINDING   (anything other than 0 of N, read IMMEDIATELY after
--                   applying 0013)
--                   A client has already seeded preferences. Before this file
--                   is applied the only client that can do that is one running
--                   the pre-fix default. STOP, do not deploy, and read row 4.
--
--                   Read LATER — after the fixed web build is live — a
--                   non-zero count here is expected and correct: it is your
--                   friends' clients recording real preferences. Row 3 is a
--                   gate on day one and an informational count thereafter.
--                   Row 4 is the one that stays a gate forever.
--
--   row 4 FINDING   THE SERIOUS ONE, at any time. A stamped row whose
--                   health_enabled is true cannot come from a fixed client —
--                   it pins that column false on every write. So a non-zero
--                   reading means a pre-fix build reached production, and the
--                   accounts it touched now carry an Apple Health grant claim
--                   nobody consented to. STOP. Do not deploy anything further.
--                   Bring the reading and the row ids back before acting: the
--                   repair is not simply setting the column false, because
--                   whatever else that client stamped is equally suspect.
-- =============================================================================

select
  'profile_private.prefs_synced_at' as item,
  coalesce((
    select format_type(atttypid, atttypmod)
      from pg_attribute
     where attrelid = 'public.profile_private'::regclass
       and attname = 'prefs_synced_at' and not attisdropped
  ), 'ABSENT') as actual,
  case when exists (
    select 1 from pg_attribute
     where attrelid = 'public.profile_private'::regclass
       and attname = 'prefs_synced_at' and not attisdropped
  ) then 'OK' else 'FINDING' end as verdict
union all
select
  'columns the client writes',
  count(*)::text || ' of 10',
  case when count(*) = 10 then 'OK' else 'FINDING' end
from (
  select 1 from pg_attribute
   where attrelid = 'public.profiles'::regclass
     and attname = 'unit_preference' and not attisdropped
  union all
  select 1 from pg_attribute
   where attrelid = 'public.profile_private'::regclass
     and attname in ('health_enabled', 'diet_prompt_enabled',
                     'workout_prompt_enabled', 'weight_prefill_enabled',
                     'notify_timer_alerts', 'notify_pings',
                     'notify_squad_activity', 'notify_daily_reminder',
                     'weekly_checkin_enabled')
     and not attisdropped
) cols
union all
select
  'accounts already stamped (expect 0 of N on day one)',
  count(*) filter (where prefs_synced_at is not null)::text
    || ' of ' || count(*)::text,
  case when count(*) filter (where prefs_synced_at is not null) = 0
       then 'OK' else 'FINDING' end
from public.profile_private
union all
select
  'stamped rows claiming a Health grant (expect 0, always)',
  count(*)::text,
  case when count(*) = 0 then 'OK' else 'FINDING' end
from public.profile_private
where prefs_synced_at is not null and health_enabled;
