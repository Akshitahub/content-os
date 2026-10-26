import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { MODELS, classifyOpenAIError } from "@/lib/ai/models"
import { UsageCarryingError } from "@/lib/ai/pricing"
import { checkAndIncrementUsage, refundGenerationUsage, logGenerationOutcome } from "@/lib/usage/check-and-increment-usage"
import { CAROUSEL } from "@/lib/usage/credit-costs"
import { generateCarouselWithRetry } from "@/lib/ai/carousel-generator"
import { findContentQualityIssues, sanitizeLeakedArtifacts } from "@/lib/ai/content-quality-check"
import { z } from "zod"
import type { BrandRow } from "@/types/database"
import type { CarouselBackgroundStyle } from "@/lib/design/carousel-slide-styles"
import { resolveSuggestedFont } from "@/lib/design/fonts"
import { timedGenerationRoute, type GenerationTimer } from "@/lib/utils/generation-timing"
import { withDeadline, DeadlineExceededError, GENERATION_TIMED_OUT_MESSAGE } from "@/lib/utils/with-deadline"

const schema = z.object({
  brandId: z.string().uuid(),
  topic: z.string().min(2).max(300),
  slideCount: z.number().int().min(5).max(10).default(7),
  platform: z.enum(["instagram", "linkedin"]).default("instagram"),
  vibe: z.string().optional(),
})

