import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import { z } from "zod"
import { postDesignSchema } from "@/lib/design/post-design-fields"
import type { CalendarEntryRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string; entryId: string }> }

// The re-flattened image arrives as a base64 data URL (JPEG from
// CalendarEntryPanel -- see lib/utils/post-overlay-export.ts), so this is
// the largest field by far. 6M chars ~= a 4.5MB image.
const schema = z.object({
  overlayText: z.string().max(300),
  imageDataUrl: z.string().max(6_000_000).regex(/^data:image\/(?:png|jpeg);base64,/),
  // A designed post: the edited words, kept so it can be re-edited again.
  postDesign: postDesignSchema.optional(),
})

/**
 * Saves new on-image text for a scheduled single-image Post without a new
 * image generation -- the Post equivalent of the Story/Carousel render
 * routes. The text is re-flattened onto the entry's saved text-free base
 * image IN THE BROWSER (same lib/utils/post-overlay-export.ts the Create ->
 * Full Post tool uses, so the result matches what the user saw there);
 * this route only hosts the result and points the entry at it.
 *
 * Never calls any AI model and charges no credits (same as the
 * Story/Carousel render routes). Only entries scheduled from the Post tool
 * after this change have a `base_image_url` -- older entries get a 409,
 * and the calendar hides the action for them.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const startTime = Date.now()
  const { brandId, entryId } = await params

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })
  }
  const { overlayText, imageDataUrl, postDesign } = parsed.data

  const { data: brand } = await supabase.from("brands").select("id").eq("id", brandId).eq("user_id", user.id).single<{ id: string }>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const { data: entry } = await supabase
    .from("calendar_entries")
    .select("*")
    .eq("id", entryId)
    .eq("brand_id", brandId)
    .single<CalendarEntryRow>()
  if (!entry) return NextResponse.json(buildError(ErrorCodes.NOT_FOUND, "Calendar entry not found."), { status: 404 })

  const data = (entry.platform_specific_data ?? {}) as Record<string, unknown>
  if (entry.status === "published") {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "This post is already published."), { status: 409 })
  }
  if (typeof data.base_image_url !== "string" || !data.base_image_url) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "This post's image text can't be edited -- it was scheduled before editing was available."), { status: 409 })
  }

  // Same hosting convention as app/api/v1/calendar/schedule-post/route.ts.
  const uploadResult = await uploadMediaToStorage({ kind: "dataUrl", dataUrl: imageDataUrl }, `${brandId}/scheduled-${Date.now()}`, { generatedImage: true })
  if ("error" in uploadResult) {
    console.error(`[calendar/image-text] entry ${entryId}: upload failed:`, uploadResult.error)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't save the updated image. Please try again."), { status: 500 })
  }

  // base_image_url is kept as-is so the text can be edited again. image_url
  // is set to the hosted URL too (never the data URL -- it would bloat the
  // row). publish-scheduled reads hosted_image_url first.
  const nextData = {
    ...data,
    image_url: uploadResult.publicUrl,
    hosted_image_url: uploadResult.publicUrl,
    overlay_text: overlayText,
    ...(postDesign ? { post_design: postDesign } : {}),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error: updateError } = await (supabase.from("calendar_entries") as any)
    .update({ platform_specific_data: nextData, updated_at: new Date().toISOString() })
    .eq("id", entryId)
    .select()
    .single() as { data: CalendarEntryRow | null; error: { message: string } | null }

  if (updateError || !updated) {
    console.error(`[calendar/image-text] entry ${entryId}: update failed:`, updateError?.message)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't save the updated image. Please try again."), { status: 500 })
  }

  // Same provider/cost/latency/outcome line shape as the AI call sites --
  // logged here rather than as an ai_generation_logs row: no model runs and
  // nothing is charged, and that table's row count is the dashboard's
  // "generations this month" figure.
  console.log(`[calendar/image-text] entry ${entryId}: provider=none model=none stage=post_text_rerender costUsd=0 latencyMs=${Date.now() - startTime} success=true`)
  return NextResponse.json({ data: updated }, { status: 200 })
}
