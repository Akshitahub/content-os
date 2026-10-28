import { NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage, refundGenerationUsage, logGenerationOutcome } from "@/lib/usage/check-and-increment-usage"
import { AD_MAKER } from "@/lib/usage/credit-costs"

const FEATURE = "ad_maker"
import { generateAdMakerBackgroundSchema } from "@/lib/validations/ai"
import { generateAdMakerBackground } from "@/lib/ai/ad-maker-background"
import { generateAdStrategy, type AdStrategyResult } from "@/lib/ai/ad-strategy"
import { attemptsCostUsd } from "@/lib/ai/post-image-pipeline"
import { sumCostUsd } from "@/lib/ai/pricing"
import { isInternalUnlimited } from "@/lib/usage/is-internal-unlimited"
import type { BrandRow, ProductRow } from "@/types/database"
import type { UserPlan } from "@/types/app"
import { timedGenerationRoute, type GenerationTimer } from "@/lib/utils/generation-timing"
import { withDeadline, DeadlineExceededError, GENERATION_TIMED_OUT_MESSAGE } from "@/lib/utils/with-deadline"
import { prepareGeneratedImage } from "@/lib/storage/generated-image"
import { getActiveLessons } from "@/lib/ai/brand-brain"
import { recordContentEvent } from "@/lib/usage/content-events"

const BUCKET = "brand-images"

type RouteParams = { params: Promise<{ brandId: string }> }

// Chains up to 2 sequential image-provider calls (primary attempt + a
// fallback-prompt retry) inside fetchBackgroundImage, for each of 3
// variations -- worst case ~4 x 25s per variation (they run in parallel,
// staggered), which the old 60s couldn't hold: Vercel killed the function
// after AD_MAKER credits were charged and nothing was refunded. 300s =
// Hobby maximum with fluid compute (vercel.com/docs/functions/
// configuring-functions/duration, checked 2026-10-26). Each variation has
// the route's own deadline 30s earlier, so finished variations are still
// returned and an all-failed run still refunds.
export const maxDuration = 300
const IMAGE_DEADLINE_MS = 270_000

const VARIATION_COUNT = 3

// Originally confirmed live (2026-08-25) against Pollinations' own per-IP
// concurrency ceiling (a plain Promise.all for all 3 variations collided
// with its "Queue full for IP...: 1 requests already queued (max: 1)"
// limit almost every run). Pollinations is gone -- every variation now
// goes through the image provider -- but this stagger is kept as a general
// precaution against bursting 3 concurrent paid API calls in the exact
// same instant, paired with the partial-success handling below rather
// than relied on alone. Worth revisiting if the provider's own concurrency
// limits turn out to make this unnecessary.
const STAGGER_MS = 400

// The strategy text call runs before the images; past this it's abandoned
// and the ad falls back to brief-less variations.
const STRATEGY_DEADLINE_MS = 60_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Charges credits and generates Ad Maker's 3 background-image variations
 * server-side via the shared fetchBackgroundImage pipeline (OpenAI's
 * gpt-image-2, retry-with-fallback-prompt, quality checks) -- previously this route was
 * a credit-charge no-op and each of the 3 backgrounds was fetched entirely
 * client-side, straight from Pollinations, sequentially, each with its own
 * bespoke retry loop -- the actual source of the "slow/unreliable"
 * complaint. The 3
 * generateAdMakerBackground calls below run concurrently (each is an
 * independent generation, so they naturally come out distinct) and only
 * one credit charge covers all 3, same as before. Canvas compositing
 * (product photo + text + logo) still happens client-side in AdMaker.tsx,
 * using the storage URLs this route returns as the background layer for
 * each of the 3 variations.
 */
export async function POST(request: Request, ctx: RouteParams) {
  return timedGenerationRoute("ad-maker", (timer) => handlePost(request, ctx, timer))
}

