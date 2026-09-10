-- =============================================================================
-- PHASE 16B / B2 (+ PHASE 16D / D1-D5) — INTERROGATE PRODUCTION.
--
-- I cannot run this. The only credential in this repo is the anon key, which
-- holds no privilege on any table and cannot read pg_proc, pg_policies,
-- pg_constraint, information_schema grants or cron.job. Everything below has
-- to be run by you, in the SQL editor, as the owner. What I can do is make it
-- one statement, read-only, and self-explaining.
--
-- IT WRITES NOTHING. Pure SELECT. No DO block, no temp table, no transaction
-- control, no volatile call. Safe to run as many times as you like.
--
-- HOW TO READ IT: row 1 is the summary. If it says 0 FINDING you can stop.
-- Otherwise every FINDING is sorted above every OK, and inside the findings
-- the priority order is: privilege escalation, then live data corruption,
-- then missing structure, then everything else. `verdict` is the column that
-- matters; `rk` is 0 for FINDING, 1 for INFO, 2 for OK.
--
-- WHAT 16D ADDED, AND WHY. The first version of this file checked tables,
-- RLS, RPC counts, definer, search_path, grants and the trigger. It did not
-- check a single index or constraint — which is to say it did not look for
-- either of the two failures the B1 audit itself named as the silent,
-- weeks-later, data-corrupting ones. Sections 8 and 9 are that gap closed:
--
--   8   every uniqueness and referential guarantee 0001-0012 creates, BY
--       NAME, one row each, present/absent. No counts.
--   9   whether each of those guarantees has actually been VIOLATED, right
--       now, as an explicit number. An absent index means duplicates may have
--       been accumulating unseen; a present index only proves there were none
--       at build time. Every row here reports an explicit 0, never an empty
--       result — an empty result and a zero look identical in a grid and mean
--       opposite things.
--   2   RPCs are NAMED with their full signature, not counted. That includes
--       the four 0011 drops across statement boundaries before recreating:
--       complete_task, uncomplete_task, seal_day, get_squad_status(uuid).
--   2b  signatures that must NO LONGER exist, because a lingering old
--       overload silently wins argument resolution — complete_task(text,
--       integer) would take precedence over the 3-arg grace-window form for
--       any 2-arg call, and the day would be judged against the wrong window.
--   4   the 0002 re-run trap, live. 0002 ends with `grant execute on all
--       functions in schema public to authenticated`, which would re-grant
--       the server-only set that 0007 s10 and 0011 s7 revoke. One row per
--       server-only function, yes/no, sorted to the top of the grid.
--
-- TWO CAVEATS I AM NOT GOING TO PAPER OVER:
--
--   (a) Section 9 names the core tables directly in FROM clauses, which is
--       what makes the violation counts real rather than inferred. The price
--       is that a genuinely missing core table takes the whole statement down
--       at PARSE time. That is the same hazard cron.job has. If it errors
--       with `relation "public.<x>" does not exist`, THAT IS THE FINDING —
--       run the SECTION 1 FALLBACK at the bottom to learn which table.
--
--   (b) No check here reads auth.users. The orphan checks in 9e are
--       public->public only. Reading auth.users from the SQL editor generally
--       works, but a permission error there would abort the whole grid to
--       learn something the foreign keys in 8d already guarantee.
--
-- TWO THINGS ARE SEPARATED OUT INTO THEIR OWN FILES and must be run on their
-- own: the pg_cron checks (cron.job may not exist, which would take the grid
-- down with it) and the trigger probe (it is the only WRITE, and it is built
-- to discard itself). Each file is complete — open it, Ctrl+A, run.
--
--   supabase/repair/phase16b_pgcron.sql
--   supabase/repair/phase16b_trigger_probe.sql
--
-- The main grid deliberately does NOT test the immutability trigger by trying
-- to break it — that is a WRITE, and in this editor a write that unexpectedly
-- succeeds cannot be taken back. The trigger is checked by existence,
-- attachment, firing conditions and source instead.
-- =============================================================================

with
-- ---------------------------------------------------------------- expected
expected_tables(name) as (values
  ('tier_standards'),('profiles'),('profile_private'),('challenges'),
  ('tier_history'),('custom_tasks'),('target_overrides'),('challenge_days'),
  ('task_completions'),('journal_entries'),('meals'),('metric_checkins'),
  ('milestones'),('squads'),('squad_members'),('feed_items'),('pings'),
  ('content_reports'),('blocked_users'),('workout_logs'),('tier_rules'),
  ('sim_allowed_users')
),

-- ---------------------------------------------------------------------------
-- D3. EVERY RPC BY NAME AND SIGNATURE — the end state of 0001 through 0012b.
--
--   fargs    identity arguments, normalised: no spaces, no schema qualifier.
--   definer  must this function be SECURITY DEFINER?
--   reach    'client' = `authenticated` must hold EXECUTE (the app calls it).
--            'server' = NO client role may hold EXECUTE. This is the D4 list:
--                       every one of these is re-granted by a naive re-run of
--                       0002, and every one is a privilege escalation if it
--                       reads true below.
--
-- Two deliberate non-definers, because "not definer" looks like a finding and
-- here is not:
--   evaluate_all_challenges()  0007 made it definer; 0008 re-created it as an
--                              invoker procedure. It runs from pg_cron as the
--                              job owner, so it does not need definer — and
--                              if it reads `security definer` here, that means
--                              0008 section 8 never ran.
--   the five clock helpers     they take a `challenges` ROW, not an id. They
--                              hold no authority of their own and are only
--                              reachable from inside the definers that call
--                              them.
-- ---------------------------------------------------------------------------
expected_rpc(fname, fargs, definer, reach) as (values
  -- 0001 --------------------------------------------------------------------
  ('same_squad',              'uuid,uuid',                     true,  'client'),
  ('is_squad_member',         'uuid,uuid',                     true,  'client'),
  ('challenge_day',           'challenges',                    false, 'client'),
  ('effective_tier',          'uuid,integer',                  true,  'client'),
  ('compose_task_set',        'uuid,integer',                  true,  'client'),
  ('set_target_override',     'text,integer',                  true,  'client'),
  ('remove_custom_task',      'uuid',                          true,  'client'),
  ('change_tier',             'text',                          true,  'client'),
  ('forbid_snapshot_mutation','',                              false, 'client'),
  -- 0004 / 0006 -------------------------------------------------------------
  ('update_custom_task',      'uuid,text,text,boolean,integer',true,  'client'),
  ('undo_pending_changes',    '',                              true,  'client'),
  ('save_completion_feeling', 'text,text',                     true,  'client'),
  ('delete_account',          '',                              true,  'client'),
  -- 0007 --------------------------------------------------------------------
  ('my_active_challenge',     '',                              true,  'client'),
  ('day_is_met',              'uuid,integer',                  true,  'client'),
  ('add_custom_task',         'text,text,boolean,integer',     true,  'client'),
  ('require_simulation',      '',                              true,  'client'),
  ('sim_fresh_start',         '',                              true,  'client'),
  ('sim_jump_to_day',         'integer,boolean',               true,  'client'),
  ('sim_day75_complete',      '',                              true,  'client'),
  ('sim_missed_day',          '',                              true,  'client'),
  ('active_challenge_of',     'uuid',                          true,  'server'),
  ('restart_challenge',       'uuid,integer,text',             true,  'server'),
  ('sim_fill_day',            'uuid,integer',                  true,  'server'),
  ('evaluate_all_challenges', '',                              false, 'server'),
  -- 0008 --------------------------------------------------------------------
  ('challenge_length',        '',                              true,  'client'),
  ('custom_task_limit',       '',                              false, 'client'),
  ('create_challenge',        'text,date,text,integer',        true,  'client'),
  ('set_challenge_duration',  'uuid,integer',                  true,  'client'),
  ('add_setup_custom_task',   'text,integer',                  true,  'client'),
  ('challenge_length',        'uuid',                          true,  'server'),
  ('evaluate_challenge',      'uuid',                          true,  'server'),
  -- 0009 --------------------------------------------------------------------
  ('clean_squad_name',        'text',                          false, 'client'),
  ('create_squad',            'text',                          true,  'client'),
  ('rename_squad',            'uuid,text',                     true,  'client'),
  ('join_squad',              'text',                          true,  'client'),
  ('my_squads',               '',                              true,  'client'),
  ('leave_squad',             'uuid',                          true,  'client'),
  ('send_ping',               'uuid,text,uuid',                true,  'client'),
  ('leave_all_squads',        '',                              true,  'server'),
  -- 0011 --------------------------------------------------------------------
  ('grace_deadline_hour',     '',                              false, 'client'),
  ('get_or_freeze_day',       'integer',                       true,  'client'),
  ('get_or_freeze_today',     '',                              true,  'client'),
  ('complete_task',           'text,integer,integer',          true,  'client'),
  ('uncomplete_task',         'text,integer',                  true,  'client'),
  ('seal_day',                'integer',                       true,  'client'),
  ('get_day_window',          '',                              true,  'client'),
  ('get_squad_status',        'uuid',                          true,  'client'),
  ('challenge_local_now',     'challenges',                    false, 'server'),
  ('day_closes_at',           'challenges,integer',            false, 'server'),
  ('earliest_open_day',       'challenges',                    false, 'server'),
  ('last_closed_day',         'challenges',                    false, 'server'),
  ('day_is_open',             'challenges,integer',            false, 'server')
),

