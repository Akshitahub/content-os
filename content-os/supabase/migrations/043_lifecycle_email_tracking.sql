-- 043_lifecycle_email_tracking.sql
-- Sent-tracking for the two new lifecycle emails (app/api/v1/cron/
-- send-lifecycle-emails/route.ts) -- both nullable TIMESTAMPTZ, set once
-- an email actually sends, so the daily cron can't double-send across
-- runs. no_brand_nudge_sent_at: send-once-per-user (the 24-48h window it
-- checks against created_at only matches once anyway, but this is the
-- real guard). inactivity_nudge_sent_at: explicitly send-once-EVER per
-- the task spec -- never resend even if the user goes active then quiet
-- again. Flagged in that route's own comment as worth revisiting once
-- this has been live a while.
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.

ALTER TABLE public.users
  ADD COLUMN no_brand_nudge_sent_at TIMESTAMPTZ,
  ADD COLUMN inactivity_nudge_sent_at TIMESTAMPTZ;
