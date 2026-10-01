-- Local test double for the Supabase runtime. CRITICAL FIDELITY NOTE:
-- Supabase grants default privileges on new public-schema objects to
-- `anon`, `authenticated` AND `service_role` — tables (ALL), functions
-- (EXECUTE), sequences (USAGE/ALL). An earlier version of this stub only
-- granted defaults to `authenticated`, which let a missing anon-revoke in
-- the migration pass the test suite while the real database still carried
-- anon grants. This stub now reproduces the real default-grant shape so
-- the privilege-surface proofs test the same database Supabase provisions.
-- Run as the postgres superuser on a fresh database BEFORE the migration.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text unique
);

-- Supabase resolves auth.uid() from the request JWT; locally we read the
-- same GUC that PostgREST would set.
create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase's actual default privileges for the public schema: ALL on
-- tables/sequences and EXECUTE on functions, to all three client roles.
-- The migration must claw these back explicitly — that is what the
-- privilege-surface proofs assert.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
