-- =============================================================================
-- 0006 — delete_account() leaves nothing of the user behind.
--
-- Apple Guideline 5.1.1(v) requires in-app account deletion. The flow existed
-- and worked, but the RPC behind it deleted the tables it remembered rather
-- than every table that references the user, and four kinds of row survived a
-- "delete forever":
--
--   pings            — every message sent to OR received from the account,
--                      complete with its text, still readable by the
--                      squadmates on the other end.
--   content_reports  — reports FILED BY the account, which is a record of
--                      what that person objected to.
--   blocked_users    — rows where the account was the one BLOCKED. The
--                      deleted user's id stayed in other people's block
--                      lists, and blocked_users.blocked has no cascade of
--                      its own to clean it up.
--   squads           — a squad the account created and was the last member
--                      of, left standing with an invite code that still
--                      works and created_by pointing at a ghost.
--
-- WHAT IS STILL NOT DELETED, AND CANNOT BE FROM HERE
--
--   The auth.users row itself. Deleting it needs the service role, which is
--   not — and must never be — in the app. Until an Edge Function or a server
--   process does that, this RPC removes every trace of the person from the
--   application schema, and the account is left as an email address with no
--   data and no challenge; signing in with it again produces a brand new
--   empty account, not the old one. That gap is deliberate and documented,
--   not overlooked.
--
-- Idempotent: `create or replace` on one function, safe to re-run.
-- =============================================================================

begin;

create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_squad uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- Noted BEFORE leaving, because leave_squad() is what removes the
  -- membership row this reads.
  select squad_id into v_squad from public.squad_members where user_id = v_uid;

  perform public.leave_squad();

  delete from public.journal_entries where owner = v_uid;
  delete from public.meals           where owner = v_uid;
  delete from public.metric_checkins where owner = v_uid;
  delete from public.milestones      where owner = v_uid;
  delete from public.workout_logs    where owner = v_uid;
  delete from public.content_reports where reporter = v_uid;
  delete from public.pings           where from_user = v_uid or to_user = v_uid;

  -- Both directions. Deleting only `blocker` left this user's id sitting in
  -- other people's block lists for ever.
  delete from public.blocked_users   where blocker = v_uid or blocked = v_uid;

  delete from public.feed_items      where author = v_uid;
  delete from public.challenges      where owner = v_uid;
  delete from public.profile_private where id = v_uid;
  delete from public.profiles        where id = v_uid;

  -- A squad this user created and has now left. Deleted only when it is
  -- empty: a squad someone else is still running is theirs, and squads.name
  -- and invite_code carry nothing personal. squad_members, feed_items and
  -- pings cascade from squads.id.
  if v_squad is not null then
    delete from public.squads s
    where s.id = v_squad
      and s.created_by = v_uid
      and not exists (
        select 1 from public.squad_members m where m.squad_id = s.id
      );
  end if;
end $$;

-- `create or replace` preserves privileges, but re-run on a database where
-- 0002's blanket revoke landed after 0004 this is what puts EXECUTE back.
revoke all on function public.delete_account() from public, anon, authenticated;
grant execute on function public.delete_account() to authenticated;

commit;
