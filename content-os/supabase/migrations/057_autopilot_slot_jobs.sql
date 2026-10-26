-- 057_autopilot_slot_jobs.sql
-- Background Autopilot: one job row per slot, drained by a Supabase Cron
-- job calling app/api/v1/cron/autopilot-drain (see the cron SQL in that
-- route's header comment). Each slot is generated, committed, charged and
-- saved independently:
--   - claim_autopilot_slots hands out slots with a lease (FOR UPDATE SKIP
--     LOCKED -- two workers never take the same slot; a crashed worker's
--     lease just expires and the slot is retried once).
--   - complete_autopilot_slot is the ONLY way a slot becomes 'done': it
--     checks the lease and charges the slot's credits atomically. The app
--     writes the slot's content only when it returns 'charged', so a
--     failed/expired slot can never save content or be charged twice.
--   - fail_autopilot_slot retries once, then fails the slot. Slots are
--     never charged before completion, so failing one is the refund.
--
-- MANUAL STEP REQUIRED: run this in the Supabase SQL Editor BEFORE
-- deploying the code that uses it, then create the cron job (separate SQL,
-- in app/api/v1/cron/autopilot-drain/route.ts) after deploying.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

ALTER TABLE public.autopilot_run_status
  ADD COLUMN IF NOT EXISTS failed_slots INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS params JSONB,   -- run inputs the drain needs (plan, platforms, vibe, focus areas)
  ADD COLUMN IF NOT EXISTS log_id UUID REFERENCES public.ai_generation_logs(id) ON DELETE SET NULL;
  -- one ai_generation_logs row per RUN (as today); each completed slot adds
  -- its credits to it, so the dashboard's row count doesn't inflate

CREATE TABLE public.autopilot_slot_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES public.autopilot_run_status(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  brand_id          UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  slot_index        INTEGER NOT NULL,
  slot              JSONB NOT NULL,          -- the planned ContentSlot
  credit_cost       INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
  attempts          INTEGER NOT NULL DEFAULT 0,
  lease_token       UUID,
  lease_expires_at  TIMESTAMPTZ,
  calendar_entry_id UUID REFERENCES public.calendar_entries(id) ON DELETE SET NULL,
  failure_reason    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, slot_index)
);
CREATE INDEX autopilot_slot_jobs_active_idx
  ON public.autopilot_slot_jobs (created_at, slot_index) WHERE status IN ('pending','running');
ALTER TABLE public.autopilot_slot_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read_own_slot_jobs" ON public.autopilot_slot_jobs
  FOR SELECT USING (user_id = auth.uid());   -- writes only via the functions below / service role

