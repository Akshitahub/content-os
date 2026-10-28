-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
--
-- What happens to generated content after it's made, as events, so quality
-- can be measured (app/admin/(panel)/metrics, lib/admin/metrics.ts) instead
-- of eyeballed: generated / regenerated / edited / saved / scheduled /
-- rated / downloaded, per content item. Written fire-and-forget by
-- lib/usage/content-events.ts's recordContentEvent -- a failed write never
-- affects the request that triggered it. Until this runs, those writes just
-- log an error and the metrics page shows no data.
--
-- content_type: 'caption' | 'hook' | 'carousel' | 'story' | 'ad_copy' | 'post_image' | 'ad_maker'
-- event:        'generated' | 'regenerated' | 'edited' | 'saved' | 'scheduled' | 'rated' | 'downloaded'
-- (plain text, not CHECKed, same as brand_lessons). content_id is the
-- content row's id where one exists (null for Ad Maker, which has no row).
-- meta never holds generated or user-written content -- only model/cost,
-- the rating, or the NAMES of fields that changed.
CREATE TABLE public.content_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  content_id UUID,
  event TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_content_events_brand_type_created ON public.content_events(brand_id, content_type, created_at);

ALTER TABLE public.content_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_content_events" ON public.content_events FOR ALL USING (
  brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid())
);
