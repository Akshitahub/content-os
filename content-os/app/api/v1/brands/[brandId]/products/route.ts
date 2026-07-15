import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createProductSchema } from "@/lib/validations/product"
import { buildError, ErrorCodes } from "@/types/api"
import type { ProductRow } from "@/types/database"
import { PLAN_LIMITS } from "@/types/app"
import type { UserPlan } from "@/types/app"

type RouteParams = { params: Promise<{ brandId: string }> }

async function getAuthorizedBrand(brandId: string) {
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[products] createClient failed:", err)
    return { error: "server_error" as const, supabase: null, user: null }
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: "unauthenticated" as const, supabase, user: null }

  const { data: brand } = await supabase
    .from("brands")
    .select("id, user_id")
    .eq("id", brandId)
    .single<{ id: string; user_id: string }>()

  if (!brand) return { error: "not_found" as const, supabase, user }
  if (brand.user_id !== user.id) return { error: "unauthorized" as const, supabase, user }

  return { error: null, supabase, user }
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log(`[products/${brandId}] GET called`)
  const result = await getAuthorizedBrand(brandId)

  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  if (result.error === "unauthorized") return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })

  try {
    const { data: products, error } = await result.supabase!
      .from("products")
      .select("*")
      .eq("brand_id", brandId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .returns<ProductRow[]>()

    if (error) {
      console.error(`[products/${brandId}] GET fetch error:`, error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch products.", error.message), { status: 500 })
    }

    return NextResponse.json({ data: products })
  } catch (err) {
    console.error(`[products/${brandId}] GET unexpected error:`, err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch products."), { status: 500 })
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log(`[products/${brandId}] POST called`)
  const result = await getAuthorizedBrand(brandId)

  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  if (result.error === "unauthorized") return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = createProductSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  try {
    const { data: userRow, error: userError } = await result.supabase!
      .from("users")
      .select("plan")
      .eq("id", result.user!.id)
      .single<{ plan: UserPlan }>()

    if (userError || !userRow) {
      console.error(`[products/${brandId}] POST plan lookup error:`, userError)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to verify plan."), { status: 500 })
    }

    // Product limit is per-account, not per-brand (matches how brands/generations
    // limits work) — so this counts active products across all of the user's brands,
    // not just the one being posted to.
    const { data: ownedBrands, error: brandsError } = await result.supabase!
      .from("brands")
      .select("id")
      .eq("user_id", result.user!.id)
      .returns<{ id: string }[]>()

    if (brandsError || !ownedBrands) {
      console.error(`[products/${brandId}] POST owned-brands lookup error:`, brandsError)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to verify product count."), { status: 500 })
    }

    const { count: productCount, error: countError } = await result.supabase!
      .from("products")
      .select("*", { count: "exact", head: true })
      .in("brand_id", ownedBrands.map((b) => b.id))
      .eq("is_active", true)

    if (countError) {
      console.error(`[products/${brandId}] POST product count error:`, countError)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to verify product count."), { status: 500 })
    }

    const productLimit = PLAN_LIMITS[userRow.plan].products
    if ((productCount ?? 0) >= productLimit) {
      return NextResponse.json(
        buildError(ErrorCodes.USAGE_LIMIT_EXCEEDED, `You've reached the maximum of ${productLimit} products on your plan. Upgrade to add more.`),
        { status: 403 }
      )
    }
  } catch (err) {
    console.error(`[products/${brandId}] POST plan/limit check unexpected error:`, err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to verify plan limits."), { status: 500 })
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: product, error } = await (result.supabase!.from("products") as any)
      .insert({ ...parsed.data, brand_id: brandId })
      .select()
      .single() as { data: ProductRow | null; error: { message: string } | null }

    if (error) {
      console.error(`[products/${brandId}] POST insert error:`, error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to create product.", error.message), { status: 500 })
    }

    return NextResponse.json({ data: product }, { status: 201 })
  } catch (err) {
    console.error(`[products/${brandId}] POST unexpected error:`, err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to create product."), { status: 500 })
  }
}
