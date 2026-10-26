import { NextResponse, after } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { fastlaneSchema } from "@/lib/validations/fastlane"
import { estimateAutopilotCreditCost, computeAutopilotSlotCount, generateContentStrategy, type AutopilotUsageTracker } from "@/lib/ai/fastlane"
import { enqueueAutopilotSlots, type AutopilotRunParams } from "@/lib/ai/autopilot-worker"
import { slotCreditCost } from "@/lib/ai/autopilot-content-mix"
import { MODELS } from "@/lib/ai/models"
import { PLAN_LIMITS } from "@/types/app"
import type { UserPlan } from "@/types/app"
import type { BrandRow, ProductRow } from "@/types/database"
import { isInternalUnlimited } from "@/lib/usage/is-internal-unlimited"
import { logGenerationOutcome } from "@/lib/usage/check-and-increment-usage"
import { getUserCreditSummary } from "@/lib/usage/get-user-credit-summary"
import { getISTDateString } from "@/lib/utils/ist"
import { timedGenerationRoute, type GenerationTimer } from "@/lib/utils/generation-timing"
import { withDeadline, DeadlineExceededError, GENERATION_TIMED_OUT_MESSAGE } from "@/lib/utils/with-deadline"

// Starts an Autopilot run and returns 202 straight away. This request only
// checks limits, plans the month (one strategy call) and enqueues one job
// per slot; the slots themselves are generated, charged and saved one by
// one in the background by lib/ai/autopilot-worker.ts, drained via
// app/api/v1/cron/autopilot-drain (Supabase Cron every 20s, plus an
// immediate kick from here). The page polls autopilot_run_status for real
// progress, so the user can close the tab and come back. Nothing is
// charged in this request: each slot is charged only when it completes.
//
// 300s = Hobby maximum with fluid compute (vercel.com/docs/functions/
// configuring-functions/duration, checked 2026-10-26) -- only the
// strategy call runs here now, with its own deadline below.
export const maxDuration = 300
const STRATEGY_DEADLINE_MS = 240_000

function resolvePlan(rawPlan: string | undefined): UserPlan {
  return rawPlan && rawPlan in PLAN_LIMITS ? (rawPlan as UserPlan) : "starter"
}

// Kicks one drain pass as its own request (its own 300s budget), so the
// first slots start now instead of at the next Supabase Cron tick. The
// drain answers immediately (202) and works in the background, so this
// only waits for that acknowledgement. Best-effort: the cron picks the
// run up within ~20s anyway if this fails.
//
// Calls the origin this request arrived on, not NEXT_PUBLIC_APP_URL: if
// that names a host that redirects (apex -> www), fetch follows the
// redirect cross-origin and drops the Authorization header, so the kick
// got a 401 -- and the response status was never checked, so it failed
// silently. redirect: "manual" makes any redirect show up as a status.
async function kickDrain(origin: string): Promise<void> {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    console.error("[fastlane] drain kick skipped: CRON_SECRET is not set (the cron drain will reject calls too)")
    return
  }
  try {
    const res = await fetch(`${origin}/api/v1/cron/autopilot-drain`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status !== 202) console.error(`[fastlane] drain kick got HTTP ${res.status} from ${origin} (cron will pick the run up)`)
  } catch (err) {
    console.error("[fastlane] drain kick failed (cron will pick the run up):", err instanceof Error ? err.message : err)
  }
}

export async function POST(request: Request) {
  return timedGenerationRoute("autopilot", (timer) => handlePost(request, timer))
}