-- Signatures a later migration DROPPED. Each must be absent, and a survivor
-- is not cosmetic: PostgreSQL resolves an overloaded call by argument count,
-- so the old shorter form silently wins every call the app makes with the old
-- arity — and the app keeps working, wrongly, with nothing to report.
retired_rpc(fname, fargs, dropped_by, harm) as (values
  ('create_challenge', 'text,date,text', '0008',
     'a 3-arg create would skip duration_days entirely'),
  ('leave_squad',      '',               '0009',
     'the no-arg form left WHICHEVER squad SELECT INTO happened to return'),
  ('send_ping',        'uuid,text',      '0009',
     'the 2-arg form resolved the squad by arbitrary pick, so a ping could land in the wrong squad'),
  ('get_squad_status', '',               '0009',
     'the no-arg form showed the roster of an arbitrary squad'),
  ('complete_task',    'text,integer',   '0011',
     'a 2-arg complete_task wins over the 3-arg grace-window form and judges the wrong day'),
  ('uncomplete_task',  'text',           '0011',
     'a 1-arg uncomplete_task wins over the 2-arg grace-window form'),
  ('seal_day',         '',               '0011',
     'seal_day() would be AMBIGUOUS against seal_day(integer default null) and every call would error')
),

-- ---------------------------------------------------------------------------
-- D1. INDEXES. Named, with the WHERE clause where there is one.
--
-- squad_members_one_squad is here with must_exist = FALSE, and that is not a
-- typo. 0009 section 1 drops it deliberately: the whole model change is "a
-- user may hold several memberships", and the composite primary key
-- (squad_id, user_id) already stops the only duplicate that was ever wrong.
-- So on a database with 0009 applied, PRESENT is the finding and ABSENT is
-- correct.
--
-- Which means the real 0009 mid-failure hazard is not the drop on its own.
-- It is the drop landing while the five squad-resolving functions that used
-- `select squad_id into ... from squad_members where user_id = auth.uid()`
-- are NOT yet rewritten to take a squad id. Section 2 checks those by
-- signature, and 2b checks that their old arities are gone — together that is
-- what distinguishes "0009 finished" from "0009 stopped after statement one".
--
-- The '_predicate' suffix on the second row is a label, not an index name;
-- the lookup strips it. It exists so that "the index is there" and "the index
-- is still PARTIAL" are two separate verdicts. A non-partial unique index on
-- challenges(owner) would look fine in a list and would forbid archiving.
-- ---------------------------------------------------------------------------
expected_index(iname, must_exist, must_contain, why) as (values
  ('challenges_one_active_owner', true,  'UNIQUE',
     '0007 s2 — unique (owner) where ended_at is null. THE replacement for challenges_owner_key.'),
  ('challenges_one_active_owner_predicate', true, 'ended_at IS NULL',
     '0007 s2 — the partial predicate. Non-partial here would forbid archiving.'),
  ('challenges_active_idx',       true,  'ended_at IS NULL',
     '0007 s1 — partial index the evaluator scans.'),
  ('workout_logs_owner_day_idx',  true,  'workout_logs',
     '0004 — (owner, day desc, logged_at desc).'),
  ('squad_members_one_squad',     false, '',
     '0001 created it, 0009 s1 DROPS it by design. Present = 0009 never ran.')
),

-- D1. PRIMARY KEYS. Compared against the printed definition, so column ORDER
-- is checked too, not just membership.
expected_pk(tbl, defn) as (values
  ('tier_standards',    'PRIMARY KEY (tier, task_key)'),
  ('profiles',          'PRIMARY KEY (id)'),
  ('profile_private',   'PRIMARY KEY (id)'),
  ('challenges',        'PRIMARY KEY (id)'),
  ('tier_history',      'PRIMARY KEY (challenge_id, from_day)'),
  ('custom_tasks',      'PRIMARY KEY (id)'),
  ('target_overrides',  'PRIMARY KEY (challenge_id, task_key)'),
  ('challenge_days',    'PRIMARY KEY (id)'),
  ('task_completions',  'PRIMARY KEY (id)'),
  ('journal_entries',   'PRIMARY KEY (id)'),
  ('meals',             'PRIMARY KEY (id)'),
  ('metric_checkins',   'PRIMARY KEY (id)'),
  ('milestones',        'PRIMARY KEY (id)'),
  ('squads',            'PRIMARY KEY (id)'),
  ('squad_members',     'PRIMARY KEY (squad_id, user_id)'),
  ('feed_items',        'PRIMARY KEY (id)'),
  ('pings',             'PRIMARY KEY (id)'),
  ('content_reports',   'PRIMARY KEY (id)'),
  ('blocked_users',     'PRIMARY KEY (blocker, blocked)'),
  ('workout_logs',      'PRIMARY KEY (id)'),
  ('tier_rules',        'PRIMARY KEY (tier)'),
  ('sim_allowed_users', 'PRIMARY KEY (user_id)')
),

