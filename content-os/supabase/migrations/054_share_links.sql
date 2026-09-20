-- 054_share_links.sql
-- Backs the "Copy preview link" action (replacing "Share to WhatsApp"
-- everywhere content is shared -- library card menus, the dashboard's
-- daily-draft card) with a real public, read-only preview page
-- (app/p/[token]/page.tsx) instead of a wa.me deep link, which only ever
-- worked on a device with WhatsApp installed and produced no rich preview
-- card when pasted anywhere. Same polymorphic content_type + content_id
-- shape as content_feedback_notes.sql (migration 053) -- captions/
-- carousels/stories/ad_copies/the daily draft cache are all separate
-- tables with no shared parent to hang one real FK off of, and a share
-- link genuinely needs to point at any of them.
--
-- token is looked up by the PUBLIC page (app/p/[token]/page.tsx) with no
-- logged-in user at all, via the service-role client (createAdminClient in
-- lib/supabase/server.ts), which bypasses RLS entirely -- the RLS policies
-- below only ever govern the OWNER-facing side (creating/listing/revoking
-- your own links from POST /api/v1/share and the Library UI). There is no
-- public SELECT policy on this table on purpose: a logged-out visitor's
-- browser never queries share_links directly, only the server-rendered
-- public page does, server-side, with the service role.
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
CREATE TABLE public.share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- crypto.randomBytes(20).toString("base64url") -- 20 random bytes, never
  -- sequential or derived from content_id (see lib/share/tokens.ts).
  token TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  content_id UUID NOT NULL,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set explicitly by the API at insert time (created_at + 30 days), not a
  -- DB-side default expression -- keeps the window a one-line change in
  -- app/api/v1/share/route.ts instead of a future migration.
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX idx_share_links_token ON public.share_links(token);
-- Supports "reuse an existing non-expired, non-revoked link for this
-- content instead of creating a duplicate" (POST /api/v1/share's own
-- lookup) and the Library UI's "Link active until <date>" status check.
CREATE INDEX idx_share_links_content ON public.share_links(content_type, content_id);
CREATE INDEX idx_share_links_brand ON public.share_links(brand_id);

ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;

-- Owners only -- no public access to this table at all (see the file
-- header comment above for why the public preview page doesn't need one).
CREATE POLICY "users_select_own_share_links" ON public.share_links FOR SELECT USING (
  brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid())
);
CREATE POLICY "users_insert_own_share_links" ON public.share_links FOR INSERT WITH CHECK (
  brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid())
);
CREATE POLICY "users_update_own_share_links" ON public.share_links FOR UPDATE USING (
  brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid())
);

-- Per-user daily rate limit for POST /api/v1/share, same reset-window
-- pattern as schedule_post_count_today/outreach_email_count_today
-- (migration 022_abuse_rate_limits.sql) -- bounds automated abuse (minting
-- links in a loop) without tying into the generation-credit system, since
-- creating a share link for already-generated content isn't a generation.
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS share_link_count_today INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS share_link_count_reset_at TIMESTAMPTZ;
