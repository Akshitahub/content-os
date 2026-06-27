import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createInfluencerSchema } from "@/lib/validations/influencer"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow, InfluencerRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string }> }

async function getAuthorizedBrand(brandId: string) {
  let supabase
  try { supabase = await createClient() } catch (err) {
    console.error("[influencers] createClient failed:", err)
    return { error: "server_error" as const, supabase: null, user: null, brand: null }
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: "unauthenticated" as const, supabase, user: null, brand: null }
  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return { error: "not_found" as const, supabase, user, brand: null }
  return { error: null, supabase, user, brand }
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log("[influencers] GET called")

  const result = await getAuthorizedBrand(brandId)
  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let influencers: InfluencerRow[]
  try {
    const { data, error } = await result.supabase!
      .from("influencers")
      .select("*")
      .eq("brand_id", brandId)
      .order("fit_score", { ascending: false, nullsFirst: false })
      .returns<InfluencerRow[]>()

    if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch influencers.", error.message), { status: 500 })
    influencers = data ?? []
  } catch (err) {
    console.error("[influencers] GET DB query failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch influencers."), { status: 500 })
  }

  return NextResponse.json({ data: influencers })
}

export async function POST(request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log("[influencers] POST called")

  const result = await getAuthorizedBrand(brandId)
  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = createInfluencerSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  let influencer: InfluencerRow | null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (result.supabase!.from("influencers") as any)
      .insert({ ...parsed.data, brand_id: brandId })
      .select()
      .single() as { data: InfluencerRow | null; error: { message: string } | null }

    if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to create influencer.", error.message), { status: 500 })
    influencer = data
  } catch (err) {
    console.error("[influencers] POST insert failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to create influencer."), { status: 500 })
  }

  return NextResponse.json({ data: influencer }, { status: 201 })
}
