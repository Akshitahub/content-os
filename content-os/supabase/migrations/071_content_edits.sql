-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
--
-- Learning from the client's own edits (lib/ai/edit-learning.ts): when an
-- owner rewrites a caption, hook or headline before approving or scheduling
-- it (calendar panel, carousel / story editors, Full Post), the before /
-- after pair is kept here -- small touch-ups (under ~15% of words changed)
-- are not. Every 5 new pairs per brand, one model call distils what they
-- have in common into brand_lessons (source 'edits') through the same
-- merge / create / skip decision feedback notes use; distilled_at marks the
-- pairs already used. Until this runs, edits are simply not recorded.

CREATE TABLE IF NOT EXISTS public.content_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- calendar | carousel | story | full_post
  surface text NOT NULL,
  -- caption | hook | headline
  field text NOT NULL CHECK (field IN ('caption', 'hook', 'headline')),
  content_type text,
  content_id uuid,
  before_text text NOT NULL,
  after_text text NOT NULL,
  -- Share of words changed, 0-1.
  change_ratio real NOT NULL,
  distilled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_edits_brand_pending_idx
  ON public.content_edits (brand_id, created_at) WHERE distilled_at IS NULL;

ALTER TABLE public.content_edits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_content_edits" ON public.content_edits FOR ALL USING (
  brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid())
);
