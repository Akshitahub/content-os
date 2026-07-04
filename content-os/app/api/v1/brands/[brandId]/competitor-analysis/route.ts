import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { getCompetitorSnapshot } from "@/lib/social/instagram-business-discovery"
import {
  calculateAccountMetrics,
  calculateCompetitorMetrics,
  generateCompetitorInsights,
  type AccountMetrics,
  type CompetitorMetrics,
} from "@/lib/ai/competitor-analysis"
import type { BrandRow, SocialConnectionRow } from "@/types/database"
import { z } from "zod"

const MAX_COMPETITORS = 5
const DELAY_BETWEEN_LOOKUPS_MS = 500

const competitorAnalysisSchema = z.object({
  handles: z.array(z.string().min(1).max(60)).min(1).max(MAX_COMPETITORS),
})

type RouteParams = { params: Promise<{ brandId: string }> }

interface CompetitorResult {
  handle: string
  success: boolean
  error: string | null
  profile: { username: string; followersCount: number; mediaCount: number; biography: string | null; website: string | null } | null
  metrics: CompetitorMetrics | null
  analysis: string | null
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function POST(request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log(`[brands/${brandId}/competitor-analysis] POST called`)

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[competitor-analysis] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = competitorAnalysisSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { handles } = parsed.data

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
      console.error(`[competitor-analysis] own-account lookup failed for @${brand.instagram_handle}:`, ownSnapshot.error)
    }
  }

  const results: CompetitorResult[] = []
  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  let anyAiSuccess = false

  for (let i = 0; i < handles.length; i++) {
    const handle = handles[i]!
    const snapshot = await getCompetitorSnapshot(igBusinessAccountId, accessToken, handle)

    if (!snapshot.success) {
      results.push({ handle, success: false, error: snapshot.error, profile: null, metrics: null, analysis: null })
      if (i < handles.length - 1) await sleep(DELAY_BETWEEN_LOOKUPS_MS)
      continue
    }

    const metrics = calculateCompetitorMetrics(snapshot.data)
    let analysis: string | null = null

    try {
      const insight = await generateCompetitorInsights(brand, snapshot.data, metrics, ownMetrics)
      analysis = insight.analysis
      totalPromptTokens += insight.usage?.prompt_tokens ?? 0
      totalCompletionTokens += insight.usage?.completion_tokens ?? 0
      anyAiSuccess = true
    } catch (err) {
      console.error(`[competitor-analysis] AI analysis failed for @${handle}:`, err instanceof Error ? err.message : err)
      analysis = "Analysis unavailable right now — the numbers above are still accurate."
    }

    results.push({
      handle,
      success: true,
      error: null,
      profile: {
        username: snapshot.data.username,
        followersCount: snapshot.data.followers_count,
        mediaCount: snapshot.data.media_count,
        biography: snapshot.data.biography,
        website: snapshot.data.website,
      },
      metrics,
      analysis,
    })

    if (i < handles.length - 1) await sleep(DELAY_BETWEEN_LOOKUPS_MS)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("ai_generation_logs") as any).insert({
    user_id: user.id,
    brand_id: brandId,
    feature: "competitor_analysis",
    model: anyAiSuccess ? "llama-3.3-70b-versatile" : "none",
    prompt_tokens: totalPromptTokens || null,
    completion_tokens: totalCompletionTokens || null,
    total_tokens: (totalPromptTokens || totalCompletionTokens) ? totalPromptTokens + totalCompletionTokens : null,
    latency_ms: Date.now() - startTime,
    success: anyAiSuccess,
  })

  return NextResponse.json({ data: { own: ownMetrics, competitors: results } })
}
