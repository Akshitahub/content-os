import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { autoDiscoverAndScoreInfluencers } from "@/lib/ai/influencer-discovery"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string }> }

const autoDiscoverSchema = z.object({
  platform: z.enum(["instagram", "tiktok", "youtube"]),
  count: z.number().int().min(1).max(100).default(25),
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

  const { platform, count } = parsed.data

  try {
    const influencers = await autoDiscoverAndScoreInfluencers(supabase, brand, brandId, platform, count)
    return NextResponse.json({ data: influencers, count: influencers.length }, { status: 201 })
  } catch (err) {
    console.error("[influencers/auto-discover] failed:", err)
    return NextResponse.json(
      buildError(ErrorCodes.AI_GENERATION_FAILED, "Auto-discovery failed. Please try again."),
      { status: 500 },
    )
  }
}
