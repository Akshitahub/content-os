-- 028_reel_video_jobs_calendar_entry.sql
-- Autopilot (lib/ai/fastlane.ts's executeFastlane) creates a reel_video_jobs
-- row and a calendar_entries row for the same reel together, then needs to
-- write the finished video's URL (or failure) back into that calendar
-- entry's platform_specific_data once generation completes. Previously that
-- "wait for completion, then update the calendar entry" logic was
-- duplicated inline in fastlane.ts's own renderAutopilotReel. Now that
-- completion is webhook-driven and centralized in
-- app/api/v1/webhooks/kling/route.ts (shared by both the manual
-- reel-scripts/video route and Autopilot), that webhook needs a way to
-- find the right calendar entry for a job — this column is that link.
-- Null for manually-generated reels, which have no calendar entry yet at
-- generation time.

ALTER TABLE public.reel_video_jobs
  ADD COLUMN calendar_entry_id UUID REFERENCES public.calendar_entries(id) ON DELETE SET NULL;
