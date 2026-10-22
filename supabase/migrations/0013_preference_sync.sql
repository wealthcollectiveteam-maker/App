-- =============================================================================
-- Phase 17A part 2, fixes #1 and #4: PREFERENCES BECOME ACCOUNT STATE.
--
-- ASSUMED STARTING STATE (rule 6): 0003 and 0004 are fully applied, so
-- profiles.unit_preference and the nine preference columns on
-- profile_private (health_*, notify_*, weekly_checkin_enabled) all exist.
-- This file adds ONE nullable column and nothing else.
--
-- WHY ONE COLUMN IS THE WHOLE MIGRATION.
--
--   Every column these fixes need already exists — and every one of them has
--   been written by nothing, ever. The app kept all of it in AsyncStorage, so
--   a friend moving from the web build to the native build arrives with the
--   DDL defaults.
--
--   The missing piece is not storage. It is knowing whether what sits in
--   those columns is A CHOICE or A DEFAULT, because the two are
--   indistinguishable without this column:
--
--     profiles.unit_preference          default 'metric'
--
--   The app's own default differs (units are locale-derived). A native build
--   that adopted the server row wholesale would flip an imperial user to
--   metric — reverting a choice nobody made, which is the exact failure
--   fixes #1 and #4 exist to prevent, only pointing the other way.
--
--   prefs_synced_at is the discriminator. NULL means "this account has never
--   recorded a preference; those columns hold DDL defaults, not decisions" —
--   and the client keeps its own state and seeds the server from it. Non-null
--   means they are choices, and the client adopts them.
--
-- -----------------------------------------------------------------------------
-- health_enabled IS NOT SYNCED, AND THAT IS DECIDED HERE, BEFORE THIS FILE IS
-- APPLIED ANYWHERE.
--
--   The seed path above is what forces it. On first reconcile the client
--   writes ITS OWN state into every preference column and stamps
--   prefs_synced_at. Until the fix that accompanies this file, the client's
--   health_enabled default was `true` — set by nothing but the app's own
--   defaults — while requestAuthorization was called from exactly one place:
--   the Health switch going ON. On a fresh install that switch was already
--   on, so nothing ever asked, no grant ever existed, every reading came back
--   null, and the card drew those nulls as zeroes.
--
--   Had this file been applied under that client, the FIRST sync of every
--   account would have written:
--
--     health_enabled = true,  prefs_synced_at = now()
--
--   A recorded choice nobody made, with no permission behind it, and
--   permanent: from the next read onward `synced` is true, so every later
--   device adopts `true` and shows an ON switch on a phone that has never
--   been asked for anything. That is not defensible, and it is not fixable
--   afterwards — once stamped, nothing distinguishes a seeded `true` from a
--   chosen one.
--
--   The client-side default is now false. But a false default alone would
--   only make the seed harmless TODAY. health_enabled is a claim about an
--   APPLE HEALTH GRANT, and a grant is issued by iOS to one phone. It cannot
--   travel with an account. Even a genuine `true`, chosen on an old iPhone,
--   is wrong on a new one: the new phone has never asked, so adopting it
--   reproduces the identical defect by sync instead of by default.
--
--   So the account does not record it at all. The client no longer reads this
--   column, and writes it pinned to `false` (lib/serverPrefs.ts,
--   privateColumnsFor), so it can never drift into a claim the server has no
--   business making. The three PROMPT preferences — diet, workout, weight
--   pre-fill — are tastes, they do belong to the person, and they still sync.
--   A new device starts NOT CONNECTED, shows a Connect prompt, and the tap
--   that turns it on is the tap that presents the permission sheet.
--
--   WHAT THIS DOES *NOT* MEAN. It is not a reason to deploy the client before
--   applying this file. The client that is live today writes no preference to
--   the server at all — savePreferences and reconcilePreferences do not exist
--   in it — so this migration is inert to it, and applying this file first
--   costs nobody anything. Deploying the client first is what costs: without
--   this column every switch write is refused and every live user gets "That
--   change didn't save" on every toggle. APPLY FIRST, DEPLOY SECOND.
--
--   The real hazard is an ARTIFACT, not an order. A build made PARTWAY through
--   this phase — after preference sync was wired up, before health_enabled was
--   taken out of it — defaults healthEnabled to true and writes it from the
--   device. One of those is sitting in the repo's `dist/` (buildId
--   cfaab51c...). Deploying it against a database where this column exists is
--   the one thing that stamps a Health grant nobody consented to. Rebuild
--   `dist/` before any Pages copy; the pre-flight rows at the foot of this
--   file are how you would catch it having happened, which is why they return
--   a verdict rather than an INFO count.
--
-- ORDER OF APPLICATION. Apply this BEFORE deploying either build, and see the
-- section above for why that is safe as well as necessary. A client that
-- writes prefs_synced_at to a database without the column gets a PostgREST
-- error on every preference toggle: the setting would still hold on that
-- device, but it would raise "That change didn't save" every time — including
-- once per sign-in, from the seed.
--
-- GRANTS: none required, and none are added — the same reasoning 0003 sets
-- out, and the reason there is no revoke/grant pair here at all (rule 1).
-- This file creates no table, sequence or function, and a table-level GRANT
-- covers columns added later, so 0001's allow-list (select/insert/update on
-- public.profile_private to `authenticated`, nothing to `anon`) already
-- covers this column exactly as intended.
--
-- RLS is unchanged. profile_private is owner-only under profile_private_all,
-- so no squadmate can read or write this column any more than they can read
-- "why I started".
--
-- PRIVACY: a timestamp saying "this account has saved settings at least
-- once". No health data, no metric, no content. It lives on profile_private
-- rather than profiles because nothing outside the owner has any business
-- reading it.
-- =============================================================================

