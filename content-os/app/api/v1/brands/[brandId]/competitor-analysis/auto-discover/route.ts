import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { discoverAndVerifyCompetitors } from "@/lib/ai/competitor-discovery"
import { getCompetitorSnapshot } from "@/lib/social/instagram-business-discovery"
import {
  calculateAccountMetrics,
  calculateCompetitorMetrics,
  generateCompetitorInsights,
  type AccountMetrics,
  type CompetitorMetrics,
} from "@/lib/ai/competitor-analysis"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow, SocialConnectionRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string }> }

const autoDiscoverSchema = z.object({
  count: z.number().int().min(1).max(5).default(5),
})

interface CompetitorResult {
  handle: string
  candidateName: string
  source: "brand_field" | "ai_guess"
  success: true
  error: null
  profile: { username: string; followersCount: number; mediaCount: number; biography: string | null; website: string | null }
  metrics: CompetitorMetrics
  analysis: string | null
}

export async function POST(request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log(`[brands/${brandId}/competitor-analysis/auto-discover] POST called`)

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[competitor-analysis/auto-discover] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let body: unknown
  try { body = await request.json() } catch { body = {} }

  const parsed = autoDiscoverSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })
  }
  const { count } = parsed.data

  const { data: connection } = await supabase
    .from("social_connections")
    .select("*")
    .eq("brand_id", brandId)
    .eq("platform", "instagram")
    .eq("is_active", true)
    .maybeSingle<SocialConnectionRow>()

  if (!connection || !connection.ig_business_account_id) {
    return NextResponse.json(
      buildError(ErrorCodes.VALIDATION_ERROR, "Connect Instagram first — competitor lookups require an active Instagram Business connection."),
      { status: 400 }
    )
  }

  const igBusinessAccountId = connection.ig_business_account_id
  const accessToken = connection.access_token
  const startTime = Date.now()

  // Fetch the brand's own recent performance once, if it has a handle on
  // file — used as a real (not fabricated) baseline for the AI analysis.
  let ownMetrics: AccountMetrics | null = null
  if (brand.instagram_handle) {
    const ownSnapshot = await getCompetitorSnapshot(igBusinessAccountId, accessToken, brand.instagram_handle)
    if (ownSnapshot.success) {
      ownMetrics = calculateAccountMetrics(ownSnapshot.data)
    } else {
      console.error(`[competitor-analysis/auto-discover] own-account lookup failed for @${brand.instagram_handle}:`, ownSnapshot.error)
    }
  }

  let verified: Awaited<ReturnType<typeof discoverAndVerifyCompetitors>>
  try {
    verified = await discoverAndVerifyCompetitors(brand, igBusinessAccountId, accessToken, count)
  } catch (err) {
    console.error("[competitor-analysis/auto-discover] discovery failed:", err)
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Auto-discovery failed. Please try again."), { status: 500 })
  }

  const results: CompetitorResult[] = []
  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  let anyAiSuccess = false

  for (const candidate of verified) {
    const metrics = calculateCompetitorMetrics(candidate.data)
    let analysis: string | null = null

    try {
      const insight = await generateCompetitorInsights(brand, candidate.data, metrics, ownMetrics)
      analysis = insight.analysis
      totalPromptTokens += insight.usage?.prompt_tokens ?? 0
      totalCompletionTokens += insight.usage?.completion_tokens ?? 0
      anyAiSuccess = true
    } catch (err) {
      console.error(`[competitor-analysis/auto-discover] AI analysis failed for @${candidate.handle}:`, err instanceof Error ? err.message : err)
      analysis = "Analysis unavailable right now — the numbers above are still accurate."
    }

    results.push({
      handle: candidate.handle,
      candidateName: candidate.candidateName,
      source: candidate.source,
      success: true,
      error: null,
      profile: {
        username: candidate.data.username,
        followersCount: candidate.data.followers_count,
        mediaCount: candidate.data.media_count,
        biography: candidate.data.biography,
        website: candidate.data.website,
      },
      metrics,
      analysis,
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("ai_generation_logs") as any).insert({
    user_id: user.id,
    brand_id: brandId,
    feature: "competitor_analysis_auto_discover",
    model: anyAiSuccess ? "llama-3.3-70b-versatile" : "none",
    prompt_tokens: totalPromptTokens || null,
    completion_tokens: totalCompletionTokens || null,
    total_tokens: (totalPromptTokens || totalCompletionTokens) ? totalPromptTokens + totalCompletionTokens : null,
    latency_ms: Date.now() - startTime,
    success: anyAiSuccess,
  })

  return NextResponse.json({ data: { own: ownMetrics, competitors: results }, count: results.length }, { status: 201 })
}
