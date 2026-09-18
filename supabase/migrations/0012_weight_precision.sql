-- =============================================================================
-- 0012 — WEIGHT PRECISION. numeric(5,1) -> numeric(6,2).
--
-- THE BUG, in one line: 0.1 lb is 0.045 kg, so a kilogram column with ONE
-- decimal place is coarser than the pounds field displaying it.
--
--   type 203.4 lb  ->  92.2606... kg  ->  stored 92.3  ->  read back 203.5 lb
--
-- The user typed one number and was shown another, on their own history
-- screen, with nothing anywhere reporting a problem. Kilograms are canonical
-- and pounds are a display conversion, so the column has to be fine enough to
-- survive a round trip through EITHER unit — not just the one it is stored in.
--
-- WHY TWO DECIMAL PLACES, derived rather than picked:
--
--   A scale-s kg column introduces at most 0.5 * 10^-s kg of rounding error.
--   In pounds that is (0.5 * 10^-s) / 0.45359237.
--   A one-decimal-place display absorbs anything under 0.05 lb.
--
--     scale 1:  0.0500 kg = 0.1102 lb   TOO COARSE  (2.2x the tolerance)
--     scale 2:  0.0050 kg = 0.0110 lb   fits, with 4.5x margin
--     scale 3:  0.0005 kg = 0.0011 lb   fits, with 45x margin
--
--   Scale 2 is the first that works and it is also the one that means
--   something to a person: hundredths of a kilogram, ten grams. Scale 3 would
--   buy margin against a tolerance that is not going to move — the display is
--   one decimal place because that is what a bathroom scale reads.
--
-- PRECISION 6, so the range is 0.00 - 9999.99 kg. The plausibility guard in
-- lib/units.ts refuses anything outside 30-300 kg long before it gets here;
-- the extra digit is headroom, not a policy.
--
-- EXISTING ROWS DO NOT MOVE. Widening a numeric's scale is value-preserving:
-- 92.1 becomes 92.10, which is the same number. Postgres rewrites the column
-- in place and no value is re-rounded. Proved in weight_precision_test.sql
-- rather than asserted here.
--
-- APPLY ORDER: after 0011.
-- =============================================================================

begin;

-- Capture what is there, so the notice at the bottom can say whether anything
-- changed rather than hoping it did not.
create temp table if not exists w0012_before on commit drop as
  select id, weight_kg from public.metric_checkins where weight_kg is not null;

alter table public.metric_checkins
  alter column weight_kg type numeric(6,2);

-- Nothing may have moved. A widening that silently re-rounded somebody's
-- history would be a worse bug than the one this fixes.
do $$
declare v_moved integer;
begin
  select count(*) into v_moved
  from w0012_before b
  join public.metric_checkins m on m.id = b.id
  where m.weight_kg is distinct from b.weight_kg;

  if v_moved > 0 then
    raise exception '0012: % existing weight(s) changed value. Rolled back.', v_moved;
  end if;
  raise notice '0012: weight_kg is numeric(6,2); % existing row(s), none moved',
    (select count(*) from w0012_before);
end $$;

-- ---------------------------------------------------------------------------
-- GRANTS. ALTER COLUMN TYPE keeps column privileges, but this file follows the
-- 0002 allow-list pattern rather than relying on that: revoke, then grant back
-- exactly what is sanctioned. 0010's reasoning is unchanged — UPDATE is
-- COLUMN-level so `owner` and `id` stay unwritable even if the metrics_all
-- policy is ever weakened.
-- ---------------------------------------------------------------------------
revoke all on public.metric_checkins from public, anon, authenticated;
grant select, insert, delete on public.metric_checkins to authenticated;
grant update (weight_kg, mood) on public.metric_checkins to authenticated;

do $$
declare v_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into v_type
  from pg_attribute a
  where a.attrelid = 'public.metric_checkins'::regclass
    and a.attname = 'weight_kg'
    and not a.attisdropped;
  if v_type <> 'numeric(6,2)' then
    raise exception '0012: weight_kg is %, expected numeric(6,2)', v_type;
  end if;
  raise notice '0012: weight_kg confirmed %, grants re-applied (UPDATE on weight_kg, mood only)',
    v_type;
end $$;

commit;
