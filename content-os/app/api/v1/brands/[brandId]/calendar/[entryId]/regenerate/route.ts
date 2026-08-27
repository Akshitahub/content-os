import { NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage, refundGenerationUsage } from "@/lib/usage/check-and-increment-usage"
import { POST as POST_CREDIT_COST, CAROUSEL as CAROUSEL_CREDIT_COST } from "@/lib/usage/credit-costs"
import { generateHooks } from "@/lib/ai/hooks-generator"
import { generateContent } from "@/lib/ai/content-generator"
import { generatePostImage } from "@/lib/ai/post-image-pipeline"
import { DEFAULT_POST_TEMPLATE_ID } from "@/lib/design/post-templates"
import { resolveColorThemes } from "@/lib/design/color-themes"
import { generateCarouselHtml } from "@/lib/design/post-card-generator"
import { renderCarouselSlidesToPng } from "@/lib/image/carousel-compositor"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import { mergeCaptionWithHookAndCta } from "@/lib/utils/caption-merge"
import { fetchPastExamples } from "@/lib/ai/past-examples"
import { isInternalUnlimited } from "@/lib/usage/is-internal-unlimited"
import type { BrandRow, CalendarEntryRow } from "@/types/database"
import type { UserPlan, Platform, GeneratedCaption, CarouselContent } from "@/types/app"

const IMAGE_BUCKET = "brand-images"
const FEATURE = "calendar_regenerate"
// Instagram carousels need at least 2 images to be publishable — same
// minimum lib/ai/fastlane.ts and app/api/v1/calendar/schedule-post/route.ts
// enforce.
const MIN_CAROUSEL_SLIDES = 2

type RouteParams = { params: Promise<{ brandId: string; entryId: string }> }

const VALID_PLATFORMS = new Set<Platform>(["instagram", "facebook", "tiktok", "youtube", "linkedin", "twitter"])

function resolvePlatform(platform: string | null): Platform {
  return platform && VALID_PLATFORMS.has(platform as Platform) ? (platform as Platform) : "instagram"
}

// Chains a hook call + a content call (run concurrently) and, for "post"
// entries, a further image generation call — same headroom as
// app/api/v1/ai/fullpost/generate/route.ts and .../post-image/generate/route.ts.
export const maxDuration = 60

