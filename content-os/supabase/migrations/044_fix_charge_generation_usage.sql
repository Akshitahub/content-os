-- 044_fix_charge_generation_usage.sql
-- CRITICAL / URGENT -- fixes an active production incident. Confirmed
-- live (2026-08-26, via PostgREST's own OpenAPI schema introspection at
-- /rest/v1/): after running migration 040, both charge_generation_usage
-- and refund_generation_usage are GONE from the database entirely --
-- not "still the old version", not a stale schema-cache read, genuinely
-- absent. /rpc/apply_credit_topup is the only RPC PostgREST currently
-- exposes from that migration. Every content-generation route in the app
-- calls checkAndIncrementUsage, which calls charge_generation_usage --
-- with the function missing, EVERY generation action in production is
-- currently failing.
--
-- Root cause: migration 040 redefined both functions with
-- CREATE OR REPLACE FUNCTION while also changing their RETURNS TABLE
-- shape (adding a topup_credits_balance column) -- Postgres does not
-- allow changing an existing function's return type via CREATE OR
-- REPLACE (it requires DROP FUNCTION first). Whatever exact error/
-- recovery path this caused when migration 040 was run by hand, the two
-- functions ended up dropped without ever being successfully recreated.
-- This migration fixes it deterministically: explicit DROP FUNCTION IF
-- EXISTS before CREATE FUNCTION for both, so the end state can't depend
-- on whatever the previous attempt left behind. Bodies are otherwise
-- byte-for-byte identical to migration 040's intended versions -- no
-- behavior change beyond actually existing again.
--
-- MANUAL STEP REQUIRED -- and URGENT: run this by hand in the Supabase
-- SQL Editor immediately. Every AI generation action in production is
-- broken until this runs.

DROP FUNCTION IF EXISTS public.charge_generation_usage(UUID, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.refund_generation_usage(UUID, INTEGER);

CREATE FUNCTION public.charge_generation_usage(
  p_user_id UUID,
  p_cost INTEGER,
  p_limit INTEGER
)
RETURNS TABLE (generation_count INTEGER, topup_credits_balance INTEGER)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.users u
  SET
    generation_count = LEAST(
      p_limit,
      CASE
        WHEN u.generation_count_reset_at IS NULL OR u.generation_count_reset_at <= NOW()
          THEN p_cost
        ELSE u.generation_count + p_cost
      END
    ),
    generation_count_reset_at = CASE
      WHEN u.generation_count_reset_at IS NULL OR u.generation_count_reset_at <= NOW()
        THEN NOW() + INTERVAL '1 month'
      ELSE u.generation_count_reset_at
    END,
    topup_credits_balance = u.topup_credits_balance - GREATEST(
      0,
      (
        CASE
          WHEN u.generation_count_reset_at IS NULL OR u.generation_count_reset_at <= NOW()
            THEN p_cost
          ELSE u.generation_count + p_cost
        END
      ) - p_limit
    )
  WHERE u.id = p_user_id
    AND u.topup_credits_balance >= GREATEST(
      0,
      (
        CASE
          WHEN u.generation_count_reset_at IS NULL OR u.generation_count_reset_at <= NOW()
            THEN p_cost
          ELSE u.generation_count + p_cost
        END
      ) - p_limit
    )
  RETURNING u.generation_count, u.topup_credits_balance;
END;
$$;

CREATE FUNCTION public.refund_generation_usage(
  p_user_id UUID,
  p_cost INTEGER
)
RETURNS TABLE (generation_count INTEGER, topup_credits_balance INTEGER)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.users u
  SET
    generation_count = GREATEST(0, u.generation_count - p_cost),
    topup_credits_balance = u.topup_credits_balance
      + (p_cost - (u.generation_count - GREATEST(0, u.generation_count - p_cost)))
  WHERE u.id = p_user_id
  RETURNING u.generation_count, u.topup_credits_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.charge_generation_usage(UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_generation_usage(UUID, INTEGER) TO authenticated;
