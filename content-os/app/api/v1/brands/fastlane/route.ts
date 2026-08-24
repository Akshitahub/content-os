import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { fastlaneSchema } from "@/lib/validations/fastlane"
import { executeFastlane, estimateAutopilotCreditCost } from "@/lib/ai/fastlane"
import { PLAN_LIMITS } from "@/types/app"
import type { UserPlan } from "@/types/app"
import { isInternalUnlimited } from "@/lib/usage/is-internal-unlimited"

// Reel-script slots defer video generation into after() callbacks that run
// once this response is sent — see lib/ai/fastlane.ts's submitAutopilotReel.
// As of 2026-08-18 those callbacks only SUBMIT each scene's Kling job
// (webhook-driven, not polled — see app/api/v1/webhooks/kling/route.ts,
// which owns actual completion including the JSON2Video render step) plus
// synchronous TTS, so they're fast regardless of reel count. 300s here is
// mainly for the rest of an Autopilot run (a full month of content-slot
// generation, images, etc.), not reel rendering specifically anymore.
export const maxDuration = 300

function resolvePlan(rawPlan: string | undefined): UserPlan {
  return rawPlan && rawPlan in PLAN_LIMITS ? (rawPlan as UserPlan) : "free"
}

export async function POST(request: Request) {
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
    // A missing/unrecognized plan row fails closed to the free tier rather
    // than silently skipping gating.
    const { data: userData } = await supabase
      .from("users")
      .select("plan, generation_count, generation_count_reset_at, autopilot_run_count, autopilot_run_count_reset_at")
      .eq("id", user.id)
      .single<{ plan: string; generation_count: number; generation_count_reset_at: string | null; autopilot_run_count: number; autopilot_run_count_reset_at: string | null }>()

    const isUnlimited = isInternalUnlimited(user.id)
    const plan = resolvePlan(userData?.plan)
    // Internal-unlimited accounts get the full run regardless of their
    // actual plan column — starter/pro/agency all share the same (30-day,
    // 30-slot) autopilot tier, so "agency" here is just a stand-in for
    // "the full tier," not a plan change.
    const tier = isUnlimited ? PLAN_LIMITS.agency.autopilot : PLAN_LIMITS[plan].autopilot

    // Real weighted cost for THIS run's actual slot mix (see
    // lib/usage/credit-costs.ts) — replaces the old flat tier.creditCost,
    // which charged the same number regardless of whether the run's slots
    // were cheap text or an expensive image-bearing Post/Carousel. Computed
    // once and reused for both the pre-flight affordability check below
    // and the real charge after the run completes, so the two can never
    // disagree — both derive from the exact same buildContentMix inputs
    // (focusAreas, tier.slots) that the strategy generation itself uses.
    const estimatedCost = estimateAutopilotCreditCost(focusAreas, tier.slots)

    const today = new Date().toISOString().split("T")[0]!
    const windowEnd = new Date(Date.now() + tier.days * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!

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
      const runsNow = new Date()
      const runsResetAt = userData.autopilot_run_count_reset_at ? new Date(userData.autopilot_run_count_reset_at) : null
      const shouldResetRuns = !runsResetAt || (runsNow.getMonth() !== runsResetAt.getMonth() || runsNow.getFullYear() !== runsResetAt.getFullYear())
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

    // Check usage limits — canonical PLAN_LIMITS[plan].generations (not a
    // separate hand-rolled table), against this run's real weighted cost.
    if (userData && !isUnlimited) {
      const limit = PLAN_LIMITS[plan].generations

      // Reset monthly if needed
      const now = new Date()
      const resetAt = userData.generation_count_reset_at ? new Date(userData.generation_count_reset_at) : null
      const shouldReset = !resetAt || (now.getMonth() !== resetAt.getMonth() || now.getFullYear() !== resetAt.getFullYear())

      const currentCount = shouldReset ? 0 : userData.generation_count

      if (currentCount + estimatedCost > limit) {
        return NextResponse.json(
          {
            error: { code: ErrorCodes.USAGE_LIMIT_EXCEEDED, message: `Autopilot requires ${estimatedCost} credits.` },
            remaining_credits: Math.max(0, limit - currentCount),
            plan,
            credits_needed: estimatedCost,
          },
          { status: 429 }
        )
      }
    }

    // A durable row this run's progress gets written to as it happens, so
    // a navigation away (or just closing the tab) doesn't destroy all
    // visibility into a run that's still going -- or already finished --
    // server-side with real credits already charged. See
    // app/api/v1/brands/[brandId]/fastlane/status/route.ts, which is what
    // the frontend checks on mount to recover this.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: runStatusRow } = await (supabase.from("autopilot_run_status") as any)
      .insert({ brand_id: brandId, user_id: user.id, status: "running", total_slots: tier.slots })
      .select("id")
      .single() as { data: { id: string } | null }

    // Execute autopilot with user preferences, scaled to this plan's tier
    const result = await executeFastlane(supabase, user.id, brandId, {
      frequency, platforms, vibe, focusAreas, totalSlots: tier.slots,
      plan, isInternalUnlimitedUser: isUnlimited,
    }, runStatusRow?.id)

    // Increment generation count and Autopilot run count
    const { data: currentUser } = await supabase
      .from("users")
      .select("generation_count, generation_count_reset_at, autopilot_run_count, autopilot_run_count_reset_at")
      .eq("id", user.id)
      .single<{ generation_count: number; generation_count_reset_at: string | null; autopilot_run_count: number; autopilot_run_count_reset_at: string | null }>()

    if (currentUser && !isUnlimited) {
      const now = new Date()
      const resetAt = currentUser.generation_count_reset_at ? new Date(currentUser.generation_count_reset_at) : null
      const shouldReset = !resetAt || (now.getMonth() !== resetAt.getMonth() || now.getFullYear() !== resetAt.getFullYear())

      const runsResetAt = currentUser.autopilot_run_count_reset_at ? new Date(currentUser.autopilot_run_count_reset_at) : null
      const shouldResetRuns = !runsResetAt || (now.getMonth() !== runsResetAt.getMonth() || now.getFullYear() !== runsResetAt.getFullYear())

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("users") as any).update({
        generation_count: shouldReset
          ? estimatedCost
          : currentUser.generation_count + estimatedCost,
        generation_count_reset_at: shouldReset ? now.toISOString() : currentUser.generation_count_reset_at,
        autopilot_run_count: shouldResetRuns ? 1 : currentUser.autopilot_run_count + 1,
        autopilot_run_count_reset_at: shouldResetRuns ? now.toISOString() : currentUser.autopilot_run_count_reset_at,
      }).eq("id", user.id)
    }

    // Surfaced back to the Fastlane UI so it can show the real credits this
    // run actually consumed (not just the pre-flight estimate shown before
    // the run started) -- there's no per-slot refund for individual
    // generation failures within a run, so this is always exactly
    // estimatedCost (0 for internal-unlimited accounts, who were never
    // charged at all).
    return NextResponse.json({ data: result, credits_charged: isUnlimited ? 0 : estimatedCost }, { status: 201 })
  } catch (err) {
    console.error("[fastlane] POST unexpected error:", err)
    const message = err instanceof Error ? err.message : "Failed to execute Autopilot."
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, message), { status: 500 })
  }
}
