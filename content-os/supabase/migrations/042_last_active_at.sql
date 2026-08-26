-- 042_last_active_at.sql
-- Needed for the inactivity lifecycle email (see the cron this pairs
-- with, app/api/v1/cron/send-lifecycle-emails/route.ts) -- "14+ days
-- since last_active_at" is the trigger condition.
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.

ALTER TABLE public.users
  ADD COLUMN last_active_at TIMESTAMPTZ;
