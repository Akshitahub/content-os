-- 035_autopilot_run_status.sql
-- Autopilot's progress bar was purely a client-side setInterval animation
-- with nothing persisted server-side -- navigating away from
-- app/(dashboard)/brands/[brandId]/fastlane/page.tsx mid-run (or right
-- after it finished) destroyed all visibility into a run that may still be
-- executing, or may have already succeeded/failed, on the server, with
-- real credits already charged. This table gives a run a durable row that
-- survives navigation: lib/ai/fastlane.ts's executeFastlane() updates
-- completed_slots after each real batch and marks status done/error at the
-- end, and app/api/v1/brands/[brandId]/fastlane/status/route.ts lets the
-- frontend recover this on mount instead of pretending nothing happened.
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor — no
-- automated migration runner is wired up in this environment.

CREATE TABLE public.autopilot_run_status (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id         UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status           TEXT NOT NULL CHECK (status IN ('running', 'done', 'error')),
  total_slots      INTEGER NOT NULL,
  completed_slots  INTEGER NOT NULL DEFAULT 0,
  result           JSONB,
  error_message    TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ
);

-- The status route always wants "this brand's most recent run" — see
-- ORDER BY started_at DESC LIMIT 1 there.
CREATE INDEX idx_autopilot_run_status_brand_id_started_at
  ON public.autopilot_run_status (brand_id, started_at DESC);

ALTER TABLE public.autopilot_run_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_autopilot_run_status" ON public.autopilot_run_status FOR ALL USING (
  user_id = auth.uid()
);
