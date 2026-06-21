-- ============================================================
-- AI Content OS — Usage Limits
-- Adds monthly generation counter to users table
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN generation_count          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN generation_count_reset_at TIMESTAMPTZ;
