import { createClient } from "@/lib/supabase/server"
import type { UserPlan } from "@/types/app"
import { isInternalUnlimited } from "./is-internal-unlimited"
import { isTrialActive, isTrialExpired, resolveGenerationLimit } from "./trial-status"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

export type UsageCheckResult =
  // logId is the ai_generation_logs row this charge was recorded under
  // (null for the internal-unlimited bypass, which never charges or logs
  // anything, or if the logging insert itself failed — logging failures
  // are never allowed to fail the actual usage check). Callers that do
  // their own follow-up ai_generation_logs write (model/tokens/success —
  // see e.g. captions/generate/route.ts) should UPDATE this same row by
  // id instead of inserting a second one, so one generation event never
  // produces two log rows. Callers that don't log anything else can just
  // ignore it — the row this function already wrote (feature +
  // credits_charged) is a real improvement over the previous total
  // silence on its own.
  | { ok: true; logId: string | null }
  // trialExpired distinguishes "your 7-day trial ended, subscribe to
  // continue" from a normal within-plan/within-trial credit cap — callers
  // that build their own richer error UI (e.g. app/api/v1/brands/fastlane/
  // route.ts's RUN_CAP-style states) can check this flag; every other
  // caller already forwards `message` as-is, so the right copy shows up
  // everywhere for free.
  | { ok: false; status: 429 | 500; message: string; trialExpired?: boolean }

/**
 * Logs a successful charge to ai_generation_logs — feature + credits_charged
 * is the minimum needed for the "where are my credits going" breakdown
 * (Header.tsx's credit-indicator popover). `model` is a required NOT NULL
 * column but isn't known at charge time (the actual generation hasn't run
 * yet), so it's set to a placeholder distinct from this codebase's existing
 * "unknown" (genuinely-never-determined) convention -- callers that do
 * their own richer logging afterward overwrite it via UPDATE. Never allowed
 * to fail the charge itself: this runs strictly after charge_generation_usage
 * already committed, so a logging failure here is swallowed and just means
 * this one generation is invisible in the breakdown, not that the user was
 * charged without a usable session.
 */
async function logCharge(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  feature: string,
  cost: number
): Promise<string | null> {
  const { data, error } = await supabase
    .from("ai_generation_logs")
    .insert({ user_id: userId, feature, model: "pending", credits_charged: cost })
    .select("id")
    .single()

  if (error) {
    console.error(`[check-and-increment-usage] logCharge insert failed for ${userId} (non-fatal, charge already committed):`, error.message)
    return null
  }
  return data?.id ?? null
}

/**
 * `cost` is the number of credits this specific action draws from the
 * user's single shared monthly pool (see lib/usage/credit-costs.ts) — a
 * required parameter, not defaulted to 1, so every call site has to state
 * its cost explicitly rather than silently inheriting the old flat rate.
 *
 * `feature` is the category name this charge shows up under in the
 * credits breakdown — required so every call site states it explicitly,
 * matching the same real, already-used ai_generation_logs `feature`
 * values (e.g. "captions", "hooks", "post_image") rather than inventing
 * new ones; see each call site for which name it uses and why.
 */
