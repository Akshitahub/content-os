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
      .select("plan, generation_count, generation_count_reset_at")
      .eq("id", user.id)
      .single<{ plan: string; generation_count: number; generation_count_reset_at: string | null }>()

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

    // Execute autopilot with user preferences, scaled to this plan's tier
    const result = await executeFastlane(supabase, user.id, brandId, {
      frequency, platforms, vibe, focusAreas, totalSlots: tier.slots,
      plan, isInternalUnlimitedUser: isUnlimited,
    })

    // Increment generation count
    const { data: currentUser } = await supabase
      .from("users")
      .select("generation_count, generation_count_reset_at")
      .eq("id", user.id)
      .single<{ generation_count: number; generation_count_reset_at: string | null }>()

    if (currentUser && !isUnlimited) {
      const now = new Date()
      const resetAt = currentUser.generation_count_reset_at ? new Date(currentUser.generation_count_reset_at) : null
      const shouldReset = !resetAt || (now.getMonth() !== resetAt.getMonth() || now.getFullYear() !== resetAt.getFullYear())

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("users") as any).update({
        generation_count: shouldReset
          ? estimatedCost
          : currentUser.generation_count + estimatedCost,
        generation_count_reset_at: shouldReset ? now.toISOString() : currentUser.generation_count_reset_at,
      }).eq("id", user.id)
    }

    return NextResponse.json({ data: result }, { status: 201 })
  } catch (err) {
    console.error("[fastlane] POST unexpected error:", err)
    const message = err instanceof Error ? err.message : "Failed to execute Autopilot."
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, message), { status: 500 })
  }
}
