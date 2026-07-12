import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

/**
 * Shared by the client-triggered /verify-payment flow and the
 * server-to-server /webhook flow — both ultimately just need to set the
 * user's plan and reset their generation quota, once Razorpay's own order
 * record has confirmed payment. Naturally idempotent: re-applying the same
 * plan/reset values has no additional effect if both flows fire for the
 * same order.
 */
export async function applyPlanUpgrade(
  supabase: SupabaseClient<Database>,
  userId: string,
  plan: "starter" | "pro" | "agency"
): Promise<{ error: string | null }> {
  const nextResetDate = new Date()
  nextResetDate.setMonth(nextResetDate.getMonth() + 1)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("users") as any)
    .update({
      plan,
      generation_count: 0,
      generation_count_reset_at: nextResetDate.toISOString(),
    })
    .eq("id", userId)

  return { error: error?.message ?? null }
}
