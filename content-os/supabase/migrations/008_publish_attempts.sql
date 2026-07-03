-- 008_publish_attempts.sql
-- Adds retry tracking for the automatic Instagram publish cron, and a public
-- storage bucket for re-hosting generated images as permanent HTTPS URLs
-- that Instagram's Graph API can fetch (it cannot accept data URLs).

ALTER TABLE public.calendar_entries
ADD COLUMN IF NOT EXISTS publish_attempts INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- STORAGE — bucket for images re-hosted for publishing
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('published-media', 'published-media', true)
ON CONFLICT (id) DO NOTHING;

-- Publicly readable — Instagram's Graph API must be able to fetch the image
-- over HTTPS with no auth.
CREATE POLICY "public_read_published_media" ON storage.objects FOR SELECT
  USING (bucket_id = 'published-media');

-- Only the service role (used by the cron job and admin-client server code)
-- writes to this bucket — no authenticated-user INSERT/DELETE policy is
-- needed since there is no client-side upload path for it.
