-- 040_credit_topups.sql
-- One-time credit top-up packs (see lib/usage/credit-packs.ts for the
-- three pack definitions) -- a separate purchase from a monthly plan
-- subscription. Confirmed spending order: the monthly plan pool
-- (generation_count vs PLAN_LIMITS[plan].generations) is drawn down
-- first, since it resets every month and is otherwise "use it or lose
-- it"; topup_credits_balance only gets spent once the plan pool for the
-- current cycle is exhausted, and never expires/resets on its own.
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.

-- 1. Running balance of purchased-but-unspent top-up credits. A running
--    total rather than re-summing credit_purchases minus usage on every
--    check -- same reasoning as generation_count being a running counter
--    instead of re-counting ai_generation_logs each time.
ALTER TABLE public.users
  ADD COLUMN topup_credits_balance INTEGER NOT NULL DEFAULT 0;

-- 2. Purchase ledger -- one row per successful top-up payment. UNIQUE on
--    razorpay_payment_id is what makes applyCreditTopup
--    (lib/billing/apply-credit-topup.ts) idempotent: both the client-
--    triggered /verify-payment flow and the server-to-server /webhook
--    flow can independently try to apply the same payment (same
--    reasoning as applyPlanUpgrade's own idempotency, see that file's
--    doc comment) -- the second insert attempt hits this constraint and
--    is treated as already-applied, not a double-credit.
CREATE TABLE public.credit_purchases (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  pack_id               TEXT NOT NULL CHECK (pack_id IN ('quick_topup', 'power_pack', 'mega_pack')),
  credits               INTEGER NOT NULL,
  amount_paid           INTEGER NOT NULL, -- whole rupees, same convention as PLAN_LIMITS.price
  razorpay_payment_id   TEXT NOT NULL UNIQUE,
  purchased_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_credit_purchases_user_id ON public.credit_purchases (user_id);

ALTER TABLE public.credit_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_credit_purchases" ON public.credit_purchases FOR ALL USING (user_id = auth.uid());

-- 3. Records the purchase AND credits the balance in ONE transaction --
--    not two separate round-trips (insert-then-RPC) from the caller.
--    That split has a real gap: if the insert succeeds but a second call
--    failed before crediting the balance, a retry (from either
--    /verify-payment or the /webhook backstop -- see
--    lib/billing/apply-credit-topup.ts's doc comment) would hit the
--    UNIQUE(razorpay_payment_id) constraint, correctly treat it as
--    "already applied", and skip crediting the balance -- silently
--    losing a real, paid-for top-up. Doing both inside a single plpgsql
--    function makes them succeed or fail together, and the EXCEPTION
--    block makes a duplicate call (the same idempotency case) a clean
--    no-op instead of a caller-visible error.
CREATE OR REPLACE FUNCTION public.apply_credit_topup(
  p_user_id UUID,
  p_pack_id TEXT,
  p_credits INTEGER,
  p_amount_paid INTEGER,
  p_razorpay_payment_id TEXT
)
RETURNS TABLE (topup_credits_balance INTEGER, already_applied BOOLEAN)
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.credit_purchases (user_id, pack_id, credits, amount_paid, razorpay_payment_id)
  VALUES (p_user_id, p_pack_id, p_credits, p_amount_paid, p_razorpay_payment_id);

  RETURN QUERY
  UPDATE public.users u
  SET topup_credits_balance = u.topup_credits_balance + p_credits
  WHERE u.id = p_user_id
  RETURNING u.topup_credits_balance, FALSE;
EXCEPTION
  WHEN unique_violation THEN
    -- Already applied by the other flow (verify-payment vs webhook race,
    -- or a Razorpay webhook retry) -- return the current balance
    -- unchanged rather than crediting a second time.
    RETURN QUERY
    SELECT u.topup_credits_balance, TRUE
    FROM public.users u
    WHERE u.id = p_user_id;
END;
$$;

-- 4. charge_generation_usage/refund_generation_usage (originally
--    supabase/migrations/036_atomic_generation_usage.sql) now draw from
--    TWO pools instead of one. Plan pool first: generation_count is
--    still capped at p_limit exactly as before (LEAST), and only the
--    overage beyond p_limit is drawn from topup_credits_balance. When
--    there's no overage (the common case), topup_credits_balance's
--    change is 0 and the WHERE guard's "topup_credits_balance >=
--    overage" is trivially "topup_credits_balance >= 0", which never
--    blocks -- behavior is byte-for-byte identical to before this
--    migration whenever a charge fits inside the plan pool alone.
CREATE OR REPLACE FUNCTION public.charge_generation_usage(
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

-- Refund: undoes exactly what a charge_generation_usage(p_cost) call
-- would typically have done, in reverse. Without a per-charge ledger of
-- exactly how much came from which pool, this reconstructs it
-- symmetrically: generation_count absorbs the refund first (floored at
-- 0, same as before this migration), and only the portion it couldn't
-- absorb (i.e. the charge must have overflowed into topup at charge
-- time) goes back to topup_credits_balance. Matches the old single-pool
-- behavior exactly whenever generation_count >= p_cost.
CREATE OR REPLACE FUNCTION public.refund_generation_usage(
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

GRANT EXECUTE ON FUNCTION public.apply_credit_topup(UUID, TEXT, INTEGER, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.charge_generation_usage(UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_generation_usage(UUID, INTEGER) TO authenticated;
