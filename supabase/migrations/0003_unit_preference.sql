-- Phase 9 Part 1: display unit preference. kg/cm remain the ONLY canonical
-- storage units everywhere — this column changes presentation, never data.
alter table public.profiles
  add column unit_preference text not null default 'metric'
  check (unit_preference in ('metric', 'imperial'));
