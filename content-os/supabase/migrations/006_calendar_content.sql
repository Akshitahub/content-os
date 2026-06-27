-- 006_calendar_content.sql
-- Add rich content fields to calendar_entries for Fastlane-generated posts

ALTER TABLE public.calendar_entries
ADD COLUMN IF NOT EXISTS hook_text TEXT,
ADD COLUMN IF NOT EXISTS caption_text TEXT,
ADD COLUMN IF NOT EXISTS hashtags TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS visual_direction TEXT,
ADD COLUMN IF NOT EXISTS audio_suggestion TEXT,
ADD COLUMN IF NOT EXISTS content_type_detail TEXT,
ADD COLUMN IF NOT EXISTS hook_id UUID REFERENCES public.hooks(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS caption_id UUID REFERENCES public.captions(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS is_ready BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS platform_specific_data JSONB DEFAULT '{}';

-- Backfill is_ready for existing content_ready/published entries
UPDATE public.calendar_entries
SET is_ready = true
WHERE status IN ('content_ready', 'scheduled', 'published');
