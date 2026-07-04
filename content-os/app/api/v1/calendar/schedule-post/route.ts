import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import type { CalendarEntryInsert, CalendarEntryRow, Json } from "@/types/database"
import { z } from "zod"

const MIN_CAROUSEL_IMAGES = 2
const MAX_CAROUSEL_IMAGES = 10

const schedulePostSchema = z.object({
  brandId: z.string().uuid(),
  platform: z.enum(["instagram", "facebook"]),
  imageUrl: z.string().min(1).optional(),
  imageUrls: z.array(z.string().min(1)).optional(),
  contentFormat: z.enum(["single", "carousel"]).default("single"),
  caption: z.string().min(1).max(5000),
  hashtags: z.array(z.string().max(200)).optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/),
}).refine(
  (data) => data.contentFormat === "single" ? !!data.imageUrl : true,
  { message: "imageUrl is required for a single-image post.", path: ["imageUrl"] }
).refine(
  (data) => data.contentFormat === "carousel"
    ? !!data.imageUrls && data.imageUrls.length >= MIN_CAROUSEL_IMAGES && data.imageUrls.length <= MAX_CAROUSEL_IMAGES
    : true,
  { message: `imageUrls must have between ${MIN_CAROUSEL_IMAGES} and ${MAX_CAROUSEL_IMAGES} images for a carousel.`, path: ["imageUrls"] }
)

export async function POST(request: Request) {
  console.log("[calendar/schedule-post] POST called")
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[calendar/schedule-post] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error initializing request."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = schedulePostSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { brandId, platform, imageUrl, imageUrls, contentFormat, caption, hashtags, scheduledDate, scheduledTime } = parsed.data

  const { data: brand } = await supabase.from("brands").select("user_id").eq("id", brandId).single<{ user_id: string }>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  if (brand.user_id !== user.id) return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })

  let platformSpecificData: Json

  if (contentFormat === "carousel") {
    // Host EVERY image up front — if any single one fails, the whole
    // request fails before any calendar entry is created (same
    // immediate-failure rule as the single-image path below, just applied
    // per-image since a carousel can't publish with a missing slide).
    const sourceUrls = imageUrls!
    const hostedUrls: string[] = []

    for (let i = 0; i < sourceUrls.length; i++) {
      const sourceUrl = sourceUrls[i]!
      const uploadResult = await uploadMediaToStorage(
        sourceUrl.startsWith("data:") ? { kind: "dataUrl", dataUrl: sourceUrl } : { kind: "remoteUrl", url: sourceUrl },
        `${brandId}/scheduled-${Date.now()}-${i}`
      )

      if ("error" in uploadResult) {
        console.error(`[calendar/schedule-post] failed to host carousel image ${i + 1}/${sourceUrls.length}:`, uploadResult.error)
        return NextResponse.json(
          buildError(
            ErrorCodes.INTERNAL_ERROR,
            `Couldn't prepare image ${i + 1} of ${sourceUrls.length} for scheduling. Please try again.`,
            uploadResult.error
          ),
          { status: 500 }
        )
      }

      hostedUrls.push(uploadResult.publicUrl)
    }

    platformSpecificData = { image_urls: sourceUrls, hosted_image_urls: hostedUrls, content_format: "carousel" }
  } else {
    // Host the image up front — if this fails, the user needs to know right
    // now, not days later when the cron tries and gives up after 3 attempts.
    const uploadResult = await uploadMediaToStorage(
      imageUrl!.startsWith("data:") ? { kind: "dataUrl", dataUrl: imageUrl! } : { kind: "remoteUrl", url: imageUrl! },
      `${brandId}/scheduled-${Date.now()}`
    )

    if ("error" in uploadResult) {
      console.error("[calendar/schedule-post] failed to host image:", uploadResult.error)
      return NextResponse.json(
        buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't prepare the image for scheduling. Please try again.", uploadResult.error),
        { status: 500 }
      )
    }

    platformSpecificData = { image_url: imageUrl, hosted_image_url: uploadResult.publicUrl }
  }

  const title = caption.split("\n")[0].slice(0, 80) || "Scheduled post"

  const entryInsert: CalendarEntryInsert = {
    brand_id: brandId,
    title,
    scheduled_date: scheduledDate,
    scheduled_time: scheduledTime,
    platform,
    content_type: "post",
    status: "scheduled",
    caption_text: caption,
    hashtags: hashtags ?? [],
    publish_attempts: 0,
    platform_specific_data: platformSpecificData,
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: entry, error } = await (supabase.from("calendar_entries") as any)
      .insert(entryInsert)
      .select()
      .single() as { data: CalendarEntryRow | null; error: { message: string } | null }

    if (error) {
      console.error("[calendar/schedule-post] insert error:", error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to schedule post.", error.message), { status: 500 })
    }

    return NextResponse.json({ data: entry }, { status: 201 })
  } catch (err) {
    console.error("[calendar/schedule-post] unexpected error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to schedule post."), { status: 500 })
  }
}
