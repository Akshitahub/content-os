import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getTrendingContext } from "@/lib/ai/trend-scraper"
import { buildError, ErrorCodes } from "@/types/api"
import type { TrendingContext } from "@/types/app"
import type { BrandRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string }> }

const cache = new Map<string, { data: TrendingContext; ts: number }>()

export async function GET(_request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log(`[brands/${brandId}/trends] GET called`)

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error(`[brands/${brandId}/trends] createClient failed:`, err)
    return NextResponse.json(
      buildError(ErrorCodes.INTERNAL_ERROR, "Server error."),
      { status: 500 }
    )
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json(
      buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."),
      { status: 401 }
    )
  }

  let brand: BrandRow | null = null
  try {
    const { data, error } = await supabase
      .from("brands")
      .select("*")
      .eq("id", brandId)
      .single<BrandRow>()

    if (error || !data) {
      return NextResponse.json(
        buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."),
        { status: 404 }
      )
    }

    brand = data
  } catch (err) {
    console.error(`[brands/${brandId}/trends] DB query failed:`, err)
    return NextResponse.json(
      buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch brand."),
      { status: 500 }
    )
  }

  if (brand.user_id !== user.id) {
    return NextResponse.json(
      buildError(ErrorCodes.UNAUTHORIZED, "You do not have access to this brand."),
      { status: 403 }
    )
  }

  // Serve from cache if fresh (within last hour)
  const cached = cache.get(brandId)
  if (cached && cached.ts > Date.now() - 3_600_000) {
    return NextResponse.json({ data: cached.data })
  }

  const trendingContext = await getTrendingContext(brand)

  cache.set(brandId, { data: trendingContext, ts: Date.now() })

  return NextResponse.json({ data: trendingContext })
}
