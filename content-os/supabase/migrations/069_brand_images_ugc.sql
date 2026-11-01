-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
--
-- Customer photos (UGC): media where a brand is tagged or mentioned on
-- Instagram, stored in brand_images with source 'ugc', the creator's
-- handle and whether the creator agreed to a repost. The owner asks by DM
-- themselves (SocioPosts never sends DMs) and taps "They said yes" ->
-- 'granted'. Generated content only ever uses a UGC photo whose
-- rights_status is 'granted' (lib/brand-photos.ts loadBrandPhotos).
-- Until this runs, no UGC is stored and photo picking is unchanged.

ALTER TABLE public.brand_images DROP CONSTRAINT IF EXISTS brand_images_source_check;
ALTER TABLE public.brand_images
  ADD CONSTRAINT brand_images_source_check CHECK (source IN ('website', 'instagram', 'upload', 'ugc'));

ALTER TABLE public.brand_images
  ADD COLUMN IF NOT EXISTS creator_handle text,
  ADD COLUMN IF NOT EXISTS permalink text,
  ADD COLUMN IF NOT EXISTS rights_status text
    CHECK (rights_status IN ('none', 'requested', 'granted', 'declined')),
  ADD COLUMN IF NOT EXISTS rights_updated_at timestamptz;

-- Every UGC row says where its rights stand; other sources leave it null.
ALTER TABLE public.brand_images DROP CONSTRAINT IF EXISTS brand_images_ugc_rights_check;
ALTER TABLE public.brand_images
  ADD CONSTRAINT brand_images_ugc_rights_check CHECK (source <> 'ugc' OR (rights_status IS NOT NULL AND creator_handle IS NOT NULL));
