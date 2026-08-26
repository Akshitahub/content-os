import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { UserRow } from "@/types/database"
import { PLAN_LIMITS, type UserPlan } from "@/types/app"
import { isTrialActive, isTrialExpired, resolveGenerationLimit } from "@/lib/usage/trial-status"
import { z } from "zod"

export async function GET() {
  let supabase
  try {
    supabase = await createClient()
  } catch {
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "Not logged in."), { status: 401 })
  }

  const { data: userData } = await supabase
    .from("users")
    .select("plan, generation_count, generation_count_reset_at, trial_ends_at, subscribed_at, topup_credits_balance")
    .eq("id", user.id)
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
  // Computed here, not in the client components that display it — Date.now()
  // is impure and React's purity rules (this repo's eslint-plugin-react-hooks
  // config) reject calling it during render. A plain API route has no such
  // restriction, so the day count is precomputed once and shipped as data.
  const trialDaysLeft = trialFields.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(trialFields.trial_ends_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : null
  const resetAt = userData?.generation_count_reset_at ? new Date(userData.generation_count_reset_at) : null
  // Was a raw calendar-month-number comparison (now.getMonth() !==
  // resetAt.getMonth()), which is wrong: generation_count_reset_at is
  // always set to "now + 1 month" by charge_generation_usage (see
  // supabase/migrations/036_atomic_generation_usage.sql), so its month is
  // essentially always different from the current month regardless of
  // whether the reset has actually happened yet -- this made "used"
  // display as 0 immediately after almost every real charge, even though
  // the real generation_count value (confirmed live: 29 right after a
  // real Autopilot charge) was correct the whole time. The only correct
  // question is whether the stored timestamp has actually passed, same
  // check checkAndIncrementUsage/charge_generation_usage themselves use.
  const shouldReset = !resetAt || resetAt <= new Date()
  const currentCount = shouldReset ? 0 : (userData?.generation_count ?? 0)
  const topupBalance = userData?.topup_credits_balance ?? 0
  const planRemaining = Math.max(0, limit - currentCount)
  // Total spendable across both pools -- the plan/trial pool is drawn
  // down first and resets monthly, topup_credits_balance never expires
  // and is only touched once the plan pool runs out (see
  // supabase/migrations/040_credit_topups.sql's charge_generation_usage).
  // Every existing consumer of `remaining` (e.g. Header's low-credit
  // nudge threshold) should read the real total a user can still spend,
  // not just the monthly-pool slice of it.
  const remaining = planRemaining + topupBalance

  return NextResponse.json({
    data: {
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
    },
  })
}

const updateProfileSchema = z.object({
  full_name: z.string().min(1, "Name is required").max(200),
})

export async function PUT(request: Request) {
  console.log("[user/profile] PUT called")
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[user/profile] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error initializing request."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON body."), { status: 400 })
  }

  const parsed = updateProfileSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedUser, error } = await (supabase.from("users") as any)
      .update({ full_name: parsed.data.full_name, updated_at: new Date().toISOString() })
      .eq("id", user.id)
      .select()
      .single() as { data: UserRow | null; error: { message: string } | null }

    if (error) {
      console.error("[user/profile] PUT update error:", error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to update profile.", error.message), { status: 500 })
    }

    return NextResponse.json({ data: updatedUser })
  } catch (err) {
    console.error("[user/profile] PUT unexpected error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to update profile."), { status: 500 })
  }
}
