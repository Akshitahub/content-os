-- 015_linkedin_zernio_connections.sql
-- LinkedIn is connected via Zernio (a unified social media API) rather
-- than a direct LinkedIn OAuth app, since LinkedIn's own Community
-- Management API requires a registered legal business entity we don't
-- have yet. Zernio has already been through that approval process
-- themselves; we're a customer of theirs, not applying to LinkedIn
-- directly. Unlike Threads/Pinterest, we never see a LinkedIn access
-- token at all -- Zernio holds and manages it, we just reference their
-- account_id.

ALTER TABLE public.social_connections
DROP CONSTRAINT IF EXISTS social_connections_platform_check;

ALTER TABLE public.social_connections
ADD CONSTRAINT social_connections_platform_check CHECK (platform IN ('instagram', 'threads', 'pinterest', 'linkedin'));

ALTER TABLE public.social_connections
ADD COLUMN IF NOT EXISTS zernio_profile_id TEXT,
ADD COLUMN IF NOT EXISTS zernio_account_id TEXT,
ADD COLUMN IF NOT EXISTS linkedin_username TEXT;

ALTER TABLE public.social_connections
ALTER COLUMN access_token DROP NOT NULL;
