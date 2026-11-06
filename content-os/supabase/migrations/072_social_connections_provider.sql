-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
--
-- Direct Instagram connector (lib/social/meta-instagram-client.ts): a
-- connection is now either held by Zernio (as every row is today -- Zernio
-- keeps the token, we keep its account id) or made directly with Meta's
-- Instagram API with Instagram Login, where we hold the long-lived token
-- ourselves, encrypted (lib/social/token-crypto.ts). Existing rows default
-- to 'zernio', so they keep working exactly as before.

ALTER TABLE public.social_connections
ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'zernio' CHECK (provider IN ('zernio', 'meta'));

-- Zernio rows store no token and no expiry. Both are no-ops if already nullable.
ALTER TABLE public.social_connections
ALTER COLUMN access_token DROP NOT NULL;

ALTER TABLE public.social_connections
ALTER COLUMN token_expires_at DROP NOT NULL;
