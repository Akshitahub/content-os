import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { CREDIT_PACKS, type CreditPackId } from "@/lib/usage/credit-packs"

/**
 * Counterpart to lib/billing/apply-plan-upgrade.ts, for one-time credit
 * top-up purchases instead of a plan subscription — shared by the same two
 * entry points (the client-triggered /verify-payment flow and the
 * server-to-server /webhook flow), for the same reason: a browser that
 * dies right after a successful charge shouldn't mean the credits never
 * land.
 *
 * Records the purchase and credits the balance in one atomic DB
 * transaction (public.apply_credit_topup, see supabase/migrations/
 * 040_credit_topups.sql) rather than two separate round-trips from here —
 * an insert-then-RPC split would have a real gap where a retry (from the
 * other flow, after the first one's balance update failed) hits the
 * ledger's UNIQUE(razorpay_payment_id) constraint, correctly detects
 * "already applied", and skips crediting the balance — silently losing a
 * real, paid-for top-up. The DB function's own duplicate-call handling
 * covers the same idempotency case without that gap.
 */
export async function applyCreditTopup(
  supabase: SupabaseClient<Database>,
  userId: string,
  packId: CreditPackId,
  razorpayPaymentId: string,
  amountPaidRupees: number
): Promise<{ error: string | null }> {
  const pack = CREDIT_PACKS[packId]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)("apply_credit_topup", {
    p_user_id: userId,
    p_pack_id: packId,
    p_credits: pack.credits,
    p_amount_paid: amountPaidRupees,
    p_razorpay_payment_id: razorpayPaymentId,
  }) as { error: { message: string } | null }

  return { error: error?.message ?? null }
}
