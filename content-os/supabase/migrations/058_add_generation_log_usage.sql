-- 058_add_generation_log_usage.sql
-- Atomic token/cost increment on one ai_generation_logs row. Background
-- Autopilot slots (lib/ai/autopilot-worker.ts recordSlotUsage) all add
-- their usage onto the run's single log row; the old read-modify-write
-- from the app lost additions when two slots finished at once. A single
-- UPDATE ... SET x = COALESCE(x, 0) + p_x row-locks and serializes instead.
--
-- MANUAL STEP REQUIRED: run this in the Supabase SQL Editor BEFORE
-- deploying the code that calls it.
CREATE OR REPLACE FUNCTION public.add_generation_log_usage(
  p_log_id UUID,
  p_prompt INTEGER,
  p_completion INTEGER,
  p_total INTEGER,
  p_cost NUMERIC
)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.ai_generation_logs
     SET prompt_tokens     = COALESCE(prompt_tokens, 0) + COALESCE(p_prompt, 0),
         completion_tokens = COALESCE(completion_tokens, 0) + COALESCE(p_completion, 0),
         total_tokens      = COALESCE(total_tokens, 0) + COALESCE(p_total, 0),
         cost_usd          = COALESCE(cost_usd, 0) + COALESCE(p_cost, 0)
   WHERE id = p_log_id;
$$;

REVOKE ALL ON FUNCTION public.add_generation_log_usage(UUID, INTEGER, INTEGER, INTEGER, NUMERIC)
  FROM PUBLIC, anon, authenticated;   -- service role (the autopilot worker) only
