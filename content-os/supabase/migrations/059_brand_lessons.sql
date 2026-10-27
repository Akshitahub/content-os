-- Per-brand "lessons": durable, general rules distilled from the brand
-- owner's own feedback (lib/ai/brand-brain.ts). content_feedback_notes
-- (053) keeps every raw note; this table keeps the short list of rules
-- those notes add up to -- a repeat complaint bumps an existing lesson's
-- evidence_count instead of adding a near-duplicate. Written today only by
-- distillLesson (after a 1-2 star rating with a note on a caption/hook, see
-- app/api/v1/brands/[brandId]/captions/[captionId]/route.ts and
-- .../hooks/[hookId]/route.ts) and scripts/backfill-brand-lessons.ts.
-- Not read by generation yet -- that's wired in a later pass, same phased
-- approach 053 took.
--
-- scope:  'all' | 'caption' | 'hook' | 'carousel' | 'story' | 'ad_copy' | 'image'
-- source: 'feedback_note' | 'low_rating' | 'edit' | 'image_reject' | 'engagement' | 'manual'
-- (plain text, not CHECKed, so new scopes/sources don't need a migration).
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
CREATE TABLE public.brand_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('avoid', 'do')),
  rule TEXT NOT NULL,
  source TEXT NOT NULL,
  evidence_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_brand_lessons_brand_status_scope ON public.brand_lessons(brand_id, status, scope);

ALTER TABLE public.brand_lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_brand_lessons" ON public.brand_lessons FOR ALL USING (
  brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid())
);
