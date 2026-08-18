-- 027_reel_video_job_scenes.sql
-- One row per scene within a reel_video_jobs job — tracks the async
-- webhook-driven Kling video generation for that scene independently. This
-- exists because the video route no longer polls Kling inline (see
-- lib/video/kling-client.ts / app/api/v1/webhooks/kling/route.ts): each
-- scene gets its own PiAPI Kling task, submitted with a webhook_config, and
-- the webhook receiver updates exactly one row per callback. A dedicated
-- table (rather than mutating reel_video_jobs.scene_assets JSONB in place)
-- avoids read-modify-write races between concurrently-arriving webhook
-- deliveries for different scenes of the same job — each webhook only ever
-- touches its own single row.

CREATE TABLE public.reel_video_job_scenes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID NOT NULL REFERENCES public.reel_video_jobs(id) ON DELETE CASCADE,
  scene_index       INTEGER NOT NULL,
  visual_direction  TEXT NOT NULL,
  voiceover_text    TEXT NOT NULL,
  duration_seconds  INTEGER NOT NULL,
  -- PiAPI Kling task id for this scene's video generation. Null only when
  -- the submit call itself failed outright (never got a task_id at all) —
  -- that scene goes straight to 'failed' with no webhook ever expected.
  kling_task_id     TEXT,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  video_url         TEXT,
  -- Generated synchronously (Groq TTS) at submission time, independent of
  -- Kling's async status — populated before the row's status is ever
  -- anything other than 'pending', not updated by the webhook.
  audio_url         TEXT,
  error_message     TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (job_id, scene_index)
);

-- Webhook lookups are always by kling_task_id, never by id/job_id.
CREATE INDEX idx_reel_video_job_scenes_kling_task_id ON public.reel_video_job_scenes (kling_task_id);
CREATE INDEX idx_reel_video_job_scenes_job_id ON public.reel_video_job_scenes (job_id);

ALTER TABLE public.reel_video_job_scenes ENABLE ROW LEVEL SECURITY;

-- Same ownership chain as reel_video_jobs itself (brand -> user). The
-- webhook receiver always uses the admin client and bypasses this, same as
-- every other webhook route in this codebase (see app/api/v1/billing/webhook).
CREATE POLICY "users_own_reel_video_job_scenes" ON public.reel_video_job_scenes FOR ALL USING (
  job_id IN (
    SELECT rvj.id FROM public.reel_video_jobs rvj
    JOIN public.brands b ON b.id = rvj.brand_id
    WHERE b.user_id = auth.uid()
  )
);

CREATE TRIGGER update_reel_video_job_scenes_updated_at
  BEFORE UPDATE ON public.reel_video_job_scenes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
