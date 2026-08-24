-- 034_generated_images_text_composited.sql
-- Text overlay on a generated post image is now fully opt-in (previously
-- always auto-injected a headline from the picked hook + a CTA badge, with
-- no way to opt out). Records whether THIS specific image actually had
-- text composited onto it, so that signal isn't lost now that "no text"
-- is a real, common outcome rather than something that never happened.
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor — no
-- automated migration runner is wired up in this environment.

ALTER TABLE public.generated_images
ADD COLUMN IF NOT EXISTS text_composited BOOLEAN NOT NULL DEFAULT false;
