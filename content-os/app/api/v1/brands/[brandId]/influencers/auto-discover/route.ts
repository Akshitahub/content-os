import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { autoDiscoverAndScoreInfluencers } from "@/lib/ai/influencer-discovery"
import { buildError, ErrorCodes } from "@/types/api"
import { PLAN_LIMITS, type UserPlan } from "@/types/app"
import { isInternalUnlimited } from "@/lib/usage/is-internal-unlimited"
import type { BrandRow } from "@/types/database"

// Discovers up to `count` profiles (100 max, see schema below) in throttled
// batches of 3 with a 500ms pause between batches (lib/ai/influencer-
// discovery.ts), each involving a real scrape + AI niche-classification
// call + avatar re-hosting -- easily well over a minute for the default
// count, and with no override this was running on the platform's default
// function timeout. 300s matches the same batch-AI-job ceiling already
// proven to work on this plan for Autopilot (app/api/v1/brands/fastlane/
// route.ts), which does a comparable amount of per-item external+AI work.
//
// Also now covers a real Apify hashtag-scraping call up front (lib/ai/
// apify-hashtag-scraper.ts), capped at its own 90s client-side timeout --
// that actor's real-world duration hasn't been measured live yet (see the
// Phase 1 evaluation), so watch actual run times against this 300s budget
// once real usage happens and raise it if a large `count` run gets close.
export const maxDuration = 300

type RouteParams = { params: Promise<{ brandId: string }> }

const autoDiscoverSchema = z.object({
  platform: z.enum(["instagram", "tiktok", "youtube", "linkedin"]),
  count: z.number().int().min(1).max(100).default(25),
  discoveryType: z.enum(["influencer_partner", "prospect_customer"]).default("influencer_partner"),
})

export async function POST(request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log("[influencers/auto-discover] POST called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[influencers/auto-discover] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  const { data: brand } = await supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .eq("user_id", user.id)
    .single<BrandRow>()

  if (!brand) {
    return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  }

  const { data: userData } = await supabase.from("users").select("plan").eq("id", user.id).single<{ plan: UserPlan }>()
  const plan: UserPlan = userData?.plan ?? "starter"
  if (!PLAN_LIMITS[plan].influencerOutreach && !isInternalUnlimited(user.id)) {
    return NextResponse.json(
      buildError(ErrorCodes.USAGE_LIMIT_EXCEEDED, "Influencer outreach tools are available on Pro and Agency plans. Upgrade to use this feature."),
      { status: 403 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = autoDiscoverSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message),
      { status: 400 },
    )
  }

  const { platform, count, discoveryType } = parsed.data

  try {
    const influencers = await autoDiscoverAndScoreInfluencers(supabase, brand, brandId, platform, count, discoveryType)
    return NextResponse.json({ data: influencers, count: influencers.length }, { status: 201 })
  } catch (err) {
    console.error("[influencers/auto-discover] failed:", err)
    return NextResponse.json(
      buildError(ErrorCodes.AI_GENERATION_FAILED, "Auto-discovery failed. Please try again."),
      { status: 500 },
    )
  }
}
