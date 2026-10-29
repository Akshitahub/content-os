import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { MODELS, classifyOpenAIError } from "@/lib/ai/models"
import { UsageCarryingError } from "@/lib/ai/pricing"
import { checkAndIncrementUsage, refundGenerationUsage, logGenerationOutcome } from "@/lib/usage/check-and-increment-usage"
import { CAROUSEL } from "@/lib/usage/credit-costs"
import { generateCarouselWithRetry } from "@/lib/ai/carousel-generator"
import { finishGeneratedCarousel } from "@/lib/ai/carousel-postprocess"
import { z } from "zod"
import type { BrandRow } from "@/types/database"
import { rememberBrandTypography } from "@/lib/design/brand-typography"
import { timedGenerationRoute, type GenerationTimer } from "@/lib/utils/generation-timing"
import { withDeadline, DeadlineExceededError, GENERATION_TIMED_OUT_MESSAGE } from "@/lib/utils/with-deadline"
import { getActiveLessons } from "@/lib/ai/brand-brain"
import { recordContentEvent } from "@/lib/usage/content-events"
import { gateEventMeta } from "@/lib/ai/quality-gate"
import { layoutCarouselText, overflowingSlides } from "@/lib/design/slide-text-layout"

const schema = z.object({
  brandId: z.string().uuid(),
  topic: z.string().min(2).max(300),
  slideCount: z.number().int().min(5).max(10).default(7),
  platform: z.enum(["instagram", "linkedin"]).default("instagram"),
  vibe: z.string().optional(),
})

// One model call for the whole sequence (60s timeout + one SDK retry), a
// possible fact-guard retry and a JSON-parse retry -- the worst case can approach or pass
// Vercel's 300s. 300s is the Hobby maximum with fluid compute
// (vercel.com/docs/functions/configuring-functions/duration, checked
// 2026-10-26); the route's own deadline stops 30s earlier so the refund +
// JSON error path below always runs instead of Vercel killing the function.
export const maxDuration = 300
const COPY_DEADLINE_MS = 270_000

export async function POST(request: Request) {
  return timedGenerationRoute("carousel", (timer) => handlePost(request, timer))
}

