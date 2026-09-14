-- Caches ONE auto-generated draft post per brand per IST calendar day, so
-- the redesigned dashboard hero can show a real, ready-to-send post
-- without re-charging (or re-generating) on every page load. See
-- lib/dashboard/get-or-create-daily-draft.ts, the only reader/writer of
-- this table -- it queries/inserts by (brand_id, draft_date) directly, no
-- separate service layer.
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
CREATE TABLE public.daily_draft_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  draft_date DATE NOT NULL,
  hook_text TEXT NOT NULL,
  caption_text TEXT NOT NULL,
  hashtags TEXT[] DEFAULT '{}',
  image_url TEXT,
  content_project_id UUID REFERENCES public.content_projects(id) ON DELETE SET NULL,
  -- Set (with hook_text/caption_text left empty) when generation failed
  -- after a credit charge, or when there weren't enough credits to charge
  -- at all -- either way, this brand doesn't retry again today. See
  -- get-or-create-daily-draft.ts's own comment on why retrying every page
  -- load would be wrong.
  generation_failed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (brand_id, draft_date)
);

ALTER TABLE public.daily_draft_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_daily_draft_cache" ON public.daily_draft_cache FOR ALL USING (
  brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid())
);
