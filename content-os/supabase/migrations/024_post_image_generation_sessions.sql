-- 024_post_image_generation_sessions.sql
-- Tracks how many times POST /api/v1/ai/post-image/generate has been
-- called for a given "post generation session" (created once per Generate
-- full post click), so the "Regenerate image" button can be free on its
-- first press and charged (via checkAndIncrementUsage, same as any other
-- generation) from the second press onward. Entirely server-counted --
-- trusting a client-supplied "is this a regenerate" flag would be
-- trivially spoofable to get free generations, so the server counts actual
-- calls per session instead.

CREATE TABLE public.post_image_generation_sessions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  image_generation_count  INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.post_image_generation_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_post_image_generation_sessions" ON public.post_image_generation_sessions FOR ALL USING (
  user_id = auth.uid()
);
