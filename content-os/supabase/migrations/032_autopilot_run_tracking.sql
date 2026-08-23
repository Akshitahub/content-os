-- ============================================================
-- AI Content OS — Autopilot run tracking
-- Adds a monthly Autopilot RUN counter, separate from the shared
-- generation_count credit pool — plans are capped at a fixed number of
-- Autopilot runs/month (see PLAN_LIMITS[plan].autopilot.maxRunsPerMonth
-- in types/app.ts) regardless of remaining credits.
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN autopilot_run_count          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN autopilot_run_count_reset_at TIMESTAMPTZ;
