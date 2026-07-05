-- 012_memes_table.sql
-- Meme Maker generates a real hosted image now but had no persistence
-- destination — this adds one, mirroring the stories/carousels table shape.

CREATE TABLE public.memes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  idea        TEXT NOT NULL,
  image_url   TEXT NOT NULL,
  top_text    TEXT,
  bottom_text TEXT,
  caption     TEXT,
  hashtags    JSONB NOT NULL DEFAULT '[]',
  is_saved    BOOLEAN DEFAULT true,
  user_rating INTEGER CHECK (user_rating BETWEEN 1 AND 5),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.memes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_memes" ON public.memes FOR ALL USING (
  brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid())
);
