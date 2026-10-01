-- Phase 9 Part 1: display unit preference. kg/cm remain the ONLY canonical
-- storage units everywhere — this column changes presentation, never data.
--
-- GRANTS: none required, and none are added. This migration creates no new
-- table, sequence, or function, so Supabase's default-privilege machinery
-- has nothing new to grant. A table-level GRANT applies to columns added
-- later, so the existing allow-list from 0001 (select/insert/update on
-- public.profiles to `authenticated`, nothing to `anon`) already covers
-- this column exactly as intended. Safe to apply as-is.
--
-- Placement note: unit_preference lives on `profiles` rather than
-- `profile_private` because it is a rendering preference, not personal
-- data — squadmates can already read name and xp here, and knowing someone
-- prefers pounds reveals nothing. Keeping it on `profiles` means the
-- session bootstrap reads it in the same round trip as the display name.
alter table public.profiles
  add column unit_preference text not null default 'metric'
  check (unit_preference in ('metric', 'imperial'));
