import { NextResponse, after } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateFullPostFromPhotoSchema } from "@/lib/validations/ai"
import { analyzePhotoForPost } from "@/lib/ai/vision"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage, refundGenerationUsage, logGenerationOutcome } from "@/lib/usage/check-and-increment-usage"
import { PHOTO_CAPTION } from "@/lib/usage/credit-costs"
import type { BrandRow } from "@/types/database"

const FEATURE = "fullpost_photo_upload"

/**
 * Create -> Full Post's "upload your own photo" path -- a genuinely
 * different capability from app/api/v1/ai/fullpost/generate/route.ts
 * (which either generates a background image via Flux/Pollinations, or
 * composites a saved Product's photo onto a template card). Here the
 * user's own freshly-uploaded photo IS the final image, unmodified --
 * this route never touches lib/ai/post-image-pipeline.ts at all. It's
 * uploaded once (to Supabase Storage, so it has a real public URL) and
 * that same URL is both what a real vision model (lib/ai/vision.ts) looks
 * at to write the caption, and what gets saved as this post's image.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = generateFullPostFromPhotoSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { brandId, imageDataUrl, additionalContext } = parsed.data

  const usageCheck = await checkAndIncrementUsage(user.id, PHOTO_CAPTION, FEATURE)
  if (!usageCheck.ok) {
    const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
    return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
  }
  const logId = usageCheck.logId

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) {
    await refundGenerationUsage(supabase, user.id, PHOTO_CAPTION, logId)
    return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  }

  const startTime = Date.now()

  // Upload the real photo FIRST -- it needs a real public HTTPS URL both to
  // hand to the vision model (Groq's vision input takes a URL, not a raw
  // data: URI) and to save as this post's actual image. "published-media"
  // (not "brand-images", which is for Flux/Pollinations-generated
  // backgrounds) since this is real, final, ready-to-schedule content from
  // the moment it's uploaded -- the same bucket ad-maker/upload-variation
  // already uses for exactly that reason.
  const uploadResult = await uploadMediaToStorage({ kind: "dataUrl", dataUrl: imageDataUrl }, `${brandId}/uploaded-posts`)
  if ("error" in uploadResult) {
    await refundGenerationUsage(supabase, user.id, PHOTO_CAPTION, logId)
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Couldn't upload your photo.", uploadResult.error), { status: 400 })
  }
  const photoUrl = uploadResult.publicUrl
  const photoStoragePath = uploadResult.storagePath

  try {
    const { hook, caption, model } = await analyzePhotoForPost(brand, photoUrl, additionalContext)

    // Same content_projects linking pattern as fullpost/generate — lets the
    // Library find this caption and its image as one post instead of two
    // disconnected rows.
    let contentProjectId: string | null = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: project, error: projectError } = await (supabase.from("content_projects") as any)
        .insert({ brand_id: brandId, title: hook.hook_text, platform: "instagram", content_type: "post" })
        .select("id")
        .single() as { data: { id: string } | null; error: { message: string } | null }
      if (projectError) throw new Error(projectError.message)
      contentProjectId = project?.id ?? null
    } catch (err) {
      // Non-fatal — same reasoning as fullpost/generate: the caption/image
      // still work fine without the link, they just won't show each other
      // in the Library.
      console.error("[ai/fullpost/generate-from-photo] failed to create content_projects row (non-fatal):", err instanceof Error ? err.message : err)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: hookInsertError } = await (supabase.from("hooks") as any).insert({
      brand_id: brandId,
      hook_text: hook.hook_text,
      hook_type: hook.hook_type,
      generation_prompt: "fullpost photo-upload",
      model_used: model,
      is_saved: true,
    })
    if (hookInsertError) throw new Error(`Failed to save hook: ${hookInsertError.message}`)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: captionInsertError } = await (supabase.from("captions") as any).insert({
      brand_id: brandId,
      content_project_id: contentProjectId,
      caption_text: caption.caption_text,
      hashtags: caption.hashtags,
      cta: caption.cta,
      character_count: caption.character_count,
      platform: "instagram",
      model_used: model,
      is_saved: true,
    })
    if (captionInsertError) throw new Error(`Failed to save caption: ${captionInsertError.message}`)

    // This is the core of the feature: the SAME photoUrl the vision model
    // analyzed is what gets saved as the post's image, byte-for-byte —
    // never generatePostImage's Flux/Pollinations pipeline, no compositing.
    // prompt/storage_path are NOT NULL on this table (confirmed against
    // supabase/migrations/002_generated_images.sql) -- prompt gets an
    // honest label rather than a fabricated generation prompt that never
    // existed, and storage_path is the real path uploadMediaToStorage just
    // wrote to (not null — there's a real file there, unlike an AI
    // generation this route never runs).
    //
    // text_composited deliberately omitted -- confirmed LIVE (2026-08-26,
    // a genuine Postgres 42703 "column does not exist" error, not a
    // PostgREST schema-cache issue) that migration 034_generated_images_
    // text_composited.sql was never actually run against the real
    // database, same "MANUAL STEP REQUIRED, no automated migration runner"
    // gap already hit for autopilot_run_status/festival_dates. This
    // affects the EXISTING AI-image path too (post-image/generate/route.ts
    // inserts this same column), not something introduced here -- flagged
    // to the user rather than silently worked around there. This route
    // never needs the column at all (it has a real DEFAULT false and
    // nothing here ever composites text), so it's just left out rather
    // than blocking this feature on an unrelated migration.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: savedImage, error: imageInsertError } = await (supabase.from("generated_images") as any)
      .insert({
        brand_id: brandId,
        content_project_id: contentProjectId,
        prompt: "User-uploaded photo (no AI-generated prompt — the photo itself is the image)",
        style: null,
        aspect_ratio: "1:1",
        storage_path: photoStoragePath,
        public_url: photoUrl,
        model_used: model,
        provider: "user_upload",
        is_saved: true,
      })
      .select()
      .single() as { data: { id: string } | null; error: { message: string } | null }
    if (imageInsertError) throw new Error(`Failed to save image: ${imageInsertError.message}`)

    after(async () => {
      await logGenerationOutcome(supabase, logId, {
        user_id: user.id, brand_id: brandId, feature: FEATURE, model,
        latency_ms: Date.now() - startTime, success: true,
      })
    })

    return NextResponse.json({
      data: {
        hook,
        content: { format: "social_post", content: caption },
        imageUrl: photoUrl,
        imageId: savedImage?.id ?? null,
        contentProjectId,
        platform: "instagram",
        format: "social_post",
      },
    }, { status: 200 })
  } catch (err) {
    console.error("[ai/fullpost/generate-from-photo] failed:", err)
    after(async () => {
      await logGenerationOutcome(supabase, logId, {
        user_id: user.id, brand_id: brandId, feature: FEATURE, model: "qwen/qwen3.6-27b",
        latency_ms: Date.now() - startTime, success: false,
        error_message: err instanceof Error ? err.message : "Unknown error",
      })
    })
    await refundGenerationUsage(supabase, user.id, PHOTO_CAPTION, logId)
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Couldn't generate a caption for your photo. Please try again."), { status: 500 })
  }
}
