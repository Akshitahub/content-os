import { createClient } from "@/lib/supabase/server"
import { PLAN_LIMITS } from "@/types/app"
import type { UserPlan } from "@/types/app"
import { isInternalUnlimited } from "./is-internal-unlimited"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

export type UsageCheckResult =
  | { ok: true }
  | { ok: false; status: 429 | 500; message: string }

export async function checkAndIncrementUsage(userId: string): Promise<UsageCheckResult> {
  if (isInternalUnlimited(userId)) {
    console.log(`[check-and-increment-usage] internal unlimited bypass for ${userId} — quota check skipped, generation_count not incremented`)
    return { ok: true }
  }

  const supabase = await createClient()

  const { data: user, error } = await supabase
    .from("users")
    .select("plan, generation_count, generation_count_reset_at")
    .eq("id", userId)
    .single<{ plan: UserPlan; generation_count: number; generation_count_reset_at: string | null }>()

  if (error || !user) {
    console.error(
      `[check-and-increment-usage] users lookup failed for ${userId}:`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      JSON.stringify({ message: (error as any)?.message, details: (error as any)?.details, hint: (error as any)?.hint, code: (error as any)?.code })
    )
    return { ok: false, status: 500, message: "Could not verify usage limits." }
  }

  const limit = PLAN_LIMITS[user.plan].generations
  let count = user.generation_count ?? 0

  const resetAt = user.generation_count_reset_at ? new Date(user.generation_count_reset_at) : null
  const needsReset = !resetAt || resetAt <= new Date()

  if (needsReset) count = 0

  if (count >= limit) {
    console.error(
      `[check-and-increment-usage] REJECTED user ${userId}: plan=${user.plan} count=${count} limit=${limit} needsReset=${needsReset}`
    )
    const noun = user.plan === "free" ? `${limit} free` : String(limit)
    return {
      ok: false,
      status: 429,
      message: `You've used all ${noun} generations this month. Upgrade to continue.`,
    }
  }

  console.log(
    `[check-and-increment-usage] OK user ${userId}: plan=${user.plan} count=${count} limit=${limit} needsReset=${needsReset} — incrementing to ${count + 1}`
  )

  const nextResetDate = new Date()
  nextResetDate.setMonth(nextResetDate.getMonth() + 1)

  if (needsReset) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("users") as any)
      .update({ generation_count: count + 1, generation_count_reset_at: nextResetDate.toISOString() })
      .eq("id", userId)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("users") as any)
      .update({ generation_count: count + 1 })
      .eq("id", userId)
  }

  return { ok: true }
}

/**
 * Undoes checkAndIncrementUsage's charge — called when a generation ends in
 * complete failure (no usable output produced at all), so a user's monthly
 * credit isn't spent on a generation that never happened. Never call this
 * for a partial failure where real output was already produced (e.g.
 * content generated but a non-fatal DB persist failed) — only for a
 * complete failure with nothing usable. Mirrors refundReelUsage's shape in
 * check-and-increment-reel-usage.ts.
 *
 * Takes the caller's own Supabase client rather than creating one via
 * createClient() — same reasoning as refundReelUsage: this can be called
 * from contexts (e.g. an after() callback) where a fresh request-scoped
 * cookie client isn't reliable.
 */
export async function refundGenerationUsage(supabase: SupabaseClient<Database>, userId: string): Promise<void> {
  if (isInternalUnlimited(userId)) {
    // checkAndIncrementUsage never incremented anything for this user in
    // the first place — nothing to refund.
    return
  }

  const { data: user, error } = await supabase
    .from("users")
    .select("generation_count")
    .eq("id", userId)
    .single<{ generation_count: number }>()

  if (error || !user) {
    console.error(`[check-and-increment-usage] refund lookup failed for user ${userId}:`, error?.message)
    return
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("users") as any)
    .update({ generation_count: Math.max(0, (user.generation_count ?? 0) - 1) })
    .eq("id", userId)
}
