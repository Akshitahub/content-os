-- 019_twitter_zernio_connections.sql
-- Twitter/X, like LinkedIn and YouTube, is connected via Zernio rather than
-- X's own official API -- X's write-access tier requires a separate paid
-- subscription on their end, independent of and in addition to Zernio's own
-- per-account cost. Zernio already supports Twitter/X in the same unified
-- API already used for LinkedIn/YouTube, so this reuses that existing
-- infrastructure and billing relationship rather than adding a new one.

ALTER TABLE public.social_connections
DROP CONSTRAINT IF EXISTS social_connections_platform_check;

ALTER TABLE public.social_connections
ADD CONSTRAINT social_connections_platform_check CHECK (platform IN ('instagram', 'threads', 'pinterest', 'linkedin', 'youtube', 'twitter'));

ALTER TABLE public.social_connections
ADD COLUMN IF NOT EXISTS twitter_username TEXT;
