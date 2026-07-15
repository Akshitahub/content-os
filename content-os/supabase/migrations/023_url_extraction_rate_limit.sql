-- 023_url_extraction_rate_limit.sql
-- The two AI URL-extraction routes (POST /api/v1/ai/extract/brand and
-- POST /api/v1/ai/extract/product) had zero rate limiting -- each call
-- fetches an arbitrary caller-supplied URL and runs it through an AI model,
-- with no cap on call frequency regardless of plan. Adds a generous daily
-- counter, following the exact same reset-window pattern as
-- schedule_post_count_today/schedule_post_count_reset_at (migration 022).

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS url_extraction_count_today INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS url_extraction_count_reset_at TIMESTAMPTZ;
