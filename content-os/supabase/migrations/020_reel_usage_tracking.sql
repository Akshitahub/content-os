-- 020_reel_usage_tracking.sql
-- Tracks usage against the new per-plan AI video reel allowances (Pro/Agency
-- weekly quota, one free lifetime reel on Free, none on Starter). This only
-- adds the counting/gating columns -- the actual Kling AI video generation
-- is a separate, later task.

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS reel_count_this_week INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS reel_count_reset_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS free_reel_used_at TIMESTAMPTZ;
