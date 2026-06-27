import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { CaptionRow } from "@/types/database"
import { z } from "zod"

type RouteParams = { params: Promise<{ brandId: string; captionId: string }> }

const updateCaptionSchema = z.object({
  user_rating: z.number().int().min(1).max(5).optional().nullable(),
  is_saved: z.boolean().optional(),
})

export async function PUT(request: Request, { params }: RouteParams) {
  const { brandId, captionId } = await params
  console.log(`[captions/${brandId}/${captionId}] PUT called`)

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error(`[captions/${brandId}/${captionId}] createClient failed:`, err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = updateCaptionSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  try {
    const { data: caption } = await supabase
      .from("captions")
      .select("id, brand_id")
      .eq("id", captionId)
      .single<Pick<CaptionRow, "id" | "brand_id">>()

    if (!caption || caption.brand_id !== brandId) {
      return NextResponse.json(buildError(ErrorCodes.NOT_FOUND, "Caption not found."), { status: 404 })
    }

    const { data: brand } = await supabase
      .from("brands")
      .select("user_id")
      .eq("id", brandId)
      .single<{ user_id: string }>()

    if (!brand || brand.user_id !== user.id) {
      return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error } = await (supabase.from("captions") as any)
      .update(parsed.data)
      .eq("id", captionId)
      .select()
      .single() as { data: CaptionRow | null; error: { message: string } | null }

    if (error) {
      console.error(`[captions/${brandId}/${captionId}] PUT update error:`, error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to update caption.", error.message), { status: 500 })
    }

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error(`[captions/${brandId}/${captionId}] PUT unexpected error:`, err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to update caption."), { status: 500 })
  }
}
