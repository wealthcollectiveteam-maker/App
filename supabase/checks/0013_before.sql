-- =============================================================================
-- RUN THIS **BEFORE** APPLYING 0013_preference_sync.sql.
--
-- Supabase SQL editor, on dmlgdqufkrtrjgbofpkd, as the owner.
-- It WRITES NOTHING. Pure SELECT. Safe to run as many times as you like.
--
-- WHY A BEFORE-READING EXISTS AT ALL.
--
--   0013's own verification grid is a DETECTOR, and a detector is only worth
--   anything if you read it at a moment when it can still say no. "accounts
--   already stamped: 0 of N" proves something on the day the column is
--   created. Read a week later it proves nothing, because by then a stamp is
--   exactly what you would expect — and a stamped row cannot be told apart
--   from a chosen one afterwards. That is the whole reason prefs_synced_at
--   exists, and it cuts both ways.
--
--   So this file asks the one question that has a knowable answer right now:
--   does the column exist yet? It must not. If it does, something has written
--   to this project that neither of us knows about, and the safe assumption is
--   that a client reached it first.
--
-- HOW TO READ IT. Two rows. Both must say OK. `verdict` is the only column
-- that matters.
--
--   row 1  prefs_synced_at  must be ABSENT
--   row 2  a sanity count of your accounts, so you know what "N" is when you
--          read the AFTER grid and can tell 0 of 11 from 0 of 0
--
-- WHAT TO DO IF EITHER IS NOT OK — and there is only one right answer:
--
--   row 1 says FINDING (the column already exists)
--     STOP. Do not apply 0013. Do not deploy either build. Run
--     supabase/checks/0013_after.sql instead and read its last two rows: if
--     `stamped rows claiming a Health grant` is anything but 0, a pre-fix
--     client has already written to production and the accounts it touched
--     cannot be distinguished from ones that chose. Bring that reading back
--     before doing anything else.
--
--   row 2 shows an account count you do not recognise
--     STOP and say so. It is not dangerous on its own, but you should know
--     what N is before you accept "0 of N" as a pass.
-- =============================================================================

select
  'profile_private.prefs_synced_at must be ABSENT' as item,
  coalesce((
    select format_type(atttypid, atttypmod)
      from pg_attribute
     where attrelid = 'public.profile_private'::regclass
       and attname = 'prefs_synced_at' and not attisdropped
  ), 'absent') as actual,
  case when exists (
    select 1 from pg_attribute
     where attrelid = 'public.profile_private'::regclass
       and attname = 'prefs_synced_at' and not attisdropped
  ) then 'FINDING — STOP, see the header' else 'OK' end as verdict
union all
-- Not a gate, a calibration. "0 of N" is only meaningful once you know N.
select
  'accounts on this project (this is your N)',
  count(*)::text,
  'OK'
from public.profile_private;
