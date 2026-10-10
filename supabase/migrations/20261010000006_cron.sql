-- Supabase only: the local test harness has no pg_cron and skips *_cron.sql.
-- pg_cron uses UTC. Minute 30 of every UTC hour is minute 0 of every IST hour,
-- so the first run each day is 12:00 AM IST and the rest are catch-up runs.
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'score-pending-days',
  '30 * * * *',
  'select public.score_pending_days()'
);
