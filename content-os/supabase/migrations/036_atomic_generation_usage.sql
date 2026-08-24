-- 036_atomic_generation_usage.sql
-- Fixes a confirmed lost-update race in credit charging.
-- lib/usage/check-and-increment-usage.ts's checkAndIncrementUsage() did a
-- plain SELECT generation_count -> compute count+cost in JS -> UPDATE, with
-- no row locking, no optimistic-concurrency guard, and no atomic SQL
-- increment. Reproduced live before writing this migration: 10 concurrent
-- 1-credit charges against the same test user, fired the same way
-- lib/ai/fastlane.ts's executeFastlane() calls this concurrently across a
-- batch of Autopilot slots, landed as generation_count=2, not 10 -- 8
-- charges silently overwritten by whichever UPDATE happened to land last.
-- This is exactly why a live Autopilot run charged 29 credits (header
-- read 100->71) and then, minutes later, read back as used:0/remaining:100
-- while the 5 calendar entries it generated stayed real and saved: the
-- charge was never durable, the work it paid for was.
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor — no
-- automated migration runner is wired up in this environment.

-- Single atomic UPDATE, guarded by a WHERE clause that only applies the
-- increment if the resulting count wouldn't exceed the caller-supplied
-- limit -- p_limit is passed in from the already-known TypeScript
-- PLAN_LIMITS[plan].generations rather than duplicating that table here.
-- Zero rows returned means the WHERE guard rejected it (would have
-- exceeded the limit); a returned row means it succeeded. A single UPDATE
-- is atomic in Postgres by default -- row-level locking serializes
-- concurrent calls against the same user row, and each sees the other's
-- already-committed result rather than a stale snapshot, which is exactly
-- what eliminates the read-then-write gap the JS version had.
CREATE OR REPLACE FUNCTION public.charge_generation_usage(
  p_user_id UUID,
  p_cost INTEGER,
  p_limit INTEGER
)
RETURNS TABLE (generation_count INTEGER)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.users u
  SET
    generation_count = CASE
      WHEN u.generation_count_reset_at IS NULL OR u.generation_count_reset_at <= NOW()
        THEN p_cost
      ELSE u.generation_count + p_cost
    END,
    generation_count_reset_at = CASE
      WHEN u.generation_count_reset_at IS NULL OR u.generation_count_reset_at <= NOW()
        THEN NOW() + INTERVAL '1 month'
      ELSE u.generation_count_reset_at
    END
  WHERE u.id = p_user_id
    AND (
      CASE
        WHEN u.generation_count_reset_at IS NULL OR u.generation_count_reset_at <= NOW()
          THEN p_cost
        ELSE u.generation_count + p_cost
      END
    ) <= p_limit
  RETURNING u.generation_count;
END;
$$;

-- Counterpart to charge_generation_usage -- undoes a charge on complete
-- generation failure (see refundGenerationUsage's own doc comment for when
-- this is/isn't appropriate to call). Same atomic treatment: a refund
-- racing against a fresh concurrent charge is the same class of lost-update
-- bug in the opposite direction. No limit guard needed here (a refund can
-- only ever move the count down), floored at 0 the same way the JS version
-- was.
CREATE OR REPLACE FUNCTION public.refund_generation_usage(
  p_user_id UUID,
  p_cost INTEGER
)
RETURNS TABLE (generation_count INTEGER)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.users u
  SET generation_count = GREATEST(0, u.generation_count - p_cost)
  WHERE u.id = p_user_id
  RETURNING u.generation_count;
END;
$$;

-- Both functions run as SECURITY INVOKER (the default) — the caller's own
-- RLS context applies, same as any other client-issued UPDATE against
-- public.users. "users_own_data" (id = auth.uid(), USING with no explicit
-- WITH CHECK) already covers this: every call site passes the currently
-- authenticated user's own id as p_user_id, so USING's row-visibility
-- check and the implicit WITH CHECK it doubles as for UPDATE both pass on
-- the caller's own row, exactly like any other self-row update already
-- did before this migration. Explicit grants below, since some Supabase
-- projects restrict PUBLIC's default EXECUTE on new functions.
GRANT EXECUTE ON FUNCTION public.charge_generation_usage(UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_generation_usage(UUID, INTEGER) TO authenticated;
