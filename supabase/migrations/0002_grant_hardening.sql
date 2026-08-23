-- =============================================================================
-- Grant hardening — converges an existing database to the explicit
-- privilege allow-list. Idempotent: safe to run on a project that had
-- 0001 applied before its lockdown section was fixed (where `anon` still
-- held Supabase's default INSERT/UPDATE/DELETE grants), and safe to re-run.
-- Fresh databases get the same end state from 0001 alone.
-- =============================================================================

revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on
  public.tier_standards, public.profiles, public.profile_private,
  public.challenges, public.tier_history, public.custom_tasks,
  public.target_overrides, public.challenge_days, public.task_completions,
  public.journal_entries, public.meals, public.metric_checkins,
  public.milestones, public.squads, public.squad_members,
  public.feed_items, public.pings, public.content_reports,
  public.blocked_users
to authenticated;

grant insert on
  public.profiles, public.profile_private, public.journal_entries,
  public.meals, public.metric_checkins, public.milestones,
  public.feed_items, public.content_reports, public.blocked_users
to authenticated;

grant update on
  public.profiles, public.profile_private, public.meals, public.milestones
to authenticated;

grant delete on public.blocked_users to authenticated;

grant execute on all functions in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- Tables created by LATER migrations.
--
-- The three `revoke all on all tables` statements at the top strip every
-- table in the schema, including ones this file's allow-list above predates.
-- Re-running 0002 on a converged database therefore used to leave
-- public.workout_logs (created in 0004) with NO privileges at all, and every
-- read and write against it failing with "permission denied" — while the file
-- header still advertised itself as safe to re-run.
--
-- Guarded, because ordering runs both ways: on a fresh database 0002 executes
-- BEFORE 0004 and the table does not exist yet (an unguarded grant would abort
-- the migration); on a converging one it exists and must get its grants back.
-- Any future table added after this file needs the same treatment here.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.workout_logs') is not null then
    execute 'revoke all on public.workout_logs from public, anon, authenticated';
    execute 'grant select, insert, update, delete on public.workout_logs to authenticated';
  end if;
end $$;
