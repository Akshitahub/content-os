import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createBrandSchema } from "@/lib/validations/brand"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow } from "@/types/database"

export async function GET() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  const { data: brands, error } = await supabase
    .from("brands")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .returns<BrandRow[]>()

  if (error) {
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch brands.", error.message), { status: 500 })
  }

  return NextResponse.json({ data: brands })
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON body."), { status: 400 })
  }

  const parsed = createBrandSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brand, error } = await (supabase.from("brands") as any)
    .insert({ ...parsed.data, user_id: user.id })
    .select()
    .single() as { data: BrandRow | null; error: { message: string } | null }

  if (error) {
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to create brand.", error.message), { status: 500 })
  }

  return NextResponse.json({ data: brand }, { status: 201 })
}
