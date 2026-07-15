import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createBrandSchema } from "@/lib/validations/brand"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow } from "@/types/database"
import { PLAN_LIMITS } from "@/types/app"
import type { UserPlan } from "@/types/app"

export async function GET() {
  console.log("[brands] GET called")
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[brands] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error initializing request."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  try {
    const { data: brands, error } = await supabase
      .from("brands")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .returns<BrandRow[]>()

    if (error) {
      console.error("[brands] GET fetch error:", error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch brands.", error.message), { status: 500 })
    }

    return NextResponse.json({ data: brands })
  } catch (err) {
    console.error("[brands] GET unexpected error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch brands."), { status: 500 })
  }
}

export async function POST(request: Request) {
  console.log("[brands] POST called")
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[brands] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error initializing request."), { status: 500 })
  }

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

  try {
    const { data: userRow, error: userError } = await supabase
      .from("users")
      .select("plan")
      .eq("id", user.id)
      .single<{ plan: UserPlan }>()

    if (userError || !userRow) {
      console.error("[brands] POST plan lookup error:", userError)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to verify plan."), { status: 500 })
    }

    const { count: brandCount, error: countError } = await supabase
      .from("brands")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_active", true)

    if (countError) {
      console.error("[brands] POST brand count error:", countError)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to verify brand count."), { status: 500 })
    }

    const brandLimit = PLAN_LIMITS[userRow.plan].brands
    if ((brandCount ?? 0) >= brandLimit) {
      return NextResponse.json(
        buildError(ErrorCodes.USAGE_LIMIT_EXCEEDED, `You've reached the maximum of ${brandLimit} brands on your plan. Upgrade to add more.`),
        { status: 403 }
      )
    }
  } catch (err) {
    console.error("[brands] POST plan/limit check unexpected error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to verify plan limits."), { status: 500 })
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brand, error } = await (supabase.from("brands") as any)
      .insert({ ...parsed.data, user_id: user.id })
      .select()
      .single() as { data: BrandRow | null; error: { message: string } | null }

    if (error) {
      console.error("[brands] POST insert error:", error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to create brand.", error.message), { status: 500 })
    }

    return NextResponse.json({ data: brand }, { status: 201 })
  } catch (err) {
    console.error("[brands] POST unexpected error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to create brand."), { status: 500 })
  }
}
