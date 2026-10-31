import { NextResponse } from "next/server"
import { noteGenerationBrand } from "@/lib/ai/provider-fallback"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage, refundGenerationUsage } from "@/lib/usage/check-and-increment-usage"
import { POST as POST_CREDIT_COST, CAROUSEL as CAROUSEL_CREDIT_COST } from "@/lib/usage/credit-costs"
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
import { timedGenerationRoute, type GenerationTimer } from "@/lib/utils/generation-timing"
import { withDeadline, DeadlineExceededError, GENERATION_TIMED_OUT_MESSAGE } from "@/lib/utils/with-deadline"
import { prepareGeneratedImage } from "@/lib/storage/generated-image"
import { getActiveLessons } from "@/lib/ai/brand-brain"
import { resolveTypography } from "@/lib/design/fonts"
import { rememberBrandTypography } from "@/lib/design/brand-typography"
import { stampPostLayout } from "@/lib/design/text-layouts"
import { getPrimaryColor } from "@/lib/design/post-card-generator"
import { generatePostCopy } from "@/lib/ai/post-copy"
import { artDirectionForRequest } from "@/lib/ai/art-direction"
import { generationErrorMessage } from "@/lib/ai/generation-retry"

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
// entries, a further image generation call.
// 300s = Hobby maximum with fluid compute (vercel.com/docs/functions/
// configuring-functions/duration, checked 2026-10-26). Was 60, below the
// image step's own ~100s worst case: Vercel killed the function after the
// credit charge and the catch block's refund never ran. ROUTE_DEADLINE_MS
// stops this route's model work 30s earlier so the refund always runs.
export const maxDuration = 300
const ROUTE_DEADLINE_MS = 270_000

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
// Fact-guard time budget (lib/ai/fact-guard.ts): the text step must leave
// room inside maxDuration for what follows it -- slide rendering +
// uploads for a carousel, the (up to two-attempt) image generation for a
// post. Past these deadlines a fact-guard retry is skipped and the
// unsupported claim stripped instead.
const CAROUSEL_TEXT_DEADLINE_MS = 200_000
const POST_TEXT_DEADLINE_MS = 150_000

export async function POST(request: Request, ctx: RouteParams) {
  return timedGenerationRoute("calendar-regenerate", (timer) => handlePost(request, ctx, timer))
}

async function handlePost(request: Request, { params }: RouteParams, timer: GenerationTimer) {
  const requestStartedAt = Date.now()
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
  noteGenerationBrand(brand.id, user.id)

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
      const lessons = await getActiveLessons(supabase, brandId, "carousel")
      const contentResult = await timer.step("caption", withDeadline(generateContent(brand, "carousel", { platform, additionalContext, pastExamples, factGuardDeadline: requestStartedAt + CAROUSEL_TEXT_DEADLINE_MS, lessons }), requestStartedAt + ROUTE_DEADLINE_MS - Date.now(), "regenerate carousel copy"))
      const carousel = contentResult.data as CarouselContent
      const coverHook = carousel.slides[0]?.headline || entry.title

      const existingData = (entry.platform_specific_data ?? {}) as Record<string, unknown>
      const platformData: Record<string, unknown> = { ...existingData }

      if (carousel.slides.length >= MIN_CAROUSEL_SLIDES) {
        try {
          const typography = resolveTypography(brand, { density: "dense" })
          await rememberBrandTypography(supabase, brand, typography)
          // Content-matched layouts from each slide's kicker / highlight (lib/design/text-layouts.ts).
          const slidePngs = await renderCarouselSlidesToPng({ brand, coverHook, slides: carousel.slides, fontId: typography.heading, autoLayouts: true })
          const uploaded: string[] = []
          for (let idx = 0; idx < slidePngs.length; idx++) {
            const uploadResult = await uploadMediaToStorage(
              { kind: "buffer", buffer: slidePngs[idx]!, mimeType: "image/png" },
              `${brandId}/carousel/${Date.now()}-${idx}`,
              { generatedImage: true }
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
    // Brand art direction (lib/ai/art-direction.ts): the cached one (stale or none;
    // a missing / stale one is re-derived in the background, never awaited) in
    // brand_brain; every brief and image prompt below reads it. Fail-soft.
    const artDirection = await artDirectionForRequest(supabase, brand)
    const pastExamples = await fetchPastExamples(supabase, brandId, "social_post")
    const [hookLessons, captionLessons] = await Promise.all([
      getActiveLessons(supabase, brandId, "hook"),
      getActiveLessons(supabase, brandId, "caption"),
    ])
    // Caption first, then the hook from its plan (lib/ai/post-copy.ts).
    const { hook: hookResult, caption: contentResult } = await timer.step("caption", withDeadline(generatePostCopy(brand, {
      platform, additionalContext, pastExamples, factGuardDeadline: requestStartedAt + POST_TEXT_DEADLINE_MS,
      captionLessons, hookLessons,
    }), requestStartedAt + ROUTE_DEADLINE_MS - Date.now(), "regenerate post copy"))

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
    // Content-matched layout for the composited text (lib/design/text-layouts.ts).
    const regenTypography = resolveTypography(brand)
    const regenLayout = stampPostLayout(caption, regenCaptionText, { brand, headingFont: regenTypography.heading, visualKind: caption.visual?.kind, accentColor: getPrimaryColor(brand) })
    const imageResult = await timer.step("image", withDeadline(generatePostImage({
      artDirection,
      imagePrompt: caption.image_prompt || entry.visual_direction || "professional product photography",
      brandNiche: brand.niche,
      targetAudience: brand.target_audience,
      template: DEFAULT_POST_TEMPLATE_ID,
      colorTheme: resolveColorThemes(brand)[0]!,
      captionText: regenCaptionText,
      // Brand-level typography for the composited caption (lib/design/fonts.ts).
      fontId: regenTypography.heading,
      bodyFontId: regenTypography.body,
      textLayout: regenLayout.text_layout,
      kicker: regenLayout.kicker,
      highlight: regenLayout.highlight,
      logoUrl: brand.logo_url,
      plan,
      isInternalUnlimitedUser,
    }), requestStartedAt + ROUTE_DEADLINE_MS - Date.now(), "regenerate image"))

    if (imageResult.success) {
      const admin = await createAdminClient()
      const image = await prepareGeneratedImage(imageResult.buffer, imageResult.mimeType, "calendar/regenerate")
      const storagePath = `${user.id}/${brandId}/${Date.now()}-${crypto.randomUUID()}.${image.ext}`
      const { error: uploadError } = await admin.storage
        .from(IMAGE_BUCKET)
        .upload(storagePath, image.buffer, { contentType: image.mimeType, upsert: false })

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
    const timedOut = err instanceof DeadlineExceededError
    // Off the entry's topic after a repair and a regeneration: say exactly that.
    const topicError = generationErrorMessage(err)
    return NextResponse.json(
      buildError(ErrorCodes.AI_GENERATION_FAILED, topicError ?? (timedOut ? GENERATION_TIMED_OUT_MESSAGE : "Regeneration failed. Please try again.")),
      { status: topicError ? 422 : timedOut ? 504 : 500 }
    )
  }
}
