import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { updateProductSchema } from "@/lib/validations/product"
import { buildError, ErrorCodes } from "@/types/api"
import type { ProductRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string; productId: string }> }

async function getAuthorizedProduct(brandId: string, productId: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: "unauthenticated" as const, supabase, user: null, product: null }

  const { data: brand } = await supabase.from("brands").select("user_id").eq("id", brandId).single<{ user_id: string }>()
  if (!brand) return { error: "not_found" as const, supabase, user, product: null }
  if (brand.user_id !== user.id) return { error: "unauthorized" as const, supabase, user, product: null }

  const { data: product } = await supabase.from("products").select("*").eq("id", productId).eq("brand_id", brandId).single<ProductRow>()
  if (!product) return { error: "not_found" as const, supabase, user, product: null }

  return { error: null, supabase, user, product }
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { brandId, productId } = await params
  const result = await getAuthorizedProduct(brandId, productId)
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.PRODUCT_NOT_FOUND, "Product not found."), { status: 404 })
  if (result.error === "unauthorized") return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })
  return NextResponse.json({ data: result.product })
}

export async function PUT(request: Request, { params }: RouteParams) {
  const { brandId, productId } = await params
  const result = await getAuthorizedProduct(brandId, productId)
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.PRODUCT_NOT_FOUND, "Product not found."), { status: 404 })
  if (result.error === "unauthorized") return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = updateProductSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error } = await (result.supabase.from("products") as any)
    .update(parsed.data)
    .eq("id", productId)
    .select()
    .single() as { data: ProductRow | null; error: { message: string } | null }

  if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to update product.", error.message), { status: 500 })
  return NextResponse.json({ data: updated })
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  const { brandId, productId } = await params
  const result = await getAuthorizedProduct(brandId, productId)
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.PRODUCT_NOT_FOUND, "Product not found."), { status: 404 })
  if (result.error === "unauthorized") return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (result.supabase.from("products") as any).update({ is_active: false }).eq("id", productId)
  if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to delete product.", error.message), { status: 500 })
  return NextResponse.json({ data: { deleted: true } })
}
