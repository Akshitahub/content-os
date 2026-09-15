-- Links a published calendar entry back to the real Instagram engagement
-- (likes, comments) it actually received, fetched via Zernio's analytics
-- API (lib/social/zernio-client.ts's listZernioPostAnalytics, already used
-- for the analytics dashboard/monthly report -- reused here, not
-- reimplemented) and stored by lib/social/engagement-sync.ts.
--
-- Schema choice: ONE row per calendar_entries.id (a real FK, not a
-- polymorphic content_type+content_id pair), not columns added onto each
-- of captions/hooks/carousels/stories/ad_copies/reel_scripts directly.
-- Reasoning: calendar_entries is the only row that reliably exists for
-- EVERY published piece of content regardless of type or which generation
-- path created it -- captions/hooks are the only two of those six tables
-- calendar_entries even has a column for (caption_id/hook_id), and even
-- those two are only populated by the Autopilot/direct-generation insert
-- paths, not by app/api/v1/calendar/schedule-post/route.ts's manual
-- "schedule from Library" path, which never records which caption/
-- carousel/story row a scheduled post came from at all. carousels,
-- stories, and ad_copies have no calendar_entries column and no reverse
-- link back to it either. Anchoring on calendar_entries.id sidesteps that
-- gap entirely instead of leaving 4+ content types with nowhere to write
-- engagement data. See docs comment in lib/social/engagement-sync.ts for
-- the full per-content-type breakdown of what is and isn't linkable today.
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
CREATE TABLE public.content_engagement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_entry_id UUID NOT NULL UNIQUE REFERENCES public.calendar_entries(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  -- The Zernio analytics item's own permalink/post URL, once matched --
  -- there is no shared id between what publishViaZernio returns at
  -- publish time (Zernio's own internal post _id) and what
  -- listZernioPostAnalytics returns per item (platformPostUrl, publishedAt,
  -- content), so the FIRST match for a given calendar entry is found by a
  -- best-effort heuristic (same brand + platform + caption-text overlap +
  -- published-time proximity — see engagement-sync.ts). Storing the
  -- matched URL here lets every later refresh for this same entry match
  -- directly instead of re-running that heuristic every time.
  platform_post_url TEXT,
  like_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  -- Deliberately a plain like_count + comments_count sum, not a weighted
  -- formula -- an honest total, not an invented scoring model. Kept as its
  -- own column (rather than always recomputed from the two counts above)
  -- so a future, more considered scoring formula can be swapped in later
  -- without a schema change.
  engagement_score INTEGER NOT NULL DEFAULT 0,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_content_engagement_brand ON public.content_engagement(brand_id);

ALTER TABLE public.content_engagement ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_content_engagement" ON public.content_engagement FOR ALL USING (
  brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid())
);
