-- 007_social_connections.sql
-- Stores connected social platform accounts (Instagram Business, via Meta Graph API)
-- for auto-posting. access_token is sensitive and must only ever be read by
-- trusted server-side code — never returned in a client-facing API response.

CREATE TABLE public.social_connections (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id                UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  platform                TEXT NOT NULL CHECK (platform IN ('instagram')),
  ig_business_account_id  TEXT NOT NULL,
  ig_username             TEXT,
  facebook_page_id        TEXT NOT NULL,
  access_token            TEXT NOT NULL,
  token_expires_at        TIMESTAMPTZ NOT NULL,
  connected_at            TIMESTAMPTZ DEFAULT NOW(),
  last_refreshed_at       TIMESTAMPTZ DEFAULT NOW(),
  is_active               BOOLEAN DEFAULT true,
  UNIQUE(brand_id, platform)
);

ALTER TABLE public.social_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_social_connections" ON public.social_connections FOR ALL USING (
  brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid())
);
