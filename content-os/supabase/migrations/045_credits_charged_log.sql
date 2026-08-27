-- 045_credits_charged_log.sql
-- ai_generation_logs tracks user_id, brand_id, feature, model, tokens,
-- cost_usd, success, and created_at for every generation, but never the
-- actual credit amount charged -- there's no way to answer "where are my
-- credits going" without it. Nullable: existing historical rows predate
-- this column and won't have a value, only going-forward rows need to be
-- complete (see lib/usage/check-and-increment-usage.ts, the single shared
-- choke point every generation route charges through, which is what
-- starts populating this from here on).
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.

ALTER TABLE public.ai_generation_logs
  ADD COLUMN credits_charged INTEGER;
