-- 018_content_last_accessed.sql
-- Tracks genuine engagement (rating, copying, or otherwise interacting with
-- a piece of generated content) so abandoned drafts can be identified
-- honestly, distinct from content that's just sitting in a list.
--
-- Scoped to the 6 tables actually reachable from the "My Content" library
-- page today: captions, reel_scripts, carousels, stories, ad_copies, memes.
-- hooks, generated_images, and product_descriptions are deliberately
-- excluded -- the library page currently has no UI tab wired up to view or
-- interact with them at all, so there'd be no way for a user to ever "keep
-- them fresh," and every row would eventually be wrongly flagged as
-- abandoned regardless of whether anyone cares about it.

ALTER TABLE public.captions
ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.reel_scripts
ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.carousels
ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.stories
ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.ad_copies
ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.memes
ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now();
