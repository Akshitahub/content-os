-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
--
-- Rate limiting without Redis (lib/security/rate-limit.ts): one row per
-- key per fixed window, counted atomically by consume_rate_limit. Only the
-- service role touches it -- RLS on with no policies, and the function's
-- EXECUTE revoked from every client role. Until this runs, the limiter fails
-- open (every request allowed, the error logged). Rows older than a day are
-- deleted by the cleanup-abandoned-drafts cron.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_rate_limit(p_key text, p_limit int, p_window_seconds int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start timestamptz := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
  v_count int;
BEGIN
  INSERT INTO public.rate_limits (key, window_start, count)
  VALUES (p_key, v_window_start, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
  RETURNING count INTO v_count;
  RETURN v_count <= p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_rate_limit(text, int, int) FROM public, anon, authenticated;
