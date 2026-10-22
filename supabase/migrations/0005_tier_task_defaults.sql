-- =============================================================================
-- 0005 — tier defaults differ in SUBSTANCE, not just in count.
--
-- Before this, the three tiers ran the same tasks at the same targets and
-- differed only in how many of them there were. They now differ the way the
-- real variants of this challenge differ — in what each task demands.
--
-- WHAT THIS DOES AND DOES NOT TOUCH
--
--   challenge_days.task_snapshot is NOT touched. Every day already frozen —
--   today included — keeps exactly the task set it recorded, with the
--   targets and names in force when it froze. Nothing changes underneath an
--   active challenge today; the new defaults are what the NEXT day inherits
--   when compose_task_set() runs at rollover.
--
--   completions, workout_logs and every other historical row are untouched:
--   they key on task_key, and no task_key is renamed here.
--
-- DESCRIPTORS live in the app (src/constants/tiers.ts), not here, for the
-- same reason labels do: they are copy, and copy in the database goes stale
-- the moment the wording changes. short_name is the one naming field the
-- snapshot needs, because the label is rendered from it.
-- =============================================================================

begin;

-- ---------- HARD — the traditional 75 Hard. Task set unchanged. ----------
-- Only the diet row's short_name changes: the label is now rendered from it
-- rather than hardcoded per key, so it has to carry the displayed wording.
update public.tier_standards set short_name = 'Follow the diet'
  where tier = 'hard' and task_key = 'diet';

-- ---------- MEDIUM — serious, sustainable. ----------
-- Gains a second, lighter movement task; drops the daily progress photo;
-- counts water in litres.
insert into public.tier_standards
  (tier, task_key, short_name, unit, standard_value, proof, sort)
values
  ('medium','workout2','Move again','minutes',30,true,2)
on conflict (tier, task_key) do update set
  short_name = excluded.short_name,
  unit = excluded.unit,
  standard_value = excluded.standard_value,
  proof = excluded.proof,
  sort = excluded.sort;

update public.tier_standards set unit = 'litres', standard_value = 3, sort = 3
  where tier = 'medium' and task_key = 'water';
update public.tier_standards set sort = 4
  where tier = 'medium' and task_key = 'read';
update public.tier_standards set short_name = 'Follow the diet', sort = 5
  where tier = 'medium' and task_key = 'diet';
delete from public.tier_standards
  where tier = 'medium' and task_key = 'photo';

-- ---------- SOFT — real, but survivable alongside a life. ----------
update public.tier_standards set unit = 'litres', standard_value = 3
  where tier = 'soft' and task_key = 'water';
update public.tier_standards set short_name = 'Eat well'
  where tier = 'soft' and task_key = 'diet';

-- ---------- overrides that no longer mean what they meant ----------
-- A water override is a bare integer; its unit comes from the tier. Medium
-- and Soft now count litres, so a stored "2" that meant 2 GALLONS would
-- silently become 2 litres — a target cut by three quarters that the user
-- never asked for. Drop those rows so those challenges land on the new
-- standard (3 litres) and can re-edit it deliberately.
delete from public.target_overrides o
  using public.challenges c
  where o.challenge_id = c.id
    and o.task_key = 'water'
    and c.base_tier in ('medium','soft');

-- The same override, for a challenge whose CURRENT tier is medium or soft
-- through a tier change rather than at creation.
delete from public.target_overrides o
  where o.task_key = 'water'
    and exists (
      select 1 from public.tier_history h
      where h.challenge_id = o.challenge_id
        and h.tier in ('medium','soft')
        and h.from_day = (
          select max(h2.from_day) from public.tier_history h2
          where h2.challenge_id = o.challenge_id
        )
    );

commit;