alter table public.profile_private
  add column if not exists prefs_synced_at timestamptz;

comment on column public.profile_private.prefs_synced_at is
  'Set the first time this account saves any preference. NULL means the '
  'preference columns hold DDL defaults, not user choices, and a client must '
  'not adopt them over its own state. Does NOT vouch for health_enabled, '
  'which is not synced.';

-- Not a schema change: the column keeps its type, default and grants. This
-- records, where the next person reading the schema will find it, that the
-- column is deliberately dead. An Apple Health grant belongs to a phone, not
-- to an account, and a server that claimed one would put an ON switch in
-- front of a device that has never been asked.
comment on column public.profile_private.health_enabled is
  'DEVICE-LOCAL, NOT SYNCED. An Apple Health grant is issued by iOS to one '
  'phone and cannot travel with an account. The client neither reads this '
  'column nor derives anything from it, and writes it pinned false. Do not '
  'start adopting it.';

-- ---------- verification (rule 5): read this grid, do not trust a RAISE -----
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
-- The columns this fix WRITES. Present since 0003/0004; listed because a
-- half-applied 0004 would make the client's preference write fail at runtime
-- and there is no other file that checks for it. health_enabled is counted
-- here too: it is no longer adopted, but it is still WRITTEN (pinned false),
-- so a missing column would still fail the upsert.
select
  'columns fixes #1/#4 write',
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
-- PRE-FLIGHT, not trivia. On first application nobody has synced yet: every
-- existing account keeps its settings on its own device until it next touches
-- a switch. Anything but zero means a client has already seeded this database,
-- and before this file is applied the only client that could have done so is
-- one running the old default — so whatever health_enabled it wrote is a value
-- nobody chose. Investigate before deploying either build.
select
  'accounts already stamped (expect 0 of N)',
  count(*) filter (where prefs_synced_at is not null)::text
    || ' of ' || count(*)::text,
  case when count(*) filter (where prefs_synced_at is not null) = 0
       then 'OK' else 'FINDING' end
from public.profile_private
union all
-- The old-client fingerprint, and the row worth keeping forever: a stamped
-- row whose health_enabled is true cannot have come from a fixed client,
-- which pins that column false on every write. Zero is the only acceptable
-- reading, before deployment and after it.
select
  'stamped rows claiming a Health grant',
  count(*)::text,
  case when count(*) = 0 then 'OK' else 'FINDING' end
from public.profile_private
where prefs_synced_at is not null and health_enabled;
