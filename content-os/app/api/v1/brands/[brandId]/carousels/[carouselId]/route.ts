import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { z } from "zod"
import type { CarouselRow } from "@/types/database"

type Params = { params: Promise<{ brandId: string; carouselId: string }> }

// The slide shape CarouselBuilder.tsx actually builds (headline/body text
// plus, once generated, an imageUrl) — loose rather than a strict object
// schema since `slides` is a plain Json column with no DB-level shape
// enforcement, and this route's only job is to persist whatever the client
// already composited, not re-validate its content.
const slideSchema = z.record(z.string(), z.unknown())

const updateSchema = z.object({
  user_rating: z.number().int().min(1).max(5).optional(),
  is_saved: z.boolean().optional(),
  // Previously there was no way to ever persist slide image URLs back to
  // this row at all -- CarouselBuilder.tsx only ever held them in local
  // React state, so a "saved" carousel in the Library never actually had
  // its images in the database to show.
  slides: z.array(slideSchema).optional(),
})

export async function PUT(request: Request, { params }: Params) {
  console.log("[brands/carousels/:id] PUT called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[brands/carousels/:id] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed."), { status: 400 })

  const { brandId, carouselId } = await params

  const { data: brand } = await supabase
    .from("brands")
    .select("user_id")
    .eq("id", brandId)
    .single<{ user_id: string }>()

  if (!brand || brand.user_id !== user.id) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })
  }

  try {
    // Any successful PUT (rating, save/unsave, or a bare touch call) is
    // genuine engagement — stamp last_accessed_at so this doesn't look
    // abandoned to the cleanup cron.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from("carousels") as any)
      .update({ ...parsed.data, last_accessed_at: new Date().toISOString() })
      .eq("id", carouselId)
      .eq("brand_id", brandId)
      .select()
      .single() as { data: CarouselRow | null; error: { message: string } | null }
    if (error) {
      console.error("[brands/carousels/:id] update error:", error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Update failed."), { status: 500 })
    }
    return NextResponse.json({ data })
  } catch (err) {
    console.error("[brands/carousels/:id] error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Update failed."), { status: 500 })
  }
}
