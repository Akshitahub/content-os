import { NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { z } from "zod"
import type { StoryRow } from "@/types/database"
import { extractStoragePath } from "@/lib/storage/extract-storage-path"

const MEDIA_BUCKET = "published-media"

type Params = { params: Promise<{ brandId: string; storyId: string }> }

// The slide shape StorySequence.tsx actually builds (text/subtext/type
// plus, once generated, a background_image_url) — loose rather than a
// strict object schema since `stories` is a plain Json column with no
// DB-level shape enforcement, and this route's only job is to persist
// whatever the client already has, not re-validate its content.
const storySlideSchema = z.record(z.string(), z.unknown())

const updateSchema = z.object({
  user_rating: z.number().int().min(1).max(5).optional(),
  is_saved: z.boolean().optional(),
  // Previously there was no way to ever persist slide background image
  // URLs back to this row at all -- StorySequence.tsx only ever held them
  // in local React state, so a "saved" story sequence in the Library
  // never actually had its images in the database to show.
  stories: z.array(storySlideSchema).optional(),
})

export async function PUT(request: Request, { params }: Params) {
  console.log("[brands/stories/:id] PUT called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[brands/stories/:id] createClient failed:", err)
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

  const { brandId, storyId } = await params

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
    const { data, error } = await (supabase.from("stories") as any)
      .update({ ...parsed.data, last_accessed_at: new Date().toISOString() })
      .eq("id", storyId)
      .eq("brand_id", brandId)
      .select()
      .single() as { data: StoryRow | null; error: { message: string } | null }
    if (error) {
      console.error("[brands/stories/:id] update error:", error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Update failed."), { status: 500 })
    }
    return NextResponse.json({ data })
  } catch (err) {
    console.error("[brands/stories/:id] error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Update failed."), { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: Params) {
  console.log("[brands/stories/:id] DELETE called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[brands/stories/:id] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { brandId, storyId } = await params

  const { data: brand } = await supabase
    .from("brands")
    .select("user_id")
    .eq("id", brandId)
    .single<{ user_id: string }>()

  if (!brand || brand.user_id !== user.id) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })
  }

  try {
    // Same reasoning as carousels/[carouselId]/route.ts's DELETE: slide
    // backgrounds are re-hosted in the published-media bucket, only the
    // public_url is stored on a slide, so it has to be recovered before
    // it can be removed. Non-fatal on a removal failure, same as the old
    // Memes purge cleanup -- a rare orphaned file shouldn't block the
    // user's actual delete request.
    const { data: existing } = await supabase
      .from("stories")
      .select("stories")
      .eq("id", storyId)
      .eq("brand_id", brandId)
      .single<{ stories: unknown }>()

    if (existing && Array.isArray(existing.stories)) {
      const paths = existing.stories
        .map((s) => (s && typeof s === "object" && "background_image_url" in s ? (s as { background_image_url?: unknown }).background_image_url : null))
        .filter((url): url is string => typeof url === "string" && url.length > 0)
        .map((url) => extractStoragePath(url, MEDIA_BUCKET))
        .filter((p): p is string => !!p)

      if (paths.length > 0) {
        // Admin client -- see carousels/[carouselId]/route.ts's DELETE for
        // why: storage RLS on this bucket doesn't grant this request's
        // own context delete access, confirmed live (the regular client
        // silently removed nothing). Brand ownership is already verified
        // above, so bypassing it here is safe.
        const admin = await createAdminClient()
        const { error: removeError } = await admin.storage.from(MEDIA_BUCKET).remove(paths)
        if (removeError) {
          console.error("[brands/stories/:id] slide image removal error (continuing to delete row):", removeError.message)
        }
      }
    }

    const { error } = await supabase.from("stories").delete().eq("id", storyId).eq("brand_id", brandId)
    if (error) {
      console.error("[brands/stories/:id] delete error:", error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Delete failed."), { status: 500 })
    }
    return NextResponse.json({ data: { deleted: true } })
  } catch (err) {
    console.error("[brands/stories/:id] delete error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Delete failed."), { status: 500 })
  }
}
