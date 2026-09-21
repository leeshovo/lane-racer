create extension if not exists pg_cron;
-- Stündlich abgeschlossene Wochen einfrieren (idempotent) – die Preise stehen damit schon bereit, bevor jemand das Spiel öffnet
select cron.unschedule('finalize-weeks') where exists (select 1 from cron.job where jobname = 'finalize-weeks');
select cron.schedule('finalize-weeks', '7 * * * *', $$select public.finalize_weeks()$$);
-- Alte Cron-Protokolle aufräumen
select cron.unschedule('cleanup-cron-log') where exists (select 1 from cron.job where jobname = 'cleanup-cron-log');
select cron.schedule('cleanup-cron-log', '30 3 * * *', $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$);