// Confirmed live (2026-08-28): the LLM's `background_style` choice was
// effectively vibe-blind — two generations with vibe="professional" and
// vibe="fun_playful" produced byte-for-byte identical background_style
// (and rendered CSS) for every content slide, and the prompt's own
// "BACKGROUND STYLES (rotate through these...)" instruction ties each of
// the 4 fixed options to slide role ("for cover and CTA", "for content
// slides"), never to vibe — vibe is only ever mentioned once as loose
// context ("Visual Vibe: X"). Same root cause and same fix as
// VIBE_TO_STORY_BACKGROUND in app/api/v1/ai/stories/generate/route.ts:
// background_style is now assigned deterministically in code from the
// selected vibe, overriding the LLM's own (role-based) choice on every
// slide. No-op when no vibe was selected, preserving the prior default.
const VIBE_TO_CAROUSEL_BACKGROUND: Record<string, CarouselBackgroundStyle> = {
  fun_playful: "vibe_fun_playful",
  clean_minimal: "white_violet",
  bold_dramatic: "gradient_dark",
  warm_cozy: "vibe_warm_cozy",
  professional: "vibe_professional",
  trendy_genz: "vibe_trendy_genz",
}
// Mirrors CarouselBuilder.tsx's withCtaSlideMerged() -- the AI response's
// CTA slide is a separate `cta_slide` field, never part of `slides`, and
// until now the ONLY path that ever wrote it back to the database was the
// background-image enrichment step in CarouselBuilder.tsx (~line 421-444),
// which only PUTs the full slides array back if at least one of its two
// best-effort AI background fetches happens to succeed. If both fail
// (rate-limiting, an image-provider outage, etc.) or the user navigates away first,
// the CTA slide never reaches
// the database at all -- confirmed live as the root cause of Library
// carousels showing 6 slides instead of 7. Doing the same merge here,
// server-side, before the insert below, means the row is complete and
// correct from the moment it's created, independent of that later,
// optional, best-effort step.
// Confirmed live (2026-08-29) as its own real bug, found while tracing
// why a published carousel's CTA slide was missing its actual
// call-to-action line: this only ever copied `headline` from the AI's
// cta_slide object, silently dropping `cta` (the CTA line itself, e.g.
// "Follow for more tips like this") and `handle` (e.g. "@brand") --
// permanently, since the carousels table has no separate cta_slide
// column (see types/database.ts) and `slides` is the only thing ever
// persisted or read back. Every carousel ever saved lost this text the
// moment it was first generated, not just on a later reload. Now copies
// all three fields, mirroring CarouselBuilder.tsx's identical client-side
// withCtaSlideMerged() fix.
function mergeCtaSlideIntoSlides(slides: unknown[], ctaSlide: unknown, realHandle?: string): unknown[] {
  if (!ctaSlide || typeof ctaSlide !== "object") return slides
  const cta = ctaSlide as { headline?: unknown; cta?: unknown; handle?: unknown }
  // The model's own `handle` is never trusted over the brand's real,
  // code-known handle when one exists -- same "don't ask the LLM to echo
  // back a value the caller already has" reasoning as background_style's
  // deterministic override below. The prompt's own JSON example now shows
  // a plain "@yourhandle" placeholder (previously the real handle was
  // interpolated directly into that example, which is what a model this
  // route asks not to use placeholders inconsistently taught was actually
  // "real, expected text" rather than illustrative shape) — this override
  // makes the actual field correct regardless of which the model produced.
  const handle = realHandle ?? (typeof cta.handle === "string" ? cta.handle : undefined)
  const existingIndex = slides.findIndex((s) => s && typeof s === "object" && (s as { type?: unknown }).type === "cta")

  if (existingIndex !== -1) {
    // CONFIRMED live (2026-08-29): the model doesn't reliably stick to
    // "slides holds only cover+content, the CTA is the separate cta_slide
    // field" -- a real generation included its own type:"cta" entry
    // directly inside `slides` AS WELL AS a separate cta_slide object.
    // The old code treated any existing cta-type slide as "already
    // merged, nothing to do" and returned early -- but a model-authored
    // inline cta slide only ever follows the plain headline/points/
    // background_style shape, never `cta`/`handle` (those aren't part of
    // a regular slide's schema), so this silently persisted a CTA slide
    // with no actual call-to-action line or handle, exactly the reported
    // defect. Now backfills them from the separate cta_slide object
    // instead of skipping, without duplicating the slide.
    const existing = slides[existingIndex] as Record<string, unknown>
    if (typeof existing.cta === "string" && typeof existing.handle === "string" && realHandle === undefined) return slides
    const merged = [...slides]
    merged[existingIndex] = {
      ...existing,
      cta: typeof existing.cta === "string" ? existing.cta : (typeof cta.cta === "string" ? cta.cta : undefined),
      handle: handle ?? (typeof existing.handle === "string" ? existing.handle : undefined),
    }
    return merged
  }

  return [
    ...slides,
    {
      slide_number: slides.length + 1,
      type: "cta",
      background_style: "gradient_dark",
      headline: typeof cta.headline === "string" ? cta.headline : "",
      cta: typeof cta.cta === "string" ? cta.cta : undefined,
      handle,
    },
  ]
}

// Lightweight sanity pass over every real text field before it's persisted
// or returned — see lib/ai/content-quality-check.ts for what this catches
// (leaked "✓"/"✗" formatting markers, unfilled "[Placeholder]" brackets,
// raw template expressions, a stray unattached "x"). Mechanical
// fix-in-place rather than a second model call: this route doesn't have
// captions.ts's validate-and-retry infrastructure, and re-generating an
// entire 7-slide carousel over one bad word in one field would be a much
// heavier fix than the problem warrants. Logged loudly whenever it
// actually changes something, never a silent rewrite.
function sanitizeCarouselText(value: string | undefined): string | undefined {
  if (typeof value !== "string" || !value) return value
  if (findContentQualityIssues(value).length === 0) return value
  const cleaned = sanitizeLeakedArtifacts(value)
  console.error(`[ai/carousel/generate] stripped leaked artifact(s) from generated text: ${JSON.stringify(value)} -> ${JSON.stringify(cleaned)}`)
  return cleaned
}

