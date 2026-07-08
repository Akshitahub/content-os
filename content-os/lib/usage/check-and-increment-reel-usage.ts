import { createClient } from "@/lib/supabase/server"
import { PLAN_LIMITS } from "@/types/app"
import type { UserPlan } from "@/types/app"

export type ReelUsageCheckResult =
  | { ok: true }
  | { ok: false; status: 429; message: string }

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export async function checkAndIncrementReelUsage(userId: string): Promise<ReelUsageCheckResult> {
  const supabase = await createClient()

  const { data: user, error } = await supabase
    .from("users")
    .select("plan, reel_count_this_week, reel_count_reset_at, free_reel_used_at")
    .eq("id", userId)
    .single<{
      plan: UserPlan
      reel_count_this_week: number
      reel_count_reset_at: string | null
      free_reel_used_at: string | null
    }>()

  if (error || !user) {
    return { ok: false, status: 429, message: "Could not verify usage limits." }
  }

  if (user.plan === "free") {
    if (user.free_reel_used_at) {
      return {
        ok: false,
        status: 429,
        message: "You've already used your free reel. Upgrade to Pro for weekly AI video reels.",
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("users") as any)
      .update({ free_reel_used_at: new Date().toISOString() })
      .eq("id", userId)

    return { ok: true }
  }

  if (user.plan === "starter") {
    return {
      ok: false,
      status: 429,
      message: "AI video reels are available on Pro and Agency plans. Upgrade to unlock this feature.",
    }
  }

  // pro / agency — weekly recurring allowance
  const limit = PLAN_LIMITS[user.plan].reelsPerWeek
  let count = user.reel_count_this_week ?? 0

  const resetAt = user.reel_count_reset_at ? new Date(user.reel_count_reset_at) : null
  const needsReset = !resetAt || resetAt <= new Date()

  if (needsReset) count = 0

  if (count >= limit) {
    return {
      ok: false,
      status: 429,
      message: `You've used all ${limit} AI video reels this week. Your quota resets weekly.`,
    }
  }

  const nextResetDate = new Date(Date.now() + WEEK_MS)

  if (needsReset) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("users") as any)
      .update({ reel_count_this_week: count + 1, reel_count_reset_at: nextResetDate.toISOString() })
      .eq("id", userId)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("users") as any)
      .update({ reel_count_this_week: count + 1 })
      .eq("id", userId)
  }

  return { ok: true }
}
