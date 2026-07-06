-- 016_youtube_zernio_connections.sql
-- YouTube, like LinkedIn, is connected via Zernio rather than a direct
-- API integration -- this avoids the shared-quota bottleneck of YouTube's
-- own Data API v3 (limited daily uploads shared across the whole app),
-- since Zernio operates its own separate infrastructure with Google.

ALTER TABLE public.social_connections
DROP CONSTRAINT IF EXISTS social_connections_platform_check;

ALTER TABLE public.social_connections
ADD CONSTRAINT social_connections_platform_check CHECK (platform IN ('instagram', 'threads', 'pinterest', 'linkedin', 'youtube'));

ALTER TABLE public.social_connections
ADD COLUMN IF NOT EXISTS youtube_channel_name TEXT;
