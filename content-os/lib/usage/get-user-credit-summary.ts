import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { PLAN_LIMITS, type UserPlan } from "@/types/app"
import { isTrialActive, isTrialExpired, resolveGenerationLimit } from "@/lib/usage/trial-status"

export interface UserCreditSummary {
  plan: UserPlan
  limit: number
  used: number
  /** Total spendable across both pools -- see planRemaining/topupBalance. */
  remaining: number
  /** Just the monthly plan/trial pool's own remainder (limit - used), no
   * top-up credits mixed in. */
  planRemaining: number
  topupBalance: number
  trialing: boolean
  trialExpired: boolean
  trialEndsAt: string | null
  trialDaysLeft: number | null
}

/**
 * Single source of truth for "how many credits does this user have right
 * now" -- originally inline in app/api/v1/user/profile/route.ts's GET
 * (the only consumer, via hooks/useUserCredits.ts). Extracted so
 * app/api/admin/users/[id]/route.ts can compute the exact same thing for
 * an arbitrary user (via createAdminClient(), service-role) without
 * duplicating this logic a second time. Accepts any Supabase client --
 * RLS-scoped (createClient(), the normal "current user looking at their
 * own data" case) or service-role (createAdminClient(), the admin
 * "looking at someone else's data" case) -- plus the target user id, so
 * both callers can pass their own client and any userId.
 */
export async function getUserCreditSummary(supabase: SupabaseClient<Database>, userId: string): Promise<UserCreditSummary> {
  const { data: userData } = await supabase
    .from("users")
    .select("plan, generation_count, generation_count_reset_at, trial_ends_at, subscribed_at, topup_credits_balance")
    .eq("id", userId)
    .single<{ plan: string; generation_count: number; generation_count_reset_at: string | null; trial_ends_at: string | null; subscribed_at: string | null; topup_credits_balance: number | null }>()

  const rawPlan = userData?.plan
  // "starter" is the fail-closed default now that Free is gone (a missing/
  // unrecognized plan value can't fall back to a tier that no longer
  // exists) — every user, trialing or subscribed, always has a real paid
  // tier value in this column (see users.trial_ends_at/subscribed_at for
  // trial-vs-subscribed status, tracked orthogonally from `plan`).
  const plan: UserPlan = rawPlan && rawPlan in PLAN_LIMITS ? (rawPlan as UserPlan) : "starter"
  const trialFields = { trial_ends_at: userData?.trial_ends_at ?? null, subscribed_at: userData?.subscribed_at ?? null }
  const trialing = isTrialActive(trialFields)
  const trialExpired = isTrialExpired(trialFields)
  const limit = resolveGenerationLimit(plan, trialFields)
  const trialDaysLeft = trialFields.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(trialFields.trial_ends_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : null
  const resetAt = userData?.generation_count_reset_at ? new Date(userData.generation_count_reset_at) : null
  // generation_count_reset_at is always set to "now + 1 month" by
  // charge_generation_usage (supabase/migrations/036_atomic_generation_usage.sql),
  // so its month is essentially always different from the current month
  // regardless of whether the reset has actually happened -- the only
  // correct question is whether the stored timestamp has actually passed,
  // same check checkAndIncrementUsage/charge_generation_usage themselves use.
  const shouldReset = !resetAt || resetAt <= new Date()
  const currentCount = shouldReset ? 0 : (userData?.generation_count ?? 0)
  const topupBalance = userData?.topup_credits_balance ?? 0
  const planRemaining = Math.max(0, limit - currentCount)
  // Total spendable across both pools -- the plan/trial pool is drawn
  // down first and resets monthly, topup_credits_balance never expires
  // and is only touched once the plan pool runs out (see
  // supabase/migrations/040_credit_topups.sql's charge_generation_usage).
  const remaining = planRemaining + topupBalance

  return {
    plan,
    limit,
    used: currentCount,
    remaining,
    planRemaining,
    topupBalance,
    trialing,
    trialExpired,
    trialEndsAt: trialFields.trial_ends_at,
    trialDaysLeft,
  }
}
