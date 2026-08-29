import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { generateCarouselSlideBackground, type CarouselVibe } from "@/lib/ai/carousel-slide-background"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import { isInternalUnlimited } from "@/lib/usage/is-internal-unlimited"
import { checkAndIncrementUsage, refundGenerationUsage } from "@/lib/usage/check-and-increment-usage"
import { CAROUSEL_SLIDE_AI_BACKGROUND } from "@/lib/usage/credit-costs"
import { PLAN_LIMITS, type UserPlan } from "@/types/app"
import { z } from "zod"
import type { BrandRow } from "@/types/database"

const CAROUSEL_VIBES = ["fun_playful", "clean_minimal", "bold_dramatic", "warm_cozy", "professional", "trendy_genz"] as const

const schema = z.object({
  brandId: z.string().uuid(),
  vibe: z.enum(CAROUSEL_VIBES).optional(),
  role: z.enum(["hook", "cta", "body"]),
})

// Chains up to 3 sequential external calls (first attempt, retry, and a
// possible Flux-to-Pollinations fallback) inside fetchBackgroundImage —
// each a real network round-trip that can individually take 10-30s+, so
// this needs more headroom than Vercel's platform default. Matches the
// convention already used by other slow-external-call routes in this repo
// (e.g. app/api/v1/brands/fastlane/route.ts, app/api/v1/ai/stories/slide-image/generate/route.ts).
export const maxDuration = 60

/**
 * Generates an AI background image for a carousel's opening (hook),
 * closing (CTA), or — the opt-in "AI background for every slide" mode —
 * a content ("body") slide. See lib/ai/carousel-slide-background.ts for
 * the prompt. Fired by CarouselBuilder.tsx as a best-effort follow-up
 * after text generation succeeds, not as part of
 * /api/v1/ai/carousel/generate itself, so a slow/failed image call never
 * blocks or breaks carousel generation — the client just keeps the
 * existing flat vibe-color slide.
 *
 * hook/cta stay unmetered (bundled into the carousel generation's own
 * charge, as before) — only "body" spends real credits
 * (CAROUSEL_SLIDE_AI_BACKGROUND per slide), since that's the genuinely
 * new, uncapped-count cost surface a user opts into.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { brandId, vibe, role } = parsed.data

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const { data: userData } = await supabase.from("users").select("plan").eq("id", user.id).single<{ plan: UserPlan }>()
  const plan: UserPlan = userData?.plan ?? "starter"
  const isUnlimited = isInternalUnlimited(user.id)

  // Hook (first) slide gets an AI background on every plan — intentional:
  // it's the first-impression slide meant to showcase quality and help
  // convert trialing users into subscribers. CTA (last) slide is
  // Starter+ only (i.e. every real plan now that Free is gone, but the
  // flag stays for clarity and in case a cheaper tier returns later).
  if (role === "cta" && !PLAN_LIMITS[plan].carouselCtaAiBackground && !isUnlimited) {
    return NextResponse.json(
      buildError(ErrorCodes.USAGE_LIMIT_EXCEEDED, "AI backgrounds on the closing slide are available on Starter and above."),
      { status: 403 }
    )
  }

  // "body" is the only role that actually spends credits — checked and
  // charged up front, same pattern as every other paid generation route,
  // refunded below if generation or upload ends up failing.
  let usageLogId: string | null = null
  if (role === "body") {
    const usageCheck = await checkAndIncrementUsage(user.id, CAROUSEL_SLIDE_AI_BACKGROUND, "carousel_slide_bg_body")
    if (!usageCheck.ok) {
      const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
      return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
    }
    usageLogId = usageCheck.logId
  }

  const startTime = Date.now()
  const result = await generateCarouselSlideBackground({
    vibe: vibe as CarouselVibe | undefined,
    brand,
    plan,
    isInternalUnlimitedUser: isUnlimited,
    role,
  })
  const latencyMs = Date.now() - startTime

  if (!result.success) {
    console.error(`[ai/carousel/slide-image/generate] generation failed after ${latencyMs}ms (role=${role}):`, result.error)
    if (role === "body") await refundGenerationUsage(supabase, user.id, CAROUSEL_SLIDE_AI_BACKGROUND, usageLogId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("ai_generation_logs") as any).insert({
      user_id: user.id, brand_id: brandId, feature: `carousel_slide_bg_${role}`, model: "unknown",
      latency_ms: latencyMs, success: false, error_message: result.error,
    })
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, result.error), { status: 500 })
  }

  // Surfaced in ai_generation_logs below — Flux is a paid-per-call cost and
  // Pollinations isn't, so knowing which one actually ran per row (not just
  // which plan the user is on) matters for monitoring real cost as usage
  // grows, especially since a Flux failure can silently fall back to
  // Pollinations mid-call (see fetchBackgroundImage).
  const { provider } = result

  const uploadResult = await uploadMediaToStorage(
    { kind: "buffer", buffer: result.buffer, mimeType: result.mimeType },
    `${brandId}/carousel-slides`
  )

  if ("error" in uploadResult) {
    console.error(`[ai/carousel/slide-image/generate] upload failed (role=${role}):`, uploadResult.error)
    if (role === "body") await refundGenerationUsage(supabase, user.id, CAROUSEL_SLIDE_AI_BACKGROUND, usageLogId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("ai_generation_logs") as any).insert({
      user_id: user.id, brand_id: brandId, feature: `carousel_slide_bg_${role}`, model: provider,
      latency_ms: latencyMs, success: false, error_message: uploadResult.error,
    })
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Image generated but upload to storage failed."), { status: 500 })
  }

  // Logged per call (not just on failure) so per-carousel image-call
  // latency/cost is queryable via ai_generation_logs as usage grows — a
  // single carousel can trigger up to 2 of these for hook/cta alone (1 for
  // Free tier), plus one per body slide when the AI-background mode is on.
  console.log(`[ai/carousel/slide-image/generate] role=${role} plan=${plan} provider=${provider} latencyMs=${latencyMs}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("ai_generation_logs") as any).insert({
    user_id: user.id, brand_id: brandId, feature: `carousel_slide_bg_${role}`, model: provider,
    latency_ms: latencyMs, success: true,
  })

  return NextResponse.json({ data: { public_url: uploadResult.publicUrl, role } }, { status: 200 })
}
