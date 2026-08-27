import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow, SocialConnectionRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string }> }

export async function POST(_request: Request, { params }: RouteParams) {
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

  // Same accuracy fix as competitor-analysis/route.ts — zernio_account_id
  // is what a Zernio-connected brand actually has, not ig_business_account_id.
  const { data: connection } = await supabase
    .from("social_connections")
    .select("*")
    .eq("brand_id", brandId)
    .eq("platform", "instagram")
    .eq("is_active", true)
    .maybeSingle<SocialConnectionRow>()

  if (!connection || !(connection.zernio_account_id || connection.ig_business_account_id)) {
    return NextResponse.json(
      buildError(ErrorCodes.VALIDATION_ERROR, "Connect Instagram first — competitor lookups require an active Instagram Business connection."),
      { status: 400 }
    )
  }

  // See competitor-analysis/route.ts — Zernio has no Business Discovery
  // equivalent, confirmed against its full API reference. Nothing to
  // auto-discover without it.
  return NextResponse.json(
    buildError(ErrorCodes.FEATURE_UNAVAILABLE, "Competitor analysis isn't currently available."),
    { status: 503 }
  )
}
