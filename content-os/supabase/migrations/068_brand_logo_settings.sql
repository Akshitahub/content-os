-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
--
-- Brand settings -> "Brand logo" (app/api/v1/brands/[brandId]/logo):
-- the uploaded logo replaces logo_url; logo_variant_url is its one-colour
-- contrast variant (light for a dark logo, dark for a light one) so the
-- logo reads on any photo. logo_on_posts turns the logo off on posts,
-- carousel first / last slides and story hook / CTA frames; logo_position
-- picks its corner ("auto" = the empty corner farthest from the headline).
-- Until this runs, an uploaded logo still replaces logo_url, the logo is
-- shown, and its corner is chosen automatically.

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS logo_variant_url text,
  ADD COLUMN IF NOT EXISTS logo_on_posts boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS logo_position text NOT NULL DEFAULT 'auto'
    CHECK (logo_position IN ('auto', 'top-left', 'top-right', 'bottom-left', 'bottom-right'));
