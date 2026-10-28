import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { z } from "zod"
import type { AdCopyRow } from "@/types/database"
import { recordLowRatingNote } from "@/lib/ai/feedback-note"
import { recordContentEvent, savedAndRatedEvents } from "@/lib/usage/content-events"

type Params = { params: Promise<{ brandId: string; adId: string }> }

const updateSchema = z.object({
  user_rating: z.number().int().min(1).max(5).optional(),
  is_saved: z.boolean().optional(),
  // Only meaningful alongside a 1-2 star user_rating -- see
  // lib/ai/feedback-note.ts. Not a column, so it's split out before update().
  note: z.string().max(1000).optional().nullable(),
})

// The rated ad's own words, for lesson distillation.
function adFeedbackText(row: AdCopyRow | null): string {
  return [row?.headline, row?.primary_text, row?.description].filter((t) => typeof t === "string" && t).join("\n")
}

export async function PUT(request: Request, { params }: Params) {
  console.log("[brands/ad-copies/:id] PUT called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[brands/ad-copies/:id] createClient failed:", err)
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

  const { brandId, adId } = await params

  const { data: brand } = await supabase
    .from("brands")
    .select("user_id")
    .eq("id", brandId)
    .single<{ user_id: string }>()

  if (!brand || brand.user_id !== user.id) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })
  }

  const { note, ...update } = parsed.data

  try {
    // Any successful PUT (rating, save/unsave, or a bare touch call) is
    // genuine engagement — stamp last_accessed_at so this doesn't look
    // abandoned to the cleanup cron.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from("ad_copies") as any)
      .update({ ...update, last_accessed_at: new Date().toISOString() })
      .eq("id", adId)
      .eq("brand_id", brandId)
      .select()
      .single() as { data: AdCopyRow | null; error: { message: string } | null }
    if (error) {
      console.error("[brands/ad-copies/:id] update error:", error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Update failed."), { status: 500 })
    }
    // Content events (lib/usage/content-events.ts): saved / rated / edited.
    recordContentEvent(supabase, savedAndRatedEvents({ userId: user.id, brandId, contentType: "ad_copy", contentId: adId }, update))
    // The "why" behind a 1-2 star rating, distilled into the brand's
    // lessons -- same flow as the captions/hooks rating routes. Fail-soft.
    await recordLowRatingNote({
      supabase, brandId, contentType: "ad_copy", contentId: adId, rating: update.user_rating,
      note, contentText: adFeedbackText(data), scope: "ad_copy", logPrefix: "[brands/ad-copies/:id]",
    })
    return NextResponse.json({ data })
  } catch (err) {
    console.error("[brands/ad-copies/:id] error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Update failed."), { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: Params) {
  console.log("[brands/ad-copies/:id] DELETE called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[brands/ad-copies/:id] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { brandId, adId } = await params

  const { data: brand } = await supabase
    .from("brands")
    .select("user_id")
    .eq("id", brandId)
    .single<{ user_id: string }>()

  if (!brand || brand.user_id !== user.id) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })
  }

  try {
    // Ad copy has never had an image of its own (see the Library
    // content-linking task's diagnosis) — nothing to clean up in storage.
    const { error } = await supabase.from("ad_copies").delete().eq("id", adId).eq("brand_id", brandId)
    if (error) {
      console.error("[brands/ad-copies/:id] delete error:", error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Delete failed."), { status: 500 })
    }
    return NextResponse.json({ data: { deleted: true } })
  } catch (err) {
    console.error("[brands/ad-copies/:id] delete error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Delete failed."), { status: 500 })
  }
}
