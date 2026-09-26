-- =============================================================================
-- Executable proofs for Phase 14: correcting a past weight check-in.
--
-- Run after setup_local.sql + every migration, as the postgres superuser:
--   psql -v ON_ERROR_STOP=1 -f metric_checkins_test.sql
-- Every check raises on failure; a clean exit means all proofs hold.
--
-- Impersonation is the same shape PostgREST uses: `set role authenticated`
-- plus a request.jwt.claims GUC carrying the user's uuid as `sub`, which is
-- what auth.uid() reads. Policies and grants are therefore evaluated exactly
-- as they are for a request arriving with that user's JWT.
--
-- ONE THING THIS FILE MAKES EXPLICIT, because the client depends on it:
-- an UPDATE or DELETE that RLS filters out is NOT an error. USING removes the
-- row from view, the statement matches nothing, and Postgres reports success
-- with zero rows affected. PostgREST passes that through as 200 with an empty
-- body. So "refused" here means the row is untouched and no rows came back —
-- and a client that does not COUNT the returned rows will happily report a
-- success that never happened. See api.updateMetricCheckin.
-- =============================================================================

\set QUIET on
\pset pager off

-- ---- fixtures (as superuser) ----
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000014aa', 'ada-14@test.dev'),
  ('00000000-0000-0000-0000-0000000014bb', 'ben-14@test.dev')
on conflict (id) do nothing;

create or replace procedure test_login(p_user uuid)
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
end $$;

-- =====================  PROOF (a): the 203 kg row, corrected  ==============
-- Reproduces the real defect: a user typed 203 meaning pounds into a field
-- reading kilograms, and 203 kg (447 lb) has been their history ever since.

set role authenticated;
call test_login('00000000-0000-0000-0000-0000000014aa');

insert into public.metric_checkins (owner, weight_kg, mood)
values (auth.uid(), 203.0, 3);

do $$
declare v numeric;
begin
  select weight_kg into v from public.metric_checkins
   where owner = auth.uid() and weight_kg = 203.0;
  if v is null then raise exception 'FAIL: the 203 kg row was not written'; end if;
  raise notice 'BEFORE: metric_checkins.weight_kg = % (the bad row, as it exists today)', v;
end $$;

update public.metric_checkins
   set weight_kg = 92.1
 where owner = auth.uid() and weight_kg = 203.0;

do $$
declare v numeric; n integer;
begin
  select count(*) into n from public.metric_checkins
   where owner = auth.uid() and weight_kg = 203.0;
  if n <> 0 then raise exception 'FAIL: 203 kg row still present'; end if;
  select weight_kg into v from public.metric_checkins
   where owner = auth.uid() and weight_kg = 92.1;
  if v is null then raise exception 'FAIL: the corrected row is not there'; end if;
  raise notice 'AFTER:  metric_checkins.weight_kg = % — read back from the table', v;
  raise notice 'PASS (a): a past check-in can be corrected by its owner';
end $$;

-- =====================  PROOF (b): delete  =================================

insert into public.metric_checkins (owner, weight_kg, mood)
values (auth.uid(), 88.8, 2);

do $$
declare v_id uuid; n integer;
begin
  select id into v_id from public.metric_checkins
   where owner = auth.uid() and weight_kg = 88.8;
  delete from public.metric_checkins where id = v_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: delete affected % rows, expected 1', n; end if;
  -- Proved by querying, not by what any screen said.
  select count(*) into n from public.metric_checkins where id = v_id;
  if n <> 0 then raise exception 'FAIL: the row is still queryable after delete'; end if;
  raise notice 'PASS (b): owner deleted own check-in; select by id now returns 0 rows';
end $$;

-- =====================  PROOF (c): the cross-account surface  ==============

-- Remember Ada's row so Ben can aim at it by id.
create temporary table t14 as
  select id as ada_row from public.metric_checkins
   where owner = '00000000-0000-0000-0000-0000000014aa'::uuid and weight_kg = 92.1;

-- ---- (c1) Ben updates Ada's check-in -------------------------------------
call test_login('00000000-0000-0000-0000-0000000014bb');

do $$
declare n integer;
begin
  update public.metric_checkins set weight_kg = 1.0
   where id = (select ada_row from t14);
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: Ben updated % of Ada''s rows', n;
  end if;
  raise notice 'PASS (c1): Ben UPDATE on Ada''s check-in matched 0 rows (RLS USING hid it; no error is raised — the client must count rows)';
end $$;

