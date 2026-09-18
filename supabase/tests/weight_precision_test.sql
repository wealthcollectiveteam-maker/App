-- =============================================================================
-- Executable proofs for the weight column's precision (0012).
--
-- Run after setup_local.sql + every migration, as the postgres superuser.
--
-- WHAT THESE PROVE, and why they are at the DATABASE and not in Node:
--   scripts/units.test.mjs proves the arithmetic. It cannot prove what the
--   COLUMN does to the number, and the column is where the value was being
--   lost. The conversion constant is repeated here on purpose — if the two
--   ever disagree, that is a finding, not a duplication.
--
-- Every check raises on failure.
-- =============================================================================

\set QUIET on
\pset pager off

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000c0f1', 'weight@test.dev')
on conflict do nothing;

-- The exact international avoirdupois pound, the same constant lib/units.ts
-- holds. Nothing else in this file converts.
create or replace function t_lb_to_kg(p_lb numeric) returns numeric
language sql immutable as $$ select p_lb * 0.45359237 $$;
create or replace function t_kg_to_lb(p_kg numeric) returns numeric
language sql immutable as $$ select p_kg / 0.45359237 $$;

-- What the app shows: one decimal place, in the preferred unit.
create or replace function t_show_lb(p_kg numeric) returns text
language sql immutable as $$ select to_char(round(t_kg_to_lb(p_kg), 1), 'FM9999990.0') $$;
create or replace function t_show_kg(p_kg numeric) returns text
language sql immutable as $$ select to_char(round(p_kg, 1), 'FM9999990.0') $$;

-- =============================================================================
-- PROOF 1 — the column is what 0012 says it is
-- =============================================================================
do $$
declare v_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into v_type
  from pg_attribute a
  where a.attrelid = 'public.metric_checkins'::regclass
    and a.attname = 'weight_kg' and not a.attisdropped;
  if v_type <> 'numeric(6,2)' then
    raise exception 'FAIL: weight_kg is %, expected numeric(6,2)', v_type;
  end if;
  raise notice 'PASS: weight_kg is numeric(6,2)';
end $$;

-- =============================================================================
-- PROOF 2 (b) — a decimal entered in POUNDS survives the column
--
-- The client converts once at full precision and sends kg. The column rounds.
-- The app reads back and formats to one decimal in pounds. That last number
-- must be the one that was typed.
-- =============================================================================
do $$
declare
  v_uid  uuid := '00000000-0000-0000-0000-00000000c0f1';
  v_lb   numeric;
  v_id   uuid;
  v_kg   numeric;
  v_back text;
  v_old  text;
  v_broke integer := 0;
begin
  foreach v_lb in array array[203.4, 187.7, 154.3, 165.1, 199.5, 178.6, 220.9]
  loop
    insert into public.metric_checkins (owner, weight_kg, mood)
    values (v_uid, t_lb_to_kg(v_lb), 3)
    returning id into v_id;

    -- Straight from Postgres, not from anything that cached it.
    select weight_kg into v_kg from public.metric_checkins where id = v_id;
    v_back := t_show_lb(v_kg);

    if v_back <> to_char(v_lb, 'FM9999990.0') then
      raise exception 'FAIL: % lb stored as % kg and read back as % lb',
        v_lb, v_kg, v_back;
    end if;

    -- What the OLD column would have done to the same value. Not a hypothesis:
    -- round(x, 1) is exactly what numeric(5,1) applied on the way in.
    v_old := t_show_lb(round(t_lb_to_kg(v_lb), 1));
    if v_old <> to_char(v_lb, 'FM9999990.0') then
      v_broke := v_broke + 1;
      raise notice '  numeric(5,1) would have turned % lb into % lb (stored %)',
        v_lb, v_old, round(t_lb_to_kg(v_lb), 1);
    end if;
  end loop;

  if v_broke = 0 then
    raise exception 'FAIL: none of these values exercised the old defect — '
      'the proof would pass against the unfixed column';
  end if;
  raise notice 'PASS (b): 7 pound values round-trip exactly; % of them moved under numeric(5,1)',
    v_broke;