function sanitizeCarouselSlides(slides: unknown[]): unknown[] {
  return slides.map((slide) => {
    if (!slide || typeof slide !== "object") return slide
    const s = slide as Record<string, unknown>
    return {
      ...s,
      headline: typeof s.headline === "string" ? sanitizeCarouselText(s.headline) : s.headline,
      subtext: typeof s.subtext === "string" ? sanitizeCarouselText(s.subtext) : s.subtext,
      points: Array.isArray(s.points) ? s.points.map((p) => (typeof p === "string" ? sanitizeCarouselText(p) : p)) : s.points,
      cta: typeof s.cta === "string" ? sanitizeCarouselText(s.cta) : s.cta,
    }
  })
}

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
    gen = await timer.step("caption", withDeadline(generateCarouselWithRetry(brand, topic, slideCount, platform, vibe, pastExamples), deadlineAt - Date.now(), "carousel copy"))
    const data = gen.data

    const d = data as Record<string, unknown>
    if (!Array.isArray(d.slides) || d.slides.length === 0) {
      await recordOutcome(false, "AI returned no carousel slides")
      await refundGenerationUsage(supabase, user.id, CAROUSEL, logId)
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Carousel generation failed. Please try again."), { status: 500 })
    }

    // Complete from the start, not dependent on the later best-effort
    // background-image enrichment step ever running/succeeding — see
    // mergeCtaSlideIntoSlides's own comment above.
    const realHandle = brand.instagram_handle ? `@${brand.instagram_handle}` : undefined
    let mergedSlides = mergeCtaSlideIntoSlides(d.slides, d.cta_slide, realHandle)

    // Override every slide's background_style with one deterministic,
    // vibe-derived value — see VIBE_TO_CAROUSEL_BACKGROUND above. Applied
    // after the CTA merge so a synthesized CTA slide (which otherwise
    // always hardcodes "gradient_dark") also reflects the selected vibe.
    // A manual `vibe` from the request (the Customize override) still
    // wins; otherwise the model now picks its own vibe in the same JSON
    // response (suggested_vibe), so the user no longer picks one
    // separately.
    const effectiveVibe = vibe || (d.suggested_vibe as string | undefined)
    const vibeBackground = effectiveVibe ? VIBE_TO_CAROUSEL_BACKGROUND[effectiveVibe] : undefined
    if (vibeBackground) {
      mergedSlides = mergedSlides.map((s) =>
        s && typeof s === "object" ? { ...s, background_style: vibeBackground } : s
      )
    }

    // One font for the whole set, so every slide matches: the model's
    // suggested_font_id if it's a real id, else a deterministic pick from
    // the brand's vibe / the carousel vibe. Stamped on every slide before
    // saving; the user can still change it per slide in the editor.
    const fontId = resolveSuggestedFont(d.suggested_font_id, brand.vibe, effectiveVibe)
    d.suggested_font_id = fontId
    mergedSlides = mergedSlides.map((s) => (s && typeof s === "object" ? { ...s, font_id: fontId } : s))

    mergedSlides = sanitizeCarouselSlides(mergedSlides)
    const cleanTitle = typeof d.title === "string" ? sanitizeCarouselText(d.title) : d.title
    const cleanCoverHook = typeof d.cover_hook === "string" ? sanitizeCarouselText(d.cover_hook) : d.cover_hook

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
          hashtags: Array.isArray(d.hashtags) ? d.hashtags : [],
          is_saved: true,
        })
        .select("id")
        .single() as { data: { id: string } | null }
      carouselId = saved?.id ?? null
    } catch (persistErr) {
      console.error("[ai/carousel/generate] persist failed (non-fatal):", persistErr)
    }

    // slides returned to the client is the same merged array now saved to
    // the row -- CarouselBuilder.tsx's own withCtaSlideMerged() sees the
    // cta-type slide already present and is a no-op (it explicitly checks
    // for this), so this doesn't change client behavior, just keeps what
    // the client renders and what's in the database consistent from the
    // very first response.
    await recordOutcome(true)
    return NextResponse.json({ data: { ...d, title: cleanTitle, cover_hook: cleanCoverHook, slides: mergedSlides, id: carouselId } }, { status: 200 })
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
