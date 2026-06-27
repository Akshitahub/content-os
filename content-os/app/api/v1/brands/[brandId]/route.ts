import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { updateBrandSchema } from "@/lib/validations/brand"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow } from "@/types/database"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string }> }

async function getAuthorizedBrand(brandId: string) {
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[brands/[brandId]] createClient failed:", err)
    return { error: "server_error" as const, supabase: null, user: null, brand: null }
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { error: "unauthenticated" as const, supabase, user: null, brand: null }
  }

  const { data: brand, error } = await supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .single<BrandRow>()

  if (error || !brand) {
    return { error: "not_found" as const, supabase, user, brand: null }
  }

  if (brand.user_id !== user.id) {
    return { error: "unauthorized" as const, supabase, user, brand: null }
  }

  return { error: null, supabase, user, brand }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function brandsTable(supabase: SupabaseClient<Database>): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).from("brands")
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log(`[brands/${brandId}] GET called`)
  const result = await getAuthorizedBrand(brandId)

  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  if (result.error === "unauthorized") return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "You do not have access to this brand."), { status: 403 })

  return NextResponse.json({ data: result.brand })
}

export async function PUT(request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log(`[brands/${brandId}] PUT called`)
  const result = await getAuthorizedBrand(brandId)

  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  if (result.error === "unauthorized") return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "You do not have access to this brand."), { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON body."), { status: 400 })
  }

  const parsed = updateBrandSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })
  }

  try {
    const { data: updated, error } = await brandsTable(result.supabase!)
      .update(parsed.data)
      .eq("id", brandId)
      .select()
      .single() as { data: BrandRow | null; error: { message: string } | null }

    if (error) {
      console.error(`[brands/${brandId}] PUT update error:`, error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to update brand.", error.message), { status: 500 })
    }

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error(`[brands/${brandId}] PUT unexpected error:`, err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to update brand."), { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log(`[brands/${brandId}] DELETE called`)
  const result = await getAuthorizedBrand(brandId)

  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  if (result.error === "unauthorized") return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "You do not have access to this brand."), { status: 403 })

  try {
    const { error } = await brandsTable(result.supabase!)
      .update({ is_active: false })
      .eq("id", brandId) as { error: { message: string } | null }

    if (error) {
      console.error(`[brands/${brandId}] DELETE error:`, error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to delete brand.", error.message), { status: 500 })
    }

    return NextResponse.json({ data: { deleted: true } })
  } catch (err) {
    console.error(`[brands/${brandId}] DELETE unexpected error:`, err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to delete brand."), { status: 500 })
  }
}