end $$;

-- =============================================================================
-- PROOF 3 (c) — the same in KILOGRAMS
-- =============================================================================
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-00000000c0f1';
  v_kg  numeric;
  v_id  uuid;
  v_got numeric;
begin
  foreach v_kg in array array[92.1, 70.3, 85.7, 100.9, 61.5, 113.4, 79.8]
  loop
    insert into public.metric_checkins (owner, weight_kg, mood)
    values (v_uid, v_kg, 4) returning id into v_id;
    select weight_kg into v_got from public.metric_checkins where id = v_id;

    if t_show_kg(v_got) <> to_char(v_kg, 'FM9999990.0') then
      raise exception 'FAIL: % kg read back as %', v_kg, t_show_kg(v_got);
    end if;
    -- And the stored number is the typed one, not merely one that displays
    -- the same: 92.1 is stored as 92.10, which IS 92.1.
    if v_got <> v_kg then
      raise exception 'FAIL: % kg is stored as %', v_kg, v_got;
    end if;
  end loop;
  raise notice 'PASS (c): 7 kilogram values store and read back identically';
end $$;

-- =============================================================================
-- PROOF 4 (e) — a row written under numeric(5,1) does not move
--
-- The migration has already run by the time this file executes, so the old
-- shape is reproduced on a scratch table and put through the same ALTER.
-- The history starts at 92.1 kg and must still be 92.1 kg afterwards.
-- =============================================================================
do $$
declare v_moved integer;
begin
  create temp table w_legacy (id int, weight_kg numeric(5,1));
  insert into w_legacy values
    (1, 92.1), (2, 70.3), (3, 85.7), (4, 100.0), (5, 61.5), (6, 113.4);
  create temp table w_snapshot as select id, weight_kg::text as v from w_legacy;

  alter table w_legacy alter column weight_kg type numeric(6,2);

  select count(*) into v_moved
  from w_legacy l join w_snapshot s on s.id = l.id
  where l.weight_kg <> s.v::numeric;
  if v_moved > 0 then
    raise exception 'FAIL: % legacy value(s) moved through the widening', v_moved;
  end if;

  if (select weight_kg from w_legacy where id = 1) <> 92.1 then
    raise exception 'FAIL: the first history entry is no longer 92.1';
  end if;
  -- 92.1 becomes 92.10 in TEXT. Same number, and the app formats to one
  -- decimal on the way out, so the display is unchanged too.
  if (select t_show_kg(weight_kg) from w_legacy where id = 1) <> '92.1' then
    raise exception 'FAIL: 92.1 no longer displays as 92.1';
  end if;
  if (select t_show_kg(weight_kg) from w_legacy where id = 4) <> '100.0' then
    raise exception 'FAIL: a whole number lost its decimal place on display';
  end if;

  drop table w_legacy;
  drop table w_snapshot;
  raise notice 'PASS (e): every legacy value survives the widening unchanged, 92.1 included';
end $$;

-- =============================================================================
-- PROOF 5 — the privilege shape 0010 established is still exactly that
-- =============================================================================
do $$
declare c record;
begin
  if has_table_privilege('anon', 'public.metric_checkins', 'SELECT') then
    raise exception 'FAIL: anon can read metric_checkins';
  end if;
  if has_table_privilege('authenticated', 'public.metric_checkins', 'UPDATE') then
    raise exception 'FAIL: authenticated holds table-level UPDATE again';
  end if;
  for c in
    select attname from pg_attribute
    where attrelid = 'public.metric_checkins'::regclass
      and attnum > 0 and not attisdropped
  loop
    if has_column_privilege('authenticated', 'public.metric_checkins', c.attname, 'UPDATE')
       <> (c.attname in ('weight_kg', 'mood')) then
      raise exception 'FAIL: UPDATE grant wrong on metric_checkins.%', c.attname;
    end if;
  end loop;
  raise notice 'PASS: UPDATE is still (weight_kg, mood) only — owner and id unwritable';
end $$;

do $$ begin raise notice ' ALL WEIGHT-PRECISION PROOFS PASSED'; end $$;
