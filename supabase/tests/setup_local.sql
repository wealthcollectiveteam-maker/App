-- Local test double for the Supabase runtime: the `authenticated` role,
-- an `auth` schema with users + auth.uid() reading the request JWT claim,
-- and Supabase-style default grants (which the migration then narrows).
-- Run as the postgres superuser on a fresh database BEFORE the migration.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
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

grant usage on schema public to authenticated;
grant usage on schema auth to authenticated;

-- Supabase grants table privileges to `authenticated` by default and relies
-- on RLS + explicit REVOKEs (as our migration does) to narrow them.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
