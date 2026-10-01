-- =============================================================================
-- 0010 — Let a user correct or remove one of their OWN past check-ins.
--
-- Why this needs a migration at all: 0002's allow-list grants `authenticated`
-- only SELECT and INSERT on public.metric_checkins. A row could be written and
-- read and never touched again, so a weight entered in the wrong unit was
-- permanent — the exact 203 kg / 203 lb row this migration exists for.
--
-- -----------------------------------------------------------------------------
-- THE TRAP IN THE GRANT, AND WHY IT IS NOT OPEN HERE
-- -----------------------------------------------------------------------------
-- metrics_all is declared `for all`, which covers UPDATE. On an UPDATE, USING
-- is checked against the OLD row and WITH CHECK against the NEW one. If WITH
-- CHECK were missing, Postgres would fall back to USING for visibility only
-- and let the NEW row be anything — so `update metric_checkins set owner =
-- '<someone else>'` would succeed, handing a private weight history to another
-- account, or claiming one. Granting UPDATE is what would make that reachable;
-- it is unreachable today only because the grant is missing.
--
-- It was checked before this file was written, and the policy is sound:
--
--   policyname   | metrics_all
--   permissive   | PERMISSIVE
--   roles        | {authenticated}
--   cmd          | ALL
--   using_clause | (owner = auth.uid())
--   with_check   | (owner = auth.uid())
--
-- (The column is `owner`, not `user_id`.) WITH CHECK is present and identical
-- to USING, so the new row must still belong to the caller. No policy fix is
-- needed and none is made here — rewriting a correct policy would only risk
-- breaking it.
--
-- What IS added is a machine check. The safety of this grant depends entirely
-- on a clause in another file, and "someone rewrote metrics_all and dropped
-- WITH CHECK" is a silent, total privacy failure. The assertion below refuses
-- to open the grant on a database where that clause is not what it must be.
--
-- -----------------------------------------------------------------------------
-- AND A SECOND WALL: COLUMN-LEVEL UPDATE
-- -----------------------------------------------------------------------------
-- UPDATE is granted on (weight_kg, mood) only, not on the table. Correcting a
-- check-in means changing a weight or a mood; it never means changing `owner`
-- or `id`. With a column-level grant the owner-reassignment attack is refused
-- by the PRIVILEGE layer before RLS is consulted at all, so it takes two
-- independent mistakes — a weakened policy AND a widened grant — to open it.
-- supabase/tests/metric_checkins_test.sql proves each wall separately.
--
-- Any column added to this table later must be added here deliberately to
-- become editable. That is the point.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- GATE: metrics_all must constrain the NEW row's owner to the caller.
-- ---------------------------------------------------------------------------
do $$
declare
  v_qual       text;
  v_with_check text;
begin
  select qual, with_check
    into v_qual, v_with_check
    from pg_policies
   where schemaname = 'public'
     and tablename  = 'metric_checkins'
     and policyname = 'metrics_all';

  if not found then
    raise exception
      'metrics_all is missing from public.metric_checkins — refusing to grant '
      'UPDATE/DELETE on a table with no owner policy.';
  end if;

  if v_with_check is null then
    raise exception
      'metrics_all has no WITH CHECK clause. Granting UPDATE would let any '
      'user set owner to another account and hand over (or claim) a private '
      'weight history. Fix the policy before running this migration.';
  end if;

  -- Normalised comparison: Postgres reprints the expression, so match on the
  -- shape rather than on exact whitespace.
  if replace(v_with_check, ' ', '') <> '(owner=auth.uid())' then
    raise exception
      'metrics_all WITH CHECK is %, not (owner = auth.uid()). Refusing to '
      'grant UPDATE until the NEW row is constrained to the caller.',
      v_with_check;
  end if;

  if replace(coalesce(v_qual, ''), ' ', '') <> '(owner=auth.uid())' then
    raise exception
      'metrics_all USING is %, not (owner = auth.uid()). Refusing to grant '
      'DELETE until the targetable rows are constrained to the caller.',
      v_qual;
  end if;

  raise notice
    '0010: metrics_all verified — USING %, WITH CHECK %', v_qual, v_with_check;
end $$;

-- ---------------------------------------------------------------------------
-- The grant. Idempotent; re-running is safe.
-- ---------------------------------------------------------------------------
grant update (weight_kg, mood) on public.metric_checkins to authenticated;
grant delete                   on public.metric_checkins to authenticated;

-- ---------------------------------------------------------------------------
-- Nothing references metric_checkins, so DELETE has no cascade to reason
-- about. Asserted rather than asserted-in-prose: a foreign key added later
-- would make a delete either fail or silently remove a dependent row, and
-- this is the file that would need to say what happens to it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_refs text;
begin
  select string_agg(format('%s.%s', c.conrelid::regclass, c.conname), ', ')
    into v_refs
    from pg_constraint c
   where c.contype = 'f'
     and c.confrelid = 'public.metric_checkins'::regclass;

  if v_refs is not null then
    raise exception
      'Something now references public.metric_checkins (%). Decide what a '
      'delete does to it before shipping the DELETE grant.', v_refs;
  end if;

  raise notice '0010: nothing references metric_checkins — delete cascades nowhere';
end $$;

-- ---------------------------------------------------------------------------
-- 0002 RE-RUN HAZARD — read this before re-running the grant hardener.
--
-- 0002 opens with `revoke all on all tables in schema public from ...
-- authenticated` and then grants back its allow-list, in which
-- metric_checkins appears under SELECT and INSERT only. Re-running 0002 after
-- this migration would therefore strip the two grants above and the history
-- screen would start failing with "permission denied" — the same trap 0002
-- already documents for tables created after it.
--
-- 0002 has been updated to include these grants so the converger stays
-- correct on its own. This file remains the authority: it is where the
-- capability is sanctioned and where the policy gate above lives. If the two
-- ever disagree, run this one last.
-- ---------------------------------------------------------------------------
