import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { getAccountInsights } from "@/lib/social/instagram-insights"
import { calculateBestPerformingPosts, generateAccountInsights } from "@/lib/ai/account-analytics"
import { getRoiTracking, currentMonthRange } from "@/lib/analytics/roi-tracking"
import type { BrandRow, SocialConnectionRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log(`[brands/${brandId}/analytics] GET called`)

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[analytics] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const { data: connection } = await supabase
    .from("social_connections")
    .select("*")
    .eq("brand_id", brandId)
    .eq("platform", "instagram")
    .eq("is_active", true)
    .maybeSingle<SocialConnectionRow>()

  if (!connection || !connection.ig_business_account_id) {
    return NextResponse.json(
      buildError(ErrorCodes.VALIDATION_ERROR, "Connect Instagram first to see analytics."),
      { status: 400 }
    )
  }

  const insightsResult = await getAccountInsights(connection.ig_business_account_id, connection.access_token)
  if (!insightsResult.success) {
    console.error(`[analytics] insights fetch failed for brand ${brandId}:`, insightsResult.error)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, insightsResult.error), { status: 500 })
  }

  const bestPosts = calculateBestPerformingPosts(insightsResult.data.media)
  const startTime = Date.now()
  let aiInsights: string | null = null
  let aiSuccess = false
  let model = "none"
  let promptTokens: number | null = null
  let completionTokens: number | null = null

  try {
    const result = await generateAccountInsights(brand, insightsResult.data, bestPosts)
    aiInsights = result.text
    model = result.model
    promptTokens = result.usage?.prompt_tokens ?? null
    completionTokens = result.usage?.completion_tokens ?? null
    aiSuccess = true
  } catch (err) {
    console.error(`[analytics] AI insights generation failed for brand ${brandId}:`, err instanceof Error ? err.message : err)
    aiInsights = "AI insights unavailable right now — the numbers above are still accurate."
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("ai_generation_logs") as any).insert({
    user_id: user.id,
    brand_id: brandId,
    feature: "account_analytics",
    model,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens || completionTokens ? (promptTokens ?? 0) + (completionTokens ?? 0) : null,
    latency_ms: Date.now() - startTime,
    success: aiSuccess,
  })

  // Same function used by the downloadable monthly PDF report — the two
  // must never be able to silently disagree.
  const { start, end, label } = currentMonthRange()
  const roi = await getRoiTracking(supabase, brandId, start, end, label)

  return NextResponse.json({
    data: {
      windowDays: insightsResult.data.windowDays,
      reach: insightsResult.data.reach,
      followerGrowth: insightsResult.data.followerGrowth,
      engagement: insightsResult.data.engagement,
      demographics: insightsResult.data.demographics,
      bestPosts,
      aiInsights,
      roi,
    },
  })
}
