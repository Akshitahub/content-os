-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
--
-- Brand-level "pause autoposting" kill switch. While set, the publish cron
-- (app/api/v1/cron/publish-scheduled/route.ts) leaves this brand's due
-- entries untouched instead of publishing them; generation and approval
-- (Autopilot, the calendar) are unaffected. Set / cleared by
-- app/api/v1/brands/[brandId]/autopost-pause/route.ts -- on resume, entries
-- that came due while paused are marked 'missed' rather than published late.
-- NULL = not paused. Until this runs, the cron's read of this column fails
-- and it publishes as before (see the fail-open note in that route).

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS autopost_paused_at TIMESTAMPTZ NULL;
