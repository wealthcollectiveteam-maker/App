# How to write a migration that is actually correct here

Written after `0012_weight_precision.sql` failed halfway through in production
and left the database in a state its own file said was impossible.

## What went wrong, precisely

`0012` opened with `begin;`, created a temp table, altered a column, then read
the temp table back to prove nothing had moved. In `psql` that is one
transaction and the proof is real. In the **Supabase SQL editor it is not**.
The run failed with:

```
ERROR: 42P01: relation "w0012_before" does not exist
```

and **did not roll back**. The `ALTER` had already committed. The temp table —
declared `on commit drop` — had already been dropped, because the statement
that created it had already committed too. Everything after the failure never
ran.

Two things follow, and both are load-bearing:

1. **The editor does not hold one transaction across a script.** Statements
   commit as they go. `begin;` did not make the file atomic; it only made the
   file *claim* to be atomic.
2. **Temp tables do not survive between statements.** Whatever a migration
   stashes in one statement is gone by the next.

The comment in `0012` promising it "rolls itself back if any value moved" was
fiction in the only runner this database is ever migrated with. That is worse
than having no guard at all: a guard nobody believes gets checked, and a guard
everybody believes does not.

## The rules

### 1. Assume every statement commits on its own

Write the file so that stopping after **any** statement leaves the database in
a state that is correct, or at least obviously incomplete. Never write a
sequence where statement *N* is only safe because statement *N+1* follows it.

The sharpest example is in `0012` itself, and it is luck that it did not bite:

```sql
revoke all on public.metric_checkins from public, anon, authenticated;
grant  select, insert, delete on public.metric_checkins to authenticated;
grant  update (weight_kg, mood) on public.metric_checkins to authenticated;
```

Had the failure landed one statement later, the `revoke` would have committed
on its own and the app would have lost all access to that table, with no
rollback and no second statement coming to fix it. **Never revoke-then-regrant
in a file that can stop between the two.** Grant what is missing; revoke only
what is genuinely surplus, in its own file, checked first.

### 2. No `begin;` / `commit;`

It buys nothing in the editor and it lies to the next reader. If a group of
changes genuinely must be all-or-nothing, put them in a single `DO $$ ... $$`
block — **one statement is one transaction**, so a `raise` inside it discards
everything it did. That is the only atomicity available here, and it is real.

### 3. No temp tables

They do not survive to the next statement. If you need a before/after
comparison, either compute it inside one `DO` block, or write the "before" to
a real table you create and drop deliberately — and accept that the drop is
its own statement that might not run.

### 4. Every statement independently re-runnable

Running the file twice must be a no-op, not an error. That is what makes
"finish the half-applied migration" a safe operation instead of a gamble.

```sql
create table if not exists ...
create index if not exists ...
alter table ... add column if not exists ...
drop policy if exists x on t;  create policy x on t ...;
create or replace function ...
insert ... on conflict do nothing / do update
```

For anything with no `IF NOT EXISTS` form (`ALTER COLUMN TYPE`, constraints,
grants on objects that may not exist yet), guard it explicitly:

```sql
do $$
begin
  if (select format_type(atttypid, atttypmod)
      from pg_attribute
      where attrelid = 'public.metric_checkins'::regclass
        and attname = 'weight_kg' and not attisdropped) <> 'numeric(6,2)'
  then
    alter table public.metric_checkins alter column weight_kg type numeric(6,2);
    raise notice 'widened weight_kg';
  else
    raise notice 'weight_kg already numeric(6,2) — nothing to do';
  end if;
end $$;
```

### 5. Verify with a `SELECT` you read, not a `RAISE` that pretends to protect you

An assertion at the bottom of a non-atomic file cannot undo the statements
above it. By the time it fires, the damage is committed. It reads like a
safety net and is a smoke alarm in an empty house.

So: **end every migration with a verification `SELECT`** that returns one row
per thing that should now be true, with a `verdict` column, and read it.

```sql
select 'weight_kg type' as item,
       format_type(atttypid, atttypmod) as actual,
       case when format_type(atttypid, atttypmod) = 'numeric(6,2)'
            then 'OK' else 'FINDING' end as verdict
from pg_attribute
where attrelid = 'public.metric_checkins'::regclass
  and attname = 'weight_kg' and not attisdropped;
```

`RAISE NOTICE` is fine for narration. It is not a check — the Supabase editor
does not reliably surface notices, which is a second reason the `0012` guard
would have been useless even if it had run.

Note the editor shows the result of the **last** statement only. Either make
the verification the last statement, or fold the whole report into one
`SELECT` with `union all` and a `section` column (see
`0012b_weight_precision_finish.sql` and `../repair/phase16b_audit_production.sql`).

### 6. Make a partial application obvious rather than silent

Two habits:

- **State the assumed starting state in the header.** Not what the migration
  does — what must already be true before it runs. `0012b` is the model.
- **Give the file a fingerprint the verification `SELECT` checks.** If a
  migration creates or alters more than one object, the final query should
  list every one of them. A half-applied file then shows as a grid with some
  rows `OK` and some `FINDING`, which is exactly the information needed to
  write the follow-up.

### 7. Numbering and follow-ups

Numbers are never reused. A migration that half-applied is **not edited**; a
`NNNNb_*.sql` follow-up carries only the outstanding work, with the assumed
starting state in its header. The original stays on disk as the record of what
was attempted — and if its comments turned out to be wrong, correcting the
comment is worth doing so the next reader is not misled.

### 8. The local suite is a shape check, not a proof

`npm run test:rls` applies every file in this directory to a throwaway
Postgres and runs the proof suites. It will catch a syntax error, a broken
policy, a missing grant. It will **not** catch anything in this document,
because `psql` runs a file the way the migration author imagined and the
editor does not. After running a migration against the real project, run its
verification `SELECT` there too.

## Checklist before running anything in the SQL editor

- [ ] No `begin;` / `commit;`
- [ ] No temp tables
- [ ] No revoke-then-regrant across two statements
- [ ] Every statement is `IF NOT EXISTS`, `OR REPLACE`, or guarded by a `DO`
- [ ] Running it twice is a no-op
- [ ] The header says what state the database must be in first
- [ ] The last statement is a verification `SELECT` with a `verdict` column
- [ ] You have read that grid before calling the migration done