-- Marks a run done once no slot is pending or running.
CREATE OR REPLACE FUNCTION public.finish_autopilot_run_if_done(p_run_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.autopilot_run_status r
     SET status = 'done', completed_at = NOW()
   WHERE r.id = p_run_id AND r.status = 'running'
     AND NOT EXISTS (SELECT 1 FROM public.autopilot_slot_jobs j
                      WHERE j.run_id = p_run_id AND j.status IN ('pending','running'));
END $$;

-- Hands out up to p_limit slots (never one another worker holds) with a
-- fresh lease. A slot whose lease expired is retried once; after its
-- second attempt it's failed instead (never charged, so nothing to refund).
CREATE OR REPLACE FUNCTION public.claim_autopilot_slots(p_limit INTEGER, p_max_running INTEGER, p_lease_seconds INTEGER)
RETURNS SETOF public.autopilot_slot_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_free INTEGER; v_run UUID;
BEGIN
  FOR v_run IN
    UPDATE public.autopilot_slot_jobs
       SET status = 'failed', failure_reason = 'timed out twice', lease_token = NULL, updated_at = NOW()
     WHERE status = 'running' AND lease_expires_at < NOW() AND attempts >= 2
    RETURNING run_id
  LOOP
    UPDATE public.autopilot_run_status SET failed_slots = failed_slots + 1 WHERE id = v_run;
    PERFORM public.finish_autopilot_run_if_done(v_run);
  END LOOP;

  SELECT GREATEST(0, p_max_running - COUNT(*)) INTO v_free
    FROM public.autopilot_slot_jobs WHERE status = 'running' AND lease_expires_at >= NOW();

  RETURN QUERY
  UPDATE public.autopilot_slot_jobs j
     SET status = 'running', attempts = j.attempts + 1, lease_token = gen_random_uuid(),
         lease_expires_at = NOW() + make_interval(secs => p_lease_seconds), updated_at = NOW()
   WHERE j.id IN (
     SELECT id FROM public.autopilot_slot_jobs
      WHERE status = 'pending' OR (status = 'running' AND lease_expires_at < NOW())
      ORDER BY created_at, slot_index
      LIMIT LEAST(p_limit, v_free)
      FOR UPDATE SKIP LOCKED)
  RETURNING j.*;
END $$;

-- The only way a slot becomes 'done': valid lease + atomic charge, in one
-- transaction. The app writes the slot's content ONLY when this returns
-- 'charged' -- so a refunded/expired/failed slot can never save content.
-- p_limit = the user's credit limit (computed in app, as today); NULL =
-- internal unlimited account, never charged.
CREATE OR REPLACE FUNCTION public.complete_autopilot_slot(p_slot_id UUID, p_lease_token UUID, p_limit INTEGER)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.autopilot_slot_jobs; v_charged INTEGER;
BEGIN
  SELECT * INTO j FROM public.autopilot_slot_jobs WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND OR j.status <> 'running' OR j.lease_token IS DISTINCT FROM p_lease_token OR j.lease_expires_at < NOW() THEN
    RETURN 'lease_lost';
  END IF;
  IF p_limit IS NOT NULL THEN
    SELECT COUNT(*) INTO v_charged FROM public.charge_generation_usage(j.user_id, j.credit_cost, p_limit);
    IF v_charged = 0 THEN
      UPDATE public.autopilot_slot_jobs SET status = 'failed', failure_reason = 'insufficient_credits',
             lease_token = NULL, updated_at = NOW() WHERE id = p_slot_id;
      UPDATE public.autopilot_run_status SET failed_slots = failed_slots + 1 WHERE id = j.run_id;
      PERFORM public.finish_autopilot_run_if_done(j.run_id);
      RETURN 'no_credits';
    END IF;
    UPDATE public.ai_generation_logs l SET credits_charged = COALESCE(l.credits_charged, 0) + j.credit_cost
      FROM public.autopilot_run_status r WHERE r.id = j.run_id AND l.id = r.log_id;
  END IF;
  UPDATE public.autopilot_slot_jobs SET status = 'done', lease_token = NULL, updated_at = NOW() WHERE id = p_slot_id;
  UPDATE public.autopilot_run_status SET completed_slots = completed_slots + 1 WHERE id = j.run_id;
  PERFORM public.finish_autopilot_run_if_done(j.run_id);
  RETURN 'charged';
END $$;

-- A generation error before completion: back to 'pending' for its one
-- retry, or 'failed' after the second attempt. Never charged at this
-- point, so failing = the refund. Rejected if the lease was lost.
CREATE OR REPLACE FUNCTION public.fail_autopilot_slot(p_slot_id UUID, p_lease_token UUID, p_reason TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.autopilot_slot_jobs;
BEGIN
  SELECT * INTO j FROM public.autopilot_slot_jobs WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND OR j.status <> 'running' OR j.lease_token IS DISTINCT FROM p_lease_token THEN
    RETURN 'lease_lost';
  END IF;
  IF j.attempts < 2 THEN
    UPDATE public.autopilot_slot_jobs SET status = 'pending', lease_token = NULL, failure_reason = p_reason,
           updated_at = NOW() WHERE id = p_slot_id;
    RETURN 'retrying';
  END IF;
  UPDATE public.autopilot_slot_jobs SET status = 'failed', lease_token = NULL, failure_reason = p_reason,
         updated_at = NOW() WHERE id = p_slot_id;
  UPDATE public.autopilot_run_status SET failed_slots = failed_slots + 1 WHERE id = j.run_id;
  PERFORM public.finish_autopilot_run_if_done(j.run_id);
  RETURN 'failed';
END $$;

REVOKE ALL ON FUNCTION public.claim_autopilot_slots(INTEGER, INTEGER, INTEGER),
                       public.complete_autopilot_slot(UUID, UUID, INTEGER),
                       public.fail_autopilot_slot(UUID, UUID, TEXT),
                       public.finish_autopilot_run_if_done(UUID)
  FROM PUBLIC, anon, authenticated;   -- service role (the drain route) only