async function handlePost(request: Request, timer: GenerationTimer) {
  console.log("[fastlane] POST called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[fastlane] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error initializing request."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = fastlaneSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })
  }

  const { brandId, force, clearAndRegenerate, frequency, platforms, vibe, focusAreas } = parsed.data

  // Nothing is charged in this request (see the header comment), so the
  // only thing a failure here has to undo is the monthly run-count
  // increment -- and mark the run row as errored so the page stops polling.
  let runCountIncremented = false
  let runId: string | null = null
  const isUnlimited = isInternalUnlimited(user.id)

  try {
    // Verify brand ownership
    const { data: brand } = await supabase
      .from("brands")
      .select("id, user_id")
      .eq("id", brandId)
      .eq("user_id", user.id)
      .single<{ id: string; user_id: string }>()

    if (!brand) {
      return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
    }

    // Explicit plan-based Autopilot tier — resolved from the user's actual
    // plan (PLAN_LIMITS[plan].autopilot), not inferred from credit balance.
    // A missing/unrecognized plan row fails closed to Starter (the lowest
    // real tier now that Free is gone) rather than silently skipping
    // gating.
    const { data: userData } = await supabase
      .from("users")
      .select("plan, generation_count, generation_count_reset_at, autopilot_run_count, autopilot_run_count_reset_at, trial_ends_at, subscribed_at")
      .eq("id", user.id)
      .single<{ plan: string; generation_count: number; generation_count_reset_at: string | null; autopilot_run_count: number; autopilot_run_count_reset_at: string | null; trial_ends_at: string | null; subscribed_at: string | null }>()

    const plan = resolvePlan(userData?.plan)
    // Internal-unlimited accounts get the full run regardless of their
    // actual plan column — starter/pro/agency all share the same (30-day,
    // 30-slot) autopilot tier, so "agency" here is just a stand-in for
    // "the full tier," not a plan change.
    const tier = isUnlimited ? PLAN_LIMITS.agency.autopilot : PLAN_LIMITS[plan].autopilot

    // This run's real slot count from the chosen posting frequency, capped
    // at the tier's own max — a 3x/week run on a 30-day tier should
    // generate/charge ~13 slots, not the full 30, matching the "~13 posts"/
    // "~22 posts"/"30 posts" figures already shown in the UI.
    const totalSlots = computeAutopilotSlotCount(frequency, tier.days, tier.slots)

    // Real weighted cost for THIS run's actual slot mix (see
    // lib/usage/credit-costs.ts) — replaces the old flat tier.creditCost,
    // which charged the same number regardless of whether the run's slots
    // were cheap text or an expensive image-bearing Post/Carousel. Computed
    // once and reused for both the pre-flight affordability check below
    // and the real charge after the run completes, so the two can never
    // disagree — both derive from the exact same buildContentMix inputs
    // (focusAreas, totalSlots) that the strategy generation itself uses.
    const estimatedCost = estimateAutopilotCreditCost(focusAreas, totalSlots)

    // scheduled_date is a plain calendar-date column keyed to India's
    // calendar day (see lib/ai/fastlane.ts's baseDate) -- these must be
    // computed the same way, not the server's own local/UTC day.
    const today = getISTDateString()
    // Real UTC-offset math on "now" is safe here (no local-Date-simulation
    // needed): IST has no DST, so adding tier.days worth of whole-day
    // milliseconds to the current instant always lands on the calendar day
    // that's exactly tier.days days later in IST.
    const windowEnd = getISTDateString(new Date(Date.now() + tier.days * 24 * 60 * 60 * 1000))

    if (clearAndRegenerate) {
      // Delete all upcoming entries before regenerating
      await supabase
        .from("calendar_entries")
        .delete()
        .eq("brand_id", brandId)
        .gte("scheduled_date", today)
        .lte("scheduled_date", windowEnd)
    } else if (!force) {
      // Check for existing content
      const { count } = await supabase
        .from("calendar_entries")
        .select("*", { count: "exact", head: true })
        .eq("brand_id", brandId)
        .gte("scheduled_date", today)
        .lte("scheduled_date", windowEnd)

      if ((count ?? 0) > 10) {
        return NextResponse.json({
          warning: true,
          message: `You already have content planned for the next ${tier.days} days.`,
          existing_count: count ?? 0,
          can_override: true,
        }, { status: 200 })
      }
    }

    // Hard per-user cap on Autopilot RUNS/month (see AutopilotTier.
    // maxRunsPerMonth in types/app.ts) — separate from, and checked before,
    // the credit-pool check below. A user with credits to spare still can't
    // exceed this; it applies across all of their brands, not per-brand
    // (Agency's 4 runs against 5 brands is intentional — the user manually
    // picks which brands to spend runs on, no automatic rotation).
    if (userData && !isUnlimited) {
      const runsResetAt = userData.autopilot_run_count_reset_at ? new Date(userData.autopilot_run_count_reset_at) : null
      // Was a raw calendar-month-number comparison, which is wrong the
      // same way app/api/v1/user/profile/route.ts's identical pattern
      // was (see that file's fix for the full explanation): since
      // autopilot_run_count_reset_at is always set to "now + 1 month"
      // below, its month essentially never matches the current month,
      // so this would treat almost every check as "should reset" instead
      // of only when the stored timestamp has actually passed.
      const shouldResetRuns = !runsResetAt || runsResetAt <= new Date()
      const currentRunCount = shouldResetRuns ? 0 : userData.autopilot_run_count

      if (currentRunCount >= tier.maxRunsPerMonth) {
        return NextResponse.json(
          {
            error: { code: ErrorCodes.USAGE_LIMIT_EXCEEDED, message: `You've used all ${tier.maxRunsPerMonth} Autopilot run${tier.maxRunsPerMonth === 1 ? "" : "s"} this month. Upgrade or wait until next month for more.` },
            run_cap_reached: true,
            runs_used: currentRunCount,
            runs_allowed: tier.maxRunsPerMonth,
            plan,
          },
          { status: 429 }
        )
      }
    }

    // Affordability check only -- NOTHING is charged here. Each slot is
    // charged when it completes (complete_autopilot_slot, migration 057),
    // so an unfinished or failed slot is never charged and nothing needs
    // refunding. If the user spends credits elsewhere mid-run, the last
    // slots fail as "out of credits" rather than overdrawing.
    if (!isUnlimited) {
      const credits = await getUserCreditSummary(supabase, user.id)
      if (credits.trialExpired) {
        // trial_expired mirrors run_cap_reached's shape below -- a
        // dedicated discriminator the client checks before falling
        // through to the generic credits-upsell state.
        return NextResponse.json(
          {
            error: { code: ErrorCodes.USAGE_LIMIT_EXCEEDED, message: "Your 7-day free trial has ended. Subscribe to a plan to keep generating." },
            trial_expired: true,
            remaining_credits: 0,
            plan,
            credits_needed: estimatedCost,
          },
          { status: 429 }
        )
      }
      if (credits.remaining < estimatedCost) {
        return NextResponse.json(
          {
            error: { code: ErrorCodes.USAGE_LIMIT_EXCEEDED, message: `This run needs about ${estimatedCost} credits and you have ${credits.remaining}.` },
            trial_expired: false,
            remaining_credits: credits.remaining,
            plan,
            credits_needed: estimatedCost,
          },
          { status: 429 }
        )
      }
    }

    // Autopilot's own monthly run cap (see maxRunsPerMonth) -- counted when
    // the run starts, reverted below if starting it fails.
    if (userData && !isUnlimited) {
      const now = new Date()
      const runsResetAt = userData.autopilot_run_count_reset_at ? new Date(userData.autopilot_run_count_reset_at) : null
      const shouldResetRuns = !runsResetAt || runsResetAt <= now
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("users") as any).update({
        autopilot_run_count: shouldResetRuns ? 1 : userData.autopilot_run_count + 1,
        autopilot_run_count_reset_at: shouldResetRuns ? now.toISOString() : userData.autopilot_run_count_reset_at,
      }).eq("id", user.id)
      runCountIncremented = true
    }

    const admin = await createAdminClient()

    // One ai_generation_logs row per run, as before (so the dashboard's
    // generation count doesn't change); each completed slot adds its
    // credits to it atomically, and its tokens/cost best-effort.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: logRow } = await (admin.from("ai_generation_logs") as any)
      .insert({ user_id: user.id, brand_id: brandId, feature: "autopilot_slot", model: MODELS.creative, credits_charged: 0, success: true })
      .select("id").single() as { data: { id: string } | null }

    // The run row exists BEFORE the strategy call, so a user who closes the
    // tab right away still finds the run when they come back. The queue
    // depends on it, so a failure here is fatal (unlike before).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: runRow, error: runError } = await (admin.from("autopilot_run_status") as any)
      .insert({ brand_id: brandId, user_id: user.id, status: "running", total_slots: totalSlots, log_id: logRow?.id ?? null })
      .select("id").single() as { data: { id: string } | null; error: { message: string } | null }
    if (runError || !runRow) throw new Error(`Couldn't start the Autopilot run: ${runError?.message ?? "no row"}`)
    runId = runRow.id

    const { data: fullBrand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
    if (!fullBrand) throw new Error("Brand not found")
    const { data: products } = await supabase.from("products").select("*").eq("brand_id", brandId).eq("is_active", true).returns<ProductRow[]>()

    const tracker: AutopilotUsageTracker = { usage: undefined, costUsd: null, captionMs: 0, imageMs: 0 }
    const strategyStartedAt = Date.now()
    const strategy = await timer.step("caption", withDeadline(
      generateContentStrategy(fullBrand, products ?? [], { frequency, platforms, vibe, focusAreas, totalSlots, plan, isInternalUnlimitedUser: isUnlimited }, tracker),
      STRATEGY_DEADLINE_MS,
      "autopilot strategy"
    ))
    const slots = strategy.slots.slice(0, totalSlots)

    const params: AutopilotRunParams = {
      frequency, platforms, vibe, focusAreas, totalSlots, plan,
      isInternalUnlimitedUser: isUnlimited,
      strategySummary: strategy.strategy_summary,
      // Slot day 1 = today in India, fixed now so slots generated minutes
      // later still land on the planned calendar days.
      baseDate: getISTDateString(),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("autopilot_run_status") as any).update({ params, total_slots: slots.length }).eq("id", runId)
    await enqueueAutopilotSlots(admin, { runId, userId: user.id, brandId, slots, creditCost: slotCreditCost })

    if (logRow) {
      await logGenerationOutcome(admin, logRow.id, {
        user_id: user.id, brand_id: brandId, feature: "autopilot_slot", model: MODELS.creative,
        prompt_tokens: tracker.usage?.prompt_tokens ?? null,
        completion_tokens: tracker.usage?.completion_tokens ?? null,
        total_tokens: tracker.usage?.total_tokens ?? null,
        cost_usd: tracker.costUsd,
        latency_ms: Date.now() - strategyStartedAt,
        success: true,
      })
    }

    after(() => kickDrain(new URL(request.url).origin))

    return NextResponse.json({ data: { run_id: runId, total_slots: slots.length, status: "running" }, accepted: true }, { status: 202 })
  } catch (err) {
    console.error("[fastlane] POST unexpected error:", err)
    if (runId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("autopilot_run_status") as any)
        .update({ status: "error", error_message: "Autopilot couldn't start. Nothing was charged.", completed_at: new Date().toISOString() })
        .eq("id", runId)
        .then(() => undefined, () => undefined)
    }
    if (runCountIncremented) {
      // Best-effort, not atomic -- a low-stakes secondary counter.
      const { data: u } = await supabase.from("users").select("autopilot_run_count").eq("id", user.id).single<{ autopilot_run_count: number }>()
      if (u) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from("users") as any)
          .update({ autopilot_run_count: Math.max(0, u.autopilot_run_count - 1) })
          .eq("id", user.id)
      }
    }
    const timedOut = err instanceof DeadlineExceededError
    return NextResponse.json(
      buildError(ErrorCodes.AI_GENERATION_FAILED, timedOut ? GENERATION_TIMED_OUT_MESSAGE : "Autopilot couldn't start. Please try again."),
      { status: timedOut ? 504 : 500 }
    )
  }
}
