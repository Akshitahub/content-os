-- ============================================================
-- AI Content OS — Generated Images
-- Run this in the Supabase SQL Editor after 001_initial_schema.sql
-- ============================================================

-- GENERATED IMAGES
CREATE TABLE public.generated_images (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_project_id UUID REFERENCES public.content_projects(id) ON DELETE SET NULL,
  brand_id        UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES public.products(id) ON DELETE SET NULL,
  prompt          TEXT NOT NULL,
  style           TEXT,
  aspect_ratio    TEXT DEFAULT '1:1' CHECK (aspect_ratio IN ('1:1','4:5','9:16','16:9')),
  storage_path    TEXT NOT NULL,
  public_url      TEXT NOT NULL,
  model_used      TEXT DEFAULT 'imagen-4.0-generate-001',
  is_saved        BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.generated_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_images" ON public.generated_images FOR ALL USING (
  brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid())
);

-- ============================================================
-- STORAGE — bucket for generated brand images
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-images', 'brand-images', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone can view (bucket is public — generated images are meant to be used in posts)
CREATE POLICY "public_read_brand_images" ON storage.objects FOR SELECT
  USING (bucket_id = 'brand-images');

-- Only authenticated users can upload into their own user-id-prefixed folder
CREATE POLICY "users_upload_own_brand_images" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'brand-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "users_delete_own_brand_images" ON storage.objects FOR DELETE
  USING (
    bucket_id = 'brand-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
