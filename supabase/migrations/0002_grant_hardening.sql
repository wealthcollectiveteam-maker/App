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
