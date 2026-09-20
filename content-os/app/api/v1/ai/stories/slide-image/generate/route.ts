import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { generateStorySlideBackground, type StoryVibe } from "@/lib/ai/story-slide-background"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import { isInternalUnlimited } from "@/lib/usage/is-internal-unlimited"
import { checkAndIncrementUsage, refundGenerationUsage } from "@/lib/usage/check-and-increment-usage"
import { STORY_SLIDE_AI_BACKGROUND } from "@/lib/usage/credit-costs"
import type { UserPlan } from "@/types/app"
import { z } from "zod"
import type { BrandRow } from "@/types/database"

const STORY_VIBES = ["fun_playful", "clean_minimal", "bold_dramatic", "warm_cozy", "professional", "trendy_genz"] as const

const schema = z.object({
  brandId: z.string().uuid(),
  vibe: z.enum(STORY_VIBES).optional(),
  role: z.enum(["hook", "cta", "body"]),
  productImageUrl: z.string().url().optional(),
  textPosition: z.enum(["top", "center", "bottom"]).optional(),
  // SocioPosts-authored (and possibly user-edited) visual scene from the
  // new prompt-writing stage -- see lib/ai/story-slide-background.ts's
  // GenerateStorySlideBackgroundOptions.customPrompt.
  customPrompt: z
    .string()
    // Was 600 -- too short for the prompt-authoring stage's real 80-150
    // word output (lib/ai/image-prompt-writer.ts). Matches
    // lib/validations/ai.ts's identical fix on the same field elsewhere.
    .max(1500, "Visual scene must be under 1500 characters")
    .optional()
    .transform((val) => val?.replace(/<[^>]*>/g, "").trim()),
})

// Chains up to 2 sequential Flux calls (first attempt + retry) inside
// fetchBackgroundImage — each a real network round-trip that can
// individually take 10-30s+, so this needs more headroom than Vercel's
// platform default. Matches the convention already used by other
// slow-external-call routes in this repo (e.g.
// app/api/v1/brands/fastlane/route.ts).
export const maxDuration = 60

/**
 * Generates an AI background image for a story's opening (hook), closing
 * (cta), or — the opt-in "AI background for every slide" mode — a
 * reveal/buildup ("body") slide. See lib/ai/story-slide-background.ts for
 * the prompt. Mirrors app/api/v1/ai/carousel/slide-image/generate/route.ts
 * exactly, just with a portrait (9:16) canvas instead of square. Fired by
 * StorySequence.tsx as a best-effort follow-up after text generation
 * succeeds, so a slow/failed image call never blocks or breaks story
 * generation — the client just keeps the existing flat vibe-color slide.
 *
 * hook/cta stay unmetered (bundled into the story generation's own
 * charge, as before) in the no-product case — only "body" spends real
 * credits (STORY_SLIDE_AI_BACKGROUND per slide), since that's the
 * genuinely new, uncapped-count cost surface a user opts into. A real
 * productImageUrl reference photo charges regardless of role, though —
 * a photorealistic reference-image generation is that same new cost
 * surface no matter which slide it's attached to. Neither role is gated by
 * plan (Stories has never gated either slide — see carouselCtaAiBackground
 * for the carousel equivalent that does gate its CTA slide).
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
  // issues[0]?.message, not parsed.error.message -- see fullpost/generate's
  // identical fix for why (a friendly per-field message instead of a raw
  // JSON issues dump).
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })

  const { brandId, vibe, role, productImageUrl, textPosition, customPrompt } = parsed.data

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const { data: userData } = await supabase.from("users").select("plan").eq("id", user.id).single<{ plan: UserPlan }>()
  const plan: UserPlan = userData?.plan ?? "starter"
  const isUnlimited = isInternalUnlimited(user.id)

  // "body" always spends credits, same as before. A hook/cta slide is
  // still free in the no-product case (bundled into the story generation's
  // own charge), but a real product reference photo is a genuinely new,
  // uncapped-count cost surface regardless of which slide it's attached
  // to — so it charges here too. Checked and charged up front, same
  // pattern as every other paid generation route, refunded below if
  // generation or upload ends up failing.
  const isChargeable = role === "body" || !!productImageUrl
  let usageLogId: string | null = null
  if (isChargeable) {
    const usageCheck = await checkAndIncrementUsage(user.id, STORY_SLIDE_AI_BACKGROUND, "story_slide_bg_body")
    if (!usageCheck.ok) {
      const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
      return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
    }
    usageLogId = usageCheck.logId
  }

  const startTime = Date.now()
  const result = await generateStorySlideBackground({
    vibe: vibe as StoryVibe | undefined,
    brand,
    plan,
    isInternalUnlimitedUser: isUnlimited,
    role,
    productImageUrl,
    textPosition,
    customPrompt,
  })
  const latencyMs = Date.now() - startTime

  if (!result.success) {
    console.error(`[ai/stories/slide-image/generate] generation failed after ${latencyMs}ms (role=${role}):`, result.error)
    if (isChargeable) await refundGenerationUsage(supabase, user.id, STORY_SLIDE_AI_BACKGROUND, usageLogId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("ai_generation_logs") as any).insert({
      user_id: user.id, brand_id: brandId, feature: `story_slide_bg_${role}`, model: "unknown",
      latency_ms: latencyMs, success: false, error_message: result.error,
    })
    // result.error is a real, useful diagnostic (already logged above and
    // in ai_generation_logs) but can name the underlying image provider
    // (e.g. "Flux generation failed: ...") -- never forwarded to the user
    // as-is. A generic, SocioPosts-branded message goes to the client
    // instead.
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Couldn't generate that slide's background. Please try again."), { status: 500 })
  }

  const { provider } = result

  const uploadResult = await uploadMediaToStorage(
    { kind: "buffer", buffer: result.buffer, mimeType: result.mimeType },
    `${brandId}/story-slides`
  )

  if ("error" in uploadResult) {
    console.error(`[ai/stories/slide-image/generate] upload failed (role=${role}):`, uploadResult.error)
    if (isChargeable) await refundGenerationUsage(supabase, user.id, STORY_SLIDE_AI_BACKGROUND, usageLogId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("ai_generation_logs") as any).insert({
      user_id: user.id, brand_id: brandId, feature: `story_slide_bg_${role}`, model: provider,
      latency_ms: latencyMs, success: false, error_message: uploadResult.error,
    })
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Image generated but upload to storage failed."), { status: 500 })
  }

  console.log(`[ai/stories/slide-image/generate] role=${role} plan=${plan} provider=${provider} latencyMs=${latencyMs}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("ai_generation_logs") as any).insert({
    user_id: user.id, brand_id: brandId, feature: `story_slide_bg_${role}`, model: provider,
    latency_ms: latencyMs, success: true,
  })

  return NextResponse.json({ data: { public_url: uploadResult.publicUrl, role, provider } }, { status: 200 })
}
