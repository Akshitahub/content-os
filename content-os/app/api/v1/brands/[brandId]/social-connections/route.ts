import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string }> }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function socialConnectionsTable(supabase: SupabaseClient<Database>): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).from("social_connections")
}

async function getAuthorizedBrand(brandId: string) {
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[brands/[brandId]/social-connections] createClient failed:", err)
    return { error: "server_error" as const, supabase: null, user: null }
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { error: "unauthenticated" as const, supabase, user: null }
  }

  const { data: brand } = await supabase
    .from("brands")
    .select("id, user_id")
    .eq("id", brandId)
    .single<{ id: string; user_id: string }>()

  if (!brand) {
    return { error: "not_found" as const, supabase, user }
  }
  if (brand.user_id !== user.id) {
    return { error: "unauthorized" as const, supabase, user }
  }

  return { error: null, supabase, user }
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log(`[brands/${brandId}/social-connections] GET called`)
  const result = await getAuthorizedBrand(brandId)

  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  if (result.error === "unauthorized") return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "You do not have access to this brand."), { status: 403 })

  // Never select access_token here — this response goes straight to the client.
  const { data, error } = await socialConnectionsTable(result.supabase!)
    .select("ig_username, connected_at, is_active")
    .eq("brand_id", brandId)
    .eq("platform", "instagram")
    .eq("is_active", true)
    .maybeSingle() as {
      data: { ig_username: string | null; connected_at: string; is_active: boolean } | null
      error: { message: string } | null
    }

  if (error) {
    console.error(`[brands/${brandId}/social-connections] GET error:`, error)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch connection status."), { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ data: { connected: false, ig_username: null, connected_at: null } })
  }

  return NextResponse.json({
    data: {
      connected: true,
      ig_username: data.ig_username,
      connected_at: data.connected_at,
    },
  })
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log(`[brands/${brandId}/social-connections] DELETE called`)
  const result = await getAuthorizedBrand(brandId)

  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  if (result.error === "unauthorized") return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "You do not have access to this brand."), { status: 403 })

  const { error } = await socialConnectionsTable(result.supabase!)
    .update({ is_active: false })
    .eq("brand_id", brandId)
    .eq("platform", "instagram") as { error: { message: string } | null }

  if (error) {
    console.error(`[brands/${brandId}/social-connections] DELETE error:`, error)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to disconnect."), { status: 500 })
  }

  return NextResponse.json({ data: { deleted: true } })
}
