import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"

type RouteParams = { params: Promise<{ brandId: string; imageId: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const { brandId, imageId } = await params
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

  let body: { is_saved?: boolean }
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("generated_images") as any)
    .update({ is_saved: body.is_saved ?? false })
    .eq("id", imageId)
    .eq("brand_id", brandId)

  if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to update image."), { status: 500 })

  return NextResponse.json({ data: { success: true } })
}
