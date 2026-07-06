import { NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { getAccountInsights } from "@/lib/social/instagram-insights"
import { calculateBestPerformingPosts, generateAccountInsights } from "@/lib/ai/account-analytics"
import { getRoiTracking, currentMonthRange } from "@/lib/analytics/roi-tracking"
import { buildMonthlyReportDocument, type MonthlyReportData } from "@/lib/reports/monthly-report-pdf"
import type { BrandRow, SocialConnectionRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log(`[brands/${brandId}/reports/monthly] GET called`)

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[reports/monthly] createClient failed:", err)
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
      buildError(ErrorCodes.VALIDATION_ERROR, "Connect Instagram first to generate a report."),
      { status: 400 }
    )
  }

  // Same functions as the live analytics route — the numbers in this PDF
  // must never be able to silently disagree with the dashboard.
  const insightsResult = await getAccountInsights(connection.ig_business_account_id, connection.access_token)
  if (!insightsResult.success) {
    console.error(`[reports/monthly] insights fetch failed for brand ${brandId}:`, insightsResult.error)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, insightsResult.error), { status: 500 })
  }

  const bestPosts = calculateBestPerformingPosts(insightsResult.data.media)

  let aiInsights: string | null = null
  try {
    const result = await generateAccountInsights(brand, insightsResult.data, bestPosts)
    aiInsights = result.text
  } catch (err) {
    console.error(`[reports/monthly] AI insights generation failed for brand ${brandId}:`, err instanceof Error ? err.message : err)
    aiInsights = "AI insights unavailable right now — the numbers above are still accurate."
  }

  const { start, end, label } = currentMonthRange()
  const roi = await getRoiTracking(supabase, brandId, start, end, label)

  const reportData: MonthlyReportData = {
    brandName: brand.name,
    periodLabel: label,
    windowDays: insightsResult.data.windowDays,
    reach: insightsResult.data.reach,
    followerGrowth: insightsResult.data.followerGrowth,
    engagement: insightsResult.data.engagement,
    demographics: insightsResult.data.demographics,
    bestPosts,
    aiInsights,
    roi,
  }

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderToBuffer(buildMonthlyReportDocument(reportData))
  } catch (err) {
    console.error(`[reports/monthly] PDF render failed for brand ${brandId}:`, err instanceof Error ? err.message : err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to generate the report. Please try again."), { status: 500 })
  }

  const filename = `${brand.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-monthly-report.pdf`

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