-- D1. UNIQUE CONSTRAINTS. challenges_owner_key is here with must_exist =
-- FALSE: 0007 s2 discovers and drops it, and if it survived, every
-- archive-and-restart fails on a duplicate key at the moment the user can
-- least afford it.
expected_unique(tbl, defn, must_exist) as (values
  ('challenge_days',   'UNIQUE (challenge_id, day)',           true),
  ('task_completions', 'UNIQUE (challenge_id, day, task_key)', true),
  ('squads',           'UNIQUE (invite_code)',                 true),
  ('challenges',       'UNIQUE (owner)',                       false)
),

-- D1. FOREIGN KEYS. One row per key, matched on the printed definition so the
-- ON DELETE action is checked and not assumed.
expected_fk(tbl, col, defn) as (values
  ('profiles',         'id',            'FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE'),
  ('profile_private',  'id',            'FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE'),
  ('challenges',       'owner',         'FOREIGN KEY (owner) REFERENCES auth.users(id) ON DELETE CASCADE'),
  ('challenges',       'restarted_from','FOREIGN KEY (restarted_from) REFERENCES challenges(id) ON DELETE SET NULL'),
  ('tier_history',     'challenge_id',  'FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE'),
  ('custom_tasks',     'challenge_id',  'FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE'),
  ('target_overrides', 'challenge_id',  'FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE'),
  ('challenge_days',   'challenge_id',  'FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE'),
  ('task_completions', 'challenge_id',  'FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE'),
  ('journal_entries',  'owner',         'FOREIGN KEY (owner) REFERENCES auth.users(id) ON DELETE CASCADE'),
  ('meals',            'owner',         'FOREIGN KEY (owner) REFERENCES auth.users(id) ON DELETE CASCADE'),
  ('metric_checkins',  'owner',         'FOREIGN KEY (owner) REFERENCES auth.users(id) ON DELETE CASCADE'),
  ('milestones',       'owner',         'FOREIGN KEY (owner) REFERENCES auth.users(id) ON DELETE CASCADE'),
  ('squads',           'created_by',    'FOREIGN KEY (created_by) REFERENCES auth.users(id)'),
  ('squad_members',    'squad_id',      'FOREIGN KEY (squad_id) REFERENCES squads(id) ON DELETE CASCADE'),
  ('squad_members',    'user_id',       'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
  ('feed_items',       'squad_id',      'FOREIGN KEY (squad_id) REFERENCES squads(id) ON DELETE CASCADE'),
  ('feed_items',       'author',        'FOREIGN KEY (author) REFERENCES auth.users(id) ON DELETE CASCADE'),
  ('pings',            'squad_id',      'FOREIGN KEY (squad_id) REFERENCES squads(id) ON DELETE CASCADE'),
  ('pings',            'from_user',     'FOREIGN KEY (from_user) REFERENCES auth.users(id) ON DELETE CASCADE'),
  ('pings',            'to_user',       'FOREIGN KEY (to_user) REFERENCES auth.users(id) ON DELETE CASCADE'),
  ('content_reports',  'reporter',      'FOREIGN KEY (reporter) REFERENCES auth.users(id) ON DELETE CASCADE'),
  ('content_reports',  'feed_item_id',  'FOREIGN KEY (feed_item_id) REFERENCES feed_items(id) ON DELETE CASCADE'),
  ('blocked_users',    'blocker',       'FOREIGN KEY (blocker) REFERENCES auth.users(id) ON DELETE CASCADE'),
  ('blocked_users',    'blocked',       'FOREIGN KEY (blocked) REFERENCES auth.users(id) ON DELETE CASCADE'),
  ('workout_logs',     'owner',         'FOREIGN KEY (owner) REFERENCES auth.users(id) ON DELETE CASCADE'),
  ('workout_logs',     'challenge_id',  'FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE'),
  ('sim_allowed_users','user_id',       'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE')
),

-- D1. CHECK CONSTRAINTS. Matched by (table, column) and then by a fragment of
-- the printed expression, because PostgreSQL reprints CHECKs in its own
-- normal form and an exact string match would be brittle for no gain — the
-- full printed definition is in the `detail` column either way.
--
-- Two of these are the drop-then-add shape 16D is about:
--   challenges.duration_days  0008 does `drop constraint if exists` and then
--                             `add constraint` in two statements. A stop
--                             between them leaves NO bound on duration_days.
--   feed_items.kind           0007 s9 does the same to widen the set to
--                             include 'miss'. A stop between them leaves no
--                             bound on kind at all — and the evaluator then
--                             writes its 'miss' rows successfully, which is
--                             exactly why nothing would ever complain.
expected_check(tbl, col, frag) as (values
  ('tier_standards',  'tier',             '''soft'''),
  ('tier_standards',  'unit',             '''gallons'''),
  ('profiles',        'unit_preference',  '''imperial'''),
  ('challenges',      'base_tier',        '''soft'''),
  ('challenges',      'ended_reason',     '''restarted'''),
  ('challenges',      'duration_days',    '30, 45, 75'),
  ('tier_history',    'tier',             '''soft'''),
  ('target_overrides','value',            '>= 1'),
  ('challenge_days',  'day',              '>= 1'),
  ('challenge_days',  'outcome',          '''missed'''),
  ('metric_checkins', 'mood',             'mood <= 5'),
  ('feed_items',      'kind',             '''miss'''),
  ('workout_logs',    'duration_seconds', '>= 0'),
  ('workout_logs',    'effort',           'effort <= 5'),
  ('workout_logs',    'notes',            '280'),
  ('tier_rules',      'tier',             '''soft''')
),

-- Every function in public, with its identity arguments normalised the same
-- way the expectations are written: no spaces, no schema qualifier. Matching
-- on this rather than on to_regprocedure() means a missing function yields a
-- NULL row instead of an error, so nothing silently drops out of the grid.
-- (The old version of this file guarded section 4 with
-- `where to_regprocedure(...) is not null`, which meant a MISSING server-only
-- function produced no row at all — the empty-versus-zero problem, in the one
-- section where it mattered most.)
-- (proargtypes, not pg_get_function_identity_arguments: the latter includes
-- PARAMETER NAMES, so `day_is_met` would print `p_challenge uuid, p_day
-- integer` and never match. proargtypes is the IN-argument type vector and
-- nothing else, which is exactly the identity we are keying on.)
proc_norm as (
  select p.oid,
         p.proname,
         replace(replace(
           coalesce((select string_agg(format_type(u.t, null), ',' order by u.ord)
                     from unnest(p.proargtypes) with ordinality as u(t, ord)), ''),
           'public.', ''), ' ', '') as args_norm,
         p.prosecdef,
         p.proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
),
rpc as (
  select e.fname, e.fargs, e.definer, e.reach,
         pn.oid, pn.prosecdef, pn.proconfig
  from expected_rpc e
  left join proc_norm pn
    on pn.proname = e.fname and pn.args_norm = e.fargs
),

report as (

  -- 1 ------------------------------------------------------------- tables
  select '1_tables' as section, row_number() over (order by e.name)::int as ord,
         e.name as item,
         coalesce(to_regclass('public.' || e.name)::text, '(absent)') as detail,
         case when to_regclass('public.' || e.name) is null
              then 'FINDING — table does not exist'
              when not (select relrowsecurity from pg_class
                         where oid = to_regclass('public.' || e.name))
              then 'FINDING — RLS is not enabled on it'
              else 'OK' end as verdict
  from expected_tables e

  -- 2 ---------------------------- D3: every RPC, NAMED, with its signature
  --     Existence and SECURITY DEFINER in one row per signature. The four
  --     that 0011 drops and recreates across statement boundaries —
  --     complete_task(text,integer,integer), uncomplete_task(text,integer),
  --     seal_day(integer), get_squad_status(uuid) — are ordinary rows here
  --     and need no special casing: if 0011 stopped between the drops and the
  --     creates, they simply read '(absent)'.
  union all
  select '2_rpc', row_number() over (order by r.fname, r.fargs)::int,
         r.fname || '(' || r.fargs || ')',
         case when r.oid is null then '(absent)'
              when r.prosecdef  then 'security definer'
              else 'security invoker' end,
         case
           when r.oid is null
             then 'FINDING — RPC is missing'
           when r.definer and not r.prosecdef
             then 'FINDING — must be SECURITY DEFINER and is not'
           when not r.definer and r.prosecdef
             then 'FINDING — is SECURITY DEFINER and should not be'
           else 'OK' end
  from rpc r

  -- 2b ------------------------------ signatures that must NO LONGER exist
  union all
  select '2b_retired_rpc', row_number() over (order by t.fname, t.fargs)::int,
         t.fname || '(' || t.fargs || ')  [dropped by ' || t.dropped_by || ']',
         case when exists (select 1 from proc_norm pn
                           where pn.proname = t.fname and pn.args_norm = t.fargs)
              then 'STILL PRESENT' else 'absent' end,
         case when exists (select 1 from proc_norm pn
                           where pn.proname = t.fname and pn.args_norm = t.fargs)
              then 'FINDING — old overload survived: ' || t.harm
              else 'OK — absent, as ' || t.dropped_by || ' intended' end
  from retired_rpc t

  -- 3 ------------------------- search_path pinned on every definer function
  --    A definer without `set search_path` is the classic privilege-escalation
  --    shape: the caller chooses which schema its unqualified names resolve
  --    in. Named per function, with its signature. Not counted.
  union all
  select '3_definer_search_path', row_number() over (order by p.proname)::int,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         coalesce(array_to_string(p.proconfig, ', '), '(none)'),
         case when p.proconfig is null
                or not exists (select 1 from unnest(p.proconfig) c
                                where c like 'search_path=%')
              then 'FINDING — definer with no pinned search_path'
              else 'OK' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef

  -- 4 ------------------- D4: THE 0002 RE-RUN TRAP, ONE ROW PER FUNCTION
  --     0002 ends with `grant execute on all functions in schema public to
  --     authenticated`. Anyone re-running it to "fix grants" hands
  --     `authenticated` EXECUTE on every one of these. Expected: false, for
  --     every row. A true here is a live privilege escalation and sorts to
  --     the very top of the grid.
  union all
  select '4_server_only', row_number() over (order by r.fname, r.fargs)::int,
         r.fname || '(' || r.fargs || ')',
         case when r.oid is null then '(function does not exist)'
              else 'authenticated=' || has_function_privilege('authenticated', r.oid, 'EXECUTE')::text
                   || '  anon=' || has_function_privilege('anon', r.oid, 'EXECUTE')::text
         end,
         case
           when r.oid is null
             then 'FINDING — server-only function is missing entirely'
           when has_function_privilege('authenticated', r.oid, 'EXECUTE')
             then 'FINDING — PRIVILEGE ESCALATION: authenticated holds EXECUTE (was 0002 re-run?)'
           when has_function_privilege('anon', r.oid, 'EXECUTE')
             then 'FINDING — PRIVILEGE ESCALATION: anon holds EXECUTE'
           else 'OK — no client role can execute it' end
  from rpc r
  where r.reach = 'server'

  -- 4b ------------ the other half: the app's own RPCs must still be callable
  union all
  select '4b_client_rpc', row_number() over (order by r.fname, r.fargs)::int,
         r.fname || '(' || r.fargs || ')',
         case when r.oid is null then '(function does not exist)'
              else 'authenticated=' || has_function_privilege('authenticated', r.oid, 'EXECUTE')::text
                   || '  anon=' || has_function_privilege('anon', r.oid, 'EXECUTE')::text
         end,
         case
           when r.oid is null
             then 'FINDING — the app calls this and it is not there'
           when has_function_privilege('anon', r.oid, 'EXECUTE')
             then 'FINDING — anon holds EXECUTE on an app RPC'
           when not has_function_privilege('authenticated', r.oid, 'EXECUTE')
             then 'FINDING — authenticated cannot execute it; whatever screen calls it is broken'
           else 'OK' end
  from rpc r
  where r.reach = 'client'

  -- 4c --------------- anything at all in public that anon can execute, NAMED
  --     The count row is emitted unconditionally, so "none" reads as an
  --     explicit 0 rather than as an absent section.
  union all
  select '4c_anon_execute', 0,
         'functions in public that anon may EXECUTE',
         (select count(*)::text from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and has_function_privilege('anon', p.oid, 'EXECUTE')),
         case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname = 'public'
                             and has_function_privilege('anon', p.oid, 'EXECUTE'))
              then 'FINDING — anon can execute something; the named rows follow'
              else 'OK — anon can execute nothing (explicit 0)' end

  union all
  select '4c_anon_execute', row_number() over (order by p.proname)::int,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'anon=true',
         'FINDING — anon holds EXECUTE on this'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')

  -- 5 ------------------------------------------------ anon on every table
  union all
  select '5_anon_tables', row_number() over (order by t.tablename)::int,
         t.tablename,
         'select=' || has_table_privilege('anon', 'public.' || t.tablename, 'SELECT')
           || ' insert=' || has_table_privilege('anon', 'public.' || t.tablename, 'INSERT')
           || ' update=' || has_table_privilege('anon', 'public.' || t.tablename, 'UPDATE')
           || ' delete=' || has_table_privilege('anon', 'public.' || t.tablename, 'DELETE'),
         case when has_table_privilege('anon', 'public.' || t.tablename, 'SELECT')
                or has_table_privilege('anon', 'public.' || t.tablename, 'INSERT')
                or has_table_privilege('anon', 'public.' || t.tablename, 'UPDATE')
                or has_table_privilege('anon', 'public.' || t.tablename, 'DELETE')
              then 'FINDING — anon holds a privilege here'
              else 'OK' end
  from pg_tables t where t.schemaname = 'public'

  -- 6 -------------- column-scoped UPDATE: metric_checkins is the only one
  union all
  select '6_column_grants', row_number() over (order by a.attname)::int,
         'metric_checkins.' || a.attname,
         'update=' || has_column_privilege('authenticated', 'public.metric_checkins', a.attname, 'UPDATE'),
         case when has_column_privilege('authenticated', 'public.metric_checkins', a.attname, 'UPDATE')
                   <> (a.attname in ('weight_kg', 'mood'))
              then 'FINDING — wrong column-grant shape'
              else 'OK' end
  from pg_attribute a
  where a.attrelid = 'public.metric_checkins'::regclass
    and a.attnum > 0 and not a.attisdropped

  union all
  select '6_column_grants', 90, 'table-level UPDATE on metric_checkins',
         has_table_privilege('authenticated', 'public.metric_checkins', 'UPDATE')::text,
         case when has_table_privilege('authenticated', 'public.metric_checkins', 'UPDATE')
              then 'FINDING — a table grant would make the column grant moot'
              else 'OK — column grant is the only one' end

  union all
  select '6_column_grants', 91, 'server-owned tables writable by authenticated',
         coalesce((select string_agg(t.tablename, ', ' order by t.tablename)
                   from pg_tables t
                   where t.schemaname = 'public'
                     and t.tablename in ('challenges','challenge_days','task_completions',
                                         'custom_tasks','target_overrides','tier_history',
                                         'squads','squad_members','pings','tier_rules',
                                         'sim_allowed_users')
                     and (has_table_privilege('authenticated', 'public.' || t.tablename, 'INSERT')
                       or has_table_privilege('authenticated', 'public.' || t.tablename, 'UPDATE')
                       or has_table_privilege('authenticated', 'public.' || t.tablename, 'DELETE'))),
                  'none'),
         case when exists (select 1 from pg_tables t
                           where t.schemaname = 'public'
                             and t.tablename in ('challenges','challenge_days','task_completions',
                                                 'custom_tasks','target_overrides','tier_history',
                                                 'squads','squad_members','pings','tier_rules',
                                                 'sim_allowed_users')
                             and (has_table_privilege('authenticated', 'public.' || t.tablename, 'INSERT')
                               or has_table_privilege('authenticated', 'public.' || t.tablename, 'UPDATE')
                               or has_table_privilege('authenticated', 'public.' || t.tablename, 'DELETE')))
              then 'FINDING — a client can write a server-owned table directly'
              else 'OK — RPC-only, as designed' end

  -- 7 ----------------------------------------- the immutability trigger
  union all
  select '7_immutability', 1, 'trigger challenge_days_immutable',
         coalesce((select t.tgname || ' ' ||
                          case when t.tgenabled = 'O' then 'enabled'
                               else 'DISABLED (' || t.tgenabled::text || ')' end
                   from pg_trigger t
                   where t.tgrelid = 'public.challenge_days'::regclass
                     and t.tgname = 'challenge_days_immutable'
                     and not t.tgisinternal), '(absent)'),
         case when not exists (select 1 from pg_trigger t
                               where t.tgrelid = 'public.challenge_days'::regclass
                                 and t.tgname = 'challenge_days_immutable'
                                 and not t.tgisinternal)
              then 'FINDING — the trigger is gone'
              when exists (select 1 from pg_trigger t
                           where t.tgrelid = 'public.challenge_days'::regclass
                             and t.tgname = 'challenge_days_immutable'
                             and not t.tgisinternal and t.tgenabled <> 'O')
              then 'FINDING — the trigger is attached but disabled'
              else 'OK — attached and enabled' end

  union all
  select '7_immutability', v.ord,
         'guards ' || v.col,
         (position(v.col in coalesce(
            (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'forbid_snapshot_mutation'), '')) > 0)::text,
         case when position(v.col in coalesce(
                (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'forbid_snapshot_mutation'), '')) = 0
              then 'FINDING — the function body does not mention this column'
              else 'OK' end
  from (values (2,'task_snapshot'), (3,'day'), (4,'challenge_id')) as v(ord, col)

  -- The firing conditions, JUDGED rather than handed back for eyeballing.
  -- (The previous version of this row returned the literal verdict text
  -- 'OK if it reads "DELETE UPDATE (BEFORE)"', which is a check that asks the
  -- reader to do the checking.) Expected: BEFORE, UPDATE, DELETE, and NOT
  -- INSERT — an INSERT-firing guard would refuse the freeze that creates the
  -- snapshot in the first place.
  union all
  select '7_immutability', 5, 'trigger fires on',
         coalesce((select case when (t.tgtype & 4) > 0 then 'INSERT ' else '' end
                        || case when (t.tgtype & 8) > 0 then 'DELETE ' else '' end
                        || case when (t.tgtype & 16) > 0 then 'UPDATE ' else '' end
                        || case when (t.tgtype & 2) > 0 then '(BEFORE)' else '(AFTER)' end
                   from pg_trigger t
                   where t.tgrelid = 'public.challenge_days'::regclass
                     and t.tgname = 'challenge_days_immutable'
                     and not t.tgisinternal), '(absent)'),
         coalesce((select case
                     when (t.tgtype & 2) = 0  then 'FINDING — fires AFTER, so it cannot refuse anything'
                     when (t.tgtype & 8) = 0  then 'FINDING — does not fire on DELETE'
                     when (t.tgtype & 16) = 0 then 'FINDING — does not fire on UPDATE'
                     when (t.tgtype & 4) > 0  then 'FINDING — also fires on INSERT, which would block the freeze'
                     else 'OK — BEFORE UPDATE OR DELETE' end
                   from pg_trigger t
                   where t.tgrelid = 'public.challenge_days'::regclass
                     and t.tgname = 'challenge_days_immutable'
                     and not t.tgisinternal),
                  'FINDING — the trigger is gone')

  -- ==========================================================================
  -- 8 — D1. STRUCTURE. Every uniqueness and referential guarantee, BY NAME.
  --     One row per expected object. A count is not an answer.
  -- ==========================================================================

  -- 8a --------------------------------------------------------- indexes
  union all
  select '8a_index', row_number() over (order by e.iname)::int,
         e.iname,
         coalesce(
           (select i.indexdef from pg_indexes i
            where i.schemaname = 'public'
              and i.indexname = split_part(e.iname, '_predicate', 1)),
           '(absent)') || '   -- ' || e.why,
         case
           when not e.must_exist then
             case when exists (select 1 from pg_indexes i
                               where i.schemaname = 'public' and i.indexname = e.iname)
                  then 'FINDING — this index must NOT exist. ' || e.why
                  else 'OK — absent, as intended' end
           when not exists (select 1 from pg_indexes i
                            where i.schemaname = 'public'
                              and i.indexname = split_part(e.iname, '_predicate', 1))
             then 'FINDING — index is ABSENT. ' || e.why
           when position(e.must_contain in
                  coalesce((select i.indexdef from pg_indexes i
                            where i.schemaname = 'public'
                              and i.indexname = split_part(e.iname, '_predicate', 1)), '')) = 0
             then 'FINDING — index exists but its definition lacks "' || e.must_contain || '"'
           else 'OK' end
  from expected_index e

  -- 8b ---------------------------------------------------- primary keys
  union all
  select '8b_primary_key', row_number() over (order by e.tbl)::int,
         e.tbl,
         coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c
                   where c.conrelid = to_regclass('public.' || e.tbl)
                     and c.contype = 'p' limit 1), '(no primary key)'),
         case
           when to_regclass('public.' || e.tbl) is null
             then 'FINDING — the table itself is absent'
           when not exists (select 1 from pg_constraint c
                            where c.conrelid = to_regclass('public.' || e.tbl)
                              and c.contype = 'p')
             then 'FINDING — no PRIMARY KEY; expected ' || e.defn
           when (select pg_get_constraintdef(c.oid) from pg_constraint c
                 where c.conrelid = to_regclass('public.' || e.tbl)
                   and c.contype = 'p' limit 1) <> e.defn
             then 'FINDING — primary key differs; expected ' || e.defn
           else 'OK' end
  from expected_pk e

  -- 8c ----------------------------------------------- unique constraints
  union all
  select '8c_unique_constraint', row_number() over (order by e.tbl, e.defn)::int,
         e.tbl || '  ' || e.defn,
         coalesce((select string_agg(c.conname, ', ') from pg_constraint c
                   where c.conrelid = to_regclass('public.' || e.tbl)
                     and c.contype = 'u'
                     and pg_get_constraintdef(c.oid) = e.defn), '(absent)'),
         case
           when to_regclass('public.' || e.tbl) is null
             then 'FINDING — the table itself is absent'
           when e.must_exist and not exists (
                  select 1 from pg_constraint c
                  where c.conrelid = to_regclass('public.' || e.tbl)
                    and c.contype = 'u'
                    and pg_get_constraintdef(c.oid) = e.defn)
             then 'FINDING — unique constraint is ABSENT'
           when not e.must_exist and exists (
                  select 1 from pg_constraint c
                  where c.conrelid = to_regclass('public.' || e.tbl)
                    and c.contype = 'u'
                    and pg_get_constraintdef(c.oid) = e.defn)
             then 'FINDING — 0007 s2 was supposed to drop this; every archive-and-restart fails on it'
           when not e.must_exist
             then 'OK — absent, as 0007 s2 intended'
           else 'OK' end
  from expected_unique e

  -- 8d ---------------------------------------------------- foreign keys
  union all
  select '8d_foreign_key', row_number() over (order by e.tbl, e.col)::int,
         e.tbl || '.' || e.col,
         coalesce((select replace(pg_get_constraintdef(c.oid), 'public.', '')
                   from pg_constraint c
                   join pg_attribute a
                     on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
                   where c.conrelid = to_regclass('public.' || e.tbl)
                     and c.contype = 'f'
                     and array_length(c.conkey, 1) = 1
                     and a.attname = e.col
                   limit 1), '(absent)'),
         case
           when to_regclass('public.' || e.tbl) is null
             then 'FINDING — the table itself is absent'
           when not exists (select 1 from pg_constraint c
                            join pg_attribute a
                              on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
                            where c.conrelid = to_regclass('public.' || e.tbl)
                              and c.contype = 'f'
                              and array_length(c.conkey, 1) = 1
                              and a.attname = e.col)
             then 'FINDING — foreign key ABSENT; expected ' || e.defn
           when (select replace(pg_get_constraintdef(c.oid), 'public.', '')
                 from pg_constraint c
                 join pg_attribute a
                   on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
                 where c.conrelid = to_regclass('public.' || e.tbl)
                   and c.contype = 'f'
                   and array_length(c.conkey, 1) = 1
                   and a.attname = e.col
                 limit 1) <> e.defn
             then 'FINDING — foreign key differs; expected ' || e.defn
           else 'OK' end
  from expected_fk e

  -- 8e -------------------------------------------------------- checks
  union all
  select '8e_check', row_number() over (order by e.tbl, e.col)::int,
         e.tbl || '.' || e.col,
         coalesce((select string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid), ' | ')
                   from pg_constraint c
                   join pg_attribute a
                     on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
                   where c.conrelid = to_regclass('public.' || e.tbl)
                     and c.contype = 'c'
                     and a.attname = e.col), '(absent)'),
         case
           when to_regclass('public.' || e.tbl) is null
             then 'FINDING — the table itself is absent'
           when not exists (select 1 from pg_constraint c
                            join pg_attribute a
                              on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
                            where c.conrelid = to_regclass('public.' || e.tbl)
                              and c.contype = 'c'
                              and a.attname = e.col)
             then 'FINDING — CHECK constraint ABSENT on this column'
           when position(e.frag in
                  coalesce((select string_agg(pg_get_constraintdef(c.oid), ' | ')
                            from pg_constraint c
                            join pg_attribute a
                              on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
                            where c.conrelid = to_regclass('public.' || e.tbl)
                              and c.contype = 'c'
                              and a.attname = e.col), '')) = 0
             then 'FINDING — CHECK exists but does not contain "' || e.frag || '"'
           else 'OK' end
  from expected_check e

  -- 8f ------------------------------------- the column 0012 was about
  union all
  select '8f_column_type', 1, 'metric_checkins.weight_kg',
         coalesce((select format_type(a.atttypid, a.atttypmod)
                   from pg_attribute a
                   where a.attrelid = 'public.metric_checkins'::regclass
                     and a.attname = 'weight_kg' and not a.attisdropped), '(absent)'),
         case when coalesce((select format_type(a.atttypid, a.atttypmod)
                             from pg_attribute a
                             where a.attrelid = 'public.metric_checkins'::regclass
                               and a.attname = 'weight_kg' and not a.attisdropped), '')
                   <> 'numeric(6,2)'
              then 'FINDING — 0012''s ALTER is not in place; 0.1 lb rounds away again'
              else 'OK — numeric(6,2)' end

  -- ==========================================================================
  -- 9 — D2. HAS ANY OF IT ACTUALLY BEEN VIOLATED?
  --
  -- A present index today does not prove there was never a window without it.
  -- It nearly does — a unique index cannot be BUILT over existing duplicates,
  -- so if the index exists, no duplicates existed at build time. But an
  -- ABSENT one means duplicates may have been accumulating ever since, with
  -- nothing anywhere to say so. Every row below reports an explicit number,
  -- including zero. None of them can return an empty result.
  -- ==========================================================================

  -- 9a ------------------------ owners holding more than one LIVE challenge
  --     "Live" is not ambiguous here, and that is worth stating rather than
  --     assuming, because the brief asked. The app never selects a challenge
  --     itself: src/services/backend/api.ts reads public.challenges only by
  --     id (`.eq('id', challengeId)`), and every id it holds came from an RPC
  --     that resolved through my_active_challenge(), whose entire definition
  --     of live is
  --
  --         where c.owner = auth.uid() and c.ended_at is null
  --         order by c.start_date desc, c.created_at desc limit 1
  --
  --     So: ended_at IS NULL. One definition, one place, no second opinion.
  --
  --     The ORDER BY / LIMIT 1 is worth noting for what it does to the
  --     failure mode. With the partial unique index gone, a duplicate would
  --     not present as random — it would present as STABLE and wrong: the
  --     same phantom challenge every time, no error anywhere, and the second
  --     row accumulating completions nobody sees.
  union all
  select '9_data', 1, 'owners with more than one LIVE challenge (ended_at is null)',
         (select count(*)::text from (
            select owner from public.challenges
            where ended_at is null group by owner having count(*) > 1) x),
         case when (select count(*) from (
                      select owner from public.challenges
                      where ended_at is null group by owner having count(*) > 1) x) > 0
              then 'FINDING — challenges_one_active_owner is not holding. '
                   || 'Non-deterministic challenge selection is live RIGHT NOW.'
              else 'OK — 0' end

  union all
  select '9_data', 2, 'live challenges / distinct owners (context for the row above)',
         (select count(*)::text from public.challenges where ended_at is null)
           || ' live row(s) across '
           || (select count(distinct owner)::text from public.challenges where ended_at is null)
           || ' owner(s)',
         'INFO — context only'

  union all
  select '9_data', 3, 'challenges with ended_at NULL but ended_reason set',
         (select count(*)::text from public.challenges
          where ended_at is null and ended_reason is not null),
         case when (select count(*) from public.challenges
                    where ended_at is null and ended_reason is not null) > 0
              then 'FINDING — a challenge is live and archived at once; 0007''s archive path half-ran'
              else 'OK — 0' end

  -- 9b ------------------------------- users appearing in more than one squad
  --     Read this row together with 8a / squad_members_one_squad, because the
  --     same number means opposite things on either side of 0009:
  --       index PRESENT -> a count above 0 is corruption the index could not
  --                        have permitted, i.e. something rebuilt it after
  --                        the fact, or it was never valid.
  --       index ABSENT  -> 0009 landed and multi-squad membership IS the
  --                        model. The number is information, not a defect.
  --     Saying "N users are in more than one squad, therefore finding" on a
  --     post-0009 database would be the audit claiming something happened
  --     that did not.
  union all
  select '9_data', 4, 'users appearing in more than one squad',
         (select count(*)::text from (
            select user_id from public.squad_members
            group by user_id having count(*) > 1) x),
         case
           when exists (select 1 from pg_indexes
                        where schemaname = 'public' and indexname = 'squad_members_one_squad')
             then case when (select count(*) from (
                               select user_id from public.squad_members
                               group by user_id having count(*) > 1) x) > 0
                       then 'FINDING — squad_members_one_squad exists and is being violated'
                       else 'OK — 0, and the index is still present (0009 has not run)' end
           else case when (select count(*) from (
                             select user_id from public.squad_members
                             group by user_id having count(*) > 1) x) > 0
                     then 'INFO — legal since 0009; multi-squad membership is the model'
                     else 'OK — 0 (and legal either way, since 0009)' end
         end

  -- 9c ------------------------- every other uniqueness, counted regardless
  --     Counted whether or not the guarantee is currently present, because
  --     "the index is there now" is not an answer to "was it ever missing".
  union all
  select '9_data', v.ord, v.item, v.n::text,
         case when v.n > 0 then 'FINDING — ' || v.why else 'OK — 0' end
  from (values
    (10, 'duplicate (challenge_id, day) in challenge_days',
         (select count(*) from (select challenge_id, day from public.challenge_days
                                group by 1,2 having count(*) > 1) d),
         'two frozen snapshots for one day; which one the app reads is arbitrary'),
    (11, 'duplicate (challenge_id, day, task_key) in task_completions',
         (select count(*) from (select challenge_id, day, task_key from public.task_completions
                                group by 1,2,3 having count(*) > 1) d),
         'a task counted twice toward a day being met'),
    (12, 'duplicate invite_code in squads',
         (select count(*) from (select invite_code from public.squads
                                group by 1 having count(*) > 1) d),
         'one code joins two different squads; join_squad picks arbitrarily'),
    (13, 'duplicate (squad_id, user_id) in squad_members',
         (select count(*) from (select squad_id, user_id from public.squad_members
                                group by 1,2 having count(*) > 1) d),
         'the composite primary key is not holding'),
    (14, 'duplicate (tier, task_key) in tier_standards',
         (select count(*) from (select tier, task_key from public.tier_standards
                                group by 1,2 having count(*) > 1) d),
         'a task resolves to two standards; compose_task_set picks arbitrarily'),
    (15, 'duplicate (challenge_id, from_day) in tier_history',
         (select count(*) from (select challenge_id, from_day from public.tier_history
                                group by 1,2 having count(*) > 1) d),
         'effective_tier is non-deterministic for that day'),
    (16, 'duplicate (challenge_id, task_key) in target_overrides',
         (select count(*) from (select challenge_id, task_key from public.target_overrides
                                group by 1,2 having count(*) > 1) d),
         'two targets for one task'),
    (17, 'duplicate (tier) in tier_rules',
         (select count(*) from (select tier from public.tier_rules
                                group by 1 having count(*) > 1) d),
         'the evaluator reads a tier''s missed-day rule non-deterministically')
  ) as v(ord, item, n, why)

  -- 9d ------------- CHECK constraints: has anything out of range got in?
  --     Rows 20 and 21 are the two drop-then-add checks. These are the ones
  --     that prove a window existed even if the constraint is back now: an
  --     out-of-range row cannot be inserted while the CHECK is in place, so
  --     if one exists it got in while the constraint did not.
  union all
  select '9_data', v.ord, v.item, v.n::text,
         case when v.n > 0 then 'FINDING — ' || v.why else 'OK — 0' end
  from (values
    (20, 'challenges.duration_days outside (30, 45, 75)',
         (select count(*) from public.challenges
          where duration_days is null or duration_days not in (30, 45, 75)),
         '0008 drops then re-adds challenges_duration_days_check in two statements; a row got in between them'),
    (21, 'feed_items.kind outside (complete, proof, change, ping, miss)',
         (select count(*) from public.feed_items
          where kind is null or kind not in ('complete','proof','change','ping','miss')),
         '0007 s9 drops then re-adds feed_items_kind_check in two statements; a row got in between them'),
    (22, 'challenges.ended_reason outside (missed_day, completed, restarted)',
         (select count(*) from public.challenges
          where ended_reason is not null
            and ended_reason not in ('missed_day','completed','restarted')),
         'the 0007 check is not holding'),
    (23, 'challenge_days.outcome outside (met, missed)',
         (select count(*) from public.challenge_days
          where outcome is not null and outcome not in ('met','missed')),
         'the 0007 check is not holding'),
    (24, 'profiles.unit_preference outside (metric, imperial)',
         (select count(*) from public.profiles
          where unit_preference is null or unit_preference not in ('metric','imperial')),
         'the 0003 check is not holding'),
    (25, 'metric_checkins.mood outside 1..5',
         (select count(*) from public.metric_checkins
          where mood is not null and (mood < 1 or mood > 5)),
         'the 0001 check is not holding'),
    (26, 'challenges.base_tier outside (hard, medium, soft)',
         (select count(*) from public.challenges
          where base_tier is null or base_tier not in ('hard','medium','soft')),
         'the 0001 check is not holding'),
    (27, 'challenge_days.day below 1',
         (select count(*) from public.challenge_days where day < 1),
         'the 0001 check is not holding'),
    (28, 'workout_logs.duration_seconds below 0',
         (select count(*) from public.workout_logs where duration_seconds < 0),
         'the 0004 check is not holding'),
    (29, 'workout_logs.effort outside 1..5',
         (select count(*) from public.workout_logs
          where effort is not null and (effort < 1 or effort > 5)),
         'the 0004 check is not holding')
  ) as v(ord, item, n, why)

  -- 9e ---------------------------- referential integrity, public -> public
  --     Nothing here reads auth.users; see caveat (b) in the header.
  union all
  select '9_data', v.ord, v.item, v.n::text,
         case when v.n > 0 then 'FINDING — ' || v.why else 'OK — 0' end
  from (values
    (30, 'challenge_days rows with no challenge',
         (select count(*) from public.challenge_days d
          where not exists (select 1 from public.challenges c where c.id = d.challenge_id)),
         'orphaned snapshots; the FK is absent, or was absent when they were written'),
    (31, 'task_completions rows with no challenge',
         (select count(*) from public.task_completions t
          where not exists (select 1 from public.challenges c where c.id = t.challenge_id)),
         'orphaned completions'),
    (32, 'custom_tasks rows with no challenge',
         (select count(*) from public.custom_tasks t
          where not exists (select 1 from public.challenges c where c.id = t.challenge_id)),
         'orphaned custom tasks'),
    (33, 'target_overrides rows with no challenge',
         (select count(*) from public.target_overrides t
          where not exists (select 1 from public.challenges c where c.id = t.challenge_id)),
         'orphaned overrides'),
    (34, 'tier_history rows with no challenge',
         (select count(*) from public.tier_history t
          where not exists (select 1 from public.challenges c where c.id = t.challenge_id)),
         'orphaned tier history; effective_tier would read it anyway'),
    (35, 'squad_members rows with no squad',
         (select count(*) from public.squad_members m
          where not exists (select 1 from public.squads s where s.id = m.squad_id)),
         'membership of a squad that does not exist'),
    (36, 'feed_items rows with no squad',
         (select count(*) from public.feed_items f
          where not exists (select 1 from public.squads s where s.id = f.squad_id)),
         'feed rows nobody can be a member of, so the RLS policy cannot scope them'),
    (37, 'pings rows with no squad',
         (select count(*) from public.pings p
          where not exists (select 1 from public.squads s where s.id = p.squad_id)),
         'pings nobody can be a member of'),
    (38, 'content_reports rows with no feed_item',
         (select count(*) from public.content_reports r
          where not exists (select 1 from public.feed_items f where f.id = r.feed_item_id)),
         'reports pointing at nothing'),
    (39, 'workout_logs rows with no challenge',
         (select count(*) from public.workout_logs w
          where not exists (select 1 from public.challenges c where c.id = w.challenge_id)),
         'orphaned workout logs'),
    (40, 'challenges.restarted_from pointing at a challenge that is gone',
         (select count(*) from public.challenges c
          where c.restarted_from is not null
            and not exists (select 1 from public.challenges p where p.id = c.restarted_from)),
         'the 0007 ON DELETE SET NULL did not fire, so "your previous attempt" points nowhere')
  ) as v(ord, item, n, why)

),

