-- 013_threads_connections.sql
-- Threads uses entirely separate OAuth credentials (THREADS_APP_ID/SECRET,
-- distinct from the main Meta app) and its own token system -- unlike
-- Facebook, which shares a token with the existing Instagram row, Threads
-- needs to be its own row type.

ALTER TABLE public.social_connections
DROP CONSTRAINT IF EXISTS social_connections_platform_check;

ALTER TABLE public.social_connections
ADD CONSTRAINT social_connections_platform_check CHECK (platform IN ('instagram', 'threads'));

ALTER TABLE public.social_connections
ADD COLUMN IF NOT EXISTS threads_user_id TEXT,
ADD COLUMN IF NOT EXISTS threads_username TEXT;

ALTER TABLE public.social_connections
ALTER COLUMN facebook_page_id DROP NOT NULL;
