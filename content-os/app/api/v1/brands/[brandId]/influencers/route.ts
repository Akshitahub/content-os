import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createInfluencerSchema } from "@/lib/validations/influencer"
import { buildError, ErrorCodes } from "@/types/api"
import { PLAN_LIMITS, type UserPlan } from "@/types/app"
import { isInternalUnlimited } from "@/lib/usage/is-internal-unlimited"
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

  const { data: userData } = await result.supabase!.from("users").select("plan").eq("id", result.user!.id).single<{ plan: UserPlan }>()
  const plan: UserPlan = userData?.plan ?? "free"
  if (!PLAN_LIMITS[plan].influencerOutreach && !isInternalUnlimited(result.user!.id)) {
    return NextResponse.json(
      buildError(ErrorCodes.USAGE_LIMIT_EXCEEDED, "Influencer outreach tools are available on Pro and Agency plans. Upgrade to use this feature."),
      { status: 403 }
    )
  }

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

// Clears every discovered influencer for one discovery mode (Find
// Influencers vs. Find Customers), scoped by the required discoveryType
// query param -- never both modes at once, since the page shows one at a
// time and a user asking to "clear this list and redo the search" almost
// certainly doesn't mean the other tab too. Lets the frontend offer a
// clean "start over" instead of manually deleting rows one by one.
export async function DELETE(request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log("[influencers] DELETE called")

  const result = await getAuthorizedBrand(brandId)
  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const { searchParams } = new URL(request.url)
  const discoveryType = searchParams.get("discoveryType")
  if (discoveryType !== "influencer_partner" && discoveryType !== "prospect_customer") {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "discoveryType query param is required (influencer_partner or prospect_customer)."), { status: 400 })
  }

  try {
    // Rows inserted before discovery_type existed have it NULL, and the
    // page's own display logic already treats a NULL row as
    // influencer_partner (see InfluencersPage's `scoped` filter) -- match
    // that exact fallback here so "clear my Find Influencers list" doesn't
    // leave old NULL-typed rows behind, silently reappearing after the
    // "empty" state.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (result.supabase!.from("influencers") as any).delete({ count: "exact" }).eq("brand_id", brandId)
    query = discoveryType === "influencer_partner"
      ? query.or("discovery_type.eq.influencer_partner,discovery_type.is.null")
      : query.eq("discovery_type", discoveryType)

    const { error, count } = await query as { error: { message: string } | null; count: number | null }
    if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to clear influencers.", error.message), { status: 500 })

    return NextResponse.json({ data: { deleted: count ?? 0 } })
  } catch (err) {
    console.error("[influencers] DELETE failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to clear influencers."), { status: 500 })
  }
}
