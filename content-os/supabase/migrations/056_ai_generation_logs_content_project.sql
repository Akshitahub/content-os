-- 056_ai_generation_logs_content_project.sql
-- Per-post cost tracking: links each ai_generation_logs row to the
-- content_projects row (one Post) it was spent on, so total cost / tokens /
-- latency per completed post can be computed.
--
-- Only Create -> Full Post (fullpost/generate, fullpost/generate-from-photo)
-- and its image step (post-image/generate) write this today -- those are
-- the flows that create a content_projects row. Story, Carousel and
-- Autopilot slots don't create one, so their rows stay NULL.
--
-- Safe for existing data: the column is NULLABLE with no default, so every
-- existing row simply reads NULL; no backfill, no table rewrite. ON DELETE
-- SET NULL keeps the log row (and its cost) if a project is deleted. The
-- admin dashboard's queries (lib/admin/dashboard-stats.ts: row counts and
-- the cost_usd sum) don't reference this column and are unaffected.
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment. The app
-- tolerates this column not existing yet (see logGenerationOutcome in
-- lib/usage/check-and-increment-usage.ts), so deploy order doesn't matter.

ALTER TABLE public.ai_generation_logs
  ADD COLUMN IF NOT EXISTS content_project_id UUID
    REFERENCES public.content_projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ai_generation_logs_content_project_id_idx
  ON public.ai_generation_logs (content_project_id)
  WHERE content_project_id IS NOT NULL;

-- One row per post: everything spent on it, failures and retries included
-- (they were billed too). total_latency_ms is the SUM of every call's own
-- latency, not wall-clock time -- the hooks and caption calls overlap.
--
-- security_invoker = true: the view runs with the querying user's
-- permissions, so ai_generation_logs' existing RLS policy
-- ("users_own_logs") still applies -- a logged-in user can only ever see
-- their own posts' rows, anon sees nothing. The admin panel reads it with
-- the service-role client, which bypasses RLS, same as every other admin
-- query.
CREATE OR REPLACE VIEW public.ai_generation_cost_by_project
WITH (security_invoker = true) AS
SELECT
  content_project_id,
  user_id,
  COUNT(*)::INTEGER                       AS log_rows,
  COUNT(*) FILTER (WHERE NOT success)::INTEGER AS failed_rows,
  SUM(cost_usd)                           AS total_cost_usd,
  SUM(prompt_tokens)::BIGINT              AS prompt_tokens,
  SUM(completion_tokens)::BIGINT          AS completion_tokens,
  SUM(total_tokens)::BIGINT               AS total_tokens,
  SUM(latency_ms)::BIGINT                 AS total_latency_ms,
  MIN(created_at)                         AS first_logged_at,
  MAX(created_at)                         AS last_logged_at
FROM public.ai_generation_logs
WHERE content_project_id IS NOT NULL
GROUP BY content_project_id, user_id;

-- Defense in depth: never expose this to logged-out API callers at all.
REVOKE ALL ON public.ai_generation_cost_by_project FROM anon;
