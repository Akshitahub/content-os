-- Captures the "why" behind a low (1-2 star) rating, not just the score --
-- lib/ai/pattern-match.ts's buildPatternNote and lib/ai/
-- semantic-pattern-match.ts's buildSemanticPatternNote (captions only, so
-- far) can currently only ever see a number; there's nowhere a user's
-- actual explanation ("felt too salesy", "wrong tone for this brand") gets
-- captured at all. This pass only captures that data -- nothing here is
-- wired into generation yet (see app/api/v1/brands/[brandId]/captions/
-- [captionId]/route.ts and .../hooks/[hookId]/route.ts's PUT handlers, the
-- only two writers today), same phased approach content_engagement.sql
-- already took: link/capture first, wire into generation later.
--
-- Schema choice: content_type (text) + content_id (uuid, no FK) rather
-- than a real per-table FK -- deliberately polymorphic, same reasoning
-- content_engagement.sql already needed calendar_entries.id to sidestep:
-- captions/hooks/carousels/stories/ad_copies/reel_scripts/etc. are all
-- separate tables with no shared parent to hang one real FK off of, and a
-- feedback note genuinely can apply to any of them (this pass only ever
-- writes content_type "caption"/"hook", but the shape doesn't hard-code
-- that). Deliberately NOT anchored to calendar_entries like
-- content_engagement is, though -- ratings happen directly on saved
-- Library items, most of which are never scheduled at all, so anchoring
-- there would leave the vast majority of ratings with nowhere to attach a
-- note.
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
CREATE TABLE public.content_feedback_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  content_id UUID NOT NULL,
  rating INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_content_feedback_notes_brand ON public.content_feedback_notes(brand_id);
-- Supports the eventual "pull this piece of content's own past feedback
-- notes" lookup a future generation-time wiring pass will need -- nothing
-- reads by this yet in this pass.
CREATE INDEX idx_content_feedback_notes_content ON public.content_feedback_notes(content_type, content_id);

ALTER TABLE public.content_feedback_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_content_feedback_notes" ON public.content_feedback_notes FOR ALL USING (
  brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid())
);
