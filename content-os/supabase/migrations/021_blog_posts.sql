-- 021_blog_posts.sql
-- Dedicated table for the new Blog Post content type in the Create tab.
-- Mirrors the shape/RLS pattern already used by captions/reel_scripts/carousels
-- (see migration 011_stories_table.sql) rather than the updated_at-based
-- schema initially floated for this feature -- these content tables track
-- freshness via last_accessed_at (which drives the abandoned-drafts
-- cleanup cron), not a general-purpose updated_at column.

CREATE TABLE public.blog_posts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  user_prompt       TEXT NOT NULL,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  meta_description  TEXT,
  suggested_tags    TEXT[] DEFAULT '{}',
  is_saved          BOOLEAN DEFAULT true,
  user_rating       INTEGER CHECK (user_rating BETWEEN 1 AND 5),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  last_accessed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_blog_posts" ON public.blog_posts FOR ALL USING (
  brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid())
);
