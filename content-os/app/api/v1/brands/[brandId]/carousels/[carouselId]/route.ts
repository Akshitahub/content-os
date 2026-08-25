import { NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { z } from "zod"
import type { CarouselRow } from "@/types/database"
import { extractStoragePath } from "@/lib/storage/extract-storage-path"

const MEDIA_BUCKET = "published-media"

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

export async function DELETE(request: Request, { params }: Params) {
  console.log("[brands/carousels/:id] DELETE called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[brands/carousels/:id] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

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
    // Slide backgrounds are re-hosted in the published-media bucket (see
    // CarouselBuilder.tsx's fetchSlideBackground/uploadMediaToStorage) --
    // only the public_url ever gets stored back onto a slide, not a raw
    // path, so it has to be recovered before it can be removed. Attempted
    // before the row delete, same order and same non-fatal-on-failure
    // handling as the old Memes purge cleanup used (cron/cleanup-
    // abandoned-drafts/route.ts): a storage removal error is logged, not
    // treated as blocking -- the user asked to delete this carousel, and
    // a rare orphaned file shouldn't be the reason that request fails.
    const { data: existing } = await supabase
      .from("carousels")
      .select("slides")
      .eq("id", carouselId)
      .eq("brand_id", brandId)
      .single<{ slides: unknown }>()

    if (existing && Array.isArray(existing.slides)) {
      const paths = existing.slides
        .map((s) => (s && typeof s === "object" && "image_url" in s ? (s as { image_url?: unknown }).image_url : null))
        .filter((url): url is string => typeof url === "string" && url.length > 0)
        .map((url) => extractStoragePath(url, MEDIA_BUCKET))
        .filter((p): p is string => !!p)

      if (paths.length > 0) {
        // Admin client -- storage RLS on this bucket expects the uploader's
        // own write/delete context (same reasoning already documented in
        // app/api/v1/ai/post-image/generate/route.ts's upload step), which
        // this request doesn't have; brand ownership is already verified
        // above, so bypassing it here is safe. Confirmed live: using the
        // regular request-scoped client here silently failed to remove
        // anything (non-fatal by design, so it looked like success) until
        // switched to admin.
        const admin = await createAdminClient()
        const { error: removeError } = await admin.storage.from(MEDIA_BUCKET).remove(paths)
        if (removeError) {
          console.error("[brands/carousels/:id] slide image removal error (continuing to delete row):", removeError.message)
        }
      }
    }

    const { error } = await supabase.from("carousels").delete().eq("id", carouselId).eq("brand_id", brandId)
    if (error) {
      console.error("[brands/carousels/:id] delete error:", error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Delete failed."), { status: 500 })
    }
    return NextResponse.json({ data: { deleted: true } })
  } catch (err) {
    console.error("[brands/carousels/:id] delete error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Delete failed."), { status: 500 })
  }
}
