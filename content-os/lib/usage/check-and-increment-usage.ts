import { createClient } from "@/lib/supabase/server"
import type { UserPlan } from "@/types/app"
import { isInternalUnlimited } from "./is-internal-unlimited"
import { isTrialActive, isTrialExpired, resolveGenerationLimit } from "./trial-status"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

export type UsageCheckResult =
  | { ok: true }
  // trialExpired distinguishes "your 7-day trial ended, subscribe to
  // continue" from a normal within-plan/within-trial credit cap — callers
  // that build their own richer error UI (e.g. app/api/v1/brands/fastlane/
  // route.ts's RUN_CAP-style states) can check this flag; every other
  // caller already forwards `message` as-is, so the right copy shows up
  // everywhere for free.
  | { ok: false; status: 429 | 500; message: string; trialExpired?: boolean }

/**
 * `cost` is the number of credits this specific action draws from the
 * user's single shared monthly pool (see lib/usage/credit-costs.ts) — a
 * required parameter, not defaulted to 1, so every call site has to state
 * its cost explicitly rather than silently inheriting the old flat rate.
 */
export async function checkAndIncrementUsage(userId: string, cost: number): Promise<UsageCheckResult> {
  if (isInternalUnlimited(userId)) {
    console.log(`[check-and-increment-usage] internal unlimited bypass for ${userId} — quota check skipped, generation_count not incremented`)
    return { ok: true }
  }

  const supabase = await createClient()

  // Only `plan` is read here -- generation_count/generation_count_reset_at
  // are never read into JS as a separate snapshot. They're read AND
  // written atomically together inside charge_generation_usage (a single
  // Postgres UPDATE, see supabase/migrations/036_atomic_generation_usage.sql),
  // which is what actually closes the race the old SELECT-then-UPDATE had:
  // confirmed live before this fix existed, 10 concurrent 1-credit charges
  // against the same user landed as generation_count=2, not 10 -- 8 of them
  // silently overwritten by whichever UPDATE happened to land last. This
  // is the same access pattern lib/ai/fastlane.ts's executeFastlane() uses
  // (Promise.allSettled across batches of concurrent slots), which is why
  // a real Autopilot run's charge didn't stick even though the content it
  // paid for did.
  const { data: user, error } = await supabase
    .from("users")
    .select("plan, trial_ends_at, subscribed_at")
    .eq("id", userId)
    .single<{ plan: UserPlan; trial_ends_at: string | null; subscribed_at: string | null }>()

  if (error || !user) {
    console.error(
      `[check-and-increment-usage] users lookup failed for ${userId}:`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      JSON.stringify({ message: (error as any)?.message, details: (error as any)?.details, hint: (error as any)?.hint, code: (error as any)?.code })
    )
    return { ok: false, status: 500, message: "Could not verify usage limits." }
  }

  // Checked before spending any RPC call: a trial that's run out its 7
  // days (and never converted to a real subscription) is blocked outright,
  // independent of how many trial credits happen to be left unused.
  if (isTrialExpired(user)) {
    return {
      ok: false,
      status: 429,
      message: "Your 7-day free trial has ended. Subscribe to a plan to keep generating.",
      trialExpired: true,
    }
  }

  const trialing = isTrialActive(user)
  const limit = resolveGenerationLimit(user.plan, user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error: rpcError } = await (supabase.rpc as any)("charge_generation_usage", {
    p_user_id: userId,
    p_cost: cost,
    p_limit: limit,
  }) as { data: { generation_count: number }[] | null; error: { message: string } | null }

  if (rpcError) {
    console.error(`[check-and-increment-usage] charge_generation_usage RPC failed for ${userId}:`, rpcError.message)
    return { ok: false, status: 500, message: "Could not verify usage limits." }
  }

  // The function's WHERE guard rejects the update (zero rows, no charge
  // applied) exactly when this cost would have taken the user over their
  // plan limit -- the user row was already confirmed to exist just above,
  // so a miss here can only mean the limit check failed, not a missing
  // user. Re-reading the count purely for the rejection message below is
  // read-only (nothing is written from it), so it can't reintroduce the
  // charge race -- it only ever affects what the error text says, never
  // whether/how much gets charged.
  const updated = rows?.[0]
  if (!updated) {
    const { data: current } = await supabase
      .from("users")
      .select("generation_count")
      .eq("id", userId)
      .single<{ generation_count: number }>()
    const count = current?.generation_count ?? limit
    const remaining = Math.max(0, limit - count)
    console.error(
      `[check-and-increment-usage] REJECTED user ${userId}: plan=${user.plan} count=${count} cost=${cost} limit=${limit}`
    )
    return {
      ok: false,
      status: 429,
      message: count >= limit
        ? trialing
          ? `You've used all ${limit} trial credits. Subscribe to a plan to keep generating.`
          : `You've used all ${limit} generations this month. Upgrade to continue.`
        : trialing
          ? `This action requires ${cost} credits, but you only have ${remaining} left on your trial. Subscribe to a plan to continue.`
          : `This action requires ${cost} credits, but you only have ${remaining} remaining this month. Upgrade to continue.`,
    }
  }

  console.log(
    `[check-and-increment-usage] OK user ${userId}: plan=${user.plan} cost=${cost} limit=${limit} — new count ${updated.generation_count}`
  )

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
export async function refundGenerationUsage(supabase: SupabaseClient<Database>, userId: string, cost: number): Promise<void> {
  if (isInternalUnlimited(userId)) {
    // checkAndIncrementUsage never incremented anything for this user in
    // the first place — nothing to refund.
    return
  }

  // Same atomic treatment as charge_generation_usage above and for the
  // same reason: this used to be a SELECT-then-UPDATE too, and a refund
  // racing against a fresh concurrent charge is the identical lost-update
  // bug in the opposite direction (a legitimate charge landing in between
  // this refund's read and write would get silently wiped out by this
  // write overwriting it with a stale computed value). A single UPDATE
  // (supabase/migrations/036_atomic_generation_usage.sql) floors at 0
  // server-side instead.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)("refund_generation_usage", { p_user_id: userId, p_cost: cost }) as { error: { message: string } | null }

  if (error) {
    console.error(`[check-and-increment-usage] refund_generation_usage RPC failed for user ${userId}:`, error.message)
  }
}
