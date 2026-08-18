import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

/**
 * Shared by the client-triggered /verify-payment flow and the
 * server-to-server /webhook flow — both ultimately just need to set the
 * user's plan and reset their generation quota, once Razorpay's own order
 * record has confirmed payment. Naturally idempotent: re-applying the same
 * plan/reset values has no additional effect if both flows fire for the
 * same order.
 *
 * `billingPeriod` only records what the user purchased (for future
 * renewal/expiry logic — out of scope here) — it does NOT change the
 * generation-quota reset cadence below. That stays monthly regardless of
 * whether the plan itself was billed monthly or annually.
 */
export async function applyPlanUpgrade(
  supabase: SupabaseClient<Database>,
  userId: string,
  plan: "starter" | "pro" | "agency",
  billingPeriod: "monthly" | "annual"
): Promise<{ error: string | null }> {
  const nextResetDate = new Date()
  nextResetDate.setMonth(nextResetDate.getMonth() + 1)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("users") as any)
    .update({
      plan,
      plan_billing_period: billingPeriod,
      generation_count: 0,
      generation_count_reset_at: nextResetDate.toISOString(),
    })
    .eq("id", userId)

  return { error: error?.message ?? null }
}
