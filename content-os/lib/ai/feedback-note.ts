import { after } from "next/server"
import { distillLesson, type DistillInput } from "./brand-brain"

/**
 * The "why" behind a 1-2 star rating, shared by every rating route that
 * isn't captions/hooks (those keep their own inline copy of this exact
 * flow): store the note in the polymorphic content_feedback_notes
 * (supabase/migrations/053), then -- only if that insert succeeded --
 * distill it into the brand's lessons after the response is sent. Fully
 * fail-soft: a note problem never fails the rating update, which already
 * succeeded before this runs.
 */
export async function recordLowRatingNote(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  brandId: string
  contentType: string
  contentId: string
  rating: number | null | undefined
  note: string | null | undefined
  contentText: string
  scope: DistillInput["scope"]
  logPrefix: string
}): Promise<void> {
  const note = params.note?.trim()
  if (!note || params.rating == null || params.rating > 2) return
  try {
    const { error } = await params.supabase.from("content_feedback_notes").insert({
      brand_id: params.brandId,
      content_type: params.contentType,
      content_id: params.contentId,
      rating: params.rating,
      note,
    })
    if (error) {
      console.error(`${params.logPrefix} content_feedback_notes insert failed (non-fatal):`, error.message)
      return
    }
    const lessonInput: DistillInput = { brandId: params.brandId, scope: params.scope, rating: params.rating, note, contentText: params.contentText }
    after(() => distillLesson(params.supabase, lessonInput))
  } catch (err) {
    console.error(`${params.logPrefix} feedback note failed (non-fatal):`, err instanceof Error ? err.message : err)
  }
}
