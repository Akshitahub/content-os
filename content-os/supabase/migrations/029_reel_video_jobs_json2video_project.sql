-- 029_reel_video_jobs_json2video_project.sql
-- JSON2Video's render step is now webhook-driven too (see
-- app/api/v1/webhooks/json2video/route.ts), submitted from
-- app/api/v1/webhooks/kling/route.ts once every scene is ready. JSON2Video
-- doesn't sign its webhooks at all ("Webhooks are not currently signed by
-- JSON2Video" — their own docs), so this column exists as a defense-in-
-- depth check: the project id stored here at submit time must match the
-- project id in an incoming webhook payload before it's trusted, on top of
-- the unguessable-token query param and the mandatory GET /v2/movies
-- re-fetch the receiver also does.

ALTER TABLE public.reel_video_jobs
  ADD COLUMN json2video_project_id TEXT;
