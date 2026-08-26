import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { generateStorySlideBackground, type StoryVibe } from "@/lib/ai/story-slide-background"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import { isInternalUnlimited } from "@/lib/usage/is-internal-unlimited"
import type { UserPlan } from "@/types/app"
import { z } from "zod"
import type { BrandRow } from "@/types/database"

const STORY_VIBES = ["fun_playful", "clean_minimal", "bold_dramatic", "warm_cozy", "professional", "trendy_genz"] as const

const schema = z.object({
  brandId: z.string().uuid(),
  text: z.string().min(1).max(300),
  vibe: z.enum(STORY_VIBES).optional(),
  role: z.enum(["hook", "cta"]),
})

// Chains up to 3 sequential external calls (first attempt, retry, and a
// possible Flux-to-Pollinations fallback) inside fetchBackgroundImage —
// each a real network round-trip that can individually take 10-30s+, so
// this needs more headroom than Vercel's platform default. Matches the
// convention already used by other slow-external-call routes in this repo
// (e.g. app/api/v1/brands/fastlane/route.ts).
export const maxDuration = 60

/**
 * Generates an AI background image for a story's opening (hook) or closing
 * (CTA) slide — see lib/ai/story-slide-background.ts for the prompt.
 * Mirrors app/api/v1/ai/carousel/slide-image/generate/route.ts exactly,
 * just with a portrait (9:16) canvas instead of square. Fired by
 * StorySequence.tsx as a best-effort follow-up after text generation
 * succeeds, so a slow/failed image call never blocks or breaks story
 * generation — the client just keeps the existing flat vibe-color slide.
 * Available to every plan including Free (no PLAN_LIMITS gate here — see
 * carouselCtaAiBackground for comparison, which does gate the carousel
 * CTA slide; Stories intentionally does not gate either slide).
 * Not currently metered against the generation-credit quota.
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

  const { brandId, text, vibe, role } = parsed.data

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const { data: userData } = await supabase.from("users").select("plan").eq("id", user.id).single<{ plan: UserPlan }>()
  const plan: UserPlan = userData?.plan ?? "starter"
  const isUnlimited = isInternalUnlimited(user.id)

  const startTime = Date.now()
  const result = await generateStorySlideBackground({
    text,
    vibe: vibe as StoryVibe | undefined,
    brand,
    plan,
    isInternalUnlimitedUser: isUnlimited,
  })
  const latencyMs = Date.now() - startTime

  if (!result.success) {
    console.error(`[ai/stories/slide-image/generate] generation failed after ${latencyMs}ms (role=${role}):`, result.error)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("ai_generation_logs") as any).insert({
      user_id: user.id, brand_id: brandId, feature: `story_slide_bg_${role}`, model: "unknown",
      latency_ms: latencyMs, success: false, error_message: result.error,
    })
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, result.error), { status: 500 })
  }

  const { provider } = result

  const uploadResult = await uploadMediaToStorage(
    { kind: "buffer", buffer: result.buffer, mimeType: result.mimeType },
    `${brandId}/story-slides`
  )

  if ("error" in uploadResult) {
    console.error(`[ai/stories/slide-image/generate] upload failed (role=${role}):`, uploadResult.error)
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

  return NextResponse.json({ data: { public_url: uploadResult.publicUrl, role } }, { status: 200 })
}
