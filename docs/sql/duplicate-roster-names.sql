-- Phase 38S, S3.6: is a name that appears twice in one squad two accounts,
-- or one account rendered twice? READ-ONLY. One statement, one grid.
-- Run in the Supabase SQL editor (it runs as postgres, so auth.users is
-- readable). It names nobody: it finds every display name that appears
-- more than once in the same squad, so the handle seen on the phone never
-- has to be written into the repo.
--
-- How to read it:
--   section = 'verdict'  one row per duplicated name. "TWO ACCOUNTS" means
--                        two different user ids hold that name in the same
--                        squad (squad_members' primary key is
--                        (squad_id, user_id), so the server can never return
--                        one id twice for one squad). "ONE ACCOUNT" would mean
--                        the app drew one row twice — a client bug.
--   section = 'member'   one row per account behind the name: when it was
--                        created, when it last signed in, a masked email
--                        (first letter + domain) so you can tell whether it
--                        is the same person on two addresses, and the
--                        account's alive challenge: day, length, flame.
--                        "Day 35/45" and "Day 27/30" on the phone are two of
--                        these rows.
--
-- Nothing is fixed by this. Decide with the member which account to keep;
-- the other leaves the squad from the app (Squad → Settings → Leave).

with dup as (
  select m.squad_id, lower(trim(p.name)) as key
    from public.squad_members m
    join public.profiles p on p.id = m.user_id
   group by m.squad_id, lower(trim(p.name))
  having count(*) > 1
),
rows as (
  select d.squad_id, d.key, m.user_id, p.name, p.created_at as profile_created,
         u.created_at as auth_created, u.last_sign_in_at,
         left(u.email, 1) || '…@' || split_part(u.email, '@', 2) as email_masked,
         m.joined_at
    from dup d
    join public.squad_members m on m.squad_id = d.squad_id
    join public.profiles p on p.id = m.user_id and lower(trim(p.name)) = d.key
    left join auth.users u on u.id = m.user_id
)
select 'verdict' as section,
       r.key as name,
       (select s.name from public.squads s where s.id = r.squad_id) as squad,
       count(*)::text || ' rows, ' || count(distinct r.user_id)::text || ' distinct user ids' as detail,
       case when count(distinct r.user_id) > 1 then 'TWO ACCOUNTS'
            else 'ONE ACCOUNT rendered twice' end as verdict
  from rows r
 group by r.squad_id, r.key
union all
select 'member',
       r.name,
       r.user_id::text,
       'joined ' || to_char(r.joined_at, 'YYYY-MM-DD')
         || ' · account ' || to_char(r.auth_created, 'YYYY-MM-DD')
         || ' · last sign-in ' || coalesce(to_char(r.last_sign_in_at, 'YYYY-MM-DD HH24:MI'), 'never')
         || ' · ' || coalesce(r.email_masked, 'no auth row'),
       coalesce((
         select 'challenge started ' || c.start_date::text
                || ' · day ' || public.challenge_day(c)::text || '/' || c.duration_days::text
                || ' · flame ' || c.flame::text
           from public.challenges c
          where c.id = (public.active_challenge_of(r.user_id)).id
       ), 'no alive challenge')
  from rows r
order by 1 desc, 2, 3;