-- ---------------------------------------------------------------------------
-- D5. RANK AND PRIORITISE.
--   rk    0 = FINDING, 1 = INFO, 2 = OK.
--   prio  only applied among findings: privilege escalation first, then live
--         data corruption, then missing structure, then the rest. OK rows
--         keep plain section order so the grid stays readable.
-- ---------------------------------------------------------------------------
ranked as (
  select r.*,
         case when r.verdict like 'FINDING%' then 0
              when r.verdict like 'INFO%'    then 1
              else 2 end as rk,
         case r.section
           when '4_server_only'         then 1
           when '4c_anon_execute'       then 2
           when '9_data'                then 3
           when '2b_retired_rpc'        then 4
           when '8a_index'              then 5
           when '8c_unique_constraint'  then 6
           when '8b_primary_key'        then 7
           when '8d_foreign_key'        then 8
           when '8e_check'              then 9
           when '2_rpc'                 then 10
           when '7_immutability'        then 11
           when '1_tables'              then 12
           else 20 end as prio
  from report r
)

select grp, rk, section, ord, item, detail, verdict
from (
  -- The summary row. If it says 0 FINDING, you can stop reading.
  select -1 as grp, -1 as rk, 0 as prio, '0_summary' as section, 0 as ord,
         'SUMMARY — read this row first' as item,
         count(*)::text || ' checks' as detail,
         count(*) filter (where rk = 0)::text || ' FINDING, '
           || count(*) filter (where rk = 1)::text || ' INFO, '
           || count(*) filter (where rk = 2)::text || ' OK' as verdict
  from ranked

  union all

  select 0, rk, case when rk = 0 then prio else 99 end,
         section, ord, item, detail, verdict
  from ranked
) g
order by grp, rk, prio, section, ord;


