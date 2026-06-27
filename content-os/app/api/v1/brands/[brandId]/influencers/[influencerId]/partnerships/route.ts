import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { updatePartnershipSchema } from "@/lib/validations/influencer"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow, InfluencerPartnershipRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string; influencerId: string }> }

async function getAuthorizedBrand(brandId: string) {
  let supabase
  try { supabase = await createClient() } catch (err) {
    console.error("[influencers/partnerships] createClient failed:", err)
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
  console.log("[influencers/partnerships] GET called")

  const result = await getAuthorizedBrand(brandId)
  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  // Verify influencer belongs to this brand
  try {
    const { data: existing } = await result.supabase!
      .from("influencers")
      .select("id")
      .eq("id", influencerId)
      .eq("brand_id", brandId)
      .single<{ id: string }>()

    if (!existing) return NextResponse.json(buildError(ErrorCodes.NOT_FOUND, "Influencer not found."), { status: 404 })
  } catch (err) {
    console.error("[influencers/partnerships] influencer verify failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to verify influencer."), { status: 500 })
  }

  let partnerships: InfluencerPartnershipRow[]
  try {
    const { data, error } = await result.supabase!
      .from("influencer_partnerships")
      .select("*")
      .eq("influencer_id", influencerId)
      .eq("brand_id", brandId)
      .order("created_at", { ascending: false })
      .returns<InfluencerPartnershipRow[]>()

    if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch partnerships.", error.message), { status: 500 })
    partnerships = data ?? []
  } catch (err) {
    console.error("[influencers/partnerships] GET DB query failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch partnerships."), { status: 500 })
  }

  return NextResponse.json({ data: partnerships })
}

export async function PUT(request: Request, { params }: RouteParams) {
  const { brandId, influencerId } = await params
  console.log("[influencers/partnerships] PUT called")

  const result = await getAuthorizedBrand(brandId)
  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = updatePartnershipSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { partnershipId, ...updateFields } = parsed.data

  // Verify partnership belongs to this influencer and brand
  let updated: InfluencerPartnershipRow | null
  try {
    const { data: existing } = await result.supabase!
      .from("influencer_partnerships")
      .select("id")
      .eq("id", partnershipId)
      .eq("influencer_id", influencerId)
      .eq("brand_id", brandId)
      .single<{ id: string }>()

    if (!existing) return NextResponse.json(buildError(ErrorCodes.NOT_FOUND, "Partnership not found."), { status: 404 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (result.supabase!.from("influencer_partnerships") as any)
      .update({ ...updateFields, updated_at: new Date().toISOString() })
      .eq("id", partnershipId)
      .eq("influencer_id", influencerId)
      .eq("brand_id", brandId)
      .select()
      .single() as { data: InfluencerPartnershipRow | null; error: { message: string } | null }

    if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to update partnership.", error.message), { status: 500 })
    updated = data
  } catch (err) {
    console.error("[influencers/partnerships] PUT failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to update partnership."), { status: 500 })
  }

  return NextResponse.json({ data: updated })
}
