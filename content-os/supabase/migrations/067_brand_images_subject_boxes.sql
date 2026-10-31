-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
--
-- Text never sits on the subject (lib/image/story-frame-compositor.ts):
-- each brand photo stores where its subject is -- faces, torsos, hips, the
-- product -- as boxes in fractions of the image, e.g.
--   [{"x":0.36,"y":0.06,"w":0.28,"h":0.92,"label":"torso"}]
-- found once when the photo is classified (lib/image/subject-boxes.ts: one
-- vision call, or a local pass without one). Photos classified before this
-- get theirs from the weekly photo refresh. Until this runs (or while a
-- photo has none), the boxes are found at render time by the local pass.

ALTER TABLE public.brand_images ADD COLUMN IF NOT EXISTS subject_boxes jsonb;