-- =============================================================================
-- SECTION 1 FALLBACK — only if the grid above died at PARSE time with
-- `relation "public.<something>" does not exist`.
--
-- Section 9 names the core tables directly in FROM clauses, which is what
-- makes the violation counts real rather than inferred. The price is that a
-- genuinely missing core table takes the whole statement down. If that
-- happens, THAT IS THE FINDING, and this says which one:
-- =============================================================================
--
-- select e.name,
--        coalesce(to_regclass('public.' || e.name)::text, '(absent)') as detail,
--        case when to_regclass('public.' || e.name) is null
--             then 'FINDING — table does not exist' else 'OK' end as verdict
-- from (values
--   ('tier_standards'),('profiles'),('profile_private'),('challenges'),
--   ('tier_history'),('custom_tasks'),('target_overrides'),('challenge_days'),
--   ('task_completions'),('journal_entries'),('meals'),('metric_checkins'),
--   ('milestones'),('squads'),('squad_members'),('feed_items'),('pings'),
--   ('content_reports'),('blocked_users'),('workout_logs'),('tier_rules'),
--   ('sim_allowed_users')
-- ) as e(name)
-- order by 3 desc, 1;


-- =============================================================================
-- THE TWO SEPARATED CHECKS NOW LIVE IN THEIR OWN FILES. Open, Ctrl+A, run.
--
--   supabase/repair/phase16b_pgcron.sql         — run this second
--   supabase/repair/phase16b_trigger_probe.sql  — optional, the only WRITE
-- =============================================================================
