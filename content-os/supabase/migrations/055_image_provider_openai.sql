-- 055_image_provider_openai.sql
-- Image generation migrated from Replicate's Flux 2 Pro to OpenAI's
-- gpt-image-2 (see lib/ai/image-provider.ts) -- the new provider writes
-- provider="openai" instead of "flux", and can report a
-- failure_reason="moderation_blocked" (a real failure mode this provider
-- has that the old table never needed to represent) or "blurry" (already a
-- real ImageAttemptFailureReason in lib/ai/post-image-pipeline.ts, but
-- never added to this CHECK when 031_image_generation_observability.sql
-- first created this table -- a pre-existing gap, not something this
-- migration introduces).
--
-- Purely additive: widens two CHECK constraints to allow new values.
-- Historical rows ("flux", "pollinations", any existing failure_reason)
-- are untouched -- nothing here rewrites existing data.
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor — no
-- automated migration runner is wired up in this environment.

ALTER TABLE public.image_generation_attempts
DROP CONSTRAINT IF EXISTS image_generation_attempts_provider_check;

ALTER TABLE public.image_generation_attempts
ADD CONSTRAINT image_generation_attempts_provider_check
CHECK (provider IN ('pollinations', 'flux', 'openai'));

ALTER TABLE public.image_generation_attempts
DROP CONSTRAINT IF EXISTS image_generation_attempts_failure_reason_check;

ALTER TABLE public.image_generation_attempts
ADD CONSTRAINT image_generation_attempts_failure_reason_check
CHECK (failure_reason IN ('too_small', 'near_black', 'near_blank', 'blurry', 'unreadable', 'network_error', 'api_error', 'moderation_blocked') OR failure_reason IS NULL);
