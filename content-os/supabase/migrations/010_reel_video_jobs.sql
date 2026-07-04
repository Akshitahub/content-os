-- 010_reel_video_jobs.sql
-- Tracks the async pipeline that turns a saved reel_scripts row into a
-- real video: per-scene AI image + TTS voiceover asset generation, then
-- (eventually) a Remotion render. The render step itself is not wired up
-- yet — see lib/video/render-trigger.ts — so status will currently stop
-- at 'assets_ready' rather than reaching 'completed'.

CREATE TABLE public.reel_video_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  reel_script_id    UUID NOT NULL REFERENCES public.reel_scripts(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (
                       status IN ('pending', 'generating_images', 'generating_voiceover', 'assets_ready', 'rendering', 'completed', 'failed')
                     ),
  progress_message  TEXT,
  scene_assets      JSONB DEFAULT '[]',
  music_url         TEXT,
  video_url         TEXT,
  error_message     TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.reel_video_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_reel_video_jobs" ON public.reel_video_jobs FOR ALL USING (
  brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid())
);

CREATE TRIGGER update_reel_video_jobs_updated_at
  BEFORE UPDATE ON public.reel_video_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