/**
 * Regenerates exactly one calendar_entries row in place, routed by its
 * content_type to the same single-format generators the manual Create flow
 * already uses (generateHooks/generateContent/generatePostImage) — no
 * bespoke generation logic of its own. Autopilot's executeFastlane() only
 * ever writes content_type "post", "carousel", or "reel"; "reel" isn't
 * supported here yet (video regeneration is a much bigger async,
 * webhook-driven job — see lib/ai/fastlane.ts's submitAutopilotReel) and
 * returns a clear error rather than a half-built attempt at it.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { brandId, entryId } = await params
  console.log(`[calendar/regenerate] POST called for brand ${brandId} entry ${entryId}`)

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[calendar/regenerate] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const { data: entry } = await supabase
    .from("calendar_entries")
    .select("*")
    .eq("id", entryId)
    .eq("brand_id", brandId)
    .single<CalendarEntryRow>()
  if (!entry) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Calendar entry not found."), { status: 404 })

  if (entry.content_type !== "post" && entry.content_type !== "carousel") {
    return NextResponse.json(
      buildError(
        ErrorCodes.VALIDATION_ERROR,
        entry.content_type === "reel"
          ? "Regenerating a Reel isn't supported yet — video generation needs its own dedicated flow."
          : "Regeneration isn't supported for this content type yet."
      ),
      { status: 400 }
    )
  }

  const cost = entry.content_type === "carousel" ? CAROUSEL_CREDIT_COST : POST_CREDIT_COST
  const usageCheck = await checkAndIncrementUsage(user.id, cost, FEATURE)
  if (!usageCheck.ok) {
    const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
    return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
  }
  const logId = usageCheck.logId

  const platform = resolvePlatform(entry.platform)
  // calendar_entries has no product_id column -- Autopilot never recorded
  // which product (if any) a slot was built around, so a regenerate has no
  // way to recover that reference. Content is regenerated brand-general,
  // same as any Create-flow generation with no product picked.
  const additionalContext = entry.title || undefined

  const { data: userData } = await supabase.from("users").select("plan").eq("id", user.id).single<{ plan: UserPlan }>()
  const plan: UserPlan = userData?.plan ?? "starter"
  const isInternalUnlimitedUser = isInternalUnlimited(user.id)

  try {
    if (entry.content_type === "carousel") {
      const pastExamples = await fetchPastExamples(supabase, brandId, "carousel")
      const contentResult = await generateContent(brand, "carousel", { platform, additionalContext, pastExamples })
      const carousel = contentResult.data as CarouselContent
      const coverHook = carousel.slides[0]?.headline || entry.title

      const existingData = (entry.platform_specific_data ?? {}) as Record<string, unknown>
      const platformData: Record<string, unknown> = { ...existingData }

      if (carousel.slides.length >= MIN_CAROUSEL_SLIDES) {
        try {
          const slidePngs = await renderCarouselSlidesToPng({ brand, coverHook, slides: carousel.slides })
          const uploaded: string[] = []
          for (let idx = 0; idx < slidePngs.length; idx++) {
            const uploadResult = await uploadMediaToStorage(
              { kind: "buffer", buffer: slidePngs[idx]!, mimeType: "image/png" },
              `${brandId}/carousel/${Date.now()}-${idx}`
            )
            if ("publicUrl" in uploadResult) {
              uploaded.push(uploadResult.publicUrl)
            } else {
              console.error(`[calendar/regenerate] entry ${entryId}: carousel slide ${idx} upload failed:`, uploadResult.error)
            }
          }
          if (uploaded.length >= MIN_CAROUSEL_SLIDES) {
            platformData.content_format = "carousel"
            platformData.image_urls = uploaded
            platformData.hosted_image_urls = uploaded
            platformData.carousel_html = generateCarouselHtml(brand, coverHook, carousel.slides)
          } else {
            console.error(`[calendar/regenerate] entry ${entryId}: only ${uploaded.length}/${slidePngs.length} carousel slide(s) uploaded, keeping previous images`)
          }
        } catch (err) {
          console.error(`[calendar/regenerate] entry ${entryId}: carousel image rendering failed:`, err instanceof Error ? err.message : err)
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: updated, error: updateError } = await (supabase.from("calendar_entries") as any)
        .update({
          hook_text: coverHook || null,
          caption_text: carousel.caption || null,
          hashtags: carousel.hashtags ?? [],
          platform_specific_data: platformData,
          updated_at: new Date().toISOString(),
        })
        .eq("id", entryId)
        .eq("brand_id", brandId)
        .select()
        .single() as { data: CalendarEntryRow | null; error: { message: string } | null }

      if (updateError || !updated) throw new Error(updateError?.message ?? "Failed to save regenerated content")

      return NextResponse.json({ data: updated }, { status: 200 })
    }

    // content_type === "post"
    const pastExamples = await fetchPastExamples(supabase, brandId, "social_post")
    const [hookResult, contentResult] = await Promise.all([
      generateHooks(brand, { hookTypes: ["bold_statement", "question", "story"], count: 1, platform, additionalContext }),
      generateContent(brand, "social_post", { platform, additionalContext, pastExamples, includeImagePrompt: true }),
    ])

    const hook = hookResult.hooks[0]
    if (!hook) throw new Error("Hook generation returned no results")

    const caption = contentResult.data as GeneratedCaption
    caption.caption_text = mergeCaptionWithHookAndCta(caption.caption_text, hook.hook_text, caption.cta)

    const existingData = (entry.platform_specific_data ?? {}) as Record<string, unknown>
    const platformData: Record<string, unknown> = { ...existingData }

    // This route regenerates an existing calendar entry (created by
    // Autopilot or manual scheduling), not the interactive Create -> Full
    // Post flow this task's "no way to opt out" complaint is about --
    // preserves the entry's existing visual behavior (text on the image)
    // by merging the old separate headline/CTA into the pipeline's new
    // single captionText field, same reasoning as lib/ai/fastlane.ts.
    const regenCaptionText = [hook.hook_text, caption.cta || brand.cta_phrase || "Shop now"].filter(Boolean).join(" — ")
    const imageResult = await generatePostImage({
      imagePrompt: caption.image_prompt || entry.visual_direction || "professional product photography",
      brandNiche: brand.niche,
      targetAudience: brand.target_audience,
      template: DEFAULT_POST_TEMPLATE_ID,
      colorTheme: resolveColorThemes(brand)[0]!,
      captionText: regenCaptionText,
      logoUrl: brand.logo_url,
      plan,
      isInternalUnlimitedUser,
    })

    if (imageResult.success) {
      const admin = await createAdminClient()
      const storagePath = `${user.id}/${brandId}/${Date.now()}-${crypto.randomUUID()}.png`
      const { error: uploadError } = await admin.storage
        .from(IMAGE_BUCKET)
        .upload(storagePath, imageResult.buffer, { contentType: imageResult.mimeType, upsert: false })

      if (uploadError) {
        console.error(`[calendar/regenerate] entry ${entryId}: image generated but storage upload failed:`, uploadError.message)
      } else {
        const { data: publicUrlData } = admin.storage.from(IMAGE_BUCKET).getPublicUrl(storagePath)
        platformData.image_url = publicUrlData.publicUrl
      }
    } else {
      console.error(`[calendar/regenerate] entry ${entryId}: image generation failed, keeping previous image:`, imageResult.error)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error: updateError } = await (supabase.from("calendar_entries") as any)
      .update({
        hook_text: hook.hook_text,
        caption_text: caption.caption_text,
        hashtags: caption.hashtags,
        visual_direction: caption.image_prompt || entry.visual_direction,
        platform_specific_data: platformData,
        updated_at: new Date().toISOString(),
      })
      .eq("id", entryId)
      .eq("brand_id", brandId)
      .select()
      .single() as { data: CalendarEntryRow | null; error: { message: string } | null }

    if (updateError || !updated) throw new Error(updateError?.message ?? "Failed to save regenerated content")

    return NextResponse.json({ data: updated }, { status: 200 })
  } catch (err) {
    console.error(`[calendar/regenerate] entry ${entryId} failed:`, err instanceof Error ? err.message : err)
    await refundGenerationUsage(supabase, user.id, cost, logId)
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Regeneration failed. Please try again."), { status: 500 })
  }
}