export async function checkAndIncrementUsage(userId: string, cost: number, feature: string): Promise<UsageCheckResult> {
  if (isInternalUnlimited(userId)) {
    console.log(`[check-and-increment-usage] internal unlimited bypass for ${userId} — quota check skipped, generation_count not incremented`)
    return { ok: true, logId: null }
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

  // Draws from the plan/trial pool first, then falls back to any
  // purchased top-up balance for the overage — see supabase/migrations/
  // 040_credit_topups.sql's charge_generation_usage for exactly how the
  // two pools are combined in one atomic UPDATE.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error: rpcError } = await (supabase.rpc as any)("charge_generation_usage", {
    p_user_id: userId,
    p_cost: cost,
    p_limit: limit,
  }) as { data: { generation_count: number; topup_credits_balance: number }[] | null; error: { message: string } | null }

  if (rpcError) {
    console.error(`[check-and-increment-usage] charge_generation_usage RPC failed for ${userId}:`, rpcError.message)
    return { ok: false, status: 500, message: "Could not verify usage limits." }
  }

  // The function's WHERE guard rejects the update (zero rows, no charge
  // applied) exactly when this cost would have exceeded BOTH the plan/
  // trial pool and any top-up balance combined -- the user row was
  // already confirmed to exist just above, so a miss here can only mean
  // the combined-limit check failed, not a missing user. Re-reading for
  // the rejection message below is read-only (nothing is written from
  // it), so it can't reintroduce the charge race -- it only ever affects
  // what the error text says, never whether/how much gets charged.
  const updated = rows?.[0]
  if (!updated) {
    const { data: current } = await supabase
      .from("users")
      .select("generation_count, topup_credits_balance")
      .eq("id", userId)
      .single<{ generation_count: number; topup_credits_balance: number }>()
    const count = current?.generation_count ?? limit
    const topupBalance = current?.topup_credits_balance ?? 0
    const remaining = Math.max(0, limit - count) + topupBalance
    console.error(
      `[check-and-increment-usage] REJECTED user ${userId}: plan=${user.plan} count=${count} cost=${cost} limit=${limit} topupBalance=${topupBalance}`
    )
    return {
      ok: false,
      status: 429,
      message: remaining <= 0
        ? trialing
          ? `You've used all ${limit} trial credits. Subscribe to a plan to keep generating.`
          : `You've used all your credits this month. Buy more credits or upgrade to continue.`
        : trialing
          ? `This action requires ${cost} credits, but you only have ${remaining} left on your trial. Subscribe to a plan to continue.`
          : `This action requires ${cost} credits, but you only have ${remaining} remaining. Buy more credits or upgrade to continue.`,
    }
  }

  console.log(
    `[check-and-increment-usage] OK user ${userId}: plan=${user.plan} cost=${cost} limit=${limit} — new count ${updated.generation_count}, topup balance ${updated.topup_credits_balance}`
  )

  const logId = await logCharge(supabase, userId, feature, cost)

  return { ok: true, logId }
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
 *
 * `logId` — the id checkAndIncrementUsage's result returned — zeroes out
 * that row's credits_charged so the breakdown doesn't count a refunded
 * charge as money actually spent. Optional since not every caller has one
 * (the internal-unlimited bypass never logs anything in the first place).
 */
export async function refundGenerationUsage(supabase: SupabaseClient<Database>, userId: string, cost: number, logId?: string | null): Promise<void> {
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

  if (logId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: logError } = await (supabase.from("ai_generation_logs") as any)
      .update({ credits_charged: 0 })
      .eq("id", logId)
    if (logError) {
      console.error(`[check-and-increment-usage] failed to zero out credits_charged on refund for log ${logId}:`, logError.message)
    }
  }
}

export interface GenerationOutcomeFields {
  user_id: string
  brand_id?: string | null
  feature: string
  model: string
  prompt_tokens?: number | null
  completion_tokens?: number | null
  total_tokens?: number | null
  latency_ms?: number | null
  success: boolean
  error_message?: string | null
}

/**
 * Finalizes the ai_generation_logs row checkAndIncrementUsage's charge
 * already created (by UPDATEing it with the real generation outcome —
 * model, tokens, latency, success/error) instead of every call site
 * inserting a second row for the same generation event. Falls back to a
 * plain INSERT when logId is null (the internal-unlimited bypass never
 * charges or logs anything up front, and a logCharge insert failure is
 * swallowed rather than propagated) — there's no row to update in either
 * case, so this is the same "at least log something" fallback every one
 * of these call sites already had before checkAndIncrementUsage started
 * logging anything itself.
 */
export async function logGenerationOutcome(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  logId: string | null,
  fields: GenerationOutcomeFields
): Promise<void> {
  if (logId) {
    const { user_id: _user_id, feature: _feature, ...updateFields } = fields
    const { error } = await supabase.from("ai_generation_logs").update(updateFields).eq("id", logId)
    if (error) console.error(`[check-and-increment-usage] logGenerationOutcome update failed for log ${logId}:`, error.message)
    return
  }
  const { error } = await supabase.from("ai_generation_logs").insert(fields)
  if (error) console.error(`[check-and-increment-usage] logGenerationOutcome insert failed:`, error.message)
}
