import { NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { generatePostImageSchema } from "@/lib/validations/ai"
import { generatePostImage, type ImageGenerationAttempt } from "@/lib/ai/post-image-pipeline"
import { resolveColorThemes, findColorTheme } from "@/lib/design/color-themes"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage, refundGenerationUsage } from "@/lib/usage/check-and-increment-usage"
import { checkAndIncrementPostImageSession } from "@/lib/usage/post-image-regenerate-session"
import { isInternalUnlimited } from "@/lib/usage/is-internal-unlimited"
import type { BrandRow } from "@/types/database"
import type { UserPlan } from "@/types/app"

const BUCKET = "brand-images"
const FEATURE = "post_image"

/**
 * Persists every attempt fetchBackgroundImage made (not just the final
 * outcome) — see docs/research/post-imagery-diagnosis.md issue 3. Never
 * blocks or fails the response over this: it's pure observability, and a
 * logging failure here must never look like an image-generation failure
 * to the user.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function persistAttempts(supabase: any, brandId: string, attempts: ImageGenerationAttempt[]): Promise<void> {
  if (attempts.length === 0) return
  try {
    await supabase.from("image_generation_attempts").insert(
      attempts.map((a) => ({
        brand_id: brandId,
        feature: FEATURE,
        attempt_number: a.attemptNumber,
        provider: a.provider,
        prompt_variant: a.promptVariant,
        success: a.success,
        failure_reason: a.failureReason,
      }))
    )
  } catch (err) {
    console.error("[ai/post-image/generate] failed to persist generation attempts (non-fatal):", err)
  }
}

// Chains up to 3 sequential external calls (first attempt, retry, and a
// possible Flux-to-Pollinations fallback) inside generatePostImage — each
// a real network round-trip that can individually take 10-30s+, so this
// needs more headroom than Vercel's platform default. Matches the
// convention already used by other slow-external-call routes in this repo
// (e.g. app/api/v1/brands/fastlane/route.ts, app/api/v1/ai/stories/slide-image/generate/route.ts).
export const maxDuration = 60

/**
 * Generates the final Create → Full Post AI image: Pollinations (via
 * lib/ai/post-image-pipeline.ts) grounded in the caption's own message,
 * composited with the chosen template's logo/headline/accent/CTA overlay.
 * Serves both the initial image generation and the "Regenerate image"
 * button — see lib/usage/post-image-regenerate-session.ts for how charging
 * is decided (1st call charges, 2nd is free, 3rd+ charges again).
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = generatePostImageSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { brandId, productId, imagePrompt, template, colorThemeId, headline, ctaText, postSessionId } = parsed.data

  const sessionCheck = await checkAndIncrementPostImageSession(user.id, postSessionId)
  const shouldCharge = sessionCheck.ok ? sessionCheck.shouldCharge : true
  console.log(
    `[ai/post-image/generate] session check for ${postSessionId}: sessionFound=${sessionCheck.ok} shouldCharge=${shouldCharge}`
  )

  if (shouldCharge) {
    const usageCheck = await checkAndIncrementUsage(user.id)
    if (!usageCheck.ok) {
      const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
      return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
    }
  }

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  // Determines the image provider (Free -> Pollinations, paid -> Flux) —
  // see lib/ai/post-image-pipeline.ts's resolveImageProvider.
  const { data: userData } = await supabase.from("users").select("plan").eq("id", user.id).single<{ plan: UserPlan }>()
  const plan: UserPlan = userData?.plan ?? "free"

  const colorTheme = findColorTheme(resolveColorThemes(brand), colorThemeId)

  console.log(
    `[ai/post-image/generate] starting generation for brand ${brandId}: template=${template} colorTheme=${colorTheme.id} promptLen=${imagePrompt.length} promptPreview=${JSON.stringify(imagePrompt.slice(0, 120))}`
  )

  const startTime = Date.now()
  const result = await generatePostImage({
    imagePrompt,
    brandNiche: brand.niche,
    targetAudience: brand.target_audience,
    template,
    colorTheme,
    headline,
    ctaText: ctaText || brand.cta_phrase || "Shop now",
    logoUrl: brand.logo_url,
    plan,
    isInternalUnlimitedUser: isInternalUnlimited(user.id),
  })

  if (!result.success) {
    console.error(`[ai/post-image/generate] generation failed after ${Date.now() - startTime}ms:`, result.error)
    await persistAttempts(supabase, brandId, result.attempts)
    // Best-effort provider label from whatever was actually attempted —
    // previously this was hardcoded to "flux+resvg-composite" regardless
    // of which provider (if any) actually ran, which was actively
    // misleading for every free-plan (Pollinations) failure.
    const lastProvider = result.attempts[result.attempts.length - 1]?.provider ?? "unknown"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("ai_generation_logs") as any).insert({
      user_id: user.id, brand_id: brandId, feature: FEATURE, model: lastProvider,
      latency_ms: Date.now() - startTime, success: false, error_message: result.error,
    })
    // Only refund if this call actually charged a credit — the free
    // regenerate (2nd call in a session) never did.
    if (shouldCharge) await refundGenerationUsage(supabase, user.id)
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, result.error), { status: 500 })
  }

  await persistAttempts(supabase, brandId, result.attempts)

  // Upload via the admin client — storage RLS expects the path to start
  // with the user's auth uid, admin bypasses RLS safely here since brand
  // ownership is already verified above (same pattern as images/generate).
  const admin = await createAdminClient()
  const storagePath = `${user.id}/${brandId}/${Date.now()}-${crypto.randomUUID()}.png`

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, result.buffer, { contentType: result.mimeType, upsert: false })

  if (uploadError) {
    // Image was generated but never actually delivered to the user — no
    // usable output, same as a generation failure.
    if (shouldCharge) await refundGenerationUsage(supabase, user.id)
    return NextResponse.json(
      buildError(ErrorCodes.INTERNAL_ERROR, "Image generated but upload to storage failed.", uploadError.message),
      { status: 500 }
    )
  }

  const { data: publicUrlData } = admin.storage.from(BUCKET).getPublicUrl(storagePath)
  const latencyMs = Date.now() - startTime

  // model_used and provider both now record the real provider that
  // actually produced the base image — previously model_used was
  // hardcoded to "flux+resvg-composite" even for the 100% of production
  // images that were actually served by Pollinations (every current user
  // is on the free plan), making it impossible to answer how often the
  // Flux->Pollinations fallback fires. provider is the new structured
  // column; model_used keeps its existing "<what produced this>+resvg-composite"
  // shape for anything still reading it as a single label.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: savedImage } = await (supabase.from("generated_images") as any).insert({
    brand_id: brandId,
    product_id: productId ?? null,
    prompt: result.fullPrompt,
    style: null,
    aspect_ratio: "1:1",
    storage_path: storagePath,
    public_url: publicUrlData.publicUrl,
    model_used: `${result.provider}+resvg-composite`,
    provider: result.provider,
    is_saved: true,
  }).select().single()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("ai_generation_logs") as any).insert({
    user_id: user.id, brand_id: brandId, feature: FEATURE, model: `${result.provider}+resvg-composite`,
    latency_ms: latencyMs, success: true,
  })

  return NextResponse.json({
    data: {
      id: savedImage?.id ?? null,
      public_url: publicUrlData.publicUrl,
      storage_path: storagePath,
      image_prompt: result.fullPrompt,
    },
  }, { status: 200 })
}