-- ---- (c2) Ben deletes Ada's check-in -------------------------------------
do $$
declare n integer;
begin
  delete from public.metric_checkins where id = (select ada_row from t14);
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: Ben deleted % of Ada''s rows', n;
  end if;
  raise notice 'PASS (c2): Ben DELETE on Ada''s check-in matched 0 rows';
end $$;

-- ---- (c4) Ben reads Ada's metrics ----------------------------------------
do $$
declare n integer;
begin
  select count(*) into n from public.metric_checkins
   where owner = '00000000-0000-0000-0000-0000000014aa'::uuid;
  if n <> 0 then raise exception 'FAIL: Ben read % of Ada''s check-ins', n; end if;
  select count(*) into n from public.metric_checkins;
  if n <> 0 then raise exception 'FAIL: Ben sees % check-in rows in total', n; end if;
  raise notice 'PASS (c4): Ben reads 0 rows from metric_checkins — his own and nobody else''s';
end $$;

-- ---- (c3) THE ONE THAT MATTERS -------------------------------------------
-- Ada owns the row and may edit it. Can she hand it to Ben?
--
-- Two independent walls, proved separately, because either alone would be a
-- single point of failure for someone else's private weight history.

call test_login('00000000-0000-0000-0000-0000000014aa');

-- WALL 1 — the PRIVILEGE layer. 0010 grants UPDATE on (weight_kg, mood) only,
-- so `owner` is not a writable column for `authenticated` at all. This fires
-- before RLS is consulted.
do $$
declare
  v_sqlstate text;
  v_message  text;
begin
  begin
    update public.metric_checkins
       set owner = '00000000-0000-0000-0000-0000000014bb'::uuid
     where id = (select ada_row from t14);
    raise exception 'FAIL: Ada reassigned her own row to Ben';
  exception when insufficient_privilege then
    get stacked diagnostics
      v_sqlstate = returned_sqlstate, v_message = message_text;
    raise notice 'PASS (c3, wall 1 — privilege): SQLSTATE % : %', v_sqlstate, v_message;
  end;
end $$;

-- WALL 2 — the POLICY layer, on its own. Widen the grant to table-level
-- UPDATE inside a transaction that is rolled back, so the column grant cannot
-- take the credit, and confirm metrics_all's WITH CHECK still refuses.
-- This is the wall that would be load-bearing if anyone ever "simplified"
-- 0010's column grant to a plain `grant update on public.metric_checkins`.
reset role;
begin;
grant update on public.metric_checkins to authenticated;
set role authenticated;
call test_login('00000000-0000-0000-0000-0000000014aa');

do $$
declare
  v_sqlstate text;
  v_message  text;
begin
  begin
    update public.metric_checkins
       set owner = '00000000-0000-0000-0000-0000000014bb'::uuid
     where id = (select ada_row from t14);
    raise exception
      'FAIL: with a table-level UPDATE grant, Ada reassigned her row to Ben — '
      'metrics_all WITH CHECK is not holding';
  exception when insufficient_privilege then
    get stacked diagnostics
      v_sqlstate = returned_sqlstate, v_message = message_text;
    raise notice 'PASS (c3, wall 2 — policy): SQLSTATE % : %', v_sqlstate, v_message;
  end;
end $$;

-- Same widened grant: an ordinary correction still works, so wall 2 is
-- refusing the owner change specifically and not merely refusing everything.
do $$
declare n integer;
begin
  update public.metric_checkins set weight_kg = 92.2
   where id = (select ada_row from t14);
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: the control update affected % rows, expected 1', n;
  end if;
  raise notice 'PASS (c3, control): the same statement without the owner change updates 1 row';
end $$;

reset role;
rollback;  -- takes the table-level grant back out

-- The rollback must have restored the sanctioned grant shape exactly.
do $$
begin
  if has_table_privilege('authenticated', 'public.metric_checkins', 'UPDATE') then
    raise exception 'FAIL: table-level UPDATE survived the rollback';
  end if;
  if not has_column_privilege('authenticated', 'public.metric_checkins', 'weight_kg', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.metric_checkins', 'mood', 'UPDATE') then
    raise exception 'FAIL: the column grants did not survive the rollback';
  end if;
  if has_column_privilege('authenticated', 'public.metric_checkins', 'owner', 'UPDATE') then
    raise exception 'FAIL: owner is writable';
  end if;
  raise notice 'PASS: grant shape after rollback — UPDATE on (weight_kg, mood) only, owner unwritable';
end $$;

reset role;

do $$ begin raise notice ' ALL PHASE 14 PROOFS PASSED'; end $$;