async function handlePost(request: Request, { params }: RouteParams, timer: GenerationTimer) {
  const deadlineAt = Date.now() + IMAGE_DEADLINE_MS
  const { brandId } = await params
  console.log(`[ai/ad-maker/generate] POST called for brand ${brandId}`)

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[ai/ad-maker/generate] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = generateAdMakerBackgroundSchema.safeParse(body)
  // issues[0]?.message, not parsed.error.message -- see fullpost/generate's
  // identical fix for why (a friendly per-field message, e.g. customPrompt's
  // own .max() text, instead of a raw JSON issues dump).
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })
  const { scene, customScene, format, productImageBase64, customPrompt, productId, hookText, userDirection } = parsed.data

  const usageCheck = await checkAndIncrementUsage(user.id, AD_MAKER, FEATURE)
  if (!usageCheck.ok) {
    const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
    return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
  }
  const logId = usageCheck.logId

  // Every plan resolves to the same image provider now (lib/ai/post-image-pipeline.ts's
  // fetchBackgroundImage) -- still looked up since that function's
  // signature expects it, same as every other generation route.
  const { data: userData } = await supabase.from("users").select("plan").eq("id", user.id).single<{ plan: UserPlan }>()
  const plan: UserPlan = userData?.plan ?? "starter"

  const startTime = Date.now()

  // Upload via the admin client -- storage RLS expects the path to start
  // with the user's auth uid, admin bypasses RLS safely here since brand
  // ownership is already verified above (same pattern as images/generate).
  // Created here (not just below, where background uploads happen) so the
  // product reference photo can be uploaded before generation kicks off.
  const admin = await createAdminClient()

  // A real uploaded product photo, used as an image-to-image reference
  // (see generateAdMakerBackground/lib/ai/image-provider.ts) -- optional, so
  // an upload failure here degrades to the old background-only behavior
  // rather than failing the whole request.
  let productImageUrl: string | undefined
  if (productImageBase64) {
    try {
      // The client sends whichever form productDataUrl is already holding
      // (a data: URL from FileReader/remove-background, same as the
      // upload-variation route's dataUrl) -- strip that prefix when
      // present so this doesn't try to decode "data:image/png;base64,"
      // itself as image bytes; falls back to treating the whole string as
      // raw base64 if there's no data: prefix to strip.
      const base64Payload = productImageBase64.match(/^data:[^;]+;base64,(.+)$/)?.[1] ?? productImageBase64
      const productImageBuffer = Buffer.from(base64Payload, "base64")
      const productImagePath = `${user.id}/${brandId}/ad-maker-product-${Date.now()}-${crypto.randomUUID()}.png`
      const { error: productUploadError } = await admin.storage
        .from(BUCKET)
        .upload(productImagePath, productImageBuffer, { contentType: "image/png", upsert: false })
      if (productUploadError) {
        console.error(`[ai/ad-maker/generate] product image upload failed, continuing without a reference image:`, productUploadError)
      } else {
        productImageUrl = admin.storage.from(BUCKET).getPublicUrl(productImagePath).data.publicUrl
      }
    } catch (err) {
      console.error(`[ai/ad-maker/generate] product image decode/upload threw, continuing without a reference image:`, err)
    }
  }

  // Strategy first: ad brief + 3 distinct variants (lib/ai/ad-strategy.ts).
  // The extra text call is absorbed into the existing AD_MAKER credit cost
  // for now -- no price change. Any failure or timeout falls back to exactly
  // the old behaviour (3 variations from the same scene, no briefs); it
  // never fails the ad.
  let strategy: AdStrategyResult | null = null
  try {
    let product: ProductRow | null = null
    if (productId) {
      const { data: prod } = await supabase.from("products").select("*").eq("id", productId).eq("brand_id", brandId).single<ProductRow>()
      product = prod
    }
    strategy = await timer.step("caption", withDeadline(
      generateAdStrategy({ brand, product, userDirection: hookText || (scene === "custom" ? customScene : undefined), format, timeoutMs: 45_000, lessons: await getActiveLessons(supabase, brandId, "ad_copy") }),
      Math.min(STRATEGY_DEADLINE_MS, deadlineAt - Date.now()),
      "ad strategy"
    ))
  } catch (err) {
    console.error("[ai/ad-maker/generate] ad strategy failed, falling back to brief-less variations:", err instanceof Error ? err.message : err)
  }

  const backgroundOptions = {
    scene,
    customScene,
    brandNiche: brand.niche,
    format,
    plan,
    isInternalUnlimitedUser: isInternalUnlimited(user.id),
    productImageUrl,
    customPrompt,
    userDirection,
  }
  const results = await timer.step("image", Promise.all(
    Array.from({ length: VARIATION_COUNT }, async (_, i): Promise<Awaited<ReturnType<typeof generateAdMakerBackground>>> => {
      if (i > 0) await sleep(i * STAGGER_MS)
      return withDeadline(generateAdMakerBackground({ ...backgroundOptions, visualBrief: strategy?.variants[i]?.visual }), deadlineAt - Date.now(), "ad maker variation").catch((err) => ({
        success: false as const,
        error: err instanceof DeadlineExceededError ? GENERATION_TIMED_OUT_MESSAGE : (err instanceof Error ? err.message : "Image generation failed"),
        attempts: [],
      }))
    })
  ))

  // Partial success is the normal case now, not a failure -- zero usable
  // output is the only thing that actually justifies failing the whole
  // request (and refunding). Previously a single failed variation out of
  // 3 failed everything, even when the other two succeeded fine.
  // Each result keeps its own variant, so copy and image stay paired even
  // when a variation fails.
  type Result = (typeof results)[number]
  const successes = results
    .map((r, i) => ({ r, variant: strategy?.variants[i] ?? null }))
    .filter((x): x is { r: Extract<Result, { success: true }>; variant: AdStrategyResult["variants"][number] | null } => x.r.success)
  const strategyLog = {
    prompt_tokens: strategy?.usage?.prompt_tokens ?? null,
    completion_tokens: strategy?.usage?.completion_tokens ?? null,
    total_tokens: strategy?.usage?.total_tokens ?? null,
  }

  if (successes.length === 0) {
    const firstFailure = results.find((r): r is Extract<Result, { success: false }> => !r.success)
    console.error(`[ai/ad-maker/generate] all ${VARIATION_COUNT} background variations failed after ${Date.now() - startTime}ms:`, firstFailure?.error)
    await logGenerationOutcome(supabase, logId, {
      user_id: user.id, brand_id: brandId, feature: FEATURE, model: strategy ? `unknown+${strategy.model}` : "unknown",
      ...strategyLog,
      cost_usd: sumCostUsd(strategy?.costUsd, ...results.map((r) => attemptsCostUsd(r.attempts))),
      latency_ms: Date.now() - startTime, success: false, error_message: firstFailure?.error ?? "All variations failed",
    })
    await refundGenerationUsage(supabase, user.id, AD_MAKER, logId)
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Couldn't generate a background. Please try again."), { status: 500 })
  }

  const uploaded = (
    await Promise.all(
      successes.map(async ({ r: result, variant }, i) => {
        const image = await prepareGeneratedImage(result.buffer, result.mimeType, "ai/ad-maker/generate")
        const storagePath = `${user.id}/${brandId}/ad-maker-${Date.now()}-${i}-${crypto.randomUUID()}.${image.ext}`
        const { error: uploadError } = await admin.storage
          .from(BUCKET)
          .upload(storagePath, image.buffer, { contentType: image.mimeType, upsert: false })
        return uploadError ? null : { storagePath, provider: result.provider, variant }
      })
    )
  ).filter((u): u is NonNullable<typeof u> => !!u)

  if (uploaded.length === 0) {
    // Same partial-success reasoning as generation above -- a variation
    // that generated but never actually made it to storage isn't usable
    // output either. Only fatal if NONE of the successfully-generated
    // variations could be uploaded.
    await refundGenerationUsage(supabase, user.id, AD_MAKER, logId)
    return NextResponse.json(
      buildError(ErrorCodes.INTERNAL_ERROR, "Backgrounds generated but upload to storage failed."),
      { status: 500 }
    )
  }

  const provider = successes[0]!.r.provider

  await logGenerationOutcome(supabase, logId, {
    user_id: user.id, brand_id: brandId, feature: FEATURE, model: strategy ? `${provider}+${strategy.model}` : provider,
    ...strategyLog,
    // All variations, including failed ones -- each was billed -- plus the strategy call.
    cost_usd: sumCostUsd(strategy?.costUsd, ...results.map((r) => attemptsCostUsd(r.attempts))),
    latency_ms: Date.now() - startTime, success: true,
  })

  // url/provider stay where older clients read them; variant (the copy for
  // this image) and ad_brief are new and null when the strategy step failed.
  const variations = uploaded.map((u) => ({
    url: admin.storage.from(BUCKET).getPublicUrl(u.storagePath).data.publicUrl,
    provider: u.provider,
    variant: u.variant,
  }))

  // No content row exists for Ad Maker, so no id -- and "Generate again"
  // hits this same route, so it can't be told apart from a first run.
  recordContentEvent(supabase, {
    userId: user.id, brandId, contentType: "ad_maker", contentId: null, event: "generated",
    meta: { model: strategy ? `${provider}+${strategy.model}` : provider, cost_usd: sumCostUsd(strategy?.costUsd, ...results.map((r) => attemptsCostUsd(r.attempts))), variations: variations.length, strategy: !!strategy },
  })

  return NextResponse.json({ data: { variations, ad_brief: strategy?.brief ?? null } }, { status: 200 })
}
