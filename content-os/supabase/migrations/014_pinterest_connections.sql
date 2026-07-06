-- 014_pinterest_connections.sql
-- Pinterest, like Threads, uses its own separate OAuth credentials and
-- token system, and additionally requires posting to a specific "board" --
-- a concept Instagram/Facebook/Threads don't have.

ALTER TABLE public.social_connections
DROP CONSTRAINT IF EXISTS social_connections_platform_check;

ALTER TABLE public.social_connections
ADD CONSTRAINT social_connections_platform_check CHECK (platform IN ('instagram', 'threads', 'pinterest'));

ALTER TABLE public.social_connections
ADD COLUMN IF NOT EXISTS pinterest_user_id TEXT,
ADD COLUMN IF NOT EXISTS pinterest_username TEXT,
ADD COLUMN IF NOT EXISTS pinterest_board_id TEXT,
ADD COLUMN IF NOT EXISTS pinterest_board_name TEXT,
ADD COLUMN IF NOT EXISTS refresh_token TEXT;
