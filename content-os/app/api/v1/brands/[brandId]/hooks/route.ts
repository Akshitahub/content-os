import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { HookRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string }> }

async function getAuthorizedBrand(brandId: string) {
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[hooks] createClient failed:", err)
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

export async function GET(request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log(`[hooks/${brandId}] GET called`)
  const result = await getAuthorizedBrand(brandId)

  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  if (result.error === "unauthorized") return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })

  const { searchParams } = new URL(request.url)
  const savedParam = searchParams.get("saved")
  const limitParam = searchParams.get("limit")
  const hookType = searchParams.get("hookType")

  try {
    let query = result.supabase!
      .from("hooks")
      .select("*")
      .eq("brand_id", brandId)
      .order("created_at", { ascending: false })

    // Default to saved=true; pass saved=false to get all
    if (savedParam !== "false") {
      query = query.eq("is_saved", true)
    }

    if (hookType && hookType !== "all") {
      query = query.eq("hook_type", hookType)
    }

    if (limitParam) {
      const limit = parseInt(limitParam, 10)
      if (!isNaN(limit) && limit > 0) query = query.limit(limit)
    }

    const { data: hooks, error } = await query.returns<HookRow[]>()

    if (error) {
      console.error(`[hooks/${brandId}] GET query error:`, error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch hooks.", error.message), { status: 500 })
    }

    return NextResponse.json({ data: hooks })
  } catch (err) {
    console.error(`[hooks/${brandId}] GET unexpected error:`, err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch hooks."), { status: 500 })
  }
}
