-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
--
-- The brand's own real photos, collected automatically (lib/brand-photos.ts):
-- from its website (brands/import, plus a backfill and a re-run on website
-- change) and from its Instagram (own recent media via the active
-- Instagram social_connection), every image copied into our storage --
-- never hotlinked. Each is classified ONCE by a vision call.
--
-- kind / quality_ok / product_id / source / classified_at as specified;
-- external_id dedupes re-collection (website: hash of the source URL,
-- Instagram: the post + child), published_at lets generation skip photos
-- the brand itself posted in the last 30 days, storage_path is our copy,
-- last_used_at / use_count make pickBrandPhotos prefer unused photos.
-- brands.photos_synced_at drives the weekly refresh (new media only).
-- Until this runs, collection and pickBrandPhotos fail soft (no photos =
-- today's behaviour).

ALTER TABLE public.brand_images
  ADD COLUMN IF NOT EXISTS kind TEXT NULL
    CHECK (kind IN ('product_only', 'product_in_use', 'person', 'lifestyle', 'flatlay', 'graphic_or_text')),
  ADD COLUMN IF NOT EXISTS quality_ok BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS product_id UUID NULL REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'website'
    CHECK (source IN ('website', 'instagram', 'upload')),
  ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS external_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS storage_path TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS use_count INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS brand_images_brand_external_uniq
  ON public.brand_images (brand_id, external_id) WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS brand_images_pick_idx
  ON public.brand_images (brand_id, quality_ok, kind);

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS photos_synced_at TIMESTAMPTZ NULL;
