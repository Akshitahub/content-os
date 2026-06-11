import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createProductSchema } from "@/lib/validations/product"
import { buildError, ErrorCodes } from "@/types/api"
import type { ProductRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string }> }

async function getAuthorizedBrand(brandId: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: "unauthenticated" as const, supabase, user: null }

  const { data: brand } = await supabase
    .from("brands")
    .select("id, user_id")
    .eq("id", brandId)
    .single()

  if (!brand) return { error: "not_found" as const, supabase, user }
  if (brand.user_id !== user.id) return { error: "unauthorized" as const, supabase, user }

  return { error: null, supabase, user }
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { brandId } = await params
  const result = await getAuthorizedBrand(brandId)

  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  if (result.error === "unauthorized") return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })

  const { data: products, error } = await result.supabase
    .from("products")
    .select("*")
    .eq("brand_id", brandId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .returns<ProductRow[]>()

  if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch products.", error.message), { status: 500 })

  return NextResponse.json({ data: products })
}

export async function POST(request: Request, { params }: RouteParams) {
  const { brandId } = await params
  const result = await getAuthorizedBrand(brandId)

  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  if (result.error === "unauthorized") return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = createProductSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: product, error } = await (result.supabase.from("products") as any)
    .insert({ ...parsed.data, brand_id: brandId })
    .select()
    .single() as { data: ProductRow | null; error: { message: string } | null }

  if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to create product.", error.message), { status: 500 })

  return NextResponse.json({ data: product }, { status: 201 })
}
