-- =============================================================================
-- PHASE 16B — PG_CRON CHECK. RUN THIS WHOLE FILE ON ITS OWN.
--
-- Ctrl+A, Ctrl+C, paste into the SQL editor, Run. Nothing here is commented
-- out and there is no other statement in the file.
--
-- This is split out of phase16b_audit_production.sql. It is separate because
-- cron.job only exists when pg_cron is installed, and a query naming a missing
-- relation fails at PARSE time — it would take the whole audit grid down with
-- it however carefully it were guarded. Whether that relation exists is itself
-- one of the things we are trying to find out.
--
-- IT WRITES NOTHING. Pure SELECT. Safe to run as many times as you like.
--
-- If it errors with 'relation "cron.job" does not exist', that IS the answer:
-- pg_cron is not installed and the evaluator has never run on a schedule.
-- =============================================================================

select 'extension' as item,
       coalesce((select extversion from pg_extension where extname = 'pg_cron'),
                '(not installed)') as detail,
       case when exists (select 1 from pg_extension where extname = 'pg_cron')
            then 'OK' else 'FINDING — no scheduler' end as verdict
union all
select 'job evaluate-missed-days',
       coalesce((select j.schedule || '  ->  ' || j.command
                        || '  active=' || j.active::text
                 from cron.job j where j.jobname = 'evaluate-missed-days'),
                '(no such job)'),
       case
         when not exists (select 1 from cron.job where jobname = 'evaluate-missed-days')
           then 'FINDING — the job does not exist'
         when (select schedule from cron.job where jobname = 'evaluate-missed-days') <> '5 * * * *'
           then 'FINDING — schedule is not "5 * * * *"'
         when not (select active from cron.job where jobname = 'evaluate-missed-days')
           then 'FINDING — the job exists but is inactive'
         else 'OK — hourly at :05, active' end
union all
select 'last 10 runs: ' || to_char(r.start_time, 'YYYY-MM-DD HH24:MI'),
       r.status || coalesce(' — ' || left(r.return_message, 120), ''),
       case when r.status = 'succeeded' then 'OK'
            else 'FINDING — a run did not succeed' end
  from cron.job_run_details r
  join cron.job j on j.jobid = r.jobid
 where j.jobname = 'evaluate-missed-days'
 order by 1 desc
 limit 12;
