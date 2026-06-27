import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { updateInfluencerSchema } from "@/lib/validations/influencer"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow, InfluencerRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string; influencerId: string }> }

async function getAuthorizedBrand(brandId: string) {
  let supabase
  try { supabase = await createClient() } catch (err) {
    console.error("[influencers/[influencerId]] createClient failed:", err)
    return { error: "server_error" as const, supabase: null, user: null, brand: null }
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: "unauthenticated" as const, supabase, user: null, brand: null }
  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return { error: "not_found" as const, supabase, user, brand: null }
  return { error: null, supabase, user, brand }
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { brandId, influencerId } = await params
  console.log("[influencers/[influencerId]] GET called")

  const result = await getAuthorizedBrand(brandId)
  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let influencer: InfluencerRow | null
  try {
    const { data, error } = await result.supabase!
      .from("influencers")
      .select("*")
      .eq("id", influencerId)
      .eq("brand_id", brandId)
      .single<InfluencerRow>()

    if (error || !data) return NextResponse.json(buildError(ErrorCodes.NOT_FOUND, "Influencer not found."), { status: 404 })
    influencer = data
  } catch (err) {
    console.error("[influencers/[influencerId]] GET DB query failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch influencer."), { status: 500 })
  }

  return NextResponse.json({ data: influencer })
}

export async function PUT(request: Request, { params }: RouteParams) {
  const { brandId, influencerId } = await params
  console.log("[influencers/[influencerId]] PUT called")

  const result = await getAuthorizedBrand(brandId)
  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = updateInfluencerSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  // Verify the influencer belongs to this brand
  let updated: InfluencerRow | null
  try {
    const { data: existing } = await result.supabase!
      .from("influencers")
      .select("id")
      .eq("id", influencerId)
      .eq("brand_id", brandId)
      .single<{ id: string }>()

    if (!existing) return NextResponse.json(buildError(ErrorCodes.NOT_FOUND, "Influencer not found."), { status: 404 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (result.supabase!.from("influencers") as any)
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq("id", influencerId)
      .eq("brand_id", brandId)
      .select()
      .single() as { data: InfluencerRow | null; error: { message: string } | null }

    if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to update influencer.", error.message), { status: 500 })
    updated = data
  } catch (err) {
    console.error("[influencers/[influencerId]] PUT failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to update influencer."), { status: 500 })
  }

  return NextResponse.json({ data: updated })
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  const { brandId, influencerId } = await params
  console.log("[influencers/[influencerId]] DELETE called")

  const result = await getAuthorizedBrand(brandId)
  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  try {
    const { data: existing } = await result.supabase!
      .from("influencers")
      .select("id")
      .eq("id", influencerId)
      .eq("brand_id", brandId)
      .single<{ id: string }>()

    if (!existing) return NextResponse.json(buildError(ErrorCodes.NOT_FOUND, "Influencer not found."), { status: 404 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (result.supabase!.from("influencers") as any)
      .delete()
      .eq("id", influencerId)
      .eq("brand_id", brandId)

    if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to delete influencer.", error.message), { status: 500 })
  } catch (err) {
    console.error("[influencers/[influencerId]] DELETE failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to delete influencer."), { status: 500 })
  }

  return NextResponse.json({ data: { deleted: true } })
}
