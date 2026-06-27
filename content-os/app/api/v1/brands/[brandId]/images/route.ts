import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"

type RouteParams = { params: Promise<{ brandId: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  const { brandId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { data: brand } = await supabase
    .from("brands")
    .select("id, user_id")
    .eq("id", brandId)
    .single<{ id: string; user_id: string }>()

  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  if (brand.user_id !== user.id) return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from("generated_images") as any)
    .select("id, prompt, style, aspect_ratio, public_url, created_at")
    .eq("brand_id", brandId)
    .eq("is_saved", true)
    .order("created_at", { ascending: false })
    .limit(100)

  if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch images."), { status: 500 })

  return NextResponse.json({ data: data ?? [] })
}
