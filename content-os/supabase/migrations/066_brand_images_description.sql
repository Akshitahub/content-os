-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
--
-- A brand photo is only used when it fits the post (lib/ai/photo-fit.ts):
-- each photo gets one plain line saying what it shows -- the subject, the
-- setting, any people, the product if visible -- written by the same vision
-- call that classifies it (lib/brand-photos.ts). Photos classified before
-- this get theirs from the weekly photo refresh. Until this runs (or while a
-- photo has none), no photo can pass the fit check and images are
-- generated from the brief, as before 064.

ALTER TABLE public.brand_images ADD COLUMN IF NOT EXISTS description text;
