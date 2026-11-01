-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
--
-- Learning from real results (lib/ai/performance-learning.ts, weekly from
-- app/api/v1/cron/learn-from-results):
-- - content_engagement keeps saves, shares, reach and impressions next to
--   likes / comments (Zernio's post analytics return them), so a post is
--   judged mostly on saves and shares, per account reached;
-- - brand_lessons gets an expiry (performance lessons last 60 days unless
--   the next weekly run finds them still true), the evidence behind a
--   lesson (counts, gap from the brand's median) and a stable key per
--   finding ("template:review_card") so a re-run refreshes instead of
--   duplicating. Lessons with no expiry (feedback, edits) never expire.
-- Until this runs, engagement keeps likes + comments only and no
-- performance lessons are written.

ALTER TABLE public.content_engagement
  ADD COLUMN IF NOT EXISTS saves integer,
  ADD COLUMN IF NOT EXISTS shares integer,
  ADD COLUMN IF NOT EXISTS reach integer,
  ADD COLUMN IF NOT EXISTS impressions integer;

ALTER TABLE public.brand_lessons
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS evidence jsonb,
  ADD COLUMN IF NOT EXISTS lesson_key text;

CREATE UNIQUE INDEX IF NOT EXISTS brand_lessons_brand_source_key_uniq
  ON public.brand_lessons (brand_id, source, lesson_key) WHERE lesson_key IS NOT NULL;