async function handlePost(request: Request, timer: GenerationTimer) {
  const deadlineAt = Date.now() + COPY_DEADLINE_MS
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  const usageCheck = await checkAndIncrementUsage(user.id, CAROUSEL, "carousel")
  if (!usageCheck.ok) {
    const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
    return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
  }
  const logId = usageCheck.logId

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })
  }

  const { brandId, topic, slideCount, platform, vibe } = parsed.data

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  // Feed the brand's own past highly-rated carousels back into the prompt
  // as few-shot examples — skip entirely if none exist yet.
  const pastExamples: string[] = []
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pastCarousels } = await (supabase.from("carousels") as any)
      .select("slides")
      .eq("brand_id", brandId)
      .gte("user_rating", 4)
      .order("user_rating", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5) as { data: { slides: unknown }[] | null }

    for (const c of pastCarousels ?? []) {
      if (!Array.isArray(c.slides)) continue
      const headlines = c.slides
        .map((s) => (s && typeof s === "object" && "headline" in s ? String((s as { headline: unknown }).headline) : null))
        .filter((h): h is string => !!h)
      if (headlines.length > 0) pastExamples.push(headlines.join(" / "))
    }
  } catch (err) {
    console.error("[ai/carousel/generate] fetching past examples failed (non-fatal):", err)
  }

  // Finalizes this generation's ai_generation_logs row (created by
  // checkAndIncrementUsage above) with model, tokens, cost, latency and
  // outcome -- on every exit path below, success or failure. Never logs
  // the topic or generated copy.
  const startTime = Date.now()
  let gen: Awaited<ReturnType<typeof generateCarouselWithRetry>> | null = null
  const recordOutcome = (success: boolean, errorMessage?: string, failedUsage?: UsageCarryingError) =>
    logGenerationOutcome(supabase, logId, {
      user_id: user.id, brand_id: brandId, feature: "carousel", model: gen?.model ?? MODELS.creative,
      prompt_tokens: (gen?.usage ?? failedUsage?.usage)?.prompt_tokens ?? null,
      completion_tokens: (gen?.usage ?? failedUsage?.usage)?.completion_tokens ?? null,
      total_tokens: (gen?.usage ?? failedUsage?.usage)?.total_tokens ?? null,
      cost_usd: gen?.costUsd ?? failedUsage?.costUsd ?? null,
      latency_ms: Date.now() - startTime, success, error_message: errorMessage ?? null,
    })

  try {
    // Moved from Groq to OpenAI (MODELS.creative) in the Phase 1b
    // migration -- prompt + call now live in lib/ai/carousel-generator.ts.
    const lessons = await getActiveLessons(supabase, brandId, "carousel")
    gen = await timer.step("caption", withDeadline(generateCarouselWithRetry(brand, topic, slideCount, platform, vibe, pastExamples, lessons, deadlineAt), deadlineAt - Date.now(), "carousel copy"))
    const data = gen.data

    const d = data as Record<string, unknown>
    if (!Array.isArray(d.slides) || d.slides.length === 0) {
      await recordOutcome(false, "AI returned no carousel slides")
      await refundGenerationUsage(supabase, user.id, CAROUSEL, logId)
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Carousel generation failed. Please try again."), { status: 500 })
    }

    // CTA merge, vibe backgrounds, brand typography, text sanitizing and
    // content-matched layouts -- shared with Autopilot (lib/ai/carousel-postprocess.ts).
    const realHandle = brand.instagram_handle ? `@${brand.instagram_handle}` : undefined
    const finished = finishGeneratedCarousel(d, brand, { vibe, realHandle })
    const mergedSlides = finished.slides
    const typography = finished.typography
    d.suggested_font_id = typography.heading
    // Saved to the brand on its first generation (lib/design/brand-typography.ts).
    await rememberBrandTypography(supabase, brand, typography)
    const cleanTitle = finished.title
    const cleanCoverHook = finished.coverHook

    // Persist (non-fatal) — matches the pattern used by every other
    // generate route: the generate call itself saves, the client never
    // needs a separate save request. The id is now returned to the client
    // (previously discarded) so it can PUT slide image URLs back onto this
    // same row once they're generated — see the carousels/[carouselId]
    // PUT route's new `slides` field.
    let carouselId: string | null = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: saved } = await (supabase.from("carousels") as any)
        .insert({
          brand_id: brandId,
          platform,
          title: typeof cleanTitle === "string" ? cleanTitle : null,
          slides: mergedSlides,
          hashtags: finished.hashtags,
          is_saved: true,
        })
        .select("id")
        .single() as { data: { id: string } | null }
      carouselId = saved?.id ?? null
    } catch (persistErr) {
      console.error("[ai/carousel/generate] persist failed (non-fatal):", persistErr)
    }
    // Slides whose text only fits past the compositor's smallest size
    // (lib/design/slide-text-layout.ts) -- the builder shows the same notice.
    const textOverflow = overflowingSlides(mergedSlides as Record<string, unknown>[], (s) => layoutCarouselText({
      type: s.type as "cover" | "content" | "cta",
      headline: String(s.headline ?? ""),
      subtext: s.type === "cover" ? (s.subtext as string | undefined) : undefined,
      points: s.type === "content" ? (s.points as string[] | undefined) : undefined,
      ctaText: s.type === "cta" ? (s.cta as string | undefined) : undefined,
      ctaHandle: s.type === "cta" ? (s.handle as string | undefined) : undefined,
    }).overflow)
    recordContentEvent(supabase, { userId: user.id, brandId, contentType: "carousel", contentId: carouselId, event: "generated", meta: { model: gen.model, cost_usd: gen.costUsd, ...gateEventMeta(gen.gate), ...(textOverflow.length ? { text_overflow: true, text_overflow_slides: textOverflow.map((i) => i + 1) } : {}) } })

    // slides returned to the client is the same merged array now saved to
    // the row -- CarouselBuilder.tsx's own withCtaSlideMerged() sees the
    // cta-type slide already present and is a no-op (it explicitly checks
    // for this), so this doesn't change client behavior, just keeps what
    // the client renders and what's in the database consistent from the
    // very first response.
    await recordOutcome(true)
    return NextResponse.json({ data: { ...d, title: cleanTitle, cover_hook: cleanCoverHook, slides: mergedSlides, hashtags: finished.hashtags, id: carouselId } }, { status: 200 })
  } catch (err) {
    console.error("[ai/carousel/generate] error:", err)
    await recordOutcome(false, err instanceof Error ? err.message : "Unknown error", err instanceof UsageCarryingError ? err : undefined)
    await refundGenerationUsage(supabase, user.id, CAROUSEL, logId)
    // A raw thrown error here can be the OpenAI SDK's own error object
    // (network/auth/rate-limit/timeout failures), which can surface the
    // provider in its message text -- classifyOpenAIError strips that
    // before this ever reaches the user.
    const timedOut = err instanceof DeadlineExceededError
    return NextResponse.json(
      buildError(ErrorCodes.AI_GENERATION_FAILED, timedOut ? GENERATION_TIMED_OUT_MESSAGE : classifyOpenAIError(err)),
      { status: timedOut ? 504 : 500 }
    )
  }
}
